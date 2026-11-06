-- Sprint 8 — Envíos y entregas programadas
-- BR-SHP-01 (costo por distancia, extensible), BR-SHP-02 (entregas programadas), BR-SHP-03 (todo configurable por el admin),
-- BR-PRC-07 (envío gratis sobre un monto: es solo una CONDICIÓN de una regla, y no hay ninguna por decisión del dueño),
-- D-04 (Haversine × factor de ruta; ruteo real después), S-08 (pin en el mapa).
--
-- Diseño:
--  · El costo se calcula en `quote_shipping`, DETERMINISTA y auditable: devuelve qué regla aplicó y el desglose. Nunca devuelve
--    un costo «0» por defecto: si no hay origen, cobertura o tarifa, devuelve `ok: false` con el código del problema.
--  · Un método (`shipping_methods`) tiene REGLAS de tarifa (`shipping_rate_rules`): tipo `distance` (tramos por kilómetro con
--    borde SUPERIOR INCLUSIVO: 3,00 km pertenece al tramo «hasta 3 km»; costo por km adicional, mínimo y máximo) o `flat`
--    (monto fijo). Cada una puede limitarse a una zona, a un rango de monto del pedido y a una vigencia. Gana la de mayor
--    `priority`; a igualdad, la que tiene zona; a igualdad, la de menor `id`.
--  · Cobertura: zonas de ciudades o de radio. Una zona NO permitida (`allowed = false`) bloquea siempre; si no hay ninguna zona
--    permitida configurada se rechaza («cobertura sin configurar»), para no vender a todo el país por omisión (3.4 del dueño:
--    «solo ciudades, no pueblos»).
--  · Franjas (`delivery_slots`), fechas bloqueadas y cupos por día (`delivery_bookings`). El cupo se reserva de forma atómica
--    con `reserve_delivery_slot` (la llama el servidor al crear el pedido, S10); `quote_shipping` solo LEE.
--  · La zona horaria del negocio es `America/La_Paz` (UTC−4, sin horario de verano).
--  · Nada se borra: se archiva (`archived_at`), igual que el catálogo. Todo cambio queda en `audit_log` (BR-ADM-03).
--
-- Rollback manual:
--   drop view public.public_shipping_methods;   -- (primero: depende de las tablas)
--   drop trigger store_settings_validate_s8_trg on public.store_settings;
--   delete from public.store_settings where key in ('shipping_route_factor_pct', 'delivery_min_lead_hours', 'delivery_max_days_ahead');
--   drop function public.quote_shipping(text, numeric, numeric, text, numeric, text, date, uuid, int),
--     public.reserve_delivery_slot(uuid, date, text, uuid), public.release_delivery_slot(text, uuid),
--     public.admin_set_primary_location(uuid), public._ship_slots(uuid, date, int), public._ship_slot_ok(uuid, date, timestamptz),
--     public._ship_params_valid(text, jsonb), public._ship_norm(text), public.haversine_km(numeric, numeric, numeric, numeric),
--     public.store_settings_validate_s8();
--   drop table public.delivery_bookings, public.blocked_dates, public.delivery_slots, public.shipping_rate_rules,
--     public.shipping_zones, public.shipping_methods, public.store_locations;

-- ── 1. Ajustes ──────────────────────────────────────────────────────────────────────────────
insert into public.store_settings (key, value, value_type, is_public, description) values
  ('shipping_route_factor_pct', '130', 'int', false,
   'Factor que convierte la distancia en línea recta en distancia de ruta, en %: 130 = +30 % (D-04, fase 1)'),
  ('delivery_min_lead_hours', '24', 'int', false,
   'Horas mínimas de antelación para una entrega programada (0 = se puede programar para ya)'),
  ('delivery_max_days_ahead', '30', 'int', false,
   'Días máximos hacia adelante en que se puede programar una entrega')
on conflict (key) do nothing;

create or replace function public.store_settings_validate_s8()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_text text := new.value #>> '{}';
  v_n int;
begin
  -- Solo mira valores ya numéricos y deja que el validador genérico explique el resto.
  if new.value_type <> 'int' or v_text !~ '^[0-9]{1,9}$' then
    return new;
  end if;
  v_n := v_text::int;
  if (new.key = 'shipping_route_factor_pct' and (v_n < 100 or v_n > 300))
     or (new.key = 'delivery_min_lead_hours' and v_n > 720)
     or (new.key = 'delivery_max_days_ahead' and (v_n < 1 or v_n > 180)) then
    raise exception 'el ajuste "%" está fuera de rango', new.key using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists store_settings_validate_s8_trg on public.store_settings;
create trigger store_settings_validate_s8_trg before insert or update on public.store_settings
  for each row
  when (new.key in ('shipping_route_factor_pct', 'delivery_min_lead_hours', 'delivery_max_days_ahead'))
  execute function public.store_settings_validate_s8();

-- ── 2. Utilidades puras ─────────────────────────────────────────────────────────────────────
-- Distancia en kilómetros sobre la esfera (radio medio de la Tierra: 6371,0088 km). NULL si falta algún dato o no es un número.
create or replace function public.haversine_km(p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then null
    when p_lat1 in ('NaN', 'Infinity', '-Infinity') or p_lng1 in ('NaN', 'Infinity', '-Infinity')
      or p_lat2 in ('NaN', 'Infinity', '-Infinity') or p_lng2 in ('NaN', 'Infinity', '-Infinity') then null
    else round((2 * 6371.0088 * asin(least(1::float8, sqrt(
           power(sin(radians((p_lat2 - p_lat1)::float8) / 2), 2)
           + cos(radians(p_lat1::float8)) * cos(radians(p_lat2::float8))
             * power(sin(radians((p_lng2 - p_lng1)::float8) / 2), 2)))))::numeric, 6)
  end
$$;

-- Texto para comparar ciudades: sin tildes, en minúsculas y con los espacios normalizados. NULL si no queda nada.
create or replace function public._ship_norm(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$ select nullif(regexp_replace(lower(public.f_unaccent(btrim(p_text))), '\s+', ' ', 'g'), '') $$;

-- ¿Los parámetros de una regla tienen la forma de su tipo? (se usa en un CHECK: nunca lanza, devuelve false)
--   flat:     {"cost": n}
--   distance: {"tiers": [{"up_to_km": n, "cost": n}, …], "extra_per_km"?: n, "min_cost"?: n, "max_cost"?: n}
create or replace function public._ship_params_valid(p_kind text, p_params jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_tier jsonb;
  v_prev numeric := 0;
  v_up numeric;
  v_cost numeric;
  v_n int;
  v_min numeric;
  v_max numeric;
begin
  if p_params is null or jsonb_typeof(p_params) is distinct from 'object' then
    return false;
  end if;
  if p_kind = 'flat' then
    if (p_params - 'cost') <> '{}'::jsonb or jsonb_typeof(p_params -> 'cost') is distinct from 'number' then
      return false;
    end if;
    v_cost := (p_params ->> 'cost')::numeric;
    return v_cost >= 0 and v_cost < 1000000;
  elsif p_kind = 'distance' then
    if (p_params - 'tiers' - 'extra_per_km' - 'min_cost' - 'max_cost') <> '{}'::jsonb
       or jsonb_typeof(p_params -> 'tiers') is distinct from 'array' then
      return false;
    end if;
    v_n := jsonb_array_length(p_params -> 'tiers');
    if v_n < 1 or v_n > 20 then
      return false;
    end if;
    for v_tier in select value from jsonb_array_elements(p_params -> 'tiers') loop
      if jsonb_typeof(v_tier) is distinct from 'object' or (v_tier - 'up_to_km' - 'cost') <> '{}'::jsonb
         or jsonb_typeof(v_tier -> 'up_to_km') is distinct from 'number'
         or jsonb_typeof(v_tier -> 'cost') is distinct from 'number' then
        return false;
      end if;
      v_up := (v_tier ->> 'up_to_km')::numeric;
      v_cost := (v_tier ->> 'cost')::numeric;
      -- Los tramos se declaran en orden estricto (cada «hasta» mayor que el anterior).
      if v_up <= v_prev or v_up > 20000 or v_cost < 0 or v_cost >= 1000000 then
        return false;
      end if;
      v_prev := v_up;
    end loop;
    if p_params ? 'extra_per_km' then
      if jsonb_typeof(p_params -> 'extra_per_km') is distinct from 'number'
         or (p_params ->> 'extra_per_km')::numeric < 0 or (p_params ->> 'extra_per_km')::numeric >= 1000000 then
        return false;
      end if;
    end if;
    if p_params ? 'min_cost' then
      if jsonb_typeof(p_params -> 'min_cost') is distinct from 'number'
         or (p_params ->> 'min_cost')::numeric < 0 or (p_params ->> 'min_cost')::numeric >= 1000000 then
        return false;
      end if;
      v_min := (p_params ->> 'min_cost')::numeric;
    end if;
    if p_params ? 'max_cost' then
      if jsonb_typeof(p_params -> 'max_cost') is distinct from 'number'
         or (p_params ->> 'max_cost')::numeric < 0 or (p_params ->> 'max_cost')::numeric >= 1000000 then
        return false;
      end if;
      v_max := (p_params ->> 'max_cost')::numeric;
    end if;
    return v_min is null or v_max is null or v_min <= v_max;
  end if;
  return false;
exception when others then
  return false;
end;
$$;

-- Superficie mínima: `haversine_km` y `_ship_norm` solo las usan funciones SECURITY DEFINER (corren con el dueño), así que
-- nadie más las ejecuta. `_ship_params_valid` la evalúa el CHECK de `shipping_rate_rules` con los permisos de QUIEN INSERTA:
-- el admin (authenticated) y las pruebas/servidor (service_role).
revoke all on function public.haversine_km(numeric, numeric, numeric, numeric), public._ship_norm(text),
  public._ship_params_valid(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public._ship_params_valid(text, jsonb) to authenticated, service_role;

-- ── 3. Tablas ───────────────────────────────────────────────────────────────────────────────
-- 3.1 Ubicaciones de la tienda (el origen del cálculo y los puntos de recojo)
create table if not exists public.store_locations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  address_text text not null check (char_length(btrim(address_text)) between 1 and 200),
  city         text not null check (char_length(btrim(city)) between 1 and 80),
  lat          numeric(9, 6) not null check (lat between -90 and 90),
  lng          numeric(9, 6) not null check (lng between -180 and 180),
  pickup_hours text check (pickup_hours is null or char_length(btrim(pickup_hours)) between 1 and 300),
  is_primary   boolean not null default false,
  is_active    boolean not null default true,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- El origen del cálculo tiene que estar activo y no archivado.
  constraint store_locations_primary_live check (not is_primary or (is_active and archived_at is null))
);
create unique index if not exists store_locations_one_primary on public.store_locations ((true)) where is_primary;
drop trigger if exists store_locations_set_updated_at on public.store_locations;
create trigger store_locations_set_updated_at before update on public.store_locations
  for each row execute function public.set_updated_at();
-- `is_primary` NO se escribe directamente (cambiarlo exige soltar el anterior y marcar el nuevo en un solo paso): ver
-- `admin_set_primary_location`.
select public._apply_admin_rls('store_locations',
  array['name', 'address_text', 'city', 'lat', 'lng', 'pickup_hours', 'is_active'],
  array['name', 'address_text', 'city', 'lat', 'lng', 'pickup_hours', 'is_active', 'archived_at']);

-- 3.2 Métodos de envío (domicilio o recojo); preparados para varios transportistas
create table if not exists public.shipping_methods (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique check (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  name                text not null check (char_length(btrim(name)) between 1 and 80),
  kind                text not null check (kind in ('delivery', 'pickup')),
  description         text check (description is null or char_length(btrim(description)) between 1 and 300),
  eta_min_days        int check (eta_min_days between 0 and 90),
  eta_max_days        int check (eta_max_days between 0 and 90),
  pickup_location_id  uuid references public.store_locations (id) on delete restrict,
  is_active           boolean not null default true,
  sort_order          int not null default 0,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint shipping_methods_eta check (eta_min_days is null or eta_max_days is null or eta_min_days <= eta_max_days),
  -- El recojo apunta a una ubicación; el domicilio no.
  constraint shipping_methods_pickup_location check ((kind = 'pickup') = (pickup_location_id is not null))
);
drop trigger if exists shipping_methods_set_updated_at on public.shipping_methods;
create trigger shipping_methods_set_updated_at before update on public.shipping_methods
  for each row execute function public.set_updated_at();
select public._apply_admin_rls('shipping_methods',
  array['code', 'name', 'kind', 'description', 'eta_min_days', 'eta_max_days', 'pickup_location_id', 'is_active', 'sort_order'],
  array['name', 'description', 'eta_min_days', 'eta_max_days', 'pickup_location_id', 'is_active', 'sort_order', 'archived_at']);
-- El método base del negocio (domicilio). No es un dato del dueño: sin él no habría dónde colgar las tarifas.
insert into public.shipping_methods (code, name, kind, description)
values ('delivery', 'Entrega a domicilio', 'delivery', null)
on conflict (code) do nothing;

-- 3.3 Zonas de cobertura: por ciudad (lista blanca) o por radio; las NO permitidas bloquean
create table if not exists public.shipping_zones (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  kind        text not null check (kind in ('city', 'radius')),
  cities      text[],
  center_lat  numeric(9, 6) check (center_lat between -90 and 90),
  center_lng  numeric(9, 6) check (center_lng between -180 and 180),
  radius_km   numeric(8, 2) check (radius_km > 0 and radius_km <= 20000),
  allowed     boolean not null default true,
  is_active   boolean not null default true,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint shipping_zones_city_shape check (
    kind <> 'city' or (cities is not null and cardinality(cities) between 1 and 200
                       and center_lat is null and center_lng is null and radius_km is null)),
  constraint shipping_zones_radius_shape check (
    kind <> 'radius' or (cities is null and center_lat is not null and center_lng is not null and radius_km is not null))
);
drop trigger if exists shipping_zones_set_updated_at on public.shipping_zones;
create trigger shipping_zones_set_updated_at before update on public.shipping_zones
  for each row execute function public.set_updated_at();
select public._apply_admin_rls('shipping_zones',
  array['name', 'kind', 'cities', 'center_lat', 'center_lng', 'radius_km', 'allowed', 'is_active'],
  array['name', 'cities', 'center_lat', 'center_lng', 'radius_km', 'allowed', 'is_active', 'archived_at']);

-- 3.4 Reglas de tarifa
create table if not exists public.shipping_rate_rules (
  id               uuid primary key default gen_random_uuid(),
  method_id        uuid not null references public.shipping_methods (id) on delete restrict,
  zone_id          uuid references public.shipping_zones (id) on delete restrict,
  name             text not null check (char_length(btrim(name)) between 1 and 80),
  kind             text not null check (kind in ('distance', 'flat')),
  params           jsonb not null,
  min_order_amount numeric(14, 4) check (min_order_amount >= 0),
  max_order_amount numeric(14, 4) check (max_order_amount >= 0),
  currency         text not null default 'BOB' references public.currencies (code),
  priority         int not null default 100 check (priority between 0 and 100000),
  is_active        boolean not null default true,
  valid_from       timestamptz,
  valid_until      timestamptz,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint shipping_rate_rules_params check (public._ship_params_valid(kind, params)),
  constraint shipping_rate_rules_amounts check (
    min_order_amount is null or max_order_amount is null or min_order_amount <= max_order_amount),
  constraint shipping_rate_rules_window check (valid_from is null or valid_until is null or valid_until > valid_from)
);
create index if not exists shipping_rate_rules_method_idx on public.shipping_rate_rules (method_id) where archived_at is null;
drop trigger if exists shipping_rate_rules_set_updated_at on public.shipping_rate_rules;
create trigger shipping_rate_rules_set_updated_at before update on public.shipping_rate_rules
  for each row execute function public.set_updated_at();
select public._apply_admin_rls('shipping_rate_rules',
  array['method_id', 'zone_id', 'name', 'kind', 'params', 'min_order_amount', 'max_order_amount', 'currency', 'priority',
        'is_active', 'valid_from', 'valid_until'],
  array['zone_id', 'name', 'params', 'min_order_amount', 'max_order_amount', 'priority', 'is_active', 'valid_from',
        'valid_until', 'archived_at']);

-- 3.5 Franjas de entrega, fechas bloqueadas y reservas de cupo
create table if not exists public.delivery_slots (
  id          uuid primary key default gen_random_uuid(),
  method_id   uuid not null references public.shipping_methods (id) on delete restrict,
  weekday     smallint not null check (weekday between 1 and 7),          -- ISO: 1 = lunes … 7 = domingo
  start_time  time not null,
  end_time    time not null,
  capacity    int not null check (capacity between 1 and 1000),
  is_active   boolean not null default true,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint delivery_slots_order check (end_time > start_time)
);
create unique index if not exists delivery_slots_unique_start
  on public.delivery_slots (method_id, weekday, start_time) where archived_at is null;
drop trigger if exists delivery_slots_set_updated_at on public.delivery_slots;
create trigger delivery_slots_set_updated_at before update on public.delivery_slots
  for each row execute function public.set_updated_at();
select public._apply_admin_rls('delivery_slots',
  array['method_id', 'weekday', 'start_time', 'end_time', 'capacity', 'is_active'],
  array['start_time', 'end_time', 'capacity', 'is_active', 'archived_at']);

create table if not exists public.blocked_dates (
  id          uuid primary key default gen_random_uuid(),
  blocked_on  date not null,
  reason      text check (reason is null or char_length(btrim(reason)) between 1 and 120),
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists blocked_dates_unique_day on public.blocked_dates (blocked_on) where archived_at is null;
drop trigger if exists blocked_dates_set_updated_at on public.blocked_dates;
create trigger blocked_dates_set_updated_at before update on public.blocked_dates
  for each row execute function public.set_updated_at();
select public._apply_admin_rls('blocked_dates', array['blocked_on', 'reason'], array['reason', 'archived_at']);

-- Reservas de cupo: solo las crea/libera el servidor (`reserve_delivery_slot` / `release_delivery_slot`); el admin las LEE.
create table if not exists public.delivery_bookings (
  id            uuid primary key default gen_random_uuid(),
  slot_id       uuid not null references public.delivery_slots (id) on delete restrict,
  delivery_date date not null,
  owner_type    text not null check (owner_type in ('order', 'cart', 'manual')),
  owner_id      uuid not null,
  status        text not null default 'active' check (status in ('active', 'released')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists delivery_bookings_owner_key
  on public.delivery_bookings (slot_id, delivery_date, owner_type, owner_id) where status = 'active';
create index if not exists delivery_bookings_slot_day_idx
  on public.delivery_bookings (slot_id, delivery_date) where status = 'active';
drop trigger if exists delivery_bookings_set_updated_at on public.delivery_bookings;
create trigger delivery_bookings_set_updated_at before update on public.delivery_bookings
  for each row execute function public.set_updated_at();
select public._apply_admin_rls('delivery_bookings', null, null);
revoke insert, update on public.delivery_bookings from service_role;   -- solo las funciones (dueño) escriben aquí

-- Auditoría (BR-ADM-03)
do $$
declare t text;
begin
  foreach t in array array['store_locations', 'shipping_methods', 'shipping_zones', 'shipping_rate_rules', 'delivery_slots',
                           'blocked_dates']
  loop
    execute format('drop trigger if exists %I on public.%I', 'audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I
                      for each row execute function public.audit_changes()', 'audit_' || t, t);
  end loop;
end $$;

-- ── 4. Admin: cambiar el origen del cálculo ─────────────────────────────────────────────────
create or replace function public.admin_set_primary_location(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  perform 1 from public.store_locations where id = p_id and is_active and archived_at is null for update;
  if not found then
    raise exception 'ubicación inexistente, inactiva o archivada' using errcode = 'P0002';
  end if;
  update public.store_locations set is_primary = false where is_primary and id <> p_id;
  update public.store_locations set is_primary = true where id = p_id and not is_primary;
end;
$$;

-- ── 5. Lectura: franjas disponibles y cotización ────────────────────────────────────────────
-- ¿Se puede entregar en esa franja ese día? (calendario, antelación, fecha bloqueada); NO mira el cupo.
-- `p_now` existe para PROBAR el calendario con relojes fijos (zona horaria, medianoche, antelación exacta); la función es
-- interna (nadie del navegador ni service_role la ejecuta), y todo el que la llama usa el valor por omisión: `now()`.
create or replace function public._ship_slot_ok(p_slot_id uuid, p_day date, p_now timestamptz default now())
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slot record;
  v_now timestamptz := p_now;
  v_today date := (p_now at time zone 'America/La_Paz')::date;
begin
  select * into v_slot from public.delivery_slots where id = p_slot_id and is_active and archived_at is null;
  if not found then
    return 'slot_not_found';
  end if;
  if extract(isodow from p_day)::int <> v_slot.weekday then
    return 'slot_mismatch';
  end if;
  if p_day < v_today then
    return 'date_past';
  end if;
  if exists (select 1 from public.blocked_dates b where b.blocked_on = p_day and b.archived_at is null) then
    return 'date_blocked';
  end if;
  if p_day > v_today + public.setting_int('delivery_max_days_ahead', 30) then
    return 'date_too_far';
  end if;
  if ((p_day + v_slot.start_time) at time zone 'America/La_Paz')
       < v_now + make_interval(hours => public.setting_int('delivery_min_lead_hours', 24)) then
    return 'date_too_soon';
  end if;
  return 'ok';
end;
$$;

-- Franjas de un método en los próximos `p_days` días a partir de `p_from`, con su cupo restante. Solo las que cumplen
-- calendario, antelación y fechas bloqueadas; las llenas salen con `available: false` (la pantalla las muestra tachadas).
create or replace function public._ship_slots(p_method_id uuid, p_from date, p_days int)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'slot_id', q.slot_id, 'date', q.day, 'start', to_char(q.start_time, 'HH24:MI'), 'end', to_char(q.end_time, 'HH24:MI'),
           'capacity', q.capacity, 'remaining', q.remaining, 'available', q.remaining > 0)
         order by q.day, q.start_time, q.slot_id), '[]'::jsonb)
  from (
    select d.day, s.id as slot_id, s.start_time, s.end_time, s.capacity,
           greatest(s.capacity - coalesce((select count(*) from public.delivery_bookings bk
                                            where bk.slot_id = s.id and bk.delivery_date = d.day and bk.status = 'active'), 0), 0)
             as remaining
      from generate_series(p_from::timestamp, (p_from + (greatest(p_days, 1) - 1))::timestamp, interval '1 day') as g(i)
      cross join lateral (select g.i::date as day) d
      join public.delivery_slots s
        on s.method_id = p_method_id and s.is_active and s.archived_at is null
       and s.weekday = extract(isodow from d.day)::int
     where public._ship_slot_ok(s.id, d.day) = 'ok'
  ) q
$$;

create or replace function public.quote_shipping(
  p_method_code  text default 'delivery',
  p_lat          numeric default null,
  p_lng          numeric default null,
  p_city         text default null,
  p_order_amount numeric default 0,
  p_currency     text default 'BOB',
  p_delivery_date date default null,
  p_slot_id      uuid default null,
  p_list_days    int default 14
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_errors  jsonb := '[]'::jsonb;
  v_m       record;
  v_o       record;
  v_cur     record;
  v_amount  numeric := coalesce(p_order_amount, 0);
  v_factor  numeric := public.setting_int('shipping_route_factor_pct', 130) / 100.0;
  v_city    text := public._ship_norm(p_city);
  v_today   date := (now() at time zone 'America/La_Paz')::date;
  v_straight numeric;
  v_route   numeric;
  v_coords_ok boolean := false;
  v_blocked boolean;
  v_allowed_n int;
  v_zones   uuid[] := '{}';
  r         record;
  t         record;
  v_cost    numeric;
  v_breakdown jsonb;
  v_tier    int;
  v_last_up numeric;
  v_last_cost numeric;
  v_extra_km numeric;
  v_min     numeric;
  v_max     numeric;
  v_min_hit boolean;
  v_max_hit boolean;
  v_slots   jsonb := '[]'::jsonb;
  v_has_slots boolean;
  v_selected jsonb;
  v_chk     text;
  v_slot    record;
  v_used    int;
  v_method  jsonb;
begin
  select * into v_m from public.shipping_methods where code = p_method_code and archived_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'cost', null, 'errors',
      jsonb_build_array(jsonb_build_object('code', 'method_not_found', 'field', 'method')));
  end if;
  v_method := jsonb_build_object('code', v_m.code, 'name', v_m.name, 'kind', v_m.kind, 'description', v_m.description,
                                 'eta_min_days', v_m.eta_min_days, 'eta_max_days', v_m.eta_max_days);
  select * into v_cur from public.currencies where code = p_currency and enabled;
  if not found then
    return jsonb_build_object('ok', false, 'cost', null, 'method', v_method, 'errors',
      jsonb_build_array(jsonb_build_object('code', 'currency_unsupported', 'field', 'currency')));
  end if;
  if v_amount in ('NaN', 'Infinity', '-Infinity') or v_amount < 0 or v_amount > 1000000000000 then
    return jsonb_build_object('ok', false, 'cost', null, 'method', v_method, 'errors',
      jsonb_build_array(jsonb_build_object('code', 'invalid_order_amount', 'field', 'amount')));
  end if;
  if not v_m.is_active then
    return jsonb_build_object('ok', false, 'cost', null, 'method', v_method, 'errors',
      jsonb_build_array(jsonb_build_object('code', 'method_inactive', 'field', 'method')));
  end if;

  -- ── Recojo en tienda: sin dirección y sin costo ──
  if v_m.kind = 'pickup' then
    select * into v_o from public.store_locations where id = v_m.pickup_location_id and is_active and archived_at is null;
    if not found then
      return jsonb_build_object('ok', false, 'cost', null, 'method', v_method, 'errors',
        jsonb_build_array(jsonb_build_object('code', 'no_origin', 'field', 'method')));
    end if;
    return jsonb_build_object('ok', true, 'cost', round(0::numeric, v_cur.decimals), 'currency', p_currency, 'method', v_method,
      'pickup', jsonb_build_object('name', v_o.name, 'address', v_o.address_text, 'city', v_o.city, 'lat', v_o.lat,
                                   'lng', v_o.lng, 'hours', v_o.pickup_hours),
      'breakdown', jsonb_build_object('kind', 'pickup'), 'slots', '[]'::jsonb, 'errors', '[]'::jsonb);
  end if;

  -- ── Entrega a domicilio ──
  select * into v_o from public.store_locations where is_primary and is_active and archived_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'cost', null, 'method', v_method, 'errors',
      jsonb_build_array(jsonb_build_object('code', 'no_origin', 'field', 'system')));
  end if;

  if p_lat is null or p_lng is null then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'location_required', 'field', 'location'));
  elsif p_lat in ('NaN', 'Infinity', '-Infinity') or p_lng in ('NaN', 'Infinity', '-Infinity')
        or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'invalid_coordinates', 'field', 'location'));
  else
    v_coords_ok := true;
    v_straight := public.haversine_km(v_o.lat, v_o.lng, p_lat, p_lng);
    v_route := v_straight * v_factor;
  end if;

  v_cost := null;
  if v_coords_ok then
    -- Cobertura: una zona NO permitida que contiene el destino bloquea siempre.
    select exists (
      select 1 from public.shipping_zones z
       where z.is_active and z.archived_at is null and not z.allowed
         and ((z.kind = 'city' and v_city is not null and exists (
                 select 1 from unnest(z.cities) c where public._ship_norm(c) = v_city))
              or (z.kind = 'radius' and public.haversine_km(p_lat, p_lng, z.center_lat, z.center_lng) <= z.radius_km))
    ) into v_blocked;
    select count(*) into v_allowed_n from public.shipping_zones z where z.is_active and z.archived_at is null and z.allowed;
    select coalesce(array_agg(z.id), '{}') into v_zones
      from public.shipping_zones z
     where z.is_active and z.archived_at is null and z.allowed
       and ((z.kind = 'city' and v_city is not null and exists (
               select 1 from unnest(z.cities) c where public._ship_norm(c) = v_city))
            or (z.kind = 'radius' and public.haversine_km(p_lat, p_lng, z.center_lat, z.center_lng) <= z.radius_km));
    if v_blocked then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'blocked_zone', 'field', 'location'));
    elsif v_allowed_n = 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'coverage_not_configured', 'field', 'system'));
    elsif cardinality(v_zones) = 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'out_of_coverage', 'field', 'location'));
    else
      -- Tarifa: primera regla aplicable por prioridad (mayor primero), luego la que tiene zona, luego el id.
      for r in
        select rr.* from public.shipping_rate_rules rr
         where rr.method_id = v_m.id and rr.is_active and rr.archived_at is null and rr.currency = p_currency
           and (rr.valid_from is null or rr.valid_from <= now()) and (rr.valid_until is null or rr.valid_until > now())
           and (rr.min_order_amount is null or v_amount >= rr.min_order_amount)
           and (rr.max_order_amount is null or v_amount <= rr.max_order_amount)
           and (rr.zone_id is null or rr.zone_id = any (v_zones))
         order by rr.priority desc, (rr.zone_id is not null) desc, rr.id
      loop
        v_tier := null; v_extra_km := null; v_min_hit := false; v_max_hit := false;
        if r.kind = 'flat' then
          v_cost := (r.params ->> 'cost')::numeric;
        else
          v_cost := null;
          for t in select (e.ordinality)::int as idx, (e.value ->> 'up_to_km')::numeric as up_to, (e.value ->> 'cost')::numeric as cost
                     from jsonb_array_elements(r.params -> 'tiers') with ordinality as e(value, ordinality)
                    order by e.ordinality
          loop
            v_last_up := t.up_to;
            v_last_cost := t.cost;
            -- Borde superior INCLUSIVO: justo en el límite pertenece al tramo que termina ahí.
            if v_cost is null and v_route <= t.up_to then
              v_cost := t.cost;
              v_tier := t.idx;
            end if;
          end loop;
          if v_cost is null and coalesce((r.params ->> 'extra_per_km')::numeric, 0) > 0 then
            v_extra_km := v_route - v_last_up;
            v_cost := v_last_cost + v_extra_km * (r.params ->> 'extra_per_km')::numeric;
          end if;
          if v_cost is not null then
            v_min := (r.params ->> 'min_cost')::numeric;
            v_max := (r.params ->> 'max_cost')::numeric;
            if v_min is not null and v_cost < v_min then v_cost := v_min; v_min_hit := true; end if;
            if v_max is not null and v_cost > v_max then v_cost := v_max; v_max_hit := true; end if;
          end if;
        end if;
        if v_cost is not null then
          v_breakdown := jsonb_build_object(
            'rule', jsonb_build_object('id', r.id, 'name', r.name, 'kind', r.kind, 'priority', r.priority),
            'straight_km', round(v_straight, 2), 'route_km', round(v_route, 2), 'route_factor', v_factor,
            'tier', v_tier, 'extra_km', case when v_extra_km is null then null else round(v_extra_km, 2) end,
            'min_applied', v_min_hit, 'max_applied', v_max_hit, 'zones', to_jsonb(v_zones));
          exit;
        end if;
      end loop;
      if v_cost is null then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'no_rate', 'field', 'location'));
      else
        v_cost := round(v_cost, v_cur.decimals);
      end if;
    end if;
  end if;

  -- ── Franjas y fecha elegida ──
  -- Solo se listan franjas si el destino y la tarifa son válidos (hasta ~1 200 consultas por cotización con 31 días y 10
  -- franjas: no se gastan en una petición que ya falló por cobertura, tarifa o método). Los errores de FECHA o de franja,
  -- que se agregan abajo, sí conservan la lista para que la pantalla ofrezca alternativas.
  v_slots := case when jsonb_array_length(v_errors) = 0
                  then public._ship_slots(v_m.id, v_today, least(greatest(coalesce(p_list_days, 14), 1), 31))
                  else '[]'::jsonb end;
  select exists (select 1 from public.delivery_slots s where s.method_id = v_m.id and s.is_active and s.archived_at is null)
    into v_has_slots;
  if p_delivery_date is null and p_slot_id is not null then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'date_required', 'field', 'date'));
  elsif p_delivery_date is not null then
    if p_slot_id is null and v_has_slots then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'slot_required', 'field', 'slot'));
    elsif p_slot_id is not null then
      v_chk := public._ship_slot_ok(p_slot_id, p_delivery_date);
      select * into v_slot from public.delivery_slots where id = p_slot_id;
      if v_chk = 'ok' and v_slot.method_id <> v_m.id then
        v_chk := 'slot_mismatch';
      end if;
      if v_chk = 'ok' then
        select count(*) into v_used from public.delivery_bookings
         where slot_id = p_slot_id and delivery_date = p_delivery_date and status = 'active';
        if v_used >= v_slot.capacity then
          v_chk := 'slot_full';
        end if;
      end if;
      if v_chk <> 'ok' then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', v_chk,
          'field', case when v_chk in ('date_past', 'date_blocked', 'date_too_far', 'date_too_soon') then 'date' else 'slot' end));
      else
        v_selected := jsonb_build_object('date', p_delivery_date, 'slot_id', p_slot_id,
          'start', to_char(v_slot.start_time, 'HH24:MI'), 'end', to_char(v_slot.end_time, 'HH24:MI'));
      end if;
    else
      -- Sin franjas configuradas: solo se valida la fecha (hoy, bloqueada, antelación y tope).
      if p_delivery_date < v_today then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'date_past', 'field', 'date'));
      elsif exists (select 1 from public.blocked_dates b where b.blocked_on = p_delivery_date and b.archived_at is null) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'date_blocked', 'field', 'date'));
      elsif p_delivery_date > v_today + public.setting_int('delivery_max_days_ahead', 30) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'date_too_far', 'field', 'date'));
      elsif p_delivery_date < ((now() + make_interval(hours => public.setting_int('delivery_min_lead_hours', 24)))
                               at time zone 'America/La_Paz')::date then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'date_too_soon', 'field', 'date'));
      else
        v_selected := jsonb_build_object('date', p_delivery_date, 'slot_id', null, 'start', null, 'end', null);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_errors) = 0,
    'cost', case when jsonb_array_length(v_errors) = 0 then v_cost else null end,
    'currency', p_currency,
    'method', v_method,
    'distance_km', case when v_coords_ok then round(v_route, 2) else null end,
    'breakdown', coalesce(v_breakdown, '{}'::jsonb),
    'slots', v_slots,
    'selected', v_selected,
    'errors', v_errors);
end;
$$;

-- ── 6. Reservar / liberar cupo (solo el servidor, al crear/cancelar el pedido: S10) ─────────
create or replace function public.reserve_delivery_slot(p_slot_id uuid, p_day date, p_owner_type text, p_owner_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot record;
  v_chk text;
  v_used int;
begin
  if p_owner_type is null or p_owner_type not in ('order', 'cart', 'manual') or p_owner_id is null or p_day is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  -- El candado de la FILA de la franja serializa a quienes reservan el mismo cupo: nadie cuenta a la vez que otro inserta.
  select * into v_slot from public.delivery_slots where id = p_slot_id for update;
  if not found then
    return jsonb_build_object('status', 'unavailable', 'reason', 'slot_not_found');
  end if;
  v_chk := public._ship_slot_ok(p_slot_id, p_day);
  if v_chk <> 'ok' then
    return jsonb_build_object('status', 'unavailable', 'reason', v_chk);
  end if;
  select count(*) into v_used from public.delivery_bookings
   where slot_id = p_slot_id and delivery_date = p_day and status = 'active';
  if exists (select 1 from public.delivery_bookings
              where slot_id = p_slot_id and delivery_date = p_day and owner_type = p_owner_type and owner_id = p_owner_id
                and status = 'active') then
    return jsonb_build_object('status', 'already', 'remaining', v_slot.capacity - v_used);
  end if;
  if v_used >= v_slot.capacity then
    return jsonb_build_object('status', 'full', 'remaining', 0);
  end if;
  insert into public.delivery_bookings (slot_id, delivery_date, owner_type, owner_id)
  values (p_slot_id, p_day, p_owner_type, p_owner_id);
  return jsonb_build_object('status', 'reserved', 'remaining', v_slot.capacity - v_used - 1);
end;
$$;

create or replace function public.release_delivery_slot(p_owner_type text, p_owner_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  update public.delivery_bookings set status = 'released'
   where owner_type = p_owner_type and owner_id = p_owner_id and status = 'active';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ── 7. Permisos ─────────────────────────────────────────────────────────────────────────────
-- `pg_default_acl` da EXECUTE a `service_role` en toda función nueva: las internas se le quitan.
revoke all on function public._ship_slot_ok(uuid, date, timestamptz), public._ship_slots(uuid, date, int),
  public.admin_set_primary_location(uuid),
  public.quote_shipping(text, numeric, numeric, text, numeric, text, date, uuid, int),
  public.reserve_delivery_slot(uuid, date, text, uuid), public.release_delivery_slot(text, uuid),
  public.store_settings_validate_s8()
  from public, anon, authenticated, service_role;
-- Cotizar es una lectura pública (el visitante ve cuánto cuesta el envío antes de tener cuenta); lo que devuelve sale de
-- cálculos, no de las tablas.
grant execute on function public.quote_shipping(text, numeric, numeric, text, numeric, text, date, uuid, int)
  to anon, authenticated, service_role;
grant execute on function public.admin_set_primary_location(uuid) to authenticated;
grant execute on function public.reserve_delivery_slot(uuid, date, text, uuid), public.release_delivery_slot(text, uuid)
  to service_role;

-- ── 8. Vista pública de métodos de envío ──────────────────────────────────────────────────
-- Lo que el visitante puede ver de los métodos: activos y no archivados; el recojo solo si su ubicación está activa.
-- NUNCA expone coordenadas (el origen del cálculo puede ser un domicilio): solo nombre, dirección en texto, ciudad y horario.
-- Sin ORDER BY: el orden de una vista no es un contrato; quien la consulta ordena por `sort_order`.
create or replace view public.public_shipping_methods as
select m.id, m.code, m.name, m.kind, m.description, m.eta_min_days, m.eta_max_days, m.sort_order,
       l.name as pickup_name, l.address_text as pickup_address, l.city as pickup_city, l.pickup_hours
  from public.shipping_methods m
  left join public.store_locations l on l.id = m.pickup_location_id
 where m.is_active and m.archived_at is null
   and (m.kind = 'delivery' or (l.is_active and l.archived_at is null));
revoke all on public.public_shipping_methods from public;
grant select on public.public_shipping_methods to anon, authenticated;
