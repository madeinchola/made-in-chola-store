-- Sprint 16 · `public.system_health()`: el informe de salud (cron, avisos, pagos y reservas atascados, stock imposible, webhooks, tamaño).
-- Todo ocurre en una transacción que se revierte. La base de la nube tiene datos de otras pruebas (cientos de avisos pendientes, avisos de
-- pago rechazados…), así que cada caso PARTE DE CERO: neutraliza lo que ya hay (con `session_replication_role = replica`, que apaga las
-- guardas solo aquí) y luego fabrica filas con una antigüedad exacta, a ambos lados de cada umbral (9 y 11 minutos, 14 y 16, 24 y 25 horas…).
begin;
select plan(88);

create temp sequence pg_temp.rid start 9000000000;
set local session_replication_role = replica;

create function pg_temp.chk(p_key text) returns jsonb language sql as $$
  select c from jsonb_array_elements(public.system_health() -> 'checks') c where c ->> 'key' = p_key $$;
create function pg_temp.st(p_key text) returns text language sql as $$ select pg_temp.chk(p_key) ->> 'status' $$;
create function pg_temp.vl(p_key text) returns bigint language sql as $$ select (pg_temp.chk(p_key) ->> 'value')::bigint $$;
create function pg_temp.dt(p_key text) returns text language sql as $$ select pg_temp.chk(p_key) ->> 'detail' $$;
/** Deja UNA corrida de ese trabajo con ese estado, terminada hace `p_ago` (borra las anteriores). */
create function pg_temp.run_at(p_job text, p_status text, p_ago interval) returns void language plpgsql as $$
begin
  delete from cron.job_run_details d using cron.job j where j.jobid = d.jobid and j.jobname = p_job;
  insert into cron.job_run_details (jobid, runid, database, username, command, status, return_message, start_time, end_time)
    select j.jobid, nextval('pg_temp.rid'), 'postgres', 'postgres', j.command, p_status, 'prueba', now() - p_ago, now() - p_ago
      from cron.job j where j.jobname = p_job;
end $$;

-- ═══ A. Forma del informe y permisos ═══════════════════════════════════════════════════════════════════════════════════
select is(
  (select string_agg(c ->> 'key', ', ' order by c ->> 'key') from jsonb_array_elements(public.system_health() -> 'checks') c),
  'cron.abandon-stale-carts, cron.expire-pending-payments, cron.expire-stock-reservations, cron.notify-worker, cron.purge-cron-history, cron.purge-old-carts, cron.purge-stock-reservations, cron.rate_limits_cleanup, cron.remind-expiring-payments, cron.remind-pending-orders, db.size, notify.worker, outbox.backlog, outbox.dead, payments.stuck, reservations.stuck, stock.invariants, webhooks.problems',
  'A1: el informe tiene estas 18 comprobaciones: los 10 trabajos de cron y 8 más');
select is(
  (select count(*)::int from jsonb_array_elements(public.system_health() -> 'checks') c
    where c ->> 'status' in ('ok', 'warn', 'crit') and length(coalesce(c ->> 'detail', '')) > 10 and c ->> 'key' is not null),
  18, 'A2: todas traen un estado válido y un texto que lo explica');
select ok((public.system_health() ->> 'generated_at')::timestamptz > now() - interval '1 minute', 'A3: trae la hora en que se generó');
select is(public.system_health() ->> 'status',
  (select case when bool_or(c ->> 'status' = 'crit') then 'crit' when bool_or(c ->> 'status' = 'warn') then 'warn' else 'ok' end
     from jsonb_array_elements(public.system_health() -> 'checks') c),
  'A4: el estado general es el peor de todos');
select is(has_function_privilege('anon', 'public.system_health()', 'execute'), false, 'A5: un visitante no la ejecuta');
select is(has_function_privilege('authenticated', 'public.system_health()', 'execute'), false, 'A6: ni una clienta ni un administrador desde el navegador');
select is(has_function_privilege('public', 'public.system_health()', 'execute'), false, 'A7: ni el pseudo-rol PUBLIC');
select is(has_function_privilege('service_role', 'public.system_health()', 'execute'), true, 'A8: el servicio sí');

-- ═══ B. Trabajos de cron: la edad de la última corrida BUENA contra su tope, y las corridas que fallan ════════════════
select pg_temp.run_at('expire-stock-reservations', 'succeeded', interval '9 minutes');
select is(pg_temp.st('cron.expire-stock-reservations'), 'ok', 'B1: una corrida buena hace 9 minutos (tope 10) está bien');
select pg_temp.run_at('expire-stock-reservations', 'succeeded', interval '11 minutes');
select is(pg_temp.st('cron.expire-stock-reservations'), 'crit', 'B2: hace 11 minutos (tope 10) es crítico');
select ok(pg_temp.vl('cron.expire-stock-reservations') between 650 and 700, 'B3: y dice cuántos segundos hace (≈ 660)');
select ok(pg_temp.dt('cron.expire-stock-reservations') like '%más de 00:10:00%', 'B4: y cuál es el tope');
-- una corrida que FALLÓ después de una buena reciente: aviso (la buena sigue siendo reciente)
select pg_temp.run_at('expire-stock-reservations', 'succeeded', interval '5 minutes');
insert into cron.job_run_details (jobid, runid, database, username, command, status, return_message, start_time, end_time)
  select j.jobid, nextval('pg_temp.rid'), 'postgres', 'postgres', j.command, 'failed', 'boom', now() - interval '1 minute', now() - interval '1 minute'
    from cron.job j where j.jobname = 'expire-stock-reservations';
select is(pg_temp.st('cron.expire-stock-reservations'), 'warn', 'B5: la última corrida falló pero hubo una buena hace 5 minutos: aviso');
select ok(pg_temp.dt('cron.expire-stock-reservations') like '%falló%', 'B6: y el texto lo dice');
-- una corrida buena vieja Y una fallida reciente: crítico (manda lo viejo)
select pg_temp.run_at('expire-stock-reservations', 'succeeded', interval '30 minutes');
insert into cron.job_run_details (jobid, runid, database, username, command, status, return_message, start_time, end_time)
  select j.jobid, nextval('pg_temp.rid'), 'postgres', 'postgres', j.command, 'failed', 'boom', now() - interval '1 minute', now() - interval '1 minute'
    from cron.job j where j.jobname = 'expire-stock-reservations';
select is(pg_temp.st('cron.expire-stock-reservations'), 'crit', 'B7: la última buena hace 30 minutos y una falla reciente: crítico');
-- un trabajo que nunca terminó una corrida: aviso (puede ser recién programado)
delete from cron.job_run_details d using cron.job j where j.jobid = d.jobid and j.jobname = 'purge-cron-history';
select is(pg_temp.st('cron.purge-cron-history'), 'warn', 'B8: un trabajo sin ninguna corrida es un aviso, no un fallo');
select is(pg_temp.vl('cron.purge-cron-history'), null, 'B9: y no inventa una edad');
-- solo cuentan las corridas SUCCEEDED: una corrida «running» o «failed» sola no vale como «buena»
delete from cron.job_run_details d using cron.job j where j.jobid = d.jobid and j.jobname = 'purge-cron-history';
insert into cron.job_run_details (jobid, runid, database, username, command, status, return_message, start_time, end_time)
  select j.jobid, nextval('pg_temp.rid'), 'postgres', 'postgres', j.command, 'failed', 'boom', now() - interval '1 minute', now() - interval '1 minute'
    from cron.job j where j.jobname = 'purge-cron-history';
select is(pg_temp.st('cron.purge-cron-history'), 'warn', 'B10: solo una corrida fallida: aún sin ninguna buena');

-- los topes de cada familia de trabajos: 10 minutos, 45 minutos, 130 minutos y 26 horas
select pg_temp.run_at('remind-expiring-payments', 'succeeded', interval '44 minutes');
select is(pg_temp.st('cron.remind-expiring-payments'), 'ok', 'B11: recordatorios de cobro (cada 15 min): hace 44 minutos está bien');
select pg_temp.run_at('remind-expiring-payments', 'succeeded', interval '46 minutes');
select is(pg_temp.st('cron.remind-expiring-payments'), 'crit', 'B12: …hace 46 minutos es crítico (tope 45)');
select pg_temp.run_at('remind-pending-orders', 'succeeded', interval '129 minutes');
select is(pg_temp.st('cron.remind-pending-orders'), 'ok', 'B13: recordatorios de pedidos (cada hora): hace 129 minutos está bien');
select pg_temp.run_at('remind-pending-orders', 'succeeded', interval '131 minutes');
select is(pg_temp.st('cron.remind-pending-orders'), 'crit', 'B14: …hace 131 minutos es crítico (tope 130)');
select pg_temp.run_at('purge-old-carts', 'succeeded', interval '25 hours');
select is(pg_temp.st('cron.purge-old-carts'), 'ok', 'B15: limpieza diaria: hace 25 horas está bien');
select pg_temp.run_at('purge-old-carts', 'succeeded', interval '27 hours');
select is(pg_temp.st('cron.purge-old-carts'), 'crit', 'B16: …hace 27 horas es crítico (tope 26)');
select pg_temp.run_at('expire-pending-payments', 'succeeded', interval '11 minutes');
select is(pg_temp.st('cron.expire-pending-payments'), 'crit', 'B17: el vencimiento de cobros (cada minuto) tiene el mismo tope de 10 minutos');
select pg_temp.run_at('notify-worker', 'succeeded', interval '11 minutes');
select is(pg_temp.st('cron.notify-worker'), 'crit', 'B18: el trabajador de avisos también');

-- un trabajo que no existe (o está apagado) es crítico: sin él, lo que hacía no se hace nunca
select cron.unschedule('purge-cron-history');
select is(pg_temp.st('cron.purge-cron-history'), 'crit', 'B19: un trabajo que no existe es crítico (no «aún no corrió»)');
select ok(pg_temp.dt('cron.purge-cron-history') like '%no existe o está apagado%', 'B20: y el texto lo dice');
select cron.schedule('purge-cron-history', '41 3 * * *', $c$delete from cron.job_run_details where end_time < now() - interval '14 days'$c$);

-- ═══ C. Avisos: lo que espera de más y lo que se perdió ═════════════════════════════════════════════════════════════════
update public.notification_outbox set status = 'cancelled' where status in ('pending', 'failed', 'sending');
update public.notification_outbox set updated_at = now() - interval '72 hours' where status = 'dead';
create function pg_temp.msg(p_status text, p_created interval, p_retry interval default null, p_updated interval default interval '0') returns void language sql as $$
  insert into public.notification_outbox (type, channel, recipient, payload, status, dedupe_key, created_at, next_retry_at, updated_at)
  values ('prueba', 'email', 'a@b.co', '{}'::jsonb, p_status, 'salud-' || gen_random_uuid()::text, now() - p_created,
          now() - coalesce(p_retry, p_created), now() - p_updated) $$;

select is(pg_temp.st('outbox.backlog'), 'ok', 'C1: sin avisos esperando, está bien');
select is(pg_temp.vl('outbox.backlog'), 0::bigint, 'C2: y cuenta cero');
select pg_temp.msg('pending', interval '14 minutes');
select is(pg_temp.vl('outbox.backlog'), 0::bigint, 'C3: un aviso pendiente de hace 14 minutos todavía no cuenta (tope 15)');
select pg_temp.msg('pending', interval '16 minutes');
select is(pg_temp.vl('outbox.backlog'), 1::bigint, 'C4: uno de hace 16 minutos sí');
select is(pg_temp.st('outbox.backlog'), 'warn', 'C5: uno solo es un aviso');
select pg_temp.msg('failed', interval '3 hours', interval '16 minutes');
select pg_temp.msg('failed', interval '3 hours', interval '-20 minutes');
select pg_temp.msg('sent', interval '5 hours');
select pg_temp.msg('dead', interval '5 hours', null, interval '72 hours');
select is(pg_temp.vl('outbox.backlog'), 2::bigint, 'C6: un fallido cuyo reintento ya tocaba cuenta; uno con el reintento en el futuro, uno enviado y uno perdido no');
select is(pg_temp.st('outbox.backlog'), 'warn', 'C7: dos pendientes de hace poco: aviso');
-- el más viejo pasa de 3 horas: crítico
select pg_temp.msg('pending', interval '4 hours');
select is(pg_temp.st('outbox.backlog'), 'crit', 'C8: un pendiente de hace más de 3 horas es crítico');
-- 50 pendientes: crítico por cantidad (se limpia el viejo antes)
update public.notification_outbox set status = 'cancelled' where status in ('pending', 'failed');
insert into public.notification_outbox (type, channel, recipient, payload, status, dedupe_key, created_at)
  select 'prueba', 'email', 'a@b.co', '{}'::jsonb, 'pending', 'salud-n-' || g, now() - interval '20 minutes' from generate_series(1, 49) g;
update public.notification_outbox set next_retry_at = created_at where dedupe_key like 'salud-n-%';
select is(pg_temp.st('outbox.backlog'), 'warn', 'C9: 49 pendientes recientes: aviso');
select pg_temp.msg('pending', interval '20 minutes');
select is(pg_temp.st('outbox.backlog'), 'crit', 'C10: 50 pendientes: crítico');
-- el texto dice POR QUÉ puede estar pasando
update public.store_settings set value = '"none"'::jsonb where key = 'notify_email_provider';
update public.store_settings set value = 'false'::jsonb where key = 'notify_enabled';
select ok(pg_temp.dt('outbox.backlog') like '%notify_email_provider = none%' and pg_temp.dt('outbox.backlog') like '%notify_enabled%',
  'C11: si no hay proveedor de correo o las notificaciones están apagadas, el texto lo dice');
update public.store_settings set value = '"fake"'::jsonb where key = 'notify_email_provider';
update public.store_settings set value = 'true'::jsonb where key = 'notify_enabled';
select ok(pg_temp.dt('outbox.backlog') not like '%notify_email_provider%' and pg_temp.dt('outbox.backlog') not like '%notify_enabled%',
  'C12: y con proveedor y notificaciones encendidas no culpa a ninguno');

-- el cron llama al worker solo si el vault tiene su dirección y su clave
delete from vault.secrets where name in ('notify_worker_url', 'notify_worker_key');
update public.store_settings set value = 'true'::jsonb where key = 'notify_enabled';
select is(pg_temp.st('notify.worker'), 'warn', 'W1: sin los secretos del vault, el worker no se llama: aviso');
select ok(pg_temp.dt('notify.worker') like '%faltan 2 de los 2 secretos%' and pg_temp.dt('notify.worker') like '%notify_worker_key%', 'W2: y el texto dice cuáles faltan');
select vault.create_secret('https://ejemplo.supabase.co/functions/v1/notify-worker', 'notify_worker_url');
select ok(pg_temp.st('notify.worker') = 'warn' and pg_temp.dt('notify.worker') like '%faltan 1 de los 2%', 'W3: con solo la dirección sigue faltando la clave: aviso');
select vault.create_secret('clave-de-prueba', 'notify_worker_key');
select is(pg_temp.st('notify.worker'), 'ok', 'W4: con los dos secretos, el cron puede llamar al worker');
delete from vault.secrets where name in ('notify_worker_url', 'notify_worker_key');
update public.store_settings set value = 'false'::jsonb where key = 'notify_enabled';
select is(pg_temp.st('notify.worker'), 'ok', 'W5: con las notificaciones apagadas a propósito, que falten los secretos no es un problema');
update public.store_settings set value = 'true'::jsonb where key = 'notify_enabled';
select is(pg_temp.vl('notify.worker'), 0::bigint, 'W6: y el valor es cuántos secretos hay (0)');

select is(pg_temp.st('outbox.dead'), 'ok', 'C13: sin avisos perdidos recientes, está bien');
select pg_temp.msg('failed', interval '2 days', interval '-1 hour', interval '1 hour');
select is(pg_temp.vl('outbox.dead'), 0::bigint, 'C13b: un aviso fallido con su reintento pendiente (actualizado hace 1 hora) NO es un aviso perdido');
select pg_temp.msg('dead', interval '2 days', null, interval '25 hours');
select is(pg_temp.vl('outbox.dead'), 0::bigint, 'C14: uno perdido hace 25 horas ya no cuenta');
select pg_temp.msg('dead', interval '2 days', null, interval '23 hours');
select is(pg_temp.vl('outbox.dead'), 1::bigint, 'C15: uno perdido hace 23 horas sí');
select is(pg_temp.st('outbox.dead'), 'warn', 'C16: un perdido es un aviso');
insert into public.notification_outbox (type, channel, recipient, payload, status, dedupe_key, updated_at)
  select 'prueba', 'email', 'a@b.co', '{}'::jsonb, 'dead', 'salud-d-' || g, now() - interval '1 hour' from generate_series(1, 8) g;
select is(pg_temp.st('outbox.dead'), 'warn', 'C17: 9 perdidos siguen siendo un aviso');
select pg_temp.msg('dead', interval '2 days', null, interval '1 hour');
select is(pg_temp.st('outbox.dead'), 'crit', 'C18: 10 perdidos: crítico');

-- ═══ D. Cobros y reservas que el cron debía cerrar ═════════════════════════════════════════════════════════════════════
update public.payments set status = 'expired' where status = 'pending' and expires_at < now();
create function pg_temp.pay(p_status text, p_expires interval) returns void language sql as $$
  insert into public.payments (order_id, provider, method, amount, currency, status, expires_at)
  values (gen_random_uuid(), 'manual_qr', 'qr_manual', 10, 'BOB', p_status, case when p_expires is null then null else now() - p_expires end) $$;
select is(pg_temp.st('payments.stuck'), 'ok', 'D1: sin cobros atascados, está bien');
select pg_temp.pay('pending', interval '9 minutes');
select is(pg_temp.vl('payments.stuck'), 0::bigint, 'D2: un cobro pendiente vencido hace 9 minutos aún no cuenta (el cron corre cada minuto; tope 10)');
select pg_temp.pay('pending', interval '11 minutes');
select is(pg_temp.vl('payments.stuck'), 1::bigint, 'D3: uno vencido hace 11 minutos sí');
select is(pg_temp.st('payments.stuck'), 'crit', 'D4: y es crítico');
select pg_temp.pay('expired', interval '3 hours');
select pg_temp.pay('paid', interval '3 hours');
select pg_temp.pay('pending', null);
select is(pg_temp.vl('payments.stuck'), 1::bigint, 'D5: uno ya vencido, uno pagado y uno sin ventana no cuentan');

update public.stock_reservations set status = 'expired' where status = 'active' and expires_at < now();
create function pg_temp.res(p_status text, p_expires interval) returns void language sql as $$
  insert into public.stock_reservations (variant_id, qty, owner_type, owner_id, status, expires_at)
  values (gen_random_uuid(), 1, 'order', gen_random_uuid(), p_status, case when p_expires is null then null else now() - p_expires end) $$;
select is(pg_temp.st('reservations.stuck'), 'ok', 'D6: sin reservas atascadas, está bien');
select pg_temp.res('active', interval '9 minutes');
select is(pg_temp.vl('reservations.stuck'), 0::bigint, 'D7: una reserva activa vencida hace 9 minutos aún no cuenta');
select pg_temp.res('active', interval '11 minutes');
select is(pg_temp.vl('reservations.stuck'), 1::bigint, 'D8: una vencida hace 11 minutos sí');
select is(pg_temp.st('reservations.stuck'), 'crit', 'D9: y es crítico');
select pg_temp.res('expired', interval '3 hours');
select pg_temp.res('released', interval '3 hours');
select pg_temp.res('active', null);
select is(pg_temp.vl('reservations.stuck'), 1::bigint, 'D10: una ya expirada, una liberada y una sin plazo no cuentan');

-- ═══ E. Lo imposible: el stock cuadra con el libro de movimientos, nunca es negativo y no hay más reservado que existente ════
-- se parte de cero: el stock de cada variante = la suma de sus movimientos y ninguna reserva activa
update public.product_variants v set stock_on_hand = coalesce((select sum(m.delta) from public.stock_movements m where m.variant_id = v.id), 0);
update public.stock_reservations set status = 'released' where status = 'active';
alter table public.product_variants drop constraint product_variants_stock_on_hand_check;   -- solo en esta transacción: para fabricar el caso imposible
alter table public.stock_movements drop constraint stock_movements_stock_after_check;
create function pg_temp.variant(p_sku text, p_stock int, p_moves int[]) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.product_variants (product_id, color_id, sku, stock_on_hand) values (gen_random_uuid(), gen_random_uuid(), p_sku, p_stock) returning id into v_id;
  insert into public.stock_movements (variant_id, delta, reason, stock_after) select v_id, m, 'adjust', 0 from unnest(p_moves) m;
  return v_id;
end $$;
select is(pg_temp.st('stock.invariants'), 'ok', 'E1: con todo cuadrado, está bien');
select pg_temp.variant('SALUD-SIN-MOV', 0, '{}');
select pg_temp.variant('SALUD-OK', 5, '{3,2}');
select is(pg_temp.vl('stock.invariants'), 0::bigint, 'E2: una variante sin movimientos con stock 0 y otra cuyo stock es la suma de sus movimientos (3 + 2) cuadran');
select pg_temp.variant('SALUD-DE-MAS', 6, '{3,2}');
select is(pg_temp.vl('stock.invariants'), 1::bigint, 'E3: un stock de 6 con movimientos que suman 5 NO cuadra');
select pg_temp.variant('SALUD-DE-MENOS', 4, '{3,2}');
select is(pg_temp.vl('stock.invariants'), 2::bigint, 'E4: un stock de 4 con movimientos que suman 5 tampoco');
select pg_temp.variant('SALUD-SIN-LIBRO', 3, '{}');
select is(pg_temp.vl('stock.invariants'), 3::bigint, 'E5: stock 3 sin ningún movimiento tampoco (alguien lo escribió sin dejar rastro)');
select pg_temp.variant('SALUD-NEG', -1, '{-1}');
select is(pg_temp.vl('stock.invariants'), 4::bigint, 'E6: un stock de −1, aunque coincida con su movimiento, es imposible');
-- reservas: más reservado que existente
create function pg_temp.reserve(p_variant uuid, p_qty int, p_status text, p_expires interval) returns void language sql as $$
  insert into public.stock_reservations (variant_id, qty, owner_type, owner_id, status, expires_at)
  values (p_variant, p_qty, 'order', gen_random_uuid(), p_status, now() + p_expires) $$;
select pg_temp.reserve((select id from public.product_variants where sku = 'SALUD-OK'), 5, 'active', interval '1 hour');
select is(pg_temp.vl('stock.invariants'), 4::bigint, 'E7: reservar exactamente lo que hay (5 de 5) es posible');
select pg_temp.reserve((select id from public.product_variants where sku = 'SALUD-OK'), 1, 'active', interval '1 hour');
select is(pg_temp.vl('stock.invariants'), 5::bigint, 'E8: reservar 6 de 5 no');
select pg_temp.reserve((select id from public.product_variants where sku = 'SALUD-SIN-MOV'), 2, 'active', interval '-1 hour');
select pg_temp.reserve((select id from public.product_variants where sku = 'SALUD-SIN-MOV'), 2, 'released', interval '1 hour');
select is(pg_temp.vl('stock.invariants'), 5::bigint, 'E9: una reserva ya vencida y una liberada no cuentan');
select is(pg_temp.st('stock.invariants'), 'crit', 'E10: y cualquiera de estos casos es crítico');

-- ═══ F. Avisos de los proveedores de pago ═════════════════════════════════════════════════════════════════════════════
update public.webhook_events set received_at = now() - interval '72 hours';
create function pg_temp.wh(p_outcome text, p_ago interval, p_n int default 1) returns void language sql as $$
  insert into public.webhook_events (provider, signature_valid, outcome, received_at)
  select 'fake', true, p_outcome, now() - p_ago from generate_series(1, p_n) $$;
select is(pg_temp.st('webhooks.problems'), 'ok', 'F1: sin problemas recientes, está bien');
select pg_temp.wh('applied', interval '1 hour');
select pg_temp.wh('duplicate', interval '1 hour');
select pg_temp.wh('ignored', interval '1 hour');
select is(pg_temp.vl('webhooks.problems'), 0::bigint, 'F2: aplicados, repetidos e ignorados no son problemas');
select pg_temp.wh('rejected', interval '1 hour');
select pg_temp.wh('review', interval '1 hour');
select pg_temp.wh('unknown_reference', interval '1 hour');
select is(pg_temp.vl('webhooks.problems'), 3::bigint, 'F3: rechazados, a revisión y sin pedido sí');
select is(pg_temp.st('webhooks.problems'), 'warn', 'F4: tres son un aviso');
select pg_temp.wh('rejected', interval '25 hours');
select is(pg_temp.vl('webhooks.problems'), 3::bigint, 'F5: uno de hace 25 horas ya no cuenta');
select pg_temp.wh('rejected', interval '23 hours', 16);
select is(pg_temp.st('webhooks.problems'), 'warn', 'F6: 19 siguen siendo un aviso');
select pg_temp.wh('rejected', interval '23 hours');
select is(pg_temp.st('webhooks.problems'), 'crit', 'F7: 20 son críticos (una avalancha de firmas falsas o de avisos sin pedido)');

-- ═══ G. Tamaño ══════════════════════════════════════════════════════════════════════════════════════════════════════════
select ok(pg_temp.vl('db.size') > 0 and pg_temp.st('db.size') = 'ok', 'G1: el tamaño de la base es informativo y siempre «ok»');

-- ═══ H. El estado general: «ok» solo si TODO está bien; «warn» si hay avisos y ninguno crítico; «crit» si alguno lo es ═══════
-- se deja todo en orden: avisos, cobros, reservas, stock, avisos de pago, notificaciones apagadas a propósito y los 10 trabajos recién corridos
update public.notification_outbox set status = 'cancelled' where status in ('pending', 'failed', 'sending');
update public.notification_outbox set updated_at = now() - interval '72 hours' where status = 'dead';
update public.payments set status = 'expired' where status = 'pending';
update public.stock_reservations set status = 'released' where status = 'active';
update public.webhook_events set received_at = now() - interval '72 hours';
delete from public.stock_movements where variant_id in (select id from public.product_variants where sku like 'SALUD-%');
delete from public.product_variants where sku like 'SALUD-%';
update public.store_settings set value = 'false'::jsonb where key = 'notify_enabled';
select pg_temp.run_at(j, 'succeeded', interval '1 minute') from unnest(array['abandon-stale-carts', 'expire-pending-payments', 'expire-stock-reservations', 'notify-worker', 'purge-cron-history', 'purge-old-carts', 'purge-stock-reservations', 'rate_limits_cleanup', 'remind-expiring-payments', 'remind-pending-orders']) j;
select is(public.system_health() ->> 'status', 'ok', 'H1: con todo en orden el estado general es «ok»');
select is((select count(*)::int from jsonb_array_elements(public.system_health() -> 'checks') c where c ->> 'status' <> 'ok'), 0, 'H2: y ninguna comprobación está en aviso ni en crítico');
select pg_temp.msg('dead', interval '2 days', null, interval '1 hour');
select is(public.system_health() ->> 'status', 'warn', 'H3: con solo un aviso (un aviso perdido) el estado general es «warn»');
select pg_temp.pay('pending', interval '11 minutes');
select is(public.system_health() ->> 'status', 'crit', 'H4: con además un cobro atascado es «crit» (manda lo peor)');
update public.payments set status = 'expired' where status = 'pending';
select is(public.system_health() ->> 'status', 'warn', 'H5: al resolver lo crítico vuelve a «warn»');
select pg_temp.run_at('remind-pending-orders', 'succeeded', interval '131 minutes');
select is(public.system_health() ->> 'status', 'crit', 'H6: un trabajo de cron atrasado también es «crit»');
update public.notification_outbox set updated_at = now() - interval '72 hours' where status = 'dead';
select pg_temp.run_at('remind-pending-orders', 'succeeded', interval '1 minute');
select is(public.system_health() ->> 'status', 'ok', 'H7: y todo resuelto vuelve a «ok»');

select * from finish();
rollback;
