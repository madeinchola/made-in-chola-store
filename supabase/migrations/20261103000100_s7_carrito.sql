-- Sprint 7 — Carrito y retención de stock
-- BR-ACC-01/05, BR-INV-02..04, BR-PRC-05, BR-CHK-03/04, S-04, D-02.
--
-- Diseño:
--  · TODO el acceso al carrito pasa por la Edge Function `cart` (que pone los topes por IP/identidad de D-02) y estas
--    funciones solo las ejecuta `service_role`, igual que `reserve_stock` (S2). El navegador no toca estas tablas.
--  · Un carrito pertenece a un USUARIO (`profile_id`) o a un INVITADO (`token_hash` = sha256 del token opaco que solo
--    conoce su navegador; la base nunca guarda el token). Sin datos personales para invitados.
--  · Las operaciones fijan la cantidad ABSOLUTA de una variante (no suman): repetirlas o reintentarlas no duplica nada.
--  · El servidor decide precios, estados y totales (`_cart_snapshot`); el cliente solo los muestra.
--  · Concurrencia: cada operación toma un candado de asesoramiento por carrito y DESPUÉS la fila de la variante
--    (`reserve_stock`); una fusión toma los dos carritos por orden de id y las variantes por orden de id (sin ciclos).
--
-- Rollback manual:
--   select cron.unschedule('abandon-stale-carts'); select cron.unschedule('purge-old-carts');
--   drop trigger profiles_release_cart on public.profiles;
--   drop trigger store_settings_validate_s7_trg on public.store_settings;
--   delete from public.store_settings where key in ('reserve_on_add_to_cart','cart_max_qty_per_variant','cart_max_lines',
--     'cart_max_reserved_units','price_guarantee_days','guest_cart_retention_days','cart_max_units_per_ip');
--   drop function public.cart_get(uuid, text), public.cart_set_item(uuid, text, uuid, int, boolean, text),
--     public.cart_remove_item(uuid, text, uuid), public.cart_clear(uuid, text), public.cart_refresh(uuid, text),
--     public.cart_accept_prices(uuid, text, uuid, numeric), public.merge_guest_cart(uuid, text), public.cart_abandon_stale(),
--     public.purge_old_carts(), public._cart_snapshot(uuid), public._cart_resolve(uuid, text, boolean, text),
--     public._cart_lock(uuid), public._cart_lock_active(uuid), public._cart_ip_room(uuid, uuid),
--     public._cart_free_for(uuid, uuid), public.profiles_release_cart(),
--     public.store_settings_validate_s7(), public.setting_bool(text, boolean);
--   drop table public.cart_removed_items, public.cart_items, public.carts;

-- ── 1. Ajustes ──────────────────────────────────────────────────────────────────────────────
create or replace function public.setting_bool(p_key text, p_default boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value #>> '{}')::boolean from public.store_settings s
                    where s.key = p_key and s.value_type = 'bool'), p_default)
$$;
revoke all on function public.setting_bool(text, boolean) from public, anon, authenticated;
grant execute on function public.setting_bool(text, boolean) to service_role;

insert into public.store_settings (key, value, value_type, is_public, description) values
  ('reserve_on_add_to_cart', 'true', 'bool', false,
   'D-02: true = el stock se retiene al agregar al carrito; false = solo al iniciar el pago (S10)'),
  ('cart_max_qty_per_variant', '10', 'int', false,
   'Tope de unidades de una misma variante en un carrito (antiacaparamiento, D-02)'),
  ('cart_max_lines', '30', 'int', false, 'Tope de productos distintos (líneas) en un carrito'),
  ('cart_max_reserved_units', '30', 'int', false,
   'Tope de unidades en total en un carrito (y por tanto de stock que puede retener)'),
  ('price_guarantee_days', '7', 'int', false,
   'S-04: días que se respeta el precio con el que un producto entró al carrito (0 = sin garantía)'),
  ('guest_cart_retention_days', '30', 'int', false,
   'Días sin actividad tras los que un carrito de invitado se da por abandonado'),
  ('cart_max_units_per_ip', '150', 'int', false,
   'Tope de unidades que los carritos de invitado de una misma IP pueden tener retenidas a la vez (antiacaparamiento, D-02)')
on conflict (key) do nothing;

-- Rangos. Se ejecuta ANTES del validador genérico (orden alfabético de triggers): solo mira valores ya numéricos y
-- deja que el genérico explique el resto.
create or replace function public.store_settings_validate_s7()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_text text := new.value #>> '{}';
  v_n int;
begin
  if new.key = 'reserve_on_add_to_cart' then
    return new;
  end if;
  if new.value_type <> 'int' or v_text !~ '^[0-9]{1,9}$' then
    return new;
  end if;
  v_n := v_text::int;
  if (new.key = 'cart_max_qty_per_variant' and (v_n < 1 or v_n > 1000))
     or (new.key = 'cart_max_reserved_units' and (v_n < 1 or v_n > 1000))
     or (new.key = 'cart_max_lines' and (v_n < 1 or v_n > 100))
     or (new.key = 'price_guarantee_days' and v_n > 365)
     or (new.key = 'guest_cart_retention_days' and (v_n < 1 or v_n > 365))
     or (new.key = 'cart_max_units_per_ip' and (v_n < 1 or v_n > 10000)) then
    raise exception 'el ajuste "%" está fuera de rango', new.key using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists store_settings_validate_s7_trg on public.store_settings;
create trigger store_settings_validate_s7_trg before insert or update on public.store_settings
  for each row
  when (new.key in ('cart_max_qty_per_variant', 'cart_max_lines', 'cart_max_reserved_units',
                    'price_guarantee_days', 'guest_cart_retention_days', 'cart_max_units_per_ip'))
  execute function public.store_settings_validate_s7();

-- ── 2. Tablas ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.carts (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid references public.profiles (id) on delete restrict,
  token_hash       text check (token_hash ~ '^[0-9a-f]{64}$'),
  status           text not null default 'active' check (status in ('active', 'merged', 'converted', 'abandoned')),
  currency         text not null references public.currencies (code),
  merged_into      uuid references public.carts (id),
  -- Solo invitados: huella (HMAC con una clave del servidor, nunca la IP) de la red desde la que se abrió, para acotar
  -- cuántas unidades pueden retener juntos los carritos de una misma red (D-02). Se borra al cerrar el carrito.
  ip_hash          text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  -- Un carrito es de un usuario O de un invitado, nunca de ambos ni de nadie.
  constraint carts_owner_xor check ((profile_id is not null) <> (token_hash is not null)),
  constraint carts_merged_target check ((status = 'merged') = (merged_into is not null)),
  constraint carts_ip_hash_guest_only check (ip_hash is null or token_hash is not null)
);
create unique index if not exists carts_one_active_per_profile on public.carts (profile_id)
  where profile_id is not null and status = 'active';
create unique index if not exists carts_token_hash_key on public.carts (token_hash) where token_hash is not null;
create index if not exists carts_guest_activity_idx on public.carts (last_activity_at)
  where profile_id is null and status = 'active';
create index if not exists carts_ip_hash_idx on public.carts (ip_hash) where ip_hash is not null and status = 'active';

create table if not exists public.cart_items (
  cart_id            uuid not null references public.carts (id) on delete cascade,
  variant_id         uuid not null references public.product_variants (id) on delete restrict,
  qty                int not null check (qty >= 1 and qty <= 1000),
  unit_price_at_add  numeric not null check (unit_price_at_add > 0),
  currency           text not null references public.currencies (code),
  added_at           timestamptz not null default now(),
  price_locked_until timestamptz not null,
  updated_at         timestamptz not null default now(),
  primary key (cart_id, variant_id)
);
create index if not exists cart_items_variant_idx on public.cart_items (variant_id);

-- Lo que se acaba de QUITAR de una bolsa, 15 minutos: si la persona pulsa «Deshacer» (o vuelve a agregarlo) la línea
-- recupera el precio y la garantía que tenía (S-04, BR-PRC-05). Solo se recupera si la garantía sigue vigente; nunca se
-- alarga. El cliente no manda ningún precio: lo guarda y lo devuelve el servidor.
create table if not exists public.cart_removed_items (
  cart_id            uuid not null references public.carts (id) on delete cascade,
  variant_id         uuid not null references public.product_variants (id) on delete cascade,
  unit_price_at_add  numeric not null check (unit_price_at_add > 0),
  added_at           timestamptz not null,
  price_locked_until timestamptz not null,
  removed_at         timestamptz not null default now(),
  primary key (cart_id, variant_id)
);

-- Solo las funciones (propietario) escriben aquí. El admin solo LEE (atender dudas de un cliente).
select public._apply_admin_rls('carts', null, null);
select public._apply_admin_rls('cart_items', null, null);
select public._apply_admin_rls('cart_removed_items', null, null);
revoke insert, update on public.carts from service_role;
revoke insert, update on public.cart_items from service_role;
revoke insert, update on public.cart_removed_items from service_role;

-- ── 3. Auxiliares internas (nadie las ejecuta salvo otras funciones de este archivo) ─────────
create or replace function public._cart_lock(p_cart_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('cart:' || p_cart_id::text, 0))
$$;

-- Toma el candado del carrito y, YA con él, comprueba que sigue activo: entre resolver el carrito y obtener el candado
-- otra transacción (fusión, abandono, desactivar la cuenta) pudo cerrarlo y confirmar. Si no, no se agrega ni retiene nada.
create or replace function public._cart_lock_active(p_cart_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('cart:' || p_cart_id::text, 0));
  return exists (select 1 from public.carts c where c.id = p_cart_id and c.status = 'active');
end;
$$;

-- Unidades que este carrito aún puede retener de más según el tope por red (`cart_max_units_per_ip`): el tope menos lo que
-- ya retienen los carritos ACTIVOS de la misma red, sin contar lo que este carrito ya retiene de esa variante (es lo que se
-- va a reescribir). Los carritos de usuario no llevan huella de red: sin tope por red (los acota la cuenta).
create or replace function public._cart_ip_room(p_cart_id uuid, p_variant_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case when c.ip_hash is null then 1000000
              else greatest(public.setting_int('cart_max_units_per_ip', 150) - coalesce((
                select sum(r.qty) from public.stock_reservations r
                  join public.carts c2 on c2.id = r.owner_id
                 where r.owner_type = 'cart' and r.status = 'active' and (r.expires_at is null or r.expires_at > now())
                   and c2.ip_hash = c.ip_hash and c2.status = 'active'
                   and not (r.owner_id = p_cart_id and r.variant_id = p_variant_id)), 0), 0)::int
         end
    from public.carts c where c.id = p_cart_id
$$;

-- Unidades que este carrito podría retener de la variante: stock físico menos lo retenido por OTROS dueños.
create or replace function public._cart_free_for(p_variant_id uuid, p_cart_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(v.stock_on_hand - coalesce((
    select sum(r.qty) from public.stock_reservations r
     where r.variant_id = v.id and r.status = 'active' and (r.expires_at is null or r.expires_at > now())
       and not (r.owner_type = 'cart' and r.owner_id = p_cart_id)), 0), 0)::int
    from public.product_variants v where v.id = p_variant_id
$$;

-- Devuelve el carrito de la identidad. o_state: ok | none (no existe) | retired (token ya fusionado o abandonado).
create or replace function public._cart_resolve(p_profile_id uuid, p_token_hash text, p_create boolean,
                                                p_ip_hash text default null, out o_id uuid, out o_state text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_currency text := coalesce((select s.value #>> '{}' from public.store_settings s where s.key = 'base_currency'), 'BOB');
begin
  if (p_profile_id is null) = (p_token_hash is null) then
    raise exception 'identidad de carrito inválida' using errcode = '22023';
  end if;
  if p_token_hash is not null and p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token de carrito inválido' using errcode = '22023';
  end if;

  if p_profile_id is not null then
    -- Una cuenta desactivada (o inexistente) no ve ni crea carrito: su carrito se abandonó al desactivarla.
    if not exists (select 1 from public.profiles pr where pr.id = p_profile_id and pr.is_active) then
      o_id := null;
      o_state := 'none';
      return;
    end if;
    select c.id into o_id from public.carts c where c.profile_id = p_profile_id and c.status = 'active';
    if o_id is null and p_create then
      insert into public.carts (profile_id, currency) values (p_profile_id, v_currency)
      on conflict (profile_id) where profile_id is not null and status = 'active' do nothing
      returning id into o_id;
      if o_id is null then
        select c.id into o_id from public.carts c where c.profile_id = p_profile_id and c.status = 'active';
      end if;
    end if;
  else
    select c.id, c.status into o_id, v_status from public.carts c where c.token_hash = p_token_hash;
    if o_id is not null and v_status <> 'active' then
      o_id := null;
      o_state := 'retired';
      return;
    end if;
    if o_id is null and p_create then
      insert into public.carts (token_hash, currency, ip_hash) values (p_token_hash, v_currency, p_ip_hash)
      on conflict (token_hash) where token_hash is not null do nothing
      returning id into o_id;
      if o_id is null then
        select c.id into o_id from public.carts c where c.token_hash = p_token_hash and c.status = 'active';
      end if;
    end if;
  end if;
  o_state := case when o_id is null then 'none' else 'ok' end;
end;
$$;

-- Estado completo del carrito, calculado en el servidor: precios vigentes, estado y total de cada línea.
--   status: unavailable > out_of_stock > low_stock > price_changed > ok
--   precio efectivo (S-04): dentro de la garantía, el MENOR entre el de entrada y el vigente; vencida, el vigente.
--   price_notice: dropped | guaranteed (dentro de la garantía) · expired_raised | expired_dropped (garantía vencida)
--   blocking: no se puede pagar hasta que el cliente lo resuelva (agotado, no disponible, stock insuficiente o
--             subida de precio tras vencer la garantía).
create or replace function public._cart_snapshot(p_cart_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart record;
  v_reserve boolean := public.setting_bool('reserve_on_add_to_cart', true);
  v_ttl int := public.setting_int('reservation_ttl_minutes', 10) * 60;
  v_days int := public.setting_int('price_guarantee_days', 7);
  -- `available` no pasa del tope por variante: el carrito no revela el stock exacto a un invitado (las vistas públicas
  -- tampoco lo hacen) y la interfaz nunca necesita más que ese tope.
  v_cap int := public.setting_int('cart_max_qty_per_variant', 10);
  v_decimals int;
  r record;
  v_lines jsonb := '[]'::jsonb;
  v_unavailable boolean;
  v_current numeric;
  v_others int;
  v_own int;
  v_own_exp timestamptz;
  v_free int;
  v_locked boolean;
  v_eff numeric;
  v_notice text;
  v_status text;
  v_billable int;
  v_blocking boolean;
  v_total numeric;
  v_subtotal numeric := 0;
  v_items int := 0;
  v_billable_units int := 0;
  v_any_blocking boolean := false;
  v_min_exp timestamptz;
  v_any_unreserved boolean := false;
  v_reservable int := 0;
  v_image text;
begin
  select c.id, c.currency, c.status into v_cart from public.carts c where c.id = p_cart_id;
  if not found then
    return null;
  end if;
  select cu.decimals into v_decimals from public.currencies cu where cu.code = v_cart.currency;
  v_decimals := coalesce(v_decimals, 2);

  for r in
    select ci.variant_id, ci.qty, ci.unit_price_at_add, ci.price_locked_until, ci.added_at,
           v.product_id, v.sku, v.color_id, v.stock_on_hand, v.archived_at as variant_archived,
           p.name, p.slug, p.status as product_status, p.archived_at as product_archived,
           pc.name as color_name, pc.hex as color_hex, ps.label as size_label
      from public.cart_items ci
      join public.product_variants v on v.id = ci.variant_id
      join public.products p on p.id = v.product_id
      left join public.product_colors pc on pc.id = v.color_id
      left join public.product_sizes ps on ps.id = v.size_id
     where ci.cart_id = p_cart_id
     order by ci.added_at, ci.variant_id
  loop
    v_unavailable := r.variant_archived is not null or r.product_archived is not null or r.product_status <> 'active';
    v_current := case when v_unavailable then null else public.price_for(r.product_id, v_cart.currency, null) end;
    if v_current is null then
      v_unavailable := true;
    end if;

    select coalesce(sum(sr.qty) filter (where not (sr.owner_type = 'cart' and sr.owner_id = p_cart_id)), 0),
           coalesce(sum(sr.qty) filter (where sr.owner_type = 'cart' and sr.owner_id = p_cart_id), 0),
           min(sr.expires_at) filter (where sr.owner_type = 'cart' and sr.owner_id = p_cart_id)
      into v_others, v_own, v_own_exp
      from public.stock_reservations sr
     where sr.variant_id = r.variant_id and sr.status = 'active' and (sr.expires_at is null or sr.expires_at > now());
    v_free := greatest(r.stock_on_hand - v_others, 0);

    v_locked := r.price_locked_until > now();
    v_eff := case when v_current is null then r.unit_price_at_add
                  when v_locked then least(r.unit_price_at_add, v_current)
                  else v_current end;
    v_notice := case when v_current is null or v_current = r.unit_price_at_add then null
                     when v_locked and v_current < r.unit_price_at_add then 'dropped'
                     when v_locked then 'guaranteed'
                     when v_current > r.unit_price_at_add then 'expired_raised'
                     else 'expired_dropped' end;

    v_status := case when v_unavailable then 'unavailable'
                     when v_free <= 0 then 'out_of_stock'
                     when r.qty > v_free then 'low_stock'
                     when v_notice is not null then 'price_changed'
                     else 'ok' end;
    v_billable := case when v_status in ('unavailable', 'out_of_stock') then 0
                       when v_status = 'low_stock' then v_free
                       else r.qty end;
    -- coalesce: sin aviso de precio v_notice es NULL y `false OR NULL` daría NULL (la interfaz lo leería como "no se puede pagar").
    v_blocking := v_status in ('unavailable', 'out_of_stock', 'low_stock') or coalesce(v_notice = 'expired_raised', false);
    v_total := round(v_eff * v_billable, v_decimals);

    select i.path into v_image
      from public.product_images i
     where i.product_id = r.product_id and i.archived_at is null
     order by (i.color_id is not distinct from r.color_id) desc, (i.color_id is null) desc, i.sort_order, i.id
     limit 1;

    v_subtotal := v_subtotal + v_total;
    v_items := v_items + r.qty;
    v_billable_units := v_billable_units + v_billable;
    v_any_blocking := v_any_blocking or v_blocking;
    if v_reserve and v_status not in ('unavailable', 'out_of_stock') then
      -- Solo cuenta una línea que SÍ se podría retener (una agotada nunca tendrá retención). Está "retenida" si tiene lo
      -- máximo que cabe: lo pedido o, si hay poco, lo libre. Una retención PARCIAL (logró 1 de 3 y luego hubo más stock)
      -- cuenta como incompleta, para que la interfaz ofrezca reintentar.
      v_reservable := v_reservable + 1;
      if v_own > 0 then
        v_min_exp := least(coalesce(v_min_exp, v_own_exp), v_own_exp);
      end if;
      if v_own < least(r.qty, v_free) then
        v_any_unreserved := true;
      end if;
    end if;

    v_lines := v_lines || jsonb_build_object(
      'variant_id', r.variant_id, 'product_id', r.product_id, 'name', r.name, 'slug', r.slug, 'sku', r.sku,
      'color_name', r.color_name, 'color_hex', r.color_hex, 'size_label', r.size_label, 'image_path', v_image,
      'qty', r.qty, 'billable_qty', v_billable, 'available', least(v_free, v_cap),
      'status', v_status, 'blocking', v_blocking, 'price_notice', v_notice,
      'unit_price', v_eff, 'price_at_add', r.unit_price_at_add, 'current_price', v_current,
      'price_locked_until', r.price_locked_until, 'line_total', v_total,
      'reserved_qty', v_own, 'reservation_expires_at', v_own_exp);
  end loop;

  return jsonb_build_object(
    'cart_id', v_cart.id, 'status', v_cart.status, 'currency', v_cart.currency,
    'reserve_on_add', v_reserve, 'ttl_seconds', v_ttl, 'guarantee_days', v_days,
    'limits', jsonb_build_object(
      'max_qty_per_variant', public.setting_int('cart_max_qty_per_variant', 10),
      'max_lines', public.setting_int('cart_max_lines', 30),
      'max_units', public.setting_int('cart_max_reserved_units', 30)),
    'lines', v_lines,
    'totals', jsonb_build_object(
      'subtotal', round(v_subtotal, v_decimals), 'item_count', v_items, 'line_count', jsonb_array_length(v_lines),
      -- Puntos de extensión: S8 (envío) y S9 (descuento) los llenan; hasta entonces total = subtotal.
      'shipping', null, 'discount', null, 'total', round(v_subtotal, v_decimals)),
    'reservation', jsonb_build_object(
      'state', case when not v_reserve or v_reservable = 0 then 'none'
                    when v_any_unreserved then 'expired' else 'held' end,
      'expires_at', case when v_reserve and not v_any_unreserved then v_min_exp end),
    'can_checkout', jsonb_array_length(v_lines) > 0 and not v_any_blocking and v_billable_units > 0);
end;
$$;

-- ── 4. API (solo service_role; la llama la Edge Function `cart`) ─────────────────────────────
create or replace function public.cart_get(p_profile_id uuid, p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_state text;
begin
  select o_id, o_state into v_id, v_state from public._cart_resolve(p_profile_id, p_token_hash, false);
  return jsonb_build_object('token_state', v_state, 'server_time', now(),
                            'cart', case when v_id is null then null else public._cart_snapshot(v_id) end);
end;
$$;

-- Fija la cantidad de una variante (0 = quitar). outcome: ok | adjusted | capped_variant | capped_units | removed |
-- out_of_stock | unavailable | limit_lines | limit_units | token_retired.
-- `p_may_create`: un invitado solo puede ESTRENAR carrito con un token que la Edge Function acaba de emitir; con un token
-- que el cliente trae y la base no conoce (o ya fusionado/abandonado) se responde token_retired. Sin esto, un bot
-- inventaría tokens sin límite y se saltaría el tope de carritos nuevos por IP (D-02).
-- `p_ip_hash`: huella de la red del invitado; se guarda SOLO al estrenar el carrito (ver `_cart_ip_room`).
-- Al estrenar se valida la variante ANTES de crear el carrito: pedir algo que no existe no deja un carrito vacío.
create or replace function public.cart_set_item(p_profile_id uuid, p_token_hash text, p_variant_id uuid, p_qty int,
                                                p_may_create boolean default true, p_ip_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart uuid;
  v_state text;
  v_cap int := public.setting_int('cart_max_qty_per_variant', 10);
  v_max_lines int := public.setting_int('cart_max_lines', 30);
  v_max_units int := public.setting_int('cart_max_reserved_units', 30);
  v_days int := public.setting_int('price_guarantee_days', 7);
  v_reserve boolean := public.setting_bool('reserve_on_add_to_cart', true);
  v_hold boolean;
  v_var record;
  v_found boolean;
  v_currency text;
  v_price numeric;
  v_locked_until timestamptz;
  v_added timestamptz;
  v_tomb record;
  v_want int;
  v_outcome text := 'ok';
  v_exists boolean;
  v_lines int;
  v_units_other int;
  v_res jsonb;
  v_free int;
begin
  if p_variant_id is null or p_qty is null or p_qty < 0 or p_qty > 1000 then
    raise exception 'cantidad o variante inválida' using errcode = '22023';
  end if;

  select o_id, o_state into v_cart, v_state from public._cart_resolve(p_profile_id, p_token_hash, false);
  if v_cart is null then
    -- Quitar algo de un carrito que no existe no es un problema; agregar a uno que no se puede estrenar, sí.
    if p_qty = 0 then
      return jsonb_build_object('token_state', v_state, 'server_time', now(), 'cart', null, 'requested', 0,
                                'applied', 0, 'outcome', 'ok');
    end if;
    if p_profile_id is null and (not p_may_create or v_state = 'retired') then
      return jsonb_build_object('token_state', v_state, 'server_time', now(), 'cart', null, 'requested', p_qty,
                                'applied', 0, 'outcome', 'token_retired');
    end if;
  end if;

  if p_qty = 0 then
    if not public._cart_lock_active(v_cart) then
      return jsonb_build_object('token_state', 'retired', 'server_time', now(), 'cart', null, 'requested', 0,
                                'applied', 0, 'outcome', 'ok');
    end if;
    -- Lo quitado se recuerda 15 min con su precio y su garantía (ver cart_removed_items).
    with gone as (
      delete from public.cart_items where cart_id = v_cart and variant_id = p_variant_id returning *)
    insert into public.cart_removed_items (cart_id, variant_id, unit_price_at_add, added_at, price_locked_until)
    select cart_id, variant_id, unit_price_at_add, added_at, price_locked_until from gone
    on conflict (cart_id, variant_id) do update
      set unit_price_at_add = excluded.unit_price_at_add, added_at = excluded.added_at,
          price_locked_until = excluded.price_locked_until, removed_at = now();
    perform public.release_stock('cart', v_cart, p_variant_id);
    update public.carts set updated_at = now(), last_activity_at = now() where id = v_cart;
    return jsonb_build_object('token_state', 'ok', 'server_time', now(), 'requested', 0, 'applied', 0,
                              'outcome', 'removed', 'cart', public._cart_snapshot(v_cart));
  end if;

  -- Variante y precio (con la moneda del carrito o, si aún no existe, la de la tienda).
  v_currency := coalesce((select c.currency from public.carts c where c.id = v_cart),
                         (select s.value #>> '{}' from public.store_settings s where s.key = 'base_currency'), 'BOB');
  select v.product_id, v.archived_at as variant_archived, p.archived_at as product_archived, p.status as product_status
    into v_var
    from public.product_variants v join public.products p on p.id = v.product_id
   where v.id = p_variant_id;
  v_found := found;
  v_price := case when v_found and v_var.variant_archived is null and v_var.product_archived is null
                       and v_var.product_status = 'active'
                  then public.price_for(v_var.product_id, v_currency, null) end;
  if v_price is null then
    return jsonb_build_object('token_state', coalesce(v_state, 'none'), 'server_time', now(), 'requested', p_qty,
                              'applied', 0, 'outcome', 'unavailable',
                              'cart', case when v_cart is null then null else public._cart_snapshot(v_cart) end);
  end if;

  if v_cart is null then
    select o_id into v_cart from public._cart_resolve(p_profile_id, p_token_hash, true, p_ip_hash);
    if v_cart is null then
      -- Solo una cuenta desactivada llega aquí (un invitado sin carrito siempre puede estrenar uno).
      return jsonb_build_object('token_state', 'none', 'server_time', now(), 'cart', null, 'requested', p_qty,
                                'applied', 0, 'outcome', 'unavailable');
    end if;
  end if;
  if not public._cart_lock_active(v_cart) then
    return jsonb_build_object('token_state', 'retired', 'server_time', now(), 'cart', null, 'requested', p_qty,
                              'applied', 0, 'outcome', case when p_profile_id is null then 'token_retired' else 'unavailable' end);
  end if;

  select exists (select 1 from public.cart_items where cart_id = v_cart and variant_id = p_variant_id) into v_exists;
  if not v_exists then
    select count(*) into v_lines from public.cart_items where cart_id = v_cart;
    if v_lines >= v_max_lines then
      return jsonb_build_object('token_state', 'ok', 'server_time', now(), 'requested', p_qty, 'applied', 0,
                                'outcome', 'limit_lines', 'cart', public._cart_snapshot(v_cart));
    end if;
  end if;

  v_want := p_qty;
  if v_want > v_cap then
    v_want := v_cap;
    v_outcome := 'capped_variant';
  end if;
  select coalesce(sum(qty), 0) into v_units_other from public.cart_items
   where cart_id = v_cart and variant_id <> p_variant_id;
  if v_units_other + v_want > v_max_units then
    v_want := v_max_units - v_units_other;
    if v_want <= 0 then
      return jsonb_build_object('token_state', 'ok', 'server_time', now(), 'requested', p_qty, 'applied', 0,
                                'outcome', 'limit_units', 'cart', public._cart_snapshot(v_cart));
    end if;
    v_outcome := 'capped_units';
  end if;

  -- Retención: solo si está activada Y la red de este carrito aún tiene cupo (`cart_max_units_per_ip`). Sin cupo la línea
  -- se agrega igual pero SIN retención (la interfaz lo dice y deja reintentar): así quien repita peticiones para retener
  -- stock indefinidamente topa con un máximo por red, aunque renueve cada línea una y otra vez.
  v_hold := v_reserve and v_want <= public._cart_ip_room(v_cart, p_variant_id);
  if v_hold then
    v_res := public.reserve_stock(p_variant_id, v_want, 'cart', v_cart);
    if v_res ->> 'status' = 'variant_unavailable' then
      return jsonb_build_object('token_state', 'ok', 'server_time', now(), 'requested', p_qty, 'applied', 0,
                                'outcome', 'unavailable', 'cart', public._cart_snapshot(v_cart));
    elsif v_res ->> 'status' = 'insufficient_stock' then
      v_free := (v_res ->> 'available')::int;
      if v_free <= 0 then
        return jsonb_build_object('token_state', 'ok', 'server_time', now(), 'requested', p_qty, 'applied', 0,
                                  'outcome', 'out_of_stock', 'cart', public._cart_snapshot(v_cart));
      end if;
      -- Se pide menos de lo que hay: se ajusta con aviso (no falla en silencio). La fila de la variante sigue bloqueada.
      v_want := least(v_want, v_free);
      v_outcome := 'adjusted';
      perform public.reserve_stock(p_variant_id, v_want, 'cart', v_cart);
    end if;
  else
    -- Sin retención (desactivada o sin cupo de red): lo que esta línea ya retenía se libera.
    if v_reserve then
      perform public.release_stock('cart', v_cart, p_variant_id);
    end if;
    v_free := public._cart_free_for(p_variant_id, v_cart);
    if v_free <= 0 then
      return jsonb_build_object('token_state', 'ok', 'server_time', now(), 'requested', p_qty, 'applied', 0,
                                'outcome', 'out_of_stock', 'cart', public._cart_snapshot(v_cart));
    end if;
    if v_want > v_free then
      v_want := v_free;
      v_outcome := 'adjusted';
    end if;
  end if;

  -- El precio de entrada y su garantía se fijan al CREAR la línea; cambiar la cantidad NO los renueva (S-04). Si la línea
  -- se quitó hace poco y su garantía seguía vigente, recupera su precio y su garantía (no se alargan).
  if not v_exists then
    select t.* into v_tomb from public.cart_removed_items t
     where t.cart_id = v_cart and t.variant_id = p_variant_id
       and t.removed_at > now() - interval '15 minutes' and t.price_locked_until > now();
    if found then
      v_price := v_tomb.unit_price_at_add;
      v_locked_until := v_tomb.price_locked_until;
      v_added := v_tomb.added_at;
    else
      v_locked_until := now() + make_interval(days => v_days);
      v_added := now();
    end if;
    delete from public.cart_removed_items where cart_id = v_cart and variant_id = p_variant_id;
  end if;
  insert into public.cart_items (cart_id, variant_id, qty, unit_price_at_add, currency, added_at, price_locked_until)
  values (v_cart, p_variant_id, v_want, v_price, v_currency, coalesce(v_added, now()),
          coalesce(v_locked_until, now() + make_interval(days => v_days)))
  on conflict (cart_id, variant_id) do update set qty = excluded.qty, updated_at = now();
  update public.carts set updated_at = now(), last_activity_at = now() where id = v_cart;

  return jsonb_build_object('token_state', 'ok', 'server_time', now(), 'requested', p_qty, 'applied', v_want,
                            'outcome', v_outcome, 'cart', public._cart_snapshot(v_cart));
end;
$$;

create or replace function public.cart_remove_item(p_profile_id uuid, p_token_hash text, p_variant_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.cart_set_item(p_profile_id, p_token_hash, p_variant_id, 0, false)
$$;

create or replace function public.cart_clear(p_profile_id uuid, p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart uuid;
  v_state text;
begin
  select o_id, o_state into v_cart, v_state from public._cart_resolve(p_profile_id, p_token_hash, false);
  if v_cart is null then
    return jsonb_build_object('token_state', v_state, 'server_time', now(), 'cart', null);
  end if;
  if not public._cart_lock_active(v_cart) then
    return jsonb_build_object('token_state', 'retired', 'server_time', now(), 'cart', null);
  end if;
  delete from public.cart_items where cart_id = v_cart;
  perform public.release_stock('cart', v_cart);
  update public.carts set updated_at = now(), last_activity_at = now() where id = v_cart;
  return jsonb_build_object('token_state', 'ok', 'server_time', now(), 'cart', public._cart_snapshot(v_cart));
end;
$$;

-- Reintenta retener las líneas cuya retención venció (o nunca existió). NO alarga las que siguen vigentes: si no, quien
-- llamara a esto en bucle retendría el stock para siempre.
create or replace function public.cart_refresh(p_profile_id uuid, p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart uuid;
  v_state text;
  v_reserve boolean := public.setting_bool('reserve_on_add_to_cart', true);
  r record;
  v_take int;
  v_renewed int := 0;
begin
  select o_id, o_state into v_cart, v_state from public._cart_resolve(p_profile_id, p_token_hash, false);
  if v_cart is null then
    return jsonb_build_object('token_state', v_state, 'server_time', now(), 'cart', null, 'renewed', 0);
  end if;
  if not public._cart_lock_active(v_cart) then
    return jsonb_build_object('token_state', 'retired', 'server_time', now(), 'cart', null, 'renewed', 0);
  end if;
  if v_reserve then
    for r in
      select ci.variant_id, ci.qty,
             coalesce((select sum(sr.qty) from public.stock_reservations sr
                        where sr.variant_id = ci.variant_id and sr.owner_type = 'cart' and sr.owner_id = v_cart
                          and sr.status = 'active' and (sr.expires_at is null or sr.expires_at > now())), 0)::int as held
        from public.cart_items ci
       where ci.cart_id = v_cart
       order by ci.variant_id
    loop
      -- Se toma lo que haya, sin superar lo pedido, y SOLO si es MÁS de lo que ya tiene retenido: una retención completa
      -- (o que no puede crecer) no se toca, así quien llame a esto en bucle no la alarga para siempre.
      -- (también el cupo por red: si no, `refresh` en bucle sería otra forma de retener sin tope). `_cart_ip_room` ya NO cuenta
      -- lo que esta línea retiene hoy: es el cupo para su retención COMPLETA, no un extra que sumar a lo retenido.
      v_take := least(r.qty, public._cart_free_for(r.variant_id, v_cart), public._cart_ip_room(v_cart, r.variant_id));
      if v_take > r.held and public.reserve_stock(r.variant_id, v_take, 'cart', v_cart) ->> 'status' = 'reserved' then
        v_renewed := v_renewed + 1;
      end if;
    end loop;
  end if;
  return jsonb_build_object('token_state', 'ok', 'server_time', now(), 'renewed', v_renewed,
                            'cart', public._cart_snapshot(v_cart));
end;
$$;

-- El cliente acepta el precio vigente de una línea (o de todas): pasa a ser el de entrada y se renueva su garantía.
create or replace function public.cart_accept_prices(p_profile_id uuid, p_token_hash text, p_variant_id uuid default null,
                                                    p_expected_price numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart uuid;
  v_state text;
  v_days int := public.setting_int('price_guarantee_days', 7);
  r record;
  v_price numeric;
begin
  select o_id, o_state into v_cart, v_state from public._cart_resolve(p_profile_id, p_token_hash, false);
  if v_cart is null then
    return jsonb_build_object('token_state', v_state, 'server_time', now(), 'cart', null);
  end if;
  if not public._cart_lock_active(v_cart) then
    return jsonb_build_object('token_state', 'retired', 'server_time', now(), 'cart', null);
  end if;
  -- Solo las líneas cuya garantía YA venció: aceptar el precio vigente de una con garantía vigente le haría perder el precio
  -- asegurado (S-04). Si el cliente dice qué precio vio (`p_expected_price`, con una sola línea) y el vigente ya es otro,
  -- no se acepta nada: la persona vuelve a ver el aviso con el precio nuevo.
  for r in
    select ci.variant_id, v.product_id, ci.currency from public.cart_items ci
      join public.product_variants v on v.id = ci.variant_id
      join public.products p on p.id = v.product_id
     where ci.cart_id = v_cart and (p_variant_id is null or ci.variant_id = p_variant_id)
       and ci.price_locked_until <= now()
       and p.status = 'active' and p.archived_at is null and v.archived_at is null
     order by ci.variant_id
  loop
    v_price := public.price_for(r.product_id, r.currency, null);
    if v_price is not null and (p_expected_price is null or p_variant_id is null or v_price = p_expected_price) then
      update public.cart_items set unit_price_at_add = v_price, price_locked_until = now() + make_interval(days => v_days),
             updated_at = now()
       where cart_id = v_cart and variant_id = r.variant_id;
    end if;
  end loop;
  update public.carts set updated_at = now(), last_activity_at = now() where id = v_cart;
  return jsonb_build_object('token_state', 'ok', 'server_time', now(), 'cart', public._cart_snapshot(v_cart));
end;
$$;

-- Fusiona el carrito de invitado (por token) en el del usuario. Idempotente: una segunda llamada (doble clic, dos
-- pestañas) encuentra el carrito de invitado ya fusionado y no hace nada.
--   · cantidades: se suman, con el tope por variante, líneas y unidades, y lo que haya de stock
--   · precio (S-04): si las dos líneas tienen garantía vigente gana el MENOR; si solo una, la suya; si ninguna, el vigente
--   · una línea que no se puede retener (agotada o no disponible) se conserva sin retención: el cliente la verá y decidirá
create or replace function public.merge_guest_cart(p_profile_id uuid, p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guest uuid;
  v_gstatus text;
  v_user uuid;
  v_ustate text;
  v_cap int := public.setting_int('cart_max_qty_per_variant', 10);
  v_max_lines int := public.setting_int('cart_max_lines', 30);
  v_max_units int := public.setting_int('cart_max_reserved_units', 30);
  v_reserve boolean := public.setting_bool('reserve_on_add_to_cart', true);
  g record;
  u record;
  v_new int;
  v_requested int;
  v_units_other int;
  v_lines int;
  v_res jsonb;
  v_free int;
  v_price numeric;
  v_locked_until timestamptz;
  v_added timestamptz;
  v_g_locked boolean;
  v_u_locked boolean;
  v_merged int := 0;
  v_adjusted int := 0;
  v_skipped int := 0;
  v_currency text;
begin
  if p_profile_id is null or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'fusión de carrito inválida' using errcode = '22023';
  end if;

  select c.id into v_guest from public.carts c where c.token_hash = p_token_hash;
  select o_id, o_state into v_user, v_ustate from public._cart_resolve(p_profile_id, null, false);
  if v_guest is null then
    return jsonb_build_object('token_state', 'none', 'merged', false, 'server_time', now(),
                              'cart', case when v_user is null then null else public._cart_snapshot(v_user) end);
  end if;
  if v_user is null then
    select o_id into v_user from public._cart_resolve(p_profile_id, null, true);
    if v_user is null then
      -- Cuenta desactivada: no ve ni crea carrito, tampoco al fusionar (el de invitado queda como estaba).
      return jsonb_build_object('token_state', 'none', 'merged', false, 'server_time', now(), 'cart', null);
    end if;
  end if;

  -- Los dos carritos, por orden de id (sin ciclos entre fusiones y operaciones).
  if v_guest < v_user then
    perform public._cart_lock(v_guest);
    perform public._cart_lock(v_user);
  else
    perform public._cart_lock(v_user);
    perform public._cart_lock(v_guest);
  end if;

  select c.status into v_gstatus from public.carts c where c.id = v_guest;
  if v_gstatus <> 'active' then
    return jsonb_build_object('token_state', 'retired', 'merged', false, 'already', true, 'server_time', now(),
                              'cart', public._cart_snapshot(v_user));
  end if;
  select c.currency into v_currency from public.carts c where c.id = v_user;

  -- Las variantes se bloquean PRIMERO y en orden de id (como hace `reserve_stock` y el trigger de archivado): si no, esta
  -- función (reservas → variante) y un admin que archiva la variante (variante → reservas) podían cruzarse.
  perform 1 from public.product_variants v
   where v.id in (select ci.variant_id from public.cart_items ci where ci.cart_id in (v_guest, v_user))
   order by v.id for update;

  for g in select * from public.cart_items where cart_id = v_guest order by variant_id loop
    select * into u from public.cart_items where cart_id = v_user and variant_id = g.variant_id;
    v_requested := coalesce(u.qty, 0) + g.qty;
    v_new := least(v_requested, v_cap);

    if u.variant_id is null then
      select count(*) into v_lines from public.cart_items where cart_id = v_user;
      if v_lines >= v_max_lines then
        v_skipped := v_skipped + 1;
        continue;
      end if;
    end if;
    select coalesce(sum(qty), 0) into v_units_other from public.cart_items
     where cart_id = v_user and variant_id <> g.variant_id;
    if v_units_other + v_new > v_max_units then
      v_new := v_max_units - v_units_other;
      if v_new <= 0 then
        v_skipped := v_skipped + 1;
        continue;
      end if;
    end if;

    -- La retención del invitado se libera antes: esas unidades vuelven a ser "libres" para el carrito del usuario.
    perform public.release_stock('cart', v_guest, g.variant_id);
    if v_reserve then
      v_res := public.reserve_stock(g.variant_id, v_new, 'cart', v_user);
      if v_res ->> 'status' = 'insufficient_stock' then
        v_free := (v_res ->> 'available')::int;
        if v_free > 0 then
          v_new := least(v_new, v_free);
          perform public.reserve_stock(g.variant_id, v_new, 'cart', v_user);
        end if;
        -- v_free = 0: la línea se conserva sin retención (se verá "agotado")
      end if;
    else
      v_free := public._cart_free_for(g.variant_id, v_user);
      if v_free > 0 and v_new > v_free then
        v_new := v_free;
      end if;
    end if;

    -- Cualquier recorte (tope por variante, por unidades o por stock) se avisa: nada se pierde en silencio.
    if v_new < v_requested then
      v_adjusted := v_adjusted + 1;
    end if;

    -- Precio (S-04). Sin línea previa del usuario: la del invitado tal cual (con su garantía, vigente o vencida: el aviso
    -- de precio lo sigue marcando la foto del carrito). Con las dos: si ambas tienen garantía vigente gana el MENOR precio
    -- y la garantía MÁS larga de las dos (nadie pierde lo que tenía asegurado); si solo una, la suya; si ninguna, la línea
    -- más antigua (también vencida, para que el aviso no se pierda al fusionar).
    if u.variant_id is null then
      v_price := g.unit_price_at_add; v_locked_until := g.price_locked_until;
    else
      v_g_locked := g.price_locked_until > now();
      v_u_locked := u.price_locked_until > now();
      if v_g_locked and v_u_locked then
        v_price := least(g.unit_price_at_add, u.unit_price_at_add);
        v_locked_until := greatest(g.price_locked_until, u.price_locked_until);
      elsif v_g_locked then
        v_price := g.unit_price_at_add; v_locked_until := g.price_locked_until;
      elsif v_u_locked then
        v_price := u.unit_price_at_add; v_locked_until := u.price_locked_until;
      elsif g.added_at < u.added_at then
        v_price := g.unit_price_at_add; v_locked_until := g.price_locked_until;
      else
        v_price := u.unit_price_at_add; v_locked_until := u.price_locked_until;
      end if;
    end if;
    v_added := least(coalesce(u.added_at, g.added_at), g.added_at);

    insert into public.cart_items (cart_id, variant_id, qty, unit_price_at_add, currency, added_at, price_locked_until)
    values (v_user, g.variant_id, v_new, v_price, v_currency, v_added, v_locked_until)
    on conflict (cart_id, variant_id) do update
      set qty = excluded.qty, unit_price_at_add = excluded.unit_price_at_add,
          price_locked_until = excluded.price_locked_until, added_at = excluded.added_at, updated_at = now();
    v_merged := v_merged + 1;
  end loop;

  update public.carts set status = 'merged', merged_into = v_user, ip_hash = null, updated_at = now() where id = v_guest;
  perform public.release_stock('cart', v_guest);
  update public.carts set updated_at = now(), last_activity_at = now() where id = v_user;

  return jsonb_build_object('token_state', 'merged', 'merged', true, 'merged_lines', v_merged,
                            'adjusted_lines', v_adjusted, 'skipped_lines', v_skipped, 'server_time', now(),
                            'cart', public._cart_snapshot(v_user));
end;
$$;

revoke all on function
  public.cart_get(uuid, text), public.cart_set_item(uuid, text, uuid, int, boolean, text), public.cart_remove_item(uuid, text, uuid),
  public.cart_clear(uuid, text), public.cart_refresh(uuid, text), public.cart_accept_prices(uuid, text, uuid, numeric),
  public.merge_guest_cart(uuid, text),
  public._cart_lock(uuid), public._cart_lock_active(uuid), public._cart_ip_room(uuid, uuid),
  public._cart_free_for(uuid, uuid), public._cart_resolve(uuid, text, boolean, text),
  public._cart_snapshot(uuid)
  from public, anon, authenticated;
-- Las internas y las funciones de trigger no las llama NADIE desde fuera: `pg_default_acl` da EXECUTE a service_role a toda
-- función nueva de `public`, así que se le quita aparte.
revoke all on function
  public._cart_lock(uuid), public._cart_lock_active(uuid), public._cart_ip_room(uuid, uuid),
  public._cart_free_for(uuid, uuid), public._cart_resolve(uuid, text, boolean, text),
  public._cart_snapshot(uuid), public.store_settings_validate_s7()
  from service_role;
grant execute on function
  public.cart_get(uuid, text), public.cart_set_item(uuid, text, uuid, int, boolean, text), public.cart_remove_item(uuid, text, uuid),
  public.cart_clear(uuid, text), public.cart_refresh(uuid, text), public.cart_accept_prices(uuid, text, uuid, numeric),
  public.merge_guest_cart(uuid, text)
  to service_role;

-- ── 5. Limpieza ─────────────────────────────────────────────────────────────────────────────
-- Un carrito de invitado sin actividad se da por abandonado y libera sus retenciones (BR-CHK-03: sin recuperación de
-- carritos abandonados, es solo higiene). Mismo ORDEN de bloqueo que el resto (candado del carrito y luego las filas) y se
-- revalida bajo el candado: si justo entonces el cliente volvió, no se abandona. Procesa hasta 200 por pasada (cada
-- candado se retiene hasta el final de la transacción); el cron corre cada hora y el resto cae en la siguiente.
create or replace function public.cart_abandon_stale()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days int := public.setting_int('guest_cart_retention_days', 30);
  v_id uuid;
  v_n int := 0;
begin
  for v_id in
    select c.id from public.carts c
     where c.profile_id is null and c.status = 'active' and c.last_activity_at < now() - make_interval(days => v_days)
     order by c.id limit 200
  loop
    perform public._cart_lock(v_id);
    update public.carts set status = 'abandoned', ip_hash = null, updated_at = now()
     where id = v_id and status = 'active' and last_activity_at < now() - make_interval(days => v_days);
    if found then
      perform public.release_stock('cart', v_id);
      v_n := v_n + 1;
    end if;
  end loop;
  -- Las líneas quitadas solo se recuerdan 15 min: pasado un día no sirven para nada.
  delete from public.cart_removed_items where removed_at < now() - interval '1 day';
  return v_n;
end;
$$;

-- Los carritos de invitado ya cerrados no guardan datos personales; se borran pasado un tiempo (único DELETE de la tabla,
-- dentro de esta función; ningún rol de la aplicación puede borrar). Sus líneas caen en cascada.
create or replace function public.purge_old_carts(p_older_than interval default interval '60 days')
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  -- Un carrito fusionado puede ser el destino de otro (merged_into): solo se borran los que nadie referencia.
  delete from public.carts c
   where c.profile_id is null and c.status in ('abandoned', 'merged') and c.updated_at < now() - p_older_than
     and not exists (select 1 from public.carts d where d.merged_into = c.id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.cart_abandon_stale(), public.purge_old_carts(interval) from public, anon, authenticated;
grant execute on function public.cart_abandon_stale(), public.purge_old_carts(interval) to service_role;

-- Desactivar una cuenta abandona su carrito y libera sus retenciones.
create or replace function public.profiles_release_cart()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in select c.id from public.carts c where c.profile_id = new.id and c.status = 'active' order by c.id loop
    perform public._cart_lock(v_id);
    update public.carts set status = 'abandoned', updated_at = now() where id = v_id;
    perform public.release_stock('cart', v_id);
  end loop;
  return new;
end;
$$;
revoke all on function public.profiles_release_cart() from public, anon, authenticated, service_role;
drop trigger if exists profiles_release_cart on public.profiles;
create trigger profiles_release_cart after update of is_active on public.profiles
  for each row when (old.is_active and not new.is_active) execute function public.profiles_release_cart();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('abandon-stale-carts', '23 * * * *', 'select public.cart_abandon_stale()');
    perform cron.schedule('purge-old-carts', '29 3 * * *', 'select public.purge_old_carts()');
  else
    raise notice 'pg_cron no está disponible: los carritos de invitado antiguos no se abandonarán solos';
  end if;
exception when others then
  raise notice 'no se pudo programar pg_cron: %', sqlerrm;
end $$;
