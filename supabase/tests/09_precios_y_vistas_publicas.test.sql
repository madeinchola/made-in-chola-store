-- Sprint 2 · Precios (price_for / public_price_for), vistas públicas (visibilidad, sin fugas, consultables con
-- TODAS sus columnas por anon y por clientes) y búsqueda sin acentos. Valores esperados calculados a mano.
begin;
select plan(112);

alter table public.stock_movements disable trigger user;
alter table public.exchange_rates disable trigger user;
alter table public.product_slug_history disable trigger user;
truncate public.products, public.categories, public.collections, public.news_banners, public.home_sections,
         public.exchange_rates restart identity cascade;
alter table public.stock_movements enable trigger user;
alter table public.exchange_rates enable trigger user;
alter table public.product_slug_history enable trigger user;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('c0000000-0000-0000-0000-0000000000c1', 'cliente.s2@test.com', '{"full_name":"Cliente S2"}', 'authenticated', 'authenticated');

-- ── Fixture ────────────────────────────────────────────────────────────────────────────────
-- P1 Chaqueta (3 variantes, 3 imágenes) · P2 Sombrero (hide, nuevo) · P3 Cartera (agotada, sold_out)
-- P4 agotado + hide (oculto) · P5 borrador · P6 archivado · P7 sin precio BOB · P8 acentos
insert into public.products (id, code, slug, name, model, description, cost_base, out_of_stock_behavior, is_new) values
  ('b2000000-0000-0000-0000-000000000001', 'CHQ-001', 'chaqueta-japandi',       'Chaqueta Japandi',          'Japandi',   'Chaqueta de cuero vegano', 200, 'sold_out', false),
  ('b2000000-0000-0000-0000-000000000002', 'SMB-001', 'sombrero-chakra-naranja', 'Sombrero Chakra naranja',  null,        '',                          90, 'hide',     true),
  ('b2000000-0000-0000-0000-000000000003', 'CRT-001', 'cartera-verde',          'Cartera Verde',             null,        '',                          50, 'sold_out', false),
  ('b2000000-0000-0000-0000-000000000004', 'HID-001', 'agotado-oculto',         'Agotado oculto',            null,        '',                          10, 'hide',     false),
  ('b2000000-0000-0000-0000-000000000005', 'DRF-001', 'borrador-oculto',        'Borrador oculto',           null,        '',                          10, 'sold_out', false),
  ('b2000000-0000-0000-0000-000000000006', 'ARC-001', 'archivado',             'Producto archivado',        null,        '',                          10, 'sold_out', false),
  ('b2000000-0000-0000-0000-000000000007', 'SIN-001', 'sin-precio',            'Sin precio',                null,        '',                          10, 'sold_out', false),
  ('b2000000-0000-0000-0000-000000000008', 'NAN-001', 'sombrero-nandu',        'Sómbrero Ñandú',            'Edición Ñ', '',                          10, 'sold_out', false);
insert into public.product_colors (id, product_id, name) values
  ('d4000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'Blanco'),
  ('d4000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001', 'Negro'),
  ('d4000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000002', 'Único'),
  ('d4000000-0000-0000-0000-000000000004', 'b2000000-0000-0000-0000-000000000003', 'Único'),
  ('d4000000-0000-0000-0000-000000000005', 'b2000000-0000-0000-0000-000000000004', 'Único'),
  ('d4000000-0000-0000-0000-000000000006', 'b2000000-0000-0000-0000-000000000005', 'Único'),
  ('d4000000-0000-0000-0000-000000000007', 'b2000000-0000-0000-0000-000000000006', 'Único'),
  ('d4000000-0000-0000-0000-000000000008', 'b2000000-0000-0000-0000-000000000007', 'Único'),
  ('d4000000-0000-0000-0000-000000000009', 'b2000000-0000-0000-0000-000000000008', 'Único');
insert into public.product_sizes (id, product_id, label) values
  ('e5000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'XS'),
  ('e5000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001', 'S');
insert into public.product_variants (id, product_id, color_id, size_id) values
  ('f5000000-0000-0000-0000-000000000011', 'b2000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001'),
  ('f5000000-0000-0000-0000-000000000012', 'b2000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000002'),
  ('f5000000-0000-0000-0000-000000000013', 'b2000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000002', 'e5000000-0000-0000-0000-000000000001'),
  ('f5000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-000000000003', null),
  ('f5000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000003', 'd4000000-0000-0000-0000-000000000004', null),
  ('f5000000-0000-0000-0000-000000000004', 'b2000000-0000-0000-0000-000000000004', 'd4000000-0000-0000-0000-000000000005', null),
  ('f5000000-0000-0000-0000-000000000005', 'b2000000-0000-0000-0000-000000000005', 'd4000000-0000-0000-0000-000000000006', null),
  ('f5000000-0000-0000-0000-000000000006', 'b2000000-0000-0000-0000-000000000006', 'd4000000-0000-0000-0000-000000000007', null),
  ('f5000000-0000-0000-0000-000000000007', 'b2000000-0000-0000-0000-000000000007', 'd4000000-0000-0000-0000-000000000008', null),
  ('f5000000-0000-0000-0000-000000000008', 'b2000000-0000-0000-0000-000000000008', 'd4000000-0000-0000-0000-000000000009', null);
insert into public.product_prices (product_id, currency, amount) values
  ('b2000000-0000-0000-0000-000000000001', 'BOB', 560),
  ('b2000000-0000-0000-0000-000000000002', 'BOB', 450.50),
  ('b2000000-0000-0000-0000-000000000003', 'BOB', 300),
  ('b2000000-0000-0000-0000-000000000004', 'BOB', 100),
  ('b2000000-0000-0000-0000-000000000005', 'BOB', 100),
  ('b2000000-0000-0000-0000-000000000006', 'BOB', 100),
  ('b2000000-0000-0000-0000-000000000007', 'BOB', 100),
  ('b2000000-0000-0000-0000-000000000008', 'BOB', 100);
update public.products set status = 'active' where code <> 'DRF-001';
update public.products set archived_at = now() where code = 'ARC-001';
delete from public.product_prices where product_id = 'b2000000-0000-0000-0000-000000000007';   -- P7 queda activo pero SIN precio
select public.apply_stock_change('f5000000-0000-0000-0000-000000000011', 10, 'import');
select public.apply_stock_change('f5000000-0000-0000-0000-000000000012', 2, 'import');
select public.apply_stock_change('f5000000-0000-0000-0000-000000000002', 5, 'import');
select public.apply_stock_change('f5000000-0000-0000-0000-000000000005', 3, 'import');
select public.apply_stock_change('f5000000-0000-0000-0000-000000000006', 3, 'import');
select public.apply_stock_change('f5000000-0000-0000-0000-000000000007', 3, 'import');
select public.apply_stock_change('f5000000-0000-0000-0000-000000000008', 3, 'import');
insert into public.product_images (id, product_id, color_id, path, sort_order) values
  ('a1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', null, 'products/b2000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.jpg', 2),
  ('a1000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'products/b2000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2.png', 1),
  ('a1000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000002', 'products/b2000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3.webp', 3);
insert into public.categories (id, name, slug, archived_at) values
  ('ca200000-0000-0000-0000-000000000001', 'Ropa', 'ropa', null),
  ('ca200000-0000-0000-0000-000000000002', 'Vieja', 'vieja', now());
insert into public.collections (id, name, slug, ends_at) values
  ('c0220000-0000-0000-0000-000000000001', 'Verano', 'verano', null),
  ('c0220000-0000-0000-0000-000000000002', 'Vencida', 'vencida', now() - interval '1 day');
insert into public.product_categories (product_id, category_id) values
  ('b2000000-0000-0000-0000-000000000001', 'ca200000-0000-0000-0000-000000000001'),
  ('b2000000-0000-0000-0000-000000000001', 'ca200000-0000-0000-0000-000000000002');
insert into public.product_collections (product_id, collection_id) values
  ('b2000000-0000-0000-0000-000000000001', 'c0220000-0000-0000-0000-000000000001'),
  ('b2000000-0000-0000-0000-000000000001', 'c0220000-0000-0000-0000-000000000002');
insert into public.product_related (product_id, related_id, sort_order) values
  ('b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000002', 0),
  ('b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000004', 1);

-- ── price_for (como propietario) ───────────────────────────────────────────────────────────
select is(public.price_for('b2000000-0000-0000-0000-000000000001', 'BOB'), 560::numeric, 'precio explícito en BOB');
select is(public.price_for('b2000000-0000-0000-0000-000000000002', 'BOB'), 450.50::numeric, 'precio con decimales');
select is(public.price_for('b2000000-0000-0000-0000-000000000002', 'BOB', 'BO'), 450.50::numeric, 'Bolivia sin precio propio usa el general (un precio BOB nunca lleva país)');
select is(public.price_for('b2000000-0000-0000-0000-000000000002', 'BOB', null), 450.50::numeric, 'sin país se usa el general');
select is(public.price_for('b2000000-0000-0000-0000-000000000002', 'BOB', 'AR'), null, 'país deshabilitado → NULL');
select is(public.price_for('b2000000-0000-0000-0000-000000000002', 'BOB', 'XX'), null, 'país inexistente → NULL');
update public.currencies set enabled = true where code = 'EUR';
update public.countries set enabled = true where code = 'ES';
insert into public.product_prices (product_id, currency, country, amount) values
  ('b2000000-0000-0000-0000-000000000002', 'EUR', null, 40),
  ('b2000000-0000-0000-0000-000000000002', 'EUR', 'ES', 38);
select is(public.price_for('b2000000-0000-0000-0000-000000000002', 'EUR', 'ES'), 38::numeric, 'el precio específico del país (EUR en España) gana al general de su moneda');
select is(public.price_for('b2000000-0000-0000-0000-000000000002', 'EUR', null), 40::numeric, 'sin país se usa el general de la moneda');
select is(public.price_for('b2000000-0000-0000-0000-000000000002', 'EUR', 'AR'), null, 'país deshabilitado → NULL también en otra moneda');
select is(public.price_for('b2000000-0000-0000-0000-000000000001', 'XXX'), null, 'moneda inexistente → NULL');
select is(public.price_for('b2000000-0000-0000-0000-000000000001', 'USD'), null, 'moneda deshabilitada → NULL');
update public.currencies set enabled = true where code = 'USD';
select is(public.price_for('b2000000-0000-0000-0000-000000000001', 'USD'), null, 'USD habilitada pero sin precio explícito y sin conversión permitida → NULL');
update public.products set allow_converted_prices = true where code in ('CHQ-001', 'NAN-001');
select is(public.price_for('b2000000-0000-0000-0000-000000000001', 'USD'), null, 'conversión permitida pero SIN tipo de cambio → NULL (nunca un precio dudoso)');
insert into public.exchange_rates (to_currency, rate) values ('USD', 0.14367816);
select is(public.price_for('b2000000-0000-0000-0000-000000000001', 'USD'), 80.46::numeric, '560 × 0.14367816 = 80.4597696 → 80.46');
insert into public.exchange_rates (to_currency, rate) values ('USD', 0.145);
select is(public.price_for('b2000000-0000-0000-0000-000000000001', 'USD'), 81.20::numeric, 'tasa nueva: 560 × 0.145 = 81.20');
insert into public.exchange_rates (to_currency, rate, valid_from) values ('USD', 0.5, now() + interval '1 day');
select is(public.price_for('b2000000-0000-0000-0000-000000000001', 'USD'), 81.20::numeric, 'una tasa programada a futuro no se aplica todavía');
select is(public.price_for('b2000000-0000-0000-0000-000000000003', 'USD'), null, 'un producto que NO permite conversión no se convierte');
insert into public.product_prices (product_id, currency, amount) values ('b2000000-0000-0000-0000-000000000001', 'USD', 90);
select is(public.price_for('b2000000-0000-0000-0000-000000000001', 'USD'), 90::numeric, 'el precio explícito en USD gana a la conversión');
update public.product_prices set amount = 1.05 where product_id = 'b2000000-0000-0000-0000-000000000008' and currency = 'BOB';
insert into public.exchange_rates (to_currency, rate) values ('USD', 0.5);
select is(public.price_for('b2000000-0000-0000-0000-000000000008', 'USD'), 0.53::numeric, 'redondeo: 1.05 × 0.5 = 0.525 → 0.53 (mitad se aleja de cero, no al par)');
update public.product_prices set amount = 10 where product_id = 'b2000000-0000-0000-0000-000000000008' and currency = 'BOB';
insert into public.exchange_rates (to_currency, rate) values ('USD', 0.12345);
select is(public.price_for('b2000000-0000-0000-0000-000000000008', 'USD'), 1.23::numeric, 'redondeo: 10 × 0.12345 = 1.2345 → 1.23');
update public.product_prices set amount = 100 where product_id = 'b2000000-0000-0000-0000-000000000008' and currency = 'BOB';

-- ── Vistas públicas: TODAS consultables con todas sus columnas por anon y por un cliente ───
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select lives_ok(format('select * from public.%I', v), 'anon lee ' || v || ' con todas sus columnas')
  from unnest(array['public_categories', 'public_collections', 'public_news_banners', 'public_store_settings', 'public_products',
                    'public_product_detail', 'public_product_colors', 'public_product_sizes', 'public_product_variants',
                    'public_product_images', 'public_product_categories', 'public_product_collections', 'public_product_related',
                    'public_home_sections', 'public_home_section_items']) v;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select lives_ok(format('select * from public.%I', v), 'un cliente lee ' || v || ' con todas sus columnas')
  from unnest(array['public_categories', 'public_collections', 'public_news_banners', 'public_store_settings', 'public_products',
                    'public_product_detail', 'public_product_colors', 'public_product_sizes', 'public_product_variants',
                    'public_product_images', 'public_product_categories', 'public_product_collections', 'public_product_related',
                    'public_home_sections', 'public_home_section_items']) v;
reset role;

-- ── Visibilidad (anon) ─────────────────────────────────────────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select string_agg(slug, ',' order by slug) from public.public_products),
  'cartera-verde,chaqueta-japandi,sombrero-chakra-naranja,sombrero-nandu',
  'visibles: activos, no archivados, con precio BOB y (si se agotan) solo con "Agotado"; fuera: oculto, borrador, archivado, sin precio');
select is((select sold_out from public.public_products where slug = 'cartera-verde'), true, 'la cartera sin stock se muestra como agotada');
select is((select sold_out from public.public_products where slug = 'chaqueta-japandi'), false, 'la chaqueta con stock no está agotada');
select is((select price_bob from public.public_products where slug = 'chaqueta-japandi'), 560::numeric, 'precio público de la chaqueta');
select is((select price_bob from public.public_products where slug = 'sombrero-chakra-naranja'), 450.50::numeric, 'precio público con decimales');
select is((select colors_count from public.public_products where slug = 'chaqueta-japandi'), 2, 'cuenta de colores = 2');
select is((select cover_path from public.public_products where slug = 'chaqueta-japandi'), 'products/b2000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2.png', 'la portada es la imagen de menor orden');
select is((select cover_path from public.public_products where slug = 'sombrero-chakra-naranja'), null, 'sin imágenes la portada es NULL (la UI muestra el placeholder)');
select is((select is_new from public.public_products where slug = 'sombrero-chakra-naranja'), true, 'badge NUEVO');
select is((select model || '|' || description from public.public_product_detail where slug = 'chaqueta-japandi'), 'Japandi|Chaqueta de cuero vegano', 'el detalle trae modelo y descripción');
select is((select to_jsonb(d) ?| array['cost_base', 'stock_on_hand', 'code', 'sku', 'status', 'archived_at', 'allow_converted_prices'] from public.public_product_detail d where slug = 'chaqueta-japandi'), false,
  'el detalle público NO contiene costo, stock exacto, código, SKU ni estado interno');
select is((select string_agg(stock_status, ',' order by id) from public.public_product_variants where product_id = 'b2000000-0000-0000-0000-000000000001'), 'in_stock,low,out',
  'estado por variante: 10 = in_stock, 2 (crítico) = low, 0 = out');
select is((select to_jsonb(v) ?| array['stock_on_hand', 'available', 'reserved', 'sku'] from public.public_product_variants v limit 1), false, 'las variantes públicas no revelan cantidades');
select is((select count(*)::int from public.public_product_colors where product_id = 'b2000000-0000-0000-0000-000000000001'), 2, '2 colores públicos');
select is((select count(*)::int from public.public_product_sizes where product_id = 'b2000000-0000-0000-0000-000000000001'), 2, '2 tallas públicas');
select is((select string_agg(right(path, 8), ',' order by sort_order) from public.public_product_images where product_id = 'b2000000-0000-0000-0000-000000000001'), 'aaa2.png,aaa1.jpg,aa3.webp', '3 imágenes en su orden (por sort_order: 1, 2, 3)');
select is((select count(*)::int from public.public_product_categories where product_id = 'b2000000-0000-0000-0000-000000000001'), 1, 'solo la categoría NO archivada');
select is((select count(*)::int from public.public_product_collections where product_id = 'b2000000-0000-0000-0000-000000000001'), 1, 'solo la colección VIGENTE');
select is((select string_agg(related_id::text, ',') from public.public_product_related where product_id = 'b2000000-0000-0000-0000-000000000001'), 'b2000000-0000-0000-0000-000000000002', 'el relacionado oculto (agotado+hide) no se muestra, el visible sí');
reset role;

-- Cambios de stock/estado → cambia lo visible (BR-CAT-04: reaparece solo al reponer)
select public.apply_stock_change('f5000000-0000-0000-0000-000000000004', 1, 'import');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*)::int from public.public_products where slug = 'agotado-oculto'), 1, 'al reponer stock, el producto "Ocultar" reaparece solo');
reset role;
select is(public.reserve_stock('f5000000-0000-0000-0000-000000000004', 1, 'cart', gen_random_uuid()) ->> 'status', 'reserved', 'un carrito retiene esa única unidad');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*)::int from public.public_products where slug = 'agotado-oculto'), 1, 'con la unidad retenida por un carrito el producto NO desaparece (ni su página): "Ocultar" depende del stock FÍSICO');
select is((select sold_out from public.public_products where slug = 'agotado-oculto'), true, '…se muestra como agotado hasta que la retención venza');
reset role;
select public.apply_stock_change('f5000000-0000-0000-0000-000000000004', -1, 'sale');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*)::int from public.public_products where slug = 'agotado-oculto'), 0, 'sin stock FÍSICO, el producto "Ocultar" sí se oculta');
reset role;
update public.products set out_of_stock_behavior = 'hide' where code = 'CRT-001';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*)::int from public.public_products where slug = 'cartera-verde'), 0, 'cambiar la cartera a "Ocultar" la oculta');
reset role;
update public.products set out_of_stock_behavior = 'sold_out' where code = 'CRT-001';
select public.reserve_stock('f5000000-0000-0000-0000-000000000011', 9, 'cart', '0a000000-0000-0000-0000-00000000000a');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select string_agg(stock_status, ',' order by id) from public.public_product_variants where product_id = 'b2000000-0000-0000-0000-000000000001'), 'low,low,out', 'con 9 de 10 retenidas, la variante pasa a "low" (lo comprable es 1)');
reset role;
update public.product_colors set archived_at = now() where id = 'd4000000-0000-0000-0000-000000000002';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*)::int from public.public_product_variants where product_id = 'b2000000-0000-0000-0000-000000000001'), 2, 'archivar el color Negro oculta su variante');
select is((select colors_count from public.public_products where slug = 'chaqueta-japandi'), 1, '…y baja la cuenta de colores');
select is((select count(*)::int from public.public_product_images where product_id = 'b2000000-0000-0000-0000-000000000001'), 2, '…y oculta las imágenes de ese color');
reset role;
update public.product_colors set archived_at = null where id = 'd4000000-0000-0000-0000-000000000002';
select ok((select archived_at is not null from public.product_variants where id = 'f5000000-0000-0000-0000-000000000013'), 'desarchivar el color NO restaura su variante (la cascada solo archiva)');
update public.product_sizes set archived_at = now() where id = 'e5000000-0000-0000-0000-000000000002';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*)::int from public.public_product_variants where product_id = 'b2000000-0000-0000-0000-000000000001'), 1, 'archivar la talla S archiva (y oculta) sus variantes: queda solo la de XS (la de Negro sigue archivada)');
reset role;
update public.product_sizes set archived_at = null where id = 'e5000000-0000-0000-0000-000000000002';
update public.product_images set archived_at = now() where id = 'a1000000-0000-0000-0000-000000000002';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select right(cover_path, 8) from public.public_products where slug = 'chaqueta-japandi'), 'aaa1.jpg', 'archivar la imagen de portada pasa la portada a la siguiente');
reset role;

-- ── public_price_for (anon) ────────────────────────────────────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(public.public_price_for('b2000000-0000-0000-0000-000000000001'), 560::numeric, 'anon obtiene el precio BOB de un producto visible');
select is(public.public_price_for('b2000000-0000-0000-0000-000000000001', 'USD'), 90::numeric, 'anon obtiene el USD explícito');
select is(public.public_price_for('b2000000-0000-0000-0000-000000000002', 'EUR', 'ES'), 38::numeric, 'anon obtiene el precio por país');
select is(public.public_price_for('b2000000-0000-0000-0000-000000000005'), null, 'el precio de un BORRADOR no se filtra');
select is(public.public_price_for('b2000000-0000-0000-0000-000000000006'), null, 'el precio de un ARCHIVADO no se filtra');
select is(public.public_price_for('b2000000-0000-0000-0000-000000000004'), null, 'el precio de un producto oculto por agotado no se filtra');
select is(public.public_price_for(gen_random_uuid()), null, 'producto inexistente → NULL');
reset role;

-- ── Búsqueda (anon) ────────────────────────────────────────────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*)::int from public.public_search_products('chaq')), 1, 'búsqueda parcial "chaq"');
select is((select count(*)::int from public.public_search_products('JAPANDI')), 1, 'insensible a mayúsculas');
select is((select count(*)::int from public.public_search_products('sombrero')), 2, '"sombrero" encuentra "Sombrero…" y "Sómbrero…"');
select is((select count(*)::int from public.public_search_products('nandu')), 1, 'sin acento ni ñ: "nandu" encuentra "Ñandú"');
select is((select count(*)::int from public.public_search_products('ÑANDÚ')), 1, 'con acento y ñ en mayúscula también');
select is((select count(*)::int from public.public_search_products('edicion')), 1, 'busca también por modelo ("Edición Ñ")');
select is((select count(*)::int from public.public_search_products('nan-001')), 1, 'busca por código exacto');
select is((select count(*)::int from public.public_search_products('chq')), 1, 'busca por código parcial');
select is((select count(*)::int from public.public_search_products('a')), 0, 'menos de 2 caracteres → vacío');
select is((select count(*)::int from public.public_search_products('   ')), 0, 'solo espacios → vacío');
select is((select count(*)::int from public.public_search_products(null)), 0, 'NULL → vacío');
select is((select count(*)::int from public.public_search_products('%%')), 0, '"%%" se busca literal (no es comodín): 0 resultados, no todo el catálogo');
select is((select count(*)::int from public.public_search_products('c_')), 0, '"_" se busca literal');
select is((select count(*)::int from public.public_search_products('borrador')), 0, 'un borrador no aparece en la búsqueda');
select is((select count(*)::int from public.public_search_products('archivado')), 0, 'un archivado no aparece en la búsqueda');
select is((select count(*)::int from public.public_search_products('sin-001')), 0, 'un producto sin precio no aparece en la búsqueda');
select is((select count(*)::int from public.public_search_products('''; drop table public.products; --')), 0, 'una inyección SQL no hace nada (0 resultados)');
select is((select count(*)::int from public.public_search_products(repeat('chaqueta ', 20000))), 0, 'una consulta de 180 KB no revienta: se recorta a 80 caracteres (anon la puede llamar)');
select is((select count(*)::int from public.public_search_products('sombrero', 1)), 1, 'límite 1');
select is((select count(*)::int from public.public_search_products('sombrero', 0)), 1, 'límite 0 se corrige a 1');
select is((select count(*)::int from public.public_search_products('sombrero', null)), 2, 'límite NULL usa el valor por defecto');
select is((select array_agg(t.slug order by t.ordinality) from public.public_search_products('cha') with ordinality as t), array['chaqueta-japandi', 'sombrero-chakra-naranja'],
  'el nombre que EMPIEZA con la búsqueda va antes que el que solo la contiene');
reset role;
select is((select count(*)::int from public.products), 8, 'la tabla de productos sigue intacta tras la "inyección"');

select * from finish();
rollback;
