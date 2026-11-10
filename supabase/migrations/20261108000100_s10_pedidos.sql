-- Sprint 10 — Pedidos y checkout (WhatsApp / contra entrega)
-- BR-CHK-01/02/04/05, BR-ORD-01/02/04/05/06, BR-INV-02..04, BR-PRC-05, BR-PAY-01 (WhatsApp y contra entrega), BR-PAY-02,
-- BR-PAY-06/07 (base), BR-DAT-02, S-05, S-07.
--
-- Diseño (decisiones tomadas leyendo S2, S7, S8 y S9; ver docs/pedidos.md):
--  · STOCK FIRME = descuento de `stock_on_hand` al crear el pedido (`apply_stock_change(-qty, 'sale')`, maestro §7.2): no se crean
--    reservas de pedido. Las retenciones del carrito pasan a `consumed`. Cancelar repone (`+qty`, 'cancel').
--  · `create_order` es UNA función (solo service_role). Orden de candados FIJO, para que no haya ciclos entre pedidos:
--      fila de `profiles` (serializa por clienta) → candado del carrito → variantes `FOR UPDATE` por id → franja de entrega →
--      usos de descuentos/cupones (por id) → contador del número (al final) → resto de escrituras (sin disputa).
--  · La parte que ESCRIBE va en un sub-bloque `begin … exception when sqlstate 'MC001'`: si algo falla (franja llena, cupón
--    agotado) se revierte TODO (stock, usos, contador: la numeración queda sin huecos) y se devuelve un resultado estructurado.
--  · Idempotencia: `unique (profile_id, idempotency_key)` y la comprobación se hace bajo el candado de la clienta.
--  · `_checkout_compute` es el ÚNICO cálculo: lo usan `checkout_preview` y `create_order`, así que la pantalla y el pedido
--    coinciden por construcción. El envío se cotiza con el subtotal SIN descuento (igual que el estimador de S8) y el envío
--    gratis lo decide el motor de S9 sobre ese costo.
--  · El estado del pedido solo cambia con `transition_order_status` (trigger de guarda). Lo que se guarda en el pedido es una
--    INSTANTÁNEA inmutable (BR-ORD-06): editar o archivar productos después no la altera.
--
-- Rollback manual (orden inverso):
--   select cron.unschedule('remind-pending-orders'); select cron.unschedule('expire-unconfirmed-orders');
--   drop function public.remind_pending_orders(), public.expire_unconfirmed_orders(), public.admin_transition_order(uuid, text, text),
--     public.cancel_order_by_customer(uuid, uuid, text), public.transition_order_status(uuid, text, uuid, text, text),
--     public.create_order(uuid, uuid, uuid, text, uuid, date, text, text, text, text, numeric, text),
--     public.checkout_preview(uuid, uuid, uuid, text, uuid, date, text), public._checkout_compute(uuid, uuid, uuid, uuid, text, uuid, date, text, int, boolean),
--     public._order_json(uuid), public._order_transition_ok(text, text, text), public._order_notify(uuid, text, text),
--     public._next_order_number(text), public.orders_guard(), public.order_counters_guard(), public.store_settings_validate_s10();
--   create or replace function public._customer_order_count(p_profile_id uuid) returns int language sql stable security definer
--     set search_path = '' as $f$ select 0 $f$;
--   drop table public.payments, public.order_status_history, public.order_items, public.orders, public.order_counters, public.payment_methods;
--   delete from public.store_settings where key in ('order_reminder_hours', 'open_orders_max');

-- ── 1. Ajustes ──────────────────────────────────────────────────────────────────────────────
insert into public.store_settings (key, value, value_type, is_public, description) values
  ('order_reminder_hours', '24', 'int', false,
   'Horas que un pedido por WhatsApp o contra entrega puede esperar sin confirmarse antes de recordárselo al administrador (S-05); se repite cada 24 h hasta que se confirme o cancele'),
  ('open_orders_max', '5', 'int', false,
   'Pedidos sin confirmar (pendientes de pago) que una clienta puede tener a la vez: cada uno compromete stock hasta que el admin lo confirme o cancele (S-05), así que sin tope una cuenta podría acaparar el inventario')
on conflict (key) do nothing;

create or replace function public.store_settings_validate_s10()
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
  if (new.key = 'order_reminder_hours' and (v_text::int < 1 or v_text::int > 720))
     or (new.key = 'open_orders_max' and (v_text::int < 1 or v_text::int > 200)) then
    raise exception 'el ajuste "%" está fuera de rango', new.key using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists store_settings_validate_s10_trg on public.store_settings;
create trigger store_settings_validate_s10_trg before insert or update on public.store_settings
  for each row when (new.key in ('order_reminder_hours', 'open_orders_max')) execute function public.store_settings_validate_s10();

-- ── 2. Métodos de pago por país (BR-PAY-02: el flujo no sabe de proveedores) ─────────────────
-- `provider` elige la implementación de `PaymentProvider` (Edge Function): whatsapp, cash_on_delivery (S10); manual_qr, … (S11).
-- `window_minutes` NO nulo = el pedido vence si no se paga a tiempo (S11, BR-PAY-03); WhatsApp y contra entrega no expiran (S-05).
create table if not exists public.payment_methods (
  id                      uuid primary key default gen_random_uuid(),
  country                 text not null references public.countries (code),
  code                    text not null check (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  provider                text not null check (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  name                    text not null check (char_length(btrim(name)) between 1 and 80),
  description             text check (description is null or char_length(btrim(description)) between 1 and 300),
  is_active               boolean not null default true,
  sort_order              int not null default 0,
  max_amount              numeric check (max_amount is null or (max_amount > 0 and max_amount < 1000000000)),
  window_minutes          int check (window_minutes is null or window_minutes between 1 and 1440),
  blocked_for_blacklisted boolean not null default false,
  archived_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint payment_methods_country_code_key unique (country, code)
);
drop trigger if exists payment_methods_set_updated_at on public.payment_methods;
create trigger payment_methods_set_updated_at before update on public.payment_methods
  for each row execute function public.set_updated_at();
select public._apply_admin_rls('payment_methods',
  array['country', 'code', 'provider', 'name', 'description', 'is_active', 'sort_order', 'max_amount', 'window_minutes',
        'blocked_for_blacklisted'],
  array['name', 'description', 'is_active', 'sort_order', 'max_amount', 'window_minutes', 'blocked_for_blacklisted',
        'archived_at']);

-- Solo proveedores IMPLEMENTADOS: uno inventado dejaría pedidos sin forma de completarse (la Edge Function no lo conocería).
-- Se amplía por migración al sumar un proveedor (S11: QR manual, CobraFácil…).
alter table public.payment_methods drop constraint if exists payment_methods_provider_supported;
alter table public.payment_methods add constraint payment_methods_provider_supported
  check (provider in ('whatsapp', 'cash_on_delivery'));

-- Valores de EJEMPLO (BO): el dueño define los reales (política de contra entrega: zonas y montos, PENDIENTES_ADMIN).
insert into public.payment_methods (country, code, provider, name, description, sort_order, max_amount, blocked_for_blacklisted)
values
  ('BO', 'whatsapp', 'whatsapp', 'Pedir por WhatsApp (ejemplo)',
   'Envías tu pedido por WhatsApp y te confirmamos el pago y la entrega por ahí.', 10, null, false),
  ('BO', 'cash_on_delivery', 'cash_on_delivery', 'Efectivo contra entrega (ejemplo)',
   'Pagas en efectivo cuando recibes tu pedido.', 20, null, true)
on conflict (country, code) do nothing;

-- ── 3. Numeración correlativa SIN huecos (BR-ORD-04) ─────────────────────────────────────────
-- El contador se incrementa en la MISMA transacción que crea el pedido: si algo falla, el incremento también se revierte.
create table if not exists public.order_counters (
  prefix     text primary key check (prefix ~ '^[A-Z]{2,5}$'),
  last_value bigint not null default 0 check (last_value >= 0)
);
insert into public.order_counters (prefix, last_value) values ('MIC', 0) on conflict (prefix) do nothing;
select public._apply_admin_rls('order_counters', null, null);
revoke insert, update on public.order_counters from service_role;

-- Solo puede avanzar de uno en uno (nadie «salta» ni retrocede el contador).
create or replace function public.order_counters_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'los contadores de pedidos no se borran' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.prefix is distinct from old.prefix or new.last_value <> old.last_value + 1) then
    raise exception 'el contador de pedidos solo avanza de uno en uno' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists order_counters_guard on public.order_counters;
create trigger order_counters_guard before update or delete on public.order_counters
  for each row execute function public.order_counters_guard();
drop trigger if exists order_counters_no_truncate on public.order_counters;
create trigger order_counters_no_truncate before truncate on public.order_counters
  for each statement execute function public.immutable_row();

create or replace function public._next_order_number(p_prefix text default 'MIC')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v bigint;
begin
  update public.order_counters set last_value = last_value + 1 where prefix = p_prefix returning last_value into v;
  if v is null then
    raise exception 'no existe el contador "%"', p_prefix using errcode = 'P0002';
  end if;
  -- lpad RECORTA si el número es más largo que el ancho: a partir de 1 000 000 se escribe completo.
  return p_prefix || '-' || case when v < 1000000 then lpad(v::text, 6, '0') else v::text end;
end;
$$;

-- ── 4. Pedidos ──────────────────────────────────────────────────────────────────────────────
-- Todo lo que está aquí es una INSTANTÁNEA (BR-ORD-06): nombre, variante, precios, dirección, envío, moneda y tipo de cambio
-- quedan congelados. Solo cambian el estado y sus fechas (trigger `orders_guard`).
create table if not exists public.orders (
  id                 uuid primary key default gen_random_uuid(),
  number             text not null unique check (number ~ '^[A-Z]{2,5}-[0-9]{6,}$'),
  profile_id         uuid not null references public.profiles (id) on delete restrict,
  -- Los pgTAP antiguos hacen `delete from public.carts`: el pedido no debe impedirlo.
  cart_id            uuid references public.carts (id) on delete set null,
  status             text not null default 'pending_payment' check (status in
                       ('pending_payment', 'paid', 'preparing', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded')),
  currency           text not null references public.currencies (code),
  base_currency      text not null references public.currencies (code),
  exchange_rate      numeric(18, 8) not null default 1 check (exchange_rate > 0),
  country            text not null references public.countries (code),
  subtotal           numeric not null check (subtotal >= 0),
  discount_total     numeric not null default 0 check (discount_total >= 0),
  shipping_cost      numeric not null default 0 check (shipping_cost >= 0),
  shipping_discount  numeric not null default 0 check (shipping_discount >= 0),
  total              numeric not null check (total >= 0),
  -- BR-PRC-01: el precio mostrado ya incluye impuestos; el desglose fiscal está pendiente del dueño.
  tax_included       boolean not null default true,
  contact_name       text not null check (char_length(btrim(contact_name)) between 1 and 120),
  contact_email      text check (contact_email is null or (contact_email = lower(btrim(contact_email))
                       and char_length(contact_email) <= 254 and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  contact_phone      text not null check (contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  shipping_method    jsonb not null check (jsonb_typeof(shipping_method) = 'object'),
  shipping_address   jsonb check (shipping_address is null or jsonb_typeof(shipping_address) = 'object'),
  delivery_slot      jsonb check (delivery_slot is null or jsonb_typeof(delivery_slot) = 'object'),
  tax_profile        jsonb check (tax_profile is null or jsonb_typeof(tax_profile) = 'object'),
  payment_method     text not null,
  payment_provider   text not null,
  -- NULL = no vence (WhatsApp y contra entrega, S-05).
  payment_expires_at timestamptz,
  coupon_code        text,
  discounts          jsonb not null default '[]' check (jsonb_typeof(discounts) = 'array'),
  idempotency_key    text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{8,64}$'),
  -- Huella de LO QUE SE PIDIÓ (dirección, envío, franja, pago, contacto): la misma llave con otro contenido es un conflicto.
  request_hash       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  paid_at            timestamptz,
  cancelled_at       timestamptz,
  cancelled_by       text check (cancelled_by is null or cancelled_by in ('customer', 'admin', 'system')),
  cancel_reason      text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  reminder_sent_at   timestamptz,
  constraint orders_idempotency_key unique (profile_id, idempotency_key),
  -- Cuadra al centavo: lo que se paga es lo que se muestra.
  constraint orders_total_math check (total = subtotal - discount_total + shipping_cost - shipping_discount),
  constraint orders_discount_le_subtotal check (discount_total <= subtotal),
  constraint orders_shipping_discount_le_cost check (shipping_discount <= shipping_cost),
  constraint orders_cancel_consistent check ((status = 'cancelled') = (cancelled_at is not null) or status = 'refunded')
);
alter table public.orders add column if not exists request_hash text;
create index if not exists orders_profile_idx on public.orders (profile_id, created_at desc);
create index if not exists orders_status_idx on public.orders (status, created_at);
create index if not exists orders_pending_expiry_idx on public.orders (payment_expires_at)
  where status = 'pending_payment' and payment_expires_at is not null;

create table if not exists public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete restrict,
  line_no         int not null check (line_no >= 1),
  variant_id      uuid not null references public.product_variants (id) on delete restrict,
  product_id      uuid not null references public.products (id) on delete restrict,
  product_name    text not null,
  color_name      text,
  color_hex       text,
  size_label      text,
  sku             text,
  image_path      text,
  qty             int not null check (qty >= 1),
  unit_price      numeric not null check (unit_price >= 0),
  line_total      numeric not null check (line_total >= 0),
  discount        numeric not null default 0 check (discount >= 0),
  final_total     numeric not null check (final_total >= 0),
  -- Costo del producto al momento del pedido (margen y utilidad, BR-ADM-01); puede no estar cargado.
  cost_unit       numeric check (cost_unit is null or cost_unit >= 0),
  discount_offers jsonb not null default '[]' check (jsonb_typeof(discount_offers) = 'array'),
  constraint order_items_line_key unique (order_id, line_no),
  constraint order_items_math check (final_total = line_total - discount)
);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_variant_idx on public.order_items (variant_id);

create table if not exists public.order_status_history (
  id         bigint generated always as identity primary key,
  order_id   uuid not null references public.orders (id) on delete restrict,
  from_status text,
  to_status  text not null,
  actor_id   uuid,
  actor_kind text not null check (actor_kind in ('customer', 'admin', 'system')),
  reason     text check (reason is null or char_length(reason) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists order_status_history_order_idx on public.order_status_history (order_id, id);

-- Base de pagos (S10: WhatsApp y contra entrega; S11 la completa con webhooks y reembolsos).
create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete restrict,
  provider     text not null,
  method       text not null,
  status       text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
  amount       numeric not null check (amount >= 0),
  currency     text not null references public.currencies (code),
  provider_ref text check (provider_ref is null or char_length(provider_ref) <= 200),
  created_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists payments_order_idx on public.payments (order_id);
drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

-- RLS: solo lectura. Los pedidos los crea y cambia ÚNICAMENTE el servidor (funciones); la clienta ve los suyos, el admin todos.
select public._apply_admin_rls('orders', null, null);
select public._apply_admin_rls('order_items', null, null);
select public._apply_admin_rls('order_status_history', null, null);
select public._apply_admin_rls('payments', null, null);
revoke insert, update on public.orders, public.order_items, public.order_status_history, public.payments from service_role;

-- La clienta lee SOLO lo que muestran «Mis pedidos» y la confirmación. NUNCA el costo del producto (`order_items.cost_unit`:
-- es el costo del negocio, no se le puede enseñar el margen de lo que compró) ni las notas internas del historial
-- (`reason`, `actor_id`). El privilegio va por COLUMNA; las consultas de la tienda piden columnas explícitas. El admin comparte
-- el rol `authenticated`: para leer el costo (margen y utilidad, S14) usará una función o vista que exija `is_admin()`.
revoke select on public.order_items from authenticated;
grant select (id, order_id, line_no, variant_id, product_id, product_name, color_name, color_hex, size_label, sku, image_path,
              qty, unit_price, line_total, discount, final_total, discount_offers)
  on public.order_items to authenticated;
revoke select on public.order_status_history from authenticated;
grant select (id, order_id, from_status, to_status, actor_kind, created_at) on public.order_status_history to authenticated;

drop policy if exists orders_owner_select on public.orders;
create policy orders_owner_select on public.orders for select to authenticated
  using (profile_id = (select auth.uid()));
drop policy if exists order_items_owner_select on public.order_items;
create policy order_items_owner_select on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.profile_id = (select auth.uid())));
drop policy if exists order_status_history_owner_select on public.order_status_history;
create policy order_status_history_owner_select on public.order_status_history for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.profile_id = (select auth.uid())));
drop policy if exists payments_owner_select on public.payments;
create policy payments_owner_select on public.payments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.profile_id = (select auth.uid())));

-- Guardas: nada se borra, la instantánea no cambia y el estado solo lo cambia `transition_order_status`.
create or replace function public.orders_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- `cart_id` también: `on delete set null` actualiza la fila cuando un pgTAP antiguo borra carritos (no es un cambio del pedido).
  v_free text[] := array['status', 'updated_at', 'paid_at', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'reminder_sent_at',
                         'cart_id'];
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
drop trigger if exists orders_guard on public.orders;
create trigger orders_guard before update or delete on public.orders
  for each row execute function public.orders_guard();

do $$
declare t text;
begin
  foreach t in array array['orders', 'order_items', 'order_status_history'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_immutable_trg', t);
    if t <> 'orders' then
      execute format('create trigger %I before update or delete on public.%I for each row execute function public.immutable_row()',
                     t || '_immutable_trg', t);
    end if;
    execute format('drop trigger if exists %I on public.%I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.immutable_row()',
                   t || '_no_truncate', t);
  end loop;
end $$;

-- Auditoría (BR-ADM-03): se registra QUE cambiaron los datos personales, nunca su valor.
drop trigger if exists audit_orders on public.orders;
create trigger audit_orders after insert or update or delete on public.orders
  for each row execute function public.audit_changes('contact_name', 'contact_email', 'contact_phone', 'shipping_address',
                                                      'tax_profile');
drop trigger if exists audit_payment_methods on public.payment_methods;
create trigger audit_payment_methods after insert or update or delete on public.payment_methods
  for each row execute function public.audit_changes();
drop trigger if exists audit_payments on public.payments;
create trigger audit_payments after insert or update or delete on public.payments
  for each row execute function public.audit_changes();

-- ── 5. «Primera compra» (S9): pedidos no cancelados de la clienta ──────────────────────────────
create or replace function public._customer_order_count(p_profile_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.orders o where o.profile_id = p_profile_id and o.status not in ('cancelled', 'refunded')
$$;

-- ── 6. Utilidades ──────────────────────────────────────────────────────────────────────────
-- Transiciones válidas (BR-ORD-01/02, maestro §7.3). El cliente solo cancela ANTES de «preparing»; el sistema solo vence
-- pedidos sin pagar; el admin recorre todo el flujo.
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
    when 'system' then p_to = 'cancelled' and p_from = 'pending_payment'
    else false end
$$;

-- Encola un aviso del pedido de forma RESILIENTE: si la cola falla, el pedido NO se revierte (el sprint lo exige).
-- Sin datos personales en el payload (el destinatario va en su propia columna); la plantilla la resuelve S13.
create or replace function public._order_notify(p_order_id uuid, p_type text, p_audience text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  v_acct record;
  v_payload jsonb;
begin
  begin
    select * into o from public.orders where id = p_order_id;
    if not found then
      return;
    end if;
    v_payload := jsonb_build_object('order_id', o.id, 'number', o.number, 'status', o.status, 'total', o.total,
                                    'currency', o.currency);
    if p_audience = 'customer' then
      -- Al correo o teléfono de la CUENTA, no al que se escribió en el formulario: ese valor no se verifica y cualquiera podría
      -- hacer que la tienda escribiera a un tercero («relevo» de avisos). El contacto del formulario es un dato del pedido.
      select p.email, p.phone_e164 into v_acct from public.profiles p where p.id = o.profile_id;
      if v_acct.email is not null then
        perform public.enqueue_notification(p_type, 'email', v_acct.email, v_payload, p_type || ':' || o.id::text || ':c');
      elsif v_acct.phone_e164 is not null then
        perform public.enqueue_notification(p_type, 'whatsapp', v_acct.phone_e164, v_payload, p_type || ':' || o.id::text || ':c');
      end if;
    else
      perform public.enqueue_notification(p_type, 'email', null, v_payload, p_type || ':' || o.id::text || ':a');
    end if;
  exception when others then
    raise warning 'no se pudo encolar el aviso % del pedido %: %', p_type, p_order_id, sqlerrm;
  end;
end;
$$;

-- El pedido como lo ve quien lo creó (respuesta de create_order y reintentos idempotentes).
create or replace function public._order_json(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id, 'number', o.number, 'status', o.status, 'currency', o.currency, 'country', o.country,
    'subtotal', o.subtotal, 'discount_total', o.discount_total, 'shipping_cost', o.shipping_cost,
    'shipping_discount', o.shipping_discount, 'total', o.total, 'tax_included', o.tax_included,
    'contact_name', o.contact_name, 'contact_email', o.contact_email, 'contact_phone', o.contact_phone,
    'shipping_method', o.shipping_method, 'shipping_address', o.shipping_address, 'delivery_slot', o.delivery_slot,
    'tax_profile', o.tax_profile, 'payment_method', o.payment_method, 'payment_provider', o.payment_provider,
    'payment_expires_at', o.payment_expires_at, 'coupon_code', o.coupon_code, 'discounts', o.discounts,
    'created_at', o.created_at, 'paid_at', o.paid_at, 'cancelled_at', o.cancelled_at, 'cancel_reason', o.cancel_reason,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'line_no', i.line_no, 'variant_id', i.variant_id, 'product_id', i.product_id,
        'product_name', i.product_name, 'color_name', i.color_name, 'color_hex', i.color_hex, 'size_label', i.size_label,
        'sku', i.sku, 'image_path', i.image_path, 'qty', i.qty, 'unit_price', i.unit_price, 'line_total', i.line_total,
        'discount', i.discount, 'final_total', i.final_total, 'discount_offers', i.discount_offers) order by i.line_no)
        from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'payment', (select jsonb_build_object('provider', p.provider, 'method', p.method, 'status', p.status, 'amount', p.amount)
                  from public.payments p where p.order_id = o.id order by p.created_at, p.id limit 1))
    from public.orders o where o.id = p_order_id
$$;

-- ── 7. El cálculo ÚNICO del checkout ─────────────────────────────────────────────────────────
-- No escribe nada y no bloquea nada: quien lo llama decide si antes toma candados (create_order) o no (la vista previa).
-- Devuelve TODO lo que la pantalla muestra y lo que el pedido guardará. Los errores son códigos estables (`errors[].code`).
-- `p_require_payment`: la vista previa NO necesita el método de pago (no cambia ningún importe: la lista de métodos ya trae su
-- disponibilidad), así que no lo exige; `create_order` sí.
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
    if v_pm.blocked_for_blacklisted and v_profile.blacklisted then
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

-- Vista previa para la pantalla (BR-CHK-04): mismos números que `create_order`, sin escribir nada.
create or replace function public.checkout_preview(
  p_profile_id uuid, p_address_id uuid, p_tax_profile_id uuid, p_shipping_method text, p_slot_id uuid, p_delivery_date date,
  p_payment_method text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart uuid;
  v_state text;
begin
  select o_id, o_state into v_cart, v_state from public._cart_resolve(p_profile_id, null, false);
  if v_cart is null then
    return jsonb_build_object('outcome', 'no_cart', 'server_time', now());
  end if;
  return jsonb_build_object('outcome', 'preview', 'server_time', now(),
    'checkout', public._checkout_compute(p_profile_id, v_cart, p_address_id, p_tax_profile_id, p_shipping_method, p_slot_id,
                                         p_delivery_date, p_payment_method, 14, false));
end;
$$;

-- ── 8. create_order ─────────────────────────────────────────────────────────────────────────
-- outcome: created | existing (reintento con la misma llave) | changed (precio/total distinto: confirmar) |
--          unavailable (sin stock suficiente: detalle por línea) | rejected (algo que la persona debe corregir).
-- NADA se escribe salvo en `created`; en cualquier otro resultado la transacción no deja rastro (ni stock, ni usos, ni número).
create or replace function public.create_order(
  p_profile_id uuid, p_address_id uuid, p_tax_profile_id uuid, p_shipping_method text, p_slot_id uuid, p_delivery_date date,
  p_payment_method text, p_contact_name text, p_contact_email text, p_contact_phone text, p_expected_total numeric,
  p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
  v_existing uuid;
  v_cart uuid;
  v_state text;
  v_cmp jsonb;
  v_lines jsonb;
  v_bad jsonb;
  v_dec int;
  v_total numeric;
  v_order_id uuid := gen_random_uuid();
  v_number text;
  v_pm record;
  v_name text := btrim(coalesce(p_contact_name, ''));
  v_email text := nullif(lower(btrim(coalesce(p_contact_email, ''))), '');
  v_slot jsonb;
  v_sres jsonb;
  v_dres jsonb;
  v_applied jsonb;
  v_coupon jsonb;
  v_hash text;
  v_existing_hash text;
  v_open int;
  r record;
begin
  -- Entradas: basura = error de petición (22023), no un resultado de negocio.
  if p_profile_id is null or p_expected_total is null or p_expected_total < 0
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,64}$'
     or char_length(v_name) not between 1 and 120
     or p_contact_phone is null or p_contact_phone !~ '^\+[1-9][0-9]{7,14}$'
     or (v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')) then
    raise exception 'datos del pedido inválidos' using errcode = '22023';
  end if;

  -- 1. La clienta: su fila es el primer candado (serializa SUS pedidos: «primera compra» y reintentos).
  select * into v_profile from public.profiles p where p.id = p_profile_id for update;
  if not found or not v_profile.is_active or v_profile.anonymized_at is not null then
    return jsonb_build_object('outcome', 'rejected',
      'errors', jsonb_build_array(jsonb_build_object('code', 'account_inactive', 'field', 'account')));
  end if;

  -- 2. Reintento idempotente: la misma llave devuelve el mismo pedido (ni stock ni usos dos veces) SIEMPRE QUE se pida lo
  -- mismo: con otro contenido (otra dirección, otro método de pago…) no se devuelve el pedido viejo como si fuera el nuevo.
  v_hash := md5(concat_ws('|', coalesce(p_address_id::text, ''), coalesce(p_tax_profile_id::text, ''),
                          coalesce(p_shipping_method, ''), coalesce(p_slot_id::text, ''), coalesce(p_delivery_date::text, ''),
                          coalesce(p_payment_method, ''), v_name, coalesce(v_email, ''), p_contact_phone));
  select o.id, o.request_hash into v_existing, v_existing_hash
    from public.orders o where o.profile_id = p_profile_id and o.idempotency_key = p_idempotency_key;
  if v_existing is not null then
    if v_existing_hash is not null and v_existing_hash <> v_hash then
      return jsonb_build_object('outcome', 'rejected',
        'errors', jsonb_build_array(jsonb_build_object('code', 'idempotency_conflict', 'field', 'order')));
    end if;
    return jsonb_build_object('outcome', 'existing', 'order', public._order_json(v_existing));
  end if;

  -- 2b. Tope de pedidos sin confirmar por clienta (S-05 compromete stock sin vencimiento: sin tope se podría acaparar).
  select count(*)::int into v_open from public.orders o where o.profile_id = p_profile_id and o.status = 'pending_payment';
  if v_open >= public.setting_int('open_orders_max', 5) then
    return jsonb_build_object('outcome', 'rejected',
      'errors', jsonb_build_array(jsonb_build_object('code', 'too_many_open_orders', 'field', 'account')));
  end if;

  -- 3. El carrito y su candado (el mismo de las funciones del carrito: no se agrega nada mientras se compra).
  select o_id, o_state into v_cart, v_state from public._cart_resolve(p_profile_id, null, false);
  if v_cart is null or not public._cart_lock_active(v_cart) then
    return jsonb_build_object('outcome', 'rejected',
      'errors', jsonb_build_array(jsonb_build_object('code', 'cart_empty', 'field', 'cart')));
  end if;

  -- 4. Las variantes, EN ORDEN de id: los pedidos que comparten variantes se serializan sin ciclos.
  perform 1 from public.product_variants v
   where v.id in (select ci.variant_id from public.cart_items ci where ci.cart_id = v_cart)
   order by v.id for update;

  -- 5. Cálculo (con las variantes ya bloqueadas: lo que se ve es lo que se vende).
  v_cmp := public._checkout_compute(p_profile_id, v_cart, p_address_id, p_tax_profile_id, p_shipping_method, p_slot_id,
                                    p_delivery_date, p_payment_method, 1);
  if (v_cmp -> 'errors') @> '[{"code": "cart_empty"}]'::jsonb then
    return jsonb_build_object('outcome', 'rejected', 'errors', v_cmp -> 'errors');
  end if;
  v_lines := v_cmp -> 'lines';
  v_dec := (v_cmp ->> 'decimals')::int;

  -- 5a. Sin stock suficiente (o variante ya no disponible): detalle por línea, nada se crea.
  select coalesce(jsonb_agg(l), '[]'::jsonb) into v_bad
    from jsonb_array_elements(v_lines) l where l ->> 'status' in ('unavailable', 'out_of_stock', 'low_stock');
  if jsonb_array_length(v_bad) > 0 then
    return jsonb_build_object('outcome', 'unavailable', 'lines', v_bad, 'totals', v_cmp -> 'totals');
  end if;
  -- 5b. Cosas que la persona debe corregir (dirección, cobertura, franja, método de pago…).
  if not (v_cmp ->> 'ok')::boolean then
    return jsonb_build_object('outcome', 'rejected', 'errors', v_cmp -> 'errors');
  end if;
  -- 5c. Una subida de precio con la garantía vencida sigue bloqueando hasta que la persona la acepte en la bolsa (S7).
  select coalesce(jsonb_agg(l), '[]'::jsonb) into v_bad from jsonb_array_elements(v_lines) l where (l ->> 'blocking')::boolean;
  if jsonb_array_length(v_bad) > 0 then
    return jsonb_build_object('outcome', 'changed', 'reason', 'price', 'lines', v_bad, 'totals', v_cmp -> 'totals',
                              'expected_total', p_expected_total);
  end if;
  -- 5d. BR-CHK-04: el total que la persona vio ya no es el que corresponde → se muestra la diferencia y se confirma.
  v_total := (v_cmp -> 'totals' ->> 'total')::numeric;
  if round(p_expected_total, v_dec) <> v_total then
    return jsonb_build_object('outcome', 'changed', 'reason', 'total', 'lines', v_lines, 'totals', v_cmp -> 'totals',
                              'expected_total', round(p_expected_total, v_dec), 'actual_total', v_total);
  end if;

  select * into v_pm from public.payment_methods m
   where m.country = (v_cmp ->> 'country') and m.code = p_payment_method and m.is_active and m.archived_at is null;

  -- 6. TODO lo que escribe va en un sub-bloque: un MC001 revierte stock, usos, franja y contador.
  begin
    -- 6a. Cupo de la franja (candado de la fila de la franja)
    -- Un valor ausente llega como el JSON `null` (no como SQL NULL): se normaliza para que las restricciones lo vean ausente.
    v_slot := nullif(v_cmp -> 'shipping' -> 'slot', 'null'::jsonb);
    if v_slot is not null and v_slot ->> 'slot_id' is not null then
      v_sres := public.reserve_delivery_slot((v_slot ->> 'slot_id')::uuid, (v_slot ->> 'date')::date, 'order', v_order_id);
      if v_sres ->> 'status' not in ('reserved', 'already') then
        raise exception using errcode = 'MC001', message = jsonb_build_object('outcome', 'rejected', 'errors',
          jsonb_build_array(jsonb_build_object('code', case when v_sres ->> 'status' = 'full' then 'slot_full' else 'slot_invalid' end,
                                               'field', 'slot')))::text;
      end if;
    end if;

    -- 6b. Usos de descuentos y cupones (todos o ninguno; la clienta ya está bloqueada, así que la elegibilidad no se cuela)
    v_applied := v_cmp -> 'discounts' -> 'applied';
    if jsonb_array_length(coalesce(v_applied, '[]'::jsonb)) > 0 then
      v_dres := public.discount_reserve('order', v_order_id, p_profile_id, v_applied);
      if not coalesce((v_dres ->> 'ok')::boolean, false) then
        raise exception using errcode = 'MC001', message = jsonb_build_object('outcome', 'changed', 'reason', 'discount',
          'failed', v_dres -> 'failed', 'lines', v_lines, 'totals', v_cmp -> 'totals', 'expected_total', p_expected_total)::text;
      end if;
    end if;

    -- 6c. Número (el contador es el ÚLTIMO candado disputado) y el pedido
    v_number := public._next_order_number('MIC');
    v_coupon := v_cmp -> 'discounts' -> 'coupon';
    insert into public.orders (
      id, number, profile_id, cart_id, status, currency, base_currency, exchange_rate, country,
      subtotal, discount_total, shipping_cost, shipping_discount, total, tax_included,
      contact_name, contact_email, contact_phone, shipping_method, shipping_address, delivery_slot, tax_profile,
      payment_method, payment_provider, payment_expires_at, coupon_code, discounts, idempotency_key, request_hash)
    values (
      v_order_id, v_number, p_profile_id, v_cart, 'pending_payment', v_cmp ->> 'currency', v_cmp ->> 'base_currency',
      (v_cmp ->> 'exchange_rate')::numeric, v_cmp ->> 'country',
      (v_cmp -> 'totals' ->> 'subtotal')::numeric, (v_cmp -> 'totals' ->> 'discount')::numeric,
      (v_cmp -> 'totals' ->> 'shipping')::numeric, (v_cmp -> 'totals' ->> 'shipping_discount')::numeric, v_total, true,
      v_name, v_email, p_contact_phone,
      -- método + cotización completa (qué regla aplicó, distancia): auditable aunque cambien las tarifas
      (v_cmp -> 'shipping' -> 'method') || jsonb_build_object('quote', jsonb_build_object(
        'cost', v_cmp -> 'totals' -> 'shipping', 'distance_km', v_cmp -> 'shipping' -> 'quote' -> 'distance_km',
        'breakdown', v_cmp -> 'shipping' -> 'quote' -> 'breakdown')),
      nullif(v_cmp -> 'shipping' -> 'address', 'null'::jsonb), v_slot, nullif(v_cmp -> 'tax_profile', 'null'::jsonb),
      p_payment_method, v_pm.provider,
      case when v_pm.window_minutes is not null then now() + make_interval(mins => v_pm.window_minutes) end,
      case when v_coupon ->> 'status' = 'applied' then v_coupon ->> 'code' end,
      coalesce(v_applied, '[]'::jsonb), p_idempotency_key, v_hash);

    insert into public.order_items (order_id, line_no, variant_id, product_id, product_name, color_name, color_hex, size_label,
                                    sku, image_path, qty, unit_price, line_total, discount, final_total, cost_unit, discount_offers)
    select v_order_id, t.o::int, (t.l ->> 'variant_id')::uuid, (t.l ->> 'product_id')::uuid, t.l ->> 'name',
           t.l ->> 'color_name', t.l ->> 'color_hex', t.l ->> 'size_label', t.l ->> 'sku', t.l ->> 'image_path',
           (t.l ->> 'billable_qty')::int, (t.l ->> 'unit_price')::numeric, (t.l ->> 'line_total')::numeric,
           (t.l ->> 'discount')::numeric, (t.l ->> 'final_total')::numeric, p.cost_base,
           coalesce(t.l -> 'discount_offers', '[]'::jsonb)
      from jsonb_array_elements(v_lines) with ordinality as t(l, o)
      join public.products p on p.id = (t.l ->> 'product_id')::uuid;

    -- 6c2. Defensa en profundidad: el cálculo toma varias fotos del carrito (una por sentencia). Si un precio cambió ENTRE ellas,
    -- las líneas y los totales no cuadrarían: no se guarda un pedido incoherente, se pide intentarlo de nuevo.
    if (select coalesce(sum(i.line_total), 0) from public.order_items i where i.order_id = v_order_id)
         <> (v_cmp -> 'totals' ->> 'subtotal')::numeric
       or (select coalesce(sum(i.discount), 0) from public.order_items i where i.order_id = v_order_id)
         <> (v_cmp -> 'totals' ->> 'discount')::numeric then
      raise exception using errcode = 'MC001', message = jsonb_build_object('outcome', 'rejected', 'errors',
        jsonb_build_array(jsonb_build_object('code', 'stale_prices', 'field', 'cart')))::text;
    end if;

    -- 6d. Stock firme (BR-INV-04): las variantes ya están bloqueadas y se validó la disponibilidad en el paso 5a.
    for r in select i.variant_id, i.qty from public.order_items i where i.order_id = v_order_id order by i.variant_id loop
      perform public.apply_stock_change(r.variant_id, -r.qty, 'sale', v_number, 'Pedido ' || v_number, p_profile_id);
    end loop;
    -- (bloqueo en orden de id, como `release_stock`: sin cruces con quien libera o expira esas mismas filas)
    with locked as (
      select r2.id from public.stock_reservations r2
       where r2.owner_type = 'cart' and r2.owner_id = v_cart and r2.status = 'active' order by r2.id for update)
    update public.stock_reservations sr set status = 'consumed', updated_at = now() from locked where sr.id = locked.id;

    -- 6e. El carrito queda convertido; el siguiente producto que agregue abre uno nuevo.
    update public.carts set status = 'converted', updated_at = now(), last_activity_at = now() where id = v_cart;

    insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_kind, reason)
    values (v_order_id, null, 'pending_payment', p_profile_id, 'customer', 'created');
    insert into public.payments (order_id, provider, method, status, amount, currency)
    values (v_order_id, v_pm.provider, p_payment_method, 'pending', v_total, v_cmp ->> 'currency');
  exception when sqlstate 'MC001' then
    return sqlerrm::jsonb;
  end;

  -- 7. Avisos (resilientes: un fallo de la cola no revierte el pedido)
  perform public._order_notify(v_order_id, 'order_created', 'customer');
  perform public._order_notify(v_order_id, 'order_new', 'admin');

  return jsonb_build_object('outcome', 'created', 'order', public._order_json(v_order_id));
end;
$$;

-- ── 9. Máquina de estados ────────────────────────────────────────────────────────────────────
-- ÚNICA vía para cambiar el estado. Bloquea la fila del pedido: si la clienta cancela en el mismo instante en que el admin pasa
-- a «preparing», gana la primera transacción y la segunda recibe `invalid_transition` (BR-ORD-02).
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
    update public.payments set status = 'paid' where order_id = p_order_id and status = 'pending';
  elsif p_to = 'cancelled' then
    -- Repone el stock (BR-INV-04) en orden de variante, libera la franja y devuelve los usos del cupón.
    for r in select i.variant_id, sum(i.qty)::int as qty from public.order_items i where i.order_id = p_order_id
              group by i.variant_id order by i.variant_id loop
      perform public.apply_stock_change(r.variant_id, r.qty, 'cancel', o.number, 'Cancelación ' || o.number, p_actor);
    end loop;
    perform public.release_delivery_slot('order', p_order_id);
    perform public.discount_release('order', p_order_id);
    update public.payments set status = 'cancelled' where order_id = p_order_id and status = 'pending';
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

create or replace function public.cancel_order_by_customer(p_profile_id uuid, p_order_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.orders o where o.id = p_order_id and o.profile_id = p_profile_id) then
    -- Un pedido ajeno es «no existe»: no se revela que existe.
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  return public.transition_order_status(p_order_id, 'cancelled', p_profile_id, 'customer', p_reason);
end;
$$;

-- Lo que usará el panel de pedidos (S12) y las pruebas: el admin avanza el pedido por las transiciones válidas.
create or replace function public.admin_transition_order(p_order_id uuid, p_to text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  return public.transition_order_status(p_order_id, p_to, auth.uid(), 'admin', p_reason);
end;
$$;

-- ── 10. Vencimiento y recordatorios (S-05) ───────────────────────────────────────────────────
-- Solo vencen los pedidos de métodos CON ventana de pago (QR, S11). WhatsApp y contra entrega no expiran.
create or replace function public.expire_unconfirmed_orders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n int := 0;
begin
  for r in select o.id from public.orders o
            where o.status = 'pending_payment' and o.payment_expires_at is not null and o.payment_expires_at <= now()
            order by o.id loop
    begin
      if (public.transition_order_status(r.id, 'cancelled', null, 'system', 'expired') ->> 'ok')::boolean then
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

-- Avisa al administrador de los pedidos que llevan demasiado esperando confirmación (una vez cada 24 h por pedido).
create or replace function public.remind_pending_orders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_hours int := public.setting_int('order_reminder_hours', 24);
  v_n int := 0;
begin
  for r in select o.id, o.number, o.created_at from public.orders o
            where o.status = 'pending_payment' and o.payment_expires_at is null
              and o.created_at <= now() - make_interval(hours => v_hours)
              and (o.reminder_sent_at is null or o.reminder_sent_at <= now() - interval '24 hours')
            order by o.created_at, o.id loop
    begin
      perform public.enqueue_notification('order_pending_reminder', 'email', null,
        jsonb_build_object('order_id', r.id, 'number', r.number, 'created_at', r.created_at),
        'order_pending_reminder:' || r.id::text || ':' || to_char(now() at time zone 'utc', 'YYYYMMDD'));
      update public.orders set reminder_sent_at = now() where id = r.id;
      v_n := v_n + 1;
    exception when others then
      raise warning 'no se pudo recordar el pedido %: %', r.id, sqlerrm;
    end;
  end loop;
  return v_n;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('expire-unconfirmed-orders', '*/5 * * * *', 'select public.expire_unconfirmed_orders()');
    perform cron.schedule('remind-pending-orders', '17 * * * *', 'select public.remind_pending_orders()');
  else
    raise notice 'pg_cron no está disponible: los pedidos con ventana de pago no vencerán solos ni se enviarán recordatorios';
  end if;
exception when others then
  raise notice 'no se pudo programar pg_cron: %', sqlerrm;
end $$;

-- ── 10b. La alerta de stock (S3) no puede tumbar una venta ──────────────────────────────────
-- Corre DENTRO de `apply_stock_change` (al vender): si la cola de avisos fallara, el pedido entero se abortaría. El sprint exige
-- lo contrario («un fallo del outbox no revierte el pedido»). Es la misma función de S3, con su cuerpo dentro de un sub-bloque.
create or replace function public.stock_movements_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_info record;
  v_low int;
  v_critical int;
  v_before text;
  v_after text;
begin
  begin
    select pv.id as variant_id, pv.sku, pv.low_threshold, pv.critical_threshold,
           p.id as product_id, p.code, p.name, c.name as color, s.label as size
      into v_info
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
      join public.product_colors c on c.id = pv.color_id
      left join public.product_sizes s on s.id = pv.size_id
     where pv.id = new.variant_id
       and pv.archived_at is null and p.archived_at is null and p.status = 'active';
    if not found then return null; end if;

    v_low := coalesce(v_info.low_threshold, public.setting_int('stock_low_threshold', 5));
    v_critical := least(coalesce(v_info.critical_threshold, public.setting_int('stock_critical_threshold', 2)), v_low);
    v_before := public.stock_status(new.stock_after - new.delta, v_low, v_critical);
    v_after := public.stock_status(new.stock_after, v_low, v_critical);

    if v_after <> 'ok'
       and (case v_after when 'out' then 0 when 'critical' then 1 else 2 end)
         < (case v_before when 'out' then 0 when 'critical' then 1 when 'low' then 2 else 3 end)
       and not exists (select 1 from public.notification_outbox o
                        where o.type = 'stock_alert' and o.status = 'pending'
                          and o.payload ->> 'variant_id' = v_info.variant_id::text and o.payload ->> 'light' = v_after)
    then
      perform public.enqueue_notification(
        'stock_alert', 'email', null,
        jsonb_build_object('variant_id', v_info.variant_id, 'product_id', v_info.product_id, 'product_code', v_info.code,
                           'product_name', v_info.name, 'color', v_info.color, 'size', v_info.size, 'sku', v_info.sku,
                           'stock', new.stock_after, 'light', v_after, 'low_threshold', v_low, 'critical_threshold', v_critical),
        'stock_alert:' || v_info.variant_id || ':' || v_after || ':' || new.id);
    end if;
  exception when others then
    raise warning 'no se pudo encolar la alerta de stock de la variante %: %', new.variant_id, sqlerrm;
  end;
  return null;
end;
$$;

-- ── 11. Permisos ─────────────────────────────────────────────────────────────────────────────
-- `pg_default_acl` da EXECUTE a `service_role` en TODA función nueva: las internas se lo quitan. El navegador no ejecuta nada
-- (todo pasa por la Edge Function `checkout`), salvo el admin que avanza un pedido.
revoke all on function
  public.store_settings_validate_s10(), public.order_counters_guard(), public._next_order_number(text), public.orders_guard(),
  public._order_transition_ok(text, text, text), public._order_notify(uuid, text, text), public._order_json(uuid),
  public._checkout_compute(uuid, uuid, uuid, uuid, text, uuid, date, text, int, boolean),
  public.checkout_preview(uuid, uuid, uuid, text, uuid, date, text),
  public.create_order(uuid, uuid, uuid, text, uuid, date, text, text, text, text, numeric, text),
  public.transition_order_status(uuid, text, uuid, text, text), public.cancel_order_by_customer(uuid, uuid, text),
  public.admin_transition_order(uuid, text, text), public.expire_unconfirmed_orders(), public.remind_pending_orders()
  from public, anon, authenticated, service_role;
grant execute on function
  public.checkout_preview(uuid, uuid, uuid, text, uuid, date, text),
  public.create_order(uuid, uuid, uuid, text, uuid, date, text, text, text, text, numeric, text),
  public.transition_order_status(uuid, text, uuid, text, text), public.cancel_order_by_customer(uuid, uuid, text)
  to service_role;
grant execute on function public.admin_transition_order(uuid, text, text) to authenticated;
