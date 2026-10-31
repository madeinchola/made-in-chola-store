-- Sprints 1-2 · Verificaciones ESTRUCTURALES que protegen también a los sprints futuros:
-- cualquier tabla, vista o función nueva que viole la política deny-by-default hará fallar este archivo.
-- Cada sprint que añada algo ejecutable/legible desde el navegador debe AMPLIAR A PROPÓSITO las listas de abajo.
begin;
select plan(16);

-- 1. RLS activa en TODA tabla de public
select is(
  (select coalesce(string_agg(c.relname, ', '), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  '', 'toda tabla de public tiene RLS activada');

-- 2. anon no tiene ningún privilegio de tabla (ni a nivel de columna): lo público se lee solo por vistas
select is(
  (select coalesce(string_agg(c.relname, ', '), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and (has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
           or has_any_column_privilege('anon', c.oid, 'select, insert, update, references'))),
  '', 'anon no tiene privilegios sobre ninguna tabla de public');

-- 3. authenticated: jamás insert/delete/truncate a NIVEL DE TABLA; el INSERT por columnas (solo admin, bajo RLS)
--    está acotado a una lista blanca. (has_table_privilege NO ve privilegios de columna: por eso se mira aparte.)
select is(
  (select coalesce(string_agg(c.relname, ', '), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and has_table_privilege('authenticated', c.oid, 'insert, delete, truncate')),
  '', 'authenticated no tiene INSERT/DELETE/TRUNCATE a nivel de tabla en ninguna tabla');
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and has_any_column_privilege('authenticated', c.oid, 'insert')),
  'categories, collections, exchange_rates, home_section_items, home_sections, news_banners, product_colors, product_images, product_prices, product_sizes, product_variants, products',
  'lista blanca de tablas donde authenticated puede insertar columnas (el admin, bajo RLS is_admin)');

-- 4. NINGÚN rol de la aplicación puede borrar ni truncar tablas (BR-CAT-03, BR-DAT-01): se archiva.
--    Excepciones heredadas de S1: perfiles/auditoría/rate_limits (los gestiona service_role o están blindados).
select is(
  (select coalesce(string_agg(c.relname || ':' || r.rolname, ', ' order by c.relname, r.rolname), '')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) r
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and c.relname not in ('profiles', 'audit_log', 'rate_limits')
      and has_table_privilege(r.rolname, c.oid, 'delete, truncate')),
  '', 'ningún rol de la aplicación (ni service_role) puede DELETE/TRUNCATE tablas de catálogo');

-- 5. Libros mayores: service_role no puede forjar movimientos de stock, reservas ni tipos de cambio
select is(
  (select coalesce(string_agg(t, ', ' order by t), '') from unnest(array['stock_movements', 'stock_reservations', 'exchange_rates']) t
    where has_table_privilege('service_role', 'public.' || t, 'update')
       or (t <> 'exchange_rates' and has_table_privilege('service_role', 'public.' || t, 'insert'))),
  '', 'service_role no puede escribir directo en stock_movements/stock_reservations ni modificar exchange_rates');

-- 6. authenticated: select solo en lista blanca (las filas las filtra la RLS: salvo profiles, solo el admin ve algo)
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and has_table_privilege('authenticated', c.oid, 'select')),
  'audit_log, categories, collections, countries, currencies, exchange_rates, home_section_items, home_sections, news_banners, notification_outbox, product_categories, product_collections, product_colors, product_images, product_prices, product_related, product_sizes, product_slug_history, product_variants, products, profiles, stock_movements, stock_reservations, store_settings',
  'lista blanca de tablas legibles por authenticated (ampliar a propósito en cada sprint)');

-- 7. Columnas actualizables por authenticated: profiles = solo full_name; variantes = nunca el stock
select is(
  (select coalesce(string_agg(a.attname, ', '), '') from pg_attribute a
    where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', 'public.profiles', a.attname, 'update')),
  'full_name', 'authenticated solo puede actualizar profiles.full_name');
select is(
  (select coalesce(string_agg(a.attname || ':' || p.priv, ', ' order by a.attname, p.priv), '')
     from pg_attribute a cross join (values ('insert'), ('update')) p(priv)
    where a.attrelid = 'public.product_variants'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', 'public.product_variants', a.attname, p.priv)),
  'archived_at:update, color_id:insert, critical_threshold:insert, critical_threshold:update, low_threshold:insert, low_threshold:update, product_id:insert, size_id:insert, sku:insert, sku:update',
  'el admin nunca puede escribir stock_on_hand directamente (solo adjust_stock)');

-- 7b. Ni service_role puede escribir stock_on_hand (privilegio de columna), aunque sí otras columnas de variantes
select is(
  (select coalesce(string_agg(a.attname, ', ' order by a.attname), '') from pg_attribute a
    where a.attrelid = 'public.product_variants'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('service_role', 'public.product_variants', a.attname, 'update')),
  'archived_at, critical_threshold, low_threshold, sku',
  'service_role solo puede actualizar sku, umbrales y archived_at de las variantes: NUNCA stock_on_hand');

-- 8. Toda función SECURITY DEFINER fija search_path
select is(
  (select coalesce(string_agg(p.proname, ', '), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')),
  '', 'toda función SECURITY DEFINER fija search_path');

-- 9. anon/authenticated solo ejecutan funciones de una lista blanca
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)  -- las de event trigger (p. ej. rls_auto_enable de Supabase) no se llaman por la API
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'adjust_stock, admin_delete_product_price, admin_duplicate_product, admin_set_product_categories, admin_set_product_collections, admin_set_product_related, admin_set_stock, current_app_role, f_unaccent, healthcheck, home_media_ok, is_admin, is_safe_link, public_price_for, public_search_products, slugify, stock_status, storage_path_ok',
  'lista blanca de funciones ejecutables desde el navegador');

-- 10. Las funciones de reserva/stock/precio internos NO las ejecuta el navegador
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('reserve_stock', 'release_stock', 'expire_reservations', 'purge_stock_reservations',
                        'apply_stock_change', 'price_for', 'current_rate', 'setting_int', 'enqueue_notification')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  '', 'reserve_stock/release_stock/apply_stock_change/price_for no son ejecutables por anon ni authenticated');

-- 11. Vistas legibles por anon: solo las públicas, y ninguna expone datos internos
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm') and has_table_privilege('anon', c.oid, 'select')),
  'public_categories, public_collections, public_home_section_items, public_home_sections, public_news_banners, public_product_categories, public_product_collections, public_product_colors, public_product_detail, public_product_images, public_product_related, public_product_sizes, public_product_slug_redirects, public_product_variants, public_products, public_store_settings',
  'lista blanca de vistas legibles por anon');
select is(
  (select coalesce(string_agg(c.relname || '.' || a.attname, ', ' order by c.relname, a.attname), '')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('v', 'm') and has_table_privilege('anon', c.oid, 'select')
      and a.attname in ('cost_base', 'stock_on_hand', 'reserved', 'available', 'low_threshold', 'critical_threshold',
                        'sku', 'code', 'status', 'archived_at', 'allow_converted_prices', 'owner_id', 'created_by',
                        'is_active', 'is_public')),
  '', 'ninguna vista pública expone costo, stock exacto, SKU, código, estado interno ni dueños de reservas');

-- 12. Una tabla NUEVA nace cerrada (default privileges revocados)
create table public.tabla_nueva_de_prueba (id int);
select is(
  has_table_privilege('anon', 'public.tabla_nueva_de_prueba', 'select') or has_table_privilege('authenticated', 'public.tabla_nueva_de_prueba', 'select, insert, update, delete'),
  false, 'una tabla nueva no concede nada a anon/authenticated por defecto');

select * from finish();
rollback;
