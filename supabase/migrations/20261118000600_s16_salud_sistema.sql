-- Sprint 16 · Salud del sistema: un solo informe con lo que, si falla, nadie nota hasta que una clienta se queja.
-- `public.system_health()` devuelve un JSON con una lista de comprobaciones (cada una: key, status ok|warn|crit, value, detail) y el peor
-- estado en `status`. Solo la ejecuta `service_role` (el script `npm run health` y, más adelante, un monitor externo): no es del navegador.
--
-- Qué vigila y por qué:
--   cron.*              los 10 trabajos programados corrieron hace poco y bien (si el cron se para, los pagos pendientes no vencen, las
--                       reservas no se liberan y los avisos no salen: nada de eso da un error visible);
--   outbox.backlog      avisos pendientes o fallidos cuyo turno de envío pasó hace más de 15 minutos (el worker no da abasto, está apagado o no
--                       hay proveedor de correo; los programados para más tarde no cuentan);
--   notify.worker       que el cron SÍ llame al worker de avisos: `notify_worker_kick()` termina «bien» aunque devuelva «not_configured» si faltan
--                       en el vault `notify_worker_url` y `notify_worker_key` (así fue en la nube hasta el lanzamiento: nadie lo notaba);
--   outbox.dead         avisos dados por perdidos en las últimas 24 h;
--   payments.stuck      cobros «pendientes» cuya ventana venció hace más de 10 minutos (el cron debía vencerlos cada minuto);
--   reservations.stuck  reservas de stock «activas» ya vencidas hace más de 10 minutos;
--   stock.invariants    variantes donde el stock no cuadra con el libro de movimientos (stock ≠ suma de movimientos), es negativo (BR-INV-04) o
--                       hay más reservado que existente: imposibles; si aparece uno hay un fallo grave;
--   webhooks.problems   avisos de proveedores de pago rechazados o sin pedido en las últimas 24 h;
--   db.size             tamaño de la base (informativo, para vigilar el tope del plan).
-- Además programa `purge-cron-history`: el historial de corridas de pg_cron (`cron.job_run_details`) crece sin límite (≈ 2 300 filas y
-- 0,4 MB al día con los 9 trabajos de antes, ≈ 150 MB al año) y la base del plan gratuito es de 500 MB: se guardan 14 días.
-- Todo lo demás es de solo lectura. Rollback: drop function public.system_health(); select cron.unschedule('purge-cron-history');

select cron.schedule(
  'purge-cron-history',
  '41 3 * * *',
  $cron$delete from cron.job_run_details where end_time < now() - interval '14 days'$cron$);

create or replace function public.system_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_checks   jsonb := '[]'::jsonb;
  v_job      record;
  v_last_ok  timestamptz;
  v_last_st  text;
  v_age      interval;
  v_n        bigint;
  v_oldest   timestamptz;
  v_provider text;
  v_enabled  text;
  v_status   text;
begin
  -- ── cron: cada trabajo y cuánto puede tardar como máximo entre una corrida buena y la siguiente ──
  for v_job in
    select * from (values
      ('abandon-stale-carts',       interval '130 minutes'),
      ('expire-pending-payments',   interval '10 minutes'),
      ('expire-stock-reservations', interval '10 minutes'),
      ('notify-worker',             interval '10 minutes'),
      ('purge-cron-history',        interval '26 hours'),
      ('purge-old-carts',           interval '26 hours'),
      ('purge-stock-reservations',  interval '26 hours'),
      ('rate_limits_cleanup',       interval '26 hours'),
      ('remind-expiring-payments',  interval '45 minutes'),
      ('remind-pending-orders',     interval '130 minutes')
    ) as t(jobname, max_age)
    order by 1
  loop
    if not exists (select 1 from cron.job j where j.jobname = v_job.jobname and j.active) then
      v_checks := v_checks || jsonb_build_array(jsonb_build_object(
        'key', 'cron.' || v_job.jobname, 'status', 'crit', 'value', null,
        'detail', 'el trabajo no existe o está apagado'));
      continue;
    end if;
    select max(d.end_time) filter (where d.status = 'succeeded'),
           (array_agg(d.status order by d.start_time desc))[1]
      into v_last_ok, v_last_st
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
     where j.jobname = v_job.jobname;
    if v_last_ok is null then
      v_checks := v_checks || jsonb_build_array(jsonb_build_object(
        'key', 'cron.' || v_job.jobname, 'status', 'warn', 'value', null,
        'detail', 'todavía no terminó ninguna corrida (un trabajo recién programado espera a su primera hora; si el resto del cron también está atrasado, pg_cron está parado)'));
    else
      v_age := now() - v_last_ok;
      v_checks := v_checks || jsonb_build_array(jsonb_build_object(
        'key', 'cron.' || v_job.jobname,
        'status', case when v_age > v_job.max_age then 'crit' when v_last_st = 'failed' then 'warn' else 'ok' end,
        'value', round(extract(epoch from v_age))::bigint,
        'detail', case
          when v_age > v_job.max_age then 'la última corrida buena fue hace más de ' || v_job.max_age::text
          when v_last_st = 'failed' then 'la última corrida falló (la anterior buena fue hace ' || v_age::text || ')'
          else 'última corrida buena hace ' || date_trunc('second', v_age)::text end));
    end if;
  end loop;

  -- ── avisos: lo que espera de más y lo que se dio por perdido ──
  -- el turno de un aviso es next_retry_at (al crearlo vale «ahora»; tras un fallo, el reintento): pasado de más de 15 minutos = atrasado
  select count(*), min(o.next_retry_at)
    into v_n, v_oldest
    from public.notification_outbox o
   where o.status in ('pending', 'failed') and o.next_retry_at < now() - interval '15 minutes';
  select (select s.value #>> '{}' from public.store_settings s where s.key = 'notify_email_provider'),
         (select s.value #>> '{}' from public.store_settings s where s.key = 'notify_enabled')
    into v_provider, v_enabled;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'outbox.backlog',
    'status', case when v_n >= 50 or (v_oldest is not null and v_oldest < now() - interval '3 hours') then 'crit'
                   when v_n > 0 then 'warn' else 'ok' end,
    'value', v_n,
    'detail', case when v_n = 0 then 'ningún aviso espera de más'
                   else v_n || ' avisos esperan hace más de 15 minutos'
                        || case when v_enabled = 'false' then ' (las notificaciones están apagadas: notify_enabled)' else '' end
                        || case when v_provider = 'none' then ' (no hay proveedor de correo: notify_email_provider = none)' else '' end end));

  -- el cron «notify-worker» solo llama al worker si el vault tiene su dirección y su clave; si faltan, la función sale con «not_configured»
  -- y el cron figura como «succeeded»: sin esta comprobación los avisos se quedarían esperando sin que nada lo diga
  select count(*) into v_n from vault.decrypted_secrets d where d.name in ('notify_worker_url', 'notify_worker_key');
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'notify.worker',
    'status', case when v_enabled = 'false' or v_n = 2 then 'ok' else 'warn' end,
    'value', v_n,
    'detail', case when v_enabled = 'false' then 'las notificaciones están apagadas a propósito (notify_enabled)'
                   when v_n = 2 then 'el cron puede llamar al worker de avisos (notify_worker_url y notify_worker_key están en el vault)'
                   else 'faltan ' || (2 - v_n) || ' de los 2 secretos del vault (notify_worker_url, notify_worker_key): el cron no llama al worker y los avisos NO salen, aunque el cron figure bien' end));

  select count(*) into v_n from public.notification_outbox o
   where o.status = 'dead' and o.updated_at > now() - interval '24 hours';
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'outbox.dead',
    'status', case when v_n >= 10 then 'crit' when v_n > 0 then 'warn' else 'ok' end,
    'value', v_n,
    'detail', case when v_n = 0 then 'ningún aviso se perdió en las últimas 24 h' else v_n || ' avisos se dieron por perdidos en las últimas 24 h' end));

  -- ── pagos y reservas que el cron debía haber cerrado ──
  select count(*) into v_n from public.payments p
   where p.status = 'pending' and p.expires_at is not null and p.expires_at < now() - interval '10 minutes';
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'payments.stuck',
    'status', case when v_n > 0 then 'crit' else 'ok' end,
    'value', v_n,
    'detail', case when v_n = 0 then 'ningún cobro pendiente pasó de su ventana' else v_n || ' cobros pendientes vencieron hace más de 10 minutos y siguen pendientes' end));

  select count(*) into v_n from public.stock_reservations r
   where r.status = 'active' and r.expires_at is not null and r.expires_at < now() - interval '10 minutes';
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'reservations.stuck',
    'status', case when v_n > 0 then 'crit' else 'ok' end,
    'value', v_n,
    'detail', case when v_n = 0 then 'ninguna reserva activa pasó de su plazo' else v_n || ' reservas siguen activas hace más de 10 minutos de su plazo' end));

  -- ── lo imposible ──
  select count(*) into v_n from (
    select v.id from public.product_variants v
      left join public.stock_movements m on m.variant_id = v.id
     group by v.id, v.stock_on_hand
    having v.stock_on_hand < 0 or v.stock_on_hand <> coalesce(sum(m.delta), 0)
    union
    select a.variant_id from public.variant_availability a where a.reserved > a.stock_on_hand) q;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'stock.invariants',
    'status', case when v_n > 0 then 'crit' else 'ok' end,
    'value', v_n,
    'detail', case when v_n = 0 then 'el stock, el libro de movimientos y las reservas cuadran en todas las variantes'
                   else v_n || ' variantes no cuadran: stock negativo, distinto de la suma de sus movimientos o con más reservado que existente' end));

  -- ── proveedores de pago ──
  select count(*) into v_n from public.webhook_events w
   where w.received_at > now() - interval '24 hours' and w.outcome in ('rejected', 'review', 'unknown_reference');
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'webhooks.problems',
    'status', case when v_n >= 20 then 'crit' when v_n > 0 then 'warn' else 'ok' end,
    'value', v_n,
    'detail', case when v_n = 0 then 'ningún aviso de pago fue rechazado ni quedó sin pedido en las últimas 24 h'
                   else v_n || ' avisos de pago rechazados, a revisión o sin pedido en las últimas 24 h' end));

  -- ── tamaño ──
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'db.size', 'status', 'ok',
    'value', round(pg_database_size(current_database()) / 1048576.0)::bigint,
    'detail', 'megabytes en uso (compáralo con el tope de tu plan)'));

  select case when bool_or(c ->> 'status' = 'crit') then 'crit' when bool_or(c ->> 'status' = 'warn') then 'warn' else 'ok' end
    into v_status from jsonb_array_elements(v_checks) c;

  return jsonb_build_object('status', v_status, 'generated_at', now(), 'checks', v_checks);
end;
$$;

-- Solo el servicio: ni el navegador ni un administrador la llaman (el panel, si la quiere, la envolverá en su propia función).
revoke all on function public.system_health() from public, anon, authenticated;
grant execute on function public.system_health() to service_role;
