-- Sprint 2 · Productos y sus partes: colores, tallas, variantes, imágenes, precios y relaciones.
-- Reglas: BR-CAT-01..06, BR-PRC-01/02, BR-DAT-01. Nada se borra: se archiva (`archived_at`).
-- Rollback (manual, orden inverso): drop table public.product_related, public.product_collections,
--   public.product_categories, public.product_prices, public.product_images, public.product_variants,
--   public.product_sizes, public.product_colors, public.products cascade;
--   drop function public.admin_set_product_categories(uuid, uuid[]), public.admin_set_product_collections(uuid, uuid[]),
--   public.admin_set_product_related(uuid, uuid[]), public.products_publish_guard(),
--   public.product_variants_fill_sku(), public.product_prices_guard(),
--   public.admin_delete_product_price(uuid, text, text), public.product_variants_archive_guard(), public.archive_variants_of_part();

create table if not exists public.products (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique check (code ~ '^[A-Za-z0-9._-]{1,40}$'),
  slug                   text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  name                   text not null check (char_length(btrim(name)) between 1 and 160),
  model                  text check (char_length(model) <= 120),
  description            text not null default '' check (char_length(description) <= 5000),
  materials              text check (char_length(materials) <= 1000),
  washcare               text check (char_length(washcare) <= 1000),
  -- Costo base en la moneda base (BOB) para el margen (BR-ADM-01). Solo lo ve el admin: ninguna vista pública lo expone.
  cost_base              numeric check (cost_base is null or (cost_base >= 0 and cost_base < 1000000000 and scale(cost_base) <= 2)),
  out_of_stock_behavior  text not null default 'sold_out' check (out_of_stock_behavior in ('sold_out', 'hide')),
  status                 text not null default 'draft' check (status in ('draft', 'active')),
  is_new                 boolean not null default false,
  -- BR-PRC-06 / maestro §7.1: si no hay precio explícito en otra moneda, calcularlo desde BOB × tipo de cambio.
  allow_converted_prices boolean not null default false,
  archived_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
-- El código es único SIN distinguir mayúsculas ('chq-001' y 'CHQ-001' serían el mismo producto; la búsqueda ya usa lower(code)).
create unique index if not exists products_code_lower_key on public.products (lower(code));
create index if not exists products_status_idx on public.products (status) where archived_at is null;
create index if not exists products_created_idx on public.products (created_at desc) where archived_at is null;

create table if not exists public.product_colors (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete restrict,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  hex         text check (hex ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order  int not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, product_id)  -- permite la FK compuesta de variantes e imágenes (un color solo de SU producto)
);
create unique index if not exists product_colors_name_key
  on public.product_colors (product_id, lower(name)) where archived_at is null;

create table if not exists public.product_sizes (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete restrict,
  label       text not null check (char_length(btrim(label)) between 1 and 20),
  sort_order  int not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, product_id)
);
create unique index if not exists product_sizes_label_key
  on public.product_sizes (product_id, lower(label)) where archived_at is null;

create table if not exists public.product_variants (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null references public.products (id) on delete restrict,
  color_id           uuid not null,
  size_id            uuid,
  sku                text not null unique check (sku ~ '^[A-Za-z0-9._-]{1,80}$'),
  -- Solo cambia por las funciones de stock (ledger): ver guarda en la migración de inventario.
  stock_on_hand      int not null default 0 check (stock_on_hand >= 0),
  low_threshold      int check (low_threshold >= 0),
  critical_threshold int check (critical_threshold >= 0),
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Color y talla deben pertenecer al MISMO producto que la variante.
  constraint product_variants_color_fk foreign key (color_id, product_id)
    references public.product_colors (id, product_id) on delete restrict,
  constraint product_variants_size_fk foreign key (size_id, product_id)
    references public.product_sizes (id, product_id) on delete restrict,
  constraint product_variants_thresholds check (
    low_threshold is null or critical_threshold is null or critical_threshold <= low_threshold)
);
-- Unicidad (producto, color, talla) tratando size_id NULL (un UNIQUE normal permitiría duplicados con NULL).
create unique index if not exists product_variants_color_only_key
  on public.product_variants (product_id, color_id) where size_id is null and archived_at is null;
create unique index if not exists product_variants_color_size_key
  on public.product_variants (product_id, color_id, size_id) where size_id is not null and archived_at is null;
create index if not exists product_variants_product_idx on public.product_variants (product_id);

create table if not exists public.product_images (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete restrict,
  color_id    uuid,
  path        text not null unique,
  alt         text check (char_length(alt) <= 200),
  sort_order  int not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint product_images_color_fk foreign key (color_id, product_id)
    references public.product_colors (id, product_id) on delete restrict,
  -- Convención de Storage: products/{product_id}/{uuid}.ext (bucket product-images)
  constraint product_images_path_format check (
    path ~ ('^products/' || product_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|avif)$'))
);
create index if not exists product_images_product_idx on public.product_images (product_id, sort_order);

create table if not exists public.product_prices (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  currency   text not null references public.currencies (code),
  country    text references public.countries (code),
  -- Se RECHAZAN valores con más decimales de los de la moneda (no se redondea en silencio) y 0/negativos.
  amount     numeric not null check (amount > 0 and amount < 1000000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists product_prices_currency_key
  on public.product_prices (product_id, currency) where country is null;
create unique index if not exists product_prices_currency_country_key
  on public.product_prices (product_id, currency, country) where country is not null;

create table if not exists public.product_categories (
  product_id  uuid not null references public.products (id) on delete restrict,
  category_id uuid not null references public.categories (id) on delete restrict,
  created_at  timestamptz not null default now(),
  primary key (product_id, category_id)
);
create index if not exists product_categories_category_idx on public.product_categories (category_id);

create table if not exists public.product_collections (
  product_id    uuid not null references public.products (id) on delete restrict,
  collection_id uuid not null references public.collections (id) on delete restrict,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  primary key (product_id, collection_id)
);
create index if not exists product_collections_collection_idx on public.product_collections (collection_id, sort_order);

create table if not exists public.product_related (
  product_id uuid not null references public.products (id) on delete restrict,
  related_id uuid not null references public.products (id) on delete restrict,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  primary key (product_id, related_id),
  constraint product_related_not_self check (product_id <> related_id)
);

-- Búsqueda (pg_trgm + unaccent): sin acentos ni mayúsculas, por nombre, modelo y código.
create index if not exists products_search_name_idx
  on public.products using gin (public.f_unaccent(lower(name)) extensions.gin_trgm_ops);
create index if not exists products_search_model_idx
  on public.products using gin (public.f_unaccent(lower(coalesce(model, ''))) extensions.gin_trgm_ops);
create index if not exists products_search_code_idx
  on public.products using gin (lower(code) extensions.gin_trgm_ops);

-- ── Triggers ───────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['products', 'product_colors', 'product_sizes', 'product_variants', 'product_images', 'product_prices']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;
end $$;

-- SKU automático si el admin no lo da: CODIGO-COLOR[-TALLA], p. ej. "CHQ-001-BLANCO-XS".
create or replace function public.product_variants_fill_sku()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_color text;
  v_size text;
  v_base text;
  v_n int := 1;
begin
  if new.sku is null then
    select p.code into v_code from public.products p where p.id = new.product_id;
    select c.name into v_color from public.product_colors c where c.id = new.color_id;
    select s.label into v_size from public.product_sizes s where s.id = new.size_id;
    -- Se trunca a 70 para que, con el sufijo -2, -3…, nunca supere los 80 caracteres que permite el CHECK.
    v_base := left(upper(v_code || '-' || public.slugify(v_color) || case when v_size is null then '' else '-' || public.slugify(v_size) end), 70);
    new.sku := v_base;
    -- El SKU es único incluso entre variantes archivadas: si el admin archiva una combinación y la recrea,
    -- la nueva recibe CODIGO-COLOR-2, -3… (la carrera entre dos altas simultáneas la ataja el UNIQUE).
    while exists (select 1 from public.product_variants x where x.sku = new.sku) loop
      v_n := v_n + 1;
      new.sku := v_base || '-' || v_n;
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists product_variants_fill_sku_trg on public.product_variants;
create trigger product_variants_fill_sku_trg before insert on public.product_variants
  for each row execute function public.product_variants_fill_sku();

-- Los decimales de un precio no pueden exceder los de su moneda; moneda y país deben ser coherentes.
create or replace function public.product_prices_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_decimals int;
begin
  select c.decimals into v_decimals from public.currencies c where c.code = new.currency;
  if scale(new.amount) > v_decimals then
    raise exception 'el precio % tiene más de % decimales permitidos para %', new.amount, v_decimals, new.currency
      using errcode = '23514';
  end if;
  -- El precio en BOB (moneda base) es SIEMPRE el general (sin país): el listado público lee ese, y un precio BOB
  -- "por país" haría que el listado mostrara un precio distinto del que cobra price_for. Un precio por país solo
  -- puede ser en la moneda de ese país (no existe (USD, Bolivia)).
  if new.country is not null then
    if new.currency = 'BOB' then
      raise exception 'el precio en BOB (moneda base) no lleva país: es el precio general' using errcode = '23514';
    end if;
    if not exists (select 1 from public.countries k where k.code = new.country and k.currency_code = new.currency) then
      raise exception 'el país % no usa la moneda %', new.country, new.currency using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists product_prices_guard_trg on public.product_prices;
create trigger product_prices_guard_trg before insert or update of amount, currency, country on public.product_prices
  for each row execute function public.product_prices_guard();

-- Un producto solo puede publicarse ('active') si es vendible: ≥1 variante activa y precio en BOB.
-- Se crea siempre como 'draft', se completa y luego se activa.
create or replace function public.products_publish_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and new.archived_at is null then
    if not exists (select 1 from public.product_variants v where v.product_id = new.id and v.archived_at is null) then
      raise exception 'no se puede publicar "%": falta al menos una variante (color/talla)', new.name using errcode = '23514';
    end if;
    if not exists (select 1 from public.product_prices p
                    where p.product_id = new.id and p.currency = 'BOB' and p.country is null) then
      raise exception 'no se puede publicar "%": falta el precio en BOB', new.name using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists products_publish_guard_trg on public.products;
create trigger products_publish_guard_trg before insert or update of status, archived_at on public.products
  for each row execute function public.products_publish_guard();

-- ── Coherencia de variantes ────────────────────────────────────────────────────────────────
-- No se puede archivar la ÚLTIMA variante activa de un producto PUBLICADO: quedaría "activo" sin nada que vender
-- (BR-CAT-01). Hay que despublicarlo (borrador) o archivarlo primero.
create or replace function public.product_variants_archive_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archived_at is not null and old.archived_at is null
     and exists (select 1 from public.products p where p.id = new.product_id and p.status = 'active' and p.archived_at is null)
     and not exists (select 1 from public.product_variants v
                      where v.product_id = new.product_id and v.id <> new.id and v.archived_at is null) then
    raise exception 'no se puede archivar la última variante de un producto publicado: despublícalo (borrador) o archívalo primero'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists product_variants_archive_guard_trg on public.product_variants;
create trigger product_variants_archive_guard_trg before update of archived_at on public.product_variants
  for each row execute function public.product_variants_archive_guard();

-- Archivar un color o una talla archiva sus variantes (si no, quedarían variantes "fantasma" que suman stock pero
-- no se pueden comprar). Desarchivar NO las restaura: es una decisión del admin, variante por variante.
create or replace function public.archive_variants_of_part()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    if tg_table_name = 'product_colors' then
      update public.product_variants set archived_at = now() where color_id = new.id and archived_at is null;
    else
      update public.product_variants set archived_at = now() where size_id = new.id and archived_at is null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists product_colors_archive_variants on public.product_colors;
create trigger product_colors_archive_variants after update of archived_at on public.product_colors
  for each row execute function public.archive_variants_of_part();
drop trigger if exists product_sizes_archive_variants on public.product_sizes;
create trigger product_sizes_archive_variants after update of archived_at on public.product_sizes
  for each row execute function public.archive_variants_of_part();

-- ── Reemplazo de asociaciones (el DELETE ocurre dentro de estas funciones, no en manos del cliente) ─
create or replace function public.admin_set_product_categories(p_product_id uuid, p_category_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := coalesce((select array_agg(distinct x) from unnest(p_category_ids) x), '{}');
begin
  if not public.is_admin() then raise exception 'solo administradores' using errcode = '42501'; end if;
  if p_category_ids is null then raise exception 'la lista de categorías no puede ser NULL (usa un arreglo vacío para quitarlas todas)' using errcode = '22023'; end if;
  if cardinality(v_ids) > 50 then raise exception 'máximo 50 categorías por producto' using errcode = '22023'; end if;
  -- Bloquear el producto serializa llamadas simultáneas (doble clic con listas distintas): sin esto podían
  -- terminar mezcladas ({A} y {B} → {A,B}).
  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'producto inexistente' using errcode = 'P0002';
  end if;
  delete from public.product_categories where product_id = p_product_id and category_id <> all (v_ids);
  insert into public.product_categories (product_id, category_id)
    select p_product_id, x from unnest(v_ids) x on conflict do nothing;
end;
$$;

create or replace function public.admin_set_product_collections(p_product_id uuid, p_collection_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := coalesce((select array_agg(x order by o) from (
                     select x, min(o) o from unnest(p_collection_ids) with ordinality as t(x, o) group by x) d), '{}');
begin
  if not public.is_admin() then raise exception 'solo administradores' using errcode = '42501'; end if;
  if p_collection_ids is null then raise exception 'la lista de colecciones no puede ser NULL (usa un arreglo vacío para quitarlas todas)' using errcode = '22023'; end if;
  if cardinality(v_ids) > 50 then raise exception 'máximo 50 colecciones por producto' using errcode = '22023'; end if;
  -- Bloquear el producto serializa llamadas simultáneas (doble clic con listas distintas): sin esto podían
  -- terminar mezcladas ({A} y {B} → {A,B}).
  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'producto inexistente' using errcode = 'P0002';
  end if;
  delete from public.product_collections where product_id = p_product_id and collection_id <> all (v_ids);
  insert into public.product_collections (product_id, collection_id)
    select p_product_id, x from unnest(v_ids) x on conflict do nothing;
end;
$$;

-- Relacionados manuales (BR-MKT-03): el orden del arreglo es el orden de aparición.
create or replace function public.admin_set_product_related(p_product_id uuid, p_related_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := coalesce((select array_agg(x order by o) from (
                     select x, min(o) o from unnest(p_related_ids) with ordinality as t(x, o) group by x) d), '{}');
begin
  if not public.is_admin() then raise exception 'solo administradores' using errcode = '42501'; end if;
  if p_related_ids is null then raise exception 'la lista de relacionados no puede ser NULL (usa un arreglo vacío para quitarlos todos)' using errcode = '22023'; end if;
  if cardinality(v_ids) > 24 then raise exception 'máximo 24 productos relacionados' using errcode = '22023'; end if;
  if p_product_id = any (v_ids) then raise exception 'un producto no puede ser relacionado de sí mismo' using errcode = '23514'; end if;
  -- Bloquear el producto serializa llamadas simultáneas (doble clic con listas distintas): sin esto podían
  -- terminar mezcladas ({A} y {B} → {A,B}).
  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'producto inexistente' using errcode = 'P0002';
  end if;
  delete from public.product_related where product_id = p_product_id and related_id <> all (v_ids);
  insert into public.product_related (product_id, related_id, sort_order)
    select p_product_id, x, (o - 1)::int from unnest(v_ids) with ordinality as t(x, o)
    on conflict (product_id, related_id) do update set sort_order = excluded.sort_order;
end;
$$;

-- Quita un precio explícito (un precio cargado por error no tenía salida: ganaba siempre a la conversión). El
-- DELETE lo hace esta función (propietario) y queda en audit_log con el valor anterior. El precio general en BOB de
-- un producto PUBLICADO no se puede quitar: dejaría de ser vendible.
create or replace function public.admin_delete_product_price(p_product_id uuid, p_currency text, p_country text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'solo administradores' using errcode = '42501'; end if;
  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'producto inexistente' using errcode = 'P0002';
  end if;
  if p_currency = 'BOB' and p_country is null
     and exists (select 1 from public.products p where p.id = p_product_id and p.status = 'active' and p.archived_at is null) then
    raise exception 'no se puede quitar el precio en BOB de un producto publicado: despublícalo primero' using errcode = '23514';
  end if;
  delete from public.product_prices
   where product_id = p_product_id and currency = p_currency and country is not distinct from p_country;
  if not found then
    raise exception 'ese precio no existe' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.admin_delete_product_price(uuid, text, text) from public, anon;
grant execute on function public.admin_delete_product_price(uuid, text, text) to authenticated;

revoke all on function public.admin_set_product_categories(uuid, uuid[]),
                       public.admin_set_product_collections(uuid, uuid[]),
                       public.admin_set_product_related(uuid, uuid[]) from public, anon;
grant execute on function public.admin_set_product_categories(uuid, uuid[]),
                          public.admin_set_product_collections(uuid, uuid[]),
                          public.admin_set_product_related(uuid, uuid[]) to authenticated;

-- ── Permisos y RLS ─────────────────────────────────────────────────────────────────────────
-- El stock (stock_on_hand) NO se inserta ni actualiza directamente: solo por las funciones de stock.
select public._apply_admin_rls('products',
  array['code', 'slug', 'name', 'model', 'description', 'materials', 'washcare', 'cost_base',
        'out_of_stock_behavior', 'status', 'is_new', 'allow_converted_prices'],
  array['code', 'slug', 'name', 'model', 'description', 'materials', 'washcare', 'cost_base',
        'out_of_stock_behavior', 'status', 'is_new', 'allow_converted_prices', 'archived_at']);
select public._apply_admin_rls('product_colors',
  array['product_id', 'name', 'hex', 'sort_order'],
  array['name', 'hex', 'sort_order', 'archived_at']);
select public._apply_admin_rls('product_sizes',
  array['product_id', 'label', 'sort_order'],
  array['label', 'sort_order', 'archived_at']);
select public._apply_admin_rls('product_variants',
  array['product_id', 'color_id', 'size_id', 'sku', 'low_threshold', 'critical_threshold'],
  array['sku', 'low_threshold', 'critical_threshold', 'archived_at']);
select public._apply_admin_rls('product_images',
  array['product_id', 'color_id', 'path', 'alt', 'sort_order'],
  array['color_id', 'alt', 'sort_order', 'archived_at']);
select public._apply_admin_rls('product_prices',
  array['product_id', 'currency', 'country', 'amount'],
  array['amount']);
-- Asociaciones: solo lectura directa; se modifican con admin_set_product_*.
select public._apply_admin_rls('product_categories', null, null);
-- El admin puede reordenar los productos de una colección (sort_order), no cambiar la pertenencia.
select public._apply_admin_rls('product_collections', null, array['sort_order']);
select public._apply_admin_rls('product_related', null, null);

-- ── Auditoría (BR-ADM-03) ──────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['products', 'product_colors', 'product_sizes', 'product_variants', 'product_images',
                           'product_prices', 'product_categories', 'product_collections', 'product_related']
  loop
    execute format('drop trigger if exists %I on public.%I', 'audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I
                      for each row execute function public.audit_changes()', 'audit_' || t, t);
  end loop;
end $$;
