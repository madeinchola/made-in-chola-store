-- Sprint 14 · Fase D — Carga masiva (productos con variantes, stock, precios y categorías).
--
-- Cómo funciona (y por qué así):
--   * El navegador lee el CSV y manda las filas por BLOQUES (la base corta cualquier llamada a los 8 s). TODA la validación y toda la
--     escritura son de la base: lo que el navegador valida es solo para avisar antes.
--   * «Vista previa» y «confirmar» son la MISMA cuenta: `admin_import_validate` corre la importación de verdad dentro de una
--     subtransacción y la DESHACE; `admin_import_apply_chunk` la deja. Nada se escribe hasta confirmar.
--   * Cada fila va en su propia subtransacción: una fila con error no tumba a las demás ni deja a medias lo que había hecho.
--   * Cada lote queda registrado (`import_batches`) con el antes y el después de cada cambio (`import_batch_rows`): se puede ver qué
--     hizo y REVERTIR. Revertir no borra: archiva lo que el lote creó y devuelve lo que actualizó a su valor anterior, salvo que alguien
--     lo haya vuelto a cambiar (entonces lo deja como está y lo informa: nunca pisa trabajo posterior).
--   * Los lotes se aplican por bloques en transacciones separadas: si se cierra la pestaña a mitad, lo aplicado queda aplicado y
--     consistente, el lote queda «en curso» y se puede revertir o terminar con el mismo archivo (lo ya aplicado se salta).
--   * El stock se importa como CONTEO ABSOLUTO por SKU, siempre con un movimiento `import`, y nunca por debajo de lo reservado.
--   * Las imágenes NO se importan (se suben desde el panel del producto); los productos nacen en BORRADOR (publicar exige imágenes).
--
-- Rollback de la migración:
--   drop function public.admin_import_validate(text, jsonb), public.admin_import_start(text, text, int),
--     public.admin_import_apply_chunk(uuid, jsonb), public.admin_import_finish(uuid), public.admin_import_rollback(uuid),
--     public.admin_import_batches(int), public.admin_import_batch_rows(uuid, int, int), public._import_rows(text, jsonb, uuid),
--     public._import_unique_slug(text, text), public._import_text(jsonb, text, int), public._import_num(jsonb, text, int);
--   drop table public.import_batch_rows, public.import_batches;
--
-- Idempotente: se puede reaplicar.

-- ── 1. Lotes y su detalle ────────────────────────────────────────────────────────────────────────────────────────────────────
-- Sin claves foráneas a perfiles ni productos (como la cola de avisos): un lote es un registro, no debe impedir borrar una cuenta de
-- prueba ni archivar un producto.
create table if not exists public.import_batches (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('products', 'stock', 'prices', 'categories')),
  filename       text check (filename is null or char_length(filename) <= 200),
  status         text not null default 'applying' check (status in ('applying', 'done', 'rolled_back', 'partially_rolled_back')),
  total_rows     integer not null default 0 check (total_rows >= 0),
  created_count  integer not null default 0,
  updated_count  integer not null default 0,
  skipped_count  integer not null default 0,
  error_count    integer not null default 0,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz,
  rolled_back_at timestamptz,
  rolled_back_by uuid
);
create index if not exists import_batches_created_idx on public.import_batches (created_at desc);

create table if not exists public.import_batch_rows (
  id          bigint generated always as identity primary key,
  batch_id    uuid not null references public.import_batches (id) on delete cascade,
  row_no      integer not null,
  action      text not null check (action in ('create', 'update', 'skip', 'error')),
  entity      text check (entity in ('category', 'product', 'color', 'size', 'variant', 'price', 'stock', 'product_category')),
  entity_id   uuid,
  key         text,
  before      jsonb,
  after       jsonb,
  error_codes jsonb not null default '[]'::jsonb,
  rolled_back boolean not null default false
);
create index if not exists import_batch_rows_batch_idx on public.import_batch_rows (batch_id, row_no, id);

alter table public.import_batches enable row level security;
alter table public.import_batch_rows enable row level security;
-- Nadie lee ni escribe estas tablas directo (ni el administrador): solo las funciones admin_import_*.
revoke all on public.import_batches, public.import_batch_rows from public, anon, authenticated, service_role;

drop trigger if exists audit_import_batches on public.import_batches;
create trigger audit_import_batches after insert or update on public.import_batches
  for each row execute function public.audit_changes();

-- ── 2. Ayudas de lectura de una fila (todo texto; los números llegan como texto canónico «1234.56») ───────────────────────────────
-- Texto recortado; vacío = NULL. Largo máximo: pasarlo es un error de la fila, no se corta en silencio.
create or replace function public._import_text(p_row jsonb, p_key text, p_max int)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  if jsonb_typeof(p_row -> p_key) is distinct from 'string' then
    return null;
  end if;
  v := nullif(btrim(p_row ->> p_key), '');
  if v is not null and char_length(v) > p_max then
    raise exception 'too_long' using errcode = '22001', detail = p_key;
  end if;
  return v;
end;
$$;

-- Número canónico («12», «12.5»): sin signo, sin miles, con a lo sumo p_scale decimales. NULL = vacío.
create or replace function public._import_num(p_row jsonb, p_key text, p_scale int)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  v := public._import_text(p_row, p_key, 40);
  if v is null then
    return null;
  end if;
  if v !~ '^[0-9]{1,12}(\.[0-9]+)?$' then
    raise exception 'invalid_format' using errcode = '22023', detail = p_key;
  end if;
  if scale(v::numeric) > p_scale and v::numeric <> round(v::numeric, p_scale) then
    raise exception 'too_many_decimals' using errcode = '22023', detail = p_key;
  end if;
  return v::numeric;
end;
$$;

-- Un slug libre en `categories` o `products`: el del nombre; si está tomado, con el sufijo; si sigue tomado, con un número.
create or replace function public._import_unique_slug(p_table text, p_base text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_base text := left(coalesce(nullif(public.slugify(p_base), ''), 'item'), 70);
  v_slug text := v_base;
  v_n int := 1;
  v_taken boolean;
begin
  loop
    execute format('select exists (select 1 from public.%I where slug = $1)', p_table) into v_taken using v_slug;
    exit when not v_taken;
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  return v_slug;
end;
$$;

-- ── 3. El motor: una fila a la vez, cada una en su subtransacción ───────────────────────────────────────────────────────────────
-- Devuelve [{row, action, key, errors:[{field, code}]}] y, si hay lote (p_batch), deja el detalle en import_batch_rows.
-- Un error que no es de validación (una restricción de la base) sale como «db_error» con el nombre de la restricción: nunca un 500.
create or replace function public._import_rows(p_kind text, p_rows jsonb, p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_row int;
  v_key text;
  v_action text;
  v_results jsonb := '[]'::jsonb;
  v_changes jsonb;
  v_errors jsonb;
  v_state text;
  v_detail text;
  v_msg text;
  v_seen text[] := '{}';
  ch jsonb;
  v_base text := trim(both '"' from public.setting_text('base_currency', 'BOB'));
  -- variables de trabajo por tipo
  v_code text; v_name text; v_desc text; v_model text; v_mat text; v_wash text; v_cost numeric; v_price numeric; v_cur text;
  v_cats text; v_color text; v_hex text; v_size text; v_sku text; v_stock numeric; v_stock_int int; v_slug text; v_parent text;
  v_product public.products; v_variant public.product_variants; v_color_id uuid; v_size_id uuid; v_cat_id uuid; v_parent_id uuid;
  v_cat_ref text; v_decimals int; v_cur_amount numeric; v_reserved int; v_old int; v_id uuid; v_pp public.product_prices;
  v_cat public.categories;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'invalid_rows' using errcode = '22023', hint = 'una lista de hasta 500 filas';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_row := coalesce((r ->> 'row')::int, 0);
    v_key := null;
    v_action := 'skip';
    v_changes := '[]'::jsonb;
    v_errors := '[]'::jsonb;
    begin
      -- ── productos: una fila por variante ───────────────────────────────────────────────────────
      if p_kind = 'products' then
        v_code := public._import_text(r, 'code', 41);
        v_key := public._import_text(r, 'sku', 81);
        if v_code is null then raise exception 'required' using errcode = '22023', detail = 'code'; end if;
        if v_code !~ '^[A-Za-z0-9._-]{1,40}$' then raise exception 'invalid_format' using errcode = '22023', detail = 'code'; end if;
        if v_key is null then raise exception 'required' using errcode = '22023', detail = 'sku'; end if;
        if v_key !~ '^[A-Za-z0-9._-]{1,80}$' then raise exception 'invalid_format' using errcode = '22023', detail = 'sku'; end if;
        if lower(v_key) = any (v_seen) then raise exception 'duplicate_in_file' using errcode = '22023', detail = 'sku'; end if;
        v_seen := v_seen || lower(v_key);
        v_name := public._import_text(r, 'name', 160);
        v_desc := public._import_text(r, 'description', 5000);
        v_model := public._import_text(r, 'model', 120);
        v_mat := public._import_text(r, 'materials', 1000);
        v_wash := public._import_text(r, 'washcare', 1000);
        v_cost := public._import_num(r, 'cost', 2);
        v_cur := upper(coalesce(public._import_text(r, 'currency', 3), v_base));
        select c.decimals into v_decimals from public.currencies c where c.code = v_cur;
        if v_decimals is null then raise exception 'currency_unknown' using errcode = '22023', detail = 'currency'; end if;
        v_price := public._import_num(r, 'price', v_decimals);
        if v_price is not null and v_price = 0 then raise exception 'price_invalid' using errcode = '22023', detail = 'price'; end if;
        v_cats := public._import_text(r, 'categories', 500);
        v_color := public._import_text(r, 'color', 40);
        v_hex := public._import_text(r, 'color_hex', 7);
        if v_hex is not null and v_hex !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'invalid_format' using errcode = '22023', detail = 'color_hex'; end if;
        v_size := public._import_text(r, 'size', 20);
        v_stock := public._import_num(r, 'stock', 0);
        if v_color is null then raise exception 'required' using errcode = '22023', detail = 'color'; end if;

        select * into v_product from public.products p where lower(p.code) = lower(v_code);
        if not found then
          if v_name is null then raise exception 'required' using errcode = '22023', detail = 'name'; end if;
          v_slug := public._import_unique_slug('products', v_name);
          if exists (select 1 from public.products p where p.slug = v_slug) then v_slug := public._import_unique_slug('products', v_name || '-' || v_code); end if;
          insert into public.products (code, slug, name, description, model, materials, washcare, cost_base)
          values (v_code, v_slug, v_name, coalesce(v_desc, ''), v_model, v_mat, v_wash, v_cost)
          returning * into v_product;
          v_changes := v_changes || jsonb_build_array(jsonb_build_object('entity', 'product', 'action', 'create', 'id', v_product.id));
        else
          if v_product.archived_at is not null then raise exception 'product_archived' using errcode = '22023', detail = 'code'; end if;
          if (v_name is not null and v_name is distinct from v_product.name) or (v_desc is not null and v_desc is distinct from v_product.description)
             or (v_model is not null and v_model is distinct from v_product.model) or (v_mat is not null and v_mat is distinct from v_product.materials)
             or (v_wash is not null and v_wash is distinct from v_product.washcare) or (v_cost is not null and v_cost is distinct from v_product.cost_base) then
            v_changes := v_changes || jsonb_build_array(jsonb_build_object('entity', 'product', 'action', 'update', 'id', v_product.id,
              'before', jsonb_build_object('name', v_product.name, 'description', v_product.description, 'model', v_product.model,
                                           'materials', v_product.materials, 'washcare', v_product.washcare, 'cost_base', v_product.cost_base),
              'after', jsonb_build_object('name', coalesce(v_name, v_product.name), 'description', coalesce(v_desc, v_product.description),
                                          'model', coalesce(v_model, v_product.model), 'materials', coalesce(v_mat, v_product.materials),
                                          'washcare', coalesce(v_wash, v_product.washcare), 'cost_base', coalesce(v_cost, v_product.cost_base))));
            update public.products set name = coalesce(v_name, name), description = coalesce(v_desc, description), model = coalesce(v_model, model),
                   materials = coalesce(v_mat, materials), washcare = coalesce(v_wash, washcare), cost_base = coalesce(v_cost, cost_base)
             where id = v_product.id;
          end if;
        end if;

        -- precio
        if v_price is not null then
          select * into v_pp from public.product_prices pp where pp.product_id = v_product.id and pp.currency = v_cur and pp.country is null;
          if not found then
            insert into public.product_prices (product_id, currency, amount) values (v_product.id, v_cur, v_price) returning * into v_pp;
            v_changes := v_changes || jsonb_build_array(jsonb_build_object('entity', 'price', 'action', 'create', 'id', v_pp.id,
              'after', jsonb_build_object('amount', v_price, 'currency', v_cur)));
          elsif v_pp.amount is distinct from v_price then
            v_changes := v_changes || jsonb_build_array(jsonb_build_object('entity', 'price', 'action', 'update', 'id', v_pp.id,
              'before', jsonb_build_object('amount', v_pp.amount), 'after', jsonb_build_object('amount', v_price)));
            update public.product_prices set amount = v_price where id = v_pp.id;
          end if;
        end if;

        -- categorías (por nombre o slug); nunca se quitan las que ya tiene
        if v_cats is not null then
          for v_cat_ref in select btrim(x) from unnest(string_to_array(v_cats, '|')) x where btrim(x) <> '' loop
            select c.id into v_cat_id from public.categories c where c.slug = public.slugify(v_cat_ref) and c.archived_at is null;
            if v_cat_id is null then raise exception 'category_not_found' using errcode = '22023', detail = 'categories'; end if;
            if not exists (select 1 from public.product_categories pc where pc.product_id = v_product.id and pc.category_id = v_cat_id) then
              insert into public.product_categories (product_id, category_id) values (v_product.id, v_cat_id);
              v_changes := v_changes || jsonb_build_array(jsonb_build_object('entity', 'product_category', 'action', 'create', 'id', v_cat_id,
                'after', jsonb_build_object('product_id', v_product.id, 'category_id', v_cat_id)));
            end if;
          end loop;
        end if;

        -- color y talla del producto
        select c.id into v_color_id from public.product_colors c where c.product_id = v_product.id and lower(c.name) = lower(v_color) and c.archived_at is null;
        if v_color_id is null then
          insert into public.product_colors (product_id, name, hex) values (v_product.id, v_color, coalesce(v_hex, '#CCCCCC')) returning id into v_color_id;
          v_changes := v_changes || jsonb_build_array(jsonb_build_object('entity', 'color', 'action', 'create', 'id', v_color_id));
        end if;
        v_size_id := null;
        if v_size is not null then
          select s.id into v_size_id from public.product_sizes s where s.product_id = v_product.id and lower(s.label) = lower(v_size) and s.archived_at is null;
          if v_size_id is null then
            insert into public.product_sizes (product_id, label) values (v_product.id, v_size) returning id into v_size_id;
            v_changes := v_changes || jsonb_build_array(jsonb_build_object('entity', 'size', 'action', 'create', 'id', v_size_id));
          end if;
        end if;

        -- variante por SKU
        select * into v_variant from public.product_variants v where lower(v.sku) = lower(v_key);
        if found then
          if v_variant.product_id <> v_product.id then raise exception 'sku_conflict' using errcode = '23505', detail = 'sku'; end if;
          if v_variant.archived_at is not null then raise exception 'variant_archived' using errcode = '22023', detail = 'sku'; end if;
          if v_variant.color_id <> v_color_id or v_variant.size_id is distinct from v_size_id then
            raise exception 'sku_conflict' using errcode = '23505', detail = 'sku';
          end if;
        else
          if exists (select 1 from public.product_variants v where v.product_id = v_product.id and v.color_id = v_color_id
                        and v.size_id is not distinct from v_size_id and v.archived_at is null) then
            raise exception 'variant_exists_other_sku' using errcode = '23505', detail = 'sku';
          end if;
          insert into public.product_variants (product_id, color_id, size_id, sku) values (v_product.id, v_color_id, v_size_id, v_key)
          returning * into v_variant;
          v_changes := v_changes || jsonb_build_array(jsonb_build_object('entity', 'variant', 'action', 'create', 'id', v_variant.id));
          if v_stock is not null and v_stock > 0 then
            perform public.apply_stock_change(v_variant.id, v_stock::int, 'import', 'import:' || coalesce(p_batch::text, 'previa'));
            v_changes := v_changes || jsonb_build_array(jsonb_build_object('entity', 'stock', 'action', 'create', 'id', v_variant.id,
              'before', jsonb_build_object('stock', 0), 'after', jsonb_build_object('stock', v_stock::int)));
          end if;
        end if;

      -- ── stock: conteo absoluto por SKU ─────────────────────────────────────────────────────────
      elsif p_kind = 'stock' then
        v_key := public._import_text(r, 'sku', 81);
        if v_key is null then raise exception 'required' using errcode = '22023', detail = 'sku'; end if;
        if lower(v_key) = any (v_seen) then raise exception 'duplicate_in_file' using errcode = '22023', detail = 'sku'; end if;
        v_seen := v_seen || lower(v_key);
        v_stock := public._import_num(r, 'stock', 0);
        if v_stock is null then raise exception 'required' using errcode = '22023', detail = 'stock'; end if;
        if v_stock > 1000000 then raise exception 'too_large' using errcode = '22023', detail = 'stock'; end if;
        v_stock_int := v_stock::int;
        -- se bloquea la variante ANTES de leer su stock: una venta a la vez no se pisa
        select * into v_variant from public.product_variants v where lower(v.sku) = lower(v_key) for update;
        if not found then raise exception 'sku_not_found' using errcode = '22023', detail = 'sku'; end if;
        if v_variant.archived_at is not null then raise exception 'variant_archived' using errcode = '22023', detail = 'sku'; end if;
        select a.reserved into v_reserved from public.variant_availability a where a.variant_id = v_variant.id;
        if v_stock_int < coalesce(v_reserved, 0) then raise exception 'below_reserved' using errcode = '22023', detail = 'stock'; end if;
        if v_stock_int <> v_variant.stock_on_hand then
          perform public.apply_stock_change(v_variant.id, v_stock_int - v_variant.stock_on_hand, 'import', 'import:' || coalesce(p_batch::text, 'previa'));
          v_changes := v_changes || jsonb_build_array(jsonb_build_object('entity', 'stock', 'action', 'update', 'id', v_variant.id,
            'before', jsonb_build_object('stock', v_variant.stock_on_hand), 'after', jsonb_build_object('stock', v_stock_int)));
        end if;

      -- ── precios por moneda ─────────────────────────────────────────────────────────────────────
      elsif p_kind = 'prices' then
        v_key := public._import_text(r, 'code', 41);
        if v_key is null then raise exception 'required' using errcode = '22023', detail = 'code'; end if;
        v_cur := upper(coalesce(public._import_text(r, 'currency', 3), v_base));
        if lower(v_key || '|' || v_cur) = any (v_seen) then raise exception 'duplicate_in_file' using errcode = '22023', detail = 'code'; end if;
        v_seen := v_seen || lower(v_key || '|' || v_cur);
        select c.decimals into v_decimals from public.currencies c where c.code = v_cur;
        if v_decimals is null then raise exception 'currency_unknown' using errcode = '22023', detail = 'currency'; end if;
        v_price := public._import_num(r, 'price', v_decimals);
        if v_price is null then raise exception 'required' using errcode = '22023', detail = 'price'; end if;
        if v_price = 0 then raise exception 'price_invalid' using errcode = '22023', detail = 'price'; end if;
        select * into v_product from public.products p where lower(p.code) = lower(v_key);
        if not found then raise exception 'product_not_found' using errcode = '22023', detail = 'code'; end if;
        if v_product.archived_at is not null then raise exception 'product_archived' using errcode = '22023', detail = 'code'; end if;
        select * into v_pp from public.product_prices pp where pp.product_id = v_product.id and pp.currency = v_cur and pp.country is null;
        if not found then
          insert into public.product_prices (product_id, currency, amount) values (v_product.id, v_cur, v_price) returning * into v_pp;
          v_changes := v_changes || jsonb_build_array(jsonb_build_object('entity', 'price', 'action', 'create', 'id', v_pp.id,
            'after', jsonb_build_object('amount', v_price, 'currency', v_cur)));
        elsif v_pp.amount is distinct from v_price then
          v_changes := v_changes || jsonb_build_array(jsonb_build_object('entity', 'price', 'action', 'update', 'id', v_pp.id,
            'before', jsonb_build_object('amount', v_pp.amount), 'after', jsonb_build_object('amount', v_price)));
          update public.product_prices set amount = v_price where id = v_pp.id;
        end if;

      -- ── categorías ─────────────────────────────────────────────────────────────────────────────
      elsif p_kind = 'categories' then
        v_name := public._import_text(r, 'name', 80);
        if v_name is null then raise exception 'required' using errcode = '22023', detail = 'name'; end if;
        v_slug := coalesce(public._import_text(r, 'slug', 80), public.slugify(v_name));
        if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'invalid_format' using errcode = '22023', detail = 'slug'; end if;
        v_key := v_slug;
        if v_slug = any (v_seen) then raise exception 'duplicate_in_file' using errcode = '22023', detail = 'slug'; end if;
        v_seen := v_seen || v_slug;
        v_desc := public._import_text(r, 'description', 1000);
        v_parent := public._import_text(r, 'parent', 80);
        v_parent_id := null;
        if v_parent is not null then
          select c.id into v_parent_id from public.categories c where c.slug = public.slugify(v_parent) and c.archived_at is null;
          if v_parent_id is null then raise exception 'parent_not_found' using errcode = '22023', detail = 'parent'; end if;
          if public.slugify(v_parent) = v_slug then raise exception 'cycle' using errcode = '22023', detail = 'parent'; end if;
        end if;
        select * into v_cat from public.categories c where c.slug = v_slug;
        if not found then
          insert into public.categories (parent_id, name, slug, description) values (v_parent_id, v_name, v_slug, v_desc) returning * into v_cat;
          v_changes := v_changes || jsonb_build_array(jsonb_build_object('entity', 'category', 'action', 'create', 'id', v_cat.id));
        else
          if v_cat.archived_at is not null then raise exception 'category_archived' using errcode = '22023', detail = 'slug'; end if;
          if v_cat.name is distinct from v_name or (v_desc is not null and v_desc is distinct from v_cat.description)
             or (v_parent_id is not null and v_parent_id is distinct from v_cat.parent_id) then
            -- un cambio de padre no puede crear un ciclo (el padre no puede colgar de esta categoría)
            if v_parent_id is not null and exists (
                 with recursive up as (select c.id, c.parent_id from public.categories c where c.id = v_parent_id
                                       union all select c.id, c.parent_id from public.categories c join up on c.id = up.parent_id)
                 select 1 from up where up.id = v_cat.id) then
              raise exception 'cycle' using errcode = '22023', detail = 'parent';
            end if;
            v_changes := v_changes || jsonb_build_array(jsonb_build_object('entity', 'category', 'action', 'update', 'id', v_cat.id,
              'before', jsonb_build_object('name', v_cat.name, 'description', v_cat.description, 'parent_id', v_cat.parent_id),
              'after', jsonb_build_object('name', v_name, 'description', coalesce(v_desc, v_cat.description),
                                          'parent_id', coalesce(v_parent_id, v_cat.parent_id))));
            update public.categories set name = v_name, description = coalesce(v_desc, description),
                   parent_id = coalesce(v_parent_id, parent_id) where id = v_cat.id;
          end if;
        end if;
      else
        raise exception 'invalid_kind' using errcode = '22023';
      end if;

      v_action := case when jsonb_array_length(v_changes) = 0 then 'skip'
                       when exists (select 1 from jsonb_array_elements(v_changes) c where c ->> 'action' = 'create') then 'create'
                       else 'update' end;
    exception when others then
      -- La subtransacción de esta fila ya se deshizo. El código sale de nuestro RAISE (message) o, si es de la base, de su restricción.
      get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail, v_msg = message_text;
      v_action := 'error';
      v_changes := '[]'::jsonb;
      -- `field` solo sale de NUESTROS avisos: el detalle de un error de la base trae los datos de la fila, y eso no se devuelve.
      v_errors := jsonb_build_array(jsonb_build_object(
        'field', case when v_state in ('22023', '22001') or v_msg in ('sku_conflict', 'variant_exists_other_sku') then coalesce(v_detail, '') else '' end,
        'code', case when v_state in ('22023', '22001') or v_msg in ('sku_conflict', 'variant_exists_other_sku') then v_msg
                     when v_state = '23505' then 'duplicate'
                     else 'db_error' end,
        'constraint', case when v_state like '23%' then v_msg else null end));
    end;

    v_results := v_results || jsonb_build_array(jsonb_build_object('row', v_row, 'action', v_action, 'key', v_key, 'errors', v_errors));
    if p_batch is not null then
      if v_action = 'error' then
        insert into public.import_batch_rows (batch_id, row_no, action, key, error_codes) values (p_batch, v_row, 'error', v_key, v_errors);
      elsif v_action = 'skip' then
        insert into public.import_batch_rows (batch_id, row_no, action, key) values (p_batch, v_row, 'skip', v_key);
      else
        for ch in select value from jsonb_array_elements(v_changes) loop
          insert into public.import_batch_rows (batch_id, row_no, action, entity, entity_id, key, before, after)
          values (p_batch, v_row, ch ->> 'action', ch ->> 'entity', (ch ->> 'id')::uuid, v_key, ch -> 'before', ch -> 'after');
        end loop;
      end if;
    end if;
  end loop;
  return v_results;
end;
$$;

-- ── 4. Vista previa: corre de verdad y lo DESHACE todo ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_import_validate(p_kind text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_results jsonb;
  v_detail text;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if p_kind not in ('products', 'stock', 'prices', 'categories') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  begin
    v_results := public._import_rows(p_kind, p_rows, null);
    -- La señal que deshace todo lo escrito por la vista previa (la subtransacción vuelve al estado de antes).
    raise exception 'import_dry_run' using errcode = 'P0001', detail = v_results::text;
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail is null then
      raise;
    end if;
    v_results := v_detail::jsonb;
  end;
  return jsonb_build_object(
    'rows', v_results,
    'counts', jsonb_build_object(
      'create', (select count(*) from jsonb_array_elements(v_results) x where x ->> 'action' = 'create'),
      'update', (select count(*) from jsonb_array_elements(v_results) x where x ->> 'action' = 'update'),
      'skip', (select count(*) from jsonb_array_elements(v_results) x where x ->> 'action' = 'skip'),
      'error', (select count(*) from jsonb_array_elements(v_results) x where x ->> 'action' = 'error')));
end;
$$;

-- ── 5. Aplicar: abrir el lote, aplicar bloques, cerrar ────────────────────────────────────────────────────────────────────────
create or replace function public.admin_import_start(p_kind text, p_filename text, p_total int)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if p_kind not in ('products', 'stock', 'prices', 'categories') or p_total is null or p_total < 0 or p_total > 100000 then
    raise exception 'invalid_parameters' using errcode = '22023';
  end if;
  insert into public.import_batches (kind, filename, total_rows, created_by)
  values (p_kind, left(p_filename, 200), p_total, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_import_apply_chunk(p_batch uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.import_batches;
  v_results jsonb;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  select * into b from public.import_batches where id = p_batch for update;
  if not found then
    raise exception 'batch_not_found' using errcode = 'P0002';
  end if;
  if b.status <> 'applying' then
    raise exception 'batch_closed' using errcode = '22023';
  end if;
  v_results := public._import_rows(b.kind, p_rows, p_batch);
  update public.import_batches
     set created_count = created_count + (select count(*) from jsonb_array_elements(v_results) x where x ->> 'action' = 'create'),
         updated_count = updated_count + (select count(*) from jsonb_array_elements(v_results) x where x ->> 'action' = 'update'),
         skipped_count = skipped_count + (select count(*) from jsonb_array_elements(v_results) x where x ->> 'action' = 'skip'),
         error_count = error_count + (select count(*) from jsonb_array_elements(v_results) x where x ->> 'action' = 'error')
   where id = p_batch;
  return jsonb_build_object('rows', v_results);
end;
$$;

create or replace function public.admin_import_finish(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.import_batches;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  update public.import_batches set status = 'done', finished_at = now() where id = p_batch and status = 'applying' returning * into b;
  if not found then
    select * into b from public.import_batches where id = p_batch;
    if not found then
      raise exception 'batch_not_found' using errcode = 'P0002';
    end if;
  end if;
  return to_jsonb(b);
end;
$$;

-- ── 6. Historial y el detalle (el informe final descargable) ───────────────────────────────────────────────────────────────────
create or replace function public.admin_import_batches(p_limit int default 20)
returns table (id uuid, kind text, filename text, status text, total_rows integer, created_count integer, updated_count integer,
               skipped_count integer, error_count integer, created_by uuid, created_at timestamptz, finished_at timestamptz,
               rolled_back_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'invalid_parameters' using errcode = '22023';
  end if;
  return query
    select b.id, b.kind, b.filename, b.status, b.total_rows, b.created_count, b.updated_count, b.skipped_count, b.error_count,
           b.created_by, b.created_at, b.finished_at, b.rolled_back_at
      from public.import_batches b
     order by b.created_at desc
     limit p_limit;
end;
$$;

create or replace function public.admin_import_batch_rows(p_batch uuid, p_offset int default 0, p_limit int default 500)
returns table (row_no integer, action text, entity text, key text, error_codes jsonb, rolled_back boolean, total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  perform public._report_page(p_offset, p_limit);
  return query
    select r.row_no, r.action, r.entity, r.key, r.error_codes, r.rolled_back, count(*) over ()
      from public.import_batch_rows r
     where r.batch_id = p_batch
     order by r.row_no, r.id
     offset p_offset limit p_limit;
end;
$$;

-- ── 7. Revertir un lote ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- En orden inverso. Lo creado se ARCHIVA (no se borra: puede tener pedidos o movimientos de stock que no se pueden perder); lo
-- actualizado vuelve a su valor anterior SOLO si sigue como el lote lo dejó. Devuelve qué se revirtió y qué no, con su motivo.
create or replace function public.admin_import_rollback(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.import_batches;
  r public.import_batch_rows;
  v_ok int := 0;
  v_conflicts jsonb := '[]'::jsonb;
  v_reason text;
  v_cur int;
  v_total int;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  select * into b from public.import_batches where id = p_batch for update;
  if not found then
    raise exception 'batch_not_found' using errcode = 'P0002';
  end if;
  if b.status in ('rolled_back') then
    raise exception 'already_rolled_back' using errcode = '22023';
  end if;
  for r in select * from public.import_batch_rows x where x.batch_id = p_batch and x.action in ('create', 'update') and not x.rolled_back
            order by x.row_no desc, x.id desc loop
    v_reason := null;
    begin
      if r.action = 'create' then
        if r.entity = 'category' then
          update public.categories set archived_at = coalesce(archived_at, now()) where id = r.entity_id;
        elsif r.entity = 'product' then
          update public.products set archived_at = coalesce(archived_at, now()) where id = r.entity_id;
        elsif r.entity = 'color' then
          update public.product_colors set archived_at = coalesce(archived_at, now()) where id = r.entity_id;
        elsif r.entity = 'size' then
          update public.product_sizes set archived_at = coalesce(archived_at, now()) where id = r.entity_id;
        elsif r.entity = 'variant' then
          update public.product_variants set archived_at = coalesce(archived_at, now()) where id = r.entity_id;
        elsif r.entity = 'price' then
          if exists (select 1 from public.product_prices p where p.id = r.entity_id and p.amount = (r.after ->> 'amount')::numeric) then
            delete from public.product_prices where id = r.entity_id;
          else
            v_reason := 'changed_since';
          end if;
        elsif r.entity = 'product_category' then
          delete from public.product_categories
           where product_id = (r.after ->> 'product_id')::uuid and category_id = (r.after ->> 'category_id')::uuid;
        elsif r.entity = 'stock' then
          -- stock inicial de una variante creada: se compensa si nadie lo movió; si ya se vendió algo, se deja
          select v.stock_on_hand into v_cur from public.product_variants v where v.id = r.entity_id for update;
          if v_cur = (r.after ->> 'stock')::int then
            perform public.apply_stock_change(r.entity_id, -v_cur, 'import', 'import:revertido:' || p_batch::text);
          else
            v_reason := 'stock_changed';
          end if;
        end if;
      else
        if r.entity = 'stock' then
          select v.stock_on_hand into v_cur from public.product_variants v where v.id = r.entity_id for update;
          if v_cur = (r.after ->> 'stock')::int then
            perform public.apply_stock_change(r.entity_id, (r.before ->> 'stock')::int - v_cur, 'import', 'import:revertido:' || p_batch::text);
          else
            v_reason := 'stock_changed';
          end if;
        elsif r.entity = 'price' then
          update public.product_prices set amount = (r.before ->> 'amount')::numeric
           where id = r.entity_id and amount = (r.after ->> 'amount')::numeric;
          if not found then v_reason := 'changed_since'; end if;
        elsif r.entity = 'product' then
          update public.products
             set name = r.before ->> 'name', description = r.before ->> 'description', model = r.before ->> 'model',
                 materials = r.before ->> 'materials', washcare = r.before ->> 'washcare',
                 cost_base = (r.before ->> 'cost_base')::numeric
           where id = r.entity_id and name = r.after ->> 'name'
             and description is not distinct from (r.after ->> 'description') and model is not distinct from (r.after ->> 'model')
             and materials is not distinct from (r.after ->> 'materials') and washcare is not distinct from (r.after ->> 'washcare')
             and cost_base is not distinct from (r.after ->> 'cost_base')::numeric;
          if not found then v_reason := 'changed_since'; end if;
        elsif r.entity = 'category' then
          update public.categories
             set name = r.before ->> 'name', description = r.before ->> 'description', parent_id = (r.before ->> 'parent_id')::uuid
           where id = r.entity_id and name = r.after ->> 'name' and description is not distinct from (r.after ->> 'description')
             and parent_id is not distinct from (r.after ->> 'parent_id')::uuid;
          if not found then v_reason := 'changed_since'; end if;
        end if;
      end if;
    exception when others then
      v_reason := 'db_error';
    end;
    if v_reason is null then
      update public.import_batch_rows set rolled_back = true where id = r.id;
      v_ok := v_ok + 1;
    else
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('row', r.row_no, 'entity', r.entity, 'key', r.key, 'reason', v_reason));
    end if;
  end loop;
  select count(*) into v_total from public.import_batch_rows x where x.batch_id = p_batch and x.action in ('create', 'update');
  update public.import_batches
     set status = case when jsonb_array_length(v_conflicts) = 0 then 'rolled_back' else 'partially_rolled_back' end,
         rolled_back_at = now(), rolled_back_by = auth.uid(), finished_at = coalesce(finished_at, now())
   where id = p_batch;
  return jsonb_build_object('reverted', v_ok, 'total', v_total, 'conflicts', v_conflicts);
end;
$$;

-- ── 8. Permisos ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function
  public._import_rows(text, jsonb, uuid), public._import_unique_slug(text, text), public._import_text(jsonb, text, int),
  public._import_num(jsonb, text, int)
  from public, anon, authenticated, service_role;
revoke all on function
  public.admin_import_validate(text, jsonb), public.admin_import_start(text, text, int), public.admin_import_apply_chunk(uuid, jsonb),
  public.admin_import_finish(uuid), public.admin_import_rollback(uuid), public.admin_import_batches(int),
  public.admin_import_batch_rows(uuid, int, int)
  from public, anon, service_role;
grant execute on function
  public.admin_import_validate(text, jsonb), public.admin_import_start(text, text, int), public.admin_import_apply_chunk(uuid, jsonb),
  public.admin_import_finish(uuid), public.admin_import_rollback(uuid), public.admin_import_batches(int),
  public.admin_import_batch_rows(uuid, int, int)
  to authenticated;
