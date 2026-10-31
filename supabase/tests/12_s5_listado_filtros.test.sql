-- Sprint 5 · public_list_products y public_listing_facets: filtros combinados, orden, paginación, acotado de entradas
-- y que NUNCA aparezca nada oculto. Valores esperados calculados a mano sobre el fixture de abajo.
begin;
select plan(75);

alter table public.stock_movements disable trigger user;
alter table public.exchange_rates disable trigger user;
alter table public.product_slug_history disable trigger user;
truncate public.products, public.categories, public.collections, public.news_banners, public.home_sections,
         public.exchange_rates restart identity cascade;
alter table public.stock_movements enable trigger user;
alter table public.exchange_rates enable trigger user;
alter table public.product_slug_history enable trigger user;

-- ── Fixture ────────────────────────────────────────────────────────────────────────────────
-- Visibles: P1 Chaqueta Roja (100, rojo/azul · S/M) · P2 Sombrero Rojo (250) · P3 Cartera Azul (50, agotada)
--           P4 Ábaco Verde (400, talla M)
-- Ocultos:  P5 agotado+hide · P6 borrador · P7 archivado (los tres tienen color «Rojo»)
insert into public.products (id, code, slug, name, cost_base, out_of_stock_behavior) values
  ('b5000000-0000-0000-0000-000000000001', 'CHQ-1', 'chaqueta-roja',   'Chaqueta Roja',   10, 'sold_out'),
  ('b5000000-0000-0000-0000-000000000002', 'SMB-1', 'sombrero-rojo',   'Sombrero Rojo',   10, 'sold_out'),
  ('b5000000-0000-0000-0000-000000000003', 'CRT-1', 'cartera-azul',    'Cartera Azul',    10, 'sold_out'),
  ('b5000000-0000-0000-0000-000000000004', 'ABA-1', 'abaco-verde',     'Ábaco Verde',     10, 'sold_out'),
  ('b5000000-0000-0000-0000-000000000005', 'HID-1', 'agotado-oculto',  'Agotado oculto',  10, 'hide'),
  ('b5000000-0000-0000-0000-000000000006', 'DRF-1', 'borrador',        'Borrador',        10, 'sold_out'),
  ('b5000000-0000-0000-0000-000000000007', 'ARC-1', 'archivado',       'Archivado',       10, 'sold_out');
insert into public.product_colors (id, product_id, name, hex) values
  ('c5000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000001', 'Rojo',  '#C00000'),
  ('c5000000-0000-0000-0000-000000000002', 'b5000000-0000-0000-0000-000000000001', 'Azul',  '#0000C0'),
  ('c5000000-0000-0000-0000-000000000003', 'b5000000-0000-0000-0000-000000000002', 'Rojo',  '#C00001'),
  ('c5000000-0000-0000-0000-000000000004', 'b5000000-0000-0000-0000-000000000003', 'Azúl',  null),
  ('c5000000-0000-0000-0000-000000000005', 'b5000000-0000-0000-0000-000000000004', 'Verde', null),
  ('c5000000-0000-0000-0000-000000000006', 'b5000000-0000-0000-0000-000000000005', 'Rojo',  null),
  ('c5000000-0000-0000-0000-000000000007', 'b5000000-0000-0000-0000-000000000006', 'Rojo',  null),
  ('c5000000-0000-0000-0000-000000000008', 'b5000000-0000-0000-0000-000000000007', 'Rojo',  null);
insert into public.product_sizes (id, product_id, label, sort_order) values
  ('d5000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000001', 'S', 1),
  ('d5000000-0000-0000-0000-000000000002', 'b5000000-0000-0000-0000-000000000001', 'M', 2),
  ('d5000000-0000-0000-0000-000000000003', 'b5000000-0000-0000-0000-000000000004', 'M', 5);
insert into public.product_variants (id, product_id, color_id, size_id) values
  ('e5000000-0000-0000-0000-000000000011', 'b5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001'), -- Rojo-S
  ('e5000000-0000-0000-0000-000000000012', 'b5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000002'), -- Rojo-M
  ('e5000000-0000-0000-0000-000000000013', 'b5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002', 'd5000000-0000-0000-0000-000000000001'), -- Azul-S (no hay Azul-M)
  ('e5000000-0000-0000-0000-000000000002', 'b5000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000003', null),
  ('e5000000-0000-0000-0000-000000000003', 'b5000000-0000-0000-0000-000000000003', 'c5000000-0000-0000-0000-000000000004', null),
  ('e5000000-0000-0000-0000-000000000004', 'b5000000-0000-0000-0000-000000000004', 'c5000000-0000-0000-0000-000000000005', 'd5000000-0000-0000-0000-000000000003'),
  ('e5000000-0000-0000-0000-000000000005', 'b5000000-0000-0000-0000-000000000005', 'c5000000-0000-0000-0000-000000000006', null),
  ('e5000000-0000-0000-0000-000000000006', 'b5000000-0000-0000-0000-000000000006', 'c5000000-0000-0000-0000-000000000007', null),
  ('e5000000-0000-0000-0000-000000000007', 'b5000000-0000-0000-0000-000000000007', 'c5000000-0000-0000-0000-000000000008', null);
insert into public.product_prices (product_id, currency, amount) values
  ('b5000000-0000-0000-0000-000000000001', 'BOB', 100),
  ('b5000000-0000-0000-0000-000000000002', 'BOB', 250),
  ('b5000000-0000-0000-0000-000000000003', 'BOB', 50),
  ('b5000000-0000-0000-0000-000000000004', 'BOB', 400),
  ('b5000000-0000-0000-0000-000000000005', 'BOB', 100),
  ('b5000000-0000-0000-0000-000000000006', 'BOB', 100),
  ('b5000000-0000-0000-0000-000000000007', 'BOB', 100);
update public.products set status = 'active' where code <> 'DRF-1';
update public.products set archived_at = now() where code = 'ARC-1';
select public.apply_stock_change('e5000000-0000-0000-0000-000000000011', 5, 'import');   -- Rojo-S: 5
-- Rojo-M (…12): 0 · Azul-S (…13): 2
select public.apply_stock_change('e5000000-0000-0000-0000-000000000013', 2, 'import');
select public.apply_stock_change('e5000000-0000-0000-0000-000000000002', 3, 'import');   -- Sombrero: 3
-- Cartera (…03): 0 → agotada pero visible
select public.apply_stock_change('e5000000-0000-0000-0000-000000000004', 4, 'import');   -- Ábaco: 4
select public.apply_stock_change('e5000000-0000-0000-0000-000000000006', 3, 'import');   -- borrador con stock
select public.apply_stock_change('e5000000-0000-0000-0000-000000000007', 3, 'import');   -- archivado con stock
update public.products set created_at = '2026-01-04' where code = 'CHQ-1';
update public.products set created_at = '2026-01-03' where code = 'SMB-1';
update public.products set created_at = '2026-01-02' where code = 'CRT-1';
update public.products set created_at = '2026-01-01' where code = 'ABA-1';

insert into public.categories (id, name, slug, parent_id, archived_at) values
  ('ca500000-0000-0000-0000-000000000001', 'Ropa',        'ropa',        null, null),
  ('ca500000-0000-0000-0000-000000000002', 'Accesorios',  'accesorios',  null, null),
  ('ca500000-0000-0000-0000-000000000003', 'Sombreros',   'sombreros',   'ca500000-0000-0000-0000-000000000002', null),
  ('ca500000-0000-0000-0000-000000000004', 'Vieja',       'vieja',       null, now());
insert into public.product_categories (product_id, category_id) values
  ('b5000000-0000-0000-0000-000000000001', 'ca500000-0000-0000-0000-000000000001'),
  ('b5000000-0000-0000-0000-000000000002', 'ca500000-0000-0000-0000-000000000003'),
  ('b5000000-0000-0000-0000-000000000003', 'ca500000-0000-0000-0000-000000000002'),
  ('b5000000-0000-0000-0000-000000000004', 'ca500000-0000-0000-0000-000000000001'),
  ('b5000000-0000-0000-0000-000000000005', 'ca500000-0000-0000-0000-000000000003'),
  ('b5000000-0000-0000-0000-000000000006', 'ca500000-0000-0000-0000-000000000001'),
  ('b5000000-0000-0000-0000-000000000001', 'ca500000-0000-0000-0000-000000000004');
insert into public.collections (id, name, slug, ends_at) values
  ('c0500000-0000-0000-0000-000000000001', 'Verano',  'verano',  null),
  ('c0500000-0000-0000-0000-000000000002', 'Vencida', 'vencida', now() - interval '1 day');
insert into public.product_collections (product_id, collection_id) values
  ('b5000000-0000-0000-0000-000000000001', 'c0500000-0000-0000-0000-000000000001'),
  ('b5000000-0000-0000-0000-000000000002', 'c0500000-0000-0000-0000-000000000001'),
  ('b5000000-0000-0000-0000-000000000001', 'c0500000-0000-0000-0000-000000000002');

-- Todo lo que sigue corre COMO anon: es el rol real del navegador.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

-- ── Sin filtros ────────────────────────────────────────────────────────────────────────────
select is((public.public_list_products() ->> 'total')::int, 4, 'sin filtros: solo los 4 visibles (ni oculto, ni borrador, ni archivado)');
select is(jsonb_path_query_array(public.public_list_products() -> 'items', '$[*].name'),
  '["Chaqueta Roja","Sombrero Rojo","Cartera Azul","Ábaco Verde"]'::jsonb, 'orden por defecto: los más nuevos primero');
select is(jsonb_path_query_array(public.public_list_products(p_sort => 'price_asc') -> 'items', '$[*].name'),
  '["Cartera Azul","Chaqueta Roja","Sombrero Rojo","Ábaco Verde"]'::jsonb, 'precio ascendente (50, 100, 250, 400)');
select is(jsonb_path_query_array(public.public_list_products(p_sort => 'price_desc') -> 'items', '$[*].name'),
  '["Ábaco Verde","Sombrero Rojo","Chaqueta Roja","Cartera Azul"]'::jsonb, 'precio descendente');
select is(jsonb_path_query_array(public.public_list_products(p_sort => 'name') -> 'items', '$[*].name'),
  '["Ábaco Verde","Cartera Azul","Chaqueta Roja","Sombrero Rojo"]'::jsonb, 'por nombre SIN acentos: «Ábaco» va primero (por bytes iría al final)');
select is(public.public_list_products(p_sort => 'x; drop table products') -> 'items',
          public.public_list_products() -> 'items', 'un orden desconocido (o malicioso) cae al orden por defecto');
select is((select array_agg(k order by k) from jsonb_object_keys((public.public_list_products() -> 'items') -> 0) k),
  array['colors_count','cover_alt','cover_path','created_at','id','is_new','name','price_bob','slug','sold_out'],
  'cada ítem trae exactamente las columnas de la vista pública: ni costo ni stock');

-- ── Categoría y colección ──────────────────────────────────────────────────────────────────
select is((public.public_list_products(p_category_slug => 'ropa') ->> 'total')::int, 2, 'ropa: P1 y P4 (el borrador P6 no cuenta)');
select is((public.public_list_products(p_category_slug => 'accesorios') ->> 'total')::int, 2,
  'accesorios incluye sus subcategorías: P3 y el sombrero P2 (el oculto P5 no)');
select is(jsonb_path_query_array(public.public_list_products(p_category_slug => 'sombreros') -> 'items', '$[*].name'),
  '["Sombrero Rojo"]'::jsonb, 'sombreros (hija): solo P2 visible');
select is((public.public_list_products(p_category_slug => 'no-existe') ->> 'total')::int, 0, 'categoría inexistente → vacío, sin error');
select is((public.public_list_products(p_category_slug => 'vieja') ->> 'total')::int, 0, 'categoría archivada → vacío');
select is((public.public_list_products(p_collection_slug => 'verano') ->> 'total')::int, 2, 'colección verano: P1 y P2');
select is((public.public_list_products(p_collection_slug => 'vencida') ->> 'total')::int, 0, 'colección vencida → vacío');
select is((public.public_list_products(p_category_slug => 'ropa', p_collection_slug => 'verano') ->> 'total')::int, 1,
  'ropa ∩ verano = solo P1');

-- ── Color y talla ──────────────────────────────────────────────────────────────────────────
select is(jsonb_path_query_array(public.public_list_products(p_colors => array['rojo']) -> 'items', '$[*].name'),
  '["Chaqueta Roja","Sombrero Rojo"]'::jsonb, 'color rojo: P1 y P2 (los ocultos con «Rojo» no entran)');
select is(public.public_list_products(p_colors => array['ROJO']) -> 'items', public.public_list_products(p_colors => array['rojo']) -> 'items', 'color sin distinguir mayúsculas');
select is(public.public_list_products(p_colors => array['Rójo']) -> 'items', public.public_list_products(p_colors => array['rojo']) -> 'items', 'color sin distinguir acentos');
select is((public.public_list_products(p_colors => array['verde', 'azul']) ->> 'total')::int, 3, 'varios colores = O: P1 (azul), P3 (azul) y P4 (verde)');
select is(jsonb_path_query_array(public.public_list_products(p_sizes => array['m']) -> 'items', '$[*].name'),
  '["Chaqueta Roja","Ábaco Verde"]'::jsonb, 'talla M (aunque Rojo-M no tenga stock): P1 y P4');
select is(jsonb_path_query_array(public.public_list_products(p_sizes => array['S']) -> 'items', '$[*].name'),
  '["Chaqueta Roja"]'::jsonb, 'talla S: solo P1');
select is((public.public_list_products(p_colors => array['azul'], p_sizes => array['m']) ->> 'total')::int, 0,
  'azul + M = NADA: P1 tiene Azul y tiene M, pero no la variante Azul-M (el filtro mira la MISMA variante)');
select is(jsonb_path_query_array(public.public_list_products(p_colors => array['rojo'], p_sizes => array['m']) -> 'items', '$[*].name'),
  '["Chaqueta Roja"]'::jsonb, 'rojo + M: sí existe la variante Rojo-M');
select is((public.public_list_products(p_category_slug => 'ropa', p_colors => array['verde']) ->> 'total')::int, 1, 'ropa + verde = P4');

-- ── Solo disponibles ───────────────────────────────────────────────────────────────────────
select is(jsonb_path_query_array(public.public_list_products(p_in_stock_only => true) -> 'items', '$[*].name'),
  '["Chaqueta Roja","Sombrero Rojo","Ábaco Verde"]'::jsonb, 'solo disponibles: sin la cartera agotada');
select is((public.public_list_products(p_colors => array['rojo'], p_sizes => array['m'], p_in_stock_only => true) ->> 'total')::int, 0,
  'rojo + M + solo disponibles: la variante Rojo-M tiene stock 0 → nada');
select is(jsonb_path_query_array(public.public_list_products(p_colors => array['rojo'], p_sizes => array['s'], p_in_stock_only => true) -> 'items', '$[*].name'),
  '["Chaqueta Roja"]'::jsonb, 'rojo + S + solo disponibles: Rojo-S tiene 5');
select is(jsonb_path_query_array(public.public_list_products(p_colors => array['azul'], p_in_stock_only => true) -> 'items', '$[*].name'),
  '["Chaqueta Roja"]'::jsonb, 'azul + solo disponibles: P1 (Azul-S: 2) sí; la cartera azul (0) no');

-- ── Precio ─────────────────────────────────────────────────────────────────────────────────
select is(jsonb_path_query_array(public.public_list_products(p_min_price => 100) -> 'items', '$[*].name'),
  '["Chaqueta Roja","Sombrero Rojo","Ábaco Verde"]'::jsonb, 'mínimo 100 es inclusivo');
select is(jsonb_path_query_array(public.public_list_products(p_max_price => 100) -> 'items', '$[*].name'),
  '["Chaqueta Roja","Cartera Azul"]'::jsonb, 'máximo 100 es inclusivo');
select is(jsonb_path_query_array(public.public_list_products(p_min_price => 100, p_max_price => 250) -> 'items', '$[*].name'),
  '["Chaqueta Roja","Sombrero Rojo"]'::jsonb, 'rango 100–250');
select is((public.public_list_products(p_min_price => 300, p_max_price => 100) ->> 'total')::int, 0, 'rango invertido → vacío, sin error');

-- ── Paginación ─────────────────────────────────────────────────────────────────────────────
select is(jsonb_path_query_array(public.public_list_products(p_limit => 2, p_offset => 0) -> 'items', '$[*].name'),
  '["Chaqueta Roja","Sombrero Rojo"]'::jsonb, 'página 1 de tamaño 2');
select is(jsonb_path_query_array(public.public_list_products(p_limit => 2, p_offset => 2) -> 'items', '$[*].name'),
  '["Cartera Azul","Ábaco Verde"]'::jsonb, 'página 2 de tamaño 2');
select is((public.public_list_products(p_limit => 2, p_offset => 2) ->> 'total')::int, 4, 'el total no depende de la página');
select is(public.public_list_products(p_limit => 2, p_offset => 4), '{"total": 4, "items": []}'::jsonb,
  'una página pasada del final: ítems vacíos PERO total exacto (no error 416 como con el rango HTTP)');
select is((public.public_list_products(p_limit => 0) -> 'items' -> 0 ->> 'name'), 'Chaqueta Roja', 'límite 0 se acota a 1');
select is(public.public_list_products(p_offset => -5) -> 'items', public.public_list_products() -> 'items', 'desplazamiento negativo = 0');
select is(jsonb_array_length(public.public_list_products(p_limit => null, p_offset => null) -> 'items'), 4, 'nulos usan los valores por defecto');
select is(public.public_list_products(p_sort => 'price_asc', p_limit => 2, p_offset => 1) -> 'items',
  jsonb_path_query_array(public.public_list_products(p_sort => 'price_asc') -> 'items', '$[1 to 2]'),
  'paginar con orden: el trozo coincide con la lista completa ordenada');

-- ── Entradas hostiles ──────────────────────────────────────────────────────────────────────
select is((public.public_list_products(p_colors => array['%']) ->> 'total')::int, 0, 'el comodín % no es comodín: no coincide con nada');
select is((public.public_list_products(p_colors => array['', '   ']) ->> 'total')::int, 4, 'colores vacíos o solo espacios se ignoran (no filtran)');
select is((public.public_list_products(p_colors => array_fill('zzz'::text, array[25])) ->> 'total')::int, 0, 'una lista enorme de colores no rompe');
select is((public.public_list_products(p_colors => array[repeat('a', 500)]) ->> 'total')::int, 0, 'un color de 500 caracteres no rompe');
select is((public.public_list_products(p_category_slug => $$'; drop table products; --$$) ->> 'total')::int, 0, 'un slug con SQL no hace nada');

-- ── Búsqueda tolerante a errores de tipeo (public_search_products, mejorada en S5) ─────────
select is(jsonb_path_query_array(to_jsonb(array(select name from public.public_search_products('chaqueta'))), '$[*]'),
  '["Chaqueta Roja"]'::jsonb, 'búsqueda exacta: «chaqueta» encuentra la chaqueta');
select is(jsonb_path_query_array(to_jsonb(array(select name from public.public_search_products('chaquta'))), '$[*]'),
  '["Chaqueta Roja"]'::jsonb, 'con un error de tipeo («chaquta») igual la encuentra (trigramas)');
select is(jsonb_path_query_array(to_jsonb(array(select name from public.public_search_products('chaqeta'))), '$[*]'),
  '["Chaqueta Roja"]'::jsonb, 'una letra de menos a mitad de palabra («chaqeta») también la encuentra (similitud ≈ 0,545, por encima del umbral)');
select is(jsonb_path_query_array(to_jsonb(array(select name from public.public_search_products('CHÁQUETA'))), '$[*]'),
  '["Chaqueta Roja"]'::jsonb, 'sin distinguir mayúsculas ni acentos');
select is((select count(*)::int from public.public_search_products('zzzzzzzz')), 0, 'una palabra sin parecido no devuelve ruido');
select is((select count(*)::int from public.public_search_products('x')), 0, 'menos de 2 caracteres: nada');
select is((select count(*)::int from public.public_search_products('%')), 0, 'el comodín % se escapa');
select is(jsonb_path_query_array(to_jsonb(array(select name from public.public_search_products('cartra'))), '$[*]'),
  '["Cartera Azul"]'::jsonb, 'otro error de tipeo («cartra»)');
select is(jsonb_path_query_array(to_jsonb(array(select name from public.public_search_products('rojo'))), '$[*]'),
  '["Sombrero Rojo"]'::jsonb, 'con 4 letras NO hay aproximación: «rojo» no trae «Roja» (menos ruido)');
select is((select count(*)::int from public.public_search_products('agotado oculto')), 0, 'los productos ocultos no se encuentran ni por búsqueda aproximada');

-- ── Facetas ────────────────────────────────────────────────────────────────────────────────
select is(public.public_listing_facets() -> 'colors',
  '[{"name":"Azul","hex":"#0000C0","count":2},{"name":"Rojo","hex":"#C00000","count":2},{"name":"Verde","hex":null,"count":1}]'::jsonb,
  'facetas de color: «Azul» y «Azúl» se agrupan en uno (P1, P3), Rojo (P1, P2; los ocultos NO cuentan) y Verde, con el primer hex no nulo');
select is(public.public_listing_facets() -> 'sizes', '[{"label":"S","count":1},{"label":"M","count":2}]'::jsonb,
  'facetas de talla: S (1 producto) y M (2), en el orden del admin');
select is(public.public_listing_facets() -> 'price_min', '50'::jsonb, 'precio mínimo del catálogo visible');
select is(public.public_listing_facets() -> 'price_max', '400'::jsonb, 'precio máximo del catálogo visible');
select is(public.public_listing_facets(p_category_slug => 'accesorios') -> 'colors',
  '[{"name":"Azúl","hex":null,"count":1},{"name":"Rojo","hex":"#C00001","count":1}]'::jsonb, 'facetas acotadas a una categoría (con subcategorías)');
select is(public.public_listing_facets(p_category_slug => 'no-existe'),
  '{"colors":[],"sizes":[],"price_min":null,"price_max":null}'::jsonb, 'categoría inexistente → facetas vacías');

reset role;
-- ── Tope de página (hacen falta más de 100 visibles para que se note) ─────────────────────
insert into public.products (id, code, slug, name, cost_base, out_of_stock_behavior)
  select ('b6000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'BULK-' || i, 'bulk-' || i, 'Bulk ' || i, 1, 'sold_out'
    from generate_series(101, 1, -1) i;
insert into public.product_colors (id, product_id, name)
  select ('c6000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, ('b6000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'Gris'
    from generate_series(1, 101) i;
insert into public.product_variants (id, product_id, color_id)
  select ('e6000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, ('b6000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
         ('c6000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid
    from generate_series(1, 101) i;
insert into public.product_prices (product_id, currency, amount)
  select ('b6000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'BOB', 10 from generate_series(1, 101) i;
update public.products set status = 'active' where code like 'BULK-%';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(jsonb_array_length(public.public_list_products(p_limit => 1000) -> 'items'), 100, 'límite 1000 se acota a 100 (con 105 visibles)');
select is((public.public_list_products(p_limit => 1000) ->> 'total')::int, 105, 'el total sigue siendo exacto con más de 100');
select is(jsonb_array_length(public.public_list_products(p_limit => 100, p_offset => 100) -> 'items'), 5, 'la segunda página de 100 trae los 5 restantes');
select is(jsonb_path_query_array(public.public_list_products(p_sort => 'price_asc', p_limit => 3) -> 'items', '$[*].name'),
  '["Bulk 1","Bulk 2","Bulk 3"]'::jsonb, 'con precios EMPATADOS (101 a Bs 10) manda el id: orden estable aunque se insertaran al revés');
select is(jsonb_path_query_array(public.public_list_products(p_sort => 'price_asc', p_limit => 3, p_offset => 3) -> 'items', '$[*].name'),
  '["Bulk 4","Bulk 5","Bulk 6"]'::jsonb, 'y la página siguiente continúa donde terminó la anterior (sin repetir ni saltar)');
select is((public.public_list_products(
    p_colors => (select array_agg('x' || g) from generate_series(1, 20) g) || array['rojo']) ->> 'total')::int, 0,
  'solo se miran los primeros 20 colores: «rojo» como 21.º valor se descarta (acotado de entradas)');
select is((public.public_list_products(
    p_colors => (select array_agg('x' || g) from generate_series(1, 19) g) || array['rojo']) ->> 'total')::int, 2,
  'con 19 valores de relleno «rojo» es el 20.º y sí cuenta');

select is(public.public_list_products(p_offset => 2147483647), '{"total": 105, "items": []}'::jsonb,
  'un desplazamiento enorme (2^31 - 1) no desborda el entero: total exacto y página vacía');
select is(public.public_list_products(p_limit => 100, p_offset => 2147483600), '{"total": 105, "items": []}'::jsonb,
  'tampoco con límite 100 y desplazamiento cercano a 2^31');
select is((public.public_list_products(p_colors => array[repeat('x', 2000000)]) ->> 'total')::int, 0,
  'un color de 2 MB se recorta antes de procesarse y no coincide con nada');
select is((public.public_list_products(p_colors => array['rojo' || repeat(' ', 2000000)]) ->> 'total')::int, 2,
  'recortar a 200 caracteres no cambia el resultado: «rojo» + 2 MB de espacios sigue encontrando los 2 rojos visibles');
select is((public.public_list_products(p_colors => array_fill(' '::text, array[1000000])) ->> 'total')::int, 105,
  'un millón de elementos vacíos no filtra nada (todos se descartan) y responde sin error');

-- Coste: un valor de 2 MB no debe costar mucho más que uno normal (antes del recorte previo costaba ~30 veces más).
-- Se compara contra el propio coste de una llamada normal, no contra un tiempo absoluto, para no depender de la máquina.
do $$
declare
  t0 timestamptz;
  small_ms numeric;
  big_ms numeric;
begin
  perform public.public_list_products(p_colors => array['rojo']);   -- calienta el plan
  t0 := clock_timestamp();
  for i in 1..5 loop perform public.public_list_products(p_colors => array['rojo']); end loop;
  small_ms := extract(epoch from clock_timestamp() - t0) * 1000;
  t0 := clock_timestamp();
  for i in 1..5 loop perform public.public_list_products(p_colors => array[repeat('x', 2000000)]); end loop;
  big_ms := extract(epoch from clock_timestamp() - t0) * 1000;
  perform set_config('s5.cost_ok', (big_ms < small_ms * 2 + 40)::text, true);
end $$;
select is(current_setting('s5.cost_ok'), 'true', 'un color de 2 MB cuesta como uno normal (recorte previo al procesado)');

reset role;
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('public_list_products', 'public_listing_facets')
              and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')), 2,
  'ambas son SECURITY DEFINER con search_path fijo');

select * from finish();
rollback;
