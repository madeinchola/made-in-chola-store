-- Sprint 11 · Pagos: QR boliviano (manual con comprobante y por aviso firmado), vencimiento, reintentos, conciliación y
-- revisión manual. Todo lo que mueve dinero es idempotente y deja rastro:
--   · `payment_apply_event` es el ÚNICO camino por el que un aviso de pago (webhook o aprobación del admin) cambia un cobro.
--   · Los comprobantes viven en un bucket PRIVADO; la clienta sube a su ruta y no puede cambiar ni borrar lo subido.
--   · Un pago que no se puede aplicar solo (monto distinto, duplicado, tardío, contracargo) NO se pierde: abre una revisión.
-- Rollback (manual, orden inverso):
--   select cron.unschedule('remind-expiring-payments'); select cron.unschedule('expire-pending-payments');
--   select cron.schedule('expire-unconfirmed-orders', '*/5 * * * *', 'select public.expire_unconfirmed_orders()');  -- como en S10
--   drop function public.remind_expiring_payments(), public.expire_pending_payments(), public.payment_retry(uuid, uuid),
--     public.customer_payment_view(uuid), public.admin_resolve_review(uuid, text), public.admin_confirm_payment_manual(uuid, numeric, text),
--     public.admin_review_proof(uuid, text, text, numeric), public.payment_proof_register(uuid, uuid, text, text, text, int),
--     public.payment_log_invalid_event(text, text, jsonb), public.payment_apply_event(text, text, text, text, numeric, text, text, jsonb, uuid),
--     public._payment_open_review(uuid, text, jsonb), public._payment_alert(text, jsonb, text), public.payment_proof_path_ok(text),
--     public.payments_before_insert(), public.store_settings_validate_s11();
--   drop table public.payment_reviews, public.webhook_events, public.payment_proofs;
--   alter table public.payments drop column reference, drop column external_id, drop column expires_at, drop column received_amount,
--     drop column paid_at, drop column reminder_sent_at;  -- y volver a poner transition_order_status / orders_guard / _order_transition_ok de S10
--   delete from public.payment_methods where code in ('qr_manual', 'qr_auto');
--   delete from public.store_settings where key in ('payment_reminder_hours', 'payment_proofs_max');
--   los buckets payment-proofs y payment-qr se vacían y borran desde el panel o la API de Storage.

-- ── 1. Ajustes ──────────────────────────────────────────────────────────────────────────────
insert into public.store_settings (key, value, value_type, is_public, description) values
  ('payment_reminder_hours', '6', 'int', false,
   'Horas antes de que venza la ventana de pago en que se le recuerda a la clienta que le falta pagar (0 = sin recordatorio)'),
  ('payment_proofs_max', '5', 'int', false,
   'Comprobantes que se pueden subir por intento de pago: evita saturar la bandeja del administrador y subir archivos sin fin')
on conflict (key) do nothing;

create or replace function public.store_settings_validate_s11()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_text text := new.value #>> '{}';
begin
  if new.value_type <> 'int' or v_text !~ '^[0-9]{1,9}$' then
    return new;
  end if;
  if (new.key = 'payment_reminder_hours' and v_text::int > 720)
     or (new.key = 'payment_proofs_max' and (v_text::int < 1 or v_text::int > 20)) then
    raise exception 'el ajuste "%" está fuera de rango', new.key using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists store_settings_validate_s11_trg on public.store_settings;
create trigger store_settings_validate_s11_trg before insert or update on public.store_settings
  for each row when (new.key in ('payment_reminder_hours', 'payment_proofs_max')) execute function public.store_settings_validate_s11();

-- ── 2. Rutas de Storage ─────────────────────────────────────────────────────────────────────
-- `storage_path_ok` (S2) gana el bucket del QR de la tienda. Las demás ramas quedan IGUAL.
create or replace function public.storage_path_ok(p_bucket text, p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_bucket
    when 'product-images' then p_name ~ '^products/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|avif)$'
    when 'site-media'     then p_name ~ '^home/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|avif)$'
    when 'site-videos'    then p_name ~ '^home/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|webm)$'
    when 'payment-qr'     then p_name ~ '^qr/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
    else false
  end
$$;

-- ── 3. Métodos de pago: datos de la cuenta y QR ─────────────────────────────────────────────
alter table public.payment_methods
  add column if not exists account_details text
    check (account_details is null or char_length(btrim(account_details)) between 1 and 500),
  add column if not exists qr_image_path text
    check (qr_image_path is null or public.storage_path_ok('payment-qr', qr_image_path));

-- Proveedores IMPLEMENTADOS (la Edge Function los conoce): S10 whatsapp y contra entrega; S11 el QR manual y el QR con aviso.
alter table public.payment_methods drop constraint if exists payment_methods_provider_supported;
alter table public.payment_methods add constraint payment_methods_provider_supported
  check (provider in ('whatsapp', 'cash_on_delivery', 'manual_qr', 'qr_api'));

-- Un método QR necesita ventana de pago, y no puede estar ACTIVO sin lo que la clienta necesita para pagar (el QR y a quién).
alter table public.payment_methods drop constraint if exists payment_methods_qr_window;
alter table public.payment_methods add constraint payment_methods_qr_window
  check (provider not in ('manual_qr', 'qr_api') or window_minutes is not null);
alter table public.payment_methods drop constraint if exists payment_methods_qr_ready;
alter table public.payment_methods add constraint payment_methods_qr_ready
  check (provider not in ('manual_qr', 'qr_api') or not is_active or archived_at is not null
         or (qr_image_path is not null and account_details is not null));

select public._apply_admin_rls('payment_methods',
  array['country', 'code', 'provider', 'name', 'description', 'is_active', 'sort_order', 'max_amount', 'window_minutes',
        'blocked_for_blacklisted', 'account_details', 'qr_image_path'],
  array['name', 'description', 'is_active', 'sort_order', 'max_amount', 'window_minutes', 'blocked_for_blacklisted',
        'archived_at', 'account_details', 'qr_image_path']);

-- Valores de EJEMPLO (BO), apagados: el dueño sube su QR y escribe sus datos desde el panel y los enciende. La ventana es de
-- 24 horas (decisión del dueño, 2026-10-28; sustituye a los 10 minutos de BR-PAY-03).
insert into public.payment_methods (country, code, provider, name, description, sort_order, window_minutes, is_active)
values
  ('BO', 'qr_manual', 'manual_qr', 'Pago con QR (ejemplo)',
   'Escaneas el QR con la app de tu banco, pagas el monto exacto y subes la foto del comprobante.', 5, 1440, false),
  ('BO', 'qr_auto', 'qr_api', 'Pago con QR, confirmación automática (ejemplo)',
   'Escaneas el QR con la app de tu banco y pagas el monto exacto: se confirma solo.', 6, 1440, false)
on conflict (country, code) do nothing;

-- ── 4. Cobros (payments) ────────────────────────────────────────────────────────────────────
alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check
  check (status in ('initiated', 'pending', 'paid', 'failed', 'cancelled', 'expired', 'refunded', 'disputed'));
alter table public.payments
  add column if not exists attempt          smallint not null default 1 check (attempt between 1 and 99),
  add column if not exists reference        text,
  add column if not exists external_id      text,
  add column if not exists expires_at       timestamptz,
  add column if not exists received_amount  numeric check (received_amount is null or received_amount >= 0),
  add column if not exists paid_at          timestamptz,
  add column if not exists reminder_sent_at timestamptz;
alter table public.payments drop constraint if exists payments_reference_format;
alter table public.payments add constraint payments_reference_format
  check (reference is null or reference ~ '^[A-Z]{2,5}-[0-9]{6,}(-[0-9]{1,3})?$');
alter table public.payments drop constraint if exists payments_external_id_len;
alter table public.payments add constraint payments_external_id_len
  check (external_id is null or char_length(external_id) <= 200);

-- La referencia que la clienta escribe al pagar y por la que el banco o el proveedor avisa: única por cobro. El primer cobro de
-- un pedido usa su número (MIC-000123); los reintentos suman -2, -3…
update public.payments p set attempt = r.rn::smallint, reference = o.number || case when r.rn > 1 then '-' || r.rn::text else '' end
  from (select id, order_id, row_number() over (partition by order_id order by created_at, id) as rn from public.payments) r
  join public.orders o on o.id = r.order_id
 where p.id = r.id and p.reference is null;
update public.payments p set expires_at = o.payment_expires_at
  from public.orders o where o.id = p.order_id and p.expires_at is null and o.payment_expires_at is not null;
create unique index if not exists payments_reference_key on public.payments (reference);
create unique index if not exists payments_order_attempt_key on public.payments (order_id, attempt);
-- UN cobro abierto por pedido: la concurrencia no puede dejar dos intentos vivos.
create unique index if not exists payments_one_open_per_order on public.payments (order_id) where status in ('initiated', 'pending');
create index if not exists payments_status_expires_idx on public.payments (status, expires_at);

create or replace function public.payments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  n int;
begin
  select x.number, x.payment_expires_at into o from public.orders x where x.id = new.order_id;
  -- El número de intento es el siguiente al más alto del pedido (el pedido está bloqueado por quien inserta).
  select coalesce(max(p.attempt), 0) into n from public.payments p where p.order_id = new.order_id;
  new.attempt := n + 1;
  if new.reference is null then
    new.reference := o.number || case when n > 0 then '-' || (n + 1)::text else '' end;
  end if;
  if new.expires_at is null then
    new.expires_at := o.payment_expires_at;
  end if;
  return new;
end;
$$;
drop trigger if exists payments_before_insert_trg on public.payments;
create trigger payments_before_insert_trg before insert on public.payments
  for each row execute function public.payments_before_insert();

-- ── 5. Comprobantes, avisos recibidos y revisiones ──────────────────────────────────────────
create table if not exists public.payment_proofs (
  id           uuid primary key default gen_random_uuid(),
  payment_id   uuid not null references public.payments (id) on delete restrict,
  order_id     uuid not null references public.orders (id) on delete restrict,
  profile_id   uuid not null references public.profiles (id) on delete restrict,
  file_path    text not null unique check (file_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|pdf)$'),
  file_hash    text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  mime         text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes   int not null check (size_bytes between 1 and 5242880),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reason       text check (reason is null or char_length(btrim(reason)) between 1 and 300),
  -- Otro comprobante con el MISMO archivo ya subido para otro cobro (reutilizado): el admin lo ve marcado.
  duplicate_of uuid references public.payment_proofs (id),
  received_amount numeric check (received_amount is null or received_amount >= 0),
  reviewed_by  uuid references public.profiles (id),
  reviewed_at  timestamptz,
  -- clock_timestamp(): dos comprobantes de una misma transacción no empatan (el «último» comprobante es único).
  created_at   timestamptz not null default clock_timestamp(),
  constraint payment_proofs_reviewed_coherent check ((status = 'pending') = (reviewed_at is null)),
  constraint payment_proofs_reject_reason check (status <> 'rejected' or reason is not null)
);
alter table public.payment_proofs alter column created_at set default clock_timestamp();
create index if not exists payment_proofs_status_idx on public.payment_proofs (status, created_at);
create index if not exists payment_proofs_payment_idx on public.payment_proofs (payment_id);
create index if not exists payment_proofs_hash_idx on public.payment_proofs (file_hash);
-- A lo sumo UN comprobante pendiente por cobro (dos subidas a la vez: gana una).
create unique index if not exists payment_proofs_one_pending on public.payment_proofs (payment_id) where status = 'pending';

create table if not exists public.webhook_events (
  id              bigint generated always as identity primary key,
  provider        text not null check (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  event_id        text check (event_id is null or char_length(event_id) between 1 and 200),
  signature_valid boolean not null,
  payload         jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 20000),
  outcome         text check (outcome is null or outcome in
                    ('applied', 'duplicate', 'review', 'ignored', 'unknown_reference', 'rejected')),
  error           text check (error is null or char_length(error) <= 300),
  payment_id      uuid references public.payments (id) on delete restrict,
  attempts        int not null default 1,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz
);
-- Idempotencia: el mismo evento (con firma válida) solo existe una vez.
create unique index if not exists webhook_events_provider_event_key on public.webhook_events (provider, event_id)
  where signature_valid and event_id is not null;
create index if not exists webhook_events_received_idx on public.webhook_events (received_at desc);

create table if not exists public.payment_reviews (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null references public.payments (id) on delete restrict,
  reason      text not null check (reason in ('late', 'duplicate', 'amount_mismatch', 'disputed', 'provider_refund')),
  detail      jsonb not null default '{}'::jsonb,
  status      text not null default 'open' check (status in ('open', 'resolved')),
  note        text check (note is null or char_length(btrim(note)) between 1 and 500),
  opened_at   timestamptz not null default now(),
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  constraint payment_reviews_resolved_coherent check ((status = 'resolved') = (resolved_at is not null))
);
create unique index if not exists payment_reviews_open_key on public.payment_reviews (payment_id, reason) where status = 'open';
create index if not exists payment_reviews_status_idx on public.payment_reviews (status, opened_at);

-- Solo el administrador LEE estas tablas (la clienta se entera por `customer_payment_view`); nadie escribe desde el navegador
-- ni siquiera con service_role: solo las funciones.
select public._apply_admin_rls('payment_proofs', null, null);
select public._apply_admin_rls('webhook_events', null, null);
select public._apply_admin_rls('payment_reviews', null, null);
revoke insert, update on public.payment_proofs, public.webhook_events, public.payment_reviews, public.payments from service_role;

drop trigger if exists audit_payment_proofs on public.payment_proofs;
create trigger audit_payment_proofs after insert or update or delete on public.payment_proofs
  for each row execute function public.audit_changes();
drop trigger if exists audit_payment_reviews on public.payment_reviews;
create trigger audit_payment_reviews after insert or update or delete on public.payment_reviews
  for each row execute function public.audit_changes();

-- ── 6. Transiciones: el sistema también confirma pagos; cancelar cierra cobros y comprobantes ──
create or replace function public._order_transition_ok(p_from text, p_to text, p_actor_kind text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_actor_kind
    when 'admin' then (p_from, p_to) in (
      ('pending_payment', 'paid'), ('pending_payment', 'cancelled'), ('paid', 'preparing'), ('paid', 'cancelled'),
      ('preparing', 'shipped'), ('preparing', 'cancelled'), ('shipped', 'delivered'), ('delivered', 'completed'),
      ('cancelled', 'refunded'))
    when 'customer' then p_to = 'cancelled' and p_from in ('pending_payment', 'paid')
    -- El sistema vence pedidos sin pagar y CONFIRMA los pagos que el proveedor avisa (S11).
    when 'system' then (p_from, p_to) in (('pending_payment', 'cancelled'), ('pending_payment', 'paid'))
    else false end
$$;

-- `payment_expires_at` cambia al reintentar el pago (nueva ventana): deja de ser parte de la instantánea.
create or replace function public.orders_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- `cart_id` también: `on delete set null` actualiza la fila cuando un pgTAP antiguo borra carritos (no es un cambio del pedido).
  v_free text[] := array['status', 'updated_at', 'paid_at', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'reminder_sent_at',
                         'cart_id', 'payment_expires_at'];
begin
  if tg_op = 'DELETE' then
    raise exception 'los pedidos no se borran' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and coalesce(current_setting('app.order_transition', true), '') <> '1' then
    raise exception 'el estado del pedido solo cambia con transition_order_status' using errcode = '42501';
  end if;
  if (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
    raise exception 'el pedido es una instantánea: solo cambian su estado y sus fechas' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.transition_order_status(
  p_order_id uuid, p_to text, p_actor uuid, p_actor_kind text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  r record;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 300);
begin
  if p_actor_kind not in ('customer', 'admin', 'system') or p_to is null then
    raise exception 'transición inválida' using errcode = '22023';
  end if;
  select * into o from public.orders x where x.id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  if not public._order_transition_ok(o.status, p_to, p_actor_kind) then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_transition', 'from', o.status, 'to', p_to);
  end if;

  perform set_config('app.order_transition', '1', true);
  update public.orders set status = p_to, updated_at = now(),
         paid_at = case when p_to = 'paid' then now() else paid_at end,
         cancelled_at = case when p_to = 'cancelled' then now() else cancelled_at end,
         cancelled_by = case when p_to = 'cancelled' then p_actor_kind else cancelled_by end,
         cancel_reason = case when p_to = 'cancelled' then v_reason else cancel_reason end
   where id = p_order_id;
  perform set_config('app.order_transition', '', true);

  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_kind, reason)
  values (p_order_id, o.status, p_to, p_actor, p_actor_kind, v_reason);

  if p_to = 'paid' then
    perform public.discount_commit('order', p_order_id);
    -- Si el pago llegó por un aviso o un comprobante, ESE cobro ya está pagado: los demás intentos abiertos (un reintento anterior
    -- o posterior) no recibieron dinero y se cierran como cancelados. Sin aviso (el admin confirma a mano) se paga el abierto.
    if exists (select 1 from public.payments where order_id = p_order_id and status = 'paid') then
      update public.payments set status = 'cancelled' where order_id = p_order_id and status in ('initiated', 'pending');
    else
      update public.payments set status = 'paid', paid_at = coalesce(paid_at, now())
       where order_id = p_order_id and status in ('initiated', 'pending');
    end if;
    -- Un comprobante que nadie llegó a revisar ya no tiene nada que decidir: el pedido está pagado. Se cierra como aprobado (con la
    -- razón a la vista) para que aprobarlo después no abra un falso «pago duplicado».
    update public.payment_proofs set status = 'approved', reason = 'Pago confirmado por otra vía', reviewed_at = now()
     where order_id = p_order_id and status = 'pending';
  elsif p_to = 'cancelled' then
    -- El dinero NO se pierde al cancelar: un cobro QR ya pagado, o un comprobante que dice que se pagó y nadie revisó, deja una
    -- revisión abierta (devolver o reasignar). Antes quedaba sin tarea alguna. (Los métodos sin QR —WhatsApp, contra entrega—
    -- los reembolsa el administrador con el resto de la operación, S12.)
    for r in select p.id as payment_id, 'cancelled_after_payment'::text as cause
               from public.payments p
              where p.order_id = p_order_id and p.status = 'paid' and p.provider in ('manual_qr', 'qr_api')
             union
             select pp.payment_id, 'proof_pending_at_cancel'::text
               from public.payment_proofs pp where pp.order_id = p_order_id and pp.status = 'pending'
             order by 1, 2 loop
      perform public._payment_open_review(r.payment_id, 'late',
        jsonb_build_object('order_status', 'cancelled', 'cause', r.cause, 'cancelled_by', p_actor_kind));
    end loop;
    -- Repone el stock (BR-INV-04) en orden de variante, libera la franja y devuelve los usos del cupón.
    for r in select i.variant_id, sum(i.qty)::int as qty from public.order_items i where i.order_id = p_order_id
              group by i.variant_id order by i.variant_id loop
      perform public.apply_stock_change(r.variant_id, r.qty, 'cancel', o.number, 'Cancelación ' || o.number, p_actor);
    end loop;
    perform public.release_delivery_slot('order', p_order_id);
    perform public.discount_release('order', p_order_id);
    -- Un cobro abierto que vence con el pedido queda «expired»; si lo cancela alguien, «cancelled». Un comprobante que nadie
    -- llegó a revisar se cierra: el pedido ya no espera pago.
    update public.payments set status = case when p_actor_kind = 'system' and v_reason = 'expired' then 'expired' else 'cancelled' end
     where order_id = p_order_id and status in ('initiated', 'pending');
    update public.payment_proofs set status = 'rejected', reason = 'El pedido se canceló', reviewed_at = now()
     where order_id = p_order_id and status = 'pending';
    if p_actor_kind = 'customer' then
      perform public._order_notify(p_order_id, 'order_cancelled_by_customer', 'admin');
    end if;
  elsif p_to = 'refunded' then
    update public.payments set status = 'refunded' where order_id = p_order_id and status = 'paid';
  end if;

  -- BR-SHP-04: confirmado, empacado, enviado, entregado (+ cancelado/reembolsado)
  perform public._order_notify(p_order_id, case p_to
    when 'paid' then 'order_confirmed' when 'preparing' then 'order_packed' when 'shipped' then 'order_shipped'
    when 'delivered' then 'order_delivered' when 'cancelled' then 'order_cancelled' when 'refunded' then 'order_refunded'
    else 'order_' || p_to end, 'customer');
  return jsonb_build_object('ok', true, 'outcome', 'transitioned', 'from', o.status, 'to', p_to);
end;
$$;

-- ── 7. Ayudas internas ──────────────────────────────────────────────────────────────────────
-- (S10) `_order_notify` deduplica por (tipo, pedido): un pedido puede tener VARIOS comprobantes rechazados o cobros, así que
-- gana un sufijo (id del comprobante o del cobro) y datos extra. Con 3 argumentos se comporta como en S10.
drop function if exists public._order_notify(uuid, text, text);
create or replace function public._order_notify(p_order_id uuid, p_type text, p_audience text,
                                                p_suffix text default '', p_extra jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  v_acct record;
  v_payload jsonb;
  v_key text;
begin
  begin
    select * into o from public.orders where id = p_order_id;
    if not found then
      return;
    end if;
    v_payload := jsonb_build_object('order_id', o.id, 'number', o.number, 'status', o.status, 'total', o.total,
                                    'currency', o.currency) || coalesce(p_extra, '{}'::jsonb);
    v_key := p_type || ':' || o.id::text || coalesce(nullif(p_suffix, ''), '');
    if p_audience = 'customer' then
      -- Al correo o teléfono de la CUENTA, no al que se escribió en el formulario: ese valor no se verifica y cualquiera podría
      -- hacer que la tienda escribiera a un tercero («relevo» de avisos). El contacto del formulario es un dato del pedido.
      select p.email, p.phone_e164 into v_acct from public.profiles p where p.id = o.profile_id;
      if v_acct.email is not null then
        perform public.enqueue_notification(p_type, 'email', v_acct.email, v_payload, v_key || ':c');
      elsif v_acct.phone_e164 is not null then
        perform public.enqueue_notification(p_type, 'whatsapp', v_acct.phone_e164, v_payload, v_key || ':c');
      end if;
    else
      perform public.enqueue_notification(p_type, 'email', null, v_payload, v_key || ':a');
    end if;
  exception when others then
    raise warning 'no se pudo encolar el aviso % del pedido %: %', p_type, p_order_id, sqlerrm;
  end;
end;
$$;

-- Aviso al administrador, resiliente: si la cola falla, el pago NO se revierte.
create or replace function public._payment_alert(p_type text, p_payload jsonb, p_dedupe text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enqueue_notification(p_type, 'email', null, coalesce(p_payload, '{}'::jsonb), p_dedupe);
exception when others then
  raise warning 'no se pudo encolar el aviso % : %', p_type, sqlerrm;
end;
$$;

-- Abre (o actualiza) una revisión manual de un cobro y avisa al administrador.
create or replace function public._payment_open_review(p_payment_id uuid, p_reason text, p_detail jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.payment_reviews (payment_id, reason, detail)
  values (p_payment_id, p_reason, coalesce(p_detail, '{}'::jsonb))
  on conflict (payment_id, reason) where status = 'open' do update set detail = excluded.detail
  returning id into v_id;
  perform public._payment_alert('payment_review_needed',
    jsonb_build_object('payment_id', p_payment_id, 'reason', p_reason, 'review_id', v_id),
    'payment_review_needed:' || v_id::text);
  return v_id;
end;
$$;

-- ── 8. El camino ÚNICO de un aviso de pago ──────────────────────────────────────────────────
-- Lo llaman la Edge Function del webhook (ya con la firma verificada) y la aprobación del comprobante por el admin.
-- Idempotente por (proveedor, evento): el mismo aviso 20 veces, aunque sea a la vez, tiene UN solo efecto.
create or replace function public.payment_apply_event(
  p_provider text, p_event_id text, p_type text, p_reference text, p_amount numeric, p_currency text,
  p_external_id text default null, p_payload jsonb default '{}'::jsonb, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event bigint;
  v_pay record;
  o record;
  v_dec int;
  v_outcome text;
  v_review text;
  v_detail jsonb;
  v_t jsonb;
begin
  if p_provider is null or p_provider !~ '^[a-z][a-z0-9_]{1,31}$'
     or p_event_id is null or char_length(p_event_id) not between 1 and 200
     or p_type is null or p_type not in ('paid', 'failed', 'disputed', 'refunded')
     or p_reference is null or char_length(p_reference) not between 1 and 64
     or (p_amount is not null and (p_amount < 0 or p_amount >= 1000000000))
     or (p_currency is not null and p_currency !~ '^[A-Z]{3}$')
     or (p_external_id is not null and char_length(p_external_id) > 200) then
    raise exception 'aviso de pago inválido' using errcode = '22023';
  end if;

  insert into public.webhook_events (provider, event_id, signature_valid, payload)
  values (p_provider, p_event_id, true, coalesce(p_payload, '{}'::jsonb))
  on conflict (provider, event_id) where signature_valid and event_id is not null do nothing
  returning id into v_event;
  if v_event is null then
    update public.webhook_events set attempts = attempts + 1
     where provider = p_provider and event_id = p_event_id and signature_valid;
    return jsonb_build_object('ok', true, 'outcome', 'duplicate');
  end if;

  select * into v_pay from public.payments where reference = p_reference;
  -- Un aviso del PROVEEDOR (sin administrador detrás) solo toca cobros de ESE proveedor: si el secreto de uno se filtrara, o un
  -- proveedor se equivocara de referencia, no podría marcar como pagado un pedido de contra entrega, de WhatsApp o de otro QR
  -- (las referencias son correlativas y se adivinan). Se trata como una referencia desconocida y no se revela el motivo.
  if not found or (p_actor is null and v_pay.provider is distinct from p_provider) then
    update public.webhook_events set outcome = 'unknown_reference', processed_at = now() where id = v_event;
    perform public._payment_alert('payment_unknown_reference',
      jsonb_build_object('provider', p_provider, 'reference', left(p_reference, 64)), 'payment_unknown_reference:' || v_event::text);
    return jsonb_build_object('ok', true, 'outcome', 'unknown_reference');
  end if;

  -- Orden de candados: el pedido y después el cobro (el mismo que usan la cancelación y el vencimiento).
  select * into o from public.orders x where x.id = v_pay.order_id for update;
  select * into v_pay from public.payments x where x.id = v_pay.id for update;
  select coalesce((select c.decimals::int from public.currencies c where c.code = v_pay.currency), 2) into v_dec;
  v_outcome := 'ignored';

  if p_type = 'paid' then
    if v_pay.status in ('disputed', 'refunded') then
      v_outcome := 'ignored';
    elsif v_pay.status = 'paid' then
      -- Otro aviso de pago para un cobro que ya estaba pagado: la clienta pagó dos veces (S-06).
      v_review := 'duplicate';
      v_detail := jsonb_build_object('event_id', p_event_id, 'amount', p_amount);
    elsif o.status = 'pending_payment' then
      if p_amount is null or round(p_amount, v_dec) <> round(v_pay.amount, v_dec)
         or (p_currency is not null and p_currency <> v_pay.currency) then
        -- Monto o moneda distintos (menos o más): el pedido sigue pendiente y se avisa (S-06).
        update public.payments set received_amount = p_amount, external_id = coalesce(p_external_id, external_id)
         where id = v_pay.id;
        v_review := 'amount_mismatch';
        v_detail := jsonb_build_object('expected', v_pay.amount, 'received', p_amount, 'currency', coalesce(p_currency, v_pay.currency));
      else
        update public.payments set status = 'paid', received_amount = p_amount, paid_at = now(),
               external_id = coalesce(p_external_id, external_id)
         where id = v_pay.id;
        v_t := public.transition_order_status(o.id, 'paid', p_actor, case when p_actor is null then 'system' else 'admin' end,
                                              'Pago confirmado (' || p_provider || ')');
        v_outcome := 'applied';
        -- Si antes llegó un monto distinto y ahora el exacto, aquella revisión ya no tiene nada que decidir.
        update public.payment_reviews set status = 'resolved', resolved_at = now(),
               note = 'Llegó el monto exacto: el cobro quedó pagado.'
         where payment_id = v_pay.id and reason = 'amount_mismatch' and status = 'open';
      end if;
    else
      -- El pedido ya no espera pago (cancelado, vencido o pagado por otro cobro): el dinero LLEGÓ y no se pierde.
      update public.payments set status = 'paid', received_amount = p_amount, paid_at = now(),
             external_id = coalesce(p_external_id, external_id)
       where id = v_pay.id;
      v_review := case when o.status in ('cancelled', 'refunded') then 'late' else 'duplicate' end;
      v_detail := jsonb_build_object('order_status', o.status, 'amount', p_amount, 'event_id', p_event_id);
    end if;
  elsif p_type = 'failed' then
    if v_pay.status in ('initiated', 'pending') then
      update public.payments set status = 'failed', external_id = coalesce(p_external_id, external_id) where id = v_pay.id;
      perform public._order_notify(o.id, 'payment_failed', 'customer', ':' || v_pay.id::text);
      v_outcome := 'applied';
    end if;
  elsif p_type = 'disputed' then
    -- Contracargo (S-06): el cobro queda marcado, se avisa y no se puede reintentar.
    if v_pay.status <> 'disputed' then
      update public.payments set status = 'disputed', external_id = coalesce(p_external_id, external_id) where id = v_pay.id;
      v_review := 'disputed';
      v_detail := jsonb_build_object('previous_status', v_pay.status, 'event_id', p_event_id);
    end if;
  elsif p_type = 'refunded' then
    if v_pay.status = 'paid' then
      update public.payments set status = 'refunded' where id = v_pay.id;
      v_review := 'provider_refund';
      v_detail := jsonb_build_object('event_id', p_event_id, 'amount', p_amount);
    end if;
  end if;

  if v_review is not null then
    perform public._payment_open_review(v_pay.id, v_review, v_detail);
    v_outcome := 'review';
  end if;
  update public.webhook_events set outcome = v_outcome, payment_id = v_pay.id, processed_at = now() where id = v_event;
  return jsonb_build_object('ok', true, 'outcome', v_outcome, 'review', v_review, 'payment_id', v_pay.id,
                            'order_id', o.id, 'order_status', coalesce(v_t #>> '{to}', o.status));
end;
$$;

-- Un aviso con firma inválida o ilegible NO se procesa, pero queda registrado (criterio 4).
create or replace function public.payment_log_invalid_event(p_provider text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_provider is null or p_provider !~ '^[a-z][a-z0-9_]{1,31}$' then
    return;
  end if;
  insert into public.webhook_events (provider, event_id, signature_valid, payload, outcome, error, processed_at)
  values (p_provider, null, false, case when pg_column_size(coalesce(p_payload, '{}'::jsonb)) <= 4000
                                        then coalesce(p_payload, '{}'::jsonb) else '{}'::jsonb end,
          'rejected', left(coalesce(p_reason, 'firma inválida'), 300), now());
end;
$$;

-- ── 9. Comprobantes ─────────────────────────────────────────────────────────────────────────
-- Ruta de Storage de un comprobante: `{clienta}/{pedido}/{uuid}.{ext}`. Lo usa la política de subida: la clienta solo escribe en
-- SU carpeta, para SU pedido pendiente, con un cobro QR abierto y sin pasarse del tope de archivos.
create or replace function public.payment_proof_path_ok(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_order uuid;
  v_uuid constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  if v_uid is null or p_name is null
     or p_name !~ ('^' || v_uuid || '/' || v_uuid || '/' || v_uuid || '\.(jpg|jpeg|png|webp|pdf)$')
     or split_part(p_name, '/', 1) <> v_uid::text then
    return false;
  end if;
  v_order := split_part(p_name, '/', 2)::uuid;
  return exists (
           select 1 from public.orders o join public.payments p on p.order_id = o.id
            where o.id = v_order and o.profile_id = v_uid and o.status = 'pending_payment'
              and p.status in ('initiated', 'pending') and p.provider in ('manual_qr', 'qr_api')
              and (p.expires_at is null or p.expires_at > now()))
     and (select count(*) from storage.objects so
           where so.bucket_id = 'payment-proofs' and so.name like (v_uid::text || '/' || v_order::text || '/%'))
         < public.setting_int('payment_proofs_max', 5) * 2;
end;
$$;

-- Registra un comprobante YA subido y validado por la Edge Function (tipo real, tamaño y huella). Solo service_role.
create or replace function public.payment_proof_register(
  p_profile_id uuid, p_payment_id uuid, p_path text, p_hash text, p_mime text, p_size int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  v_pay record;
  v_dup uuid;
  v_existing record;
  v_id uuid;
begin
  if p_profile_id is null or p_payment_id is null or p_path is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$'
     or p_mime not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') or p_size is null
     or p_size not between 1 and 5242880 then
    raise exception 'comprobante inválido' using errcode = '22023';
  end if;
  select * into v_pay from public.payments where id = p_payment_id;
  if not found then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  select * into o from public.orders x where x.id = v_pay.order_id for update;
  -- Un cobro ajeno es «no existe»: no se revela.
  if o.profile_id <> p_profile_id then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  select * into v_pay from public.payments x where x.id = p_payment_id for update;
  -- La ruta debe ser de SU pedido (la subida ya lo exige; aquí se vuelve a comprobar con el servidor).
  if split_part(p_path, '/', 1) <> p_profile_id::text or split_part(p_path, '/', 2) <> o.id::text then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  select * into v_existing from public.payment_proofs where file_path = p_path;
  if found then
    return jsonb_build_object('ok', true, 'outcome', 'existing', 'proof_id', v_existing.id, 'file_path', v_existing.file_path);
  end if;
  if v_pay.provider not in ('manual_qr', 'qr_api') or o.status <> 'pending_payment'
     or v_pay.status not in ('initiated', 'pending') or (v_pay.expires_at is not null and v_pay.expires_at <= now()) then
    return jsonb_build_object('ok', false, 'outcome', 'payment_closed');
  end if;
  -- La misma imagen otra vez para este cobro (doble toque, reintento de red): el mismo comprobante.
  select * into v_existing from public.payment_proofs where payment_id = p_payment_id and file_hash = p_hash and status <> 'rejected';
  if found then
    return jsonb_build_object('ok', true, 'outcome', 'existing', 'proof_id', v_existing.id, 'file_path', v_existing.file_path);
  end if;
  if exists (select 1 from public.payment_proofs where payment_id = p_payment_id and status = 'pending') then
    return jsonb_build_object('ok', false, 'outcome', 'proof_pending');
  end if;
  if (select count(*) from public.payment_proofs where payment_id = p_payment_id) >= public.setting_int('payment_proofs_max', 5) then
    return jsonb_build_object('ok', false, 'outcome', 'too_many_proofs');
  end if;
  select pp.id into v_dup from public.payment_proofs pp
   where pp.file_hash = p_hash and pp.payment_id <> p_payment_id order by pp.created_at limit 1;
  insert into public.payment_proofs (payment_id, order_id, profile_id, file_path, file_hash, mime, size_bytes, duplicate_of)
  values (p_payment_id, o.id, p_profile_id, p_path, p_hash, p_mime, p_size, v_dup)
  returning id into v_id;
  perform public._payment_alert('payment_proof_received',
    jsonb_build_object('proof_id', v_id, 'payment_id', p_payment_id, 'number', o.number, 'duplicate', v_dup is not null),
    'payment_proof_received:' || v_id::text);
  return jsonb_build_object('ok', true, 'outcome', 'registered', 'proof_id', v_id, 'file_path', p_path, 'duplicate', v_dup is not null);
end;
$$;

-- El administrador aprueba o rechaza un comprobante. Gana la primera decisión (bloqueo de fila).
create or replace function public.admin_review_proof(p_proof_id uuid, p_decision text, p_reason text default null,
                                                     p_received_amount numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proof record;
  v_pay record;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 300);
  v_res jsonb;
  o record;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  -- `p_decision is null` va PRIMERO: con NULL, `not in` y `=` dan NULL (no falso) y la validación se salteaba, cayendo en «aprobar».
  if p_decision is null or p_decision not in ('approve', 'reject') or (p_decision = 'reject' and v_reason is null)
     or (p_received_amount is not null and (p_received_amount < 0 or p_received_amount >= 1000000000)) then
    raise exception 'decisión inválida' using errcode = '22023';
  end if;
  -- Orden de candados: pedido → cobro → comprobante, el mismo que usan la cancelación, el vencimiento y los avisos de pago. Si se
  -- bloqueara primero el comprobante, aprobar a la vez que la clienta cancela (o vence el pedido) se interbloquearía.
  select * into v_proof from public.payment_proofs where id = p_proof_id;
  if not found then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  select * into o from public.orders where id = v_proof.order_id for update;
  select * into v_pay from public.payments where id = v_proof.payment_id for update;
  select * into v_proof from public.payment_proofs where id = p_proof_id for update;
  if v_proof.status <> 'pending' then
    return jsonb_build_object('ok', false, 'outcome', 'already_reviewed', 'status', v_proof.status);
  end if;

  if p_decision = 'reject' then
    update public.payment_proofs set status = 'rejected', reason = v_reason, reviewed_by = auth.uid(), reviewed_at = now()
     where id = p_proof_id;
    perform public._order_notify(o.id, 'payment_proof_rejected', 'customer', ':' || p_proof_id::text,
                                 jsonb_build_object('reason', v_reason));
    return jsonb_build_object('ok', true, 'outcome', 'rejected');
  end if;

  update public.payment_proofs set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
         received_amount = coalesce(p_received_amount, v_pay.amount)
   where id = p_proof_id;
  -- El cobro ya estaba pagado (otra vía lo confirmó mientras el comprobante esperaba): no es un segundo pago, no se abre una
  -- revisión de «pago duplicado».
  if v_pay.status = 'paid' then
    return jsonb_build_object('ok', true, 'outcome', 'approved', 'payment', jsonb_build_object('ok', true, 'outcome', 'already_paid'));
  end if;
  v_res := public.payment_apply_event('manual_qr', 'proof:' || p_proof_id::text, 'paid', v_pay.reference,
                                      coalesce(p_received_amount, v_pay.amount), v_pay.currency, null,
                                      jsonb_build_object('proof_id', p_proof_id), auth.uid());
  return jsonb_build_object('ok', true, 'outcome', 'approved', 'payment', v_res);
end;
$$;

-- «Confirmación manual del admin» (BR-DAT-03): el dinero se vio en el banco aunque no haya comprobante ni aviso.
create or replace function public.admin_confirm_payment_manual(p_payment_id uuid, p_received_amount numeric default null,
                                                               p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay record;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  select * into v_pay from public.payments where id = p_payment_id;
  if not found then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  -- Ya pagado: se dice tal cual (antes un segundo intento devolvía «duplicado» y la pantalla afirmaba «ya estaba confirmado»
  -- también cuando NO lo estaba).
  if v_pay.status = 'paid' then
    return jsonb_build_object('ok', true, 'outcome', 'already_paid', 'payment_id', v_pay.id);
  end if;
  -- El identificador del aviso lleva el MONTO: la misma confirmación repetida (doble clic) es una sola, pero corregir un monto
  -- mal escrito (79,50 → 80,00) es otra y se procesa. Con un identificador fijo por cobro, el primer monto equivocado
  -- «gastaba» el aviso y la corrección devolvía «duplicado» sin hacer nada: el dinero recibido quedaba sin confirmar.
  return public.payment_apply_event('admin', 'manual:' || p_payment_id::text || ':' || coalesce(p_received_amount, v_pay.amount)::text,
                                    'paid', v_pay.reference, coalesce(p_received_amount, v_pay.amount), v_pay.currency, null,
                                    jsonb_build_object('note', left(coalesce(p_note, ''), 300)), auth.uid());
end;
$$;

-- Marca una revisión como resuelta (qué se hizo queda en la nota; el reembolso o la reasignación son de S12).
create or replace function public.admin_resolve_review(p_review_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
  v_review record;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if v_note is null then
    raise exception 'la nota es obligatoria' using errcode = '22023';
  end if;
  select * into v_review from public.payment_reviews where id = p_review_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  if v_review.status = 'resolved' then
    return jsonb_build_object('ok', false, 'outcome', 'already_resolved');
  end if;
  update public.payment_reviews set status = 'resolved', note = v_note, resolved_by = auth.uid(), resolved_at = now()
   where id = p_review_id;
  return jsonb_build_object('ok', true, 'outcome', 'resolved');
end;
$$;

-- ── 10. Lo que la clienta ve de su pago ─────────────────────────────────────────────────────
-- La clienta NO lee `payment_proofs` ni las revisiones: se entera por aquí. Un pedido ajeno es «no existe».
create or replace function public.customer_payment_view(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  o record;
  v_pay record;
  v_proof record;
  v_method record;
  v_open boolean;
begin
  if v_uid is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select * into o from public.orders x where x.id = p_order_id and x.profile_id = v_uid;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select * into v_pay from public.payments p where p.order_id = o.id order by p.attempt desc limit 1;
  -- El comprobante del cobro VIGENTE: el de un intento anterior (rechazado, y luego el cobro falló) no se le muestra a la clienta
  -- como si fuera de este.
  select * into v_proof from public.payment_proofs pp where pp.payment_id = v_pay.id order by pp.created_at desc, pp.id desc limit 1;
  select m.code, m.name, m.description, m.account_details, m.qr_image_path, m.window_minutes, m.is_active, m.archived_at into v_method
    from public.payment_methods m where m.country = o.country and m.code = o.payment_method;
  v_open := v_pay.id is not null and v_pay.status in ('initiated', 'pending') and o.status = 'pending_payment'
            and (v_pay.expires_at is null or v_pay.expires_at > now());
  return jsonb_build_object(
    'outcome', 'ok',
    'server_now', now(),
    'order', jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'total', o.total, 'currency', o.currency,
                                'payment_expires_at', o.payment_expires_at),
    'payment', case when v_pay.id is null then null else jsonb_build_object(
      'id', v_pay.id, 'status', v_pay.status, 'provider', v_pay.provider, 'method', v_pay.method, 'reference', v_pay.reference,
      'amount', v_pay.amount, 'currency', v_pay.currency, 'expires_at', v_pay.expires_at, 'paid_at', v_pay.paid_at,
      'under_review', exists (select 1 from public.payment_reviews r where r.payment_id = v_pay.id and r.status = 'open'))
      end,
    'method', case when v_method.code is null or v_pay.provider not in ('manual_qr', 'qr_api') then null else jsonb_build_object(
      'code', v_method.code, 'name', v_method.name, 'description', v_method.description,
      'account_details', v_method.account_details, 'qr_image_path', v_method.qr_image_path) end,
    'proof', case when v_proof.id is null then null else jsonb_build_object(
      'status', v_proof.status, 'reason', v_proof.reason, 'created_at', v_proof.created_at, 'reviewed_at', v_proof.reviewed_at,
      'mime', v_proof.mime) end,
    'can_upload', v_open and v_pay.provider in ('manual_qr', 'qr_api')
                  and not exists (select 1 from public.payment_proofs pp where pp.payment_id = v_pay.id and pp.status = 'pending')
                  and (select count(*) from public.payment_proofs pp where pp.payment_id = v_pay.id)
                      < public.setting_int('payment_proofs_max', 5),
    'can_retry', o.status = 'pending_payment' and v_pay.id is not null and v_pay.status in ('failed', 'expired', 'cancelled')
                 and v_method.window_minutes is not null and coalesce(v_method.is_active, false) and v_method.archived_at is null
                 and not exists (select 1 from public.payments p2 where p2.order_id = o.id and p2.status = 'disputed')
  );
end;
$$;

-- ── 11. Reintentar el pago de un pedido que sigue pendiente ─────────────────────────────────
-- Misma orden, cobro NUEVO con ventana nueva (típicamente tras un pago que el proveedor reportó fallido). Un pedido ya
-- cancelado o vencido no se revive: la clienta usa «Volver a pedir» y pasa otra vez por el checkout (stock y precios al día).
create or replace function public.payment_retry(p_profile_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  v_method record;
  v_new uuid;
begin
  select * into o from public.orders x where x.id = p_order_id for update;
  if not found or o.profile_id <> p_profile_id then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  if o.status <> 'pending_payment' then
    return jsonb_build_object('ok', false, 'outcome', 'order_closed');
  end if;
  select m.window_minutes, m.provider, m.is_active, m.archived_at into v_method from public.payment_methods m
   where m.country = o.country and m.code = o.payment_method;
  -- Un método que el dueño apagó o archivó no se puede reintentar (igual que no se puede elegir al crear un pedido).
  if v_method.window_minutes is null or v_method.provider not in ('manual_qr', 'qr_api')
     or not coalesce(v_method.is_active, false) or v_method.archived_at is not null then
    return jsonb_build_object('ok', false, 'outcome', 'not_retryable');
  end if;
  if exists (select 1 from public.payments p where p.order_id = o.id and p.status = 'disputed') then
    return jsonb_build_object('ok', false, 'outcome', 'payment_blocked');
  end if;
  if exists (select 1 from public.payments p where p.order_id = o.id and p.status = 'paid') then
    return jsonb_build_object('ok', false, 'outcome', 'already_paid');
  end if;
  if exists (select 1 from public.payments p where p.order_id = o.id and p.status in ('initiated', 'pending')) then
    return jsonb_build_object('ok', false, 'outcome', 'payment_open');
  end if;
  if (select coalesce(max(p.attempt), 0) from public.payments p where p.order_id = o.id) >= 5 then
    return jsonb_build_object('ok', false, 'outcome', 'too_many_attempts');
  end if;
  update public.orders set payment_expires_at = now() + make_interval(mins => v_method.window_minutes), updated_at = now()
   where id = o.id;
  insert into public.payments (order_id, provider, method, status, amount, currency, expires_at)
  values (o.id, o.payment_provider, o.payment_method, 'pending', o.total, o.currency,
          now() + make_interval(mins => v_method.window_minutes))
  returning id into v_new;
  return jsonb_build_object('ok', true, 'outcome', 'retried', 'payment_id', v_new);
end;
$$;

-- ── 12. Vencimiento y recordatorios ─────────────────────────────────────────────────────────
-- (S10) Solo vencen los pedidos de métodos CON ventana. Ahora además: un pedido con un comprobante esperando revisión NO se
-- cancela solo (la clienta ya pagó o dice que pagó: decide el administrador).
create or replace function public.expire_unconfirmed_orders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_ord record;
  v_n int := 0;
begin
  for r in select o.id from public.orders o
            where o.status = 'pending_payment' and o.payment_expires_at is not null and o.payment_expires_at <= now()
              -- Un comprobante esperando revisión retiene el pedido, pero NO para siempre: pasados 3 días del vencimiento se
              -- cancela igual (sin este tope, subir un archivo cualquiera acapararía el stock hasta que alguien lo revise).
              and (o.payment_expires_at <= now() - interval '3 days'
                   or not exists (select 1 from public.payment_proofs pp where pp.order_id = o.id and pp.status = 'pending'))
            order by o.id loop
    begin
      -- La lista de arriba se armó SIN candados: entre ella y aquí una clienta pudo reintentar el pago (ventana nueva) o subir un
      -- comprobante. Con el pedido ya bloqueado se vuelve a comprobar, y un pedido renovado no se cancela.
      select * into v_ord from public.orders x where x.id = r.id for update;
      if v_ord.status = 'pending_payment' and v_ord.payment_expires_at is not null and v_ord.payment_expires_at <= now()
         and (v_ord.payment_expires_at <= now() - interval '3 days'
              or not exists (select 1 from public.payment_proofs pp where pp.order_id = v_ord.id and pp.status = 'pending'))
         and (public.transition_order_status(r.id, 'cancelled', null, 'system', 'expired') ->> 'ok')::boolean then
        v_n := v_n + 1;
      end if;
    exception when others then
      -- un pedido con problemas no detiene a los demás (ni se repite eternamente en cada corrida)
      raise warning 'no se pudo vencer el pedido %: %', r.id, sqlerrm;
    end;
  end loop;
  return v_n;
end;
$$;

create or replace function public.expire_pending_payments()
returns int
language sql
security definer
set search_path = ''
as $$ select public.expire_unconfirmed_orders() $$;

-- Recuerda a la clienta que le falta pagar cuando faltan `payment_reminder_hours` horas para que venza (una vez por cobro).
create or replace function public.remind_expiring_payments()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_hours int := public.setting_int('payment_reminder_hours', 6);
  v_n int := 0;
begin
  if v_hours <= 0 then
    return 0;
  end if;
  for r in select p.id, p.order_id from public.payments p join public.orders o on o.id = p.order_id
            where p.status in ('initiated', 'pending') and o.status = 'pending_payment' and p.expires_at is not null
              and p.expires_at > now() and p.expires_at <= now() + make_interval(hours => v_hours)
              and p.reminder_sent_at is null
            order by p.expires_at, p.id loop
    begin
      perform public._order_notify(r.order_id, 'payment_expiring', 'customer', ':' || r.id::text);
      update public.payments set reminder_sent_at = now() where id = r.id;
      v_n := v_n + 1;
    exception when others then
      raise warning 'no se pudo recordar el pago %: %', r.id, sqlerrm;
    end;
  end loop;
  return v_n;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'expire-unconfirmed-orders';
    perform cron.schedule('expire-pending-payments', '* * * * *', 'select public.expire_pending_payments()');
    perform cron.schedule('remind-expiring-payments', '*/15 * * * *', 'select public.remind_expiring_payments()');
  else
    raise notice 'pg_cron no está disponible: los pagos no vencerán solos ni se enviarán recordatorios';
  end if;
end;
$$;

-- ── 13. Storage: comprobantes (PRIVADO) y QR de la tienda (público) ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('payment-qr',     'payment-qr',     true,  2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Comprobantes: la clienta SUBE a su ruta y LEE lo suyo; no actualiza ni borra (lo subido no se cambia después de enviarlo).
-- El administrador los lee (URL firmada). Ningún archivo es público.
drop policy if exists payment_proofs_owner_insert on storage.objects;
create policy payment_proofs_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and public.payment_proof_path_ok(name));
drop policy if exists payment_proofs_owner_select on storage.objects;
create policy payment_proofs_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and (split_part(name, '/', 1) = (select auth.uid())::text or public.is_admin()));

-- QR de la tienda: lectura pública (es la imagen que se le muestra a la clienta); escritura solo admin y solo rutas válidas.
drop policy if exists payment_qr_admin_select on storage.objects;
create policy payment_qr_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'payment-qr' and public.is_admin());
drop policy if exists payment_qr_admin_insert on storage.objects;
create policy payment_qr_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-qr' and public.is_admin() and public.storage_path_ok(bucket_id, name));
drop policy if exists payment_qr_admin_update on storage.objects;
create policy payment_qr_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'payment-qr' and public.is_admin())
  with check (bucket_id = 'payment-qr' and public.is_admin() and public.storage_path_ok(bucket_id, name));
drop policy if exists payment_qr_admin_delete on storage.objects;
create policy payment_qr_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'payment-qr' and public.is_admin());

-- ── 14. Permisos ────────────────────────────────────────────────────────────────────────────
revoke all on function
  public.store_settings_validate_s11(), public.payments_before_insert(), public._payment_alert(text, jsonb, text),
  public._payment_open_review(uuid, text, jsonb),
  public.payment_apply_event(text, text, text, text, numeric, text, text, jsonb, uuid),
  public.payment_log_invalid_event(text, text, jsonb), public.payment_proof_path_ok(text),
  public.payment_proof_register(uuid, uuid, text, text, text, int),
  public.admin_review_proof(uuid, text, text, numeric), public.admin_confirm_payment_manual(uuid, numeric, text),
  public.admin_resolve_review(uuid, text), public.customer_payment_view(uuid), public.payment_retry(uuid, uuid),
  public.expire_pending_payments(), public.remind_expiring_payments(), public.expire_unconfirmed_orders(),
  public.transition_order_status(uuid, text, uuid, text, text), public._order_transition_ok(text, text, text),
  public.orders_guard(), public._order_notify(uuid, text, text, text, jsonb)
  from public, anon, authenticated, service_role;
-- Las del servidor (solo la Edge Function, con la identidad ya verificada):
grant execute on function
  public.payment_apply_event(text, text, text, text, numeric, text, text, jsonb, uuid),
  public.payment_log_invalid_event(text, text, jsonb),
  public.payment_proof_register(uuid, uuid, text, text, text, int),
  public.payment_retry(uuid, uuid), public.transition_order_status(uuid, text, uuid, text, text)
  to service_role;
-- Las que ejecuta el navegador (la autorización va ADENTRO: `is_admin()` o `auth.uid()`):
grant execute on function
  public.admin_review_proof(uuid, text, text, numeric), public.admin_confirm_payment_manual(uuid, numeric, text),
  public.admin_resolve_review(uuid, text), public.customer_payment_view(uuid)
  to authenticated;
-- La política de Storage la evalúa con el rol de quien sube; el vencimiento lo ejecuta pg_cron (postgres).
grant execute on function public.payment_proof_path_ok(text) to authenticated;
