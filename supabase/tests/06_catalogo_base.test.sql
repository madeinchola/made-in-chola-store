-- Sprint 2 · Base del catálogo: slugify, enlaces seguros, monedas, tipo de cambio, ajustes, banner,
-- categorías, colecciones y matriz RLS (anon / cliente / admin).
begin;
select plan(111);

-- HERMÉTICO: parte de un catálogo vacío DENTRO de la transacción (se revierte al final), sin depender del seed.
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

-- ── slugify ────────────────────────────────────────────────────────────────────────────────
select is(public.slugify('Camiseta Ñandú — Edición 2027'), 'camiseta-nandu-edicion-2027', 'slugify: acentos, ñ, guion largo');
select is(public.slugify('  Sombrero   Chakra  Naranja  '), 'sombrero-chakra-naranja', 'slugify: espacios múltiples y bordes');
select is(public.slugify('ABC__def--ghi'), 'abc-def-ghi', 'slugify: separadores repetidos colapsan');
select is(public.slugify('Bolso 100% lana'), 'bolso-100-lana', 'slugify: símbolos');
select is(public.slugify('¡¡¡'), '', 'slugify: sin alfanuméricos → cadena vacía (el slug vacío lo rechaza el CHECK)');
select is(public.slugify(null), null, 'slugify(NULL) = NULL');

-- ── is_safe_link ───────────────────────────────────────────────────────────────────────────
select is(public.is_safe_link(null), true, 'enlace nulo permitido');
select is(public.is_safe_link('/'), true, 'raíz interna permitida');
select is(public.is_safe_link('/coleccion/verano?x=1'), true, 'ruta interna con query permitida');
select is(public.is_safe_link('https://www.instagram.com/madeinchola/'), true, 'https permitido');
select is(public.is_safe_link('javascript:alert(1)'), false, 'javascript: rechazado (XSS)');
select is(public.is_safe_link('http://x.com'), false, 'http plano rechazado');
select is(public.is_safe_link('//evil.com'), false, '//host rechazado (redirección abierta)');
select is(public.is_safe_link('/\evil.com'), false, '/\host rechazado');
select is(public.is_safe_link('https://'), false, 'https sin host rechazado');
select is(public.is_safe_link('https://a b.com'), false, 'espacios rechazados');
select is(public.is_safe_link('data:text/html,x'), false, 'data: rechazado');
select is(public.is_safe_link('https://' || repeat('a', 2050)), false, 'enlace de más de 2048 caracteres rechazado');

-- ── Monedas y países ───────────────────────────────────────────────────────────────────────
select is((select string_agg(code, ',' order by code) from public.currencies where enabled), 'BOB', 'solo BOB está habilitada al inicio');
select is((select count(*)::int from public.currencies), 4, 'BOB, ARS, EUR y USD existen');
select throws_ok($$update public.currencies set enabled = false where code = 'BOB'$$, '23514', null, 'la moneda base BOB no se puede deshabilitar');
select throws_ok($$update public.countries set enabled = false where code = 'BO'$$, '23514', null, 'Bolivia no se puede deshabilitar');
select lives_ok($$update public.currencies set enabled = true where code = 'USD'$$, 'se puede habilitar USD');

-- ── Tipo de cambio ─────────────────────────────────────────────────────────────────────────
insert into public.exchange_rates (to_currency, rate, valid_from) values
  ('USD', 0.14367816, now() - interval '2 days'),
  ('USD', 0.14400000, now() - interval '1 day'),
  ('USD', 0.15000000, now() + interval '1 day');   -- programada a futuro: aún NO vigente
select is(public.current_rate('BOB', 'USD'), 0.14400000::numeric, 'vigente = la más reciente que ya empezó (ignora la futura)');
select is(public.current_rate('BOB', 'EUR'), null, 'sin tasa → NULL');
insert into public.exchange_rates (to_currency, rate, valid_from) values ('ARS', 100, '2026-01-01'), ('ARS', 120, '2026-01-01');
select is(public.current_rate('BOB', 'ARS'), 120::numeric, 'empate en valid_from: gana la fila más nueva (id mayor)');
select throws_ok($$insert into public.exchange_rates (to_currency, rate) values ('EUR', 0)$$, '23514', null, 'tasa 0 rechazada');
select throws_ok($$insert into public.exchange_rates (to_currency, rate) values ('EUR', -1)$$, '23514', null, 'tasa negativa rechazada');
select throws_ok($$insert into public.exchange_rates (from_currency, to_currency, rate) values ('BOB', 'BOB', 1)$$, '23514', null, 'misma moneda rechazada');
select throws_ok($$update public.exchange_rates set rate = 1 where id = 1$$, '42501', null, 'el historial de tasas no se modifica');
select throws_ok($$delete from public.exchange_rates where id = 1$$, '42501', null, 'el historial de tasas no se borra');
select throws_ok($$truncate public.exchange_rates$$, '42501', null, 'el historial de tasas no se trunca');

-- ── Ajustes de la tienda ───────────────────────────────────────────────────────────────────
select is((select count(*)::int from public.store_settings), 15, 'los 15 ajustes iniciales existen');
select is((select value #>> '{}' from public.store_settings where key = 'whatsapp_orders'), '+59167528677', 'WhatsApp de pedidos confirmado por el admin');
select is((select value #>> '{}' from public.store_settings where key = 'social_youtube'), 'https://www.youtube.com/@madeinchola9876', 'YouTube cargado');
select throws_ok($$update public.store_settings set value = '"71234567"' where key = 'whatsapp_orders'$$, '22023', null, 'teléfono sin código de país rechazado');
select lives_ok($$update public.store_settings set value = '"+59171234567"' where key = 'whatsapp_orders'$$, 'teléfono E.164 aceptado');
select throws_ok($$update public.store_settings set value = '"INFO@X.com"' where key = 'contact_email'$$, '22023', null, 'correo en mayúsculas rechazado');
select throws_ok($$update public.store_settings set value = '"a@b"' where key = 'contact_email'$$, '22023', null, 'correo sin dominio con punto rechazado');
select throws_ok($$update public.store_settings set value = '"http://x.com"' where key = 'social_tiktok'$$, '22023', null, 'enlace http rechazado en ajustes');
select throws_ok($$update public.store_settings set value = '"https://x.com/a b"' where key = 'social_tiktok'$$, '22023', null, 'enlace con espacio rechazado en ajustes');
select throws_ok($$update public.store_settings set value = '0' where key = 'reservation_ttl_minutes'$$, '22023', null, 'TTL 0 rechazado');
select throws_ok($$update public.store_settings set value = '1441' where key = 'reservation_ttl_minutes'$$, '22023', null, 'TTL > 1440 rechazado');
select throws_ok($$update public.store_settings set value = '"10"' where key = 'reservation_ttl_minutes'$$, '22023', null, 'entero como texto rechazado');
select throws_ok($$update public.store_settings set value = '10.5' where key = 'reservation_ttl_minutes'$$, '22023', null, 'entero con decimales rechazado');
select throws_ok($$update public.store_settings set value = '-1' where key = 'reservation_ttl_minutes'$$, '22023', null, 'entero negativo rechazado');
select lives_ok($$update public.store_settings set value = '15' where key = 'reservation_ttl_minutes'$$, 'TTL 15 aceptado');
select throws_ok($$update public.store_settings set value = '1' where key = 'stock_low_threshold'$$, '22023', null, 'aviso (1) menor que el crítico (2) rechazado');
select throws_ok($$update public.store_settings set value = '6' where key = 'stock_critical_threshold'$$, '22023', null, 'crítico (6) mayor que el aviso (5) rechazado');
select lives_ok($$update public.store_settings set value = '5' where key = 'stock_critical_threshold'$$, 'crítico igual al aviso es válido');
select throws_ok($$update public.store_settings set value = '4' where key = 'stock_low_threshold'$$, '22023', null, 'aviso (4) menor que el crítico (5) rechazado');
select lives_ok($$update public.store_settings set value = '"hide"' where key = 'default_out_of_stock_behavior'$$, 'comportamiento hide aceptado');
select throws_ok($$update public.store_settings set value = '"otro"' where key = 'default_out_of_stock_behavior'$$, '22023', null, 'comportamiento desconocido rechazado');
select throws_ok($$update public.store_settings set value = to_jsonb(repeat('x', 4001)) where key = 'pdp_assistance_text'$$, '22023', null, 'texto de más de 4000 caracteres rechazado');
select throws_ok($$insert into public.store_settings (key, value, value_type) values ('clave_x', '"a"', 'int')$$, '22023', null, 'valor que no corresponde al tipo declarado rechazado');
select throws_ok($$insert into public.store_settings (key, value, value_type) values ('Clave Mala', '1', 'int')$$, '23514', null, 'clave con formato inválido rechazada');

-- ── Banner de noticias ─────────────────────────────────────────────────────────────────────
select throws_ok($$insert into public.news_banners (message, link_url) values ('Hola', 'javascript:alert(1)')$$, '23514', null, 'banner con enlace javascript: rechazado');
select throws_ok($$insert into public.news_banners (message) values ('')$$, '23514', null, 'banner sin texto rechazado');
select throws_ok($$insert into public.news_banners (message) values (repeat('x', 201))$$, '23514', null, 'banner de más de 200 caracteres rechazado');
select throws_ok($$insert into public.news_banners (message, starts_at, ends_at) values ('x', now(), now() - interval '1 hour')$$, '23514', null, 'vigencia invertida rechazada');
insert into public.news_banners (message, is_active, starts_at, ends_at, archived_at) values
  ('vigente',     true,  now() - interval '1 day',  now() + interval '1 day', null),
  ('sin fechas',  true,  null,                       null,                      null),
  ('desactivado', false, null,                       null,                      null),
  ('vencido',     true,  now() - interval '3 days',  now() - interval '1 day',  null),
  ('futuro',      true,  now() + interval '1 day',   null,                      null),
  ('archivado',   true,  null,                       null,                      now());
select is((select string_agg(message, ',' order by message) from public.public_news_banners), 'sin fechas,vigente',
          'el banner público solo incluye activos, no archivados y dentro de su vigencia');

-- ── Categorías ─────────────────────────────────────────────────────────────────────────────
insert into public.categories (id, name, slug) values
  ('ca000000-0000-0000-0000-00000000000a', 'Ropa', 'ropa');
insert into public.categories (id, parent_id, name, slug) values
  ('ca000000-0000-0000-0000-00000000000b', 'ca000000-0000-0000-0000-00000000000a', 'Chaquetas', 'chaquetas');
insert into public.categories (id, parent_id, name, slug) values
  ('ca000000-0000-0000-0000-00000000000c', 'ca000000-0000-0000-0000-00000000000b', 'Cuero', 'cuero');
select throws_ok($$update public.categories set parent_id = 'ca000000-0000-0000-0000-00000000000c' where id = 'ca000000-0000-0000-0000-00000000000a'$$,
  '23514', null, 'ciclo A→C (C desciende de A) rechazado');
select throws_ok($$update public.categories set parent_id = 'ca000000-0000-0000-0000-00000000000b' where id = 'ca000000-0000-0000-0000-00000000000a'$$,
  '23514', null, 'ciclo A→B (B es hijo directo de A) rechazado');
select throws_ok($$update public.categories set parent_id = id where id = 'ca000000-0000-0000-0000-00000000000a'$$,
  '23514', null, 'una categoría no puede ser su propio padre');
select lives_ok($$update public.categories set parent_id = 'ca000000-0000-0000-0000-00000000000a' where id = 'ca000000-0000-0000-0000-00000000000c'$$,
  'mover una categoría a otro padre válido sí se permite');
select throws_ok($$update public.categories set archived_at = now() where id = 'ca000000-0000-0000-0000-00000000000a'$$,
  '23514', null, 'no se archiva una categoría con subcategorías activas');
update public.categories set archived_at = now() where id in ('ca000000-0000-0000-0000-00000000000b', 'ca000000-0000-0000-0000-00000000000c');
select lives_ok($$update public.categories set archived_at = now() where id = 'ca000000-0000-0000-0000-00000000000a'$$,
  'archivadas las hijas, ya se puede archivar el padre');
select throws_ok($$insert into public.categories (name, slug) values ('Otra Ropa', 'ropa')$$, '23505', null,
  'el slug de una categoría archivada sigue reservado (único incluyendo archivados)');
select throws_ok($$insert into public.categories (name, slug) values ('Mala', 'Slug Malo')$$, '23514', null, 'slug con formato inválido rechazado');
select throws_ok($$insert into public.categories (name, slug, parent_id) values ('Nueva hija', 'nueva-hija', 'ca000000-0000-0000-0000-00000000000a')$$,
  '23514', null, 'no se puede crear una categoría activa bajo un padre ARCHIVADO');
select throws_ok($$update public.categories set archived_at = null where id = 'ca000000-0000-0000-0000-00000000000b'$$,
  '23514', null, 'no se puede desarchivar una categoría cuyo padre sigue archivado');
insert into public.categories (id, name, slug) values ('ca000000-0000-0000-0000-0000000000e1', 'Suelta', 'suelta');
select throws_ok($$update public.categories set parent_id = 'ca000000-0000-0000-0000-00000000000a' where id = 'ca000000-0000-0000-0000-0000000000e1'$$,
  '23514', null, 'no se puede mover una categoría activa bajo un padre ARCHIVADO');
select lives_ok($$insert into public.categories (name, slug, parent_id, archived_at) values ('Hija archivada', 'hija-archivada', 'ca000000-0000-0000-0000-00000000000a', now())$$,
  'una categoría ARCHIVADA sí puede colgar de un padre archivado');
select is((select count(*)::int from public.public_categories where id = 'ca000000-0000-0000-0000-0000000000e1'), 1, 'la categoría activa sigue pública');
select is((select count(*)::int from public.public_categories where slug in ('ropa', 'chaquetas', 'cuero', 'hija-archivada')), 0, 'las categorías archivadas no salen en la vista pública');

-- ── Colecciones ────────────────────────────────────────────────────────────────────────────
select throws_ok($$insert into public.collections (name, slug, starts_at, ends_at) values ('x', 'x', now(), now())$$, '23514', null, 'colección con fin <= inicio rechazada');
insert into public.collections (name, slug, starts_at, ends_at, archived_at) values
  ('Siempre',  'siempre',  null,                        null,                       null),
  ('Vigente',  'vigente',  now() - interval '1 day',    now() + interval '1 day',   null),
  ('Futura',   'futura',   now() + interval '1 day',    null,                       null),
  ('Vencida',  'vencida',  null,                        now() - interval '1 day',   null),
  ('Archivada','archivada', null,                       null,                       now());
select is((select string_agg(slug, ',' order by slug) from public.public_collections), 'siempre,vigente',
          'la colección pública respeta vigencia y archivado');

-- ══ MATRIZ RLS ═════════════════════════════════════════════════════════════════════════════
-- anon: solo vistas
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select * from public.categories$$, '42501', null, 'anon NO lee la tabla categories');
select throws_ok($$select * from public.store_settings$$, '42501', null, 'anon NO lee la tabla store_settings');
select throws_ok($$insert into public.news_banners (message) values ('x')$$, '42501', null, 'anon NO inserta banners');
select is((select count(*)::int from public.public_collections), 2, 'anon SÍ lee la vista pública de colecciones');
select is((select count(*)::int from public.public_store_settings where key = 'whatsapp_orders'), 1, 'anon ve el WhatsApp de pedidos (ajuste público)');
select is((select count(*)::int from public.public_store_settings where key in ('stock_low_threshold', 'reservation_ttl_minutes')), 0,
          'anon NO ve los ajustes internos (umbrales, TTL)');
reset role;

-- cliente (authenticated, no admin)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is((select count(*)::int from public.collections), 0, 'cliente NO ve filas de la tabla collections (RLS)');
select is((select count(*)::int from public.store_settings), 0, 'cliente NO ve store_settings (RLS)');
select throws_ok($$insert into public.categories (name, slug) values ('Hack', 'hack')$$, '42501', null, 'cliente NO inserta categorías');
select throws_ok($$insert into public.exchange_rates (to_currency, rate) values ('USD', 1)$$, '42501', null, 'cliente NO inserta tipos de cambio');
select throws_ok($$delete from public.categories$$, '42501', null, 'cliente NO borra');
update public.store_settings set value = '"+59100000000"' where key = 'whatsapp_orders';
update public.currencies set enabled = true where code = 'EUR';
reset role;
select is((select value #>> '{}' from public.store_settings where key = 'whatsapp_orders'), '+59171234567', 'el intento de cliente de cambiar el WhatsApp no surtió efecto (0 filas)');
select is((select enabled from public.currencies where code = 'EUR'), false, 'el intento de cliente de habilitar EUR no surtió efecto');

-- admin
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.collections), 5, 'admin ve TODAS las colecciones (incluidas archivadas y futuras)');
select throws_ok($$insert into public.categories (id, name, slug) values ('ca000000-0000-0000-0000-0000000000d1', 'Sombreros', 'sombreros')$$, '42501', null, 'admin NO puede fijar el id al insertar (columna sin permiso)');
select lives_ok($$insert into public.categories (name, slug) values ('Sombreros', 'sombreros')$$, 'admin crea categorías');
select lives_ok($$update public.categories set name = 'Sombreros y gorras' where slug = 'sombreros'$$, 'admin edita categorías');
select throws_ok($$delete from public.categories where slug = 'sombreros'$$, '42501', null, 'admin NO puede borrar físicamente (se archiva)');
select throws_ok($$truncate public.categories$$, '42501', null, 'admin NO puede truncar');
select lives_ok($$update public.store_settings set value = '"+59172222222"' where key = 'whatsapp_orders'$$, 'admin cambia el valor de un ajuste');
select throws_ok($$update public.store_settings set is_public = false where key = 'whatsapp_orders'$$, '42501', null, 'admin NO puede cambiar la visibilidad de un ajuste (columna sin permiso)');
select throws_ok($$update public.store_settings set key = 'otra' where key = 'whatsapp_orders'$$, '42501', null, 'admin NO puede renombrar claves de ajustes');
select throws_ok($$insert into public.store_settings (key, value, value_type) values ('nueva_clave', '1', 'int')$$, '42501', null, 'admin NO crea claves de ajustes (las define el código)');
select lives_ok($$insert into public.exchange_rates (to_currency, rate) values ('USD', 0.145)$$, 'admin registra un tipo de cambio nuevo');
select throws_ok($$update public.exchange_rates set rate = 2 where to_currency = 'USD'$$, '42501', null, 'admin NO modifica el historial de tasas');
select lives_ok($$update public.currencies set enabled = true where code = 'ARS'$$, 'admin habilita una moneda');
select throws_ok($$update public.currencies set code = 'XXX' where code = 'ARS'$$, '42501', null, 'admin NO cambia el código de una moneda');
select is((select created_by from public.exchange_rates order by id desc limit 1), 'a0000000-0000-0000-0000-0000000000a1'::uuid, 'created_by del tipo de cambio = el admin que lo registró');
reset role;

-- ── Auditoría (BR-ADM-03) ──────────────────────────────────────────────────────────────────
select is((select count(*)::int from public.audit_log where table_name = 'categories' and action = 'UPDATE'
             and actor_id = 'a0000000-0000-0000-0000-0000000000a1' and diff -> 'name' ->> 'new' = 'Sombreros y gorras'), 1,
          'la edición del admin quedó en audit_log con su autor y el valor nuevo');
select is((select count(*)::int from public.audit_log where table_name = 'store_settings' and action = 'UPDATE'
             and actor_id = 'a0000000-0000-0000-0000-0000000000a1' and diff -> 'value' ->> 'new' = '+59172222222'), 1,
          'el cambio de ajuste del admin quedó auditado');

-- Auditoría de tablas cuya clave NO es `id` (la fila cambiada debe poder identificarse)
select is((select record_id from public.audit_log where table_name = 'store_settings' and action = 'UPDATE'
             and actor_id = 'a0000000-0000-0000-0000-0000000000a1' and diff -> 'value' ->> 'new' = '+59172222222'),
          'whatsapp_orders', 'auditoría: un ajuste se identifica por su CLAVE en record_id');
select is((select diff #>> '{_key,key}' from public.audit_log where table_name = 'store_settings' and action = 'UPDATE'
             and actor_id = 'a0000000-0000-0000-0000-0000000000a1' and diff -> 'value' ->> 'new' = '+59172222222'),
          'whatsapp_orders', '…y el diff lleva _key.key (qué ajuste cambió)');
select is((select record_id from public.audit_log where table_name = 'currencies' and action = 'UPDATE'
             and actor_id = 'a0000000-0000-0000-0000-0000000000a1' and diff -> 'enabled' ->> 'new' = 'true'),
          'ARS', 'auditoría: una moneda se identifica por su CÓDIGO');
select is((select count(*)::int from public.audit_log where table_name = 'categories' and diff ? '_key'), 0,
          'las tablas con columna id NO llevan _key (formato de S1 intacto)');

select * from finish();
rollback;
