-- Sprint 2 · Productos: restricciones, regla de publicación, variantes (NULL en talla), integridad entre
-- producto/color/talla, imágenes, precios, RPC de asociaciones, "nunca se borra" y matriz RLS.
begin;
select plan(117);

alter table public.stock_movements disable trigger user;
alter table public.exchange_rates disable trigger user;
truncate public.products, public.categories, public.collections, public.news_banners, public.home_sections,
         public.exchange_rates restart identity cascade;
alter table public.stock_movements enable trigger user;
alter table public.exchange_rates enable trigger user;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('c0000000-0000-0000-0000-0000000000c1', 'cliente.s2@test.com', '{"full_name":"Cliente S2"}', 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-0000000000a1', 'admin.s2@test.com',   '{"full_name":"Admin S2"}',   'authenticated', 'authenticated');
select public.set_user_role('a0000000-0000-0000-0000-0000000000a1', 'admin');

-- ── Fixture: dos productos con colores y tallas ────────────────────────────────────────────
insert into public.products (id, code, slug, name) values
  ('b0000000-0000-0000-0000-000000000001', 'CHQ-001', 'chaqueta-japandi', 'Chaqueta Japandi'),
  ('b0000000-0000-0000-0000-000000000002', 'SMB-001', 'sombrero-chakra',  'Sombrero Chakra'),
  ('b0000000-0000-0000-0000-000000000003', 'CRT-001', 'cartera-verde',    'Cartera Verde');
insert into public.product_colors (id, product_id, name, hex) values
  ('d1000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000001', 'Blanco', '#EAE9E1'),
  ('d1000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-000000000001', 'Negro',  '#303030'),
  ('d2000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000002', 'Rojo',   '#C0392B');
insert into public.product_sizes (id, product_id, label, sort_order) values
  ('e1000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000001', 'XS', 1),
  ('e1000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-000000000001', 'S',  2),
  ('e2000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000002', 'M',  1);

-- ── Restricciones del producto ─────────────────────────────────────────────────────────────
select throws_ok($$insert into public.products (code, slug, name) values ('mal codigo', 'x1', 'X')$$, '23514', null, 'código con espacios rechazado');
select throws_ok($$insert into public.products (code, slug, name) values ('X1', 'Slug_Malo', 'X')$$, '23514', null, 'slug con mayúsculas/guion bajo rechazado');
select throws_ok($$insert into public.products (code, slug, name) values ('X2', 'chaqueta-japandi', 'X')$$, '23505', null, 'slug duplicado rechazado');
select throws_ok($$insert into public.products (code, slug, name) values ('CHQ-001', 'otro-slug', 'X')$$, '23505', null, 'código duplicado rechazado');
select throws_ok($$insert into public.products (code, slug, name, out_of_stock_behavior) values ('X3', 'x3', 'X', 'borrar')$$, '23514', null, 'comportamiento de agotado inválido rechazado');
select throws_ok($$insert into public.products (code, slug, name, cost_base) values ('X4', 'x4', 'X', -1)$$, '23514', null, 'costo negativo rechazado');
select throws_ok($$insert into public.products (code, slug, name, cost_base) values ('X5', 'x5', 'X', 10.999)$$, '23514', null, 'costo con 3 decimales rechazado (no se redondea en silencio)');
select lives_ok($$insert into public.products (code, slug, name, cost_base) values ('X6', 'x6', 'X', 10.50)$$, 'costo con 2 decimales aceptado');
update public.products set archived_at = now() where code = 'X6';
select throws_ok($$insert into public.products (code, slug, name) values ('X6', 'x6-bis', 'X')$$, '23505', null, 'el código de un producto ARCHIVADO sigue reservado (BR-CAT-06)');
select throws_ok($$insert into public.products (code, slug, name) values ('X6B', 'x6', 'X')$$, '23505', null, 'el slug de un producto ARCHIVADO sigue reservado (BR-CAT-06)');

-- ── Regla de publicación ───────────────────────────────────────────────────────────────────
select throws_ok($$insert into public.products (code, slug, name, status) values ('P1', 'p1', 'P1', 'active')$$, '23514', null, 'no se crea un producto ya "active": se crea en borrador');
select throws_ok($$update public.products set status = 'active' where code = 'CHQ-001'$$, '23514', null, 'no se publica sin variantes');
insert into public.product_variants (id, product_id, color_id, size_id) values
  ('f1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a');
select throws_ok($$update public.products set status = 'active' where code = 'CHQ-001'$$, '23514', null, 'con variante pero sin precio en BOB tampoco se publica');
insert into public.product_prices (product_id, currency, amount) values ('b0000000-0000-0000-0000-000000000001', 'USD', 20);
select throws_ok($$update public.products set status = 'active' where code = 'CHQ-001'$$, '23514', null, 'un precio en USD no sustituye al precio en BOB');
insert into public.product_prices (product_id, currency, amount) values ('b0000000-0000-0000-0000-000000000001', 'BOB', 560);
select lives_ok($$update public.products set status = 'active' where code = 'CHQ-001'$$, 'con variante y precio BOB se publica');

-- ── Variantes ──────────────────────────────────────────────────────────────────────────────
select is((select sku from public.product_variants where id = 'f1000000-0000-0000-0000-000000000001'), 'CHQ-001-BLANCO-XS', 'SKU automático CODIGO-COLOR-TALLA');
insert into public.product_variants (id, product_id, color_id) values
  ('f1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000b');
select is((select sku from public.product_variants where id = 'f1000000-0000-0000-0000-000000000002'), 'CHQ-001-NEGRO', 'SKU automático sin talla');
select throws_ok($$insert into public.product_variants (product_id, color_id) values ('b0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000b')$$,
  '23505', null, 'misma (producto, color) SIN talla dos veces rechazada (un UNIQUE normal dejaría pasar el NULL)');
select throws_ok($$insert into public.product_variants (product_id, color_id, size_id, sku) values ('b0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'OTRO-SKU')$$,
  '23505', null, 'misma (producto, color, talla) dos veces rechazada');
select lives_ok($$insert into public.product_variants (product_id, color_id, size_id) values ('b0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000b')$$,
  'mismo color con OTRA talla sí se permite');
update public.product_variants set archived_at = now() where id = 'f1000000-0000-0000-0000-000000000002';
select lives_ok($$insert into public.product_variants (id, product_id, color_id) values ('f1000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000b')$$,
  'una variante ARCHIVADA no bloquea volver a crear la combinación (sin dar SKU)');
select is((select sku from public.product_variants where id = 'f1000000-0000-0000-0000-000000000009'), 'CHQ-001-NEGRO-2',
  '…y el SKU automático no choca con el de la archivada: recibe el sufijo -2');
select lives_ok($$insert into public.product_variants (product_id, color_id, size_id) values ('b0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000b')$$,
  'otra variante (Negro, S) recibe su propio SKU');
select is((select sku from public.product_variants where color_id = 'd1000000-0000-0000-0000-00000000000b' and size_id = 'e1000000-0000-0000-0000-00000000000b'), 'CHQ-001-NEGRO-S',
  '…CODIGO-COLOR-TALLA sin sufijo');
select throws_ok($$insert into public.product_variants (product_id, color_id) values ('b0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-00000000000a')$$,
  '23503', null, 'una variante no puede usar el color de OTRO producto');
select throws_ok($$insert into public.product_variants (product_id, color_id, size_id) values ('b0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 'e2000000-0000-0000-0000-00000000000a')$$,
  '23503', null, 'una variante no puede usar la talla de OTRO producto');
select throws_ok($$insert into public.product_variants (product_id, color_id, size_id, low_threshold, critical_threshold) values ('b0000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-00000000000a', 'e2000000-0000-0000-0000-00000000000a', 2, 5)$$,
  '23514', null, 'umbral crítico mayor que el de aviso rechazado');
select throws_ok($$insert into public.product_variants (product_id, color_id, low_threshold) values ('b0000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-00000000000a', -1)$$,
  '23514', null, 'umbral negativo rechazado');
select throws_ok($$insert into public.product_colors (product_id, name) values ('b0000000-0000-0000-0000-000000000001', 'blanco')$$,
  '23505', null, 'color repetido (sin distinguir mayúsculas) en el mismo producto rechazado');
select throws_ok($$insert into public.product_colors (product_id, name, hex) values ('b0000000-0000-0000-0000-000000000002', 'Azul', 'azul')$$,
  '23514', null, 'color hex inválido rechazado');
select throws_ok($$insert into public.product_sizes (product_id, label) values ('b0000000-0000-0000-0000-000000000001', 'xs')$$,
  '23505', null, 'talla repetida (sin distinguir mayúsculas) rechazada');

-- ── Imágenes ───────────────────────────────────────────────────────────────────────────────
insert into public.product_images (product_id, path) values
  ('b0000000-0000-0000-0000-000000000001', 'products/b0000000-0000-0000-0000-000000000001/11111111-1111-1111-1111-111111111111.jpg');
select throws_ok($$insert into public.product_images (product_id, path) values ('b0000000-0000-0000-0000-000000000001', 'foto.jpg')$$, '23514', null, 'ruta fuera de la convención rechazada');
select throws_ok($$insert into public.product_images (product_id, path) values ('b0000000-0000-0000-0000-000000000001', 'products/b0000000-0000-0000-0000-000000000002/22222222-2222-2222-2222-222222222222.jpg')$$,
  '23514', null, 'ruta de la carpeta de OTRO producto rechazada');
select throws_ok($$insert into public.product_images (product_id, path) values ('b0000000-0000-0000-0000-000000000001', 'products/b0000000-0000-0000-0000-000000000001/33333333-3333-3333-3333-333333333333.JPG')$$,
  '23514', null, 'extensión en mayúsculas rechazada');
select throws_ok($$insert into public.product_images (product_id, path) values ('b0000000-0000-0000-0000-000000000001', 'products/b0000000-0000-0000-0000-000000000001/44444444-4444-4444-4444-444444444444.svg')$$,
  '23514', null, 'SVG rechazado (puede llevar scripts)');
select throws_ok($$insert into public.product_images (product_id, path) values ('b0000000-0000-0000-0000-000000000001', 'products/b0000000-0000-0000-0000-000000000001/11111111-1111-1111-1111-111111111111.jpg')$$,
  '23505', null, 'ruta duplicada rechazada');
select throws_ok($$insert into public.product_images (product_id, color_id, path) values ('b0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-00000000000a', 'products/b0000000-0000-0000-0000-000000000001/55555555-5555-5555-5555-555555555555.png')$$,
  '23503', null, 'imagen asignada a un color de OTRO producto rechazada');

-- ── Precios ────────────────────────────────────────────────────────────────────────────────
select throws_ok($$insert into public.product_prices (product_id, currency, amount) values ('b0000000-0000-0000-0000-000000000002', 'BOB', 0)$$, '23514', null, 'precio 0 rechazado');
select throws_ok($$insert into public.product_prices (product_id, currency, amount) values ('b0000000-0000-0000-0000-000000000002', 'BOB', -5)$$, '23514', null, 'precio negativo rechazado');
select throws_ok($$insert into public.product_prices (product_id, currency, amount) values ('b0000000-0000-0000-0000-000000000002', 'BOB', 10.999)$$, '23514', null, 'precio con 3 decimales rechazado (no se redondea en silencio)');
select throws_ok($$insert into public.product_prices (product_id, currency, amount) values ('b0000000-0000-0000-0000-000000000002', 'BOB', 1000000000)$$, '23514', null, 'precio desproporcionado rechazado');
select lives_ok($$insert into public.product_prices (product_id, currency, amount) values ('b0000000-0000-0000-0000-000000000002', 'BOB', 99.50)$$, 'precio con 2 decimales aceptado');
select throws_ok($$insert into public.product_prices (product_id, currency, amount) values ('b0000000-0000-0000-0000-000000000002', 'BOB', 120)$$, '23505', null, 'segundo precio BOB sin país rechazado');
select throws_ok($$insert into public.product_prices (product_id, currency, country, amount) values ('b0000000-0000-0000-0000-000000000002', 'BOB', 'BO', 110)$$, '23514', null, 'un precio BOB (moneda base) NO lleva país: es el general (si no, el listado y price_for discreparían)');
select throws_ok($$insert into public.product_prices (product_id, currency, country, amount) values ('b0000000-0000-0000-0000-000000000002', 'USD', 'BO', 5)$$, '23514', null, 'no existe un precio (USD, Bolivia): el país debe usar esa moneda');
select lives_ok($$insert into public.product_prices (product_id, currency, country, amount) values ('b0000000-0000-0000-0000-000000000002', 'EUR', 'ES', 38)$$, 'un precio por país en la moneda de ese país (EUR en España) sí se permite');
select throws_ok($$insert into public.product_prices (product_id, currency, country, amount) values ('b0000000-0000-0000-0000-000000000002', 'EUR', 'ES', 39)$$, '23505', null, 'segundo precio (EUR, ES) rechazado');
select throws_ok($$insert into public.product_prices (product_id, currency, amount) values ('b0000000-0000-0000-0000-000000000002', 'XXX', 5)$$, '23503', null, 'moneda inexistente rechazada');
select throws_ok($$insert into public.product_prices (product_id, currency, country, amount) values ('b0000000-0000-0000-0000-000000000002', 'USD', 'ZZ', 5)$$, '23514', null, 'país inexistente rechazado');

-- ── Nada se borra ──────────────────────────────────────────────────────────────────────────
select throws_ok($$delete from public.products where code = 'CHQ-001'$$, '23503', null, 'ni el propietario borra un producto que tiene variantes (FK restrict)');
select throws_ok($$delete from public.product_colors where id = 'd1000000-0000-0000-0000-00000000000a'$$, '23503', null, 'ni el propietario borra un color en uso');

-- ── Código sin distinguir mayúsculas y SKU ─────────────────────────────────────────────────
select throws_ok($$insert into public.products (code, slug, name) values ('chq-001', 'otro-slug-2', 'X')$$, '23505', null, 'el código es único SIN distinguir mayúsculas (chq-001 = CHQ-001)');
select throws_ok($$update public.product_variants set sku = null where id = 'f1000000-0000-0000-0000-000000000001'$$, '23502', null, 'el SKU no puede quedar vacío');
insert into public.products (id, code, slug, name) values ('b0000000-0000-0000-0000-0000000000a1', repeat('L', 40), 'producto-largo', 'Largo');
insert into public.product_colors (id, product_id, name) values ('d9000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-0000000000a1', repeat('C', 40));
insert into public.product_sizes (id, product_id, label) values ('e9000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-0000000000a1', repeat('S', 20));
select lives_ok($$insert into public.product_variants (product_id, color_id, size_id) values ('b0000000-0000-0000-0000-0000000000a1', 'd9000000-0000-0000-0000-0000000000a1', 'e9000000-0000-0000-0000-0000000000a1')$$,
  'código, color y talla de longitud máxima no rompen el alta (antes superaba los 80 caracteres del CHECK)');
select is((select length(sku) from public.product_variants where product_id = 'b0000000-0000-0000-0000-0000000000a1'), 70, 'el SKU generado se trunca a 70 caracteres');

-- ── Coherencia de variantes: cascada color/talla → variantes y última variante ─────────────
insert into public.products (id, code, slug, name) values ('b0000000-0000-0000-0000-0000000000b1', 'Y-1', 'y-1', 'Producto Y');
insert into public.product_colors (id, product_id, name) values
  ('d9000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000000b1', 'Rojo'),
  ('d9000000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-0000000000b1', 'Azul');
insert into public.product_sizes (id, product_id, label) values ('e9000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000000b1', 'M');
insert into public.product_variants (id, product_id, color_id, size_id) values
  ('f9000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000000b1', 'd9000000-0000-0000-0000-0000000000b1', 'e9000000-0000-0000-0000-0000000000b1'),
  ('f9000000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-0000000000b1', 'd9000000-0000-0000-0000-0000000000b2', 'e9000000-0000-0000-0000-0000000000b1');
insert into public.product_prices (product_id, currency, amount) values ('b0000000-0000-0000-0000-0000000000b1', 'BOB', 100);
update public.products set status = 'active' where code = 'Y-1';
update public.product_colors set archived_at = now() where id = 'd9000000-0000-0000-0000-0000000000b2';
select ok((select archived_at is not null from public.product_variants where id = 'f9000000-0000-0000-0000-0000000000b2'), 'archivar un color ARCHIVA sus variantes (no quedan variantes fantasma con stock)');
select ok((select archived_at is null from public.product_variants where id = 'f9000000-0000-0000-0000-0000000000b1'), '…y no toca las de otros colores');
update public.product_colors set archived_at = null where id = 'd9000000-0000-0000-0000-0000000000b2';
select ok((select archived_at is not null from public.product_variants where id = 'f9000000-0000-0000-0000-0000000000b2'), 'desarchivar el color NO restaura sus variantes (decisión del admin, una por una)');
select throws_ok($$update public.product_variants set archived_at = now() where id = 'f9000000-0000-0000-0000-0000000000b1'$$, '23514', null, 'no se archiva la ÚLTIMA variante de un producto publicado');
select throws_ok($$update public.product_sizes set archived_at = now() where id = 'e9000000-0000-0000-0000-0000000000b1'$$, '23514', null, 'archivar la talla que dejaría al producto publicado sin variantes se rechaza');
select ok((select archived_at is null from public.product_variants where id = 'f9000000-0000-0000-0000-0000000000b1'), '…y la variante sigue activa tras el rechazo (la cascada se revierte entera)');
update public.products set status = 'draft' where code = 'Y-1';
select lives_ok($$update public.product_variants set archived_at = now() where id = 'f9000000-0000-0000-0000-0000000000b1'$$, 'con el producto en borrador sí se puede archivar la última variante');

-- ── Asociaciones por RPC (solo admin) ──────────────────────────────────────────────────────
insert into public.categories (id, name, slug) values
  ('ca000000-0000-0000-0000-00000000000a', 'Ropa', 'ropa'),
  ('ca000000-0000-0000-0000-00000000000b', 'Sombreros', 'sombreros');
insert into public.collections (id, name, slug) values
  ('c0110000-0000-0000-0000-00000000000a', 'Verano 2027', 'verano-2027'),
  ('c0110000-0000-0000-0000-00000000000b', 'NADAS', 'nadas');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select throws_ok($$select public.admin_set_product_categories('b0000000-0000-0000-0000-000000000001', array['ca000000-0000-0000-0000-00000000000a']::uuid[])$$,
  '42501', null, 'un cliente NO puede cambiar categorías de un producto');
select throws_ok($$select public.admin_set_product_related('b0000000-0000-0000-0000-000000000001', array['b0000000-0000-0000-0000-000000000002']::uuid[])$$,
  '42501', null, 'un cliente NO puede cambiar relacionados');
select throws_ok($$select public.admin_delete_product_price('b0000000-0000-0000-0000-000000000002', 'EUR', 'ES')$$,
  '42501', null, 'un cliente NO puede quitar precios');
reset role;
select is((select count(*)::int from public.product_categories), 0, '…y no se escribió nada');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select lives_ok($$select public.admin_set_product_categories('b0000000-0000-0000-0000-000000000001', array['ca000000-0000-0000-0000-00000000000a','ca000000-0000-0000-0000-00000000000b']::uuid[])$$, 'admin asigna 2 categorías');
select is((select count(*)::int from public.product_categories where product_id = 'b0000000-0000-0000-0000-000000000001'), 2, '…quedan 2');
select lives_ok($$select public.admin_set_product_categories('b0000000-0000-0000-0000-000000000001', array['ca000000-0000-0000-0000-00000000000b']::uuid[])$$, 'admin reemplaza por 1 categoría');
select is((select string_agg(category_id::text, ',') from public.product_categories where product_id = 'b0000000-0000-0000-0000-000000000001'), 'ca000000-0000-0000-0000-00000000000b', '…quedó solo la nueva (se quitó la otra)');
select lives_ok($$select public.admin_set_product_categories('b0000000-0000-0000-0000-000000000001', array['ca000000-0000-0000-0000-00000000000b','ca000000-0000-0000-0000-00000000000b']::uuid[])$$, 'duplicados en la entrada no rompen');
select is((select count(*)::int from public.product_categories where product_id = 'b0000000-0000-0000-0000-000000000001'), 1, '…y se guarda una sola vez');
select lives_ok($$select public.admin_set_product_categories('b0000000-0000-0000-0000-000000000001', array[]::uuid[])$$, 'admin deja el producto sin categorías (0 es válido)');
select is((select count(*)::int from public.product_categories where product_id = 'b0000000-0000-0000-0000-000000000001'), 0, '…0 filas');
select throws_ok($$select public.admin_set_product_categories('b0000000-0000-0000-0000-000000000001', array['99999999-0000-0000-0000-000000000000']::uuid[])$$, '23503', null, 'categoría inexistente rechazada');
select throws_ok($$select public.admin_set_product_categories('99999999-0000-0000-0000-000000000000', array[]::uuid[])$$, 'P0002', null, 'producto inexistente rechazado');
select throws_ok($$select public.admin_set_product_categories('b0000000-0000-0000-0000-000000000001', (select array_agg(gen_random_uuid()) from generate_series(1, 51)))$$, '22023', null, 'más de 50 categorías rechazado');
select lives_ok($$select public.admin_set_product_collections('b0000000-0000-0000-0000-000000000001', array['c0110000-0000-0000-0000-00000000000a','c0110000-0000-0000-0000-00000000000b']::uuid[])$$, 'admin asigna 2 colecciones');
select lives_ok($$select public.admin_set_product_related('b0000000-0000-0000-0000-000000000001', array['b0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000002']::uuid[])$$, 'admin asigna 2 relacionados en orden');
select is((select string_agg(related_id::text || ':' || sort_order, ',' order by sort_order) from public.product_related where product_id = 'b0000000-0000-0000-0000-000000000001'),
  'b0000000-0000-0000-0000-000000000003:0,b0000000-0000-0000-0000-000000000002:1', 'el orden del arreglo es el orden de aparición');
select lives_ok($$select public.admin_set_product_related('b0000000-0000-0000-0000-000000000001', array['b0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000003']::uuid[])$$, 'admin reordena los relacionados');
select is((select string_agg(related_id::text || ':' || sort_order, ',' order by sort_order) from public.product_related where product_id = 'b0000000-0000-0000-0000-000000000001'),
  'b0000000-0000-0000-0000-000000000002:0,b0000000-0000-0000-0000-000000000003:1', 'reordenar actualiza sort_order sin duplicar filas');
select throws_ok($$select public.admin_set_product_related('b0000000-0000-0000-0000-000000000001', array['b0000000-0000-0000-0000-000000000001']::uuid[])$$, '23514', null, 'un producto no puede relacionarse consigo mismo');
select throws_ok($$delete from public.product_related$$, '42501', null, 'admin no borra relaciones directamente (usa el RPC)');
select throws_ok($$select public.admin_set_product_categories('b0000000-0000-0000-0000-000000000001', null)$$, '22023', null, 'lista de categorías NULL rechazada (no borra todo en silencio)');
select throws_ok($$select public.admin_set_product_collections('b0000000-0000-0000-0000-000000000001', null)$$, '22023', null, 'lista de colecciones NULL rechazada');
select throws_ok($$select public.admin_set_product_related('b0000000-0000-0000-0000-000000000001', null)$$, '22023', null, 'lista de relacionados NULL rechazada');
select is((select count(*)::int from public.product_collections where product_id = 'b0000000-0000-0000-0000-000000000001'), 2, '…y no se borró nada');
select lives_ok($$update public.product_collections set sort_order = 5 where product_id = 'b0000000-0000-0000-0000-000000000001' and collection_id = 'c0110000-0000-0000-0000-00000000000a'$$, 'el admin reordena los productos de una colección');
select is((select sort_order from public.product_collections where product_id = 'b0000000-0000-0000-0000-000000000001' and collection_id = 'c0110000-0000-0000-0000-00000000000a'), 5, '…y quedó guardado');
select throws_ok($$update public.product_collections set collection_id = 'c0110000-0000-0000-0000-00000000000b' where product_id = 'b0000000-0000-0000-0000-000000000001' and collection_id = 'c0110000-0000-0000-0000-00000000000a'$$, '42501', null, 'cambiar la pertenencia a una colección solo es posible por el RPC');
select lives_ok($$select public.admin_delete_product_price('b0000000-0000-0000-0000-000000000002', 'EUR', 'ES')$$, 'el admin quita un precio por país cargado por error');
select throws_ok($$select public.admin_delete_product_price('b0000000-0000-0000-0000-000000000002', 'EUR', 'ES')$$, 'P0002', null, 'quitar un precio que ya no existe → error claro');
select throws_ok($$select public.admin_delete_product_price('b0000000-0000-0000-0000-000000000001', 'BOB')$$, '23514', null, 'no se quita el precio BOB de un producto PUBLICADO');
select lives_ok($$select public.admin_delete_product_price('b0000000-0000-0000-0000-000000000001', 'USD')$$, 'sí se quita el precio USD de un producto publicado (BOB sigue)');
select throws_ok($$select public.admin_delete_product_price(gen_random_uuid(), 'BOB')$$, 'P0002', null, 'producto inexistente → error claro');
reset role;

-- ══ MATRIZ RLS ═════════════════════════════════════════════════════════════════════════════
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select cost_base from public.products$$, '42501', null, 'anon NO lee la tabla products (menos aún el costo)');
select throws_ok($$select * from public.product_variants$$, '42501', null, 'anon NO lee product_variants');
select throws_ok($$select * from public.product_prices$$, '42501', null, 'anon NO lee product_prices');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is((select count(*)::int from public.products), 0, 'cliente NO ve filas de products (RLS)');
select is((select count(*)::int from public.product_variants), 0, 'cliente NO ve variantes');
select throws_ok($$insert into public.products (code, slug, name) values ('H1', 'h1', 'Hack')$$, '42501', null, 'cliente NO inserta productos');
select throws_ok($$insert into public.product_prices (product_id, currency, amount) values ('b0000000-0000-0000-0000-000000000003', 'BOB', 1)$$, '42501', null, 'cliente NO inserta precios');
update public.products set name = 'Hackeado', cost_base = 0 where code = 'CHQ-001';
reset role;
select is((select name from public.products where code = 'CHQ-001'), 'Chaqueta Japandi', 'el UPDATE de un cliente no surtió efecto (0 filas)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.products where code like '%-001'), 3, 'admin ve todos los productos');
select lives_ok($$insert into public.products (code, slug, name, cost_base) values ('NUE-001', 'nuevo-producto', 'Nuevo producto', 120.50)$$, 'admin crea un producto (borrador)');
select is((select cost_base from public.products where code = 'NUE-001'), 120.50::numeric, 'admin SÍ ve el costo');
select lives_ok($$update public.products set name = 'Chaqueta Japandi Premium' where code = 'CHQ-001'$$, 'admin edita un producto');
select throws_ok($$update public.product_variants set stock_on_hand = 999 where id = 'f1000000-0000-0000-0000-000000000001'$$, '42501', null, 'admin NO puede escribir stock_on_hand directamente');
select throws_ok($$insert into public.product_variants (product_id, color_id, stock_on_hand) values ('b0000000-0000-0000-0000-000000000003', 'd2000000-0000-0000-0000-00000000000a', 5)$$, '42501', null, 'admin NO puede crear variantes con stock (columna sin permiso)');
select throws_ok($$update public.product_colors set product_id = 'b0000000-0000-0000-0000-000000000002' where id = 'd1000000-0000-0000-0000-00000000000a'$$, '42501', null, 'admin NO puede mover un color a otro producto');
select throws_ok($$update public.product_prices set currency = 'USD' where product_id = 'b0000000-0000-0000-0000-000000000002'$$, '42501', null, 'admin NO cambia la moneda de un precio existente');
select lives_ok($$update public.product_prices set amount = 105 where product_id = 'b0000000-0000-0000-0000-000000000002' and currency = 'BOB'$$, 'admin SÍ cambia el monto de un precio');
select throws_ok($$delete from public.products where code = 'NUE-001'$$, '42501', null, 'admin NO borra productos (se archivan)');
select lives_ok($$update public.products set archived_at = now() where code = 'NUE-001'$$, 'admin archiva productos');
reset role;

select is((select diff ->> 'amount' from public.audit_log where table_name = 'product_prices' and action = 'DELETE'
             and actor_id = 'a0000000-0000-0000-0000-0000000000a1' and diff ->> 'currency' = 'EUR'), '38',
          'quitar un precio queda auditado con su valor anterior');
select is((select count(*)::int from public.audit_log where table_name = 'products' and action = 'UPDATE'
             and actor_id = 'a0000000-0000-0000-0000-0000000000a1' and diff -> 'name' ->> 'new' = 'Chaqueta Japandi Premium'), 1,
          'la edición del producto quedó auditada con su autor');

select * from finish();
rollback;
