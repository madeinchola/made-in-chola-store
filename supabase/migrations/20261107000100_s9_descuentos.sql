-- Sprint 9 — Descuentos y cupones
-- BR-PRC-03 (un solo cupón por pedido), BR-PRC-04 (base del reembolso: S12), BR-PRC-07 (tipos de descuento configurables).
--
-- Diseño:
--  · Ocho tipos de descuento (`discounts.kind`): percent y fixed (cupón), free_shipping (envío gratis sobre un monto), bogo
--    (N×M), volume (tramos por cantidad), group_price (precio por tipo de cliente), flash (oferta con inicio y fin) y
--    first_purchase (primera compra). Los parámetros de cada tipo van en `params` (jsonb) y los valida un CHECK.
--  · AUTOMÁTICO = no pide código (`requires_coupon = false`); con CÓDIGO = hay `coupons` que lo activan. Los cupones por
--    porcentaje y por monto fijo siempre piden código; bogo, volumen, precio de grupo y flash son siempre automáticos;
--    envío gratis y primera compra pueden ser de las dos formas.
--  · El motor (`_discount_evaluate`) es DETERMINISTA y NO escribe nada. ORDEN: (1) ofertas automáticas, (2) el cupón único,
--    (3) envío gratis. Por línea solo cuenta la MEJOR oferta automática (nunca dos sobre la misma línea). Un cupón se
--    acumula con las ofertas solo si `stackable_with_automatic`; si no, se aplica la MEJOR de las dos opciones para el
--    pedido entero (empate: las ofertas, y el cupón no gasta su uso). Con `exclude_sale_items` el cupón y las ofertas tocan
--    líneas DISTINTAS: no compiten y conviven aunque el cupón no sea acumulable. El umbral de envío gratis se evalúa DESPUÉS
--    de los descuentos.
--  · Importes en la unidad menor de la moneda (enteros): sin errores de coma flotante. Se redondea por LÍNEA y la suma es
--    exacta; un monto fijo se reparte entre las líneas con el método del mayor resto. El descuento nunca excede lo
--    elegible ni el subtotal: el total no puede ser negativo.
--  · Los usos se reservan de forma ATÓMICA (`discount_reserve`: candado de fila del descuento y del cupón), como el cupo de
--    entregas de S8; el checkout (S10) la llama al crear el pedido y S12 los devuelve al cancelar.
--  · Un cliente NO lee los cupones: un código solo se prueba por la función `cart` (con tasa limitada) y los códigos
--    inexistentes, inactivos o futuros dan todos la MISMA respuesta (`invalid_code`).
--  · La primera compra cuenta pedidos no cancelados; los pedidos llegan en S10: hasta entonces `_customer_order_count` vale 0
--    y S10 la redefine.
--
-- Rollback manual:
--   drop trigger carts_carry_coupon_trg on public.carts; drop function public._carts_carry_coupon();
--   alter table public.carts drop column coupon_code;
--   -- (restaurar `_cart_snapshot` de 20261103000100_s7_carrito.sql)
--   drop view public.discount_usage;
--   drop function public.cart_set_coupon(uuid, text, text), public.cart_remove_coupon(uuid, text),
--     public.apply_discounts(uuid, text, numeric, timestamptz), public.discount_reserve(text, uuid, uuid, jsonb),
--     public.discount_commit(text, uuid), public.discount_release(text, uuid), public.admin_generate_coupon_codes(uuid, int, text, int, int),
--     public._discount_evaluate(uuid, text, jsonb, text, numeric, timestamptz), public._discount_reductions(text, jsonb, boolean[], bigint[], int[], bigint[], numeric),
--     public._discount_distribute(bigint, bigint[]), public._discount_line_eligible(uuid, text, uuid),
--     public._discount_customer_reason(text, uuid, uuid), public._discount_usage(uuid, uuid, uuid), public._customer_order_count(uuid),
--     public._discount_params_valid(text, jsonb), public._coupon_norm(text), public._discount_targets_check(), public._coupons_check();
--   drop table public.discount_redemptions, public.coupons, public.discount_targets, public.discounts,
--     public.customer_group_members, public.customer_groups;

-- ── 1. Tablas ───────────────────────────────────────────────────────────────────────────────
-- 1.1 Grupos de clientes (para el precio por tipo de cliente)
create table if not exists public.customer_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(btrim(description)) between 1 and 300),
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists customer_groups_name_key
  on public.customer_groups ((lower(btrim(name)))) where archived_at is null;
drop trigger if exists customer_groups_set_updated_at on public.customer_groups;
create trigger customer_groups_set_updated_at before update on public.customer_groups
  for each row execute function public.set_updated_at();
select public._apply_admin_rls('customer_groups', array['name', 'description'], array['name', 'description', 'archived_at']);

create table if not exists public.customer_group_members (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.customer_groups (id) on delete restrict,
  profile_id  uuid not null references public.profiles (id) on delete restrict,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists customer_group_members_key
  on public.customer_group_members (group_id, profile_id) where archived_at is null;
create index if not exists customer_group_members_profile_idx on public.customer_group_members (profile_id) where archived_at is null;
drop trigger if exists customer_group_members_set_updated_at on public.customer_group_members;
create trigger customer_group_members_set_updated_at before update on public.customer_group_members
  for each row execute function public.set_updated_at();
select public._apply_admin_rls('customer_group_members', array['group_id', 'profile_id'], array['archived_at']);

-- 1.2 ¿Los parámetros de un descuento tienen la forma de su tipo? (se usa en un CHECK: nunca lanza, devuelve false)
--   percent / flash / group_price / first_purchase: {"percent": n (0,100], "max_amount"?: n}
--   fixed:  {"amount": n}            free_shipping: {}
--   bogo:   {"take": N, "pay": M}    (llévate N, paga M: 2×1 = take 2, pay 1)
--   volume: {"tiers": [{"min_qty": n, "percent": p}, …]}   (min_qty estrictamente creciente)
create or replace function public._discount_params_valid(p_kind text, p_params jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_tier jsonb;
  v_prev numeric := 0;
  v_n int;
  v_q numeric;
  v_p numeric;
begin
  if p_params is null or jsonb_typeof(p_params) is distinct from 'object' then
    return false;
  end if;
  if p_kind in ('percent', 'flash', 'group_price', 'first_purchase') then
    if (p_params - 'percent' - 'max_amount') <> '{}'::jsonb or jsonb_typeof(p_params -> 'percent') is distinct from 'number' then
      return false;
    end if;
    v_p := (p_params ->> 'percent')::numeric;
    if v_p <= 0 or v_p > 100 then
      return false;
    end if;
    if p_params ? 'max_amount' then
      if jsonb_typeof(p_params -> 'max_amount') is distinct from 'number'
         or (p_params ->> 'max_amount')::numeric <= 0 or (p_params ->> 'max_amount')::numeric >= 1000000000 then
        return false;
      end if;
    end if;
    return true;
  elsif p_kind = 'fixed' then
    if (p_params - 'amount') <> '{}'::jsonb or jsonb_typeof(p_params -> 'amount') is distinct from 'number' then
      return false;
    end if;
    return (p_params ->> 'amount')::numeric > 0 and (p_params ->> 'amount')::numeric < 1000000000;
  elsif p_kind = 'free_shipping' then
    return p_params = '{}'::jsonb;
  elsif p_kind = 'bogo' then
    if (p_params - 'take' - 'pay') <> '{}'::jsonb
       or jsonb_typeof(p_params -> 'take') is distinct from 'number' or jsonb_typeof(p_params -> 'pay') is distinct from 'number' then
      return false;
    end if;
    v_q := (p_params ->> 'take')::numeric;
    v_p := (p_params ->> 'pay')::numeric;
    return v_q = trunc(v_q) and v_p = trunc(v_p) and v_q between 2 and 20 and v_p between 1 and v_q - 1;
  elsif p_kind = 'volume' then
    if (p_params - 'tiers') <> '{}'::jsonb or jsonb_typeof(p_params -> 'tiers') is distinct from 'array' then
      return false;
    end if;
    v_n := jsonb_array_length(p_params -> 'tiers');
    if v_n < 1 or v_n > 10 then
      return false;
    end if;
    for v_tier in select value from jsonb_array_elements(p_params -> 'tiers') loop
      if jsonb_typeof(v_tier) is distinct from 'object' or (v_tier - 'min_qty' - 'percent') <> '{}'::jsonb
         or jsonb_typeof(v_tier -> 'min_qty') is distinct from 'number'
         or jsonb_typeof(v_tier -> 'percent') is distinct from 'number' then
        return false;
      end if;
      v_q := (v_tier ->> 'min_qty')::numeric;
      v_p := (v_tier ->> 'percent')::numeric;
      if v_q <> trunc(v_q) or v_q < 2 or v_q > 10000 or v_q <= v_prev or v_p <= 0 or v_p > 100 then
        return false;
      end if;
      v_prev := v_q;
    end loop;
    return true;
  end if;
  return false;
exception when others then
  return false;
end;
$$;

-- 1.3 Descuentos
create table if not exists public.discounts (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null check (char_length(btrim(name)) between 1 and 80),
  kind                      text not null check (kind in ('percent', 'fixed', 'free_shipping', 'bogo', 'volume',
                                                          'group_price', 'flash', 'first_purchase')),
  params                    jsonb not null,
  -- A qué productos alcanza: todo el pedido o los productos, categorías o colecciones de `discount_targets`.
  scope                     text not null default 'order' check (scope in ('order', 'product', 'category', 'collection')),
  -- Un descuento vale para carritos de UNA moneda (los montos fijos y los mínimos se definen por moneda).
  currency                  text not null default 'BOB' references public.currencies (code),
  min_order_amount          numeric(14, 4) check (min_order_amount is null or min_order_amount >= 0),
  customer_group_id         uuid references public.customer_groups (id) on delete restrict,
  requires_coupon           boolean not null default false,
  stackable_with_automatic  boolean not null default false,
  exclude_sale_items        boolean not null default false,
  usage_limit_total         int check (usage_limit_total is null or usage_limit_total >= 1),
  usage_limit_per_customer  int check (usage_limit_per_customer is null or usage_limit_per_customer >= 1),
  priority                  int not null default 100 check (priority between 0 and 100000),
  starts_at                 timestamptz,
  ends_at                   timestamptz,
  is_active                 boolean not null default true,
  archived_at               timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint discounts_window check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint discounts_params check (public._discount_params_valid(kind, params)),
  constraint discounts_coupon_kinds check (
    (kind not in ('percent', 'fixed') or requires_coupon)
    and (kind not in ('bogo', 'volume', 'group_price', 'flash') or not requires_coupon)),
  constraint discounts_bogo_scope check (kind <> 'bogo' or scope <> 'order'),
  constraint discounts_shipping_scope check (kind <> 'free_shipping' or scope = 'order'),
  constraint discounts_group check ((kind = 'group_price') = (customer_group_id is not null)),
  constraint discounts_flash_window check (kind <> 'flash' or (starts_at is not null and ends_at is not null))
);
create index if not exists discounts_live_idx on public.discounts (priority desc, id) where archived_at is null and is_active;
drop trigger if exists discounts_set_updated_at on public.discounts;
create trigger discounts_set_updated_at before update on public.discounts
  for each row execute function public.set_updated_at();
-- `kind`, `scope` y `currency` no cambian después de crear el descuento (los parámetros, los objetivos y las redenciones
-- dependen de ellos): para otro tipo se crea otro descuento.
select public._apply_admin_rls('discounts',
  array['name', 'kind', 'params', 'scope', 'currency', 'min_order_amount', 'customer_group_id', 'requires_coupon',
        'stackable_with_automatic', 'exclude_sale_items', 'usage_limit_total', 'usage_limit_per_customer', 'priority',
        'starts_at', 'ends_at', 'is_active'],
  array['name', 'params', 'min_order_amount', 'customer_group_id', 'requires_coupon', 'stackable_with_automatic',
        'exclude_sale_items', 'usage_limit_total', 'usage_limit_per_customer', 'priority', 'starts_at', 'ends_at',
        'is_active', 'archived_at']);

-- 1.4 Objetivos de un descuento con alcance de producto, categoría o colección
create table if not exists public.discount_targets (
  id            uuid primary key default gen_random_uuid(),
  discount_id   uuid not null references public.discounts (id) on delete restrict,
  product_id    uuid references public.products (id) on delete restrict,
  category_id   uuid references public.categories (id) on delete restrict,
  collection_id uuid references public.collections (id) on delete restrict,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint discount_targets_one check (num_nonnulls(product_id, category_id, collection_id) = 1)
);
create unique index if not exists discount_targets_product_key
  on public.discount_targets (discount_id, product_id) where product_id is not null and archived_at is null;
create unique index if not exists discount_targets_category_key
  on public.discount_targets (discount_id, category_id) where category_id is not null and archived_at is null;
create unique index if not exists discount_targets_collection_key
  on public.discount_targets (discount_id, collection_id) where collection_id is not null and archived_at is null;
drop trigger if exists discount_targets_set_updated_at on public.discount_targets;
create trigger discount_targets_set_updated_at before update on public.discount_targets
  for each row execute function public.set_updated_at();
select public._apply_admin_rls('discount_targets', array['discount_id', 'product_id', 'category_id', 'collection_id'],
                               array['archived_at']);

-- El tipo de objetivo tiene que coincidir con el alcance del descuento (un descuento «de todo el pedido» no lleva objetivos).
create or replace function public._discount_targets_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope text;
begin
  select d.scope into v_scope from public.discounts d where d.id = new.discount_id;
  if v_scope is null or v_scope = 'order'
     or (v_scope = 'product') is distinct from (new.product_id is not null)
     or (v_scope = 'category') is distinct from (new.category_id is not null)
     or (v_scope = 'collection') is distinct from (new.collection_id is not null) then
    raise exception 'el objetivo no corresponde al alcance del descuento (%)', coalesce(v_scope, '?')
      using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists discount_targets_check_trg on public.discount_targets;
create trigger discount_targets_check_trg before insert on public.discount_targets
  for each row execute function public._discount_targets_check();

-- 1.5 Cupones (códigos). Ningún cliente los lee: un código solo se prueba por la función `cart`.
-- Normalización: sin espacios, guiones ni guiones bajos, en mayúsculas y con los caracteres que se confunden unificados
-- (O→0, I→1, L→1): «verano-10», «VERANO 10» y «VERAN0 1O» son el mismo código. `code` guarda cómo lo escribió el admin.
create or replace function public._coupon_norm(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(upper(regexp_replace(btrim(p_code), '[[:space:]_-]+', '', 'g')), 'OIL', '011')
$$;

create table if not exists public.coupons (
  id              uuid primary key default gen_random_uuid(),
  discount_id     uuid not null references public.discounts (id) on delete restrict,
  code            text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9-]{2,31}$'),
  code_normalized text generated always as (public._coupon_norm(code)) stored,
  is_active       boolean not null default true,
  starts_at       timestamptz,
  ends_at         timestamptz,
  -- Usos de ESTE código (p. ej. 1 para códigos de un solo uso en un lote); null = sin tope propio.
  usage_limit     int check (usage_limit is null or usage_limit >= 1),
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint coupons_window check (starts_at is null or ends_at is null or ends_at > starts_at),
  -- `A--` o `1-0` pasan la forma de arriba pero normalizan a 1–2 caracteres (se adivinan en decenas de intentos).
  constraint coupons_code_norm_len check (char_length(public._coupon_norm(code)) >= 4)
);
create unique index if not exists coupons_code_key on public.coupons (code_normalized);
create index if not exists coupons_discount_idx on public.coupons (discount_id);
drop trigger if exists coupons_set_updated_at on public.coupons;
create trigger coupons_set_updated_at before update on public.coupons
  for each row execute function public.set_updated_at();
select public._apply_admin_rls('coupons', array['discount_id', 'code', 'is_active', 'starts_at', 'ends_at', 'usage_limit'],
                               array['is_active', 'starts_at', 'ends_at', 'usage_limit', 'archived_at']);

-- Solo un descuento que PIDE código puede tener códigos.
create or replace function public._coupons_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.discounts d where d.id = new.discount_id and d.requires_coupon) then
    raise exception 'solo un descuento que pide código puede tener cupones' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists coupons_check_trg on public.coupons;
create trigger coupons_check_trg before insert on public.coupons
  for each row execute function public._coupons_check();

-- 1.6 Redenciones (usos). Solo las escriben las funciones del servidor; el admin las LEE.
create table if not exists public.discount_redemptions (
  id          uuid primary key default gen_random_uuid(),
  discount_id uuid not null references public.discounts (id) on delete restrict,
  coupon_id   uuid references public.coupons (id) on delete restrict,
  profile_id  uuid references public.profiles (id) on delete restrict,
  owner_type  text not null check (owner_type in ('order', 'cart', 'manual')),
  owner_id    uuid not null,
  amount      numeric(14, 4) not null check (amount >= 0),
  currency    text not null references public.currencies (code),
  status      text not null default 'reserved' check (status in ('reserved', 'applied', 'reverted')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- Un descuento se usa una vez por pedido, y un pedido lleva UN solo cupón (BR-PRC-03).
create unique index if not exists discount_redemptions_owner_key
  on public.discount_redemptions (owner_type, owner_id, discount_id) where status in ('reserved', 'applied');
create unique index if not exists discount_redemptions_one_coupon_key
  on public.discount_redemptions (owner_type, owner_id) where coupon_id is not null and status in ('reserved', 'applied');
create index if not exists discount_redemptions_discount_idx on public.discount_redemptions (discount_id, status);
create index if not exists discount_redemptions_profile_idx on public.discount_redemptions (profile_id, discount_id) where profile_id is not null;
drop trigger if exists discount_redemptions_set_updated_at on public.discount_redemptions;
create trigger discount_redemptions_set_updated_at before update on public.discount_redemptions
  for each row execute function public.set_updated_at();
select public._apply_admin_rls('discount_redemptions', null, null);
revoke insert, update on public.discount_redemptions from service_role;   -- solo las funciones (dueño) escriben aquí

-- Auditoría (BR-ADM-03)
do $$
declare t text;
begin
  foreach t in array array['discounts', 'coupons', 'customer_groups', 'customer_group_members', 'discount_targets']
  loop
    execute format('drop trigger if exists %I on public.%I', 'audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I
                      for each row execute function public.audit_changes()', 'audit_' || t, t);
  end loop;
end $$;

-- Uso por descuento para el listado del panel (estado «agotado») y el reporte: con los permisos de QUIEN CONSULTA, así que la
-- RLS de `discount_redemptions` (solo admin) se aplica y un cliente no ve nada.
create or replace view public.discount_usage with (security_invoker = true) as
select r.discount_id,
       count(*) filter (where r.status in ('reserved', 'applied'))::int as used,
       count(distinct r.profile_id) filter (where r.status in ('reserved', 'applied'))::int as customers,
       coalesce(sum(r.amount) filter (where r.status in ('reserved', 'applied')), 0)::numeric(14, 4) as amount
  from public.discount_redemptions r
 group by r.discount_id;
revoke all on public.discount_usage from public, anon;
grant select on public.discount_usage to authenticated;

-- ── 2. El motor ─────────────────────────────────────────────────────────────────────────────
-- Reparte `p_amount` entre líneas en proporción a `p_weights` con el método del mayor resto: la suma es EXACTA (nunca más
-- que p_amount ni que la suma de los pesos) y ninguna línea recibe más que su peso.
create or replace function public._discount_distribute(p_amount bigint, p_weights bigint[])
returns bigint[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  n int := coalesce(array_length(p_weights, 1), 0);
  v_sum numeric := 0;
  v_amt numeric;
  v_res bigint[];
  v_rem numeric[];
  v_left bigint;
  v_pick int;
  i int;
  k bigint;
begin
  if n = 0 then
    return '{}'::bigint[];
  end if;
  v_res := array_fill(0::bigint, array[n]);
  for i in 1..n loop
    v_sum := v_sum + greatest(coalesce(p_weights[i], 0), 0);
  end loop;
  if p_amount is null or p_amount <= 0 or v_sum <= 0 then
    return v_res;
  end if;
  v_amt := least(p_amount::numeric, v_sum);
  v_rem := array_fill(-1::numeric, array[n]);
  v_left := v_amt::bigint;
  for i in 1..n loop
    if coalesce(p_weights[i], 0) > 0 then
      v_res[i] := floor(v_amt * p_weights[i] / v_sum)::bigint;
      v_rem[i] := mod(v_amt * p_weights[i], v_sum);
      v_left := v_left - v_res[i];
    end if;
  end loop;
  -- Las unidades que sobran van a los mayores restos (empate: la primera línea).
  k := 0;
  while k < v_left loop
    v_pick := null;
    for i in 1..n loop
      if v_rem[i] > 0 and (v_pick is null or v_rem[i] > v_rem[v_pick]) then
        v_pick := i;
      end if;
    end loop;
    exit when v_pick is null;
    v_res[v_pick] := v_res[v_pick] + 1;
    v_rem[v_pick] := -1;
    k := k + 1;
  end loop;
  return v_res;
end;
$$;

-- Cuánto baja cada línea con un descuento de ese tipo. Entradas en la unidad menor de la moneda; `p_elig[i]` dice si la
-- línea es elegible; `p_base[i]` es el importe de la línea sobre el que se calcula (ya con las ofertas aplicadas, si el
-- cupón se acumula); `p_unit[i]` el precio de UNA unidad (solo para N×M). Devuelve 0 ≤ r[i] ≤ p_base[i].
create or replace function public._discount_reductions(
  p_kind text, p_params jsonb, p_elig boolean[], p_unit bigint[], p_qty int[], p_base bigint[], p_scale numeric)
returns bigint[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  n int := coalesce(array_length(p_base, 1), 0);
  r bigint[];
  i int;
  g int;
  v_pct numeric;
  v_cap bigint;
  v_sum bigint;
  v_w bigint[];
  v_take int;
  v_pay int;
  v_units bigint[];
  v_owner int[];
  v_groups int;
  v_pos int;
  v_qty int;
  v_tier jsonb;
begin
  if n = 0 then
    return '{}'::bigint[];
  end if;
  r := array_fill(0::bigint, array[n]);

  if p_kind in ('percent', 'flash', 'group_price', 'first_purchase', 'volume') then
    if p_kind = 'volume' then
      select coalesce(sum(p_qty[x.i]), 0) into v_qty from generate_series(1, n) as x(i) where p_elig[x.i];
      v_pct := null;
      for v_tier in select value from jsonb_array_elements(p_params -> 'tiers') loop
        if (v_tier ->> 'min_qty')::numeric <= v_qty then
          v_pct := (v_tier ->> 'percent')::numeric;    -- los tramos van en orden creciente: gana el último que se cumple
        end if;
      end loop;
    else
      v_pct := (p_params ->> 'percent')::numeric;
    end if;
    if v_pct is null then
      return r;
    end if;
    for i in 1..n loop
      if p_elig[i] then
        r[i] := least(p_base[i], round(p_base[i] * v_pct / 100)::bigint);
      end if;
    end loop;
    if p_params ? 'max_amount' then
      v_cap := round((p_params ->> 'max_amount')::numeric * p_scale)::bigint;
      select coalesce(sum(x), 0) into v_sum from unnest(r) as x;
      if v_sum > v_cap then
        r := public._discount_distribute(v_cap, r);
      end if;
    end if;

  elsif p_kind = 'fixed' then
    v_w := array_fill(0::bigint, array[n]);
    for i in 1..n loop
      if p_elig[i] then
        v_w[i] := p_base[i];
      end if;
    end loop;
    r := public._discount_distribute(round((p_params ->> 'amount')::numeric * p_scale)::bigint, v_w);

  elsif p_kind = 'bogo' then
    -- Llévate N, paga M: las unidades elegibles se ordenan de la más cara a la más barata, se arman grupos de N seguidos y
    -- en cada grupo se regalan las (N − M) más baratas (con precios distintos se regala el más barato del grupo).
    v_take := (p_params ->> 'take')::numeric::int;   -- `2.0` es un entero válido para el CHECK: no se castea el texto directo
    v_pay := (p_params ->> 'pay')::numeric::int;
    select coalesce(array_agg(t.price order by t.price desc, t.i), '{}'::bigint[]),
           coalesce(array_agg(t.i order by t.price desc, t.i), '{}'::int[])
      into v_units, v_owner
      from (select x.i, p_unit[x.i] as price
              from generate_series(1, n) as x(i)
             cross join lateral generate_series(1, case when p_elig[x.i] then p_qty[x.i] else 0 end) as u(k)) t;
    v_groups := coalesce(array_length(v_units, 1), 0) / v_take;
    for g in 0..v_groups - 1 loop
      for v_pos in g * v_take + v_pay + 1 .. g * v_take + v_take loop
        r[v_owner[v_pos]] := r[v_owner[v_pos]] + v_units[v_pos];
      end loop;
    end loop;
    for i in 1..n loop
      r[i] := least(r[i], p_base[i]);
    end loop;
  end if;
  return r;
end;
$$;

-- ¿Esta línea (por su producto) cae en el alcance del descuento?
create or replace function public._discount_line_eligible(p_discount_id uuid, p_scope text, p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_scope
    when 'order' then true
    when 'product' then exists (
      select 1 from public.discount_targets t
       where t.discount_id = p_discount_id and t.archived_at is null and t.product_id = p_product_id)
    when 'category' then exists (
      select 1 from public.discount_targets t
        join public.categories c on c.id = t.category_id and c.archived_at is null
        join public.product_categories pc on pc.category_id = t.category_id
       where t.discount_id = p_discount_id and t.archived_at is null and pc.product_id = p_product_id)
    when 'collection' then exists (
      select 1 from public.discount_targets t
        join public.collections c on c.id = t.collection_id and c.archived_at is null
        join public.product_collections pc on pc.collection_id = t.collection_id
       where t.discount_id = p_discount_id and t.archived_at is null and pc.product_id = p_product_id)
    else false
  end
$$;

-- Pedidos NO cancelados de un cliente (para «primera compra»). Los pedidos llegan en S10: hasta entonces nadie tiene
-- ninguno. S10 REDEFINE esta función contando sus pedidos.
create or replace function public._customer_order_count(p_profile_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select 0
$$;

-- Usos vigentes (reservados o aplicados): [total del descuento, de ese cupón, de ese cliente].
create or replace function public._discount_usage(p_discount_id uuid, p_coupon_id uuid, p_profile_id uuid)
returns int[]
language sql
stable
security definer
set search_path = ''
as $$
  select array[
    count(*)::int,
    (count(*) filter (where p_coupon_id is not null and r.coupon_id = p_coupon_id))::int,
    (count(*) filter (where p_profile_id is not null and r.profile_id = p_profile_id))::int]
    from public.discount_redemptions r
   where r.discount_id = p_discount_id and r.status in ('reserved', 'applied')
$$;

-- ¿El cliente cumple lo que pide el tipo de descuento? null = sí; si no, el motivo.
create or replace function public._discount_customer_reason(p_kind text, p_group_id uuid, p_profile_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_kind = 'group_price' then
    if p_profile_id is null then
      return 'login_required';
    end if;
    if not exists (
      select 1 from public.customer_group_members m
        join public.customer_groups g on g.id = m.group_id and g.archived_at is null
       where m.group_id = p_group_id and m.profile_id = p_profile_id and m.archived_at is null) then
      return 'not_eligible_customer';
    end if;
  elsif p_kind = 'first_purchase' then
    if p_profile_id is null then
      return 'login_required';
    end if;
    if public._customer_order_count(p_profile_id) > 0 then
      return 'not_first_purchase';
    end if;
  end if;
  return null;
end;
$$;

-- EL MOTOR. Entradas: el cliente (o null), la moneda, las líneas
--   [{idx, variant_id, product_id, unit_price, qty, line_total}]   (qty = unidades que se cobran; line_total = importe de la línea),
-- el código del cupón escrito (o null), el costo de envío ya conocido (o null) y «ahora» (para probar vigencias).
-- Devuelve {lines, applied, rejected, coupon, free_shipping, totals}. NO escribe nada.
create or replace function public._discount_evaluate(
  p_profile_id uuid, p_currency text, p_lines jsonb, p_coupon text default null,
  p_shipping numeric default null, p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dec int;
  v_scale numeric;
  n int := 0;
  a_idx int[]; a_product uuid[]; a_unit bigint[]; a_qty int[]; a_base bigint[];
  a_auto bigint[]; a_auto_id uuid[]; a_auto_name text[]; a_auto_kind text[];
  a_cpn bigint[]; a_base_c bigint[];
  elig boolean[];
  r bigint[];
  d record;
  c record;
  i int;
  v_sub bigint := 0;
  v_sub_ref bigint;
  v_sub_after bigint;
  v_auto_total bigint := 0;
  v_cpn_total bigint := 0;
  v_min bigint;
  v_usage int[];
  v_norm text;
  v_typed text;
  v_canon text;
  v_reason text;
  v_missing numeric;
  v_found boolean := false;
  v_cpn_applied boolean := false;
  v_cpn_free boolean := false;
  v_free boolean := false;
  v_free_id uuid;
  v_free_name text;
  v_ship_disc numeric := 0;
  v_applied jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_coupon jsonb := jsonb_build_object('status', 'none', 'code', null, 'reason', null, 'missing', null);
  v_lines jsonb := '[]'::jsonb;
  v_offers jsonb;
  v_total_disc bigint;
begin
  select cu.decimals into v_dec from public.currencies cu where cu.code = p_currency;
  v_dec := coalesce(v_dec, 2);
  v_scale := power(10::numeric, v_dec);

  if p_lines is not null and jsonb_typeof(p_lines) = 'array' then
    select count(*)::int,
           array_agg((t.l ->> 'idx')::int order by t.o),
           array_agg((t.l ->> 'product_id')::uuid order by t.o),
           array_agg(round((t.l ->> 'unit_price')::numeric * v_scale)::bigint order by t.o),
           array_agg((t.l ->> 'qty')::int order by t.o),
           array_agg(round((t.l ->> 'line_total')::numeric * v_scale)::bigint order by t.o)
      into n, a_idx, a_product, a_unit, a_qty, a_base
      from jsonb_array_elements(p_lines) with ordinality as t(l, o)
     where (t.l ->> 'qty')::int > 0;
  end if;

  v_typed := nullif(left(btrim(coalesce(p_coupon, '')), 40), '');
  v_norm := nullif(public._coupon_norm(p_coupon), '');

  if n = 0 then
    if v_norm is not null then
      -- Sin líneas cobrables nada «aplica», pero un código que no existe (o no está vigente) sigue siendo inválido: así no se
      -- guarda basura en el carrito y la respuesta es la misma que con líneas.
      select cp.code into v_canon
        from public.coupons cp join public.discounts dd on dd.id = cp.discount_id
       where cp.code_normalized = v_norm and cp.is_active and cp.archived_at is null
         and dd.is_active and dd.archived_at is null and dd.requires_coupon
         and (cp.starts_at is null or cp.starts_at <= p_now) and (dd.starts_at is null or dd.starts_at <= p_now);
      v_reason := case when v_canon is not null then 'not_applicable' else 'invalid_code' end;
      -- «not_applicable» ya dice que el cupón existe y está vigente, así que mostrar su código canónico no revela nada más; en
      -- cambio «invalid_code» devuelve lo escrito. Importa porque el carrito guarda el código NORMALIZADO (O→0, L→1…) y la
      -- foto lo vuelve a evaluar: sin esto la clienta que escribió EJEMPLO20 vería «EJEMP1020».
      v_coupon := jsonb_build_object('status', 'rejected', 'code', coalesce(v_canon, v_typed),
                                     'reason', v_reason, 'missing', null);
      v_rejected := jsonb_build_array(jsonb_build_object('code', coalesce(v_canon, v_typed),
                                                         'reason', v_reason, 'missing', null));
    end if;
    return jsonb_build_object('lines', '[]'::jsonb, 'applied', '[]'::jsonb, 'rejected', v_rejected, 'coupon', v_coupon,
                              'free_shipping', false,
                              'totals', jsonb_build_object('subtotal', 0, 'discount', 0, 'total', 0, 'shipping', p_shipping,
                                                           'shipping_discount', 0,
                                                           'grand_total', case when p_shipping is null then null else p_shipping end));
  end if;

  a_auto := array_fill(0::bigint, array[n]);
  a_auto_id := array_fill(null::uuid, array[n]);
  a_auto_name := array_fill(null::text, array[n]);
  a_auto_kind := array_fill(null::text, array[n]);
  a_cpn := array_fill(0::bigint, array[n]);
  elig := array_fill(false, array[n]);
  for i in 1..n loop
    v_sub := v_sub + a_base[i];
  end loop;

  -- `c` tiene estructura SIEMPRE (aunque no se escriba ningún cupón): PL/pgSQL no deja leer campos de un registro sin asignar.
  select cp.id as coupon_id, cp.code, cp.is_active as cp_active, cp.archived_at as cp_arch, cp.starts_at as cp_starts,
           cp.ends_at as cp_ends, cp.usage_limit as cp_limit,
           dd.id as d_id, dd.name, dd.kind, dd.params, dd.scope, dd.currency as d_currency, dd.min_order_amount,
           dd.customer_group_id, dd.stackable_with_automatic as stackable, dd.exclude_sale_items,
           dd.usage_limit_total, dd.usage_limit_per_customer, dd.is_active as d_active, dd.archived_at as d_arch,
           dd.starts_at as d_starts, dd.ends_at as d_ends, dd.requires_coupon
      into c
      from public.coupons cp
      join public.discounts dd on dd.id = cp.discount_id
   where false;

  -- 1. Ofertas AUTOMÁTICAS. Por línea gana la que más baja (empate: mayor prioridad y luego menor id): nunca dos sobre la misma.
  for d in
    select x.* from public.discounts x
     where x.is_active and x.archived_at is null and not x.requires_coupon and x.currency = p_currency
       and x.kind in ('bogo', 'volume', 'group_price', 'flash', 'first_purchase')
       and (x.starts_at is null or x.starts_at <= p_now) and (x.ends_at is null or p_now < x.ends_at)
     order by x.priority desc, x.id
  loop
    v_usage := case when d.usage_limit_total is null and d.usage_limit_per_customer is null then '{0,0,0}'::int[]
                    else public._discount_usage(d.id, null, p_profile_id) end;   -- sin topes no hay nada que contar
    if d.usage_limit_total is not null and v_usage[1] >= d.usage_limit_total then continue; end if;
    if d.usage_limit_per_customer is not null
       and (p_profile_id is null or v_usage[3] >= d.usage_limit_per_customer) then continue; end if;
    if public._discount_customer_reason(d.kind, d.customer_group_id, p_profile_id) is not null then continue; end if;
    if d.min_order_amount is not null and v_sub < round(d.min_order_amount * v_scale)::bigint then continue; end if;
    for i in 1..n loop
      elig[i] := public._discount_line_eligible(d.id, d.scope, a_product[i]);
    end loop;
    r := public._discount_reductions(d.kind, d.params, elig, a_unit, a_qty, a_base, v_scale);
    for i in 1..n loop
      if r[i] > a_auto[i] then
        a_auto[i] := r[i]; a_auto_id[i] := d.id; a_auto_name[i] := d.name; a_auto_kind[i] := d.kind;
      end if;
    end loop;
  end loop;
  for i in 1..n loop
    v_auto_total := v_auto_total + a_auto[i];
  end loop;

  -- 2. El CUPÓN (uno solo por pedido).
  if v_norm is not null then
    select cp.id as coupon_id, cp.code, cp.is_active as cp_active, cp.archived_at as cp_arch, cp.starts_at as cp_starts,
           cp.ends_at as cp_ends, cp.usage_limit as cp_limit,
           dd.id as d_id, dd.name, dd.kind, dd.params, dd.scope, dd.currency as d_currency, dd.min_order_amount,
           dd.customer_group_id, dd.stackable_with_automatic as stackable, dd.exclude_sale_items,
           dd.usage_limit_total, dd.usage_limit_per_customer, dd.is_active as d_active, dd.archived_at as d_arch,
           dd.starts_at as d_starts, dd.ends_at as d_ends, dd.requires_coupon
      into c
      from public.coupons cp
      join public.discounts dd on dd.id = cp.discount_id
     where cp.code_normalized = v_norm;
    v_found := found;

    v_reason := null;
    if not v_found or not c.cp_active or c.cp_arch is not null or not c.d_active or c.d_arch is not null
       or not c.requires_coupon or coalesce(c.cp_starts, c.d_starts) > p_now or coalesce(c.d_starts, c.cp_starts) > p_now then
      -- Inexistente, apagado, archivado o que aún no empieza: la MISMA respuesta (no se puede enumerar cupones).
      v_reason := 'invalid_code';
    elsif (c.cp_ends is not null and c.cp_ends <= p_now) or (c.d_ends is not null and c.d_ends <= p_now) then
      v_reason := 'expired';
    elsif c.d_currency <> p_currency then
      v_reason := 'wrong_currency';
    else
      v_usage := public._discount_usage(c.d_id, c.coupon_id, p_profile_id);
      if p_profile_id is null and (c.usage_limit_per_customer is not null or c.kind in ('first_purchase', 'group_price')) then
        v_reason := 'login_required';
      elsif (c.usage_limit_total is not null and v_usage[1] >= c.usage_limit_total)
            or (c.cp_limit is not null and v_usage[2] >= c.cp_limit) then
        v_reason := 'sold_out';
      elsif c.usage_limit_per_customer is not null and v_usage[3] >= c.usage_limit_per_customer then
        v_reason := 'already_used';
      else
        v_reason := public._discount_customer_reason(c.kind, c.customer_group_id, p_profile_id);
      end if;
    end if;

    if v_reason is null and c.kind = 'free_shipping' then
      v_cpn_free := true;      -- se resuelve en el paso 3 (necesita el subtotal ya descontado)
    elsif v_reason is null then
      for i in 1..n loop
        elig[i] := public._discount_line_eligible(c.d_id, c.scope, a_product[i])
                   and not (c.exclude_sale_items and a_auto[i] > 0);
      end loop;
      a_base_c := a_base;
      v_sub_ref := v_sub;
      -- «No aplicar a productos ya rebajados»: el cupón y las ofertas tocan líneas DISTINTAS, así que no compiten y conviven
      -- aunque el cupón no sea acumulable (quitarle la oferta a esas líneas sería tocarlas).
      if c.stackable or c.exclude_sale_items then
        for i in 1..n loop
          a_base_c[i] := a_base[i] - a_auto[i];
        end loop;
        v_sub_ref := v_sub - v_auto_total;
      end if;
      v_min := coalesce(round(c.min_order_amount * v_scale)::bigint, 0);
      if not (true = any (elig)) then
        v_reason := 'not_applicable';
      elsif v_sub_ref < v_min then
        v_reason := 'min_not_reached';
        v_missing := round((v_min - v_sub_ref)::numeric / v_scale, v_dec);
      else
        r := public._discount_reductions(c.kind, c.params, elig, a_unit, a_qty, a_base_c, v_scale);
        v_cpn_total := 0;
        for i in 1..n loop
          v_cpn_total := v_cpn_total + r[i];
        end loop;
        if v_cpn_total = 0 then
          v_reason := 'not_applicable';
        elsif not (c.stackable or c.exclude_sale_items) and v_auto_total > 0 and v_cpn_total <= v_auto_total then
          -- No se acumula y las ofertas ya dan igual o más: se aplican ellas y el cupón NO gasta su uso.
          v_reason := 'not_combinable';
          v_cpn_total := 0;
        else
          if not (c.stackable or c.exclude_sale_items) then
            -- La mejor de las dos: gana el cupón y las ofertas automáticas se descartan.
            a_auto := array_fill(0::bigint, array[n]);
            a_auto_id := array_fill(null::uuid, array[n]);
            a_auto_name := array_fill(null::text, array[n]);
            a_auto_kind := array_fill(null::text, array[n]);
            v_auto_total := 0;
          end if;
          a_cpn := r;
          v_cpn_applied := true;
        end if;
      end if;
    end if;
  end if;

  v_sub_after := v_sub - v_auto_total - v_cpn_total;

  -- 3. ENVÍO GRATIS: el umbral se evalúa DESPUÉS de los descuentos.
  for d in
    select x.* from public.discounts x
     where x.is_active and x.archived_at is null and not x.requires_coupon and x.currency = p_currency
       and x.kind = 'free_shipping'
       and (x.starts_at is null or x.starts_at <= p_now) and (x.ends_at is null or p_now < x.ends_at)
     order by x.priority desc, x.id
  loop
    v_usage := case when d.usage_limit_total is null and d.usage_limit_per_customer is null then '{0,0,0}'::int[]
                    else public._discount_usage(d.id, null, p_profile_id) end;   -- sin topes no hay nada que contar
    if d.usage_limit_total is not null and v_usage[1] >= d.usage_limit_total then continue; end if;
    if d.usage_limit_per_customer is not null
       and (p_profile_id is null or v_usage[3] >= d.usage_limit_per_customer) then continue; end if;
    if d.min_order_amount is not null and v_sub_after < round(d.min_order_amount * v_scale)::bigint then continue; end if;
    v_free := true; v_free_id := d.id; v_free_name := d.name;
    exit;
  end loop;
  if v_cpn_free then
    if v_free then
      v_reason := 'not_combinable';              -- ya tiene envío gratis sin el cupón: no se gasta
    elsif c.min_order_amount is not null and v_sub_after < round(c.min_order_amount * v_scale)::bigint then
      v_reason := 'min_not_reached';
      v_missing := round((round(c.min_order_amount * v_scale)::bigint - v_sub_after)::numeric / v_scale, v_dec);
    else
      v_free := true; v_free_id := c.d_id; v_free_name := c.name;
      v_cpn_applied := true;
    end if;
  end if;
  if v_free then
    v_ship_disc := coalesce(p_shipping, 0);
  end if;

  -- Resultado
  if v_norm is not null then
    if v_cpn_applied then
      v_coupon := jsonb_build_object('status', 'applied', 'code', c.code, 'reason', null, 'missing', null,
                                     'discount_id', c.d_id, 'coupon_id', c.coupon_id, 'name', c.name, 'kind', c.kind);
    else
      -- Se devuelve lo que la persona ESCRIBIÓ (no el código guardado): si no, un código que existe se delataría por su mayúscula.
      -- Excepción: los tres motivos con los que el carrito SÍ guarda el cupón (mínimo no alcanzado, no aplica, no combinable).
      -- Solo salen para un cupón existente y vigente, así que el código canónico no delata nada; y hace falta porque la foto
      -- del carrito reevalúa el código NORMALIZADO que guardó (EJEMPLO20 → EJEMP1020) y eso no se le puede mostrar a la clienta.
      v_canon := case when v_found and v_reason in ('min_not_reached', 'not_applicable', 'not_combinable') then c.code end;
      v_coupon := jsonb_build_object('status', 'rejected', 'code', coalesce(v_canon, v_typed), 'reason', v_reason, 'missing', v_missing);
      v_rejected := jsonb_build_array(jsonb_build_object('code', coalesce(v_canon, v_typed), 'reason', v_reason, 'missing', v_missing));
    end if;
  end if;

  for i in 1..n loop
    v_offers := '[]'::jsonb;
    if a_auto[i] > 0 then
      v_offers := v_offers || jsonb_build_array(jsonb_build_object(
        'discount_id', a_auto_id[i], 'name', a_auto_name[i], 'kind', a_auto_kind[i],
        'amount', round(a_auto[i]::numeric / v_scale, v_dec), 'coupon', false));
    end if;
    if a_cpn[i] > 0 then
      v_offers := v_offers || jsonb_build_array(jsonb_build_object(
        'discount_id', c.d_id, 'name', c.name, 'kind', c.kind,
        'amount', round(a_cpn[i]::numeric / v_scale, v_dec), 'coupon', true));
    end if;
    v_lines := v_lines || jsonb_build_object(
      'idx', a_idx[i], 'base_total', round(a_base[i]::numeric / v_scale, v_dec),
      'discount', round((a_auto[i] + a_cpn[i])::numeric / v_scale, v_dec),
      'final_total', round((a_base[i] - a_auto[i] - a_cpn[i])::numeric / v_scale, v_dec),
      'offers', v_offers);
  end loop;

  for d in
    select t.id, max(t.name) as name, max(t.kind) as kind, sum(t.amt)::bigint as amt
      from (select a_auto_id[x.i] as id, a_auto_name[x.i] as name, a_auto_kind[x.i] as kind, a_auto[x.i] as amt
              from generate_series(1, n) as x(i) where a_auto[x.i] > 0) t
     group by t.id
     order by t.id
  loop
    v_applied := v_applied || jsonb_build_array(jsonb_build_object(
      'discount_id', d.id, 'coupon_id', null, 'name', d.name, 'kind', d.kind,
      'amount', round(d.amt::numeric / v_scale, v_dec), 'automatic', true, 'free_shipping', false));
  end loop;
  if v_cpn_applied and not v_cpn_free then
    v_applied := v_applied || jsonb_build_array(jsonb_build_object(
      'discount_id', c.d_id, 'coupon_id', c.coupon_id, 'name', c.name, 'kind', c.kind,
      'amount', round(v_cpn_total::numeric / v_scale, v_dec), 'automatic', false, 'free_shipping', false));
  end if;
  if v_free then
    v_applied := v_applied || jsonb_build_array(jsonb_build_object(
      'discount_id', v_free_id, 'coupon_id', case when v_cpn_free then c.coupon_id end, 'name', v_free_name,
      'kind', 'free_shipping', 'amount', v_ship_disc, 'automatic', not v_cpn_free, 'free_shipping', true));
  end if;

  v_total_disc := v_auto_total + v_cpn_total;
  return jsonb_build_object(
    'lines', v_lines, 'applied', v_applied, 'rejected', v_rejected, 'coupon', v_coupon, 'free_shipping', v_free,
    'totals', jsonb_build_object(
      'subtotal', round(v_sub::numeric / v_scale, v_dec),
      'discount', round(v_total_disc::numeric / v_scale, v_dec),
      'total', round((v_sub - v_total_disc)::numeric / v_scale, v_dec),
      'shipping', p_shipping,
      'shipping_discount', v_ship_disc,
      'grand_total', case when p_shipping is null then null
                          else round((v_sub - v_total_disc)::numeric / v_scale, v_dec) + p_shipping - v_ship_disc end));
end;
$$;

-- ── 3. Usos: reservar, confirmar y devolver (solo el servidor) ──────────────────────────────
-- Reserva de forma ATÓMICA los usos de los descuentos `applied` que devolvió el motor (todo o nada). Toma los candados de las
-- filas de los descuentos y de los cupones EN ORDEN de id (sin ciclos) y cuenta con la fila ya bloqueada: bajo concurrencia
-- no se pasa de ningún límite. Idempotente por dueño (un reintento no duplica).
create or replace function public.discount_reserve(p_owner_type text, p_owner_id uuid, p_profile_id uuid, p_applied jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
  d record;
  v_usage int[];
  v_failed jsonb := '[]'::jsonb;
  v_cp record;
  v_n int := 0;
begin
  if p_owner_type is null or p_owner_type not in ('order', 'cart', 'manual') or p_owner_id is null
     or p_applied is null or jsonb_typeof(p_applied) <> 'array' or jsonb_array_length(p_applied) > 20 then
    return jsonb_build_object('ok', false, 'status', 'invalid');
  end if;

  -- UN solo cupón por pedido (BR-PRC-03): ni en esta llamada ni sumado a uno que el pedido ya haya reservado.
  if (select count(*) from jsonb_array_elements(p_applied) e where nullif(e ->> 'coupon_id', '') is not null) > 1
     or ((select count(*) from jsonb_array_elements(p_applied) e where nullif(e ->> 'coupon_id', '') is not null) = 1
         and exists (select 1 from public.discount_redemptions r
                      where r.owner_type = p_owner_type and r.owner_id = p_owner_id and r.coupon_id is not null
                        and r.status in ('reserved', 'applied')
                        and r.coupon_id <> all (select (e ->> 'coupon_id')::uuid from jsonb_array_elements(p_applied) e
                                                 where nullif(e ->> 'coupon_id', '') is not null))) then
    return jsonb_build_object('ok', false, 'status', 'rejected',
                              'failed', jsonb_build_array(jsonb_build_object('reason', 'one_coupon_per_order')));
  end if;

  -- candados en orden: primero los descuentos y luego los cupones
  perform 1 from public.discounts x
   where x.id in (select (e ->> 'discount_id')::uuid from jsonb_array_elements(p_applied) e)
   order by x.id for update;
  perform 1 from public.coupons x
   where x.id in (select (e ->> 'coupon_id')::uuid from jsonb_array_elements(p_applied) e where e ->> 'coupon_id' is not null)
   order by x.id for update;

  for a in
    select (e ->> 'discount_id')::uuid as discount_id, nullif(e ->> 'coupon_id', '')::uuid as coupon_id,
           coalesce((e ->> 'amount')::numeric, 0) as amount
      from jsonb_array_elements(p_applied) e
     order by 1
  loop
    -- ya reservado por este dueño: se omite (idempotente)
    if exists (select 1 from public.discount_redemptions r
                where r.owner_type = p_owner_type and r.owner_id = p_owner_id and r.discount_id = a.discount_id
                  and r.status in ('reserved', 'applied')) then
      continue;
    end if;
    select * into v_cp from public.coupons x where false;      -- (sin datos de la vuelta anterior)
    select * into d from public.discounts x where x.id = a.discount_id;
    if not found or not d.is_active or d.archived_at is not null then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('discount_id', a.discount_id, 'reason', 'invalid_code'));
      continue;
    end if;
    if (d.ends_at is not null and d.ends_at <= now()) or (d.starts_at is not null and d.starts_at > now()) then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('discount_id', a.discount_id, 'reason', 'expired'));
      continue;
    end if;
    if a.coupon_id is not null then
      select * into v_cp from public.coupons x where x.id = a.coupon_id and x.discount_id = a.discount_id;
      if not found or not v_cp.is_active or v_cp.archived_at is not null then
        v_failed := v_failed || jsonb_build_array(jsonb_build_object('discount_id', a.discount_id, 'reason', 'invalid_code'));
        continue;
      end if;
      if (v_cp.ends_at is not null and v_cp.ends_at <= now()) or (v_cp.starts_at is not null and v_cp.starts_at > now()) then
        v_failed := v_failed || jsonb_build_array(jsonb_build_object('discount_id', a.discount_id, 'reason', 'expired'));
        continue;
      end if;
    end if;
    v_usage := public._discount_usage(a.discount_id, a.coupon_id, p_profile_id);
    if d.usage_limit_per_customer is not null and p_profile_id is null then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('discount_id', a.discount_id, 'reason', 'login_required'));
    elsif (d.usage_limit_total is not null and v_usage[1] >= d.usage_limit_total)
          or (a.coupon_id is not null and v_cp.usage_limit is not null and v_usage[2] >= v_cp.usage_limit) then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('discount_id', a.discount_id, 'reason', 'sold_out'));
    elsif d.usage_limit_per_customer is not null and v_usage[3] >= d.usage_limit_per_customer then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('discount_id', a.discount_id, 'reason', 'already_used'));
    end if;
  end loop;

  if jsonb_array_length(v_failed) > 0 then
    return jsonb_build_object('ok', false, 'status', 'rejected', 'failed', v_failed);
  end if;

  for a in
    select (e ->> 'discount_id')::uuid as discount_id, nullif(e ->> 'coupon_id', '')::uuid as coupon_id,
           coalesce((e ->> 'amount')::numeric, 0) as amount
      from jsonb_array_elements(p_applied) e
     order by 1
  loop
    if exists (select 1 from public.discount_redemptions r
                where r.owner_type = p_owner_type and r.owner_id = p_owner_id and r.discount_id = a.discount_id
                  and r.status in ('reserved', 'applied')) then
      continue;
    end if;
    insert into public.discount_redemptions (discount_id, coupon_id, profile_id, owner_type, owner_id, amount, currency)
    select a.discount_id, a.coupon_id, p_profile_id, p_owner_type, p_owner_id, a.amount, x.currency
      from public.discounts x where x.id = a.discount_id;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'status', 'reserved', 'reserved', v_n);
end;
$$;

-- Confirma los usos reservados (p. ej. al pagarse el pedido).
create or replace function public.discount_commit(p_owner_type text, p_owner_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  update public.discount_redemptions set status = 'applied'
   where owner_type = p_owner_type and owner_id = p_owner_id and status = 'reserved';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Devuelve los usos (pedido cancelado o vencido): quedan `reverted` y dejan de contar.
create or replace function public.discount_release(p_owner_type text, p_owner_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  update public.discount_redemptions set status = 'reverted'
   where owner_type = p_owner_type and owner_id = p_owner_id and status in ('reserved', 'applied');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Genera códigos ALEATORIOS (sin los caracteres que se confunden: 0 O 1 I L) para un descuento con cupón. Devuelve los códigos.
create or replace function public.admin_generate_coupon_codes(
  p_discount_id uuid, p_count int, p_prefix text default null, p_length int default 8, p_usage_limit int default null)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_codes text[] := '{}';
  v_code text;
  v_bytes bytea;
  v_prefix text := coalesce(nullif(btrim(p_prefix), ''), '');
  v_tries int := 0;
  i int;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if p_count is null or p_count < 1 or p_count > 500 or p_length is null or p_length < 6 or p_length > 20
     or (p_usage_limit is not null and p_usage_limit < 1) or v_prefix !~ '^[A-Za-z0-9]{0,8}$' then
    raise exception 'parámetros de generación inválidos' using errcode = '22023';
  end if;
  if not exists (select 1 from public.discounts d where d.id = p_discount_id and d.requires_coupon and d.archived_at is null) then
    raise exception 'el descuento no existe o no pide código' using errcode = 'P0002';
  end if;
  while coalesce(array_length(v_codes, 1), 0) < p_count loop
    v_tries := v_tries + 1;
    if v_tries > p_count * 20 + 100 then
      raise exception 'no se pudieron generar códigos únicos' using errcode = 'P0001';
    end if;
    v_bytes := extensions.gen_random_bytes(p_length);
    v_code := '';
    for i in 0..p_length - 1 loop
      v_code := v_code || substr(c_alphabet, (get_byte(v_bytes, i) % length(c_alphabet)) + 1, 1);
    end loop;
    if v_prefix <> '' then
      v_code := upper(v_prefix) || '-' || v_code;
    end if;
    if char_length(v_code) > 32 then
      raise exception 'el código sería demasiado largo' using errcode = '22023';
    end if;
    begin
      insert into public.coupons (discount_id, code, usage_limit) values (p_discount_id, v_code, p_usage_limit);
      v_codes := v_codes || v_code;
    exception when unique_violation then
      null;     -- colisión (rarísima): se prueba otro
    end;
  end loop;
  return v_codes;
end;
$$;

-- ── 4. Carrito: el cupón del carrito y el desglose por línea ────────────────────────────────
alter table public.carts add column if not exists coupon_code text
  check (coupon_code is null or char_length(coupon_code) between 1 and 40);

-- Al fusionar el carrito de un invitado con el del usuario, el cupón del invitado pasa al usuario si este no tenía uno.
create or replace function public._carts_carry_coupon()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'merged' and old.status is distinct from 'merged' and new.coupon_code is not null and new.merged_into is not null then
    update public.carts set coupon_code = new.coupon_code where id = new.merged_into and coupon_code is null;
  end if;
  return new;
end;
$$;
drop trigger if exists carts_carry_coupon_trg on public.carts;
create trigger carts_carry_coupon_trg after update of status on public.carts
  for each row execute function public._carts_carry_coupon();

-- La foto del carrito (la de S7 + los descuentos): por línea `discount`, `final_total` y `discount_offers`; en los totales el
-- descuento y el total ya descontado; y `discounts` con lo aplicado, lo rechazado y el estado del cupón.
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
  v_eval jsonb;
  v_in jsonb;
  v_el jsonb;
  v_discount numeric := 0;
begin
  select c.id, c.currency, c.status, c.profile_id, c.coupon_code into v_cart from public.carts c where c.id = p_cart_id;
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
      'discount', 0, 'final_total', v_total, 'discount_offers', '[]'::jsonb,
      'reserved_qty', v_own, 'reservation_expires_at', v_own_exp);
  end loop;

  -- Descuentos (S9): el motor decide sobre las líneas que SE COBRAN; aquí solo se anotan sus resultados en la foto.
  select coalesce(jsonb_agg(jsonb_build_object(
           'idx', t.o, 'variant_id', t.l ->> 'variant_id', 'product_id', t.l ->> 'product_id',
           'unit_price', t.l -> 'unit_price', 'qty', t.l -> 'billable_qty', 'line_total', t.l -> 'line_total') order by t.o),
         '[]'::jsonb)
    into v_in
    from jsonb_array_elements(v_lines) with ordinality as t(l, o)
   where (t.l ->> 'billable_qty')::int > 0;
  v_eval := public._discount_evaluate(v_cart.profile_id, v_cart.currency, v_in, v_cart.coupon_code, null, now());
  for v_el in select value from jsonb_array_elements(v_eval -> 'lines') loop
    v_lines := jsonb_set(v_lines, array[((v_el ->> 'idx')::int - 1)::text],
      (v_lines -> ((v_el ->> 'idx')::int - 1)) || jsonb_build_object(
        'discount', v_el -> 'discount', 'final_total', v_el -> 'final_total', 'discount_offers', v_el -> 'offers'));
  end loop;
  v_discount := coalesce((v_eval -> 'totals' ->> 'discount')::numeric, 0);

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
      -- `shipping` lo llena el checkout (S10: el envío real); `discount` es null mientras no haya ninguno (sin fila en la bolsa).
      'shipping', null, 'discount', case when v_discount > 0 then v_discount end,
      'total', round(v_subtotal - v_discount, v_decimals)),
    'discounts', jsonb_build_object(
      'applied', v_eval -> 'applied', 'rejected', v_eval -> 'rejected', 'coupon', v_eval -> 'coupon',
      'free_shipping', v_eval -> 'free_shipping'),
    'reservation', jsonb_build_object(
      'state', case when not v_reserve or v_reservable = 0 then 'none'
                    when v_any_unreserved then 'expired' else 'held' end,
      'expires_at', case when v_reserve and not v_any_unreserved then v_min_exp end),
    'can_checkout', jsonb_array_length(v_lines) > 0 and not v_any_blocking and v_billable_units > 0);
end;
$$;


-- Los descuentos de UN carrito con un cupón dado (para probar el motor y para el checkout de S10). `p_coupon_code` null =
-- el cupón guardado en el carrito; '' = ninguno. `p_shipping` es el costo de envío ya cotizado (S8) o null.
create or replace function public.apply_discounts(
  p_cart_id uuid, p_coupon_code text default null, p_shipping numeric default null, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart record;
  v_snap jsonb;
  v_in jsonb;
begin
  select c.profile_id, c.currency, c.coupon_code into v_cart from public.carts c where c.id = p_cart_id;
  if not found then
    return null;
  end if;
  v_snap := public._cart_snapshot(p_cart_id);
  select coalesce(jsonb_agg(jsonb_build_object(
           'idx', t.o, 'variant_id', t.l ->> 'variant_id', 'product_id', t.l ->> 'product_id',
           'unit_price', t.l -> 'unit_price', 'qty', t.l -> 'billable_qty', 'line_total', t.l -> 'line_total') order by t.o),
         '[]'::jsonb)
    into v_in
    from jsonb_array_elements(v_snap -> 'lines') with ordinality as t(l, o)
   where (t.l ->> 'billable_qty')::int > 0;
  return public._discount_evaluate(v_cart.profile_id, v_cart.currency, v_in, coalesce(p_coupon_code, v_cart.coupon_code),
                                   p_shipping, p_now);
end;
$$;

-- Pone un cupón en el carrito. Un cupón por pedido: si ya hay otro, se rechaza (hay que quitarlo antes). Un código inexistente,
-- apagado, vencido, agotado o que no corresponde a la cliente NO se guarda; uno válido que hoy no baja nada por una causa
-- que puede cambiar (mínimo no alcanzado, productos que no alcanza, mejor oferta ya aplicada) sí se guarda y se avisa.
create or replace function public.cart_set_coupon(p_profile_id uuid, p_token_hash text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart uuid;
  v_state text;
  v_norm text;
  v_cur text;
  v_res jsonb;
  v_status text;
  v_reason text;
begin
  select o_id, o_state into v_cart, v_state from public._cart_resolve(p_profile_id, p_token_hash, false);
  if v_cart is null then
    return jsonb_build_object('token_state', v_state, 'server_time', now(), 'cart', null, 'outcome', 'no_cart');
  end if;
  if not public._cart_lock_active(v_cart) then
    return jsonb_build_object('token_state', 'retired', 'server_time', now(), 'cart', null, 'outcome', 'no_cart');
  end if;
  v_norm := nullif(public._coupon_norm(p_code), '');
  if v_norm is null or char_length(v_norm) > 32 then
    v_status := 'rejected'; v_reason := 'invalid_code';
  else
    select c.coupon_code into v_cur from public.carts c where c.id = v_cart;
    if v_cur is not null and v_cur <> v_norm then
      v_status := 'rejected'; v_reason := 'coupon_already_applied';
    else
      v_res := public.apply_discounts(v_cart, v_norm, null);
      v_status := v_res -> 'coupon' ->> 'status';
      v_reason := v_res -> 'coupon' ->> 'reason';
      if v_status = 'applied' or v_reason in ('min_not_reached', 'not_applicable', 'not_combinable') then
        update public.carts set coupon_code = v_norm, updated_at = now(), last_activity_at = now() where id = v_cart;
        v_status := coalesce(v_status, 'rejected');
      end if;
    end if;
  end if;
  return jsonb_build_object(
    'token_state', 'ok', 'server_time', now(), 'cart', public._cart_snapshot(v_cart),
    'outcome', case when v_status = 'applied' or v_reason in ('min_not_reached', 'not_applicable', 'not_combinable')
                    then 'coupon_set' else 'coupon_rejected' end,
    'reason', v_reason, 'missing', v_res -> 'coupon' -> 'missing');
end;
$$;

create or replace function public.cart_remove_coupon(p_profile_id uuid, p_token_hash text)
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
    return jsonb_build_object('token_state', v_state, 'server_time', now(), 'cart', null, 'outcome', 'no_cart');
  end if;
  if not public._cart_lock_active(v_cart) then
    return jsonb_build_object('token_state', 'retired', 'server_time', now(), 'cart', null, 'outcome', 'no_cart');
  end if;
  update public.carts set coupon_code = null, updated_at = now(), last_activity_at = now() where id = v_cart;
  return jsonb_build_object('token_state', 'ok', 'server_time', now(), 'cart', public._cart_snapshot(v_cart),
                            'outcome', 'coupon_removed');
end;
$$;

-- ── 5. Permisos ─────────────────────────────────────────────────────────────────────────────
-- `pg_default_acl` da EXECUTE a `service_role` en toda función nueva: las internas se le quitan. Nada de esto lo ejecuta el
-- navegador salvo el generador de códigos (solo administradores: se comprueba dentro de la función).
revoke all on function
  public._coupon_norm(text), public._discount_params_valid(text, jsonb), public._discount_distribute(bigint, bigint[]),
  public._discount_reductions(text, jsonb, boolean[], bigint[], int[], bigint[], numeric),
  public._discount_line_eligible(uuid, text, uuid), public._customer_order_count(uuid), public._discount_usage(uuid, uuid, uuid),
  public._discount_customer_reason(text, uuid, uuid),
  public._discount_evaluate(uuid, text, jsonb, text, numeric, timestamptz),
  public._discount_targets_check(), public._coupons_check(), public._carts_carry_coupon(),
  public.apply_discounts(uuid, text, numeric, timestamptz), public.discount_reserve(text, uuid, uuid, jsonb),
  public.discount_commit(text, uuid), public.discount_release(text, uuid),
  public.cart_set_coupon(uuid, text, text), public.cart_remove_coupon(uuid, text),
  public.admin_generate_coupon_codes(uuid, int, text, int, int)
  from public, anon, authenticated, service_role;
-- El CHECK de `discounts` evalúa `_discount_params_valid` con los permisos de quien inserta (el admin).
grant execute on function public._discount_params_valid(text, jsonb) to authenticated, service_role;
-- La columna generada de `coupons` usa `_coupon_norm` con los permisos de quien inserta.
grant execute on function public._coupon_norm(text) to authenticated, service_role;
grant execute on function
  public.apply_discounts(uuid, text, numeric, timestamptz), public.discount_reserve(text, uuid, uuid, jsonb),
  public.discount_commit(text, uuid), public.discount_release(text, uuid),
  public.cart_set_coupon(uuid, text, text), public.cart_remove_coupon(uuid, text)
  to service_role;
grant execute on function public.admin_generate_coupon_codes(uuid, int, text, int, int) to authenticated;
