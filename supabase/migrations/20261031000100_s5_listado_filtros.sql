-- Sprint 5 · Listado público con filtros EN EL SERVIDOR y facetas.
-- Antes el listado resolvía categoría/colección en el navegador y pasaba los ids por la URL (tope de 200 productos).
-- Ahora una sola función filtra, ordena y pagina en SQL y devuelve también el total exacto. Solo lee las vistas
-- públicas (nunca ve borradores, archivados, "ocultos" ni cantidades de stock).
--
-- Rollback (manual):
--   drop function public.public_list_products(text, text, text[], text[], numeric, numeric, boolean, text, int, int);
--   drop function public.public_listing_facets(text, text);
--   (y restaurar public_search_products con la definición de 20261028000400_precios_y_vistas_publicas.sql)

-- Filtra y pagina. Semántica de los filtros:
--  · categoría: incluye sus subcategorías; colección: la propia. Un slug inexistente/archivado/vencido => vacío.
--  · colores / tallas: OR dentro de cada filtro y AND entre ellos, sobre LA MISMA variante (un producto rojo solo en S y
--    azul solo en M NO aparece al pedir «rojo + M»). Comparan sin acentos ni mayúsculas.
--  · solo disponibles: excluye agotados; junto con color/talla exige que ESA variante tenga stock.
--  · precio: inclusivo, en la moneda base (BOB).
--  · orden: newest | price_asc | price_desc | name (sin acentos); cualquier otro valor => newest. El id desempata
--    para que la paginación sea estable.
--  · límite 1..100 y desplazamiento 0..1 000 000 (valores raros se acotan, no fallan).
create or replace function public.public_list_products(
  p_category_slug text default null,
  p_collection_slug text default null,
  p_colors text[] default null,
  p_sizes text[] default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_in_stock_only boolean default false,
  p_sort text default 'newest',
  p_limit int default 24,
  p_offset int default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cat_ids uuid[];
  v_collection uuid;
  -- Se acotan a 20 valores de 40 caracteres: la llama anon y no debe ser un amplificador de CPU. Se recorta ANTES de
  -- procesar (solo los primeros 100 elementos del arreglo y 200 caracteres de cada uno): btrim/lower/unaccent sobre un
  -- valor de 2 MB costaba ~30 veces más que sobre uno normal.
  v_colors text[] := (select nullif(array_agg(distinct x), '{}')
                        from (select left(public.f_unaccent(lower(btrim(c))), 40) as x
                                from unnest((coalesce(p_colors, '{}'))[1:100]) c0,
                                     lateral (select left(c0, 200) as c) l
                               where btrim(c) <> '' limit 20) q);
  v_sizes text[] := (select nullif(array_agg(distinct x), '{}')
                       from (select left(public.f_unaccent(lower(btrim(s))), 40) as x
                               from unnest((coalesce(p_sizes, '{}'))[1:100]) s0,
                                    lateral (select left(s0, 200) as s) l
                              where btrim(s) <> '' limit 20) q);
  v_stock boolean := coalesce(p_in_stock_only, false);
  v_limit int := greatest(1, least(coalesce(p_limit, 24), 100));
  -- Tope de desplazamiento: sin él, `offset + limit` desbordaba el entero (500) con valores cercanos a 2^31.
  v_offset int := greatest(0, least(coalesce(p_offset, 0), 1000000));
  v_sort text := case when p_sort in ('newest', 'price_asc', 'price_desc', 'name') then p_sort else 'newest' end;
  v_result jsonb;
begin
  if p_category_slug is not null then
    with recursive tree as (
      select c.id from public.public_categories c where c.slug = p_category_slug
      union
      select c.id from public.public_categories c join tree t on c.parent_id = t.id
    )
    select array_agg(id) into v_cat_ids from tree;
    if v_cat_ids is null then
      return jsonb_build_object('total', 0, 'items', '[]'::jsonb);
    end if;
  end if;
  if p_collection_slug is not null then
    select c.id into v_collection from public.public_collections c where c.slug = p_collection_slug;
    if v_collection is null then
      return jsonb_build_object('total', 0, 'items', '[]'::jsonb);
    end if;
  end if;

  with filtered as (
    select pp.*
      from public.public_products pp
     where (v_cat_ids is null or exists (
             select 1 from public.public_product_categories pc
              where pc.product_id = pp.id and pc.category_id = any (v_cat_ids)))
       and (v_collection is null or exists (
             select 1 from public.public_product_collections pcl
              where pcl.product_id = pp.id and pcl.collection_id = v_collection))
       and (p_min_price is null or pp.price_bob >= p_min_price)
       and (p_max_price is null or pp.price_bob <= p_max_price)
       and (not v_stock or not pp.sold_out)
       and ((v_colors is null and v_sizes is null) or exists (
             select 1
               from public.public_product_variants v
               join public.public_product_colors c on c.id = v.color_id
               left join public.public_product_sizes s on s.id = v.size_id
              where v.product_id = pp.id
                and (v_colors is null or public.f_unaccent(lower(btrim(c.name))) = any (v_colors))
                and (v_sizes is null or public.f_unaccent(lower(btrim(s.label))) = any (v_sizes))
                and (not v_stock or v.stock_status <> 'out')))
  ),
  ranked as (
    select f.*,
           row_number() over (
             order by
               case when v_sort = 'price_asc' then f.price_bob end asc,
               case when v_sort = 'price_desc' then f.price_bob end desc,
               case when v_sort = 'name' then public.f_unaccent(lower(f.name)) end asc,
               case when v_sort = 'newest' then f.created_at end desc,
               f.id
           ) as rn
      from filtered f
  )
  select jsonb_build_object(
           'total', (select count(*) from filtered),
           'items', coalesce(
             (select jsonb_agg(to_jsonb(r) - 'rn' order by r.rn)
                from ranked r where r.rn > v_offset and r.rn <= v_offset + v_limit),
             '[]'::jsonb))
    into v_result;
  return v_result;
end;
$$;

-- Opciones de filtro disponibles para una categoría/colección (sin aplicar los demás filtros):
-- colores (nombre, hex, nº de productos), tallas (etiqueta, nº de productos) y rango de precio.
create or replace function public.public_listing_facets(
  p_category_slug text default null,
  p_collection_slug text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cat_ids uuid[];
  v_collection uuid;
  v_ids uuid[];
begin
  if p_category_slug is not null then
    with recursive tree as (
      select c.id from public.public_categories c where c.slug = p_category_slug
      union
      select c.id from public.public_categories c join tree t on c.parent_id = t.id
    )
    select array_agg(id) into v_cat_ids from tree;
    if v_cat_ids is null then
      return jsonb_build_object('colors', '[]'::jsonb, 'sizes', '[]'::jsonb, 'price_min', null, 'price_max', null);
    end if;
  end if;
  if p_collection_slug is not null then
    select c.id into v_collection from public.public_collections c where c.slug = p_collection_slug;
    if v_collection is null then
      return jsonb_build_object('colors', '[]'::jsonb, 'sizes', '[]'::jsonb, 'price_min', null, 'price_max', null);
    end if;
  end if;

  select coalesce(array_agg(pp.id), '{}') into v_ids
    from public.public_products pp
   where (v_cat_ids is null or exists (
           select 1 from public.public_product_categories pc
            where pc.product_id = pp.id and pc.category_id = any (v_cat_ids)))
     and (v_collection is null or exists (
           select 1 from public.public_product_collections pcl
            where pcl.product_id = pp.id and pcl.collection_id = v_collection));

  return jsonb_build_object(
    'colors', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'hex', t.hex, 'count', t.n) order by t.key)
        from (select public.f_unaccent(lower(btrim(c.name))) as key,
                     min(btrim(c.name)) as name,
                     min(c.hex) as hex,
                     count(distinct c.product_id) as n
                from public.public_product_colors c
               where c.product_id = any (v_ids)
               group by public.f_unaccent(lower(btrim(c.name)))) t), '[]'::jsonb),
    'sizes', coalesce((
      select jsonb_agg(jsonb_build_object('label', t.label, 'count', t.n) order by t.pos, t.key)
        from (select public.f_unaccent(lower(btrim(s.label))) as key,
                     min(btrim(s.label)) as label,
                     min(s.sort_order) as pos,
                     count(distinct s.product_id) as n
                from public.public_product_sizes s
               where s.product_id = any (v_ids)
               group by public.f_unaccent(lower(btrim(s.label)))) t), '[]'::jsonb),
    'price_min', (select min(pp.price_bob) from public.public_products pp where pp.id = any (v_ids)),
    'price_max', (select max(pp.price_bob) from public.public_products pp where pp.id = any (v_ids)));
end;
$$;

revoke all on function public.public_list_products(text, text, text[], text[], numeric, numeric, boolean, text, int, int),
                       public.public_listing_facets(text, text) from public;
grant execute on function public.public_list_products(text, text, text[], text[], numeric, numeric, boolean, text, int, int),
                          public.public_listing_facets(text, text)
  to anon, authenticated, service_role;

-- ── Búsqueda tolerante a errores de tipeo ──────────────────────────────────────────────────
-- Misma firma y mismas columnas que la de S2; añade una coincidencia aproximada (trigramas: «chaquta» encuentra
-- «Chaqueta»; una letra de menos a mitad de palabra da ≈ 0,55; «cuero» vs «sombrero» da 0,50 y se descarta). Solo para consultas de 5+ caracteres y con umbral alto (0,52) para no devolver ruido: con 4
-- letras «rojo» ya traería «roja» y el prefijo «chaq» traería «Chakra». Primero salen,
-- como antes, el código exacto y los nombres que empiezan igual; la aproximada va al final.
create or replace function public.public_search_products(p_query text, p_limit int default 24)
returns setof public.public_products
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Se recorta a 80 caracteres: la llama anon y una consulta de cientos de KB sería un amplificador de CPU barato.
  v_q text := left(public.f_unaccent(lower(btrim(left(coalesce(p_query, ''), 400)))), 80);
  v_esc text;
begin
  if char_length(v_q) < 2 then
    return;
  end if;
  v_esc := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select pp.*
      from public.public_products pp
      join public.products p on p.id = pp.id
     where public.f_unaccent(lower(p.name)) like '%' || v_esc || '%'
        or public.f_unaccent(lower(coalesce(p.model, ''))) like '%' || v_esc || '%'
        or lower(p.code) like '%' || v_esc || '%'
        or (char_length(v_q) >= 5
            and extensions.word_similarity(v_q, public.f_unaccent(lower(p.name))) >= 0.52)
     order by (lower(p.code) = v_q) desc,
              (public.f_unaccent(lower(p.name)) like v_esc || '%') desc,
              (public.f_unaccent(lower(p.name)) like '%' || v_esc || '%') desc,
              extensions.similarity(public.f_unaccent(lower(p.name)), v_q) desc,
              pp.name
     limit greatest(1, least(coalesce(p_limit, 24), 100));
end;
$$;
revoke all on function public.public_search_products(text, int) from public;
grant execute on function public.public_search_products(text, int) to anon, authenticated, service_role;
