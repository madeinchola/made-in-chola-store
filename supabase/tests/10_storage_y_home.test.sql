-- Sprint 2 · Storage (buckets, rutas, políticas) y contenido del HOME editable por los admins.
begin;
select plan(95);

alter table public.stock_movements disable trigger user;
alter table public.exchange_rates disable trigger user;
alter table public.product_slug_history disable trigger user;
truncate public.products, public.categories, public.collections, public.news_banners, public.home_sections,
         public.exchange_rates restart identity cascade;
alter table public.stock_movements enable trigger user;
alter table public.exchange_rates enable trigger user;
alter table public.product_slug_history enable trigger user;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('c0000000-0000-0000-0000-0000000000c1', 'cliente.s2@test.com', '{"full_name":"Cliente S2"}', 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-0000000000a1', 'admin.s2@test.com',   '{"full_name":"Admin S2"}',   'authenticated', 'authenticated');
select public.set_user_role('a0000000-0000-0000-0000-0000000000a1', 'admin');

-- ── Validadores de ruta ────────────────────────────────────────────────────────────────────
select is(public.storage_path_ok('product-images', 'products/b2000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.jpg'), true, 'ruta válida de producto');
select is(public.storage_path_ok('product-images', 'products/b2000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.avif'), true, 'avif permitido');
select is(public.storage_path_ok('product-images', 'products/b2000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.svg'), false, 'svg rechazado');
select is(public.storage_path_ok('product-images', 'products/b2000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.JPG'), false, 'extensión en mayúsculas rechazada');
select is(public.storage_path_ok('product-images', 'products/../aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.jpg'), false, 'recorrido de directorios (..) rechazado');
select is(public.storage_path_ok('product-images', 'products/b2000000-0000-0000-0000-000000000001/extra/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.jpg'), false, 'subcarpetas extra rechazadas');
select is(public.storage_path_ok('product-images', 'products/B2000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.jpg'), false, 'uuid en mayúsculas rechazado (convención en minúsculas)');
select is(public.storage_path_ok('product-images', 'home/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.jpg'), false, 'ruta de home en el bucket de productos rechazada');
select is(public.storage_path_ok('site-media', 'home/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.webp'), true, 'ruta válida de imagen del home');
select is(public.storage_path_ok('site-media', 'home/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.mp4'), false, 'video en el bucket de imágenes rechazado');
select is(public.storage_path_ok('site-videos', 'home/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.mp4'), true, 'ruta válida de video');
select is(public.storage_path_ok('site-videos', 'home/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.webm'), true, 'webm permitido');
select is(public.storage_path_ok('site-videos', 'home/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.jpg'), false, 'imagen en el bucket de videos rechazada');
select is(public.storage_path_ok('otro-bucket', 'home/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.jpg'), false, 'bucket desconocido rechazado');
select is(public.home_media_ok('none', null), true, 'sin medio: ok');
select is(public.home_media_ok('none', 'home/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.jpg'), false, 'sin medio pero con ruta: incoherente');
select is(public.home_media_ok('image', null), false, 'imagen sin ruta rechazada');
select is(public.home_media_ok('image', 'home/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.jpg'), true, 'imagen con ruta válida');
select is(public.home_media_ok('image', 'home/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.mp4'), false, 'imagen con ruta de video rechazada');
select is(public.home_media_ok('video', 'home/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.mp4'), true, 'video con ruta válida');
select is(public.home_media_ok('video', 'home/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.jpg'), false, 'video con ruta de imagen rechazado');
select is(public.home_media_ok('gif', null), false, 'tipo de medio desconocido rechazado');

-- ── Buckets ────────────────────────────────────────────────────────────────────────────────
select is((select string_agg(id, ',' order by id) from storage.buckets where id in ('product-images', 'site-media', 'site-videos') and public), 'product-images,site-media,site-videos', 'los 3 buckets existen y son de lectura pública');
select is((select file_size_limit from storage.buckets where id = 'product-images'), 5242880::bigint, 'product-images: 5 MiB');
select is((select file_size_limit from storage.buckets where id = 'site-media'), 8388608::bigint, 'site-media: 8 MiB');
select is((select file_size_limit from storage.buckets where id = 'site-videos'), 52428800::bigint, 'site-videos: 50 MiB');
select is((select 'image/jpeg' = any (allowed_mime_types) and 'image/webp' = any (allowed_mime_types) from storage.buckets where id = 'product-images'), true, 'product-images admite jpeg y webp');
select is((select 'image/svg+xml' = any (allowed_mime_types) or 'text/html' = any (allowed_mime_types) from storage.buckets where id = 'product-images'), false, 'product-images NO admite svg ni html');
select is((select allowed_mime_types from storage.buckets where id = 'site-videos'), array['video/mp4', 'video/webm'], 'site-videos solo mp4 y webm');

-- ── Políticas de Storage (inserciones reales en storage.objects) ───────────────────────────
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$insert into storage.objects (bucket_id, name) values ('product-images', 'products/b2000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.jpg')$$, '42501', null, 'anon NO sube archivos');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select throws_ok($$insert into storage.objects (bucket_id, name) values ('product-images', 'products/b2000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.jpg')$$, '42501', null, 'un cliente NO sube archivos');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select lives_ok($$insert into storage.objects (bucket_id, name) values ('product-images', 'products/b2000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.jpg')$$, 'el admin sube una imagen de producto con ruta válida');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('product-images', 'cualquier-cosa.jpg')$$, '42501', null, 'el admin NO puede subir fuera de la convención de rutas');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('product-images', 'products/b2000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2.exe')$$, '42501', null, 'el admin NO sube extensiones no permitidas');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('site-media', 'products/b2000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3.jpg')$$, '42501', null, 'ruta de producto en el bucket del home rechazada');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('bucket-ajeno', 'home/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4.jpg')$$, '42501', null, 'el admin NO escribe en buckets que no son del sitio');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('site-videos', 'home/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5.mp4')$$, 'el admin sube un video del home');
select throws_ok($$update storage.objects set name = 'robado.jpg' where bucket_id = 'product-images'$$, '42501', null, 'el admin NO puede renombrar un objeto a una ruta fuera de la convención');
select throws_ok($$delete from storage.objects where bucket_id = 'site-videos'$$, null, 'Direct deletion from storage tables is not allowed. Use the Storage API instead.',
  'el DELETE por SQL sobre storage.objects lo bloquea Supabase (se borra con la API de Storage; la política de borrado se prueba en la integración)');
select is((select count(*)::int from storage.objects where bucket_id = 'product-images' and name like 'products/b2000000-0000-0000-0000-000000000001/%'), 1, 'el admin lista los objetos de sus buckets (los de esta prueba)');
select ok((select count(*)::int from storage.objects where bucket_id = 'product-images') >= 1, 'el admin ve además los objetos que ya existían en el bucket (p. ej. las imágenes del seed)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'product-images'), 0, 'un cliente NO lista los objetos (la lectura pública es por URL directa)');
reset role;

-- ── Secciones del home: restricciones ──────────────────────────────────────────────────────
insert into public.categories (id, name, slug) values ('ca300000-0000-0000-0000-000000000001', 'Sombreros', 'sombreros');
insert into public.collections (id, name, slug) values ('c0330000-0000-0000-0000-000000000001', 'NADAS', 'nadas');
select lives_ok($$insert into public.home_sections (kind, title, cta_label, cta_url, media_kind, media_path) values ('hero', 'Verano 2027', 'Ver colección', '/coleccion/verano-2027', 'image', 'home/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6.jpg')$$, 'hero válido');
select throws_ok($$insert into public.home_sections (kind, cta_label) values ('hero', 'Ver')$$, '23514', null, 'etiqueta de botón sin enlace rechazada');
select throws_ok($$insert into public.home_sections (kind, cta_url) values ('hero', '/x')$$, '23514', null, 'enlace de botón sin etiqueta rechazado');
select throws_ok($$insert into public.home_sections (kind, cta_label, cta_url) values ('hero', 'Ver', 'javascript:alert(1)')$$, '23514', null, 'enlace javascript: rechazado');
select throws_ok($$insert into public.home_sections (kind, cta_label, cta_url) values ('hero', 'Ver', '//evil.com')$$, '23514', null, 'enlace //host rechazado');
select throws_ok($$insert into public.home_sections (kind) values ('carrusel')$$, '23514', null, 'tipo de sección desconocido rechazado');
select throws_ok($$insert into public.home_sections (kind, media_kind) values ('hero', 'image')$$, '23514', null, 'imagen sin ruta rechazada');
select throws_ok($$insert into public.home_sections (kind, media_kind, media_path) values ('hero', 'none', 'home/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6.jpg')$$, '23514', null, 'sin medio pero con ruta rechazado');
select throws_ok($$insert into public.home_sections (kind, media_kind, media_path) values ('hero', 'image', 'home/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6.mp4')$$, '23514', null, 'imagen con ruta de video rechazada');
select lives_ok($$insert into public.home_sections (kind, media_kind, media_path) values ('about', 'video', 'home/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7.mp4')$$, 'video con ruta de video aceptado');
select throws_ok($$insert into public.home_sections (kind, source_type) values ('product_row', 'none')$$, '23514', null, 'una fila de productos SIN origen es inválida');
select throws_ok($$insert into public.home_sections (kind, source_type) values ('product_row', 'category')$$, '23514', null, 'origen "category" sin categoría rechazado');
select lives_ok($$insert into public.home_sections (kind, title, source_type, source_category_id) values ('product_row', 'Sombreros', 'category', 'ca300000-0000-0000-0000-000000000001')$$, 'fila de productos por categoría válida');
select throws_ok($$insert into public.home_sections (kind, source_type, source_collection_id) values ('product_row', 'category', 'c0330000-0000-0000-0000-000000000001')$$, '23514', null, 'origen "category" con colección rechazado');
select lives_ok($$insert into public.home_sections (kind, source_type) values ('product_row', 'latest')$$, 'fila de lo más reciente válida');
select lives_ok($$insert into public.home_sections (kind, source_type) values ('product_row', 'manual')$$, 'fila de productos elegidos a mano válida');
select throws_ok($$insert into public.home_sections (kind, source_type) values ('collection_feature', 'latest')$$, '23514', null, 'colección destacada con origen "latest" rechazada');
select lives_ok($$insert into public.home_sections (kind, title, source_type, source_collection_id) values ('collection_feature', 'Colección NADAS', 'collection', 'c0330000-0000-0000-0000-000000000001')$$, 'colección destacada válida');
select throws_ok($$insert into public.home_sections (kind, source_type, source_category_id) values ('hero', 'category', 'ca300000-0000-0000-0000-000000000001')$$, '23514', null, 'un hero NO puede tener origen de productos');
select throws_ok($$insert into public.home_sections (kind, source_type, item_limit) values ('product_row', 'latest', 0)$$, '23514', null, 'límite 0 rechazado');
select throws_ok($$insert into public.home_sections (kind, source_type, item_limit) values ('product_row', 'latest', 25)$$, '23514', null, 'límite 25 rechazado');
select throws_ok($$insert into public.home_sections (kind, title) values ('hero', repeat('x', 121))$$, '23514', null, 'título de más de 120 caracteres rechazado');
insert into public.home_sections (id, kind, title, sort_order, is_active, archived_at) values
  ('a2000000-0000-0000-0000-00000000000a', 'tagline', 'A (orden 2)', 2, true,  null),
  ('a2000000-0000-0000-0000-00000000000b', 'tagline', 'B (orden 1)', 1, true,  null),
  ('a2000000-0000-0000-0000-00000000000c', 'tagline', 'C inactiva',  3, false, null),
  ('a2000000-0000-0000-0000-00000000000d', 'tagline', 'D archivada', 4, true,  now());
select throws_ok($$insert into public.home_section_items (section_id, product_id, category_id) values ('a2000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'ca300000-0000-0000-0000-000000000001')$$, '23514', null, 'un elemento no puede apuntar a producto Y categoría a la vez');
select throws_ok($$insert into public.home_section_items (section_id, link_url) values ('a2000000-0000-0000-0000-00000000000a', 'javascript:alert(1)')$$, '23514', null, 'elemento con enlace javascript: rechazado');
select throws_ok($$insert into public.home_section_items (section_id, media_kind) values ('a2000000-0000-0000-0000-00000000000a', 'video')$$, '23514', null, 'elemento con video sin ruta rechazado');
select throws_ok($$insert into public.home_section_items (section_id) values (gen_random_uuid())$$, '23503', null, 'elemento de una sección inexistente rechazado');
insert into public.home_section_items (id, section_id, label, sort_order, archived_at) values
  ('a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-00000000000a', 'visible',        1, null),
  ('a3000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-00000000000c', 'de sección inactiva', 1, null),
  ('a3000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-00000000000a', 'archivado',      2, now()),
  ('a3000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-00000000000d', 'de sección archivada', 1, null);
select throws_ok($$delete from public.home_sections where id = 'a2000000-0000-0000-0000-00000000000a'$$, '23503', null, 'ni el propietario borra una sección con elementos');

-- ── Fixture: referencias a entidades públicas y NO públicas ────────────────────────────────
insert into public.products (id, code, slug, name) values
  ('b3000000-0000-0000-0000-000000000001', 'HP-1', 'hp-1', 'Visible'),
  ('b3000000-0000-0000-0000-000000000002', 'HD-1', 'hd-1', 'Borrador');
insert into public.product_colors (id, product_id, name) values
  ('d5000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', 'Único'),
  ('d5000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-000000000002', 'Único');
insert into public.product_variants (id, product_id, color_id) values
  ('f6000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001'),
  ('f6000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-000000000002', 'd5000000-0000-0000-0000-000000000002');
insert into public.product_prices (product_id, currency, amount) values
  ('b3000000-0000-0000-0000-000000000001', 'BOB', 100), ('b3000000-0000-0000-0000-000000000002', 'BOB', 100);
select public.apply_stock_change('f6000000-0000-0000-0000-000000000001', 3, 'import');
update public.products set status = 'active' where code = 'HP-1';
insert into public.categories (id, name, slug, archived_at) values ('ca300000-0000-0000-0000-000000000002', 'Vieja', 'vieja', now());
insert into public.collections (id, name, slug, ends_at) values ('c0330000-0000-0000-0000-000000000002', 'Vencida', 'vencida', now() - interval '1 day');
insert into public.home_sections (id, kind, title, sort_order, source_type, source_category_id, source_collection_id) values
  ('a2000000-0000-0000-0000-0000000000e1', 'product_row', 'Fila categoría archivada', 20, 'category', 'ca300000-0000-0000-0000-000000000002', null),
  ('a2000000-0000-0000-0000-0000000000e2', 'product_row', 'Fila categoría activa', 21, 'category', 'ca300000-0000-0000-0000-000000000001', null),
  ('a2000000-0000-0000-0000-0000000000e3', 'collection_feature', 'Colección vencida', 22, 'collection', null, 'c0330000-0000-0000-0000-000000000002'),
  ('a2000000-0000-0000-0000-0000000000e4', 'collection_feature', 'Colección vigente', 23, 'collection', null, 'c0330000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-0000000000e5', 'tagline', 'Con referencias', 24, 'none', null, null);
insert into public.home_section_items (section_id, label, sort_order, product_id, category_id, collection_id) values
  ('a2000000-0000-0000-0000-0000000000e5', 'item producto visible', 1, 'b3000000-0000-0000-0000-000000000001', null, null),
  ('a2000000-0000-0000-0000-0000000000e5', 'item producto borrador', 2, 'b3000000-0000-0000-0000-000000000002', null, null),
  ('a2000000-0000-0000-0000-0000000000e5', 'item categoría archivada', 3, null, 'ca300000-0000-0000-0000-000000000002', null),
  ('a2000000-0000-0000-0000-0000000000e5', 'item categoría activa', 4, null, 'ca300000-0000-0000-0000-000000000001', null),
  ('a2000000-0000-0000-0000-0000000000e5', 'item colección vencida', 5, null, null, 'c0330000-0000-0000-0000-000000000002'),
  ('a2000000-0000-0000-0000-0000000000e5', 'item colección vigente', 6, null, null, 'c0330000-0000-0000-0000-000000000001');

-- ── Vistas públicas del home ───────────────────────────────────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select string_agg(title, ' | ' order by sort_order) from public.public_home_sections where title like '%(orden%'), 'B (orden 1) | A (orden 2)', 'las secciones públicas salen ordenadas y sin las inactivas/archivadas');
select is((select count(*)::int from public.public_home_sections where title in ('C inactiva', 'D archivada')), 0, 'inactivas y archivadas no se publican');
select is((select string_agg(label, ',') from public.public_home_section_items where section_id = 'a2000000-0000-0000-0000-00000000000a'), 'visible', 'solo el elemento activo de una sección publicada');
-- El home no revela ids de entidades que no son públicas
select is((select product_id from public.public_home_section_items where label = 'item producto visible'), 'b3000000-0000-0000-0000-000000000001'::uuid, 'una referencia a un producto PÚBLICO se conserva');
select is((select product_id from public.public_home_section_items where label = 'item producto borrador'), null, 'una referencia a un producto en BORRADOR se anula (no se filtra su id)');
select is((select category_id from public.public_home_section_items where label = 'item categoría archivada'), null, 'una referencia a una categoría ARCHIVADA se anula');
select is((select category_id from public.public_home_section_items where label = 'item categoría activa'), 'ca300000-0000-0000-0000-000000000001'::uuid, 'una referencia a una categoría pública se conserva');
select is((select collection_id from public.public_home_section_items where label = 'item colección vencida'), null, 'una referencia a una colección VENCIDA se anula');
select is((select collection_id from public.public_home_section_items where label = 'item colección vigente'), 'c0330000-0000-0000-0000-000000000001'::uuid, 'una referencia a una colección vigente se conserva');
select is((select source_category_id from public.public_home_sections where title = 'Fila categoría archivada'), null, 'la sección con origen en una categoría archivada no revela su id');
select is((select source_category_id from public.public_home_sections where title = 'Fila categoría activa'), 'ca300000-0000-0000-0000-000000000001'::uuid, 'el origen en una categoría pública se conserva');
select is((select source_collection_id from public.public_home_sections where title = 'Colección vencida'), null, 'la sección con origen en una colección vencida no revela su id');
select is((select source_collection_id from public.public_home_sections where title = 'Colección vigente'), 'c0330000-0000-0000-0000-000000000001'::uuid, 'el origen en una colección vigente se conserva');
select throws_ok($$select * from public.home_sections$$, '42501', null, 'anon NO lee la tabla home_sections');
reset role;

-- ── RLS de las tablas del home ─────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is((select count(*)::int from public.home_sections), 0, 'un cliente NO ve filas de home_sections (RLS)');
select throws_ok($$insert into public.home_sections (kind, title) values ('hero', 'Hack')$$, '42501', null, 'un cliente NO crea secciones');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select lives_ok($$insert into public.home_sections (kind, title, sort_order) values ('banner', 'Creada por el admin', 9)$$, 'el admin crea una sección');
select lives_ok($$update public.home_sections set title = 'Editada por el admin', is_active = false where title = 'Creada por el admin'$$, 'el admin edita y desactiva una sección');
select throws_ok($$update public.home_sections set kind = 'hero' where title = 'Editada por el admin'$$, '42501', null, 'el admin NO cambia el tipo de una sección');
select throws_ok($$delete from public.home_sections where title = 'Editada por el admin'$$, '42501', null, 'el admin NO borra secciones');
select lives_ok($$update public.home_sections set archived_at = now() where title = 'Editada por el admin'$$, 'el admin archiva una sección');
select lives_ok($$insert into public.home_section_items (section_id, label, link_url, sort_order) values ('a2000000-0000-0000-0000-00000000000b', 'Carteras', '/categoria/carteras', 1)$$, 'el admin añade un elemento');
select throws_ok($$update public.home_section_items set section_id = 'a2000000-0000-0000-0000-00000000000a' where label = 'Carteras'$$, '42501', null, 'el admin NO mueve un elemento a otra sección');
select throws_ok($$delete from public.home_section_items$$, '42501', null, 'el admin NO borra elementos (los archiva)');
select lives_ok($$update public.home_section_items set archived_at = now() where label = 'Carteras'$$, 'el admin archiva un elemento');
reset role;
select is((select count(*)::int from public.audit_log where table_name = 'home_sections' and action = 'UPDATE'
             and actor_id = 'a0000000-0000-0000-0000-0000000000a1' and diff -> 'title' ->> 'new' = 'Editada por el admin'), 1,
          'la edición de la sección quedó auditada con su autor');

select * from finish();
rollback;
