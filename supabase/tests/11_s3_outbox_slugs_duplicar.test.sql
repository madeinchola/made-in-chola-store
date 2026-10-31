-- Sprint 3 · Outbox de notificaciones, alertas de stock (cruce de umbrales), historial de slugs y duplicar producto.
-- Valores esperados calculados a mano (umbrales por defecto 5/2; ver comentarios en cada paso).
begin;
select plan(140);

alter table public.stock_movements disable trigger user;
alter table public.exchange_rates disable trigger user;
alter table public.product_slug_history disable trigger user;
truncate public.products, public.categories, public.collections, public.news_banners, public.home_sections,
         public.exchange_rates, public.notification_outbox restart identity cascade;
alter table public.stock_movements enable trigger user;
alter table public.exchange_rates enable trigger user;
alter table public.product_slug_history enable trigger user;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('c0000000-0000-0000-0000-0000000000c1', 'cliente.s3@test.com', '{"full_name":"Cliente S3"}', 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-0000000000a1', 'admin.s3@test.com',   '{"full_name":"Admin S3"}',   'authenticated', 'authenticated');
select public.set_user_role('a0000000-0000-0000-0000-0000000000a1', 'admin');

-- ── Fixture ────────────────────────────────────────────────────────────────────────────────
-- T1 = producto fuente (2 colores activos + 1 archivado, 2 tallas) · T2 = relacionado/slug · T3 = borrador · T4 = archivado
insert into public.products (id, code, slug, name, model, description, materials, washcare, cost_base, is_new) values
  ('b3000000-0000-0000-0000-000000000001', 'T-1', 't-1', 'Camiseta Uno', 'Modelo X', 'Descripción uno', 'Algodón', 'Lavar a mano', 45.50, true),
  ('b3000000-0000-0000-0000-000000000002', 'T-2', 't-2', 'Camiseta Dos', null, '', null, null, null, false),
  ('b3000000-0000-0000-0000-000000000003', 'T-3', 't-3', 'Camiseta Tres (borrador)', null, '', null, null, null, false),
  ('b3000000-0000-0000-0000-000000000004', 'T-4', 't-4', 'Camiseta Cuatro (archivada)', null, '', null, null, null, false);
insert into public.product_colors (id, product_id, name, sort_order) values
  ('d4000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', 'Rojo', 1),
  ('d4000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-000000000001', 'Azul', 2),
  ('d4000000-0000-0000-0000-000000000003', 'b3000000-0000-0000-0000-000000000001', 'Verde', 3),
  ('d4000000-0000-0000-0000-000000000012', 'b3000000-0000-0000-0000-000000000002', 'Único', 1),
  ('d4000000-0000-0000-0000-000000000013', 'b3000000-0000-0000-0000-000000000003', 'Único', 1),
  ('d4000000-0000-0000-0000-000000000014', 'b3000000-0000-0000-0000-000000000004', 'Único', 1);
insert into public.product_sizes (id, product_id, label, sort_order) values
  ('e4000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', 'S', 1),
  ('e4000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-000000000001', 'M', 2);
insert into public.product_variants (id, product_id, color_id, size_id, low_threshold, critical_threshold) values
  ('f4000000-0000-0000-0000-00000000000a', 'b3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001', null, null), -- vA Rojo-S
  ('f4000000-0000-0000-0000-00000000000b', 'b3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000002', 10, 1),       -- vB Rojo-M (umbrales propios 10/1)
  ('f4000000-0000-0000-0000-00000000000c', 'b3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000002', 'e4000000-0000-0000-0000-000000000001', null, null), -- vC Azul-S
  ('f4000000-0000-0000-0000-00000000000d', 'b3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000002', 'e4000000-0000-0000-0000-000000000002', null, null), -- vD Azul-M
  ('f4000000-0000-0000-0000-00000000000e', 'b3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000003', 'e4000000-0000-0000-0000-000000000001', null, null), -- vE Verde-S (se archiva con su color)
  ('f4000000-0000-0000-0000-000000000012', 'b3000000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-000000000012', null, null, null),
  ('f4000000-0000-0000-0000-000000000013', 'b3000000-0000-0000-0000-000000000003', 'd4000000-0000-0000-0000-000000000013', null, null, null), -- vT3 borrador
  ('f4000000-0000-0000-0000-000000000014', 'b3000000-0000-0000-0000-000000000004', 'd4000000-0000-0000-0000-000000000014', null, null, null); -- vT4 (producto archivado)
insert into public.product_prices (product_id, currency, amount) select id, 'BOB', 100 from public.products;
insert into public.product_images (product_id, path, alt, sort_order)
values ('b3000000-0000-0000-0000-000000000001', 'products/b3000000-0000-0000-0000-000000000001/11111111-1111-1111-1111-111111111111.png', 'foto', 1);
insert into public.categories (id, name, slug) values
  ('ca000000-0000-0000-0000-000000000001', 'Remeras', 'remeras'),
  ('ca000000-0000-0000-0000-000000000002', 'Antiguas', 'antiguas');
insert into public.collections (id, name, slug) values
  ('c4000000-0000-0000-0000-000000000001', 'Verano', 'verano'),
  ('c4000000-0000-0000-0000-000000000002', 'Pasada', 'pasada');
insert into public.product_categories (product_id, category_id) values
  ('b3000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001'),
  ('b3000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000002');
insert into public.product_collections (product_id, collection_id, sort_order) values
  ('b3000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001', 3),
  ('b3000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000002', 5);
insert into public.product_related (product_id, related_id, sort_order)
values ('b3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000002', 1);
update public.categories set archived_at = now() where slug = 'antiguas';
update public.collections set archived_at = now() where slug = 'pasada';
update public.product_colors set archived_at = now() where name = 'Verde';  -- archiva también la variante vE (cascada de S2)
update public.products set status = 'active' where code in ('T-1', 'T-2', 'T-4');

-- Stock inicial SIEMPRE por el libro mayor. Una carga inicial MEJORA el estado (0 → N): jamás alerta.
select public.apply_stock_change('f4000000-0000-0000-0000-00000000000a', 20, 'import', 'carga inicial');
select public.apply_stock_change('f4000000-0000-0000-0000-00000000000b', 20, 'import', 'carga inicial');
select public.apply_stock_change('f4000000-0000-0000-0000-00000000000c', 20, 'import', 'carga inicial');
select public.apply_stock_change('f4000000-0000-0000-0000-000000000013', 10, 'import', 'carga inicial');
select public.apply_stock_change('f4000000-0000-0000-0000-000000000014', 10, 'import', 'carga inicial');

-- ── 1. Alertas de stock: solo al CRUZAR un umbral hacia peor ───────────────────────────────
select is((select count(*)::int from public.notification_outbox), 0, 'las cargas iniciales (0 → 20) no generan alertas');

select public.apply_stock_change('f4000000-0000-0000-0000-00000000000a', -12, 'sale');   -- 20 → 8 (ok → ok)
select is((select count(*)::int from public.notification_outbox where type = 'stock_alert'), 0, '20 → 8 sigue en "ok" (umbral 5): sin alerta');

select public.apply_stock_change('f4000000-0000-0000-0000-00000000000a', -4, 'sale');    -- 8 → 4 (ok → low)
select is((select count(*)::int from public.notification_outbox where type = 'stock_alert'), 1, '8 → 4 cruza el umbral bajo (4 ≤ 5): 1 alerta');
select is((select payload ->> 'light' from public.notification_outbox order by id desc limit 1), 'low', 'la alerta es de nivel "low"');
select is((select payload ->> 'stock' from public.notification_outbox order by id desc limit 1), '4', 'la alerta lleva el stock resultante (4)');
select is((select payload ->> 'low_threshold' || '/' || (payload ->> 'critical_threshold') from public.notification_outbox order by id desc limit 1), '5/2', 'la alerta lleva los umbrales usados (5/2, los globales)');
select is((select payload ->> 'product_code' || '|' || (payload ->> 'color') || '|' || (payload ->> 'size') from public.notification_outbox order by id desc limit 1), 'T-1|Rojo|S', 'la alerta identifica producto, color y talla');
select is((select payload ->> 'sku' from public.notification_outbox order by id desc limit 1), (select sku from public.product_variants where id = 'f4000000-0000-0000-0000-00000000000a'), 'la alerta lleva el SKU real de la variante');
select is((select channel || '|' || coalesce(recipient, '∅') || '|' || status || '|' || attempts from public.notification_outbox order by id desc limit 1), 'email|∅|pending|0', 'canal email, destinatario NULL (administradores), pendiente, 0 intentos');
select ok((select dedupe_key like 'stock_alert:f4000000-0000-0000-0000-00000000000a:low:%' from public.notification_outbox order by id desc limit 1), 'la clave de deduplicación lleva variante y nivel');

select public.apply_stock_change('f4000000-0000-0000-0000-00000000000a', -1, 'sale');    -- 4 → 3 (low → low)
select is((select count(*)::int from public.notification_outbox where type = 'stock_alert'), 1, '4 → 3 sigue en "low": sin alerta nueva');

select public.apply_stock_change('f4000000-0000-0000-0000-00000000000a', -2, 'sale');    -- 3 → 1 (low → critical)
select is((select count(*)::int from public.notification_outbox where type = 'stock_alert'), 2, '3 → 1 cruza el umbral crítico (1 ≤ 2): segunda alerta');
select is((select payload ->> 'light' || '|' || (payload ->> 'stock') from public.notification_outbox order by id desc limit 1), 'critical|1', 'nivel "critical" con stock 1');

select public.apply_stock_change('f4000000-0000-0000-0000-00000000000a', -1, 'sale');    -- 1 → 0 (critical → out)
select is((select count(*)::int from public.notification_outbox where type = 'stock_alert'), 3, '1 → 0: tercera alerta');
select is((select payload ->> 'light' || '|' || (payload ->> 'stock') from public.notification_outbox order by id desc limit 1), 'out|0', 'nivel "out" con stock 0');

select public.apply_stock_change('f4000000-0000-0000-0000-00000000000a', 10, 'return');  -- 0 → 10 (mejora)
select is((select count(*)::int from public.notification_outbox where type = 'stock_alert'), 3, 'recuperar stock (0 → 10) no genera alertas');

-- Deduplicación: hay una alerta "low" PENDIENTE de esta variante, así que un nuevo cruce a "low" no encola otra.
select public.apply_stock_change('f4000000-0000-0000-0000-00000000000a', -6, 'sale');    -- 10 → 4 (ok → low)
select is((select count(*)::int from public.notification_outbox where type = 'stock_alert'), 3, '10 → 4 cruza a "low" pero ya hay una "low" pendiente de esa variante: no se duplica');

-- Re-armado: una vez procesadas las pendientes, un nuevo cruce vuelve a alertar.
set local role service_role;
update public.notification_outbox set status = 'sent';
reset role;
select is((select count(*)::int from public.notification_outbox where status = 'sent'), 3, 'service_role marca las 3 alertas como enviadas');
select public.apply_stock_change('f4000000-0000-0000-0000-00000000000a', 5, 'return');   -- 4 → 9 (mejora)
select public.apply_stock_change('f4000000-0000-0000-0000-00000000000a', -6, 'sale');    -- 9 → 3 (ok → low)
select is((select count(*)::int from public.notification_outbox where type = 'stock_alert'), 4, 're-armada: sin pendientes, el nuevo cruce (9 → 3) vuelve a alertar');
select is((select payload ->> 'light' || '|' || (payload ->> 'stock') from public.notification_outbox order by id desc limit 1), 'low|3', 'la nueva alerta es "low" con stock 3');

-- Moverse DENTRO del mismo nivel nunca alerta, tampoco cuando ya no hay alertas pendientes (la deduplicación no debe ser
-- lo único que lo evite).
update public.notification_outbox set status = 'sent';
select public.apply_stock_change('f4000000-0000-0000-0000-00000000000a', 1, 'return');   -- 3 → 4 (low → low)
select is((select count(*)::int from public.notification_outbox where type = 'stock_alert'), 4, 'low → low (3 → 4) no alerta, aunque no haya pendientes');
select public.apply_stock_change('f4000000-0000-0000-0000-00000000000a', -1, 'sale');    -- 4 → 3 (low → low)
select is((select count(*)::int from public.notification_outbox where type = 'stock_alert'), 4, 'low → low (4 → 3) tampoco alerta');

-- Umbrales PROPIOS de la variante (10/1): 20 → 9 es "ok" con los globales, pero "low" con los suyos.
select public.apply_stock_change('f4000000-0000-0000-0000-00000000000b', -11, 'sale');   -- 20 → 9
select is((select count(*)::int from public.notification_outbox where type = 'stock_alert'), 5, 'con umbrales propios 10/1, 9 ≤ 10 cruza a "low"');
select is((select payload ->> 'low_threshold' || '/' || (payload ->> 'critical_threshold') || '|' || (payload ->> 'light') from public.notification_outbox order by id desc limit 1), '10/1|low', 'la alerta usa los umbrales propios de la variante');
select public.apply_stock_change('f4000000-0000-0000-0000-00000000000b', -9, 'sale');    -- 9 → 0 (low → out)
select is((select count(*)::int from public.notification_outbox where type = 'stock_alert'), 6, '9 → 0 en esa variante: alerta "out"');

-- Umbral GLOBAL editable por el admin (ajuste stock_low_threshold = 8): 20 → 7 es "ok" con 5 pero "low" con 8.
update public.store_settings set value = '8'::jsonb where key = 'stock_low_threshold';
select public.apply_stock_change('f4000000-0000-0000-0000-00000000000c', -13, 'sale');   -- 20 → 7
select is((select count(*)::int from public.notification_outbox where type = 'stock_alert'), 7, 'con el umbral global en 8, 7 ≤ 8 cruza a "low"');
select is((select payload ->> 'low_threshold' || '/' || (payload ->> 'critical_threshold') from public.notification_outbox order by id desc limit 1), '8/2', 'la alerta refleja el ajuste global (8) y el crítico (2)');
update public.store_settings set value = '5'::jsonb where key = 'stock_low_threshold';

-- Solo productos PUBLICADOS y no archivados: un borrador o un archivado no alertan.
select public.apply_stock_change('f4000000-0000-0000-0000-000000000013', -9, 'sale');    -- borrador: 10 → 1
update public.products set archived_at = now() where code = 'T-4';
select public.apply_stock_change('f4000000-0000-0000-0000-000000000014', -9, 'sale');    -- archivado: 10 → 1
select is((select count(*)::int from public.notification_outbox where type = 'stock_alert'), 7, 'un borrador y un producto archivado NO generan alertas');

-- ── 2. Outbox: encolado idempotente y permisos por rol ─────────────────────────────────────
set local role service_role;
select ok(public.enqueue_notification('order_status', 'email', 'cliente@x.com', '{"order":1}', 'k-1') is not null, 'service_role encola una notificación');
select ok(public.enqueue_notification('order_status', 'email', 'cliente@x.com', '{"order":1}', 'k-1') is null, 'misma dedupe_key: no duplica (devuelve NULL)');
select throws_ok($$select public.enqueue_notification('order_status', 'sms', null, '{}', 'k-2')$$, '23514', null, 'canal fuera del catálogo rechazado');
select throws_ok($$select public.enqueue_notification('Tipo Malo', 'email', null, '{}', 'k-3')$$, '23514', null, 'tipo con formato inválido rechazado');
select throws_ok($$select public.enqueue_notification('order_status', 'email', null, '[1]', 'k-4')$$, '23514', null, 'payload que no es un objeto rechazado');
select lives_ok($$update public.notification_outbox set attempts = 1, status = 'failed' where dedupe_key = 'k-1'$$, 'service_role puede marcar intentos y estado (lo hará S13)');
select throws_ok($$delete from public.notification_outbox$$, '42501', null, 'service_role no puede borrar: queda el rastro');
reset role;
select is((select count(*)::int from public.notification_outbox where dedupe_key = 'k-1'), 1, 'k-1 existe una sola vez');
select is((select count(*)::int from public.notification_outbox where dedupe_key in ('k-2', 'k-3', 'k-4')), 0, 'las notificaciones rechazadas no dejaron fila');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select throws_ok($$select public.enqueue_notification('x', 'email', null, '{}', 'k-9')$$, '42501', null, 'un cliente no puede encolar notificaciones');
select is((select count(*)::int from public.notification_outbox), 0, 'un cliente no ve ninguna fila de la outbox (RLS)');
select throws_ok($$insert into public.notification_outbox (type, channel, dedupe_key) values ('x', 'email', 'k-9')$$, '42501', null, 'un cliente no inserta en la outbox');
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select count(*) from public.notification_outbox$$, '42501', null, 'anon no tiene privilegios sobre la outbox');
select throws_ok($$select public.enqueue_notification('x', 'email', null, '{}', 'k-9')$$, '42501', null, 'anon no puede encolar');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.notification_outbox), 8, 'el admin ve las 8 filas de la outbox (7 alertas + k-1)');
select throws_ok($$insert into public.notification_outbox (type, channel, dedupe_key) values ('x', 'email', 'k-9')$$, '42501', null, 'ni el admin inserta directo en la outbox');
select throws_ok($$update public.notification_outbox set status = 'sent'$$, '42501', null, 'ni el admin actualiza la outbox');
select throws_ok($$delete from public.notification_outbox$$, '42501', null, 'ni el admin borra de la outbox');
select throws_ok($$select public.enqueue_notification('x', 'email', null, '{}', 'k-9')$$, '42501', null, 'ni el admin ejecuta enqueue_notification (solo service_role)');
reset role;

select ok(not has_function_privilege('anon', 'public.enqueue_notification(text,text,text,jsonb,text)', 'execute')
      and not has_function_privilege('authenticated', 'public.enqueue_notification(text,text,text,jsonb,text)', 'execute')
      and has_function_privilege('service_role', 'public.enqueue_notification(text,text,text,jsonb,text)', 'execute'),
  'enqueue_notification: solo service_role puede ejecutarla');
select ok(not has_function_privilege('authenticated', 'public.stock_movements_alert()', 'execute')
      and not has_function_privilege('authenticated', 'public.products_log_slug_change()', 'execute'),
  'las funciones de trigger no son ejecutables desde el navegador');

-- ── 3. Historial de slugs ──────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
update public.products set slug = 't-uno' where code = 'T-1';
reset role;
select is((select count(*)::int from public.product_slug_history), 1, 'renombrar el slug guarda el anterior');
select is((select slug from public.product_slug_history), 't-1', 'se guarda el slug ANTERIOR (t-1), no el nuevo');
select is((select changed_by from public.product_slug_history), 'a0000000-0000-0000-0000-0000000000a1'::uuid, 'queda registrado quién hizo el cambio');
update public.products set name = 'Camiseta Uno v2' where code = 'T-1';
update public.products set slug = 't-uno' where code = 'T-1';
select is((select count(*)::int from public.product_slug_history), 1, 'cambiar otra columna, o repetir el mismo slug, no genera historial');
update public.products set slug = 't-final' where code = 'T-1';
select is((select string_agg(slug, ',' order by id) from public.product_slug_history where product_id = 'b3000000-0000-0000-0000-000000000001'), 't-1,t-uno', 'dos renombrados: la cadena guarda t-1 y t-uno en orden');
update public.products set slug = 't-1' where code = 'T-2';   -- T2 toma el slug que T1 abandonó
select is((select string_agg(old_slug || '>' || current_slug, ', ' order by old_slug) from public.public_product_slug_redirects), 't-2>t-1, t-uno>t-final',
  'la vista redirige cada slug abandonado a su producto actual; "t-1" ya es vigente en otro producto y NO redirige');
update public.products set slug = 't-3-nuevo' where code = 'T-3';
select is((select count(*)::int from public.product_slug_history where slug = 't-3'), 1, 'el borrador también guarda su historial');
select is((select string_agg(old_slug || '>' || current_slug, ', ' order by old_slug) from public.public_product_slug_redirects), 't-2>t-1, t-uno>t-final',
  'un producto no visible (borrador) no genera redirección pública');
-- Un slug interno de un BORRADOR no debe poder leerse desde fuera ni siquiera cuando el producto se publica después
select is((select string_agg(slug || ':' || was_public::text, ', ' order by id) from public.product_slug_history), 't-1:true, t-uno:true, t-2:true, t-3:false',
  'el historial recuerda si cada slug era público: los de productos publicados sí; el del borrador T3, no');
update public.products set status = 'active' where code = 'T-3';   -- el borrador T3 se publica (tiene precio y variante)
select is((select string_agg(old_slug || '>' || current_slug, ', ' order by old_slug) from public.public_product_slug_redirects), 't-2>t-1, t-uno>t-final',
  'al publicar T3, su slug de borrador ("t-3") NO aparece en la vista pública: no se filtran nombres de trabajo');
update public.products set status = 'draft' where code = 'T-3';    -- vuelve a borrador (las secciones siguientes lo esperan así)
select is((select string_agg(attname, ',' order by attnum) from pg_attribute where attrelid = 'public.public_product_slug_redirects'::regclass and attnum > 0), 'old_slug,current_slug',
  'la vista solo expone old_slug y current_slug');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*)::int from public.public_product_slug_redirects), 2, 'anon lee la vista de redirecciones (2 filas)');
select throws_ok($$select count(*) from public.product_slug_history$$, '42501', null, 'anon no lee la tabla de historial');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is((select count(*)::int from public.product_slug_history), 0, 'un cliente no ve filas del historial (RLS)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.product_slug_history), 4, 'el admin ve las 4 filas del historial (T1×2, T2, T3)');
select throws_ok($$insert into public.product_slug_history (product_id, slug) values ('b3000000-0000-0000-0000-000000000001', 'falso')$$, '42501', null, 'el admin no inserta historial a mano');
select throws_ok($$update public.product_slug_history set slug = 'x'$$, '42501', null, 'el admin no edita el historial');
select throws_ok($$delete from public.product_slug_history$$, '42501', null, 'el admin no borra el historial');
reset role;
select throws_ok($$update public.product_slug_history set slug = 'x'$$, '42501', null, 'el historial es inmutable aun para el superusuario (UPDATE)');
select throws_ok($$delete from public.product_slug_history$$, '42501', null, 'el historial es inmutable aun para el superusuario (DELETE)');
select throws_ok($$truncate public.product_slug_history$$, '42501', null, 'el historial es inmutable aun para el superusuario (TRUNCATE)');

-- Un producto ARCHIVADO tampoco estaba público: su slug anterior no debe redirigir
update public.products set slug = 't-4-renombrado' where code = 'T-4';
select is((select was_public::text from public.product_slug_history where slug = 't-4'), 'false', 'renombrar un producto ARCHIVADO guarda su slug anterior como NO público');
update public.products set slug = 't-4' where code = 'T-4';   -- se restaura (las secciones siguientes lo esperan así)

-- ── 3b. Listado del panel (admin_product_list) ─────────────────────────────────────────────
-- Stock final de T1 tras las pruebas de alertas: vA = 3 (bajo), vB = 0 (umbrales 10/1 → agotada), vC = 7 (normal), vD = 0 (nunca
-- cargada → agotada); vE está archivada y no cuenta. Total en stock = 3 + 0 + 7 + 0 = 10, 4 variantes activas, 2 agotadas.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select count(*) from public.admin_product_list$$, '42501', null, 'anon no puede leer el listado del panel');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is((select count(*)::int from public.admin_product_list), 0, 'un cliente lee la vista pero no ve ninguna fila (is_admin() dentro de la vista)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.admin_product_list), 4, 'el admin ve los 4 productos (incluido el borrador y el archivado)');
select is((select string_agg(code || ':' || display_state, ',' order by code) from public.admin_product_list),
  'T-1:active,T-2:soldout,T-3:draft,T-4:archived', 'estados: publicado, agotado (sin stock), borrador y archivado');
select is((select total_on_hand || '/' || total_available || '/' || variants_count || '/' || variants_out || '/' || worst_light from public.admin_product_list where code = 'T-1'),
  '10/10/4/2/out', 'T1: 10 en stock, 10 disponibles, 4 variantes activas, 2 agotadas, peor semáforo "out"');
select is((select price_bob::text || '|' || (cover_path is not null)::text from public.admin_product_list where code = 'T-1'), '100|true', 'T1: precio en BOB y portada (primera imagen)');
select is((select (cover_path is null)::text from public.admin_product_list where code = 'T-2'), 'true', 'T2 no tiene imagen: sin portada');
select is((select cardinality(category_ids) || '/' || cardinality(collection_ids) from public.admin_product_list where code = 'T-1'), '2/2', 'T1 expone sus 2 categorías y 2 colecciones para filtrar por ellas en el servidor');
select is((select count(*)::int from public.admin_product_list where category_ids @> array['ca000000-0000-0000-0000-000000000001']::uuid[]), 1, 'filtrar por categoría en el servidor (contiene) devuelve solo T1');
select is((select count(*)::int from public.admin_product_list where collection_ids @> array['c4000000-0000-0000-0000-000000000002']::uuid[]), 1, 'filtrar por colección en el servidor devuelve solo T1');
reset role;
update public.products set out_of_stock_behavior = 'hide' where code = 'T-2';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is((select display_state from public.admin_product_list where code = 'T-2'), 'hidden', '"Ocultar" + stock físico 0 → estado "hidden" (la tienda no lo muestra)');
reset role;
update public.products set out_of_stock_behavior = 'sold_out' where code = 'T-2';

-- ── 4. Duplicar producto ───────────────────────────────────────────────────────────────────
-- (la función es SECURITY DEFINER y exige is_admin(): se llama con la identidad del admin en los claims)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.product_variants where product_id = 'b3000000-0000-0000-0000-000000000001' and archived_at is null), 4,
  'fixture: T1 tiene 4 variantes activas (la de Verde se archivó con su color)');
create temp table d1 as select public.admin_duplicate_product('b3000000-0000-0000-0000-000000000001', 'T-1-COPIA', 'Camiseta Uno (copia)') as id;
select ok((select id from d1) is not null, 'el admin duplica el producto');
select is((select status || '|' || (archived_at is null)::text from public.products where id = (select id from d1)), 'draft|true', 'el duplicado nace en BORRADOR y no archivado');
select is((select slug from public.products where id = (select id from d1)), 'camiseta-uno-copia', 'slug = slugify("Camiseta Uno (copia)")');
select is((select code || '|' || name from public.products where id = (select id from d1)), 'T-1-COPIA|Camiseta Uno (copia)', 'código y nombre nuevos');
select is((select model || '|' || description || '|' || materials || '|' || washcare || '|' || cost_base::text || '|' || is_new::text from public.products where id = (select id from d1)),
  'Modelo X|Descripción uno|Algodón|Lavar a mano|45.50|true', 'copia modelo, descripción, materiales, cuidado, costo y "nuevo"');
select is((select string_agg(name, ',' order by sort_order) from public.product_colors where product_id = (select id from d1)), 'Rojo,Azul', 'copia los colores ACTIVOS en su orden (no el archivado Verde)');
select is((select string_agg(label, ',' order by sort_order) from public.product_sizes where product_id = (select id from d1)), 'S,M', 'copia las tallas');
select is((select string_agg(c.name || '-' || coalesce(s.label, '∅'), ',' order by c.sort_order, s.sort_order)
             from public.product_variants v join public.product_colors c on c.id = v.color_id left join public.product_sizes s on s.id = v.size_id
            where v.product_id = (select id from d1)), 'Rojo-S,Rojo-M,Azul-S,Azul-M', 'copia las 4 combinaciones activas (ni la de Verde ni duplicadas)');
select is((select coalesce(sum(stock_on_hand), 0)::int from public.product_variants where product_id = (select id from d1)), 0, 'las variantes nuevas arrancan con stock 0');
select is((select v.low_threshold || '/' || v.critical_threshold from public.product_variants v
             join public.product_colors c on c.id = v.color_id join public.product_sizes s on s.id = v.size_id
            where v.product_id = (select id from d1) and c.name = 'Rojo' and s.label = 'M'), '10/1', 'conserva los umbrales propios de la variante');
select is((select count(*)::int from public.product_variants where product_id = (select id from d1) and low_threshold is null and critical_threshold is null), 3, 'las demás variantes siguen con umbrales globales');
select ok((select amount = 100 from public.product_prices where product_id = (select id from d1) and currency = 'BOB' and country is null), 'copia el precio en BOB');
select is((select string_agg(c.slug, ',') from public.product_categories pc join public.categories c on c.id = pc.category_id where pc.product_id = (select id from d1)), 'remeras',
  'copia las categorías activas (no la archivada "antiguas")');
select is((select string_agg(c.slug || ':' || pc.sort_order, ',') from public.product_collections pc join public.collections c on c.id = pc.collection_id where pc.product_id = (select id from d1)), 'verano:3',
  'copia las colecciones activas con su orden (no la archivada)');
select is((select related_id::text || ':' || sort_order from public.product_related where product_id = (select id from d1)), 'b3000000-0000-0000-0000-000000000002:1', 'copia los relacionados');
select is((select count(*)::int from public.product_images where product_id = (select id from d1)), 0, 'NO copia imágenes');
select is((select (select count(*) from public.product_colors where product_id = 'b3000000-0000-0000-0000-000000000001')::text || '/'
              || (select count(*) from public.product_variants where product_id = 'b3000000-0000-0000-0000-000000000001') || '/'
              || (select count(*) from public.product_categories where product_id = 'b3000000-0000-0000-0000-000000000001') || '/'
              || (select count(*) from public.product_images where product_id = 'b3000000-0000-0000-0000-000000000001')), '3/5/2/1',
  'el producto original queda intacto (3 colores, 5 variantes, 2 categorías, 1 imagen)');
select ok(exists (select 1 from public.audit_log where table_name = 'products' and action = 'INSERT'
                    and record_id = (select id::text from d1) and actor_id = 'a0000000-0000-0000-0000-0000000000a1'),
  'la duplicación queda auditada con el admin como actor');

create temp table d2 as select public.admin_duplicate_product('b3000000-0000-0000-0000-000000000001', 'T-1-COPIA-2', 'Camiseta Uno (copia)') as id;
select is((select slug from public.products where id = (select id from d2)), 'camiseta-uno-copia-2', 'mismo nombre: el slug choca y recibe sufijo -2');
create temp table d3 as select public.admin_duplicate_product('b3000000-0000-0000-0000-000000000001', 'T-1-COPIA-3', 'Camiseta Uno (copia)') as id;
select is((select slug from public.products where id = (select id from d3)), 'camiseta-uno-copia-3', 'y el tercero recibe -3');
create temp table d4 as select public.admin_duplicate_product('b3000000-0000-0000-0000-000000000002', 'ZZ-9', '???') as id;
select is((select slug from public.products where id = (select id from d4)), 'zz-9', 'nombre sin letras ni números: el slug sale del código');

select throws_ok($$select public.admin_duplicate_product('b3000000-0000-0000-0000-000000000001', 't-1', 'Otro')$$, '23505', null, 'código repetido (sin distinguir mayúsculas) rechazado');
select throws_ok($$select public.admin_duplicate_product('b3000000-0000-0000-0000-000000000001', 'a b', 'Otro')$$, '23514', null, 'código con espacios rechazado');
select throws_ok($$select public.admin_duplicate_product('b3000000-0000-0000-0000-000000000001', 'OK-1', '   ')$$, '23514', null, 'nombre vacío rechazado');
select throws_ok($$select public.admin_duplicate_product('b3000000-0000-0000-0000-000000000001', '---', '!!!')$$, '23514', null, 'si no hay slug posible (ni del nombre ni del código) se rechaza');
select throws_ok($$select public.admin_duplicate_product('99999999-9999-9999-9999-999999999999', 'OK-2', 'Otro')$$, 'P0002', null, 'producto inexistente rechazado');
select is((select count(*)::int from public.products where code in ('t-1', 'a b', 'OK-1', '---', 'OK-2')), 0, 'los intentos rechazados no dejaron ningún producto a medias');
select is((select count(*)::int from public.products), 8, 'solo hay 8 productos: 4 de fixture + 4 duplicados');

select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select throws_ok($$select public.admin_duplicate_product('b3000000-0000-0000-0000-000000000001', 'CL-1', 'Intruso')$$, '42501', null, 'un cliente no puede duplicar (is_admin)');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select public.admin_duplicate_product('b3000000-0000-0000-0000-000000000001', 'AN-1', 'Intruso')$$, '42501', null, 'anon no puede ni ejecutar la función');
reset role;
select ok(has_function_privilege('authenticated', 'public.admin_duplicate_product(uuid,text,text)', 'execute')
      and not has_function_privilege('anon', 'public.admin_duplicate_product(uuid,text,text)', 'execute'),
  'admin_duplicate_product: ejecutable por authenticated y no por anon');

-- ── 5. Crítico propio de la variante mayor que el umbral bajo GLOBAL ──────────────────────
-- La base impide critical > low cuando ambos son de la variante, pero no cuando el crítico es propio (5) y el admin baja el
-- umbral bajo GLOBAL a 3. El crítico efectivo se recorta al bajo (3), igual que en la vista de stock de S2.
-- (Sin el recorte, el stock 4 ya sería "crítico" y alertaría.)
reset role;
insert into public.products (id, code, slug, name) values ('b3000000-0000-0000-0000-000000000005', 'T-5', 't-5', 'Producto T5');
insert into public.product_colors (id, product_id, name) values ('d4000000-0000-0000-0000-000000000015', 'b3000000-0000-0000-0000-000000000005', 'Único');
insert into public.product_variants (id, product_id, color_id, low_threshold, critical_threshold)
values ('f4000000-0000-0000-0000-000000000015', 'b3000000-0000-0000-0000-000000000005', 'd4000000-0000-0000-0000-000000000015', null, 5);
insert into public.product_prices (product_id, currency, amount) values ('b3000000-0000-0000-0000-000000000005', 'BOB', 100);
update public.products set status = 'active' where code = 'T-5';
update public.store_settings set value = '3'::jsonb where key = 'stock_low_threshold';
select public.apply_stock_change('f4000000-0000-0000-0000-000000000015', 20, 'import', 'carga inicial');
select public.apply_stock_change('f4000000-0000-0000-0000-000000000015', -16, 'sale');   -- 20 → 4 (> 3 efectivo: normal)
select is((select count(*)::int from public.notification_outbox where type = 'stock_alert'), 7, 'con crítico propio 5 y bajo global 3 (crítico recortado a 3), el stock 4 sigue siendo normal: sin alerta');
select public.apply_stock_change('f4000000-0000-0000-0000-000000000015', -1, 'sale');    -- 4 → 3 (≤ 3: cruza directo a crítico)
select is((select count(*)::int from public.notification_outbox where type = 'stock_alert'), 8, 'a 3 cruza el umbral: una alerta nueva');
select is((select payload ->> 'light' || '|' || (payload ->> 'low_threshold') || '/' || (payload ->> 'critical_threshold') from public.notification_outbox where type = 'stock_alert' order by id desc limit 1),
  'critical|3/3', 'la alerta es "critical" y reporta el crítico YA recortado (3/3), no el 5 configurado');
update public.store_settings set value = '5'::jsonb where key = 'stock_low_threshold';

-- ── 6. admin_set_stock: fijar un valor EXACTO comprobando lo que se vio ───────────────────
-- La variante de T-5 llega con stock 3 y 3 movimientos en el libro (carga 20, venta 16, venta 1).
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is(public.admin_set_stock('f4000000-0000-0000-0000-000000000015', 3, 10, 'adjust', 'conteo físico'), 10, 'fija el stock a 10 y devuelve el stock resultante');
select is((select stock_on_hand from public.product_variants where id = 'f4000000-0000-0000-0000-000000000015'), 10, 'el stock quedó EXACTAMENTE en 10');
select is((select delta || '|' || reason || '|' || stock_after || '|' || note from public.stock_movements where variant_id = 'f4000000-0000-0000-0000-000000000015' order by id desc limit 1),
  '7|adjust|10|conteo físico', 'deja UN movimiento con el delta calculado (+7), el motivo y la nota');
select is((select count(*)::int from public.stock_movements where variant_id = 'f4000000-0000-0000-0000-000000000015'), 4, '4 movimientos en total (3 anteriores + 1)');

-- Si lo que se vio ya no es lo que hay, se rechaza y se dice cuánto hay ahora (ni se aplica a ciegas, ni se pierde nada)
select throws_ok($$select public.admin_set_stock('f4000000-0000-0000-0000-000000000015', 3, 12, 'adjust')$$, 'P0001',
  'el stock cambió mientras editabas: ahora hay 10 unidades y esperabas 3', 'con un "esperado" desactualizado se rechaza diciendo cuánto hay ahora');
select is((select stock_on_hand from public.product_variants where id = 'f4000000-0000-0000-0000-000000000015'), 10, 'el rechazo no cambió el stock');
select is((select count(*)::int from public.stock_movements where variant_id = 'f4000000-0000-0000-0000-000000000015'), 4, 'el rechazo no dejó ningún movimiento');

-- Mismo valor: no hace nada (ni movimiento de 0)
select is(public.admin_set_stock('f4000000-0000-0000-0000-000000000015', 10, 10, 'adjust'), 10, 'fijar el valor que ya tiene devuelve ese valor');
select is((select count(*)::int from public.stock_movements where variant_id = 'f4000000-0000-0000-0000-000000000015'), 4, 'y no deja un movimiento vacío');

-- Reglas heredadas de adjust_stock
select throws_ok($$select public.admin_set_stock('f4000000-0000-0000-0000-000000000015', 10, 4, 'import')$$, '22023', null, '"import" solo suma: restar con ese motivo se rechaza');
select throws_ok($$select public.admin_set_stock('f4000000-0000-0000-0000-000000000015', 10, 4, 'sale')$$, '22023', null, 'un motivo que no es de ajuste manual se rechaza');
select throws_ok($$select public.admin_set_stock('f4000000-0000-0000-0000-000000000015', 10, -1, 'adjust')$$, '22023', 'las cantidades deben ser enteros de 0 o más', 'un valor negativo se rechaza');
select throws_ok($$select public.admin_set_stock('f4000000-0000-0000-0000-000000000015', 10, null, 'adjust')$$, '22023', null, 'un valor nulo se rechaza');
select throws_ok($$select public.admin_set_stock('f4000000-0000-0000-0000-000000000015', -2, 5, 'adjust')$$, '22023', null, 'un "esperado" negativo se rechaza');
select throws_ok($$select public.admin_set_stock('99999999-9999-9999-9999-999999999999', 0, 5, 'adjust')$$, 'P0002', 'variante inexistente', 'una variante inexistente se rechaza');
select is((select count(*)::int from public.stock_movements where variant_id = 'f4000000-0000-0000-0000-000000000015'), 4, 'ningún rechazo dejó rastro en el libro');

-- Pasa por el libro mayor como cualquier cambio: bajar el stock cruza el umbral y dispara la alerta
-- (la alerta "crítica" de esta variante de la sección 5 sigue pendiente y la deduplicación evitaría repetirla: se da por enviada)
update public.notification_outbox set status = 'sent' where payload ->> 'variant_id' = 'f4000000-0000-0000-0000-000000000015';
select is(public.admin_set_stock('f4000000-0000-0000-0000-000000000015', 10, 1, 'adjust'), 1, 'bajar de 10 a 1');
select is((select count(*)::int from public.notification_outbox where type = 'stock_alert'), 9, 'cruzar el umbral con admin_set_stock encola la alerta igual que cualquier otro cambio');

-- Permisos
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select throws_ok($$select public.admin_set_stock('f4000000-0000-0000-0000-000000000015', 1, 5, 'adjust')$$, '42501', 'solo administradores', 'un cliente no puede fijar stock (is_admin dentro de la función)');
-- Con un "esperado" EQUIVOCADO, un cliente no debe enterarse del stock exacto (el mensaje de "cambió" lo revelaría): primero va la comprobación de admin
select throws_ok($$select public.admin_set_stock('f4000000-0000-0000-0000-000000000015', 999, 5, 'adjust')$$, '42501', 'solo administradores',
  'un cliente con un "esperado" equivocado recibe "solo administradores", NO "ahora hay N unidades" (no se filtra el stock exacto)');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select public.admin_set_stock('f4000000-0000-0000-0000-000000000015', 1, 5, 'adjust')$$, '42501', null, 'anon ni siquiera puede ejecutar la función');
reset role;
select is((select stock_on_hand from public.product_variants where id = 'f4000000-0000-0000-0000-000000000015'), 1, 'los intentos no autorizados no cambiaron el stock');
select ok(has_function_privilege('authenticated', 'public.admin_set_stock(uuid,int,int,text,text)', 'execute')
      and not has_function_privilege('anon', 'public.admin_set_stock(uuid,int,int,text,text)', 'execute'),
  'admin_set_stock: ejecutable por authenticated y no por anon');

select * from finish();
rollback;
