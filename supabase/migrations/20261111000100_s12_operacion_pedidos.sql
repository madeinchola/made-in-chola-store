-- Sprint 12 — Administración de pedidos y operación
-- BR-ORD-01..04, BR-ORD-06, BR-PRC-03/04 (reversión de cupón y reembolso), BR-PAY-05, BR-PAY-07, BR-ADM-03, BR-SHP-03 (incidencias),
-- S-05, S-06, S-07.
--
-- Diseño (decisiones tomadas leyendo S10 y S11; ver docs/operacion-pedidos.md):
--  · El pedido SIGUE siendo una instantánea. Editarlo (`admin_edit_order`) abre una vía controlada: la bandera `app.order_edit`, que
--    solo esa función enciende, deja que cambien los importes, las líneas, el contacto y la dirección, y cada cambio queda en el
--    libro `order_edits` (inmutable: quién, por qué y el antes/después de importes y líneas; de los datos personales solo «cambiaron»).
--  · TODO el dinero que sale pasa por `refunds` (libro con tope): un reembolso nunca supera lo efectivamente pagado, ni dos veces
--    (el pedido se bloquea antes de calcular y un disparador lo vuelve a comprobar). El reembolso que avisa el proveedor también
--    entra al libro, para que no se pueda devolver dos veces lo mismo.
--  · Todo cálculo es UNO solo para la vista previa y para aplicar (`p_dry_run`): la pantalla y el resultado coinciden por construcción.
--  · Lista negra: `profiles.blacklisted` (S1) sigue valiendo; las entradas de `blacklist_entries` añaden teléfono y correo (quien abre
--    otra cuenta con los mismos datos también queda bloqueado). `is_blacklisted()` lo consume el checkout de S10.
--  · Contra entrega (BR-PAY-07): «pagado» en S10 significaba «pedido confirmado»; ahora el cobro lleva `collected_at`. Solo lo cobrado
--    cuenta como dinero pagado (un pedido de contra entrega cancelado antes de cobrar no deja nada que reembolsar).
--
-- Rollback manual (orden inverso):
--   drop function public.admin_create_manual_order(uuid, jsonb, text, text, text, jsonb, text, numeric, uuid, date, numeric,
--     text, text, text, text, text, boolean, boolean), public.admin_edit_order(uuid, timestamptz, jsonb, jsonb, jsonb, numeric,
--     numeric, text, boolean), public.admin_cod_reject(uuid, numeric, text, boolean, text), public.admin_cod_collect(uuid,
--     numeric, text), public.admin_return_reject(uuid, text), public.admin_return_close(uuid, jsonb),
--     public.admin_return_open(uuid, jsonb, text, text), public.admin_reject_refund(uuid, text),
--     public.admin_process_refund(uuid, text, text), public.admin_refund_order(uuid, text, text, jsonb, boolean, numeric,
--     numeric, text, text, text, text, uuid, boolean, boolean, boolean), public.admin_incident_update(uuid, text, text,
--     numeric, text), public.admin_incident_open(uuid, text, text, numeric, text), public.admin_blacklist_matches(uuid),
--     public.admin_blacklist_lift(uuid, text), public.admin_blacklist_add(text, uuid, text, text, text, uuid, boolean),
--     public.admin_undo_transition(uuid, text), public.admin_transition_order(uuid, text, text, text),
--     public.admin_add_order_note(uuid, text), public.admin_attention_orders(), public.admin_attention_summary(),
--     public.admin_orders_status_counts(), public.admin_order_history(uuid), public.store_settings_validate_s12(),
--     public.order_items_guard(), public.refunds_guard(), public.is_blacklisted(uuid, text, text),
--     public._order_address_clean(jsonb), public._order_stock_free(uuid), public._order_balance(uuid),
--     public._order_refunded_amount(uuid, boolean), public._order_paid_amount(uuid), public._refund_settle(uuid, uuid),
--     public._refund_compute(uuid, jsonb, boolean, numeric, numeric, boolean), public._attention_rows();
--   (restaurar de S10/S11: _checkout_compute, transition_order_status, _order_transition_ok, orders_guard, payment_apply_event
--    y admin_transition_order(uuid, text, text); y `create trigger order_items_immutable_trg … execute function public.immutable_row()`)
--   drop table public.order_return_items, public.order_returns, public.refund_items, public.refunds, public.order_incidents,
--     public.order_notes, public.order_edits, public.blacklist_entries;
--   alter table public.payments drop column collected_at, drop column collected_by;
--   alter table public.orders drop column channel, drop column edited_at, drop column edit_count;
--   delete from public.store_settings where key in ('returns_enabled', 'return_window_days', 'order_undo_window_minutes');

-- ── 1. Ajustes ──────────────────────────────────────────────────────────────────────────────
insert into public.store_settings (key, value, value_type, is_public, description) values
  ('returns_enabled', 'false', 'bool', false,
   'Devoluciones de productos: activas solo cuando la tienda redacte su política (PENDIENTES_ADMIN §D). Apagado, el panel no abre devoluciones nuevas'),
  ('return_window_days', '7', 'int', false,
   'Días, contados desde la entrega, en que se acepta una devolución sin una justificación especial (política de la tienda)'),
  ('order_undo_window_minutes', '5', 'int', false,
   'Minutos en que un administrador puede deshacer el último cambio de estado de un pedido (solo si es seguro). S13 debe retrasar los avisos de estado al menos este tiempo')
on conflict (key) do nothing;

create or replace function public.store_settings_validate_s12()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_text text := new.value #>> '{}';
begin
  if new.key = 'returns_enabled' then
    if new.value_type <> 'bool' or v_text not in ('true', 'false') then
      raise exception 'el ajuste "returns_enabled" debe ser verdadero o falso' using errcode = '22023';
    end if;
    return new;
  end if;
  if new.value_type <> 'int' or v_text !~ '^[0-9]{1,9}$' then
    return new;
  end if;
  if (new.key = 'return_window_days' and (v_text::int < 1 or v_text::int > 365))
     or (new.key = 'order_undo_window_minutes' and (v_text::int < 1 or v_text::int > 60)) then
    raise exception 'el ajuste "%" está fuera de rango', new.key using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists store_settings_validate_s12_trg on public.store_settings;
create trigger store_settings_validate_s12_trg before insert or update on public.store_settings
  for each row when (new.key in ('returns_enabled', 'return_window_days', 'order_undo_window_minutes'))
  execute function public.store_settings_validate_s12();

-- ── 2. Columnas nuevas ──────────────────────────────────────────────────────────────────────
-- Canal del pedido: `web` (la tienda), `manual` o `whatsapp` (creados por un administrador). `edited_at`/`edit_count` marcan que el
-- pedido se editó (el detalle está en `order_edits`).
alter table public.orders
  add column if not exists channel    text not null default 'web',
  add column if not exists edited_at  timestamptz,
  add column if not exists edit_count int not null default 0;
alter table public.orders drop constraint if exists orders_channel_check;
alter table public.orders add constraint orders_channel_check check (channel in ('web', 'manual', 'whatsapp'));
alter table public.orders drop constraint if exists orders_edit_count_check;
alter table public.orders add constraint orders_edit_count_check check (edit_count >= 0);
create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_provider_status_idx on public.orders (payment_provider, status);

-- Contra entrega: el cobro se registra cuando el repartidor entrega el dinero (BR-PAY-07).
alter table public.payments
  add column if not exists collected_at timestamptz,
  add column if not exists collected_by uuid references public.profiles (id);

-- ── 3. Lista negra (BR-PAY-07, S-07) ────────────────────────────────────────────────────────
-- Una entrada por cuenta, por teléfono o por correo. Quien abre otra cuenta con el mismo teléfono o correo queda bloqueado igual.
create table if not exists public.blacklist_entries (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('profile', 'phone', 'email')),
  profile_id      uuid references public.profiles (id) on delete restrict,
  phone_e164      text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email           text check (email is null or (email = lower(btrim(email)) and char_length(email) <= 254
                                               and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  reason          text not null check (char_length(btrim(reason)) between 1 and 300),
  is_active       boolean not null default true,
  source_order_id uuid references public.orders (id) on delete restrict,
  created_by      uuid references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now(),
  lifted_by       uuid references public.profiles (id) on delete restrict,
  lifted_at       timestamptz,
  lift_reason     text check (lift_reason is null or char_length(btrim(lift_reason)) between 1 and 300),
  -- Exactamente el dato que dice el tipo.
  constraint blacklist_entries_one_target check (
    (kind = 'profile' and profile_id is not null and phone_e164 is null and email is null)
    or (kind = 'phone' and phone_e164 is not null and profile_id is null and email is null)
    or (kind = 'email' and email is not null and profile_id is null and phone_e164 is null)),
  constraint blacklist_entries_lift_coherent check (is_active = (lifted_at is null))
);
create unique index if not exists blacklist_entries_active_profile on public.blacklist_entries (profile_id) where is_active and kind = 'profile';
create unique index if not exists blacklist_entries_active_phone on public.blacklist_entries (phone_e164) where is_active and kind = 'phone';
create unique index if not exists blacklist_entries_active_email on public.blacklist_entries (email) where is_active and kind = 'email';
create index if not exists blacklist_entries_created_idx on public.blacklist_entries (created_at desc);

-- ── 4. Notas internas, libro de ediciones e incidencias ─────────────────────────────────────
create table if not exists public.order_notes (
  id         bigint generated always as identity primary key,
  order_id   uuid not null references public.orders (id) on delete restrict,
  author_id  uuid references public.profiles (id) on delete restrict,
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists order_notes_order_idx on public.order_notes (order_id, id);

-- Libro inmutable de ediciones: quién, por qué y qué cambió (importes, líneas, stock). De los datos personales solo se anota que
-- cambiaron (el libro no se puede anonimizar, BR-ACC-07).
create table if not exists public.order_edits (
  id         bigint generated always as identity primary key,
  order_id   uuid not null references public.orders (id) on delete restrict,
  actor_id   uuid references public.profiles (id) on delete restrict,
  reason     text not null check (char_length(btrim(reason)) between 1 and 300),
  before     jsonb not null,
  after      jsonb not null,
  diff       jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists order_edits_order_idx on public.order_edits (order_id, id);

-- Incidencias de entrega (BR-SHP-03): quién asume cada costo lo define la tienda (PENDIENTES_ADMIN §B).
create table if not exists public.order_incidents (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete restrict,
  type          text not null check (type in ('lost', 'damaged', 'wrong_address', 'absent', 'rejected')),
  status        text not null default 'open' check (status in ('open', 'investigating', 'resolved')),
  description   text check (description is null or char_length(btrim(description)) between 1 and 1000),
  cost_assumed  numeric not null default 0 check (cost_assumed >= 0 and cost_assumed < 1000000000),
  cost_borne_by text not null default 'store' check (cost_borne_by in ('store', 'customer', 'carrier', 'none')),
  resolution    text check (resolution is null or char_length(btrim(resolution)) between 1 and 1000),
  opened_by     uuid references public.profiles (id) on delete restrict,
  opened_at     timestamptz not null default now(),
  resolved_by   uuid references public.profiles (id) on delete restrict,
  resolved_at   timestamptz,
  updated_at    timestamptz not null default now(),
  constraint order_incidents_resolved_coherent check ((status = 'resolved') = (resolved_at is not null)),
  constraint order_incidents_resolution_needed check (status <> 'resolved' or resolution is not null)
);
create index if not exists order_incidents_order_idx on public.order_incidents (order_id);
create index if not exists order_incidents_status_idx on public.order_incidents (status, opened_at);
drop trigger if exists order_incidents_set_updated_at on public.order_incidents;
create trigger order_incidents_set_updated_at before update on public.order_incidents
  for each row execute function public.set_updated_at();

-- ── 5. Devoluciones (política de la tienda: configurable, apagada hasta que la redacte) ──────
create table if not exists public.order_returns (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete restrict,
  status          text not null default 'open' check (status in ('open', 'closed', 'rejected')),
  reason          text not null check (char_length(btrim(reason)) between 1 and 300),
  -- Fuera del plazo de la política: hace falta decir por qué se acepta igual.
  outside_window  boolean not null default false,
  override_reason text check (override_reason is null or char_length(btrim(override_reason)) between 1 and 300),
  opened_by       uuid references public.profiles (id) on delete restrict,
  opened_at       timestamptz not null default now(),
  closed_by       uuid references public.profiles (id) on delete restrict,
  closed_at       timestamptz,
  close_note      text check (close_note is null or char_length(btrim(close_note)) between 1 and 300),
  constraint order_returns_closed_coherent check ((status = 'open') = (closed_at is null)),
  constraint order_returns_override_needed check (not outside_window or override_reason is not null)
);
create index if not exists order_returns_order_idx on public.order_returns (order_id);
create index if not exists order_returns_status_idx on public.order_returns (status, opened_at);

create table if not exists public.order_return_items (
  id            uuid primary key default gen_random_uuid(),
  return_id     uuid not null references public.order_returns (id) on delete restrict,
  order_item_id uuid not null references public.order_items (id) on delete restrict,
  qty           int not null check (qty >= 1),
  reason_code   text not null check (reason_code in ('damaged', 'wrong_size', 'not_as_described', 'changed_mind', 'other')),
  -- Reingreso a stock: sí / no / por inspeccionar (se resuelve al cerrar la devolución).
  restock       text not null check (restock in ('yes', 'no', 'inspection')),
  restocked_at  timestamptz,
  constraint order_return_items_once unique (return_id, order_item_id)
);
create index if not exists order_return_items_item_idx on public.order_return_items (order_item_id);

-- ── 6. Reembolsos (BR-PRC-04: lo efectivamente pagado) ──────────────────────────────────────
create table if not exists public.refunds (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete restrict,
  payment_id      uuid references public.payments (id) on delete restrict,
  -- cancel = todo lo pagado al cancelar · items = por líneas (devolución parcial) · amount = monto libre (diferencia, excedente)
  -- provider = lo reembolsó el proveedor por su lado (se anota para que no se devuelva dos veces)
  kind            text not null check (kind in ('cancel', 'items', 'amount', 'provider')),
  amount          numeric not null check (amount > 0 and amount < 1000000000),
  shipping_amount numeric not null default 0 check (shipping_amount >= 0),
  deduction       numeric not null default 0 check (deduction >= 0),
  currency        text not null references public.currencies (code),
  reason          text not null check (char_length(btrim(reason)) between 1 and 300),
  status          text not null default 'requested' check (status in ('requested', 'approved', 'processed', 'rejected')),
  method          text not null default 'same_method' check (method in ('same_method', 'bank_transfer', 'cash', 'provider', 'other')),
  destination     text check (destination is null or char_length(btrim(destination)) between 1 and 300),
  external_ref    text check (external_ref is null or char_length(btrim(external_ref)) between 1 and 120),
  return_id       uuid references public.order_returns (id) on delete restrict,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_:.-]{8,200}$'),
  request_hash    text,
  requested_by    uuid references public.profiles (id) on delete restrict,
  processed_by    uuid references public.profiles (id) on delete restrict,
  processed_at    timestamptz,
  decision_note   text check (decision_note is null or char_length(btrim(decision_note)) between 1 and 300),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint refunds_idempotency unique (order_id, idempotency_key),
  constraint refunds_processed_coherent check ((status = 'processed') = (processed_at is not null)),
  constraint refunds_reject_note check (status <> 'rejected' or decision_note is not null)
);
create index if not exists refunds_order_idx on public.refunds (order_id);
create index if not exists refunds_status_idx on public.refunds (status, created_at);
drop trigger if exists refunds_set_updated_at on public.refunds;
create trigger refunds_set_updated_at before update on public.refunds
  for each row execute function public.set_updated_at();

create table if not exists public.refund_items (
  id            uuid primary key default gen_random_uuid(),
  refund_id     uuid not null references public.refunds (id) on delete restrict,
  order_item_id uuid not null references public.order_items (id) on delete restrict,
  qty           int not null check (qty >= 1),
  amount        numeric not null check (amount >= 0),
  constraint refund_items_once unique (refund_id, order_item_id)
);
create index if not exists refund_items_item_idx on public.refund_items (order_item_id);

-- ── 7. Permisos de las tablas nuevas: solo el administrador LEE; nadie escribe desde el navegador ──
select public._apply_admin_rls('blacklist_entries', null, null);
select public._apply_admin_rls('order_notes', null, null);
select public._apply_admin_rls('order_edits', null, null);
select public._apply_admin_rls('order_incidents', null, null);
select public._apply_admin_rls('order_returns', null, null);
select public._apply_admin_rls('order_return_items', null, null);
select public._apply_admin_rls('refunds', null, null);
select public._apply_admin_rls('refund_items', null, null);
revoke insert, update on public.blacklist_entries, public.order_notes, public.order_edits, public.order_incidents,
  public.order_returns, public.order_return_items, public.refunds, public.refund_items from service_role;

-- Libros inmutables: las notas y las ediciones no se cambian ni se borran (los demás se actualizan solo por funciones).
do $$
declare t text;
begin
  foreach t in array array['order_notes', 'order_edits'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_immutable_trg', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.immutable_row()',
                   t || '_immutable_trg', t);
  end loop;
  foreach t in array array['order_notes', 'order_edits', 'blacklist_entries', 'order_incidents', 'order_returns', 'order_return_items',
                           'refunds', 'refund_items'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.immutable_row()',
                   t || '_no_truncate', t);
  end loop;
  foreach t in array array['blacklist_entries', 'order_incidents', 'order_returns', 'order_return_items', 'refund_items'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_no_delete', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.immutable_row()',
                   t || '_no_delete', t);
  end loop;
end $$;

-- Auditoría (BR-ADM-03): quién cambió qué. Los datos personales (cuenta, teléfono, correo) solo constan como «cambiaron».
drop trigger if exists audit_blacklist_entries on public.blacklist_entries;
create trigger audit_blacklist_entries after insert or update or delete on public.blacklist_entries
  for each row execute function public.audit_changes('phone_e164', 'email');
drop trigger if exists audit_order_incidents on public.order_incidents;
create trigger audit_order_incidents after insert or update or delete on public.order_incidents
  for each row execute function public.audit_changes();
drop trigger if exists audit_order_returns on public.order_returns;
create trigger audit_order_returns after insert or update or delete on public.order_returns
  for each row execute function public.audit_changes();
drop trigger if exists audit_order_return_items on public.order_return_items;
create trigger audit_order_return_items after insert or update or delete on public.order_return_items
  for each row execute function public.audit_changes();
drop trigger if exists audit_refunds on public.refunds;
create trigger audit_refunds after insert or update or delete on public.refunds
  for each row execute function public.audit_changes('destination');
drop trigger if exists audit_refund_items on public.refund_items;
create trigger audit_refund_items after insert or update or delete on public.refund_items
  for each row execute function public.audit_changes();

-- ── 8. Guardas: el pedido solo se edita por `admin_edit_order` ─────────────────────────────
-- Con la bandera `app.order_edit` (solo la enciende esa función, dentro de su transacción) pueden cambiar los importes, las
-- líneas, el contacto y la dirección. El número, la clienta, la moneda, el método de pago, la franja y el canal NUNCA cambian.
create or replace function public.orders_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- `cart_id` también: `on delete set null` actualiza la fila cuando un pgTAP antiguo borra carritos (no es un cambio del pedido).
  v_free text[] := array['status', 'updated_at', 'paid_at', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'reminder_sent_at',
                         'cart_id', 'payment_expires_at'];
  v_edit text[] := array['subtotal', 'discount_total', 'shipping_cost', 'shipping_discount', 'total', 'contact_name', 'contact_email',
                         'contact_phone', 'shipping_address', 'shipping_method', 'discounts', 'edited_at', 'edit_count'];
begin
  if tg_op = 'DELETE' then
    raise exception 'los pedidos no se borran' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and coalesce(current_setting('app.order_transition', true), '') <> '1' then
    raise exception 'el estado del pedido solo cambia con transition_order_status' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.order_edit', true), '') = '1' then
    v_free := v_free || v_edit;
  end if;
  if (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
    raise exception 'el pedido es una instantánea: solo cambian su estado y sus fechas' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Las líneas: nacen con el pedido; solo `admin_edit_order` puede cambiar su cantidad e importes (o quitarlas). Nunca el producto,
-- el precio unitario ni el costo: eso es la instantánea (BR-ORD-06).
create or replace function public.order_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.order_edit', true), '') <> '1' then
    raise exception 'la tabla % es un registro inmutable', tg_table_name using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['qty', 'line_total', 'discount', 'final_total', 'discount_offers'])
       is distinct from (to_jsonb(old) - array['qty', 'line_total', 'discount', 'final_total', 'discount_offers']) then
      raise exception 'la línea es una instantánea: solo cambian su cantidad y sus importes' using errcode = '42501';
    end if;
    return new;
  end if;
  return old;
end;
$$;
drop trigger if exists order_items_immutable_trg on public.order_items;
create trigger order_items_immutable_trg before update or delete on public.order_items
  for each row execute function public.order_items_guard();

-- ── 9. Matriz de transiciones (BR-ORD-01/02) ────────────────────────────────────────────────
-- Respecto a S11, el administrador suma tres: enviado → cancelado (contra entrega rechazado, paquete perdido; el stock vuelve),
-- entregado → reembolsado y completado → reembolsado (devolución total). «Reembolsado» solo lo marca el flujo de reembolsos.
create or replace function public._order_transition_ok(p_from text, p_to text, p_actor_kind text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_actor_kind
    when 'admin' then (p_from, p_to) in (
      ('pending_payment', 'paid'), ('pending_payment', 'cancelled'), ('paid', 'preparing'), ('paid', 'cancelled'),
      ('preparing', 'shipped'), ('preparing', 'cancelled'), ('shipped', 'delivered'), ('shipped', 'cancelled'),
      ('delivered', 'completed'), ('cancelled', 'refunded'), ('delivered', 'refunded'), ('completed', 'refunded'))
    when 'customer' then p_to = 'cancelled' and p_from in ('pending_payment', 'paid')
    -- El sistema vence pedidos sin pagar y CONFIRMA los pagos que el proveedor avisa (S11).
    when 'system' then (p_from, p_to) in (('pending_payment', 'cancelled'), ('pending_payment', 'paid'))
    else false end
$$;

-- ── 10. Lista negra ─────────────────────────────────────────────────────────────────────────
-- ¿Esta cuenta (o este teléfono/correo) está bloqueada? Vale el interruptor del perfil (S1) y las entradas activas por cuenta,
-- teléfono o correo: abrir otra cuenta con los mismos datos no evita el bloqueo. Solo la usa el servidor (checkout y pedidos manuales).
create or replace function public.is_blacklisted(p_profile_id uuid, p_phone text default null, p_email text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with prof as (select p.blacklisted, p.phone_e164, p.email from public.profiles p where p.id = p_profile_id)
  select coalesce((select prof.blacklisted from prof), false)
      or exists (
        select 1 from public.blacklist_entries b
         where b.is_active
           and ((b.kind = 'profile' and b.profile_id = p_profile_id)
             or (b.kind = 'phone' and b.phone_e164 is not null
                 and b.phone_e164 in (coalesce(p_phone, ''), coalesce((select prof.phone_e164 from prof), '')))
             or (b.kind = 'email' and b.email is not null
                 and b.email in (lower(coalesce(p_email, '')), coalesce((select prof.email from prof), '')))))
$$;

-- ── 11. Dinero del pedido ───────────────────────────────────────────────────────────────────
-- Lo EFECTIVAMENTE pagado (BR-PRC-04): cobros pagados (y los que ya reembolsamos), más el monto recibido de un cobro que quedó
-- sin confirmar (llegó un monto distinto y el pedido se canceló: ese dinero existe). La contra entrega solo cuenta cobrada.
-- Un cobro en disputa no cuenta (el banco ya se lo llevó).
create or replace function public._order_paid_amount(p_order_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case
    when p.status in ('paid', 'refunded') and (p.provider <> 'cash_on_delivery' or p.collected_at is not null)
      then coalesce(p.received_amount, p.amount)
    when p.status in ('initiated', 'pending', 'cancelled', 'expired') and p.received_amount is not null
      then p.received_amount
    else 0 end), 0)
    from public.payments p
   where p.order_id = p_order_id
$$;

-- Lo ya devuelto o comprometido a devolver (solicitado, aprobado o procesado; no el rechazado).
create or replace function public._order_refunded_amount(p_order_id uuid, p_only_processed boolean default false)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(r.amount), 0) from public.refunds r
   where r.order_id = p_order_id
     and case when p_only_processed then r.status = 'processed' else r.status in ('requested', 'approved', 'processed') end
$$;

-- Saldo del pedido: positivo = falta cobrar; negativo = el cliente pagó de más y hay que devolver. Un pedido cancelado o
-- reembolsado no tiene saldo (lo que sobra se devuelve con un reembolso); la contra entrega sin cobrar tampoco debe nada todavía.
-- Los reembolsos POR PRODUCTOS (o por cancelación) no crean saldo: devolver una prenda baja lo que la tienda merece cobrar en la
-- misma medida en que baja lo que se pagó. Solo los reembolsos de MONTO LIBRE (diferencias, excedentes) o hechos por el proveedor
-- sacan dinero sin bajar lo que el pedido vale: esos sí entran en la cuenta.
create or replace function public._order_balance(p_order_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when o.status in ('cancelled', 'refunded', 'pending_payment') then 0
    when exists (select 1 from public.payments p where p.order_id = o.id and p.provider = 'cash_on_delivery'
                    and p.collected_at is null) then 0
    else o.total - public._order_paid_amount(o.id)
         + coalesce((select sum(r.amount) from public.refunds r
                      where r.order_id = o.id and r.kind in ('amount', 'provider') and r.status <> 'rejected'), 0) end
    from public.orders o where o.id = p_order_id
$$;

-- Stock que un administrador puede sumar a un pedido: lo físico menos lo retenido (sin vencer) en carritos.
create or replace function public._order_stock_free(p_variant_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(v.stock_on_hand - coalesce((select sum(sr.qty) from public.stock_reservations sr
                                               where sr.variant_id = v.id and sr.status = 'active'
                                                 and (sr.expires_at is null or sr.expires_at > now())), 0), 0)::int
    from public.product_variants v where v.id = p_variant_id
$$;

-- Valida y limpia una dirección escrita por un administrador (mismas claves que la instantánea de S10). NULL = inválida.
create or replace function public._order_address_clean(p_addr jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_line1 text;
  v_city text;
  v_recipient text;
  v_phone text;
  v_country text;
  v_line2 text;
  v_dep text;
  v_ref text;
  v_lat numeric;
  v_lng numeric;
begin
  if p_addr is null or jsonb_typeof(p_addr) <> 'object' then
    return null;
  end if;
  v_line1 := btrim(coalesce(p_addr ->> 'line1', ''));
  v_city := btrim(coalesce(p_addr ->> 'city', ''));
  v_recipient := btrim(coalesce(p_addr ->> 'recipient', ''));
  v_phone := p_addr ->> 'phone_e164';
  v_country := coalesce(nullif(btrim(p_addr ->> 'country'), ''), 'BO');
  v_line2 := nullif(btrim(coalesce(p_addr ->> 'line2', '')), '');
  v_dep := nullif(btrim(coalesce(p_addr ->> 'department', '')), '');
  v_ref := nullif(btrim(coalesce(p_addr ->> 'reference_text', '')), '');
  if char_length(v_line1) not between 3 and 200 or char_length(v_city) not between 2 and 80
     or char_length(v_recipient) not between 1 and 120 or v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$'
     or v_country !~ '^[A-Z]{2}$' or not exists (select 1 from public.countries c where c.code = v_country)
     or char_length(coalesce(v_line2, '')) > 200 or char_length(coalesce(v_dep, '')) > 80 or char_length(coalesce(v_ref, '')) > 300 then
    return null;
  end if;
  if (p_addr ->> 'lat') is not null or (p_addr ->> 'lng') is not null then
    if (p_addr ->> 'lat') !~ '^-?[0-9]{1,3}(\.[0-9]+)?$' or (p_addr ->> 'lng') !~ '^-?[0-9]{1,3}(\.[0-9]+)?$' then
      return null;
    end if;
    v_lat := (p_addr ->> 'lat')::numeric;
    v_lng := (p_addr ->> 'lng')::numeric;
    if v_lat not between -90 and 90 or v_lng not between -180 and 180 then
      return null;
    end if;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('recipient', v_recipient, 'phone_e164', v_phone, 'line1', v_line1, 'line2', v_line2,
    'city', v_city, 'department', v_dep, 'country', v_country, 'reference_text', v_ref, 'lat', v_lat, 'lng', v_lng));
end;
$$;

-- ── 12. El libro de reembolsos: tope y progresión de estados ────────────────────────────────
-- Defensa en profundidad: aunque una función se equivocara, el libro NO acepta más reembolsos que lo pagado, no cambia lo ya
-- escrito (importe, motivo, tipo…) y los estados solo avanzan: solicitado → aprobado → procesado, o → rechazado.
create or replace function public.refunds_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid numeric;
  v_other numeric;
begin
  if tg_op = 'DELETE' then
    raise exception 'los reembolsos no se borran' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.status not in ('requested', 'approved', 'processed') then
      raise exception 'un reembolso nace solicitado, aprobado o procesado' using errcode = '22023';
    end if;
  else
    if (to_jsonb(new) - array['status', 'method', 'destination', 'external_ref', 'processed_by', 'processed_at', 'decision_note',
                              'updated_at'])
       is distinct from (to_jsonb(old) - array['status', 'method', 'destination', 'external_ref', 'processed_by', 'processed_at',
                                               'decision_note', 'updated_at']) then
      raise exception 'el reembolso es un registro: solo cambian su estado y los datos de cómo se devolvió' using errcode = '42501';
    end if;
    if new.status is distinct from old.status
       and not ((old.status, new.status) in (('requested', 'approved'), ('requested', 'processed'), ('requested', 'rejected'),
                                              ('approved', 'processed'), ('approved', 'rejected'))) then
      raise exception 'transición de reembolso inválida: % → %', old.status, new.status using errcode = '22023';
    end if;
  end if;
  if new.status <> 'rejected' then
    -- El pedido se bloquea primero: dos reembolsos a la vez se turnan (el segundo ve al primero).
    perform 1 from public.orders o where o.id = new.order_id for update;
    v_paid := public._order_paid_amount(new.order_id);
    select coalesce(sum(r.amount), 0) into v_other from public.refunds r
     where r.order_id = new.order_id and r.id <> new.id and r.status <> 'rejected';
    if v_other + new.amount > v_paid then
      raise exception 'el reembolso (%) supera lo pagado (%) menos lo ya devuelto (%)', new.amount, v_paid, v_other
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists refunds_guard_trg on public.refunds;
create trigger refunds_guard_trg before insert or update or delete on public.refunds
  for each row execute function public.refunds_guard();

-- ── 12b. Funciones de S10 y S11 que cambian (copiadas tal cual, con un parche cada una) ─────────
-- · `_checkout_compute`: la lista negra la decide `is_blacklisted()` (cuenta, teléfono o correo).
-- · `transition_order_status`: una contra entrega confirmada y nunca cobrada, al cancelarse, deja su cobro cancelado.
-- · `payment_apply_event`: el reembolso que avisa el proveedor entra al libro de reembolsos.
drop function if exists public._checkout_compute(uuid, uuid, uuid, uuid, text, uuid, date, text, int);
create or replace function public._checkout_compute(
  p_profile_id uuid, p_cart_id uuid, p_address_id uuid, p_tax_profile_id uuid, p_shipping_method text,
  p_slot_id uuid, p_delivery_date date, p_payment_method text, p_list_days int default 1,
  p_require_payment boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
  v_snap jsonb;
  v_lines jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_currency text;
  v_dec int;
  v_subtotal numeric;
  v_method record;
  v_addr record;
  v_quote jsonb;
  v_ship_cost numeric;
  v_eval jsonb;
  v_totals jsonb;
  v_grand numeric;
  v_pm record;
  v_avail boolean;
  v_why text;
  v_methods jsonb := '[]'::jsonb;
  v_chosen jsonb;
  v_tax jsonb;
  v_tax_row record;
  v_addr_snap jsonb;
  v_slot_snap jsonb;
  v_country text := 'BO';
  v_rate numeric;
  v_base text;
begin
  select * into v_profile from public.profiles where id = p_profile_id;
  v_snap := public._cart_snapshot(p_cart_id);
  if v_snap is null or jsonb_array_length(v_snap -> 'lines') = 0 then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('code', 'cart_empty', 'field', 'cart')));
  end if;
  v_lines := v_snap -> 'lines';
  v_currency := v_snap ->> 'currency';
  select cu.decimals into v_dec from public.currencies cu where cu.code = v_currency;
  v_dec := coalesce(v_dec, 2);
  v_subtotal := (v_snap -> 'totals' ->> 'subtotal')::numeric;
  v_base := coalesce((select s.value #>> '{}' from public.store_settings s where s.key = 'base_currency'), 'BOB');
  v_rate := case when v_currency = v_base then 1 else public.current_rate(v_base, v_currency) end;

  -- Envío: método y destino. Un método de recojo no necesita dirección.
  select * into v_method from public.shipping_methods m where m.code = p_shipping_method and m.is_active and m.archived_at is null;
  if p_shipping_method is null or not found then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'method_not_found', 'field', 'shipping_method'));
  elsif v_method.kind = 'delivery' then
    if p_address_id is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'address_required', 'field', 'address'));
    else
      select * into v_addr from public.addresses a
       where a.id = p_address_id and a.profile_id = p_profile_id and a.archived_at is null and a.for_shipping;
      if not found then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'address_invalid', 'field', 'address'));
      else
        v_country := v_addr.country;
        v_addr_snap := jsonb_build_object('id', v_addr.id, 'recipient', v_addr.recipient, 'phone_e164', v_addr.phone_e164,
          'line1', v_addr.line1, 'line2', v_addr.line2, 'city', v_addr.city, 'department', v_addr.department,
          'country', v_addr.country, 'reference_text', v_addr.reference_text, 'lat', v_addr.lat, 'lng', v_addr.lng);
        v_quote := public.quote_shipping(p_shipping_method, v_addr.lat, v_addr.lng, v_addr.city, v_subtotal, v_currency,
                                         p_delivery_date, p_slot_id, p_list_days);
      end if;
    end if;
  else
    v_quote := public.quote_shipping(p_shipping_method, null, null, null, v_subtotal, v_currency, null, null, p_list_days);
  end if;
  if v_quote is not null then
    if coalesce((v_quote ->> 'ok')::boolean, false) then
      v_ship_cost := (v_quote ->> 'cost')::numeric;
      v_slot_snap := case when v_method.kind = 'delivery' and v_quote -> 'selected' is not null
                               and v_quote -> 'selected' <> 'null'::jsonb then v_quote -> 'selected' end;
    else
      v_errors := v_errors || coalesce(v_quote -> 'errors', '[]'::jsonb);
    end if;
  end if;

  -- Descuentos (S9) sobre el envío ya cotizado: el servidor recalcula, el cliente solo manda el código.
  v_eval := public.apply_discounts(p_cart_id, null, v_ship_cost);
  v_totals := v_eval -> 'totals';
  v_grand := case when v_ship_cost is null then null else
    round((v_totals ->> 'subtotal')::numeric - (v_totals ->> 'discount')::numeric + v_ship_cost
          - (v_totals ->> 'shipping_discount')::numeric, v_dec) end;

  -- Datos fiscales (opcionales, BR-ACC-06)
  if p_tax_profile_id is not null then
    select * into v_tax_row from public.tax_profiles t
     where t.id = p_tax_profile_id and t.profile_id = p_profile_id and t.archived_at is null;
    if not found then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'tax_profile_invalid', 'field', 'tax_profile'));
    else
      v_tax := jsonb_build_object('id', v_tax_row.id, 'doc_type', v_tax_row.doc_type, 'doc_number', v_tax_row.doc_number,
                                  'legal_name', v_tax_row.legal_name);
    end if;
  end if;

  -- Métodos de pago del país (el selector lo dirige la configuración, BR-PAY-02)
  for v_pm in
    select * from public.payment_methods m where m.country = v_country and m.is_active and m.archived_at is null
     order by m.sort_order, m.code
  loop
    v_avail := true;
    v_why := null;
    if v_pm.blocked_for_blacklisted and public.is_blacklisted(p_profile_id, null, null) then
      v_avail := false; v_why := 'not_available';     -- S-07: no se le dice a la clienta que está en la lista negra
    elsif v_pm.max_amount is not null and v_grand is not null and v_grand > v_pm.max_amount then
      v_avail := false; v_why := 'over_max_amount';
    end if;
    v_methods := v_methods || jsonb_build_array(jsonb_build_object(
      'code', v_pm.code, 'provider', v_pm.provider, 'name', v_pm.name, 'description', v_pm.description,
      'available', v_avail, 'reason', v_why, 'max_amount', v_pm.max_amount, 'window_minutes', v_pm.window_minutes));
    if p_payment_method is not null and v_pm.code = p_payment_method then
      v_chosen := v_methods -> (jsonb_array_length(v_methods) - 1);
    end if;
  end loop;
  if p_payment_method is null then
    if p_require_payment then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'payment_method_required', 'field', 'payment_method'));
    end if;
  elsif v_chosen is null or not (v_chosen ->> 'available')::boolean then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'payment_unavailable', 'field', 'payment_method',
                                                                  'reason', v_chosen ->> 'reason'));
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_errors) = 0,
    'errors', v_errors,
    'currency', v_currency, 'decimals', v_dec, 'country', v_country, 'base_currency', v_base, 'exchange_rate', v_rate,
    'can_checkout', (v_snap ->> 'can_checkout')::boolean,
    'lines', v_lines,
    'totals', jsonb_build_object(
      'subtotal', (v_totals ->> 'subtotal')::numeric, 'discount', (v_totals ->> 'discount')::numeric,
      'shipping', v_ship_cost, 'shipping_discount', (v_totals ->> 'shipping_discount')::numeric, 'total', v_grand),
    'discounts', jsonb_build_object('applied', v_eval -> 'applied', 'rejected', v_eval -> 'rejected',
                                    'coupon', v_eval -> 'coupon', 'free_shipping', v_eval -> 'free_shipping'),
    'shipping', jsonb_build_object('method', case when v_method.id is not null then jsonb_build_object(
                  'code', v_method.code, 'name', v_method.name, 'kind', v_method.kind, 'description', v_method.description,
                  'eta_min_days', v_method.eta_min_days, 'eta_max_days', v_method.eta_max_days) end,
                'quote', v_quote, 'address', v_addr_snap, 'slot', v_slot_snap),
    'tax_profile', v_tax,
    'payment', jsonb_build_object('methods', v_methods, 'chosen', v_chosen));
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
    -- Contra entrega confirmada pero nunca cobrada: no hay dinero que devolver, el cobro queda cancelado (S12, BR-PAY-07).
    update public.payments set status = 'cancelled'
     where order_id = p_order_id and provider = 'cash_on_delivery' and status = 'paid' and collected_at is null;
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
  v_refund_amount numeric;
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
      -- S12: lo que el proveedor devolvió también entra al libro de reembolsos, para que no se pueda devolver dos veces lo mismo.
      v_refund_amount := least(coalesce(p_amount, v_pay.received_amount, v_pay.amount),
                               public._order_paid_amount(o.id) - public._order_refunded_amount(o.id));
      if v_refund_amount > 0 then
        insert into public.refunds (order_id, payment_id, kind, amount, currency, reason, status, method, idempotency_key,
                                    processed_at)
        values (o.id, v_pay.id, 'provider', v_refund_amount, v_pay.currency, 'Reembolso informado por el proveedor', 'processed',
                'provider', 'prov:' || p_provider || ':' || regexp_replace(left(p_event_id, 150), '[^A-Za-z0-9_:.-]', '_', 'g'), now());
        perform public._refund_settle(o.id, p_actor);
      end if;
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

-- ── 13. Lectura del administrador (el navegador no puede leer el motivo ni el autor del historial) ──
create or replace function public.admin_order_history(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id, 'from_status', h.from_status, 'to_status', h.to_status, 'actor_kind', h.actor_kind,
             'actor_id', h.actor_id, 'actor_name', pr.full_name, 'reason', h.reason, 'created_at', h.created_at)
           order by h.id)
      from public.order_status_history h
      left join public.profiles pr on pr.id = h.actor_id
     where h.order_id = p_order_id), '[]'::jsonb);
end;
$$;

-- Contadores por estado para las pestañas de la bandeja.
create or replace function public.admin_orders_status_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  return coalesce((select jsonb_object_agg(s.status, s.n) from (
            select o.status, count(*)::int as n from public.orders o group by o.status) s), '{}'::jsonb);
end;
$$;

-- ── 14. «Atención requerida» ────────────────────────────────────────────────────────────────
-- Un pedido puede aparecer en varias categorías. Todo se deduce de los datos (no hay una cola aparte que se desincronice).
create or replace function public._attention_rows()
returns table (kind text, order_id uuid, since timestamptz, detail jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  -- WhatsApp y contra entrega no vencen (S-05): se avisan cuando llevan demasiado sin confirmarse.
  select 'stale_pending'::text, o.id, o.created_at, jsonb_build_object('provider', o.payment_provider)
    from public.orders o
   where o.status = 'pending_payment' and o.payment_expires_at is null
     and o.created_at <= now() - make_interval(hours => public.setting_int('order_reminder_hours', 24))
  union all
  select 'proof_pending', pp.order_id, min(pp.created_at), jsonb_build_object('count', count(*))
    from public.payment_proofs pp where pp.status = 'pending' group by pp.order_id
  union all
  select 'review_open', p.order_id, min(r.opened_at), jsonb_build_object('reasons', jsonb_agg(distinct r.reason))
    from public.payment_reviews r join public.payments p on p.id = r.payment_id
   where r.status = 'open' group by p.order_id
  -- Contracargo (S-06): el pedido no debe despacharse hasta resolverlo.
  union all
  select 'payment_disputed', o.id, o.updated_at, '{}'::jsonb
    from public.orders o
   where o.status in ('paid', 'preparing', 'shipped')
     and exists (select 1 from public.payments p where p.order_id = o.id and p.status = 'disputed')
  union all
  select 'refund_pending', r.order_id, min(r.created_at), jsonb_build_object('amount', sum(r.amount))
    from public.refunds r where r.status in ('requested', 'approved') group by r.order_id
  -- Dinero que hay que devolver: un pedido cancelado con pago sin reembolsar, o pagado de más tras una edición.
  union all
  select 'refund_due', d.id, d.since, jsonb_build_object('amount', d.due)
    from (select o.id, coalesce(o.cancelled_at, o.updated_at) as since,
                 case when o.status in ('cancelled') then public._order_paid_amount(o.id) - public._order_refunded_amount(o.id)
                      when o.status in ('paid', 'preparing', 'shipped', 'delivered', 'completed') then -public._order_balance(o.id)
                      else 0 end as due
            from public.orders o
           where o.status in ('cancelled', 'paid', 'preparing', 'shipped', 'delivered', 'completed')
             and exists (select 1 from public.payments p where p.order_id = o.id
                          and (p.received_amount is not null or p.status in ('paid', 'refunded')))) d
   where d.due > 0
  -- Falta cobrar (tras una edición que subió el total).
  union all
  select 'balance_due', d.id, d.since, jsonb_build_object('amount', d.bal)
    from (select o.id, o.updated_at as since, public._order_balance(o.id) as bal
            from public.orders o where o.status in ('paid', 'preparing', 'shipped', 'delivered', 'completed')) d
   where d.bal > 0
  -- Contra entrega entregada y sin cobro ni rechazo registrado (BR-PAY-07).
  union all
  select 'cod_uncollected', o.id, o.updated_at, '{}'::jsonb
    from public.orders o
   where o.status in ('delivered', 'completed')
     and exists (select 1 from public.payments p where p.order_id = o.id and p.provider = 'cash_on_delivery'
                  and p.status = 'paid' and p.collected_at is null)
  union all
  select 'incident_open', i.order_id, min(i.opened_at), jsonb_build_object('count', count(*))
    from public.order_incidents i where i.status <> 'resolved' group by i.order_id
  union all
  select 'return_open', r.order_id, min(r.opened_at), jsonb_build_object('count', count(*))
    from public.order_returns r where r.status = 'open' group by r.order_id
$$;

create or replace function public.admin_attention_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  select coalesce(jsonb_object_agg(a.kind, a.n), '{}'::jsonb) into v
    from (select r.kind, count(*)::int as n from public._attention_rows() r group by r.kind) a;
  return v || jsonb_build_object('orders', (select count(distinct r.order_id)::int from public._attention_rows() r));
end;
$$;

create or replace function public.admin_attention_orders()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'kind', r.kind, 'order_id', o.id, 'number', o.number, 'status', o.status, 'contact_name', o.contact_name,
             'total', o.total, 'currency', o.currency, 'created_at', o.created_at, 'since', r.since, 'detail', r.detail)
           order by r.since, o.number)
      from (select * from public._attention_rows() limit 500) r
      join public.orders o on o.id = r.order_id), '[]'::jsonb);
end;
$$;

-- ── 15. Notas internas, avanzar con un clic y deshacer ──────────────────────────────────────
create or replace function public.admin_add_order_note(p_order_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_id bigint;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if char_length(v_body) not between 1 and 2000 then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'body_invalid')));
  end if;
  if not exists (select 1 from public.orders o where o.id = p_order_id) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  insert into public.order_notes (order_id, author_id, body) values (p_order_id, auth.uid(), v_body) returning id into v_id;
  return jsonb_build_object('outcome', 'added', 'id', v_id);
end;
$$;

-- Avanza el pedido. `p_expected_from` es el estado que la persona VIO: si otro administrador ya lo movió, responde `stale` (bloqueo
-- optimista) en vez de aplicar sobre algo que ya no es lo que se miraba. «Reembolsado» solo lo marca el flujo de reembolsos
-- (no se puede declarar devuelto un dinero que no se devolvió). Con un contracargo abierto no se prepara ni se envía (S-06).
drop function if exists public.admin_transition_order(uuid, text, text);
create or replace function public.admin_transition_order(
  p_order_id uuid, p_to text, p_reason text default null, p_expected_from text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if p_to = 'refunded' then
    return jsonb_build_object('ok', false, 'outcome', 'use_refund');
  end if;
  select o.status into v_status from public.orders o where o.id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  if p_expected_from is not null and v_status <> p_expected_from then
    return jsonb_build_object('ok', false, 'outcome', 'stale', 'current', v_status);
  end if;
  if p_to in ('preparing', 'shipped')
     and exists (select 1 from public.payments p where p.order_id = p_order_id and p.status = 'disputed') then
    return jsonb_build_object('ok', false, 'outcome', 'payment_disputed');
  end if;
  return public.transition_order_status(p_order_id, p_to, auth.uid(), 'admin', p_reason);
end;
$$;

-- Deshace el ÚLTIMO cambio de estado si es seguro: dentro de la ventana (`order_undo_window_minutes`), solo hacia atrás en el
-- flujo normal, sin dinero ni stock de por medio. Queda en el historial como un cambio más (nada se borra).
create or replace function public.admin_undo_transition(p_order_id uuid, p_expected_status text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  h record;
  v_window int := public.setting_int('order_undo_window_minutes', 5);
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  select * into o from public.orders x where x.id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  if p_expected_status is not null and o.status <> p_expected_status then
    return jsonb_build_object('ok', false, 'outcome', 'stale', 'current', o.status);
  end if;
  select * into h from public.order_status_history x where x.order_id = p_order_id order by x.id desc limit 1;
  if not found or h.to_status <> o.status or h.from_status is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_undoable');
  end if;
  -- Solo los pasos del flujo normal que no mueven stock, cupones ni dinero.
  if (h.from_status, h.to_status) not in (('paid', 'preparing'), ('preparing', 'shipped'), ('shipped', 'delivered'),
                                           ('delivered', 'completed')) then
    return jsonb_build_object('ok', false, 'outcome', 'not_undoable');
  end if;
  if h.actor_kind <> 'admin' or h.created_at < now() - make_interval(mins => v_window) then
    return jsonb_build_object('ok', false, 'outcome', 'window_expired', 'window_minutes', v_window);
  end if;
  -- Un cobro contra entrega ya registrado no se deshace con la entrega.
  if h.to_status in ('delivered', 'completed')
     and exists (select 1 from public.payments p where p.order_id = p_order_id and p.collected_at is not null) then
    return jsonb_build_object('ok', false, 'outcome', 'not_undoable');
  end if;
  perform set_config('app.order_transition', '1', true);
  update public.orders set status = h.from_status, updated_at = now() where id = p_order_id;
  perform set_config('app.order_transition', '', true);
  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_kind, reason)
  values (p_order_id, h.to_status, h.from_status, auth.uid(), 'admin', 'Deshacer: ' || h.from_status || ' → ' || h.to_status);
  return jsonb_build_object('ok', true, 'outcome', 'undone', 'from', h.to_status, 'to', h.from_status);
end;
$$;

-- ── 16. Lista negra: alta, baja y coincidencias ─────────────────────────────────────────────
-- Las cuentas que ya tenían el interruptor de S1 pasan a tener su entrada (desde ahora el interruptor refleja las entradas).
insert into public.blacklist_entries (kind, profile_id, reason)
select 'profile', p.id, 'Marcada antes de la lista negra (Sprint 12)'
  from public.profiles p
 where p.blacklisted
   and not exists (select 1 from public.blacklist_entries b where b.kind = 'profile' and b.profile_id = p.id and b.is_active);

create or replace function public.admin_blacklist_add(
  p_kind text, p_profile_id uuid, p_phone text, p_email text, p_reason text, p_order_id uuid default null,
  p_include_contacts boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_prof record;
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if char_length(v_reason) not between 1 and 300 then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'reason_required')));
  end if;
  if p_order_id is not null and not exists (select 1 from public.orders o where o.id = p_order_id) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if p_kind = 'profile' then
    select * into v_prof from public.profiles p where p.id = p_profile_id;
    if not found then
      return jsonb_build_object('outcome', 'not_found');
    end if;
    if v_prof.role = 'admin' then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'cannot_blacklist_admin')));
    end if;
    insert into public.blacklist_entries (kind, profile_id, reason, source_order_id, created_by)
    values ('profile', p_profile_id, v_reason, p_order_id, auth.uid())
    on conflict (profile_id) where is_active and kind = 'profile' do nothing
    returning id into v_id;
    if v_id is not null then
      v_ids := v_ids || v_id;
      update public.profiles set blacklisted = true where id = p_profile_id and not blacklisted;
    end if;
    if p_include_contacts then
      if v_prof.phone_e164 is not null then
        v_id := null;
        insert into public.blacklist_entries (kind, phone_e164, reason, source_order_id, created_by)
        values ('phone', v_prof.phone_e164, v_reason, p_order_id, auth.uid())
        on conflict (phone_e164) where is_active and kind = 'phone' do nothing returning id into v_id;
        if v_id is not null then v_ids := v_ids || v_id; end if;
      end if;
      if v_prof.email is not null then
        v_id := null;
        insert into public.blacklist_entries (kind, email, reason, source_order_id, created_by)
        values ('email', v_prof.email, v_reason, p_order_id, auth.uid())
        on conflict (email) where is_active and kind = 'email' do nothing returning id into v_id;
        if v_id is not null then v_ids := v_ids || v_id; end if;
      end if;
    end if;
  elsif p_kind = 'phone' then
    if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'phone_invalid')));
    end if;
    insert into public.blacklist_entries (kind, phone_e164, reason, source_order_id, created_by)
    values ('phone', v_phone, v_reason, p_order_id, auth.uid())
    on conflict (phone_e164) where is_active and kind = 'phone' do nothing returning id into v_id;
    if v_id is not null then v_ids := v_ids || v_id; end if;
  elsif p_kind = 'email' then
    if v_email is null or char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'email_invalid')));
    end if;
    insert into public.blacklist_entries (kind, email, reason, source_order_id, created_by)
    values ('email', v_email, v_reason, p_order_id, auth.uid())
    on conflict (email) where is_active and kind = 'email' do nothing returning id into v_id;
    if v_id is not null then v_ids := v_ids || v_id; end if;
  else
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'kind_invalid')));
  end if;
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('outcome', 'already');
  end if;
  return jsonb_build_object('outcome', 'added', 'ids', to_jsonb(v_ids));
end;
$$;

create or replace function public.admin_blacklist_lift(p_entry_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if char_length(v_reason) not between 1 and 300 then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'reason_required')));
  end if;
  select * into e from public.blacklist_entries b where b.id = p_entry_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if not e.is_active then
    return jsonb_build_object('outcome', 'already_lifted');
  end if;
  update public.blacklist_entries set is_active = false, lifted_by = auth.uid(), lifted_at = now(), lift_reason = v_reason
   where id = p_entry_id;
  -- El interruptor del perfil refleja las entradas de cuenta: al levantar la última, se apaga.
  if e.kind = 'profile' then
    update public.profiles set blacklisted = false where id = e.profile_id and blacklisted;
  end if;
  return jsonb_build_object('outcome', 'lifted');
end;
$$;

-- Otras cuentas que comparten teléfono, correo o dirección con la clienta de un pedido (para sospechar de una evasión).
create or replace function public.admin_blacklist_matches(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o record;
  v_prof record;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  select * into o from public.orders x where x.id = p_order_id;
  if not found then
    return '[]'::jsonb;
  end if;
  select * into v_prof from public.profiles p where p.id = o.profile_id;
  return coalesce((
    select jsonb_agg(jsonb_build_object('profile_id', m.id, 'full_name', m.full_name, 'blacklisted', public.is_blacklisted(m.id),
                                        'reasons', m.reasons) order by m.full_name)
      from (
        select p.id, p.full_name, array_remove(array[
                 case when p.phone_e164 is not null and (p.phone_e164 = o.contact_phone or p.phone_e164 = v_prof.phone_e164) then 'same_phone' end,
                 case when p.email is not null and (p.email = o.contact_email or p.email = v_prof.email) then 'same_email' end], null) as reasons
          from public.profiles p
         where p.id <> o.profile_id and p.anonymized_at is null
           and ((p.phone_e164 is not null and (p.phone_e164 = o.contact_phone or p.phone_e164 = v_prof.phone_e164))
             or (p.email is not null and (p.email = o.contact_email or p.email = v_prof.email)))
        union
        select p.id, p.full_name, array['same_address']::text[]
          from public.orders x join public.profiles p on p.id = x.profile_id
         where x.profile_id <> o.profile_id and o.shipping_address is not null and x.shipping_address is not null
           and lower(btrim(x.shipping_address ->> 'line1')) = lower(btrim(o.shipping_address ->> 'line1'))
           and lower(btrim(x.shipping_address ->> 'city')) = lower(btrim(o.shipping_address ->> 'city'))
           and p.anonymized_at is null
      ) m limit 20), '[]'::jsonb);
end;
$$;

-- ── 17. Incidencias de entrega ──────────────────────────────────────────────────────────────
create or replace function public.admin_incident_open(
  p_order_id uuid, p_type text, p_description text, p_cost numeric default 0, p_borne_by text default 'store')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if p_type is null or p_type not in ('lost', 'damaged', 'wrong_address', 'absent', 'rejected')
     or coalesce(p_cost, 0) < 0 or coalesce(p_cost, 0) >= 1000000000
     or coalesce(p_borne_by, 'store') not in ('store', 'customer', 'carrier', 'none')
     or char_length(coalesce(v_desc, '')) > 1000 then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'incident_invalid')));
  end if;
  if not exists (select 1 from public.orders o where o.id = p_order_id) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  insert into public.order_incidents (order_id, type, description, cost_assumed, cost_borne_by, opened_by)
  values (p_order_id, p_type, v_desc, coalesce(p_cost, 0), coalesce(p_borne_by, 'store'), auth.uid()) returning id into v_id;
  return jsonb_build_object('outcome', 'opened', 'id', v_id);
end;
$$;

-- Seguimiento: pasa a «investigando» o se resuelve (con su resolución). Una incidencia resuelta no se reabre: se abre otra.
create or replace function public.admin_incident_update(
  p_id uuid, p_status text, p_resolution text default null, p_cost numeric default null, p_borne_by text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i record;
  v_res text := nullif(btrim(coalesce(p_resolution, '')), '');
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('investigating', 'resolved')
     or (p_cost is not null and (p_cost < 0 or p_cost >= 1000000000))
     or (p_borne_by is not null and p_borne_by not in ('store', 'customer', 'carrier', 'none'))
     or char_length(coalesce(v_res, '')) > 1000 then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'incident_invalid')));
  end if;
  select * into i from public.order_incidents x where x.id = p_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if i.status = 'resolved' then
    return jsonb_build_object('outcome', 'already_resolved');
  end if;
  if p_status = 'resolved' and v_res is null then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'resolution_required')));
  end if;
  update public.order_incidents
     set status = p_status, resolution = coalesce(v_res, resolution),
         cost_assumed = coalesce(p_cost, cost_assumed), cost_borne_by = coalesce(p_borne_by, cost_borne_by),
         resolved_by = case when p_status = 'resolved' then auth.uid() end,
         resolved_at = case when p_status = 'resolved' then now() end
   where id = p_id;
  return jsonb_build_object('outcome', case when p_status = 'resolved' then 'resolved' else 'updated' end);
end;
$$;

-- ── 18. Reembolsos: el cálculo ÚNICO ────────────────────────────────────────────────────────
-- No escribe nada. Lo usan la vista previa y la aplicación (misma cuenta por construcción). Quien quiera escribir bloquea antes el
-- pedido. Modos: `all` (todo lo pagado y aún no devuelto), `items` (por líneas, con envío y retención opcionales) y `amount` (un
-- monto libre: diferencia por una edición, excedente). Reglas:
--  · Nunca más de lo EFECTIVAMENTE pagado menos lo ya devuelto (BR-PRC-04).
--  · Por línea, el reembolso de k unidades de n es el acumulado round(final × m / n) menos lo ya devuelto de esa línea; la última
--    unidad toma el resto exacto. Así la suma de reembolsos parciales NUNCA excede lo que la línea costó (centavos incluidos).
--  · El envío se devuelve una sola vez, y solo lo que se pagó (costo − descuento de envío).
create or replace function public._refund_compute(
  p_order_id uuid, p_items jsonb, p_include_shipping boolean, p_deduction numeric, p_amount numeric, p_all boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o record;
  it record;
  x jsonb;
  v_dec int;
  v_mode text;
  v_paid numeric;
  v_refunded numeric;
  v_left numeric;
  v_errors jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_amount numeric := 0;
  v_ship numeric := 0;
  v_ded numeric := coalesce(p_deduction, 0);
  v_item uuid;
  v_qty int;
  v_prev_qty int;
  v_prev_amt numeric;
  v_cum numeric;
  v_line numeric;
  v_seen uuid[] := '{}';
  v_all_units boolean := true;
  v_prev_ship numeric;
begin
  select * into o from public.orders x2 where x2.id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('code', 'order_not_found')));
  end if;
  select coalesce((select c.decimals::int from public.currencies c where c.code = o.currency), 2) into v_dec;
  v_paid := public._order_paid_amount(p_order_id);
  v_refunded := public._order_refunded_amount(p_order_id);
  v_left := v_paid - v_refunded;
  v_mode := case when coalesce(p_all, false) then 'all' when p_amount is not null then 'amount' else 'items' end;

  if v_ded < 0 or v_ded >= 1000000000 or round(v_ded, v_dec) <> v_ded then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'deduction_invalid'));
  end if;

  if v_mode = 'all' then
    v_amount := v_left;
    if v_paid < o.total and o.status not in ('cancelled', 'refunded') then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'paid_less_than_total', 'paid', v_paid, 'total', o.total));
    end if;
  elsif v_mode = 'amount' then
    if p_amount <= 0 or p_amount >= 1000000000 or round(p_amount, v_dec) <> p_amount then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'amount_invalid'));
    else
      v_amount := p_amount;
    end if;
    v_ded := 0;
  else
    if p_items is not null and jsonb_typeof(p_items) <> 'array' then
      return jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('code', 'items_invalid')));
    end if;
    for x in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
      if jsonb_typeof(x) <> 'object' or (x ->> 'item_id') is null
         or (x ->> 'item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or (x ->> 'qty') is null or (x ->> 'qty') !~ '^[0-9]{1,6}$' then
        return jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('code', 'items_invalid')));
      end if;
      v_item := (x ->> 'item_id')::uuid;
      v_qty := (x ->> 'qty')::int;
      if v_item = any (v_seen) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'duplicate_item', 'item_id', v_item));
        continue;
      end if;
      v_seen := v_seen || v_item;
      select * into it from public.order_items i where i.id = v_item and i.order_id = p_order_id;
      if not found then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'item_not_found', 'item_id', v_item));
        continue;
      end if;
      select coalesce(sum(ri.qty), 0)::int, coalesce(sum(ri.amount), 0) into v_prev_qty, v_prev_amt
        from public.refund_items ri join public.refunds r on r.id = ri.refund_id
       where ri.order_item_id = it.id and r.status <> 'rejected';
      if v_qty < 1 or v_prev_qty + v_qty > it.qty then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'qty_exceeds', 'item_id', v_item,
                                                                       'max', greatest(it.qty - v_prev_qty, 0)));
        continue;
      end if;
      v_cum := case when v_prev_qty + v_qty = it.qty then it.final_total
                    else round(it.final_total * (v_prev_qty + v_qty) / it.qty, v_dec) end;
      v_line := greatest(v_cum - v_prev_amt, 0);
      if v_prev_qty + v_qty < it.qty then
        v_all_units := false;
      end if;
      v_amount := v_amount + v_line;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'item_id', it.id, 'line_no', it.line_no, 'variant_id', it.variant_id, 'name', it.product_name, 'qty', v_qty,
        'amount', v_line, 'max', it.qty - v_prev_qty));
    end loop;
    -- Las líneas que no se tocan siguen en el pedido: ¿se devuelve todo?
    if exists (select 1 from public.order_items i where i.order_id = p_order_id and i.id <> all (v_seen)) then
      v_all_units := false;
    end if;
    if coalesce(p_include_shipping, false) then
      select coalesce(sum(r.shipping_amount), 0) into v_prev_ship from public.refunds r
       where r.order_id = p_order_id and r.status <> 'rejected';
      v_ship := greatest(o.shipping_cost - o.shipping_discount - v_prev_ship, 0);
      v_amount := v_amount + v_ship;
    end if;
    if jsonb_array_length(v_lines) = 0 and v_ship = 0 and jsonb_array_length(v_errors) = 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'nothing_selected'));
    end if;
    -- Envío gratis condicionado a un monto: si se devuelve parte, es posible que la clienta ya no lo mereciera. Se avisa; la
    -- tienda decide si retiene algo (retención con motivo).
    if o.shipping_discount > 0 and not v_all_units then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'free_shipping_may_apply', 'shipping_discount', o.shipping_discount));
    end if;
  end if;

  if v_ded > v_amount then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'deduction_too_big'));
  else
    v_amount := v_amount - v_ded;
  end if;
  if v_amount <= 0 and jsonb_array_length(v_errors) = 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'nothing_to_refund'));
  end if;
  if v_amount > v_left and jsonb_array_length(v_errors) = 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'exceeds_paid', 'left', v_left));
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_errors) = 0, 'errors', v_errors, 'warnings', v_warn, 'mode', v_mode,
    'currency', o.currency, 'decimals', v_dec, 'paid', v_paid, 'refunded', v_refunded, 'left', v_left,
    'amount', v_amount, 'shipping_amount', v_ship, 'deduction', v_ded, 'left_after', v_left - v_amount, 'lines', v_lines);
end;
$$;

-- Cuando lo devuelto (ya procesado) cubre todo lo pagado, el pedido pasa a «reembolsado» (cancelado, entregado o completado).
create or replace function public._refund_settle(p_order_id uuid, p_actor uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_paid numeric := public._order_paid_amount(p_order_id);
begin
  select o.status into v_status from public.orders o where o.id = p_order_id;
  if v_paid > 0 and public._order_refunded_amount(p_order_id, true) >= v_paid then
    -- Todo lo pagado ya se devolvió: las revisiones «tardías» que S11 abre al cancelar un pedido con dinero recibido ya no tienen
    -- nada que decidir (sin esto, cancelar y reembolsar un pedido con QR dejaba una tarea pendiente en Pagos).
    update public.payment_reviews set status = 'resolved', resolved_by = p_actor, resolved_at = now(),
           note = 'Reembolso registrado: todo lo pagado ya se devolvió.'
     where status = 'open' and reason = 'late' and payment_id in (select p.id from public.payments p where p.order_id = p_order_id);
    if v_status in ('cancelled', 'delivered', 'completed') then
      perform public.transition_order_status(p_order_id, 'refunded', p_actor, 'admin', 'Reembolso total');
      return 'refunded';
    end if;
  end if;
  return v_status;
end;
$$;

-- ── 19. Cancelar y reembolsar ───────────────────────────────────────────────────────────────
create or replace function public.admin_refund_order(
  p_order_id uuid, p_idempotency_key text, p_mode text, p_items jsonb, p_include_shipping boolean, p_deduction numeric,
  p_amount numeric, p_reason text, p_method text, p_destination text, p_external_ref text, p_return_id uuid,
  p_cancel boolean, p_mark_processed boolean, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  r record;
  v_cmp jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_dest text := nullif(btrim(coalesce(p_destination, '')), '');
  v_ext text := nullif(btrim(coalesce(p_external_ref, '')), '');
  v_method text := coalesce(p_method, 'same_method');
  v_hash text;
  v_existing record;
  v_id uuid := gen_random_uuid();
  v_paid_pay uuid;
  v_t jsonb;
  v_restock jsonb;
  v_coupon boolean;
  v_status_after text;
  v_line jsonb;
  v_processed boolean := coalesce(p_mark_processed, false);
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('all', 'items', 'amount') or v_method not in ('same_method', 'bank_transfer', 'cash', 'other')
     or char_length(coalesce(v_dest, '')) > 300 or char_length(coalesce(v_ext, '')) > 120 then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'request_invalid')));
  end if;
  if coalesce(p_cancel, false) and p_mode <> 'all' then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'cancel_needs_all')));
  end if;
  if not coalesce(p_dry_run, true) and (char_length(v_reason) not between 1 and 300
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_:.-]{8,200}$') then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object(
      'code', case when char_length(v_reason) not between 1 and 300 then 'reason_required' else 'request_invalid' end)));
  end if;

  -- Orden de candados: el pedido y después sus cobros (el mismo de payment_apply_event y de las decisiones de pagos).
  select * into o from public.orders x where x.id = p_order_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  perform 1 from public.payments p where p.order_id = p_order_id order by p.id for update;

  if p_return_id is not null and not exists (select 1 from public.order_returns rt where rt.id = p_return_id and rt.order_id = p_order_id) then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'return_not_found')));
  end if;

  -- Idempotencia (doble clic, reintento tras un corte): la misma llave con lo mismo devuelve lo ya hecho.
  v_hash := md5(concat_ws('|', p_mode, coalesce(p_items::text, ''), coalesce(p_include_shipping::text, 'f'), coalesce(p_deduction::text, ''),
                          coalesce(p_amount::text, ''), v_reason, v_method, coalesce(v_dest, ''), coalesce(p_return_id::text, ''),
                          coalesce(p_cancel::text, 'f')));
  if not coalesce(p_dry_run, true) then
    select * into v_existing from public.refunds x where x.order_id = p_order_id and x.idempotency_key = p_idempotency_key;
    if found then
      if v_existing.request_hash is distinct from v_hash then
        return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'idempotency_conflict')));
      end if;
      return jsonb_build_object('outcome', 'existing', 'refund_id', v_existing.id, 'amount', v_existing.amount, 'status', v_existing.status);
    end if;
  end if;

  if coalesce(p_cancel, false) and o.status not in ('pending_payment', 'paid', 'preparing', 'shipped') then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'not_cancellable', 'status', o.status)));
  end if;

  v_cmp := public._refund_compute(p_order_id, p_items, p_include_shipping, p_deduction, p_amount, p_mode = 'all');

  -- Cancelar un pedido SIN dinero recibido no necesita reembolso: solo se cancela.
  if coalesce(p_cancel, false) and public._order_paid_amount(p_order_id) = 0 then
    if coalesce(p_dry_run, true) then
      return jsonb_build_object('outcome', 'preview', 'refund', null, 'cancel', true, 'status_after', 'cancelled',
        'restock', (select coalesce(jsonb_agg(jsonb_build_object('variant_id', i.variant_id, 'name', i.product_name, 'qty', i.qty)
                                                order by i.line_no), '[]'::jsonb) from public.order_items i where i.order_id = p_order_id),
        'coupon_release', exists (select 1 from public.discount_redemptions d where d.owner_type = 'order' and d.owner_id = p_order_id
                                   and d.status in ('reserved', 'applied')));
    end if;
    v_t := public.transition_order_status(p_order_id, 'cancelled', auth.uid(), 'admin', coalesce(nullif(v_reason, ''), 'Cancelado por el administrador'));
    if not coalesce((v_t ->> 'ok')::boolean, false) then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', coalesce(v_t ->> 'outcome', 'invalid_transition'))));
    end if;
    return jsonb_build_object('outcome', 'cancelled_no_refund', 'status_after', 'cancelled');
  end if;

  if not coalesce((v_cmp ->> 'ok')::boolean, false) then
    return jsonb_build_object('outcome', 'rejected', 'errors', v_cmp -> 'errors', 'warnings', v_cmp -> 'warnings', 'refund', v_cmp);
  end if;

  v_restock := case when coalesce(p_cancel, false)
    then (select coalesce(jsonb_agg(jsonb_build_object('variant_id', i.variant_id, 'name', i.product_name, 'qty', i.qty) order by i.line_no), '[]'::jsonb)
            from public.order_items i where i.order_id = p_order_id)
    else '[]'::jsonb end;
  v_coupon := coalesce(p_cancel, false) and exists (select 1 from public.discount_redemptions d where d.owner_type = 'order'
                and d.owner_id = p_order_id and d.status in ('reserved', 'applied'));
  v_status_after := case when coalesce(p_cancel, false) then
      (case when v_processed and (v_cmp ->> 'amount')::numeric >= public._order_paid_amount(p_order_id) - public._order_refunded_amount(p_order_id, true) then 'refunded' else 'cancelled' end)
    when v_processed and (v_cmp ->> 'amount')::numeric >= public._order_paid_amount(p_order_id) - public._order_refunded_amount(p_order_id, true)
         and o.status in ('cancelled', 'delivered', 'completed') then 'refunded'
    else o.status end;

  if coalesce(p_dry_run, true) then
    return jsonb_build_object('outcome', 'preview', 'refund', v_cmp, 'cancel', coalesce(p_cancel, false), 'status_after', v_status_after,
                              'restock', v_restock, 'coupon_release', v_coupon);
  end if;

  if coalesce(p_cancel, false) then
    v_t := public.transition_order_status(p_order_id, 'cancelled', auth.uid(), 'admin', v_reason);
    if not coalesce((v_t ->> 'ok')::boolean, false) then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', coalesce(v_t ->> 'outcome', 'invalid_transition'))));
    end if;
  end if;

  select p.id into v_paid_pay from public.payments p
   where p.order_id = p_order_id and (p.status in ('paid', 'refunded') or p.received_amount is not null)
   order by coalesce(p.received_amount, p.amount) desc, p.created_at, p.id limit 1;

  insert into public.refunds (id, order_id, payment_id, kind, amount, shipping_amount, deduction, currency, reason, status, method,
                              destination, external_ref, return_id, idempotency_key, request_hash, requested_by, processed_by,
                              processed_at)
  values (v_id, p_order_id, v_paid_pay, case p_mode when 'all' then 'cancel' when 'items' then 'items' else 'amount' end,
          (v_cmp ->> 'amount')::numeric, (v_cmp ->> 'shipping_amount')::numeric, (v_cmp ->> 'deduction')::numeric, o.currency, v_reason,
          case when v_processed then 'processed' else 'requested' end, v_method, v_dest, v_ext, p_return_id, p_idempotency_key, v_hash,
          auth.uid(), case when v_processed then auth.uid() end, case when v_processed then now() end);
  for v_line in select value from jsonb_array_elements(v_cmp -> 'lines') loop
    insert into public.refund_items (refund_id, order_item_id, qty, amount)
    values (v_id, (v_line ->> 'item_id')::uuid, (v_line ->> 'qty')::int, (v_line ->> 'amount')::numeric);
  end loop;

  if v_processed then
    perform public._order_notify(p_order_id, 'order_refund_processed', 'customer', ':' || v_id::text,
                                 jsonb_build_object('refund_id', v_id, 'amount', (v_cmp ->> 'amount')::numeric));
    perform public._refund_settle(p_order_id, auth.uid());
  end if;
  return jsonb_build_object('outcome', case when v_processed then 'refunded' else 'requested' end, 'refund_id', v_id,
    'amount', (v_cmp ->> 'amount')::numeric, 'status_after', (select x.status from public.orders x where x.id = p_order_id));
end;
$$;

-- Marca como devuelto un reembolso que estaba solicitado (la tienda ya hizo la transferencia). Idempotente.
create or replace function public.admin_process_refund(p_refund_id uuid, p_external_ref text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  f record;
  v_ext text := nullif(btrim(coalesce(p_external_ref, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if char_length(coalesce(v_ext, '')) > 120 or char_length(coalesce(v_note, '')) > 300 then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'request_invalid')));
  end if;
  select r.order_id into v_order from public.refunds r where r.id = p_refund_id;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  perform 1 from public.orders o where o.id = v_order for update;
  select * into f from public.refunds r where r.id = p_refund_id for update;
  if f.status = 'processed' then
    return jsonb_build_object('outcome', 'already_processed');
  elsif f.status = 'rejected' then
    return jsonb_build_object('outcome', 'already_rejected');
  end if;
  update public.refunds set status = 'processed', processed_by = auth.uid(), processed_at = now(),
         external_ref = coalesce(v_ext, external_ref), decision_note = coalesce(v_note, decision_note)
   where id = p_refund_id;
  perform public._order_notify(v_order, 'order_refund_processed', 'customer', ':' || p_refund_id::text,
                               jsonb_build_object('refund_id', p_refund_id, 'amount', f.amount));
  return jsonb_build_object('outcome', 'processed', 'status_after', public._refund_settle(v_order, auth.uid()));
end;
$$;

-- Descarta una solicitud de reembolso (libera el monto: se podrá pedir otra). Pide el motivo.
create or replace function public.admin_reject_refund(p_refund_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  f record;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if char_length(v_note) not between 1 and 300 then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'reason_required')));
  end if;
  select r.order_id into v_order from public.refunds r where r.id = p_refund_id;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  perform 1 from public.orders o where o.id = v_order for update;
  select * into f from public.refunds r where r.id = p_refund_id for update;
  if f.status = 'processed' then
    return jsonb_build_object('outcome', 'already_processed');
  elsif f.status = 'rejected' then
    return jsonb_build_object('outcome', 'already_rejected');
  end if;
  update public.refunds set status = 'rejected', decision_note = v_note, processed_by = auth.uid() where id = p_refund_id;
  return jsonb_build_object('outcome', 'rejected');
end;
$$;

-- ── 20. Devoluciones (la política la redacta la tienda; apagada hasta entonces) ─────────────
create or replace function public.admin_return_open(p_order_id uuid, p_items jsonb, p_reason text, p_override_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  it record;
  x jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_override text := nullif(btrim(coalesce(p_override_reason, '')), '');
  v_window int := public.setting_int('return_window_days', 7);
  v_delivered timestamptz;
  v_outside boolean;
  v_id uuid := gen_random_uuid();
  v_item uuid;
  v_qty int;
  v_taken int;
  v_seen uuid[] := '{}';
  v_code text;
  v_restock text;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if not public.setting_bool('returns_enabled', false) then
    return jsonb_build_object('outcome', 'returns_disabled');
  end if;
  if char_length(v_reason) not between 1 and 300 or char_length(coalesce(v_override, '')) > 300
     or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'request_invalid')));
  end if;
  select * into o from public.orders x2 where x2.id = p_order_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if o.status not in ('delivered', 'completed') then
    return jsonb_build_object('outcome', 'not_returnable', 'status', o.status);
  end if;
  select max(h.created_at) into v_delivered from public.order_status_history h where h.order_id = p_order_id and h.to_status = 'delivered';
  v_outside := v_delivered is not null and now() > v_delivered + make_interval(days => v_window);
  if v_outside and v_override is null then
    return jsonb_build_object('outcome', 'outside_window', 'window_days', v_window, 'delivered_at', v_delivered);
  end if;

  -- Validar todo ANTES de escribir.
  for x in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(x) <> 'object' or (x ->> 'item_id') is null
       or (x ->> 'item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (x ->> 'qty') is null or (x ->> 'qty') !~ '^[0-9]{1,6}$'
       or coalesce(x ->> 'reason_code', '') not in ('damaged', 'wrong_size', 'not_as_described', 'changed_mind', 'other')
       or coalesce(x ->> 'restock', '') not in ('yes', 'no', 'inspection') then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'items_invalid')));
    end if;
    v_item := (x ->> 'item_id')::uuid;
    v_qty := (x ->> 'qty')::int;
    select * into it from public.order_items i where i.id = v_item and i.order_id = p_order_id;
    if not found or v_item = any (v_seen) then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object(
        'code', case when found then 'duplicate_item' else 'item_not_found' end, 'item_id', v_item)));
    end if;
    v_seen := v_seen || v_item;
    select coalesce(sum(ri.qty), 0)::int into v_taken from public.order_return_items ri
      join public.order_returns rt on rt.id = ri.return_id where ri.order_item_id = it.id and rt.status <> 'rejected';
    if v_qty < 1 or v_taken + v_qty > it.qty then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object(
        'code', 'qty_exceeds', 'item_id', v_item, 'max', greatest(it.qty - v_taken, 0))));
    end if;
  end loop;

  insert into public.order_returns (id, order_id, reason, outside_window, override_reason, opened_by)
  values (v_id, p_order_id, v_reason, v_outside, case when v_outside then v_override end, auth.uid());
  for x in select value from jsonb_array_elements(p_items) loop
    v_code := x ->> 'reason_code';
    v_restock := x ->> 'restock';
    insert into public.order_return_items (return_id, order_item_id, qty, reason_code, restock)
    values (v_id, (x ->> 'item_id')::uuid, (x ->> 'qty')::int, v_code, v_restock);
  end loop;
  return jsonb_build_object('outcome', 'opened', 'id', v_id, 'outside_window', v_outside);
end;
$$;

-- Cierra la devolución: los productos «por inspeccionar» se resuelven aquí (sí/no vuelven al stock) y los que vuelven suman stock.
create or replace function public.admin_return_close(p_return_id uuid, p_resolutions jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_number text;
  rt record;
  x jsonb;
  ri record;
  v_restocked int := 0;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if p_resolutions is not null and jsonb_typeof(p_resolutions) <> 'array' then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'request_invalid')));
  end if;
  select r.order_id into v_order from public.order_returns r where r.id = p_return_id;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select o.number into v_number from public.orders o where o.id = v_order for update;
  select * into rt from public.order_returns r where r.id = p_return_id for update;
  if rt.status <> 'open' then
    return jsonb_build_object('outcome', 'already_closed', 'status', rt.status);
  end if;
  for x in select value from jsonb_array_elements(coalesce(p_resolutions, '[]'::jsonb)) loop
    if jsonb_typeof(x) <> 'object' or coalesce(x ->> 'restock', '') not in ('yes', 'no')
       or (x ->> 'item_id') is null
       or (x ->> 'item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'request_invalid')));
    end if;
    update public.order_return_items set restock = x ->> 'restock'
     where return_id = p_return_id and order_item_id = (x ->> 'item_id')::uuid and restock = 'inspection';
  end loop;
  if exists (select 1 from public.order_return_items ri2 where ri2.return_id = p_return_id and ri2.restock = 'inspection') then
    return jsonb_build_object('outcome', 'inspection_pending');
  end if;
  -- Stock en orden de variante (el mismo orden que usan los demás flujos: sin cruces).
  for ri in select ri2.id, ri2.qty, oi.variant_id from public.order_return_items ri2
              join public.order_items oi on oi.id = ri2.order_item_id
             where ri2.return_id = p_return_id and ri2.restock = 'yes' and ri2.restocked_at is null
             order by oi.variant_id, ri2.id loop
    perform public.apply_stock_change(ri.variant_id, ri.qty, 'return', v_number, 'Devolución ' || v_number, auth.uid());
    update public.order_return_items set restocked_at = now() where id = ri.id;
    v_restocked := v_restocked + ri.qty;
  end loop;
  update public.order_returns set status = 'closed', closed_by = auth.uid(), closed_at = now() where id = p_return_id;
  return jsonb_build_object('outcome', 'closed', 'restocked_units', v_restocked);
end;
$$;

create or replace function public.admin_return_reject(p_return_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  rt record;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if char_length(v_note) not between 1 and 300 then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'reason_required')));
  end if;
  select r.order_id into v_order from public.order_returns r where r.id = p_return_id;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  perform 1 from public.orders o where o.id = v_order for update;
  select * into rt from public.order_returns r where r.id = p_return_id for update;
  if rt.status <> 'open' then
    return jsonb_build_object('outcome', 'already_closed', 'status', rt.status);
  end if;
  update public.order_returns set status = 'rejected', closed_by = auth.uid(), closed_at = now(), close_note = v_note where id = p_return_id;
  return jsonb_build_object('outcome', 'rejected');
end;
$$;

-- ── 21. Contra entrega: cobrado o rechazado (BR-PAY-07) ─────────────────────────────────────
create or replace function public.admin_cod_collect(p_order_id uuid, p_amount numeric default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  pay record;
  v_dec int;
  v_amount numeric;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  select * into o from public.orders x where x.id = p_order_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select * into pay from public.payments p where p.order_id = p_order_id and p.provider = 'cash_on_delivery'
   order by p.attempt desc limit 1 for update;
  if not found then
    return jsonb_build_object('outcome', 'not_cod');
  end if;
  if o.status not in ('shipped', 'delivered', 'completed') or pay.status <> 'paid' then
    return jsonb_build_object('outcome', 'not_collectable', 'status', o.status);
  end if;
  if pay.collected_at is not null then
    return jsonb_build_object('outcome', 'already_collected');
  end if;
  select coalesce((select c.decimals::int from public.currencies c where c.code = pay.currency), 2) into v_dec;
  v_amount := coalesce(p_amount, pay.amount);
  if v_amount <= 0 or v_amount > pay.amount or round(v_amount, v_dec) <> v_amount or char_length(coalesce(v_note, '')) > 500 then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'amount_invalid', 'expected', pay.amount)));
  end if;
  update public.payments set collected_at = now(), collected_by = auth.uid(), received_amount = v_amount, paid_at = coalesce(paid_at, now())
   where id = pay.id;
  insert into public.order_notes (order_id, author_id, body)
  values (p_order_id, auth.uid(), 'Contra entrega cobrado: ' || pay.currency || ' ' || round(v_amount, v_dec)::text
                                  || case when v_amount < pay.amount then ' (esperado ' || round(pay.amount, v_dec)::text || ')' else '' end
                                  || coalesce(' — ' || v_note, ''));
  return jsonb_build_object('outcome', 'collected', 'amount', v_amount, 'short', v_amount < pay.amount);
end;
$$;

-- La clienta rechazó el paquete: el pedido se cancela (el stock vuelve), queda una incidencia con el costo que asume la tienda
-- (el envío de vuelta) y, si se pide, la cuenta entra a la lista negra. Devuelve cuántos rechazos previos tenía la clienta.
create or replace function public.admin_cod_reject(
  p_order_id uuid, p_cost numeric default 0, p_note text default null, p_blacklist boolean default false,
  p_blacklist_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  pay record;
  v_t jsonb;
  v_prev int;
  v_incident uuid;
  v_bl jsonb;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_cost numeric := coalesce(p_cost, 0);
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if v_cost < 0 or v_cost >= 1000000000 or char_length(coalesce(v_note, '')) > 1000 then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'request_invalid')));
  end if;
  select * into o from public.orders x where x.id = p_order_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select * into pay from public.payments p where p.order_id = p_order_id and p.provider = 'cash_on_delivery'
   order by p.attempt desc limit 1 for update;
  if not found then
    return jsonb_build_object('outcome', 'not_cod');
  end if;
  if pay.collected_at is not null then
    return jsonb_build_object('outcome', 'already_collected');
  end if;
  if o.status <> 'shipped' then
    return jsonb_build_object('outcome', 'not_rejectable', 'status', o.status);
  end if;
  if p_blacklist and char_length(btrim(coalesce(p_blacklist_reason, ''))) not between 1 and 300 then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'reason_required')));
  end if;
  select count(*)::int into v_prev from public.order_incidents i join public.orders x on x.id = i.order_id
   where x.profile_id = o.profile_id and i.type = 'rejected' and i.order_id <> p_order_id;
  v_t := public.transition_order_status(p_order_id, 'cancelled', auth.uid(), 'admin', 'Contra entrega rechazado');
  if not coalesce((v_t ->> 'ok')::boolean, false) then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', coalesce(v_t ->> 'outcome', 'invalid_transition'))));
  end if;
  insert into public.order_incidents (order_id, type, description, cost_assumed, cost_borne_by, opened_by)
  values (p_order_id, 'rejected', coalesce(v_note, 'La clienta rechazó el paquete en la entrega (contra entrega).'), v_cost, 'store', auth.uid())
  returning id into v_incident;
  if p_blacklist then
    v_bl := public.admin_blacklist_add('profile', o.profile_id, null, null, btrim(p_blacklist_reason), p_order_id, true);
  end if;
  return jsonb_build_object('outcome', 'rejected_delivery', 'incident_id', v_incident, 'previous_rejections', v_prev,
                            'blacklist', v_bl ->> 'outcome');
end;
$$;

-- ── 22. Editar un pedido ────────────────────────────────────────────────────────────────────
-- `p_items`: cambios sobre las líneas. `{item_id, qty}` cambia la cantidad de una línea del pedido (0 = quitarla);
-- `{variant_id, qty, unit_price?}` suma una variante nueva (precio vigente, o el que ponga el administrador).
-- Cómo se recalcula (documentado en docs/operacion-pedidos.md, y es una decisión de producto):
--  · El precio unitario de una línea que ya estaba NO cambia (es la instantánea). Una línea nueva toma el precio vigente.
--  · El descuento de una línea que BAJA de cantidad baja en proporción; si la cantidad SUBE, el descuento se queda igual (no se
--    inventan descuentos nuevos). El motor de ofertas NO se vuelve a ejecutar: para dar más descuento se usa `p_extra_discount`
--    (reparto exacto por línea, con motivo).
--  · El envío no se vuelve a cotizar solo: `p_shipping_cost` fija el nuevo costo (la vista previa trae la cotización sugerida).
--  · El stock se ajusta con movimientos (sale/cancel) y no deja negativo; lo retenido en carritos ajenos se respeta.
-- Con `p_expected_updated_at` distinto al del pedido responde `stale` (otro administrador lo cambió): bloqueo optimista.
create or replace function public.admin_edit_order(
  p_order_id uuid, p_expected_updated_at timestamptz, p_items jsonb, p_contact jsonb, p_address jsonb, p_shipping_cost numeric,
  p_extra_discount numeric, p_reason text, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  it record;
  x jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_dec int;
  v_factor numeric;
  v_item uuid;
  v_var uuid;
  v_qty int;
  v_seen uuid[] := '{}';
  v_seen_var uuid[] := '{}';
  v_lines jsonb := '[]'::jsonb;        -- líneas finales (qty > 0), en orden
  v_removed jsonb := '[]'::jsonb;
  v_line jsonb;
  v_stock jsonb := '[]'::jsonb;        -- {variant_id, name, net}
  v_unavail jsonb := '[]'::jsonb;
  v_price numeric;
  v_unit numeric;
  v_ltotal numeric;
  v_disc numeric;
  v_new_subtotal numeric := 0;
  v_new_discount numeric := 0;
  v_extra numeric := coalesce(p_extra_discount, 0);
  v_weights bigint[];
  v_shares bigint[];
  v_i int;
  v_ship_cost numeric;
  v_ship_disc numeric;
  v_ship_method jsonb;
  v_new_total numeric;
  v_old_total numeric;
  v_contact_name text;
  v_contact_email text;
  v_contact_phone text;
  v_addr jsonb := null;
  v_pay_state text := 'none';
  v_paid numeric;
  v_next_line int;
  v_before jsonb;
  v_after jsonb;
  v_diff jsonb;
  v_items_diff jsonb := '[]'::jsonb;
  v_suggest jsonb := null;
  v_product record;
  v_variant record;
  v_image text;
  v_net int;
  r record;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if char_length(v_reason) not between 1 and 300 then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'reason_required')));
  end if;
  if p_items is not null and jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'items_invalid')));
  end if;

  select * into o from public.orders x where x.id = p_order_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  v_ship_method := o.shipping_method;
  if p_expected_updated_at is not null and o.updated_at <> p_expected_updated_at then
    return jsonb_build_object('outcome', 'stale', 'updated_at', o.updated_at, 'status', o.status);
  end if;
  if o.status not in ('pending_payment', 'paid', 'preparing') then
    return jsonb_build_object('outcome', 'not_editable', 'status', o.status);
  end if;
  if exists (select 1 from public.payment_proofs pp where pp.order_id = p_order_id and pp.status = 'pending') then
    return jsonb_build_object('outcome', 'proof_pending');
  end if;
  -- Con reembolsos en curso o hechos, las líneas ya no se pueden mover (el prorrateo se apoya en ellas).
  if exists (select 1 from public.refunds r2 where r2.order_id = p_order_id and r2.status <> 'rejected') then
    return jsonb_build_object('outcome', 'has_refunds');
  end if;
  if exists (select 1 from public.order_returns rt where rt.order_id = p_order_id and rt.status = 'open') then
    return jsonb_build_object('outcome', 'has_open_return');
  end if;

  select coalesce((select c.decimals::int from public.currencies c where c.code = o.currency), 2) into v_dec;
  v_factor := power(10, v_dec);
  if v_extra < 0 or v_extra >= 1000000000 or round(v_extra, v_dec) <> v_extra then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'extra_discount_invalid')));
  end if;
  if p_shipping_cost is not null and (p_shipping_cost < 0 or p_shipping_cost >= 1000000000 or round(p_shipping_cost, v_dec) <> p_shipping_cost) then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'shipping_cost_invalid')));
  end if;

  -- Contacto y dirección (validados como en el pedido original).
  v_contact_name := o.contact_name;
  v_contact_email := o.contact_email;
  v_contact_phone := o.contact_phone;
  if p_contact is not null then
    if jsonb_typeof(p_contact) <> 'object' then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'contact_invalid')));
    end if;
    if p_contact ? 'name' then v_contact_name := btrim(coalesce(p_contact ->> 'name', '')); end if;
    if p_contact ? 'email' then v_contact_email := nullif(lower(btrim(coalesce(p_contact ->> 'email', ''))), ''); end if;
    if p_contact ? 'phone' then v_contact_phone := btrim(coalesce(p_contact ->> 'phone', '')); end if;
    if char_length(v_contact_name) not between 1 and 120 or v_contact_phone !~ '^\+[1-9][0-9]{7,14}$'
       or (v_contact_email is not null and (char_length(v_contact_email) > 254 or v_contact_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')) then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'contact_invalid')));
    end if;
  end if;
  if p_address is not null then
    if coalesce(o.shipping_method ->> 'kind', '') <> 'delivery' then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'address_not_applicable')));
    end if;
    v_addr := public._order_address_clean(p_address);
    if v_addr is null then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'address_invalid')));
    end if;
  end if;

  -- 1. Cambios pedidos → cantidad nueva por línea existente y variantes nuevas.
  create temp table if not exists pg_temp.edit_plan (
    item_id uuid, variant_id uuid, product_id uuid, line_no int, name text, color_name text, color_hex text, size_label text, sku text,
    image_path text, qty_old int, qty_new int, unit_price numeric, discount_old numeric, final_old numeric, discount_offers jsonb,
    cost_unit numeric, is_new boolean) on commit drop;
  -- (TRUNCATE y no DELETE: Supabase carga `pg-safeupdate`, que rechaza un DELETE sin WHERE cuando llega por la API.)
  truncate pg_temp.edit_plan;
  insert into pg_temp.edit_plan
    select i.id, i.variant_id, i.product_id, i.line_no, i.product_name, i.color_name, i.color_hex, i.size_label, i.sku, i.image_path,
           i.qty, i.qty, i.unit_price, i.discount, i.final_total, i.discount_offers, i.cost_unit, false
      from public.order_items i where i.order_id = p_order_id;
  v_next_line := coalesce((select max(line_no) from pg_temp.edit_plan), 0) + 1;

  for x in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if jsonb_typeof(x) <> 'object' or (x ->> 'qty') is null or (x ->> 'qty') !~ '^[0-9]{1,4}$'
       or ((x ->> 'item_id') is null) = ((x ->> 'variant_id') is null)
       or (coalesce(x ->> 'item_id', x ->> 'variant_id')) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or ((x ->> 'unit_price') is not null and (x ->> 'unit_price') !~ '^[0-9]{1,9}(\.[0-9]{1,4})?$') then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'items_invalid')));
    end if;
    v_qty := (x ->> 'qty')::int;
    if (x ->> 'item_id') is not null then
      v_item := (x ->> 'item_id')::uuid;
      if v_item = any (v_seen) then
        return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'duplicate_item', 'item_id', v_item)));
      end if;
      v_seen := v_seen || v_item;
      update pg_temp.edit_plan set qty_new = v_qty where item_id = v_item;
      if not found then
        return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'item_not_found', 'item_id', v_item)));
      end if;
    else
      v_var := (x ->> 'variant_id')::uuid;
      if v_qty < 1 or v_var = any (v_seen_var) or exists (select 1 from pg_temp.edit_plan e where e.variant_id = v_var) then
        return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'duplicate_variant', 'variant_id', v_var)));
      end if;
      v_seen_var := v_seen_var || v_var;
      select v.id, v.product_id, v.sku, v.color_id, v.size_id, v.archived_at as v_arch, p.name, p.status, p.archived_at as p_arch, p.cost_base,
             pc.name as color_name, pc.hex as color_hex, ps.label as size_label
        into v_variant
        from public.product_variants v join public.products p on p.id = v.product_id
        left join public.product_colors pc on pc.id = v.color_id left join public.product_sizes ps on ps.id = v.size_id
       where v.id = v_var;
      if not found or v_variant.v_arch is not null or v_variant.p_arch is not null or v_variant.status <> 'active' then
        return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'variant_unavailable', 'variant_id', v_var)));
      end if;
      v_unit := case when (x ->> 'unit_price') is not null then (x ->> 'unit_price')::numeric
                     else public.price_for(v_variant.product_id, o.currency, null) end;
      if v_unit is null or v_unit < 0 or round(v_unit, v_dec) <> v_unit then
        return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'price_unavailable', 'variant_id', v_var)));
      end if;
      select i.path into v_image from public.product_images i
       where i.product_id = v_variant.product_id and i.archived_at is null
       order by (i.color_id is not distinct from v_variant.color_id) desc, (i.color_id is null) desc, i.sort_order, i.id limit 1;
      insert into pg_temp.edit_plan values (null, v_var, v_variant.product_id, v_next_line, v_variant.name, v_variant.color_name,
        v_variant.color_hex, v_variant.size_label, v_variant.sku, v_image, 0, v_qty, v_unit, 0, 0, '[]'::jsonb, v_variant.cost_base, true);
      v_next_line := v_next_line + 1;
    end if;
  end loop;

  if not exists (select 1 from pg_temp.edit_plan e where e.qty_new > 0) then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'order_empty')));
  end if;

  -- 2. Stock: variantes bloqueadas EN ORDEN de id; lo que se suma no puede superar lo libre.
  perform 1 from public.product_variants v where v.id in (select e.variant_id from pg_temp.edit_plan e) order by v.id for update;
  for r in select e.variant_id, max(e.name) as name, sum(e.qty_new - e.qty_old)::int as net from pg_temp.edit_plan e
            group by e.variant_id having sum(e.qty_new - e.qty_old) <> 0 order by e.variant_id loop
    v_stock := v_stock || jsonb_build_array(jsonb_build_object('variant_id', r.variant_id, 'name', r.name, 'net', r.net));
    if r.net > 0 and public._order_stock_free(r.variant_id) < r.net then
      v_unavail := v_unavail || jsonb_build_array(jsonb_build_object('variant_id', r.variant_id, 'name', r.name, 'requested', r.net,
                                                                       'available', public._order_stock_free(r.variant_id)));
    end if;
  end loop;
  if jsonb_array_length(v_unavail) > 0 then
    return jsonb_build_object('outcome', 'unavailable', 'lines', v_unavail);
  end if;

  -- 3. Importes por línea.
  for r in select * from pg_temp.edit_plan order by line_no loop
    if r.qty_new = 0 then
      v_removed := v_removed || jsonb_build_array(jsonb_build_object('item_id', r.item_id, 'line_no', r.line_no, 'name', r.name, 'qty', r.qty_old));
      v_items_diff := v_items_diff || jsonb_build_array(jsonb_build_object('op', 'removed', 'line_no', r.line_no, 'name', r.name,
        'qty_before', r.qty_old, 'qty_after', 0, 'final_before', r.final_old, 'final_after', 0));
      continue;
    end if;
    v_ltotal := round(r.unit_price * r.qty_new, v_dec);
    v_disc := case when r.is_new then 0
                   when r.qty_new < r.qty_old then least(v_ltotal, round(r.discount_old * r.qty_new / r.qty_old, v_dec))
                   else least(v_ltotal, r.discount_old) end;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'item_id', r.item_id, 'variant_id', r.variant_id, 'product_id', r.product_id, 'line_no', r.line_no, 'name', r.name,
      'color_name', r.color_name, 'color_hex', r.color_hex, 'size_label', r.size_label, 'sku', r.sku, 'image_path', r.image_path,
      'qty_old', r.qty_old, 'qty', r.qty_new, 'unit_price', r.unit_price, 'line_total', v_ltotal, 'discount', v_disc,
      'discount_offers', r.discount_offers, 'cost_unit', r.cost_unit, 'is_new', r.is_new));
  end loop;

  -- Descuento extra: reparto exacto (método del mayor resto) en proporción a lo que vale cada línea.
  if v_extra > 0 then
    select array_agg(round(((l ->> 'line_total')::numeric - (l ->> 'discount')::numeric) * v_factor)::bigint order by o2)
      into v_weights from jsonb_array_elements(v_lines) with ordinality as t(l, o2);
    if v_extra > (select coalesce(sum(((l ->> 'line_total')::numeric - (l ->> 'discount')::numeric)), 0) from jsonb_array_elements(v_lines) l) then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'extra_discount_too_big')));
    end if;
    v_shares := public._discount_distribute(round(v_extra * v_factor)::bigint, v_weights);
    for v_i in 1..jsonb_array_length(v_lines) loop
      if v_shares[v_i] > 0 then
        v_line := v_lines -> (v_i - 1);
        v_lines := jsonb_set(v_lines, array[(v_i - 1)::text], v_line || jsonb_build_object(
          'discount', (v_line ->> 'discount')::numeric + v_shares[v_i]::numeric / v_factor,
          'discount_offers', coalesce(v_line -> 'discount_offers', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'type', 'manual', 'amount', v_shares[v_i]::numeric / v_factor, 'reason', v_reason))));
      end if;
    end loop;
  end if;

  for v_i in 1..jsonb_array_length(v_lines) loop
    v_line := v_lines -> (v_i - 1);
    v_new_subtotal := v_new_subtotal + (v_line ->> 'line_total')::numeric;
    v_new_discount := v_new_discount + (v_line ->> 'discount')::numeric;
    v_items_diff := v_items_diff || case
      when (v_line ->> 'is_new')::boolean then jsonb_build_array(jsonb_build_object('op', 'added', 'line_no', (v_line ->> 'line_no')::int,
        'name', v_line ->> 'name', 'qty_before', 0, 'qty_after', (v_line ->> 'qty')::int, 'final_before', 0,
        'final_after', (v_line ->> 'line_total')::numeric - (v_line ->> 'discount')::numeric))
      when (v_line ->> 'qty')::int <> (v_line ->> 'qty_old')::int
        or (v_line ->> 'discount')::numeric <> (select e.discount_old from pg_temp.edit_plan e where e.item_id = (v_line ->> 'item_id')::uuid)
        then jsonb_build_array(jsonb_build_object('op', 'changed', 'line_no', (v_line ->> 'line_no')::int, 'name', v_line ->> 'name',
        'qty_before', (v_line ->> 'qty_old')::int, 'qty_after', (v_line ->> 'qty')::int,
        'final_before', (select e.final_old from pg_temp.edit_plan e where e.item_id = (v_line ->> 'item_id')::uuid),
        'final_after', (v_line ->> 'line_total')::numeric - (v_line ->> 'discount')::numeric))
      else '[]'::jsonb end;
  end loop;
  v_new_subtotal := round(v_new_subtotal, v_dec);
  v_new_discount := round(v_new_discount, v_dec);

  -- 4. Envío: no se cotiza solo; el costo nuevo lo fija el administrador. Si el envío era gratis, sigue gratis.
  v_ship_cost := coalesce(p_shipping_cost, o.shipping_cost);
  if p_shipping_cost is null then
    v_ship_disc := o.shipping_discount;
  elsif o.shipping_cost > 0 and o.shipping_discount = o.shipping_cost then
    v_ship_disc := v_ship_cost;
  else
    v_ship_disc := least(o.shipping_discount, v_ship_cost);
  end if;
  if p_shipping_cost is not null and p_shipping_cost <> o.shipping_cost then
    v_ship_method := o.shipping_method || jsonb_build_object('quote',
      coalesce(o.shipping_method -> 'quote', '{}'::jsonb) || jsonb_build_object('cost', v_ship_cost, 'manual', true));
  end if;
  -- Cotización sugerida para una dirección nueva (informativa; no se aplica sola).
  if v_addr is not null and v_addr ->> 'lat' is not null then
    v_suggest := public.quote_shipping(o.shipping_method ->> 'code', (v_addr ->> 'lat')::numeric, (v_addr ->> 'lng')::numeric,
                                       v_addr ->> 'city', v_new_subtotal, o.currency, null, null, 1);
    v_suggest := jsonb_build_object('ok', v_suggest -> 'ok', 'cost', v_suggest -> 'cost', 'distance_km', v_suggest -> 'distance_km',
                                    'errors', v_suggest -> 'errors');
  end if;

  v_old_total := o.total;
  v_new_total := round(v_new_subtotal - v_new_discount + v_ship_cost - v_ship_disc, v_dec);
  if v_new_total < 0 or v_new_discount > v_new_subtotal then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'total_invalid')));
  end if;

  -- 5. Efecto en el dinero: antes de pagar, el cobro abierto toma el total nuevo; ya pagado, queda un saldo a favor o en contra.
  v_paid := public._order_paid_amount(p_order_id);
  if o.status = 'pending_payment' then
    v_pay_state := case when v_new_total <> v_old_total then 'amount_updated' else 'none' end;
  elsif exists (select 1 from public.payments p where p.order_id = p_order_id and p.provider = 'cash_on_delivery') then
    v_pay_state := case when v_new_total <> v_old_total then 'amount_updated' else 'none' end;
  elsif v_new_total > v_paid - public._order_refunded_amount(p_order_id) then
    v_pay_state := 'balance_due';
  elsif v_new_total < v_paid - public._order_refunded_amount(p_order_id) then
    v_pay_state := 'refund_due';
  end if;

  v_before := jsonb_build_object('subtotal', o.subtotal, 'discount_total', o.discount_total, 'shipping_cost', o.shipping_cost,
    'shipping_discount', o.shipping_discount, 'total', o.total);
  v_after := jsonb_build_object('subtotal', v_new_subtotal, 'discount_total', v_new_discount, 'shipping_cost', v_ship_cost,
    'shipping_discount', v_ship_disc, 'total', v_new_total);
  v_diff := jsonb_build_object(
    'items', v_items_diff, 'stock', v_stock, 'total_delta', v_new_total - v_old_total, 'payment', v_pay_state,
    'contact_changed', (v_contact_name, v_contact_email, v_contact_phone) is distinct from (o.contact_name, o.contact_email, o.contact_phone),
    'address_changed', v_addr is not null, 'shipping_cost_changed', v_ship_cost is distinct from o.shipping_cost,
    'extra_discount', v_extra);

  if coalesce(p_dry_run, true) then
    return jsonb_build_object('outcome', 'preview', 'before', v_before, 'after', v_after, 'diff', v_diff, 'lines', v_lines,
                              'removed', v_removed, 'suggested_shipping', v_suggest, 'paid', v_paid,
                              'balance', v_new_total - (v_paid - public._order_refunded_amount(p_order_id)), 'updated_at', o.updated_at);
  end if;

  if jsonb_array_length(v_items_diff) = 0 and v_after = v_before and not (v_diff ->> 'contact_changed')::boolean
     and v_addr is null then
    return jsonb_build_object('outcome', 'no_changes');
  end if;

  -- 6. Aplicar. La bandera deja pasar el UPDATE a la guarda del pedido y a la de las líneas.
  perform set_config('app.order_edit', '1', true);
  delete from public.order_items where order_id = p_order_id and id in (select (rm ->> 'item_id')::uuid from jsonb_array_elements(v_removed) rm);
  for v_i in 1..jsonb_array_length(v_lines) loop
    v_line := v_lines -> (v_i - 1);
    if (v_line ->> 'is_new')::boolean then
      insert into public.order_items (order_id, line_no, variant_id, product_id, product_name, color_name, color_hex, size_label, sku,
                                      image_path, qty, unit_price, line_total, discount, final_total, cost_unit, discount_offers)
      values (p_order_id, (v_line ->> 'line_no')::int, (v_line ->> 'variant_id')::uuid, (v_line ->> 'product_id')::uuid,
              v_line ->> 'name', v_line ->> 'color_name', v_line ->> 'color_hex', v_line ->> 'size_label', v_line ->> 'sku',
              v_line ->> 'image_path', (v_line ->> 'qty')::int, (v_line ->> 'unit_price')::numeric, (v_line ->> 'line_total')::numeric,
              (v_line ->> 'discount')::numeric, (v_line ->> 'line_total')::numeric - (v_line ->> 'discount')::numeric,
              nullif(v_line -> 'cost_unit', 'null'::jsonb)::text::numeric, coalesce(v_line -> 'discount_offers', '[]'::jsonb));
    else
      update public.order_items set qty = (v_line ->> 'qty')::int, line_total = (v_line ->> 'line_total')::numeric,
             discount = (v_line ->> 'discount')::numeric,
             final_total = (v_line ->> 'line_total')::numeric - (v_line ->> 'discount')::numeric,
             discount_offers = coalesce(v_line -> 'discount_offers', '[]'::jsonb)
       where id = (v_line ->> 'item_id')::uuid;
    end if;
  end loop;
  update public.orders set subtotal = v_new_subtotal, discount_total = v_new_discount, shipping_cost = v_ship_cost,
         shipping_discount = v_ship_disc, total = v_new_total, contact_name = v_contact_name, contact_email = v_contact_email,
         contact_phone = v_contact_phone, shipping_address = coalesce(v_addr, shipping_address), shipping_method = v_ship_method,
         discounts = case when v_extra > 0 then discounts || jsonb_build_array(jsonb_build_object('type', 'manual', 'amount', v_extra,
                                                                                                   'reason', v_reason)) else discounts end,
         edited_at = now(), edit_count = edit_count + 1, updated_at = now()
   where id = p_order_id;
  perform set_config('app.order_edit', '', true);

  -- Stock con movimientos (en orden de variante, con las filas ya bloqueadas).
  for r in select (s ->> 'variant_id')::uuid as variant_id, (s ->> 'net')::int as net
             from jsonb_array_elements(v_stock) s order by (s ->> 'variant_id')::uuid loop
    perform public.apply_stock_change(r.variant_id, -r.net, case when r.net > 0 then 'sale' else 'cancel' end, o.number,
                                      'Edición ' || o.number, auth.uid());
  end loop;
  -- Antes de pagar (o en contra entrega) el cobro abierto cobra el total nuevo.
  if v_pay_state = 'amount_updated' then
    update public.payments set amount = v_new_total
     where order_id = p_order_id and (status in ('initiated', 'pending') or (provider = 'cash_on_delivery' and status = 'paid' and collected_at is null));
  end if;
  insert into public.order_edits (order_id, actor_id, reason, before, after, diff)
  values (p_order_id, auth.uid(), v_reason, v_before, v_after, v_diff);
  perform public._order_notify(p_order_id, 'order_edited', 'customer', ':' || (o.edit_count + 1)::text,
                               jsonb_build_object('total_before', v_old_total, 'total_after', v_new_total));
  return jsonb_build_object('outcome', 'edited', 'before', v_before, 'after', v_after, 'diff', v_diff,
                            'updated_at', (select x2.updated_at from public.orders x2 where x2.id = p_order_id));
end;
$$;

-- ── 23. Pedido manual (ventas por WhatsApp o mostrador) ─────────────────────────────────────
-- Crea un pedido para una clienta con cuenta, sin pasar por SU bolsa. Reutiliza lo que no depende del carrito: el contador sin
-- huecos, el stock firme, la franja y la máquina de estados. Los descuentos son manuales (con motivo): no hay cupón ni motor de
-- ofertas. Respeta la lista negra (S-07): una cuenta bloqueada no recibe pedidos manuales.
-- `p_items`: [{variant_id, qty, unit_price?}]. `p_mark_paid`: el dinero ya se recibió (el pedido nace «pagado»).
create or replace function public.admin_create_manual_order(
  p_profile_id uuid, p_items jsonb, p_channel text, p_payment_method text, p_shipping_method text, p_address jsonb, p_idempotency_key text,
  p_shipping_cost numeric, p_slot_id uuid, p_delivery_date date, p_discount numeric, p_discount_reason text,
  p_contact_name text, p_contact_email text, p_contact_phone text, p_note text, p_mark_paid boolean default false,
  p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
  v_method record;
  v_pm record;
  x jsonb;
  v_base text;
  v_cur text;
  v_dec int;
  v_factor numeric;
  v_var uuid;
  v_qty int;
  v_unit numeric;
  v_variant record;
  v_image text;
  v_seen uuid[] := '{}';
  v_lines jsonb := '[]'::jsonb;
  v_unavail jsonb := '[]'::jsonb;
  v_line jsonb;
  v_i int;
  v_subtotal numeric := 0;
  v_disc_total numeric := 0;
  v_discount numeric := coalesce(p_discount, 0);
  v_weights bigint[];
  v_shares bigint[];
  v_ship numeric;
  v_quote jsonb;
  v_quote_cost numeric;
  v_addr jsonb;
  v_slot jsonb;
  v_total numeric;
  v_name text;
  v_email text;
  v_phone text;
  v_hash text;
  v_existing record;
  v_order_id uuid := gen_random_uuid();
  v_number text;
  v_sres jsonb;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_dreason text := nullif(btrim(coalesce(p_discount_reason, '')), '');
  v_method_json jsonb;
  v_tr jsonb;
  r record;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('manual', 'whatsapp') or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 50
     or (not coalesce(p_dry_run, true) and (p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,64}$'))
     or char_length(coalesce(v_note, '')) > 1000 then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'request_invalid')));
  end if;

  select * into v_profile from public.profiles p where p.id = p_profile_id for update;
  if not found or not v_profile.is_active or v_profile.anonymized_at is not null then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'account_inactive')));
  end if;
  v_name := btrim(coalesce(nullif(btrim(coalesce(p_contact_name, '')), ''), v_profile.full_name));
  v_email := nullif(lower(btrim(coalesce(nullif(btrim(coalesce(p_contact_email, '')), ''), v_profile.email, ''))), '');
  v_phone := coalesce(nullif(btrim(coalesce(p_contact_phone, '')), ''), v_profile.phone_e164);
  if char_length(v_name) not between 1 and 120 or v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$'
     or (v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')) then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'contact_invalid')));
  end if;
  -- S-07: la lista negra bloquea los pedidos manuales (la cuenta o su teléfono/correo).
  if public.is_blacklisted(p_profile_id, v_phone, v_email) then
    return jsonb_build_object('outcome', 'blacklisted');
  end if;

  -- Idempotencia (doble clic).
  v_hash := md5(concat_ws('|', p_profile_id::text, p_items::text, p_channel, coalesce(p_payment_method, ''), coalesce(p_shipping_method, ''),
                          coalesce(p_address::text, ''), coalesce(p_shipping_cost::text, ''), coalesce(p_slot_id::text, ''),
                          coalesce(p_delivery_date::text, ''), v_discount::text, coalesce(v_dreason, ''), v_name, coalesce(v_email, ''),
                          v_phone, coalesce(p_mark_paid::text, 'f')));
  if not coalesce(p_dry_run, true) then
    select o.id, o.request_hash, o.number into v_existing from public.orders o
     where o.profile_id = p_profile_id and o.idempotency_key = p_idempotency_key;
    if found then
      if v_existing.request_hash is distinct from v_hash then
        return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'idempotency_conflict')));
      end if;
      return jsonb_build_object('outcome', 'existing', 'order_id', v_existing.id, 'number', v_existing.number);
    end if;
  end if;

  v_base := coalesce((select s.value #>> '{}' from public.store_settings s where s.key = 'base_currency'), 'BOB');
  v_cur := v_base;
  select coalesce((select c.decimals::int from public.currencies c where c.code = v_cur), 2) into v_dec;
  v_factor := power(10, v_dec);
  if v_discount < 0 or v_discount >= 1000000000 or round(v_discount, v_dec) <> v_discount
     or (v_discount > 0 and v_dreason is null) or char_length(coalesce(v_dreason, '')) > 300 then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object(
      'code', case when v_discount > 0 and v_dreason is null then 'discount_reason_required' else 'discount_invalid' end)));
  end if;
  if p_shipping_cost is not null and (p_shipping_cost < 0 or p_shipping_cost >= 1000000000 or round(p_shipping_cost, v_dec) <> p_shipping_cost) then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'shipping_cost_invalid')));
  end if;

  -- Líneas: variantes bloqueadas en orden de id, precio vigente (o el que fije el administrador).
  for x in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(x) <> 'object' or (x ->> 'variant_id') is null
       or (x ->> 'variant_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (x ->> 'qty') is null or (x ->> 'qty') !~ '^[0-9]{1,4}$' or (x ->> 'qty')::int < 1
       or ((x ->> 'unit_price') is not null and (x ->> 'unit_price') !~ '^[0-9]{1,9}(\.[0-9]{1,4})?$') then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'items_invalid')));
    end if;
    if (x ->> 'variant_id')::uuid = any (v_seen) then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'duplicate_variant')));
    end if;
    v_seen := v_seen || (x ->> 'variant_id')::uuid;
  end loop;
  perform 1 from public.product_variants v where v.id = any (v_seen) order by v.id for update;
  v_i := 0;
  for x in select value from jsonb_array_elements(p_items) loop
    v_i := v_i + 1;
    v_var := (x ->> 'variant_id')::uuid;
    v_qty := (x ->> 'qty')::int;
    select v.id, v.product_id, v.sku, v.color_id, v.archived_at as v_arch, p.name, p.status, p.archived_at as p_arch, p.cost_base,
           pc.name as color_name, pc.hex as color_hex, ps.label as size_label
      into v_variant
      from public.product_variants v join public.products p on p.id = v.product_id
      left join public.product_colors pc on pc.id = v.color_id left join public.product_sizes ps on ps.id = v.size_id
     where v.id = v_var;
    if not found or v_variant.v_arch is not null or v_variant.p_arch is not null or v_variant.status <> 'active' then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'variant_unavailable', 'variant_id', v_var)));
    end if;
    v_unit := case when (x ->> 'unit_price') is not null then (x ->> 'unit_price')::numeric
                   else public.price_for(v_variant.product_id, v_cur, null) end;
    if v_unit is null or round(v_unit, v_dec) <> v_unit then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'price_unavailable', 'variant_id', v_var)));
    end if;
    if public._order_stock_free(v_var) < v_qty then
      v_unavail := v_unavail || jsonb_build_array(jsonb_build_object('variant_id', v_var, 'name', v_variant.name, 'requested', v_qty,
                                                                       'available', public._order_stock_free(v_var)));
    end if;
    select i.path into v_image from public.product_images i
     where i.product_id = v_variant.product_id and i.archived_at is null
     order by (i.color_id is not distinct from v_variant.color_id) desc, (i.color_id is null) desc, i.sort_order, i.id limit 1;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'line_no', v_i, 'variant_id', v_var, 'product_id', v_variant.product_id, 'name', v_variant.name, 'color_name', v_variant.color_name,
      'color_hex', v_variant.color_hex, 'size_label', v_variant.size_label, 'sku', v_variant.sku, 'image_path', v_image, 'qty', v_qty,
      'unit_price', v_unit, 'line_total', round(v_unit * v_qty, v_dec), 'discount', 0, 'cost_unit', v_variant.cost_base,
      'price_override', (x ->> 'unit_price') is not null));
  end loop;
  if jsonb_array_length(v_unavail) > 0 then
    return jsonb_build_object('outcome', 'unavailable', 'lines', v_unavail);
  end if;

  select coalesce(sum((l ->> 'line_total')::numeric), 0) into v_subtotal from jsonb_array_elements(v_lines) l;
  if v_discount > v_subtotal then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'discount_too_big')));
  end if;
  if v_discount > 0 then
    select array_agg(round((l ->> 'line_total')::numeric * v_factor)::bigint order by o2) into v_weights
      from jsonb_array_elements(v_lines) with ordinality as t(l, o2);
    v_shares := public._discount_distribute(round(v_discount * v_factor)::bigint, v_weights);
    for v_i in 1..jsonb_array_length(v_lines) loop
      v_line := v_lines -> (v_i - 1);
      v_lines := jsonb_set(v_lines, array[(v_i - 1)::text], v_line || jsonb_build_object(
        'discount', v_shares[v_i]::numeric / v_factor,
        'discount_offers', case when v_shares[v_i] > 0 then jsonb_build_array(jsonb_build_object(
          'type', 'manual', 'amount', v_shares[v_i]::numeric / v_factor, 'reason', v_dreason)) else '[]'::jsonb end));
    end loop;
  end if;
  v_disc_total := round(v_discount, v_dec);

  -- Envío: el método debe existir y estar activo; a domicilio necesita dirección; el costo sale de la cotización o lo fija el
  -- administrador (con la cobertura que él decide).
  select * into v_method from public.shipping_methods m where m.code = p_shipping_method and m.is_active and m.archived_at is null;
  if p_shipping_method is null or not found then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'method_not_found')));
  end if;
  if v_method.kind = 'delivery' then
    v_addr := public._order_address_clean(p_address);
    if v_addr is null then
      return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object(
        'code', case when p_address is null then 'address_required' else 'address_invalid' end)));
    end if;
    v_quote := public.quote_shipping(p_shipping_method, (v_addr ->> 'lat')::numeric, (v_addr ->> 'lng')::numeric, v_addr ->> 'city',
                                     v_subtotal, v_cur, p_delivery_date, p_slot_id, 1);
  else
    v_quote := public.quote_shipping(p_shipping_method, null, null, null, v_subtotal, v_cur, null, null, 1);
  end if;
  if coalesce((v_quote ->> 'ok')::boolean, false) then
    v_quote_cost := (v_quote ->> 'cost')::numeric;
  elsif p_shipping_cost is null then
    return jsonb_build_object('outcome', 'rejected', 'errors', coalesce(v_quote -> 'errors', '[]'::jsonb));
  end if;
  v_ship := coalesce(p_shipping_cost, v_quote_cost);
  v_slot := case when v_method.kind = 'delivery' and coalesce((v_quote ->> 'ok')::boolean, false)
                      and v_quote -> 'selected' is not null and v_quote -> 'selected' <> 'null'::jsonb then v_quote -> 'selected' end;
  v_total := round(v_subtotal - v_disc_total + v_ship, v_dec);

  -- Método de pago de la configuración del país.
  select * into v_pm from public.payment_methods m
   where m.country = coalesce(v_addr ->> 'country', 'BO') and m.code = p_payment_method and m.is_active and m.archived_at is null;
  if p_payment_method is null or not found then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'payment_unavailable')));
  end if;
  if v_pm.max_amount is not null and v_total > v_pm.max_amount then
    return jsonb_build_object('outcome', 'rejected', 'errors', jsonb_build_array(jsonb_build_object('code', 'payment_unavailable', 'reason', 'over_max_amount')));
  end if;

  if coalesce(p_dry_run, true) then
    return jsonb_build_object('outcome', 'preview', 'lines', v_lines, 'currency', v_cur,
      'totals', jsonb_build_object('subtotal', v_subtotal, 'discount', v_disc_total, 'shipping', v_ship, 'total', v_total),
      'shipping', jsonb_build_object('method', v_method.code, 'kind', v_method.kind, 'quote', v_quote, 'manual_cost', p_shipping_cost is not null),
      'payment', jsonb_build_object('code', v_pm.code, 'provider', v_pm.provider, 'window_minutes', v_pm.window_minutes),
      'contact', jsonb_build_object('name', v_name, 'email', v_email, 'phone', v_phone));
  end if;

  -- Escribir: todo o nada. Un MC001 revierte stock, franja y contador (la numeración queda sin huecos).
  begin
    if v_slot is not null and v_slot ->> 'slot_id' is not null then
      v_sres := public.reserve_delivery_slot((v_slot ->> 'slot_id')::uuid, (v_slot ->> 'date')::date, 'order', v_order_id);
      if v_sres ->> 'status' not in ('reserved', 'already') then
        raise exception using errcode = 'MC001', message = jsonb_build_object('outcome', 'rejected', 'errors',
          jsonb_build_array(jsonb_build_object('code', case when v_sres ->> 'status' = 'full' then 'slot_full' else 'slot_invalid' end)))::text;
      end if;
    end if;
    v_number := public._next_order_number('MIC');
    v_method_json := jsonb_build_object('code', v_method.code, 'name', v_method.name, 'kind', v_method.kind,
      'description', v_method.description, 'eta_min_days', v_method.eta_min_days, 'eta_max_days', v_method.eta_max_days,
      'quote', jsonb_build_object('cost', v_ship, 'distance_km', v_quote -> 'distance_km', 'breakdown', v_quote -> 'breakdown',
                                  'manual', p_shipping_cost is not null));
    insert into public.orders (
      id, number, profile_id, cart_id, status, currency, base_currency, exchange_rate, country, subtotal, discount_total,
      shipping_cost, shipping_discount, total, tax_included, contact_name, contact_email, contact_phone, shipping_method,
      shipping_address, delivery_slot, tax_profile, payment_method, payment_provider, payment_expires_at, coupon_code, discounts,
      idempotency_key, request_hash, channel)
    values (
      v_order_id, v_number, p_profile_id, null, 'pending_payment', v_cur, v_base, 1, coalesce(v_addr ->> 'country', 'BO'),
      v_subtotal, v_disc_total, v_ship, 0, v_total, true, v_name, v_email, v_phone, v_method_json, v_addr, v_slot, null,
      p_payment_method, v_pm.provider,
      case when v_pm.window_minutes is not null and not coalesce(p_mark_paid, false) then now() + make_interval(mins => v_pm.window_minutes) end,
      null,
      case when v_disc_total > 0 then jsonb_build_array(jsonb_build_object('type', 'manual', 'amount', v_disc_total, 'reason', v_dreason))
           else '[]'::jsonb end,
      p_idempotency_key, v_hash, p_channel);
    insert into public.order_items (order_id, line_no, variant_id, product_id, product_name, color_name, color_hex, size_label, sku,
                                    image_path, qty, unit_price, line_total, discount, final_total, cost_unit, discount_offers)
    select v_order_id, (l ->> 'line_no')::int, (l ->> 'variant_id')::uuid, (l ->> 'product_id')::uuid, l ->> 'name', l ->> 'color_name',
           l ->> 'color_hex', l ->> 'size_label', l ->> 'sku', l ->> 'image_path', (l ->> 'qty')::int, (l ->> 'unit_price')::numeric,
           (l ->> 'line_total')::numeric, (l ->> 'discount')::numeric, (l ->> 'line_total')::numeric - (l ->> 'discount')::numeric,
           nullif(l -> 'cost_unit', 'null'::jsonb)::text::numeric, coalesce(l -> 'discount_offers', '[]'::jsonb)
      from jsonb_array_elements(v_lines) l;
    for r in select (l ->> 'variant_id')::uuid as variant_id, (l ->> 'qty')::int as qty from jsonb_array_elements(v_lines) l
              order by (l ->> 'variant_id')::uuid loop
      perform public.apply_stock_change(r.variant_id, -r.qty, 'sale', v_number, 'Pedido manual ' || v_number, auth.uid());
    end loop;
    insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_kind, reason)
    values (v_order_id, null, 'pending_payment', auth.uid(), 'admin', 'manual:' || p_channel);
    insert into public.payments (order_id, provider, method, status, amount, currency)
    values (v_order_id, v_pm.provider, p_payment_method, 'pending', v_total, v_cur);
    if v_note is not null then
      insert into public.order_notes (order_id, author_id, body) values (v_order_id, auth.uid(), v_note);
    end if;
    -- Un precio fijado a mano queda a la vista en las notas del pedido.
    if exists (select 1 from jsonb_array_elements(v_lines) l where (l ->> 'price_override')::boolean) then
      insert into public.order_notes (order_id, author_id, body)
      values (v_order_id, auth.uid(), 'Precio fijado a mano en: ' || (select string_agg(l ->> 'name', ', ') from jsonb_array_elements(v_lines) l
                                                                       where (l ->> 'price_override')::boolean));
    end if;
  exception when sqlstate 'MC001' then
    return sqlerrm::jsonb;
  end;

  if coalesce(p_mark_paid, false) then
    v_tr := public.transition_order_status(v_order_id, 'paid', auth.uid(), 'admin', 'Pago recibido (pedido manual)');
  end if;
  perform public._order_notify(v_order_id, 'order_created', 'customer');
  return jsonb_build_object('outcome', 'created', 'order_id', v_order_id, 'number', v_number,
                            'status', (select x2.status from public.orders x2 where x2.id = v_order_id), 'total', v_total);
end;
$$;

-- ── 24. Permisos ─────────────────────────────────────────────────────────────────────────────
-- `pg_default_acl` da EXECUTE a `service_role` en TODA función nueva: se le quita. Las internas no las ejecuta nadie desde fuera
-- (solo otras funciones SECURITY DEFINER). Las que ejecuta el navegador autorizan POR DENTRO con `is_admin()`.
revoke all on function
  public._attention_rows(),
  public._refund_compute(uuid, jsonb, boolean, numeric, numeric, boolean),
  public._refund_settle(uuid, uuid),
  public._order_paid_amount(uuid),
  public._order_refunded_amount(uuid, boolean),
  public._order_balance(uuid),
  public._order_stock_free(uuid),
  public._order_address_clean(jsonb),
  public.is_blacklisted(uuid, text, text),
  public.refunds_guard(),
  public.order_items_guard(),
  public.store_settings_validate_s12(),
  public.admin_order_history(uuid),
  public.admin_orders_status_counts(),
  public.admin_attention_summary(),
  public.admin_attention_orders(),
  public.admin_add_order_note(uuid, text),
  public.admin_transition_order(uuid, text, text, text),
  public.admin_undo_transition(uuid, text),
  public.admin_blacklist_add(text, uuid, text, text, text, uuid, boolean),
  public.admin_blacklist_lift(uuid, text),
  public.admin_blacklist_matches(uuid),
  public.admin_incident_open(uuid, text, text, numeric, text),
  public.admin_incident_update(uuid, text, text, numeric, text),
  public.admin_refund_order(uuid, text, text, jsonb, boolean, numeric, numeric, text, text, text, text, uuid, boolean, boolean, boolean),
  public.admin_process_refund(uuid, text, text),
  public.admin_reject_refund(uuid, text),
  public.admin_return_open(uuid, jsonb, text, text),
  public.admin_return_close(uuid, jsonb),
  public.admin_return_reject(uuid, text),
  public.admin_cod_collect(uuid, numeric, text),
  public.admin_cod_reject(uuid, numeric, text, boolean, text),
  public.admin_edit_order(uuid, timestamptz, jsonb, jsonb, jsonb, numeric, numeric, text, boolean),
  public.admin_create_manual_order(uuid, jsonb, text, text, text, jsonb, text, numeric, uuid, date, numeric, text, text, text, text, text, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function
  public.admin_order_history(uuid),
  public.admin_orders_status_counts(),
  public.admin_attention_summary(),
  public.admin_attention_orders(),
  public.admin_add_order_note(uuid, text),
  public.admin_transition_order(uuid, text, text, text),
  public.admin_undo_transition(uuid, text),
  public.admin_blacklist_add(text, uuid, text, text, text, uuid, boolean),
  public.admin_blacklist_lift(uuid, text),
  public.admin_blacklist_matches(uuid),
  public.admin_incident_open(uuid, text, text, numeric, text),
  public.admin_incident_update(uuid, text, text, numeric, text),
  public.admin_refund_order(uuid, text, text, jsonb, boolean, numeric, numeric, text, text, text, text, uuid, boolean, boolean, boolean),
  public.admin_process_refund(uuid, text, text),
  public.admin_reject_refund(uuid, text),
  public.admin_return_open(uuid, jsonb, text, text),
  public.admin_return_close(uuid, jsonb),
  public.admin_return_reject(uuid, text),
  public.admin_cod_collect(uuid, numeric, text),
  public.admin_cod_reject(uuid, numeric, text, boolean, text),
  public.admin_edit_order(uuid, timestamptz, jsonb, jsonb, jsonb, numeric, numeric, text, boolean),
  public.admin_create_manual_order(uuid, jsonb, text, text, text, jsonb, text, numeric, uuid, date, numeric, text, text, text, text, text, boolean, boolean)
  to authenticated;
