-- Sprint 16 · Auditoría de seguridad ESTRUCTURAL de todo el esquema (docs/seguridad.md).
-- Solo lee el catálogo (no crea ni cambia datos). Cada lista de abajo es un contrato: lo que un visitante o una clienta puede
-- leer o ejecutar. Si un sprint futuro añade una tabla, una función, una vista, un bucket o una columna que el navegador
-- alcance, este archivo FALLA y obliga a decidirlo a propósito (y a ampliar la lista aquí, con el motivo).
-- Complementa a 05_estructura_seguridad (privilegios por tabla y función) con lo que 05 no miraba: las políticas una a una,
-- cómo se autoriza cada función por dentro, las vistas con permisos de su dueño, Storage, las COLUMNAS que lee la clienta,
-- y el acceso a los esquemas internos (auth, vault, cron).
begin;
select plan(34);

-- ═══ A. Políticas RLS ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- A1. Ninguna política deja pasar todo («using (true)»), ni en public ni en storage
select is(
  (select coalesce(string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname), '') from pg_policies
    where schemaname in ('public', 'storage')
      and (coalesce(regexp_replace(qual, '[()\s]', '', 'g'), '') = 'true' or coalesce(regexp_replace(with_check, '[()\s]', '', 'g'), '') = 'true')),
  '', 'A1: ninguna política es «true» (deja pasar a todo el que llegue)');

-- A2. Ninguna política se dirige a anon ni a «public» (el pseudo-rol de todos): lo público se lee por vistas y funciones
select is(
  (select coalesce(string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname), '') from pg_policies
    where schemaname in ('public', 'storage') and (roles::text ~ 'anon' or 'public' = any (roles))),
  '', 'A2: ninguna política es para anon ni para el pseudo-rol public');

-- A3. Toda política de public se ata a un administrador o a la dueña de la fila: ninguna es «cualquiera con sesión»
select is(
  (select coalesce(string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname), '') from pg_policies
    where schemaname = 'public'
      and coalesce(qual, '') !~ 'is_admin|auth\.uid|_is_owner' and coalesce(with_check, '') !~ 'is_admin|auth\.uid|_is_owner'),
  '', 'A3: toda política de public menciona is_admin() o auth.uid()');

-- A4. Tablas con RLS y SIN ninguna política: nadie las toca desde el navegador, solo funciones SECURITY DEFINER o el servicio.
--     Una tabla nueva que quede así tiene que añadirse aquí a propósito (si el navegador debía leerla, le falta su política).
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)),
  'complaints, import_batch_rows, import_batches, legal_acceptances, legal_documents, legal_versions, order_attribution, rate_limits',
  'A4: solo estas 8 tablas no tienen política (cerradas al navegador: legales, reclamos, importaciones, atribución, límites)');

-- A5. Tablas donde una CLIENTA (no administradora) ve filas: solo las suyas, y esta es toda la lista
select is(
  (select coalesce(string_agg(distinct tablename, ', ' order by tablename), '') from pg_policies
    where schemaname = 'public' and cmd in ('SELECT', 'ALL') and coalesce(qual, '') !~ '^\(?(public\.)?is_admin\(\)'),
  'addresses, notification_preferences, order_items, order_status_history, orders, payments, profiles, tax_profiles',
  'A5: solo en estas 8 tablas una clienta ve filas (las suyas); en las demás solo el administrador');

-- A6. Cada política de lectura de esas 8 ata la fila a la persona con sesión (directo o por su pedido)
select is(
  (select coalesce(string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname), '') from pg_policies
    where schemaname = 'public' and cmd = 'SELECT'
      and tablename in ('addresses', 'notification_preferences', 'order_items', 'order_status_history', 'orders', 'payments', 'profiles', 'tax_profiles')
      and coalesce(qual, '') !~ 'is_admin' and coalesce(qual, '') !~ 'auth\.uid\(\)'),
  '', 'A6: toda política de lectura de la clienta compara con auth.uid()');

-- A7. Toda política de INSERT lleva su «with check»: sin él no valida lo que se inserta
select is(
  (select coalesce(string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname), '') from pg_policies
    where schemaname in ('public', 'storage') and cmd = 'INSERT' and with_check is null),
  '', 'A7: toda política de INSERT tiene with check');

-- ═══ B. Funciones ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- B1. Función SECURITY DEFINER ejecutable desde el navegador que NO se autoriza por dentro (ni is_admin() ni auth.uid()):
--     solo las públicas a propósito (lectura del catálogo y de los textos legales; no exponen nada que no sea público).
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef and p.prorettype <> 'event_trigger'::regtype
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
      and p.prosrc !~ 'is_admin\(\)' and p.prosrc !~ 'auth\.uid\(\)'),
  'public_legal_document, public_legal_index, public_legal_required, public_list_products, public_listing_facets, public_price_for, public_search_products, quote_shipping',
  'B1: las únicas funciones con permisos del dueño que el navegador llama sin autorizarse por dentro son estas 8 públicas');

-- B2. Funciones SIN permisos del dueño (invoker) que el navegador puede ejecutar: ayudas puras o que respetan la RLS
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and not p.prosecdef
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  '_coupon_norm, _discount_params_valid, _ship_params_valid, f_unaccent, healthcheck, home_media_ok, is_safe_link, slugify, stock_status, storage_path_ok',
  'B2: las funciones invoker ejecutables desde el navegador son estas 10 (ayudas puras)');

-- B3. Lo que puede ejecutar un VISITANTE sin sesión (anon) es esto y nada más
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'event_trigger'::regtype
      and has_function_privilege('anon', p.oid, 'execute')),
  'current_app_role, healthcheck, home_media_ok, is_admin, public_legal_document, public_legal_index, public_legal_required, public_list_products, public_listing_facets, public_price_for, public_search_products, quote_shipping, stock_status, storage_path_ok',
  'B3: un visitante sin sesión ejecuta solo estas 14 funciones');

-- B4. El pseudo-rol PUBLIC (todos, incluido anon) no ejecuta ninguna función por omisión (salvo los disparadores de evento)
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p') and p.prorettype <> 'event_trigger'::regtype
      and has_function_privilege('public', p.oid, 'execute')),
  '', 'B4: ninguna función de public es ejecutable por el pseudo-rol PUBLIC');

-- B5. Toda función con permisos del dueño fija un search_path VACÍO (o solo pg_catalog): no se le pueden colar objetos falsos
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not (coalesce(p.proconfig, '{}'::text[]) && array['search_path=""', 'search_path=pg_catalog'])),
  '', 'B5: toda función SECURITY DEFINER tiene search_path vacío o pg_catalog (ninguna usa public ni otro esquema)');

-- B6. Los procedimientos y funciones de Edge/servicio (las internas con guion bajo de reserva y precio) no las ejecuta el navegador
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.proname ~ '^(_|apply_|reserve_|release_|record_|claim_|submit_|run_|expire_)'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
      and p.proname not in ('_coupon_norm', '_discount_params_valid', '_ship_params_valid', 'record_legal_acceptance', 'record_order_attribution')),
  '', 'B6: las funciones internas (_*, apply_*, reserve_*, release_*, claim_*, submit_*, run_*, expire_*) no son del navegador');

-- ═══ C. Vistas ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- C1. Una vista de public corre con los permisos de su DUEÑO (se salta la RLS) salvo que sea security_invoker. Las que lee
--     una persona con sesión y no son security_invoker tienen que filtrar con is_admin() o ser las públicas a propósito.
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
      and has_table_privilege('authenticated', c.oid, 'select')
      and not coalesce(c.reloptions, '{}'::text[]) && array['security_invoker=true', 'security_invoker=on']
      and c.relname !~ '^public_'
      and pg_get_viewdef(c.oid) !~ 'is_admin\(\)'),
  '', 'C1: toda vista legible con sesión que se salta la RLS filtra con is_admin() o es una vista pública');

-- C2. Ninguna vista legible por el navegador lee de auth.users (ni de ningún esquema interno de Supabase)
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
      and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'))
      and pg_get_viewdef(c.oid) ~* '\m(auth|vault|cron|net|storage)\.[a-z_]+'),
  '', 'C2: ninguna vista del navegador lee de auth, vault, cron, net ni storage');

-- ═══ D. Storage ═════════════════════════════════════════════════════════════════════════════════════════════════════════
-- D1. Buckets públicos: solo los que sirven imágenes y videos del catálogo; los comprobantes de pago son privados
select is(
  (select coalesce(string_agg(id, ', ' order by id), '') from storage.buckets where public),
  'payment-qr, product-images, site-media, site-videos', 'D1: solo estos 4 buckets son públicos (payment-proofs es privado)');
select is((select public from storage.buckets where id = 'payment-proofs'), false, 'D1b: payment-proofs (comprobantes de pago) es privado');

-- D2. Todo bucket tiene tope de tamaño (≤ 50 MiB) y lista cerrada de tipos
select is(
  (select coalesce(string_agg(id, ', ' order by id), '') from storage.buckets
    where file_size_limit is null or file_size_limit > 52428800 or allowed_mime_types is null or cardinality(allowed_mime_types) = 0),
  '', 'D2: todo bucket tiene tope de tamaño (50 MiB como máximo) y tipos permitidos');

-- D3. Ningún bucket admite tipos que ejecutan código en el navegador (SVG, HTML, JavaScript, XML)
select is(
  (select coalesce(string_agg(b.id || ':' || t, ', ' order by b.id, t), '') from storage.buckets b, unnest(b.allowed_mime_types) t
    where t ~* 'svg|html|javascript|xml|php|octet-stream|x-sh'),
  '', 'D3: ningún bucket acepta SVG, HTML, JavaScript ni XML (XSS por archivo subido)');

-- D4. Ninguna política de storage.objects es para anon ni para PUBLIC, y toda política acota su bucket
select is(
  (select coalesce(string_agg(policyname, ', ' order by policyname), '') from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (roles::text ~ 'anon' or 'public' = any (roles) or (coalesce(qual, '') || coalesce(with_check, '')) !~ 'bucket_id')),
  '', 'D4: las políticas de storage.objects son solo para authenticated y cada una acota su bucket');

-- D5. Los comprobantes: solo la dueña (carpeta con su id) o un administrador los leen, y solo la dueña los sube
select is(
  (select coalesce(string_agg(cmd || ':' || (qual ~ 'auth\.uid' and qual ~ 'is_admin')::text, ', ' order by cmd), '') from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'payment_proofs_owner_select'),
  'SELECT:true', 'D5: leer un comprobante exige ser la dueña (auth.uid) o administrador');

-- ═══ E. Privilegios y COLUMNAS ═════════════════════════════════════════════════════════════════════════════════════════
-- E1. Ningún rol del navegador puede CREAR objetos en ningún esquema
select is(
  (select coalesce(string_agg(n.nspname || ':' || r, ', ' order by n.nspname, r), '') from pg_namespace n, unnest(array['anon', 'authenticated']) r
    where n.nspname !~ '^pg_' and n.nspname <> 'information_schema' and has_schema_privilege(r, n.oid, 'create')),
  '', 'E1: anon y authenticated no pueden crear nada en ningún esquema');

-- E2. Ni sobre secuencias de public
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
      and (has_sequence_privilege('anon', c.oid, 'usage,select,update') or has_sequence_privilege('authenticated', c.oid, 'usage,select,update'))),
  0, 'E2: ninguna secuencia de public es usable por anon ni authenticated');

-- E3. Profiles, orders y payments se leen POR COLUMNAS (una columna nueva nace privada) y no por tabla
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '') from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relname in ('profiles', 'orders', 'payments') and has_table_privilege('authenticated', c.oid, 'select')),
  '', 'E3: profiles, orders y payments no se leen por tabla entera (solo por las columnas listadas abajo)');

-- E4. Lo que una clienta LEE de cada tabla suya, columna por columna: el contrato de lo que el navegador puede ver
select is(
  (select string_agg(a.attname, ', ' order by a.attname) from pg_attribute a
    where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')),
  'anonymized_at, created_at, email, full_name, id, is_active, phone_e164, preferred_currency, preferred_locale, role, updated_at',
  'E4a: profiles: la clienta lee estas 11 columnas (NO blacklisted)');
select is(
  (select string_agg(a.attname, ', ' order by a.attname) from pg_attribute a
    where a.attrelid = 'public.orders'::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')),
  'base_currency, cancel_reason, cancelled_at, cancelled_by, cart_id, channel, contact_email, contact_name, contact_phone, country, coupon_code, created_at, currency, delivery_slot, discount_total, discounts, edit_count, edited_at, exchange_rate, id, idempotency_key, number, paid_at, payment_expires_at, payment_method, payment_provider, profile_id, reminder_sent_at, shipping_address, shipping_cost, shipping_discount, shipping_method, status, subtotal, tax_included, tax_profile, total, updated_at',
  'E4b: orders: la clienta lee estas 38 columnas (NO request_hash)');
select is(
  (select string_agg(a.attname, ', ' order by a.attname) from pg_attribute a
    where a.attrelid = 'public.payments'::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')),
  'amount, attempt, collected_at, created_at, currency, expires_at, external_id, id, method, order_id, paid_at, provider, provider_ref, received_amount, reference, reminder_sent_at, status, updated_at',
  'E4c: payments: la clienta lee estas 18 columnas (NO collected_by)');
select is(
  (select string_agg(a.attname, ', ' order by a.attname) from pg_attribute a
    where a.attrelid = 'public.order_items'::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')),
  'color_hex, color_name, discount, discount_offers, final_total, id, image_path, line_no, line_total, order_id, product_id, product_name, qty, size_label, sku, unit_price, variant_id',
  'E4d: order_items: la clienta lee estas 17 columnas (NO cost_unit, el costo congelado)');
select is(
  (select string_agg(a.attname, ', ' order by a.attname) from pg_attribute a
    where a.attrelid = 'public.order_status_history'::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')),
  'actor_kind, created_at, from_status, id, order_id, to_status',
  'E4e: order_status_history: la clienta lee 6 columnas (NO quién hizo el cambio)');
-- las tres tablas que son enteramente de la clienta se leen por tabla; si crece una columna, se revisa aquí
select is(
  (select string_agg(c.relname || '=' || n, ', ' order by c.relname) from pg_class c
    cross join lateral (select count(*) n from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) q
    where c.relnamespace = 'public'::regnamespace and c.relname in ('addresses', 'tax_profiles', 'notification_preferences')),
  'addresses=19, notification_preferences=8, tax_profiles=9',
  'E4f: addresses, tax_profiles y notification_preferences (datos de la propia clienta, por tabla) siguen teniendo 19, 8 y 9 columnas: si crece una, se revisa que sea suya');

-- E5. Lo que NUNCA lee ninguna clienta ni visitante: costos, huellas, claves, tokens (en ninguna tabla ni vista de public)
select is(
  (select coalesce(string_agg(c.table_name || '.' || c.column_name, ', ' order by c.table_name, c.column_name), '') from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('addresses', 'notification_preferences', 'order_items', 'order_status_history', 'orders', 'payments', 'profiles', 'tax_profiles')
      and has_column_privilege('authenticated', format('public.%I', c.table_name), c.column_name, 'select')
      and c.column_name ~* '(^|_)(cost|costo|cost_unit|margin|hash|fingerprint|secret|token|password|salt|hmac|internal|blacklisted|collected_by)(_|$)'
      and c.column_name <> 'shipping_cost'),
  '', 'E5: ninguna columna con nombre de costo, huella, clave o interno es legible por la clienta (salvo el costo de envío que ella paga)');
select is(
  (select coalesce(string_agg(c.table_name || '.' || c.column_name, ', ' order by c.table_name, c.column_name), '') from information_schema.columns c
    where c.table_schema = 'public' and has_column_privilege('anon', format('public.%I', c.table_name), c.column_name, 'select')
      and c.column_name ~* '(^|_)(cost|costo|cost_base|cost_unit|margin|hash|fingerprint|secret|token|password|salt|hmac|internal|blacklisted|email|phone|phone_e164|account_details)(_|$)'),
  '', 'E5b: ninguna columna con nombre de costo, huella, clave, correo o teléfono es legible por un visitante');

-- ═══ F. Esquemas internos de Supabase ═══════════════════════════════════════════════════════════════════════════════════
select is(
  (select coalesce(string_agg(n.nspname || ':' || r, ', ' order by n.nspname, r), '') from pg_namespace n, unnest(array['anon', 'authenticated']) r
    where n.nspname in ('vault', 'cron') and has_schema_privilege(r, n.oid, 'usage')),
  '', 'F1: ni anon ni authenticated pueden entrar a los esquemas vault ni cron');
select is(
  (select coalesce(string_agg(t || ':' || r, ', ' order by t, r), '') from unnest(array['auth.users', 'auth.identities', 'auth.sessions', 'auth.refresh_tokens', 'vault.secrets', 'vault.decrypted_secrets']) t,
    unnest(array['anon', 'authenticated']) r where has_table_privilege(r, t, 'select, insert, update, delete')),
  '', 'F2: ni anon ni authenticated leen ni escriben auth.users, sesiones, tokens ni los secretos del vault');
select * from finish();
rollback;
