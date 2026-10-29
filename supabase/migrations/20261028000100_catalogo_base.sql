-- Sprint 2 · Base del catálogo: utilidades, monedas/países, tipo de cambio, ajustes de la tienda,
-- banner de noticias, categorías y colecciones.
--
-- Modelo de acceso (decisión de S2, ver Sprints/SPRINT_02):
--   · anon NO tiene privilegios sobre NINGUNA tabla: todo lo público se lee por vistas `public_*`.
--   · El admin escribe con INSERT/UPDATE (por columnas) bajo RLS `is_admin()`.
--   · NADIE (ni authenticated ni service_role) puede DELETE/TRUNCATE tablas de catálogo (BR-CAT-03, BR-DAT-01).
--
-- Rollback (manual, orden inverso): drop table public.collections, public.categories, public.news_banners,
--   public.store_settings, public.exchange_rates, public.countries, public.currencies cascade;
--   drop function public._apply_admin_rls(text, text[], text[]), public.is_safe_link(text), public.slugify(text),
--   public.f_unaccent(text), public.immutable_row(), public.setting_int(text, int);

-- ── Utilidades puras ───────────────────────────────────────────────────────────────────────
-- unaccent no es IMMUTABLE y por eso no se puede usar en un índice; este envoltorio sí (el diccionario no cambia).
create or replace function public.f_unaccent(p_text text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, p_text) $$;

-- "Camiseta Ñandú — Edición 2027" → "camiseta-nandu-edicion-2027". Devuelve '' si no queda nada alfanumérico.
create or replace function public.slugify(p_text text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select btrim(
    regexp_replace(regexp_replace(lower(public.f_unaccent(p_text)), '[^a-z0-9]+', '-', 'g'), '-{2,}', '-', 'g'),
    '-')
$$;

-- Enlaces permitidos en contenido editable: ruta interna ("/x") o https. Rechaza "javascript:", "http:",
-- "//host" y "/\host" (redirección abierta / XSS por enlace).
create or replace function public.is_safe_link(p_url text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_url is null
      or (char_length(p_url) <= 2048
          and (p_url ~ '^/([^/\\[:space:]][^[:space:]]*)?$' or p_url ~ '^https://[^[:space:]]+$'))
$$;

-- Tablas inmutables (libros mayores): cualquier UPDATE/DELETE/TRUNCATE falla.
create or replace function public.immutable_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'la tabla % es un registro inmutable', tg_table_name using errcode = '42501';
end;
$$;

-- Los helpers puros se usan en CHECK/índices que ejecuta quien escribe (admin o service_role): sin EXECUTE
-- explícito fallarían, porque los privilegios por defecto de funciones están revocados (S1).
revoke all on function public.f_unaccent(text), public.slugify(text), public.is_safe_link(text) from public;
grant execute on function public.f_unaccent(text), public.slugify(text), public.is_safe_link(text)
  to authenticated, service_role;

-- ── Plantilla de seguridad por tabla ───────────────────────────────────────────────────────
-- Aplica el modelo de acceso a una tabla de `public`: RLS activa, sin acceso para anon, el admin lee todo y
-- escribe SOLO las columnas indicadas, y nadie borra. Idempotente. Reutilizable por sprints futuros.
--   p_insert_cols: columnas que el admin puede fijar al insertar (NULL = no puede insertar)
--   p_update_cols: columnas que el admin puede modificar (NULL = no puede actualizar)
create or replace function public._apply_admin_rls(p_table text, p_insert_cols text[], p_update_cols text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_t text := format('public.%I', p_table);
begin
  execute format('alter table %s enable row level security', v_t);
  execute format('revoke all on %s from public, anon, authenticated', v_t);
  execute format('revoke delete, truncate on %s from service_role', v_t);
  execute format('grant select on %s to authenticated', v_t);

  execute format('drop policy if exists %I on %s', p_table || '_admin_select', v_t);
  execute format('create policy %I on %s for select to authenticated using (public.is_admin())',
                 p_table || '_admin_select', v_t);

  execute format('drop policy if exists %I on %s', p_table || '_admin_insert', v_t);
  if p_insert_cols is not null then
    execute format('grant insert (%s) on %s to authenticated',
                   (select string_agg(quote_ident(c), ', ') from unnest(p_insert_cols) c), v_t);
    execute format('create policy %I on %s for insert to authenticated with check (public.is_admin())',
                   p_table || '_admin_insert', v_t);
  end if;

  execute format('drop policy if exists %I on %s', p_table || '_admin_update', v_t);
  if p_update_cols is not null then
    execute format('grant update (%s) on %s to authenticated',
                   (select string_agg(quote_ident(c), ', ') from unnest(p_update_cols) c), v_t);
    execute format('create policy %I on %s for update to authenticated using (public.is_admin()) with check (public.is_admin())',
                   p_table || '_admin_update', v_t);
  end if;
end;
$$;
revoke all on function public._apply_admin_rls(text, text[], text[]) from public, anon, authenticated;

-- ── Monedas y países ───────────────────────────────────────────────────────────────────────
create table if not exists public.currencies (
  code       text primary key check (code ~ '^[A-Z]{3}$'),
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  symbol     text not null check (char_length(btrim(symbol)) between 1 and 6),
  decimals   smallint not null default 2 check (decimals between 0 and 4),
  enabled    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- MVP: la moneda base (BOB) nunca se deshabilita.
  constraint currencies_base_enabled check (code <> 'BOB' or enabled)
);

create table if not exists public.countries (
  code          text primary key check (code ~ '^[A-Z]{2}$'),
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  currency_code text not null references public.currencies (code),
  enabled       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint countries_base_enabled check (code <> 'BO' or enabled)
);

drop trigger if exists currencies_set_updated_at on public.currencies;
create trigger currencies_set_updated_at before update on public.currencies
  for each row execute function public.set_updated_at();
drop trigger if exists countries_set_updated_at on public.countries;
create trigger countries_set_updated_at before update on public.countries
  for each row execute function public.set_updated_at();

insert into public.currencies (code, name, symbol, decimals, enabled) values
  ('BOB', 'Boliviano', 'Bs', 2, true),
  ('ARS', 'Peso argentino', '$', 2, false),
  ('EUR', 'Euro', '€', 2, false),
  ('USD', 'Dólar estadounidense', 'US$', 2, false)
on conflict (code) do nothing;

insert into public.countries (code, name, currency_code, enabled) values
  ('BO', 'Bolivia', 'BOB', true),
  ('AR', 'Argentina', 'ARS', false),
  ('ES', 'España', 'EUR', false),
  ('US', 'Estados Unidos', 'USD', false)
on conflict (code) do nothing;

select public._apply_admin_rls('currencies', null, array['name', 'symbol', 'enabled']);
select public._apply_admin_rls('countries', null, array['name', 'enabled']);

-- ── Tipo de cambio (historial inmutable: un cambio = una fila nueva) ───────────────────────
-- `rate` = unidades de `to_currency` por 1 unidad de `from_currency` (p. ej. BOB→USD ≈ 0.1437).
-- La tasa vigente es la fila con mayor `valid_from <= now()`; `valid_from` futuro programa un cambio.
create table if not exists public.exchange_rates (
  id            bigint generated always as identity primary key,
  from_currency text not null default 'BOB' references public.currencies (code),
  to_currency   text not null references public.currencies (code),
  rate          numeric(18, 8) not null check (rate > 0),
  mode          text not null default 'fixed' check (mode in ('fixed', 'variable')),
  valid_from    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  constraint exchange_rates_distinct check (from_currency <> to_currency)
);
create index if not exists exchange_rates_lookup_idx
  on public.exchange_rates (from_currency, to_currency, valid_from desc, id desc);

drop trigger if exists exchange_rates_immutable on public.exchange_rates;
create trigger exchange_rates_immutable before update or delete on public.exchange_rates
  for each row execute function public.immutable_row();
drop trigger if exists exchange_rates_no_truncate on public.exchange_rates;
create trigger exchange_rates_no_truncate before truncate on public.exchange_rates
  for each statement execute function public.immutable_row();

select public._apply_admin_rls('exchange_rates', array['from_currency', 'to_currency', 'rate', 'mode', 'valid_from'], null);
-- El historial es de solo-inserción también para service_role.
revoke update on public.exchange_rates from service_role;

create or replace function public.current_rate(p_from text, p_to text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select r.rate
    from public.exchange_rates r
   where r.from_currency = p_from and r.to_currency = p_to and r.valid_from <= now()
   order by r.valid_from desc, r.id desc
   limit 1
$$;
revoke all on function public.current_rate(text, text) from public, anon, authenticated;

-- ── Ajustes de la tienda (clave/valor tipado) ──────────────────────────────────────────────
-- Las CLAVES las define el código (migraciones); el admin solo cambia `value`.
create table if not exists public.store_settings (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  value       jsonb not null,
  value_type  text not null check (value_type in ('text', 'int', 'bool', 'url', 'email', 'phone_e164')),
  is_public   boolean not null default false,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists store_settings_set_updated_at on public.store_settings;
create trigger store_settings_set_updated_at before update on public.store_settings
  for each row execute function public.set_updated_at();

create or replace function public.store_settings_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_text text := new.value #>> '{}';
  v_other int;
begin
  case new.value_type
    when 'text' then
      if jsonb_typeof(new.value) <> 'string' or char_length(v_text) > 4000 then
        raise exception 'el ajuste "%" debe ser un texto de hasta 4000 caracteres', new.key using errcode = '22023';
      end if;
    when 'int' then
      if jsonb_typeof(new.value) <> 'number' or v_text !~ '^[0-9]{1,9}$' then
        raise exception 'el ajuste "%" debe ser un número entero >= 0', new.key using errcode = '22023';
      end if;
    when 'bool' then
      if jsonb_typeof(new.value) <> 'boolean' then
        raise exception 'el ajuste "%" debe ser verdadero o falso', new.key using errcode = '22023';
      end if;
    when 'url' then
      if jsonb_typeof(new.value) <> 'string' or v_text !~ '^https://[^[:space:]]+$' or char_length(v_text) > 2048 then
        raise exception 'el ajuste "%" debe ser un enlace https', new.key using errcode = '22023';
      end if;
    when 'email' then
      if jsonb_typeof(new.value) <> 'string' or v_text <> lower(btrim(v_text))
         or v_text !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_text) > 254 then
        raise exception 'el ajuste "%" debe ser un correo válido en minúsculas', new.key using errcode = '22023';
      end if;
    when 'phone_e164' then
      if jsonb_typeof(new.value) <> 'string' or v_text !~ '^\+[1-9][0-9]{7,14}$' then
        raise exception 'el ajuste "%" debe ser un teléfono con código de país (E.164, p. ej. +59171234567)', new.key
          using errcode = '22023';
      end if;
  end case;

  -- Reglas por clave
  if new.key = 'reservation_ttl_minutes' and (v_text::int < 1 or v_text::int > 1440) then
    raise exception 'reservation_ttl_minutes debe estar entre 1 y 1440' using errcode = '22023';
  end if;
  if new.key = 'default_out_of_stock_behavior' and v_text not in ('sold_out', 'hide') then
    raise exception 'default_out_of_stock_behavior debe ser sold_out u hide' using errcode = '22023';
  end if;
  if new.key = 'stock_low_threshold' then
    select (s.value #>> '{}')::int into v_other from public.store_settings s where s.key = 'stock_critical_threshold';
    if v_other is not null and v_text::int < v_other then
      raise exception 'el umbral de aviso (%) no puede ser menor que el crítico (%)', v_text, v_other using errcode = '22023';
    end if;
  end if;
  if new.key = 'stock_critical_threshold' then
    select (s.value #>> '{}')::int into v_other from public.store_settings s where s.key = 'stock_low_threshold';
    if v_other is not null and v_text::int > v_other then
      raise exception 'el umbral crítico (%) no puede superar el de aviso (%)', v_text, v_other using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists store_settings_validate_trg on public.store_settings;
create trigger store_settings_validate_trg before insert or update on public.store_settings
  for each row execute function public.store_settings_validate();

-- Orden importa: el umbral de aviso se inserta antes que el crítico (la validación cruzada los compara).
insert into public.store_settings (key, value, value_type, is_public, description) values
  ('business_name', '"Made In Chola"', 'text', true, 'Nombre comercial'),
  ('base_currency', '"BOB"', 'text', true, 'Moneda base de la tienda (informativo en el MVP)'),
  ('stock_low_threshold', '5', 'int', false, 'Semáforo: stock <= este valor = amarillo (por defecto; cada variante puede tener el suyo)'),
  ('stock_critical_threshold', '2', 'int', false, 'Semáforo: stock <= este valor = rojo'),
  ('reservation_ttl_minutes', '10', 'int', false, 'Minutos que se retiene el stock de un carrito (BR-INV-02)'),
  ('default_out_of_stock_behavior', '"sold_out"', 'text', false, 'Criterio general para productos agotados: sold_out (visible) u hide (oculto)'),
  ('whatsapp_orders', '"+59167528677"', 'phone_e164', true, 'WhatsApp que recibe los pedidos'),
  ('contact_email', '"info@madeinchola.com"', 'email', true, 'Correo de contacto que ven los clientes'),
  ('contact_phone', '"+541140893614"', 'phone_e164', true, 'Teléfono de contacto que ven los clientes'),
  ('social_instagram', '"https://www.instagram.com/madeinchola/"', 'url', true, 'Instagram'),
  ('social_tiktok', '"https://www.tiktok.com/@madeinchola"', 'url', true, 'TikTok'),
  ('social_facebook', '"https://www.facebook.com/MIC.MADEINCHOLA"', 'url', true, 'Facebook'),
  ('social_youtube', '"https://www.youtube.com/@madeinchola9876"', 'url', true, 'YouTube'),
  ('pdp_shipping_return_text', '""', 'text', true, 'Texto del acordeón "Envíos y devoluciones" del detalle de producto (vacío = no se muestra)'),
  ('pdp_assistance_text', '""', 'text', true, 'Texto del acordeón "Asistencia" del detalle de producto (vacío = no se muestra)')
on conflict (key) do nothing;

-- El admin solo cambia el VALOR (no la clave, el tipo ni la visibilidad).
select public._apply_admin_rls('store_settings', null, array['value']);

-- Lectura de un entero con valor por defecto (uso interno en funciones/vistas del propietario).
create or replace function public.setting_int(p_key text, p_default int)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value #>> '{}')::int from public.store_settings s where s.key = p_key), p_default)
$$;
revoke all on function public.setting_int(text, int) from public, anon, authenticated;

-- ── Banner de noticias (BR-ADM-04) ─────────────────────────────────────────────────────────
create table if not exists public.news_banners (
  id          uuid primary key default gen_random_uuid(),
  message     text not null check (char_length(btrim(message)) between 1 and 200),
  link_url    text check (public.is_safe_link(link_url)),
  is_active   boolean not null default true,
  starts_at   timestamptz,
  ends_at     timestamptz,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint news_banners_window check (starts_at is null or ends_at is null or ends_at > starts_at)
);
drop trigger if exists news_banners_set_updated_at on public.news_banners;
create trigger news_banners_set_updated_at before update on public.news_banners
  for each row execute function public.set_updated_at();
select public._apply_admin_rls('news_banners',
  array['message', 'link_url', 'is_active', 'starts_at', 'ends_at'],
  array['message', 'link_url', 'is_active', 'starts_at', 'ends_at', 'archived_at']);

-- ── Categorías (jerárquicas) y colecciones ─────────────────────────────────────────────────
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references public.categories (id) on delete restrict,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  description text check (char_length(description) <= 1000),
  sort_order  int not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint categories_not_self_parent check (parent_id is null or parent_id <> id)
);
create index if not exists categories_parent_idx on public.categories (parent_id);

-- Evita ciclos (A→B→A) y archivar una categoría que aún tiene subcategorías activas.
create or replace function public.categories_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serializa los cambios del árbol: dos admins moviendo A→B y B→A a la vez pasarían ambos la detección de ciclos
  -- (cada uno ve el árbol sin el cambio del otro).
  perform pg_advisory_xact_lock(hashtextextended('public.categories.tree', 0));
  if new.parent_id is not null and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    if exists (
      with recursive up as (
        select c.id, c.parent_id from public.categories c where c.id = new.parent_id
        union
        select c.id, c.parent_id from public.categories c join up on c.id = up.parent_id
      )
      select 1 from up where up.id = new.id or up.parent_id = new.id
    ) then
      raise exception 'una categoría no puede ser descendiente de sí misma (ciclo)' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.archived_at is not null and old.archived_at is null
     and exists (select 1 from public.categories c where c.parent_id = new.id and c.archived_at is null) then
    raise exception 'no se puede archivar una categoría con subcategorías activas: archívalas o muévelas primero'
      using errcode = '23514';
  end if;
  -- Una categoría activa no puede colgar de un padre archivado (quedaría huérfana e inalcanzable en el menú):
  -- vale al crearla, al moverla y al desarchivarla.
  if new.archived_at is null and new.parent_id is not null
     and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id or old.archived_at is not null)
     and exists (select 1 from public.categories c where c.id = new.parent_id and c.archived_at is not null) then
    raise exception 'la categoría padre está archivada: desarchívala primero o elige otro padre' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists categories_guard_trg on public.categories;
create trigger categories_guard_trg before insert or update on public.categories
  for each row execute function public.categories_guard();
drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at before update on public.categories
  for each row execute function public.set_updated_at();
select public._apply_admin_rls('categories',
  array['parent_id', 'name', 'slug', 'description', 'sort_order'],
  array['parent_id', 'name', 'slug', 'description', 'sort_order', 'archived_at']);

create table if not exists public.collections (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  description text check (char_length(description) <= 2000),
  starts_at   timestamptz,
  ends_at     timestamptz,
  sort_order  int not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint collections_window check (starts_at is null or ends_at is null or ends_at > starts_at)
);
drop trigger if exists collections_set_updated_at on public.collections;
create trigger collections_set_updated_at before update on public.collections
  for each row execute function public.set_updated_at();
select public._apply_admin_rls('collections',
  array['name', 'slug', 'description', 'starts_at', 'ends_at', 'sort_order'],
  array['name', 'slug', 'description', 'starts_at', 'ends_at', 'sort_order', 'archived_at']);

-- Enmienda a S1: audit_changes() identificaba el registro SOLO por `id`. Las tablas con otra clave primaria
-- (currencies/countries: code · store_settings: key) o compuesta (asociaciones producto↔categoría/colección/
-- relacionado) quedaban con record_id NULL y un diff sin forma de saber QUÉ fila cambió. Ahora record_id usa
-- id → code → key → product_id, y en esas tablas el diff lleva siempre `_key` con las columnas que identifican la fila.
create or replace function public.audit_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redact text[] := coalesce(tg_argv, '{}'::text[]);
  v_old    jsonb;
  v_new    jsonb;
  v_diff   jsonb := '{}'::jsonb;
  v_key    text;
  v_row    jsonb;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_row := v_new;
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key <> 'updated_at' then
        v_diff := v_diff || jsonb_build_object(
          v_key, case when v_key = any (v_redact) then '"[redacted]"'::jsonb else v_new -> v_key end);
      end if;
    end loop;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_row := v_new;
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key <> 'updated_at' and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_diff := v_diff || jsonb_build_object(
          v_key,
          case when v_key = any (v_redact)
               then jsonb_build_object('changed', true)
               else jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key) end);
      end if;
    end loop;
    if v_diff = '{}'::jsonb then
      return new;  -- solo cambió updated_at: no es un cambio relevante
    end if;
  else
    v_old := to_jsonb(old);
    v_row := v_old;
    for v_key in select jsonb_object_keys(v_old) loop
      v_diff := v_diff || jsonb_build_object(
        v_key, case when v_key = any (v_redact) then '"[redacted]"'::jsonb else v_old -> v_key end);
    end loop;
  end if;

  if not (v_row ? 'id') then
    v_diff := v_diff || jsonb_build_object('_key', jsonb_strip_nulls(jsonb_build_object(
      'code', v_row -> 'code', 'key', v_row -> 'key', 'product_id', v_row -> 'product_id',
      'related_id', v_row -> 'related_id', 'category_id', v_row -> 'category_id',
      'collection_id', v_row -> 'collection_id')));
  end if;

  insert into public.audit_log (actor_id, actor_role, table_name, record_id, action, diff)
  values (
    auth.uid(),
    coalesce(auth.jwt() ->> 'role', current_user),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'code', v_row ->> 'key', v_row ->> 'product_id'),
    tg_op,
    v_diff
  );
  return coalesce(new, old);
end;
$$;
revoke all on function public.audit_changes() from public, anon, authenticated;

-- ── Auditoría (BR-ADM-03) ──────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['currencies', 'countries', 'exchange_rates', 'store_settings', 'news_banners',
                           'categories', 'collections']
  loop
    execute format('drop trigger if exists %I on public.%I', 'audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I
                      for each row execute function public.audit_changes()', 'audit_' || t, t);
  end loop;
end $$;
