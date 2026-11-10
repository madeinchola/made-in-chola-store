-- Sprint 7 · Carrito y retención de stock: estructura y permisos, alta/cantidad/topes, invariante de no sobreventa,
-- precios con garantía (S-04), estados de línea, fusión invitado → usuario, limpieza y ajustes.
-- Valores esperados calculados a mano (el cálculo va en el comentario de cada bloque), nunca copiados de la función.
--
-- Fixture (ids deterministas):
--   usuarios  a7000000-…-0000000000NN   (NN = 01…12)        admin ad000000-…-00000000000d
--   productos b7000000-…-0000000000PP   variantes f7000000-…-00PP-0000000000VV  (PP producto, VV variante, VV=01 es la 1.ª talla)
--   tokens de invitado: repeat('xy', 32)  (64 hex)
--   PP 01 100.00 [stock 10,3,0,20,10,4(archivada)]   02 borrador   03 sin precio BOB   04 100.00 [10 x5]   05 100.00 [5]
--   PP 06 50.50 [50]   07 33.33 [20]   08 0.10 [20]   09 100.00 [3,5,5]   10 50.00 [20 x10, 4, 2]   11/12 50.00 [10 x3]
--   PP 13 100.00 [30]   14 100.00 [2,5]   15 100.00 [2]   16 100.00 [5]   17 100.00 [4]   18 100.00 [3]
-- (Tres aserciones describieron defectos reales de la migración —internas ejecutables por service_role, retención parcial
--  informada como completa, cuenta desactivada que reabría carrito— y pasaron a verde al corregirla, sin tocar su valor esperado.)
-- Todo ocurre en una transacción que se revierte. now() no avanza dentro de ella: los vencimientos se simulan con UPDATE.
begin;
select plan(473);

-- HERMÉTICO: parte sin carritos (las líneas caen en cascada).
delete from public.carts;

insert into auth.users (id, email, raw_user_meta_data, aud, role)
select ('a7000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid, 'cliente' || lpad(i::text, 2, '0') || '.s7@test.com',
       jsonb_build_object('full_name', 'Cliente S7 ' || i), 'authenticated', 'authenticated'
  from generate_series(1, 12) i;
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('ad000000-0000-0000-0000-00000000000d', 'admin.s7@test.com', '{"full_name":"Admin S7"}', 'authenticated', 'authenticated');
select public.set_user_role('ad000000-0000-0000-0000-00000000000d', 'admin');

-- ── Ayudas de la prueba (objetos temporales; viven y mueren con la transacción) ───────────────
create temp table _r (k text primary key, j jsonb);
create function pg_temp.rec(p_k text, p_j jsonb) returns void language sql as
  $$ insert into pg_temp._r values (p_k, p_j) on conflict (k) do update set j = excluded.j $$;
create function pg_temp.g(p_k text) returns jsonb language sql as $$ select j from pg_temp._r where k = p_k $$;
-- carrito activo de un usuario / carrito de un token
create function pg_temp.uc(p uuid) returns uuid language sql as
  $$ select id from public.carts where profile_id = p and status = 'active' $$;
create function pg_temp.gc(p text) returns uuid language sql as $$ select id from public.carts where token_hash = p $$;
-- unidades retenidas (vigentes) por un carrito en una variante / en todas / por todos los dueños en una variante
create function pg_temp.held(p_cart uuid, p_v uuid) returns int language sql as
  $$ select coalesce(sum(qty), 0)::int from public.stock_reservations
      where owner_type = 'cart' and owner_id = p_cart and variant_id = p_v and status = 'active'
        and (expires_at is null or expires_at > now()) $$;
create function pg_temp.heldall(p_cart uuid) returns int language sql as
  $$ select coalesce(sum(qty), 0)::int from public.stock_reservations
      where owner_type = 'cart' and owner_id = p_cart and status = 'active' and (expires_at is null or expires_at > now()) $$;
create function pg_temp.vheld(p_v uuid) returns int language sql as
  $$ select coalesce(sum(qty), 0)::int from public.stock_reservations
      where variant_id = p_v and status = 'active' and (expires_at is null or expires_at > now()) $$;
-- línea del snapshot por variante y su resumen
create function pg_temp.lin(p_j jsonb, p_v uuid) returns jsonb language sql as
  $$ select l from jsonb_array_elements(p_j #> '{cart,lines}') l where l ->> 'variant_id' = p_v::text $$;
create function pg_temp.ls(p_j jsonb, p_v uuid) returns jsonb language sql as
  $$ select jsonb_build_object('status', l -> 'status', 'blocking', l -> 'blocking', 'billable_qty', l -> 'billable_qty',
            'price_notice', l -> 'price_notice', 'unit_price', l -> 'unit_price', 'line_total', l -> 'line_total')
       from (select pg_temp.lin(p_j, p_v) as l) x $$;
create function pg_temp.oa(p_j jsonb) returns jsonb language sql as
  $$ select jsonb_build_object('outcome', p_j -> 'outcome', 'applied', p_j -> 'applied', 'requested', p_j -> 'requested') $$;
create function pg_temp.tc(p_j jsonb) returns jsonb language sql as
  $$ select jsonb_build_object('subtotal', p_j #> '{cart,totals,subtotal}', 'can_checkout', p_j #> '{cart,can_checkout}') $$;
create function pg_temp.ms(p_j jsonb) returns jsonb language sql as
  $$ select jsonb_build_object('token_state', p_j -> 'token_state', 'merged', p_j -> 'merged', 'merged_lines', p_j -> 'merged_lines',
            'adjusted_lines', p_j -> 'adjusted_lines', 'skipped_lines', p_j -> 'skipped_lines') $$;
create function pg_temp.nlines(p_j jsonb) returns int language sql as
  $$ select jsonb_array_length(p_j #> '{cart,lines}') $$;
-- producto con precio BOB, una talla por variante y stock inicial por el libro mayor (como exige S2)
create function pg_temp.mk(p_pp text, p_price numeric, p_status text, p_stocks int[]) returns void language plpgsql as $$
declare
  v_p uuid := ('b7000000-0000-0000-0000-0000000000' || p_pp)::uuid;
  v_c uuid := ('d7000000-0000-0000-0000-0000000000' || p_pp)::uuid;
  v_s uuid;
  v_v uuid;
  i int;
begin
  insert into public.products (id, code, slug, name) values (v_p, 'S7-' || p_pp, 's7-' || p_pp, 'Producto S7 ' || p_pp);
  insert into public.product_colors (id, product_id, name) values (v_c, v_p, 'Único');
  insert into public.product_prices (product_id, currency, amount) values (v_p, 'BOB', p_price);
  for i in 1 .. cardinality(p_stocks) loop
    v_s := ('e7000000-0000-0000-00' || p_pp || '-0000000000' || lpad(i::text, 2, '0'))::uuid;
    v_v := ('f7000000-0000-0000-00' || p_pp || '-0000000000' || lpad(i::text, 2, '0'))::uuid;
    insert into public.product_sizes (id, product_id, label) values (v_s, v_p, 'T' || i);
    insert into public.product_variants (id, product_id, color_id, size_id) values (v_v, v_p, v_c, v_s);
    if p_stocks[i] > 0 then
      perform public.apply_stock_change(v_v, p_stocks[i], 'import', 'carga inicial S7');
    end if;
  end loop;
  if p_status = 'active' then
    update public.products set status = 'active' where id = v_p;
  end if;
end $$;

select pg_temp.mk('01', 100.00, 'active', array[10, 3, 0, 20, 10, 4]);
select pg_temp.mk('02', 100.00, 'draft',  array[5]);
select pg_temp.mk('03', 100.00, 'active', array[5]);
select pg_temp.mk('04', 100.00, 'active', array[10, 10, 10, 10, 10]);
select pg_temp.mk('05', 100.00, 'active', array[5]);
select pg_temp.mk('06', 50.50,  'active', array[50]);
select pg_temp.mk('07', 33.33,  'active', array[20]);
select pg_temp.mk('08', 0.10,   'active', array[20]);
select pg_temp.mk('09', 100.00, 'active', array[3, 5, 5]);
select pg_temp.mk('10', 50.00,  'active', array[20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 4, 2]);
select pg_temp.mk('11', 50.00,  'active', array[10, 10, 10]);
select pg_temp.mk('12', 50.00,  'active', array[10, 10, 10]);
select pg_temp.mk('13', 100.00, 'active', array[30]);
select pg_temp.mk('14', 100.00, 'active', array[2, 5]);
select pg_temp.mk('15', 100.00, 'active', array[2]);
select pg_temp.mk('16', 100.00, 'active', array[5]);
select pg_temp.mk('17', 100.00, 'active', array[4]);
select pg_temp.mk('18', 100.00, 'active', array[3]);
update public.product_variants set archived_at = now() where id = 'f7000000-0000-0000-0001-000000000006';     -- variante archivada (el producto 01 sigue con otras activas)
delete from public.product_prices where product_id = 'b7000000-0000-0000-0000-000000000003';                    -- producto publicado SIN precio BOB (caso defensivo)

-- ═══ 1. Ajustes: existen con su valor y tipo por defecto ══════════════════════════════════════
select is((select (value #>> '{}') || '/' || value_type || '/' || is_public::text from public.store_settings where key = 'reserve_on_add_to_cart'),
  'true/bool/false', 'reserve_on_add_to_cart = true (bool, no público)');
select is((select (value #>> '{}') || '/' || value_type || '/' || is_public::text from public.store_settings where key = 'cart_max_qty_per_variant'),
  '10/int/false', 'cart_max_qty_per_variant = 10 (int)');
select is((select (value #>> '{}') || '/' || value_type || '/' || is_public::text from public.store_settings where key = 'cart_max_lines'),
  '30/int/false', 'cart_max_lines = 30 (int)');
select is((select (value #>> '{}') || '/' || value_type || '/' || is_public::text from public.store_settings where key = 'cart_max_reserved_units'),
  '30/int/false', 'cart_max_reserved_units = 30 (int)');
select is((select (value #>> '{}') || '/' || value_type || '/' || is_public::text from public.store_settings where key = 'price_guarantee_days'),
  '7/int/false', 'price_guarantee_days = 7 (int)');
select is((select (value #>> '{}') || '/' || value_type || '/' || is_public::text from public.store_settings where key = 'guest_cart_retention_days'),
  '30/int/false', 'guest_cart_retention_days = 30 (int)');
-- setting_bool: lee solo ajustes de tipo bool; si no existe (o es de otro tipo) devuelve el valor por defecto que se le da
select is(public.setting_bool('no_existe_s7', true), true, 'setting_bool: clave inexistente → el valor por defecto (true)');
select is(public.setting_bool('no_existe_s7', false), false, 'setting_bool: clave inexistente → el valor por defecto (false)');
select is(public.setting_bool('reserve_on_add_to_cart', false), true, 'setting_bool: si el ajuste existe manda su valor (true), no el defecto');
select is(public.setting_bool('cart_max_lines', false), false, 'setting_bool: un ajuste de tipo int no se interpreta como bool (devuelve el defecto)');

-- ═══ A. Estructura, restricciones y permisos ═══════════════════════════════════════════════════
select has_table('public', 'carts', 'existe la tabla carts');
select has_table('public', 'cart_items', 'existe la tabla cart_items');
select is((select relrowsecurity from pg_class where oid = 'public.carts'::regclass), true, 'carts tiene RLS activa');
select is((select relrowsecurity from pg_class where oid = 'public.cart_items'::regclass), true, 'cart_items tiene RLS activa');
-- Restricciones del carrito
select throws_ok($$insert into public.carts (profile_id, token_hash, currency) values ('a7000000-0000-0000-0000-000000000012', repeat('c1', 32), 'BOB')$$,
  '23514', null, 'XOR: un carrito con usuario Y token se rechaza');
select throws_ok($$insert into public.carts (currency) values ('BOB')$$, '23514', null, 'XOR: un carrito sin usuario NI token se rechaza');
select throws_ok($$insert into public.carts (token_hash, currency) values ('no-es-un-hash', 'BOB')$$,
  '23514', null, 'el token_hash debe ser 64 caracteres hexadecimales');
select throws_ok($$insert into public.carts (token_hash, currency) values (repeat('C1', 32), 'BOB')$$,
  '23514', null, 'el token_hash en mayúsculas se rechaza');
select throws_ok($$insert into public.carts (token_hash, currency, status) values (repeat('c1', 32), 'BOB', 'roto')$$,
  '23514', null, 'un estado fuera del catálogo se rechaza');
select throws_ok($$insert into public.carts (token_hash, currency, status) values (repeat('c1', 32), 'BOB', 'merged')$$,
  '23514', null, 'un carrito "merged" exige merged_into');
select throws_ok($$insert into public.carts (token_hash, currency) values (repeat('c1', 32), 'XXX')$$, '23503', null, 'la moneda debe existir');
select lives_ok($$insert into public.carts (token_hash, currency) values (repeat('c1', 32), 'BOB')$$, 'un carrito de invitado válido se crea (control)');
select throws_ok($$insert into public.carts (token_hash, currency, merged_into)
  values (repeat('c2', 32), 'BOB', (select id from public.carts where token_hash = repeat('c1', 32)))$$,
  '23514', null, 'merged_into solo es posible con estado "merged"');
select throws_ok($$insert into public.carts (token_hash, currency) values (repeat('c1', 32), 'BOB')$$, '23505', null, 'un token_hash no se repite');
select lives_ok($$insert into public.carts (profile_id, currency) values ('a7000000-0000-0000-0000-000000000012', 'BOB')$$, 'un carrito de usuario válido se crea (control)');
select throws_ok($$insert into public.carts (profile_id, currency) values ('a7000000-0000-0000-0000-000000000012', 'BOB')$$,
  '23505', null, 'un usuario no puede tener dos carritos ACTIVOS');
select lives_ok($$insert into public.carts (profile_id, currency, status) values ('a7000000-0000-0000-0000-000000000012', 'BOB', 'abandoned')$$,
  'pero sí uno activo y otros cerrados (el índice único es parcial)');
-- Restricciones de las líneas
select lives_ok($$insert into public.cart_items (cart_id, variant_id, qty, unit_price_at_add, currency, price_locked_until)
  values ((select id from public.carts where token_hash = repeat('c1', 32)), 'f7000000-0000-0000-0013-000000000001', 1, 100, 'BOB', now() + interval '1 day')$$,
  'una línea válida se inserta (control)');
select throws_ok($$insert into public.cart_items (cart_id, variant_id, qty, unit_price_at_add, currency, price_locked_until)
  values ((select id from public.carts where token_hash = repeat('c1', 32)), 'f7000000-0000-0000-0014-000000000001', 0, 100, 'BOB', now() + interval '1 day')$$,
  '23514', null, 'cantidad 0 rechazada');
select throws_ok($$insert into public.cart_items (cart_id, variant_id, qty, unit_price_at_add, currency, price_locked_until)
  values ((select id from public.carts where token_hash = repeat('c1', 32)), 'f7000000-0000-0000-0014-000000000001', 1001, 100, 'BOB', now() + interval '1 day')$$,
  '23514', null, 'cantidad 1001 rechazada');
select throws_ok($$insert into public.cart_items (cart_id, variant_id, qty, unit_price_at_add, currency, price_locked_until)
  values ((select id from public.carts where token_hash = repeat('c1', 32)), 'f7000000-0000-0000-0014-000000000001', 1, 0, 'BOB', now() + interval '1 day')$$,
  '23514', null, 'precio de entrada 0 rechazado');
select throws_ok($$insert into public.cart_items (cart_id, variant_id, qty, unit_price_at_add, currency, price_locked_until)
  values ((select id from public.carts where token_hash = repeat('c1', 32)), 'f7000000-0000-0000-0013-000000000001', 1, 100, 'BOB', now() + interval '1 day')$$,
  '23505', null, 'una variante no se repite en el mismo carrito');
delete from public.carts where token_hash = repeat('c1', 32) or profile_id = 'a7000000-0000-0000-0000-000000000012';
select is((select count(*)::int from public.cart_items where variant_id = 'f7000000-0000-0000-0013-000000000001'), 0, 'borrar un carrito borra sus líneas (cascada)');

-- Catálogo: SECURITY DEFINER + search_path vacío, y quién ejecuta qué
select is((select count(*)::int from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname = any(array['cart_get', 'cart_set_item', 'cart_remove_item', 'cart_clear', 'cart_refresh', 'cart_accept_prices',
                                        'merge_guest_cart', 'cart_abandon_stale', 'purge_old_carts', '_cart_lock', '_cart_lock_active',
                                        '_cart_ip_room', '_cart_free_for', '_cart_resolve', '_cart_snapshot', 'profiles_release_cart',
                                        'setting_bool'])
              and p.prosecdef and 'search_path=""' = any(p.proconfig)),
  17, 'las 17 funciones del carrito son SECURITY DEFINER con search_path vacío');
select is((select count(*)::int from pg_proc p cross join (values ('anon'), ('authenticated')) r(rol)
            where p.pronamespace = 'public'::regnamespace
              and p.proname = any(array['cart_get', 'cart_set_item', 'cart_remove_item', 'cart_clear', 'cart_refresh', 'cart_accept_prices',
                                        'merge_guest_cart', 'cart_abandon_stale', 'purge_old_carts', '_cart_lock', '_cart_lock_active',
                                        '_cart_ip_room', '_cart_free_for', '_cart_resolve', '_cart_snapshot', 'profiles_release_cart',
                                        'setting_bool', 'store_settings_validate_s7'])
              and has_function_privilege(r.rol, p.oid, 'execute')),
  0, 'ni anon ni authenticated pueden ejecutar NINGUNA función del carrito');
select is((select count(*)::int from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname = any(array['cart_get', 'cart_set_item', 'cart_remove_item', 'cart_clear', 'cart_refresh', 'cart_accept_prices',
                                        'merge_guest_cart', 'cart_abandon_stale', 'purge_old_carts', 'setting_bool'])
              and has_function_privilege('service_role', p.oid, 'execute')),
  10, 'service_role ejecuta la API del carrito (9 funciones) y setting_bool');
select is((select count(*)::int from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname = any(array['_cart_lock', '_cart_lock_active', '_cart_ip_room', '_cart_free_for', '_cart_resolve',
                                        '_cart_snapshot', 'profiles_release_cart', 'store_settings_validate_s7'])
              and has_function_privilege('service_role', p.oid, 'execute')),
  0, 'las internas _cart_* y las funciones de trigger NO son ejecutables por service_role (solo las llaman otras funciones y los triggers)');

-- service_role: la API completa funciona de punta a punta con ese rol (las tablas las escribe el propietario por dentro)
set local role service_role;
select is((public.cart_set_item(null, repeat('90', 32), 'f7000000-0000-0000-0013-000000000001', 2) ->> 'outcome'), 'ok', 'service_role: cart_set_item agrega al carrito de un invitado');
select is((public.cart_get(null, repeat('90', 32)) #>> '{cart,totals,item_count}')::int, 2, 'service_role: cart_get ve las 2 unidades');
select is((public.cart_accept_prices(null, repeat('90', 32), null) #>> '{cart,totals,subtotal}')::numeric, 200.00,
  'service_role: cart_accept_prices devuelve el carrito (2 × 100.00 = 200.00)');
select is((public.cart_refresh(null, repeat('90', 32)) ->> 'renewed')::int, 0, 'service_role: cart_refresh no renueva nada (la retención sigue vigente)');
select is((public.merge_guest_cart('a7000000-0000-0000-0000-000000000006', repeat('90', 32)) ->> 'merged')::boolean, true, 'service_role: merge_guest_cart fusiona en el carrito del usuario');
select is((public.cart_remove_item('a7000000-0000-0000-0000-000000000006', null, 'f7000000-0000-0000-0013-000000000001') ->> 'outcome'), 'removed', 'service_role: cart_remove_item quita la línea');
select is((public.cart_clear('a7000000-0000-0000-0000-000000000006', null) #>> '{cart,totals,line_count}')::int, 0, 'service_role: cart_clear devuelve el carrito vacío');
select is((public.cart_set_item('a7000000-0000-0000-0000-000000000006', null, 'f7000000-0000-0000-0013-000000000001', 1) ->> 'outcome'), 'ok', 'service_role: el usuario vuelve a agregar (deja 1 línea para las pruebas de lectura)');
select is(public.cart_abandon_stale(), 0, 'service_role: cart_abandon_stale no abandona nada (nada vencido)');
select is(public.purge_old_carts(), 0, 'service_role: purge_old_carts no borra nada (nada viejo)');
reset role;

-- service_role NO escribe directo en las tablas
select is((select count(*)::int from (values ('carts'), ('cart_items')) t(n) cross join (values ('insert'), ('update'), ('delete'), ('truncate')) p(priv)
            where has_table_privilege('service_role', 'public.' || t.n, p.priv)),
  0, 'service_role no tiene INSERT/UPDATE/DELETE/TRUNCATE en carts ni cart_items');
select is(has_table_privilege('service_role', 'public.carts', 'select') and has_table_privilege('service_role', 'public.cart_items', 'select'),
  true, 'service_role sí puede LEER ambas tablas (diagnóstico)');
set local role service_role;
select throws_ok($$insert into public.carts (token_hash, currency) values (repeat('91', 32), 'BOB')$$, '42501', null, 'service_role no inserta carritos directamente');
select throws_ok($$update public.carts set status = 'abandoned'$$, '42501', null, 'service_role no actualiza carritos directamente');
select throws_ok($$delete from public.carts$$, '42501', null, 'service_role no borra carritos directamente');
select throws_ok($$truncate public.cart_items$$, '42501', null, 'service_role no trunca cart_items');
reset role;

-- anon: nada
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select * from public.carts$$, '42501', null, 'anon no lee carts');
select throws_ok($$select * from public.cart_items$$, '42501', null, 'anon no lee cart_items');
select throws_ok($$select public.cart_get(null, repeat('90', 32))$$, '42501', null, 'anon no ejecuta cart_get');
select throws_ok($$select public.cart_set_item(null, repeat('90', 32), 'f7000000-0000-0000-0013-000000000001', 1)$$, '42501', null, 'anon no ejecuta cart_set_item');
select throws_ok($$select public.cart_clear(null, repeat('90', 32))$$, '42501', null, 'anon no ejecuta cart_clear');
select throws_ok($$select public.merge_guest_cart('a7000000-0000-0000-0000-000000000006', repeat('90', 32))$$, '42501', null, 'anon no ejecuta merge_guest_cart');
select throws_ok($$select public.cart_abandon_stale()$$, '42501', null, 'anon no ejecuta cart_abandon_stale');
reset role;

-- cliente autenticado (aunque tenga carrito): no lee ni escribe; todo pasa por la API
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a7000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is((select count(*)::int from public.carts), 0, 'un cliente con carrito ve 0 filas de carts (RLS: solo el admin lee)');
select is((select count(*)::int from public.cart_items), 0, 'un cliente con carrito ve 0 filas de cart_items');
select throws_ok($$insert into public.carts (profile_id, currency) values ('a7000000-0000-0000-0000-000000000006', 'BOB')$$, '42501', null, 'un cliente no inserta carritos');
select throws_ok($$update public.carts set status = 'abandoned'$$, '42501', null, 'un cliente no actualiza carritos');
select throws_ok($$delete from public.cart_items$$, '42501', null, 'un cliente no borra líneas');
select throws_ok($$select public.cart_get('a7000000-0000-0000-0000-000000000006', null)$$, '42501', null, 'un cliente no ejecuta cart_get');
select throws_ok($$select public.cart_set_item('a7000000-0000-0000-0000-000000000006', null, 'f7000000-0000-0000-0013-000000000001', 1)$$, '42501', null, 'un cliente no ejecuta cart_set_item');
select throws_ok($$select public.merge_guest_cart('a7000000-0000-0000-0000-000000000006', repeat('90', 32))$$, '42501', null, 'un cliente no ejecuta merge_guest_cart');
select throws_ok($$select public.purge_old_carts()$$, '42501', null, 'un cliente no ejecuta purge_old_carts');
reset role;

-- admin: solo lectura
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ad000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select is((select count(*)::int from public.carts where profile_id = 'a7000000-0000-0000-0000-000000000006'), 1, 'el admin ve el carrito de un cliente (atender dudas)');
select is((select count(*)::int from public.cart_items where cart_id = (select id from public.carts where profile_id = 'a7000000-0000-0000-0000-000000000006')), 1, 'el admin ve sus líneas');
select is((select status from public.carts where token_hash = repeat('90', 32)), 'merged', 'el admin ve también el carrito de invitado ya fusionado');
select throws_ok($$update public.carts set status = 'abandoned' where profile_id = 'a7000000-0000-0000-0000-000000000006'$$, '42501', null, 'el admin no edita carritos');
select throws_ok($$delete from public.carts where profile_id = 'a7000000-0000-0000-0000-000000000006'$$, '42501', null, 'el admin no borra carritos');
reset role;

-- Trabajos programados
select is((select count(*)::int from cron.job where jobname = 'abandon-stale-carts' and schedule = '23 * * * *'
             and command = 'select public.cart_abandon_stale()'), 1, 'pg_cron: cart_abandon_stale() programada cada hora (minuto 23)');
select is((select count(*)::int from cron.job where jobname = 'purge-old-carts' and schedule = '29 3 * * *'
             and command = 'select public.purge_old_carts()'), 1, 'pg_cron: purge_old_carts() programada a diario (03:29)');

-- ═══ B. Alta, idempotencia, cantidad, topes y límites (usuario 01; variante 0101 stock 10, precio 100.00) ═══
select pg_temp.rec('b0', public.cart_get('a7000000-0000-0000-0000-000000000001', null));
select is(pg_temp.g('b0') - 'server_time', '{"token_state":"none","cart":null}'::jsonb, 'B0 cart_get de quien no tiene carrito: token_state "none" y cart nulo');
select is((select count(*)::int from public.carts where profile_id = 'a7000000-0000-0000-0000-000000000001'), 0, 'B0 …y leer NO crea ningún carrito');

-- B1 alta de 2 unidades: subtotal = 2 × 100.00 = 200.00; retiene 2 por 10 min; precio de entrada 100.00 con garantía de 7 días
select pg_temp.rec('b1', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000001', 2));
select is(pg_temp.oa(pg_temp.g('b1')), '{"outcome":"ok","applied":2,"requested":2}'::jsonb, 'B1 alta de 2 unidades: ok, aplicadas 2');
select is(pg_temp.g('b1') #> '{cart,totals}',
  '{"subtotal":200.00,"item_count":2,"line_count":1,"shipping":null,"discount":null,"total":200.00}'::jsonb,
  'B1 totales: subtotal 2 × 100.00 = 200.00, 2 unidades, 1 línea; envío y descuento nulos (los llenan S8/S9)');
select is(pg_temp.ls(pg_temp.g('b1'), 'f7000000-0000-0000-0001-000000000001'),
  '{"status":"ok","blocking":false,"billable_qty":2,"price_notice":null,"unit_price":100,"line_total":200.00}'::jsonb,
  'B1 la línea queda ok, sin aviso de precio, facturable 2');
select is(pg_temp.held(pg_temp.uc('a7000000-0000-0000-0000-000000000001'), 'f7000000-0000-0000-0001-000000000001'), 2, 'B1 retiene 2 unidades');
select is((select expires_at from public.stock_reservations where owner_id = pg_temp.uc('a7000000-0000-0000-0000-000000000001') and status = 'active'),
  now() + interval '10 minutes', 'B1 la retención vence a los 10 min (reservation_ttl_minutes)');
select is(pg_temp.g('b1') #>> '{cart,reservation,state}', 'held', 'B1 estado de la retención: held');
select is((pg_temp.g('b1') #>> '{cart,reservation,expires_at}')::timestamptz, now() + interval '10 minutes', 'B1 el snapshot informa ese vencimiento');
select is((pg_temp.g('b1') #>> '{cart,can_checkout}')::boolean, true, 'B1 can_checkout = true');
select is((select unit_price_at_add from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000001')), 100.00, 'B1 precio de entrada = price_for(producto, BOB) = 100.00');
select is((select price_locked_until from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000001')), now() + interval '7 days', 'B1 garantía de precio = now() + 7 días');
select is(jsonb_build_object('currency', pg_temp.g('b1') #> '{cart,currency}', 'reserve_on_add', pg_temp.g('b1') #> '{cart,reserve_on_add}',
    'ttl_seconds', pg_temp.g('b1') #> '{cart,ttl_seconds}', 'guarantee_days', pg_temp.g('b1') #> '{cart,guarantee_days}',
    'limits', pg_temp.g('b1') #> '{cart,limits}'),
  '{"currency":"BOB","reserve_on_add":true,"ttl_seconds":600,"guarantee_days":7,"limits":{"max_qty_per_variant":10,"max_lines":30,"max_units":30}}'::jsonb,
  'B1 el snapshot informa moneda, TTL (10 min = 600 s), garantía y topes vigentes');
-- Contrato JSON que consumen la Edge Function y la interfaz (claves en orden de bytes)
select is((select jsonb_agg(k order by k collate "C") from jsonb_object_keys(pg_temp.g('b1')) k),
  '["applied","cart","outcome","requested","server_time","token_state"]'::jsonb, 'B1 contrato: claves de la respuesta de cart_set_item');
select is((select jsonb_agg(k order by k collate "C") from jsonb_object_keys(pg_temp.g('b1') -> 'cart') k),
  '["can_checkout","cart_id","currency","discounts","guarantee_days","limits","lines","reservation","reserve_on_add","status","totals","ttl_seconds"]'::jsonb,
  'B1 contrato: claves del carrito (S9 sumó «discounts»)');
select is((select jsonb_agg(k order by k collate "C") from jsonb_object_keys(pg_temp.lin(pg_temp.g('b1'), 'f7000000-0000-0000-0001-000000000001')) k),
  '["available","billable_qty","blocking","color_hex","color_name","current_price","discount","discount_offers","final_total","image_path","line_total","name","price_at_add","price_locked_until","price_notice","product_id","qty","reservation_expires_at","reserved_qty","size_label","sku","slug","status","unit_price","variant_id"]'::jsonb,
  'B1 contrato: claves de cada línea (25; S9 sumó «discount», «discount_offers» y «final_total»)');

-- B2 repetir lo mismo no duplica nada
select pg_temp.rec('b2', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000001', 2));
select is(pg_temp.oa(pg_temp.g('b2')), '{"outcome":"ok","applied":2,"requested":2}'::jsonb, 'B2 repetir la misma cantidad: mismo resultado');
select is((select count(*)::int from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000001')), 1, 'B2 sigue habiendo UNA línea');
select is((select count(*)::int from public.stock_reservations where owner_id = pg_temp.uc('a7000000-0000-0000-0000-000000000001') and status = 'active'), 1, 'B2 …y UNA sola retención activa');
select is(pg_temp.held(pg_temp.uc('a7000000-0000-0000-0000-000000000001'), 'f7000000-0000-0000-0001-000000000001'), 2, 'B2 …de 2 unidades (no 4: la cantidad es absoluta, no suma)');
select is((select count(*)::int from public.carts where profile_id = 'a7000000-0000-0000-0000-000000000001'), 1, 'B2 un solo carrito');

-- B3 subir y bajar la cantidad ajusta la retención: 5 × 100.00 = 500.00 ; 1 × 100.00 = 100.00
select pg_temp.rec('b3a', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000001', 5));
select is(pg_temp.oa(pg_temp.g('b3a')), '{"outcome":"ok","applied":5,"requested":5}'::jsonb, 'B3 subir a 5: ok');
select is(pg_temp.held(pg_temp.uc('a7000000-0000-0000-0000-000000000001'), 'f7000000-0000-0000-0001-000000000001'), 5, 'B3 la retención sube a 5');
select is(pg_temp.g('b3a') #> '{cart,totals,subtotal}', '500.00'::jsonb, 'B3 subtotal 5 × 100.00 = 500.00');
select pg_temp.rec('b3b', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000001', 1));
select is(pg_temp.held(pg_temp.uc('a7000000-0000-0000-0000-000000000001'), 'f7000000-0000-0000-0001-000000000001'), 1, 'B3 bajar a 1: la retención baja a 1 (se libera lo que sobra)');
select is(pg_temp.g('b3b') #> '{cart,totals,subtotal}', '100.00'::jsonb, 'B3 subtotal 1 × 100.00 = 100.00');

-- B4 tope por variante (10): pedir 999 → 10 con aviso; pedir exactamente 10 es normal; 11 se recorta
select pg_temp.rec('b4a', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000001', 999));
select is(pg_temp.oa(pg_temp.g('b4a')), '{"outcome":"capped_variant","applied":10,"requested":999}'::jsonb, 'B4 pedir 999: se aplica el tope de 10 (capped_variant)');
select is(pg_temp.held(pg_temp.uc('a7000000-0000-0000-0000-000000000001'), 'f7000000-0000-0000-0001-000000000001'), 10, 'B4 …y la retención es de 10');
select pg_temp.rec('b4b', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000001', 10));
select is(pg_temp.oa(pg_temp.g('b4b')), '{"outcome":"ok","applied":10,"requested":10}'::jsonb, 'B4 pedir exactamente el tope (10) NO se considera recorte');
select pg_temp.rec('b4c', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000001', 11));
select is(pg_temp.oa(pg_temp.g('b4c')), '{"outcome":"capped_variant","applied":10,"requested":11}'::jsonb, 'B4 pedir 11: recortado a 10');

-- B5 ajuste por stock: v0102 tiene stock 3; pedir 5 → se ajusta a 3 con aviso; pedir 3 es normal
select pg_temp.rec('b5a', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000002', 5));
select is(pg_temp.oa(pg_temp.g('b5a')), '{"outcome":"adjusted","applied":3,"requested":5}'::jsonb, 'B5 pedir 5 con stock 3: adjusted, aplicadas 3');
select is(pg_temp.held(pg_temp.uc('a7000000-0000-0000-0000-000000000001'), 'f7000000-0000-0000-0001-000000000002'), 3, 'B5 retiene 3 (todo lo que hay)');
select is((select qty from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000001') and variant_id = 'f7000000-0000-0000-0001-000000000002'), 3, 'B5 la línea queda en 3, no en 5');
select pg_temp.rec('b5b', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000002', 3));
select is(pg_temp.oa(pg_temp.g('b5b')), '{"outcome":"ok","applied":3,"requested":3}'::jsonb, 'B5 pedir exactamente el stock (3) es normal');

-- B6 quitar libera; quitar lo que no está es inocuo
select pg_temp.rec('b6a', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000002', 0));
select is(pg_temp.oa(pg_temp.g('b6a')), '{"outcome":"removed","applied":0,"requested":0}'::jsonb, 'B6 cantidad 0 quita la línea (removed)');
select ok(pg_temp.lin(pg_temp.g('b6a'), 'f7000000-0000-0000-0001-000000000002') is null, 'B6 la línea ya no aparece en el carrito');
select is((select status from public.stock_reservations where owner_id = pg_temp.uc('a7000000-0000-0000-0000-000000000001') and variant_id = 'f7000000-0000-0000-0001-000000000002'), 'released', 'B6 su retención quedó liberada');
select pg_temp.rec('b6b', public.cart_remove_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000001'));
select is(pg_temp.oa(pg_temp.g('b6b')), '{"outcome":"removed","applied":0,"requested":0}'::jsonb, 'B6 cart_remove_item quita la otra línea');
select is(pg_temp.heldall(pg_temp.uc('a7000000-0000-0000-0000-000000000001')), 0, 'B6 el carrito ya no retiene nada');
select is(pg_temp.nlines(pg_temp.g('b6b')), 0, 'B6 el carrito quedó sin líneas');
select is(jsonb_build_object('state', pg_temp.g('b6b') #> '{cart,reservation,state}', 'subtotal', pg_temp.g('b6b') #> '{cart,totals,subtotal}',
    'can_checkout', pg_temp.g('b6b') #> '{cart,can_checkout}'),
  '{"state":"none","subtotal":0,"can_checkout":false}'::jsonb, 'B6 carrito vacío: retención "none", subtotal 0 y no se puede pagar');
select pg_temp.rec('b6c', public.cart_remove_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000001'));
select is(pg_temp.oa(pg_temp.g('b6c')), '{"outcome":"removed","applied":0,"requested":0}'::jsonb, 'B6 quitar una línea que no existe es inocuo');

-- B7 argumentos inválidos
select throws_ok($$select public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000001', -1)$$, '22023', null, 'B7 cantidad negativa → 22023');
select throws_ok($$select public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000001', 1001)$$, '22023', null, 'B7 cantidad 1001 → 22023');
select throws_ok($$select public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000001', null)$$, '22023', null, 'B7 cantidad NULL → 22023');
select throws_ok($$select public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, null, 1)$$, '22023', null, 'B7 variante NULL → 22023');
select throws_ok($$select public.cart_set_item('a7000000-0000-0000-0000-000000000001', repeat('11', 32), 'f7000000-0000-0000-0001-000000000001', 1)$$, '22023', null, 'B7 usuario Y token a la vez → 22023');
select throws_ok($$select public.cart_set_item(null, null, 'f7000000-0000-0000-0001-000000000001', 1)$$, '22023', null, 'B7 ni usuario ni token → 22023');
select throws_ok($$select public.cart_set_item(null, 'abc', 'f7000000-0000-0000-0001-000000000001', 1)$$, '22023', null, 'B7 token que no es hex de 64 → 22023');
select throws_ok($$select public.cart_set_item(null, repeat('ab', 31) || 'a', 'f7000000-0000-0000-0001-000000000001', 1)$$, '22023', null, 'B7 token de 63 caracteres → 22023');
select throws_ok($$select public.cart_set_item(null, repeat('AB', 32), 'f7000000-0000-0000-0001-000000000001', 1)$$, '22023', null, 'B7 token en mayúsculas → 22023');
select throws_ok($$select public.cart_get(null, null)$$, '22023', null, 'B7 cart_get sin identidad → 22023');
select pg_temp.rec('b7', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000005', 1000));
select is(pg_temp.oa(pg_temp.g('b7')), '{"outcome":"capped_variant","applied":10,"requested":1000}'::jsonb, 'B7 1000 es el máximo aceptado: se recorta a 10');
select pg_temp.rec('b7', public.cart_remove_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000005'));

-- B8 no comprables: no crean línea ni retienen
select pg_temp.rec('b8a', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0002-000000000001', 1));
select is(pg_temp.oa(pg_temp.g('b8a')), '{"outcome":"unavailable","applied":0,"requested":1}'::jsonb, 'B8 producto en borrador → unavailable');
select pg_temp.rec('b8b', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0003-000000000001', 1));
select is(pg_temp.oa(pg_temp.g('b8b')), '{"outcome":"unavailable","applied":0,"requested":1}'::jsonb, 'B8 producto sin precio en BOB → unavailable');
select pg_temp.rec('b8c', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000006', 1));
select is(pg_temp.oa(pg_temp.g('b8c')), '{"outcome":"unavailable","applied":0,"requested":1}'::jsonb, 'B8 variante archivada → unavailable');
select pg_temp.rec('b8d', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, '99999999-9999-9999-9999-999999999999', 1));
select is(pg_temp.oa(pg_temp.g('b8d')), '{"outcome":"unavailable","applied":0,"requested":1}'::jsonb, 'B8 variante inexistente → unavailable (no es un error)');
select pg_temp.rec('b8e', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000003', 1));
select is(pg_temp.oa(pg_temp.g('b8e')), '{"outcome":"out_of_stock","applied":0,"requested":1}'::jsonb, 'B8 variante con stock 0 → out_of_stock');
select is((select count(*)::int from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000001')), 0, 'B8 ninguno de los cinco creó una línea');
select is(pg_temp.heldall(pg_temp.uc('a7000000-0000-0000-0000-000000000001')), 0, 'B8 …ni retuvo stock');

-- B9 límite de líneas (2): la 3.ª línea nueva se rechaza, pero una existente se puede editar
update public.store_settings set value = '2' where key = 'cart_max_lines';
select pg_temp.rec('b9', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000001', 1));
select pg_temp.rec('b9', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000004', 1));
select pg_temp.rec('b9', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000005', 1));
select is(pg_temp.oa(pg_temp.g('b9')), '{"outcome":"limit_lines","applied":0,"requested":1}'::jsonb, 'B9 con tope de 2 líneas, la 3.ª línea nueva → limit_lines');
select is(pg_temp.nlines(pg_temp.g('b9')), 2, 'B9 el carrito sigue con 2 líneas');
select pg_temp.rec('b9', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000001', 3));
select is(pg_temp.oa(pg_temp.g('b9')), '{"outcome":"ok","applied":3,"requested":3}'::jsonb, 'B9 editar una línea existente con el tope de líneas lleno SÍ se permite');
update public.store_settings set value = '30' where key = 'cart_max_lines';
-- B9 límite de unidades (5). El carrito tiene v0101 × 3 + v0104 × 1 = 4 unidades.
update public.store_settings set value = '5' where key = 'cart_max_reserved_units';
select pg_temp.rec('b9u', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000005', 4));
select is(pg_temp.oa(pg_temp.g('b9u')), '{"outcome":"capped_units","applied":1,"requested":4}'::jsonb, 'B9 línea nueva de 4 con 4 unidades en el carrito y tope 5: queda 1 de margen → capped_units, aplicadas 1');
select pg_temp.rec('b9u', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000002', 1));
select is(pg_temp.oa(pg_temp.g('b9u')), '{"outcome":"limit_units","applied":0,"requested":1}'::jsonb, 'B9 con 5 de 5 unidades, otra línea → limit_units');
select pg_temp.rec('b9u', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000001', 4));
select is(pg_temp.oa(pg_temp.g('b9u')), '{"outcome":"capped_units","applied":3,"requested":4}'::jsonb, 'B9 subir v0101 de 3 a 4 con las otras sumando 2 (1 + 1) y tope 5: máximo 3 → capped_units');
select pg_temp.rec('b9u', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000004', 999));
select is(pg_temp.oa(pg_temp.g('b9u')), '{"outcome":"capped_units","applied":1,"requested":999}'::jsonb, 'B9 pedir 999: gana el tope de unidades (5 − 3 − 1 = 1) sobre el de variante (10)');
select pg_temp.rec('b9u', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000001', 1));
select is(pg_temp.oa(pg_temp.g('b9u')), '{"outcome":"ok","applied":1,"requested":1}'::jsonb, 'B9 bajar siempre cabe');
update public.store_settings set value = '30' where key = 'cart_max_reserved_units';

-- B10 cart_clear: vacía las líneas, libera todo y deja el carrito activo
select pg_temp.rec('b10', public.cart_clear('a7000000-0000-0000-0000-000000000001', null));
select is(pg_temp.nlines(pg_temp.g('b10')), 0, 'B10 cart_clear deja 0 líneas');
select is(pg_temp.heldall(pg_temp.uc('a7000000-0000-0000-0000-000000000001')), 0, 'B10 …y libera todas las retenciones');
select is((select status from public.carts where id = pg_temp.uc('a7000000-0000-0000-0000-000000000001')), 'active', 'B10 …y el carrito sigue activo (se vació, no se cerró)');
-- B10b el TTL sale del ajuste reservation_ttl_minutes
update public.store_settings set value = '30' where key = 'reservation_ttl_minutes';
select pg_temp.rec('b10b', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000004', 1));
select is((select expires_at from public.stock_reservations where owner_id = pg_temp.uc('a7000000-0000-0000-0000-000000000001') and variant_id = 'f7000000-0000-0000-0001-000000000004' and status = 'active'),
  now() + interval '30 minutes', 'B10 con reservation_ttl_minutes = 30 la retención vence a los 30 min');
select is(pg_temp.g('b10b') #>> '{cart,ttl_seconds}', '1800', 'B10 el snapshot informa ttl_seconds = 1800');
update public.store_settings set value = '10' where key = 'reservation_ttl_minutes';
-- B10c COMPORTAMIENTO ACTUAL (a decidir): repetir cart_set_item con la misma cantidad RENUEVA el vencimiento (reserve_stock lo
-- reescribe), a diferencia de cart_refresh, que no alarga las vigentes. Cualquier actividad real del cliente mantiene su retención.
update public.stock_reservations set expires_at = now() + interval '3 minutes'
 where owner_id = pg_temp.uc('a7000000-0000-0000-0000-000000000001') and variant_id = 'f7000000-0000-0000-0001-000000000004' and status = 'active';
select pg_temp.rec('b10c', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000004', 1));
select is((select expires_at from public.stock_reservations where owner_id = pg_temp.uc('a7000000-0000-0000-0000-000000000001') and variant_id = 'f7000000-0000-0000-0001-000000000004' and status = 'active'),
  now() + interval '10 minutes', 'B10 DOCUMENTADO: repetir set_item con la misma cantidad renueva el vencimiento a 10 min (cart_refresh, en cambio, no alarga)');
select pg_temp.rec('b10d', public.cart_clear('a7000000-0000-0000-0000-000000000001', null));

-- B11 con reserve_on_add_to_cart = false NO se crean retenciones, pero igual se ajusta al stock y se informa
update public.store_settings set value = 'false' where key = 'reserve_on_add_to_cart';
select pg_temp.rec('b11a', public.cart_set_item('a7000000-0000-0000-0000-000000000002', null, 'f7000000-0000-0000-0014-000000000001', 3));
select is(pg_temp.oa(pg_temp.g('b11a')), '{"outcome":"adjusted","applied":2,"requested":3}'::jsonb, 'B11 sin retener: pedir 3 con stock 2 se ajusta a 2');
select is((select count(*)::int from public.stock_reservations where owner_id = pg_temp.uc('a7000000-0000-0000-0000-000000000002')), 0, 'B11 …y no existe ninguna reserva del carrito');
select is(pg_temp.g('b11a') #> '{cart,reservation}', '{"state":"none","expires_at":null}'::jsonb, 'B11 el estado de la retención es "none"');
select is(pg_temp.g('b11a') #> '{cart,reserve_on_add}', 'false'::jsonb, 'B11 el snapshot informa reserve_on_add = false');
select pg_temp.rec('b11b', public.cart_set_item('a7000000-0000-0000-0000-000000000002', null, 'f7000000-0000-0000-0014-000000000002', 4));
select is(pg_temp.oa(pg_temp.g('b11b')), '{"outcome":"ok","applied":4,"requested":4}'::jsonb, 'B11 4 de 5 unidades: ok, tampoco retiene');
select pg_temp.rec('b11c', public.cart_set_item(null, repeat('f1', 32), 'f7000000-0000-0000-0014-000000000001', 1));
select is(pg_temp.oa(pg_temp.g('b11c')), '{"outcome":"ok","applied":1,"requested":1}'::jsonb, 'B11 sin retención, un 2.º carrito también puede pedir esas unidades (la protección es solo al pagar)');
select pg_temp.rec('b11d', public.cart_refresh('a7000000-0000-0000-0000-000000000002', null));
select is((pg_temp.g('b11d') ->> 'renewed')::int, 0, 'B11 cart_refresh sin retención activada no renueva nada');
-- Sin retención, la comprobación de disponibilidad de cart_set_item es la ÚNICA barrera (reserve_stock ya no la hace)
select pg_temp.rec('b11f', public.cart_set_item('a7000000-0000-0000-0000-000000000002', null, 'f7000000-0000-0000-0002-000000000001', 1));
select is(pg_temp.oa(pg_temp.g('b11f')), '{"outcome":"unavailable","applied":0,"requested":1}'::jsonb, 'B11 sin retención, un producto en borrador sigue siendo unavailable');
select is((select count(*)::int from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000002') and variant_id = 'f7000000-0000-0000-0002-000000000001'), 0, 'B11 …y no crea la línea del producto en borrador');
select pg_temp.rec('b11g', public.cart_set_item('a7000000-0000-0000-0000-000000000002', null, 'f7000000-0000-0000-0001-000000000006', 1));
select is(pg_temp.oa(pg_temp.g('b11g')), '{"outcome":"unavailable","applied":0,"requested":1}'::jsonb, 'B11 sin retención, una variante archivada sigue siendo unavailable');
select is((select count(*)::int from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000002') and variant_id = 'f7000000-0000-0000-0001-000000000006'), 0, 'B11 …y no crea la línea de la variante archivada');
-- al volver a activar la retención, el refresco retiene las líneas que nunca la tuvieron: v1401 → min(2, libres 2) = 2 ; v1402 → min(4, 5) = 4
update public.store_settings set value = 'true' where key = 'reserve_on_add_to_cart';
select pg_temp.rec('b11e', public.cart_refresh('a7000000-0000-0000-0000-000000000002', null));
select is((pg_temp.g('b11e') ->> 'renewed')::int, 2, 'B11 al reactivar la retención, cart_refresh retiene las 2 líneas');
select is(jsonb_build_object('v1401', pg_temp.held(pg_temp.uc('a7000000-0000-0000-0000-000000000002'), 'f7000000-0000-0000-0014-000000000001'), 'v1402', pg_temp.held(pg_temp.uc('a7000000-0000-0000-0000-000000000002'), 'f7000000-0000-0000-0014-000000000002')),
  '{"v1401":2,"v1402":4}'::jsonb, 'B11 retiene 2 y 4 (lo pedido, sin exceder el stock)');
select pg_temp.rec('b11f', public.cart_get(null, repeat('f1', 32)));
select is(pg_temp.ls(pg_temp.g('b11f'), 'f7000000-0000-0000-0014-000000000001'),
  '{"status":"out_of_stock","blocking":true,"billable_qty":0,"price_notice":null,"unit_price":100,"line_total":0.00}'::jsonb,
  'B11 el invitado que pidió esa unidad ahora la ve agotada (stock 2 − 2 retenidas por el usuario = 0)');
select pg_temp.rec('b11g', public.cart_refresh(null, repeat('f1', 32)));
select is((pg_temp.g('b11g') ->> 'renewed')::int, 0, 'B11 …y su refresco no puede retener nada (0 libres)');
select pg_temp.rec('b11h', public.cart_clear(null, repeat('f1', 32)));

-- ═══ C. Invariante de no sobreventa (S2) y vencimiento (variante 0901 stock 3) ══════════════════
select pg_temp.rec('c1', public.cart_set_item('a7000000-0000-0000-0000-000000000003', null, 'f7000000-0000-0000-0009-000000000001', 3));
select is(pg_temp.oa(pg_temp.g('c1')), '{"outcome":"ok","applied":3,"requested":3}'::jsonb, 'C1 el carrito A retiene las 3 unidades');
select pg_temp.rec('c2', public.cart_set_item(null, repeat('b1', 32), 'f7000000-0000-0000-0009-000000000001', 2));
select is(pg_temp.oa(pg_temp.g('c2')), '{"outcome":"out_of_stock","applied":0,"requested":2}'::jsonb, 'C2 el carrito B pide 2 pero A tiene todo: out_of_stock');
select is((select count(*)::int from public.cart_items where cart_id = pg_temp.gc(repeat('b1', 32))), 0, 'C2 …y B no queda con una línea fantasma');
select is(pg_temp.vheld('f7000000-0000-0000-0009-000000000001'), 3, 'C2 lo retenido (3) no supera el stock (3)');
select pg_temp.rec('c3', public.cart_set_item('a7000000-0000-0000-0000-000000000003', null, 'f7000000-0000-0000-0009-000000000001', 1));
select is(pg_temp.vheld('f7000000-0000-0000-0009-000000000001'), 1, 'C3 A baja a 1: libera 2');
select pg_temp.rec('c3', public.cart_set_item(null, repeat('b1', 32), 'f7000000-0000-0000-0009-000000000001', 2));
select is(pg_temp.oa(pg_temp.g('c3')), '{"outcome":"ok","applied":2,"requested":2}'::jsonb, 'C3 ahora B consigue sus 2');
select is(pg_temp.vheld('f7000000-0000-0000-0009-000000000001'), 3, 'C3 A (1) + B (2) = 3 = stock');
select pg_temp.rec('c3', public.cart_set_item(null, repeat('b2', 32), 'f7000000-0000-0000-0009-000000000001', 1));
select is(pg_temp.oa(pg_temp.g('c3')), '{"outcome":"out_of_stock","applied":0,"requested":1}'::jsonb, 'C3 un 3.er carrito no consigue nada');
select pg_temp.rec('c3b', public.cart_set_item(null, repeat('b1', 32), 'f7000000-0000-0000-0009-000000000001', 5));
select is(pg_temp.oa(pg_temp.g('c3b')), '{"outcome":"adjusted","applied":2,"requested":5}'::jsonb, 'C3 B pide 5: solo puede tener 2 (3 − 1 de A) → adjusted');
select pg_temp.rec('c3c', public.cart_set_item('a7000000-0000-0000-0000-000000000003', null, 'f7000000-0000-0000-0009-000000000001', 3));
select is(pg_temp.oa(pg_temp.g('c3c')), '{"outcome":"adjusted","applied":1,"requested":3}'::jsonb, 'C3 A pide 3: solo puede tener 1 (3 − 2 de B) → adjusted');
select is(pg_temp.vheld('f7000000-0000-0000-0009-000000000001'), 3, 'C3 tras tanto pedir, lo retenido sigue siendo 3 (nunca más que el stock)');
select pg_temp.rec('c3d', public.cart_get(null, repeat('b1', 32)));
select is(pg_temp.lin(pg_temp.g('c3d'), 'f7000000-0000-0000-0009-000000000001') -> 'available', '2'::jsonb, 'C3 disponible para B = 3 − 1 (A) = 2');
-- Vencimiento: la retención de A vence (simulado) → deja de contar aunque su fila siga "active"
update public.stock_reservations set expires_at = now() - interval '1 minute'
 where owner_type = 'cart' and owner_id = pg_temp.uc('a7000000-0000-0000-0000-000000000003') and variant_id = 'f7000000-0000-0000-0009-000000000001' and status = 'active';
select pg_temp.rec('c4', public.cart_get('a7000000-0000-0000-0000-000000000003', null));
select is(jsonb_build_object('state', pg_temp.g('c4') #> '{cart,reservation,state}', 'expires_at', pg_temp.g('c4') #> '{cart,reservation,expires_at}',
    'reserved_qty', pg_temp.lin(pg_temp.g('c4'), 'f7000000-0000-0000-0009-000000000001') -> 'reserved_qty'),
  '{"state":"expired","expires_at":null,"reserved_qty":0}'::jsonb, 'C4 retención vencida: estado "expired", sin vencimiento y 0 retenidas');
select pg_temp.rec('c4b', public.cart_set_item(null, repeat('b2', 32), 'f7000000-0000-0000-0009-000000000001', 1));
select is(pg_temp.oa(pg_temp.g('c4b')), '{"outcome":"ok","applied":1,"requested":1}'::jsonb, 'C4 la unidad que A perdió la toma otro carrito (el vencimiento libera aunque el cron no corra)');
select is(pg_temp.vheld('f7000000-0000-0000-0009-000000000001'), 3, 'C4 retenidas vigentes: B 2 + C 1 = 3 (la vencida de A no cuenta)');
select pg_temp.rec('c4c', public.cart_refresh('a7000000-0000-0000-0000-000000000003', null));
select is((pg_temp.g('c4c') ->> 'renewed')::int, 0, 'C4 A intenta renovar pero no hay libres: renewed = 0');
select is(pg_temp.lin(pg_temp.g('c4c'), 'f7000000-0000-0000-0009-000000000001') ->> 'status', 'out_of_stock', 'C4 …y su línea queda out_of_stock');
select pg_temp.rec('c4d', public.cart_remove_item(null, repeat('b2', 32), 'f7000000-0000-0000-0009-000000000001'));
select pg_temp.rec('c4e', public.cart_refresh('a7000000-0000-0000-0000-000000000003', null));
select is((pg_temp.g('c4e') ->> 'renewed')::int, 1, 'C4 liberada 1 unidad, A renueva su línea: renewed = 1');
select is(pg_temp.held(pg_temp.uc('a7000000-0000-0000-0000-000000000003'), 'f7000000-0000-0000-0009-000000000001'), 1, 'C4 A vuelve a retener 1');
select is((select count(*)::int from public.stock_reservations where owner_id = pg_temp.uc('a7000000-0000-0000-0000-000000000003') and variant_id = 'f7000000-0000-0000-0009-000000000001' and status = 'active'), 1, 'C4 …en una sola fila activa (se reutiliza la vencida)');
select is(pg_temp.vheld('f7000000-0000-0000-0009-000000000001'), 3, 'C4 total retenido otra vez 2 + 1 = 3 ≤ stock');
-- cart_refresh NO alarga una retención vigente (v0902 stock 5, v0903 stock 5)
select pg_temp.rec('c5', public.cart_set_item('a7000000-0000-0000-0000-000000000003', null, 'f7000000-0000-0000-0009-000000000002', 2));
select pg_temp.rec('c5', public.cart_set_item('a7000000-0000-0000-0000-000000000003', null, 'f7000000-0000-0000-0009-000000000003', 1));
update public.stock_reservations set expires_at = now() + interval '3 minutes'
 where owner_id = pg_temp.uc('a7000000-0000-0000-0000-000000000003') and variant_id = 'f7000000-0000-0000-0009-000000000002' and status = 'active';
select pg_temp.rec('c5b', public.cart_refresh('a7000000-0000-0000-0000-000000000003', null));
select is((pg_temp.g('c5b') ->> 'renewed')::int, 0, 'C5 con todas las retenciones vigentes, cart_refresh renueva 0');
select is((select expires_at from public.stock_reservations where owner_id = pg_temp.uc('a7000000-0000-0000-0000-000000000003') and variant_id = 'f7000000-0000-0000-0009-000000000002' and status = 'active'),
  now() + interval '3 minutes', 'C5 …y NO alarga la que vence en 3 min (si no, llamarlo en bucle retendría el stock para siempre)');
-- una línea vencida y otra vigente: solo se renueva la vencida
update public.stock_reservations set expires_at = now() - interval '1 minute'
 where owner_id = pg_temp.uc('a7000000-0000-0000-0000-000000000003') and variant_id = 'f7000000-0000-0000-0009-000000000002' and status = 'active';
update public.stock_reservations set expires_at = now() + interval '4 minutes'
 where owner_id = pg_temp.uc('a7000000-0000-0000-0000-000000000003') and variant_id = 'f7000000-0000-0000-0009-000000000003' and status = 'active';
select pg_temp.rec('c6', public.cart_get('a7000000-0000-0000-0000-000000000003', null));
select is(pg_temp.g('c6') #> '{cart,reservation}', '{"state":"expired","expires_at":null}'::jsonb, 'C6 con una línea vencida el carrito está "expired" (aunque las otras sigan retenidas)');
select pg_temp.rec('c6b', public.cart_refresh('a7000000-0000-0000-0000-000000000003', null));
select is((pg_temp.g('c6b') ->> 'renewed')::int, 1, 'C6 cart_refresh renueva solo la vencida: renewed = 1');
select is((select expires_at from public.stock_reservations where owner_id = pg_temp.uc('a7000000-0000-0000-0000-000000000003') and variant_id = 'f7000000-0000-0000-0009-000000000002' and status = 'active'),
  now() + interval '10 minutes', 'C6 la vencida vuelve a tener 10 min');
select is((select expires_at from public.stock_reservations where owner_id = pg_temp.uc('a7000000-0000-0000-0000-000000000003') and variant_id = 'f7000000-0000-0000-0009-000000000003' and status = 'active'),
  now() + interval '4 minutes', 'C6 la vigente conserva sus 4 min');
select is(pg_temp.g('c6b') #>> '{cart,reservation,state}', 'held', 'C6 el carrito vuelve a "held"');
select is((pg_temp.g('c6b') #>> '{cart,reservation,expires_at}')::timestamptz, now() + interval '4 minutes', 'C6 …y su vencimiento es el del más próximo (4 min)');

-- C10 el cron marca como "expired" una retención vencida: el carrito la ve igual de perdida y cart_refresh abre una fila nueva
update public.stock_reservations set expires_at = now() - interval '1 minute'
 where owner_id = pg_temp.uc('a7000000-0000-0000-0000-000000000003') and variant_id = 'f7000000-0000-0000-0009-000000000003' and status = 'active';
select public.expire_reservations();
select is((select status from public.stock_reservations where owner_id = pg_temp.uc('a7000000-0000-0000-0000-000000000003') and variant_id = 'f7000000-0000-0000-0009-000000000003'), 'expired',
  'C10 expire_reservations marca la retención vencida como "expired"');
select pg_temp.rec('c10', public.cart_refresh('a7000000-0000-0000-0000-000000000003', null));
select is((pg_temp.g('c10') ->> 'renewed')::int, 1, 'C10 cart_refresh re-retiene esa línea: renewed = 1');
select is(jsonb_build_object('rows', (select count(*)::int from public.stock_reservations where owner_id = pg_temp.uc('a7000000-0000-0000-0000-000000000003') and variant_id = 'f7000000-0000-0000-0009-000000000003'),
    'active', (select count(*)::int from public.stock_reservations where owner_id = pg_temp.uc('a7000000-0000-0000-0000-000000000003') and variant_id = 'f7000000-0000-0000-0009-000000000003' and status = 'active')),
  '{"rows":2,"active":1}'::jsonb, 'C10 queda la fila "expired" (historial) y UNA nueva activa');

-- C7 estrés de la invariante: 8 invitados distintos piden 2 unidades de una variante con stock 5 (v1601)
do $do$
declare
  i int;
  v_out text := '';
begin
  for i in 1 .. 8 loop
    v_out := v_out || case when i > 1 then ',' else '' end
      || (public.cart_set_item(null, md5(i::text) || md5((i + 100)::text), 'f7000000-0000-0000-0016-000000000001', 2) ->> 'outcome');
  end loop;
  perform pg_temp.rec('c7', to_jsonb(v_out));
end $do$;
select is(pg_temp.g('c7') #>> '{}', 'ok,ok,adjusted,out_of_stock,out_of_stock,out_of_stock,out_of_stock,out_of_stock',
  'C7 stock 5, 8 carritos piden 2: 2 + 2 + 1 (ajustado) y los otros 5 agotado');
select is(pg_temp.vheld('f7000000-0000-0000-0016-000000000001'), 5, 'C7 lo retenido es exactamente el stock (5): 2 + 2 + 1');
select is((select count(*)::int from public.cart_items where variant_id = 'f7000000-0000-0000-0016-000000000001'), 3, 'C7 solo 3 carritos quedaron con la línea');

-- C8 un compromiso firme de PEDIDO (owner_type = 'order', sin vencimiento) también resta disponibilidad al carrito (v1701 stock 4)
select public.reserve_stock('f7000000-0000-0000-0017-000000000001', 3, 'order', '0a000000-0000-0000-0000-00000000000a');
select pg_temp.rec('c8', public.cart_set_item(null, repeat('b8', 32), 'f7000000-0000-0000-0017-000000000001', 3));
select is(pg_temp.oa(pg_temp.g('c8')), '{"outcome":"adjusted","applied":1,"requested":3}'::jsonb, 'C8 con 3 de 4 comprometidas en un pedido, el carrito pide 3 y solo obtiene 1 (adjusted)');
select is(pg_temp.lin(pg_temp.g('c8'), 'f7000000-0000-0000-0017-000000000001') -> 'available', '1'::jsonb, 'C8 disponible para el carrito = 4 − 3 = 1');
select public.release_stock('order', '0a000000-0000-0000-0000-00000000000a');
select pg_temp.rec('c8b', public.cart_get(null, repeat('b8', 32)));
select is(pg_temp.lin(pg_temp.g('c8b'), 'f7000000-0000-0000-0017-000000000001') -> 'available', '4'::jsonb, 'C8 cancelado el pedido, disponible = 4 (su propia retención de 1 no se resta a sí mismo)');

-- C9 retención PARCIAL (v1801 stock 3): A pierde su retención de 3, B toma 2, A renueva y solo consigue 1; luego B se va
select pg_temp.rec('c9', public.cart_set_item(null, repeat('c3', 32), 'f7000000-0000-0000-0018-000000000001', 3));
update public.stock_reservations set expires_at = now() - interval '1 minute'
 where owner_id = pg_temp.gc(repeat('c3', 32)) and variant_id = 'f7000000-0000-0000-0018-000000000001' and status = 'active';
select pg_temp.rec('c9', public.cart_set_item(null, repeat('c4', 32), 'f7000000-0000-0000-0018-000000000001', 2));
select pg_temp.rec('c9a', public.cart_refresh(null, repeat('c3', 32)));
select is(jsonb_build_object('renewed', pg_temp.g('c9a') -> 'renewed', 'status', pg_temp.lin(pg_temp.g('c9a'), 'f7000000-0000-0000-0018-000000000001') -> 'status',
    'reserved_qty', pg_temp.lin(pg_temp.g('c9a'), 'f7000000-0000-0000-0018-000000000001') -> 'reserved_qty'),
  '{"renewed":1,"status":"low_stock","reserved_qty":1}'::jsonb, 'C9 A renueva: solo hay 1 libre (3 − 2 de B) → retiene 1 y su línea (3) queda low_stock');
select pg_temp.rec('c9', public.cart_remove_item(null, repeat('c4', 32), 'f7000000-0000-0000-0018-000000000001'));
select pg_temp.rec('c9b', public.cart_get(null, repeat('c3', 32)));
select isnt(pg_temp.g('c9b') #>> '{cart,reservation,state}', 'held',
  'C9 POSIBLE BUG: con la línea retenida a medias (1 de 3 unidades; cart_refresh no completa una retención vigente) el carrito NO debería declararse "held"');

-- ═══ D. Precios con garantía (S-04). Usuario 04; producto 06 a 50.50; línea de 2 unidades ═══════════════
select pg_temp.rec('d0', public.cart_set_item('a7000000-0000-0000-0000-000000000004', null, 'f7000000-0000-0000-0006-000000000001', 2));
select is(pg_temp.ls(pg_temp.g('d0'), 'f7000000-0000-0000-0006-000000000001'),
  '{"status":"ok","blocking":false,"billable_qty":2,"price_notice":null,"unit_price":50.50,"line_total":101.00}'::jsonb,
  'D0 entrada a 50.50: 2 × 50.50 = 101.00, sin aviso');
select is((select unit_price_at_add from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000004')), 50.50, 'D0 precio de entrada = 50.50');
-- D1 sube a 60 dentro de la garantía → se respeta 50.50 (el menor), aviso "guaranteed", no bloquea; 2 × 50.50 = 101.00
update public.product_prices set amount = 60 where product_id = 'b7000000-0000-0000-0000-000000000006';
select pg_temp.rec('d1', public.cart_get('a7000000-0000-0000-0000-000000000004', null));
select is(pg_temp.ls(pg_temp.g('d1'), 'f7000000-0000-0000-0006-000000000001'),
  '{"status":"price_changed","blocking":false,"billable_qty":2,"price_notice":"guaranteed","unit_price":50.50,"line_total":101.00}'::jsonb,
  'D1 sube a 60 dentro de la garantía: se cobra 50.50, aviso "guaranteed", no bloquea');
select is(pg_temp.tc(pg_temp.g('d1')), '{"subtotal":101.00,"can_checkout":true}'::jsonb, 'D1 subtotal 101.00 y se puede pagar');
select is(pg_temp.lin(pg_temp.g('d1'), 'f7000000-0000-0000-0006-000000000001') -> 'current_price', '60'::jsonb, 'D1 el precio vigente informado es 60');
-- D2 baja a 40 dentro de la garantía → gana el menor (40), aviso "dropped"; 2 × 40 = 80.00
update public.product_prices set amount = 40 where product_id = 'b7000000-0000-0000-0000-000000000006';
select pg_temp.rec('d2', public.cart_get('a7000000-0000-0000-0000-000000000004', null));
select is(pg_temp.ls(pg_temp.g('d2'), 'f7000000-0000-0000-0006-000000000001'),
  '{"status":"price_changed","blocking":false,"billable_qty":2,"price_notice":"dropped","unit_price":40,"line_total":80.00}'::jsonb,
  'D2 baja a 40 dentro de la garantía: se cobra 40, aviso "dropped"');
select is(pg_temp.tc(pg_temp.g('d2')), '{"subtotal":80.00,"can_checkout":true}'::jsonb, 'D2 subtotal 80.00 y se puede pagar');
-- D3 vuelve al precio de entrada → sin aviso
update public.product_prices set amount = 50.50 where product_id = 'b7000000-0000-0000-0000-000000000006';
select pg_temp.rec('d3', public.cart_get('a7000000-0000-0000-0000-000000000004', null));
select is(pg_temp.ls(pg_temp.g('d3'), 'f7000000-0000-0000-0006-000000000001'),
  '{"status":"ok","blocking":false,"billable_qty":2,"price_notice":null,"unit_price":50.50,"line_total":101.00}'::jsonb,
  'D3 vuelve a 50.50: sin aviso, estado ok');
-- D4 garantía vencida + sube a 60 → se cobra el vigente (60), "expired_raised", BLOQUEA; 2 × 60 = 120.00
update public.cart_items set price_locked_until = now() - interval '1 minute' where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000004');
update public.product_prices set amount = 60 where product_id = 'b7000000-0000-0000-0000-000000000006';
select pg_temp.rec('d4', public.cart_get('a7000000-0000-0000-0000-000000000004', null));
select is(pg_temp.ls(pg_temp.g('d4'), 'f7000000-0000-0000-0006-000000000001'),
  '{"status":"price_changed","blocking":true,"billable_qty":2,"price_notice":"expired_raised","unit_price":60,"line_total":120.00}'::jsonb,
  'D4 garantía vencida y el precio sube a 60: se cobra 60, "expired_raised", bloquea');
select is(pg_temp.tc(pg_temp.g('d4')), '{"subtotal":120.00,"can_checkout":false}'::jsonb, 'D4 subtotal 120.00 y NO se puede pagar hasta aceptar el precio');
-- D5 vencida + baja a 40 → se cobra 40, "expired_dropped", no bloquea; 2 × 40 = 80.00
update public.product_prices set amount = 40 where product_id = 'b7000000-0000-0000-0000-000000000006';
select pg_temp.rec('d5', public.cart_get('a7000000-0000-0000-0000-000000000004', null));
select is(pg_temp.ls(pg_temp.g('d5'), 'f7000000-0000-0000-0006-000000000001'),
  '{"status":"price_changed","blocking":false,"billable_qty":2,"price_notice":"expired_dropped","unit_price":40,"line_total":80.00}'::jsonb,
  'D5 vencida y baja a 40: se cobra 40, "expired_dropped", no bloquea');
select is(pg_temp.tc(pg_temp.g('d5')), '{"subtotal":80.00,"can_checkout":true}'::jsonb, 'D5 subtotal 80.00 y se puede pagar');
-- D6 vencida pero el precio es igual al de entrada → sin aviso
update public.product_prices set amount = 50.50 where product_id = 'b7000000-0000-0000-0000-000000000006';
select pg_temp.rec('d6', public.cart_get('a7000000-0000-0000-0000-000000000004', null));
select is(pg_temp.ls(pg_temp.g('d6'), 'f7000000-0000-0000-0006-000000000001'),
  '{"status":"ok","blocking":false,"billable_qty":2,"price_notice":null,"unit_price":50.50,"line_total":101.00}'::jsonb,
  'D6 vencida pero sin cambio de precio: sin aviso');
-- D7 borde: la garantía termina EN el instante (price_locked_until = now()) → ya no rige (se exige > now())
update public.cart_items set price_locked_until = now() where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000004');
update public.product_prices set amount = 60 where product_id = 'b7000000-0000-0000-0000-000000000006';
select pg_temp.rec('d7', public.cart_get('a7000000-0000-0000-0000-000000000004', null));
select is(pg_temp.lin(pg_temp.g('d7'), 'f7000000-0000-0000-0006-000000000001') ->> 'price_notice', 'expired_raised', 'D7 con price_locked_until = now() la garantía ya venció (borde exclusivo)');
-- D8 aceptar el precio: el vigente (60) pasa a ser el de entrada y se renueva la garantía
select pg_temp.rec('d8', public.cart_accept_prices('a7000000-0000-0000-0000-000000000004', null, 'f7000000-0000-0000-0006-000000000001'));
select is(pg_temp.ls(pg_temp.g('d8'), 'f7000000-0000-0000-0006-000000000001'),
  '{"status":"ok","blocking":false,"billable_qty":2,"price_notice":null,"unit_price":60,"line_total":120.00}'::jsonb,
  'D8 tras aceptar: se cobra 60 sin aviso (2 × 60 = 120.00)');
select is((select unit_price_at_add from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000004')), 60::numeric, 'D8 el precio de entrada ahora es 60');
select is((select price_locked_until from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000004')), now() + interval '7 days', 'D8 …y la garantía se renovó: now() + 7 días');
select is(pg_temp.tc(pg_temp.g('d8')), '{"subtotal":120.00,"can_checkout":true}'::jsonb, 'D8 ya se puede pagar');
-- D9 cambiar la cantidad NO toca ni el precio de entrada ni la garantía (aunque el vigente sea otro): entrada 60, garantía en 2 días, vigente 45
update public.cart_items set price_locked_until = now() + interval '2 days' where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000004');
update public.product_prices set amount = 45 where product_id = 'b7000000-0000-0000-0000-000000000006';
select pg_temp.rec('d9', public.cart_set_item('a7000000-0000-0000-0000-000000000004', null, 'f7000000-0000-0000-0006-000000000001', 5));
select is(pg_temp.oa(pg_temp.g('d9')), '{"outcome":"ok","applied":5,"requested":5}'::jsonb, 'D9 cambiar la cantidad a 5: ok');
select is((select unit_price_at_add from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000004')), 60::numeric, 'D9 el precio de entrada NO se renovó (sigue en 60)');
select is((select price_locked_until from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000004')), now() + interval '2 days', 'D9 …ni la garantía (sigue en 2 días)');
select is(pg_temp.ls(pg_temp.g('d9'), 'f7000000-0000-0000-0006-000000000001'),
  '{"status":"price_changed","blocking":false,"billable_qty":5,"price_notice":"dropped","unit_price":45,"line_total":225.00}'::jsonb,
  'D9 se cobra el menor entre entrada (60) y vigente (45): 5 × 45 = 225.00');
-- D10 quitar y volver a agregar («Deshacer», 15 min): con la garantía vigente la línea RECUPERA su precio de entrada (60) y su garantía
-- (+2 días) y su antigüedad; el precio efectivo sigue siendo el menor (45). Sin garantía vigente o pasados 15 min, es una línea nueva.
create temp table d10_before as select unit_price_at_add as p, price_locked_until as l, added_at as a
  from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000004');
select pg_temp.rec('d10', public.cart_set_item('a7000000-0000-0000-0000-000000000004', null, 'f7000000-0000-0000-0006-000000000001', 0));
select is((select count(*)::int from public.cart_removed_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000004')), 1, 'D10 al quitar, el servidor recuerda la línea (precio y garantía)');
select pg_temp.rec('d10', public.cart_set_item('a7000000-0000-0000-0000-000000000004', null, 'f7000000-0000-0000-0006-000000000001', 3));
select is((select unit_price_at_add from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000004')), 60::numeric, 'D10 quitar y re-agregar dentro de 15 min con garantía vigente: recupera el precio de entrada (60), no el vigente (45)');
select is((select price_locked_until from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000004')), (select l from d10_before), 'D10 …y su garantía de antes (+2 días): no se alarga ni se reinicia');
select is((select added_at from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000004')), (select a from d10_before), 'D10 …y su antigüedad');
select is(pg_temp.ls(pg_temp.g('d10'), 'f7000000-0000-0000-0006-000000000001'),
  '{"status":"price_changed","blocking":false,"billable_qty":3,"price_notice":"dropped","unit_price":45,"line_total":135.00}'::jsonb, 'D10 se cobra el menor (45): 3 × 45 = 135.00, con aviso de que bajó');
select is((select count(*)::int from public.cart_removed_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000004')), 0, 'D10 recuperada la línea, el recuerdo se consume');
-- garantía ya vencida al quitarla: NO se recupera; es una línea nueva con el precio vigente y garantía completa
select pg_temp.rec('d10b', public.cart_set_item('a7000000-0000-0000-0000-000000000004', null, 'f7000000-0000-0000-0006-000000000001', 0));
update public.cart_removed_items set unit_price_at_add = 99, price_locked_until = now() - interval '1 minute' where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000004');
select pg_temp.rec('d10b', public.cart_set_item('a7000000-0000-0000-0000-000000000004', null, 'f7000000-0000-0000-0006-000000000001', 3));
select is((select unit_price_at_add::text || '|' || (price_locked_until = now() + interval '7 days')::text from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000004')), '45|true',
  'D10 si la garantía recordada ya venció (99 vencido), NO se recupera: línea nueva a 45 con garantía de 7 días');
-- recuerdo de hace más de 15 min: tampoco se recupera
select pg_temp.rec('d10c', public.cart_set_item('a7000000-0000-0000-0000-000000000004', null, 'f7000000-0000-0000-0006-000000000001', 0));
update public.cart_removed_items set unit_price_at_add = 99, removed_at = now() - interval '16 minutes' where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000004');
select pg_temp.rec('d10c', public.cart_set_item('a7000000-0000-0000-0000-000000000004', null, 'f7000000-0000-0000-0006-000000000001', 3));
select is((select unit_price_at_add from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000004')), 45::numeric, 'D10 pasados 15 minutos (16) el recuerdo no vale: línea nueva a 45, no a 99');
select is((select count(*)::int from public.cart_removed_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000004')), 0, 'D10 …y el recuerdo viejo se descarta');
update public.product_prices set amount = 50.50 where product_id = 'b7000000-0000-0000-0000-000000000006';

-- D11 redondeo y aritmética exacta (usuario 05): 3 × 33.33 = 99.99 ; 3 × 0.10 = 0.30 (en coma flotante daría 0.30000000000000004)
select pg_temp.rec('d11', public.cart_set_item('a7000000-0000-0000-0000-000000000005', null, 'f7000000-0000-0000-0007-000000000001', 3));
select pg_temp.rec('d11', public.cart_set_item('a7000000-0000-0000-0000-000000000005', null, 'f7000000-0000-0000-0008-000000000001', 3));
select is(pg_temp.lin(pg_temp.g('d11'), 'f7000000-0000-0000-0007-000000000001') ->> 'line_total', '99.99', 'D11 3 × 33.33 = 99.99');
select is(pg_temp.lin(pg_temp.g('d11'), 'f7000000-0000-0000-0008-000000000001') ->> 'line_total', '0.30', 'D11 3 × 0.10 = 0.30 exacto (sin error de coma flotante)');
select is(pg_temp.g('d11') #>> '{cart,totals,subtotal}', '100.29', 'D11 subtotal 99.99 + 0.30 = 100.29');
select is(pg_temp.g('d11') #>> '{cart,totals,item_count}', '6', 'D11 3 + 3 = 6 unidades');
-- D12 aceptar precios: una sola variante o todas (venció la garantía y subieron: 33.33 → 40 ; 0.10 → 0.20)
update public.product_prices set amount = 40 where product_id = 'b7000000-0000-0000-0000-000000000007';
update public.product_prices set amount = 0.20 where product_id = 'b7000000-0000-0000-0000-000000000008';
update public.cart_items set price_locked_until = now() - interval '1 minute' where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000005');
select pg_temp.rec('d12a', public.cart_get('a7000000-0000-0000-0000-000000000005', null));
select is(pg_temp.ls(pg_temp.g('d12a'), 'f7000000-0000-0000-0007-000000000001'),
  '{"status":"price_changed","blocking":true,"billable_qty":3,"price_notice":"expired_raised","unit_price":40,"line_total":120.00}'::jsonb,
  'D12 vencida y sube 33.33 → 40: 3 × 40 = 120.00, bloquea');
select is(pg_temp.tc(pg_temp.g('d12a')), '{"subtotal":120.60,"can_checkout":false}'::jsonb, 'D12 subtotal 120.00 + 3 × 0.20 (0.60) = 120.60; no se puede pagar');
select pg_temp.rec('d12b', public.cart_accept_prices('a7000000-0000-0000-0000-000000000005', null, 'f7000000-0000-0000-0007-000000000001'));
select is(jsonb_build_object('v0701', pg_temp.lin(pg_temp.g('d12b'), 'f7000000-0000-0000-0007-000000000001') -> 'price_notice', 'v0801', pg_temp.lin(pg_temp.g('d12b'), 'f7000000-0000-0000-0008-000000000001') -> 'price_notice'),
  '{"v0701":null,"v0801":"expired_raised"}'::jsonb, 'D12 aceptar UNA variante solo cambia esa: la otra sigue con su aviso');
select is(pg_temp.tc(pg_temp.g('d12b')), '{"subtotal":120.60,"can_checkout":false}'::jsonb, 'D12 sigue sin poder pagar (queda una bloqueante)');
select pg_temp.rec('d12c', public.cart_accept_prices('a7000000-0000-0000-0000-000000000005', null, null));
select is(pg_temp.tc(pg_temp.g('d12c')), '{"subtotal":120.60,"can_checkout":true}'::jsonb, 'D12 aceptar todas: 120.60 y ya se puede pagar');
select is((select unit_price_at_add from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000005') and variant_id = 'f7000000-0000-0000-0008-000000000001'), 0.20, 'D12 la entrada de la 2.ª pasó a 0.20');
select pg_temp.rec('d12d', public.cart_accept_prices('a7000000-0000-0000-0000-000000000005', null, '99999999-9999-9999-9999-999999999999'));
select is(pg_temp.tc(pg_temp.g('d12d')), '{"subtotal":120.60,"can_checkout":true}'::jsonb, 'D12 aceptar una variante que no está en el carrito no cambia nada');

-- D13 price_guarantee_days = 0: la garantía vence en el acto, rige siempre el precio vigente (usuario 11; producto 06 a 50.50)
update public.store_settings set value = '0' where key = 'price_guarantee_days';
select pg_temp.rec('d13a', public.cart_set_item('a7000000-0000-0000-0000-000000000011', null, 'f7000000-0000-0000-0006-000000000001', 1));
select is((select price_locked_until from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000011')), now(), 'D13 con 0 días la garantía termina en now()');
select is(pg_temp.g('d13a') #>> '{cart,guarantee_days}', '0', 'D13 el snapshot informa guarantee_days = 0');
update public.product_prices set amount = 60 where product_id = 'b7000000-0000-0000-0000-000000000006';
select pg_temp.rec('d13b', public.cart_get('a7000000-0000-0000-0000-000000000011', null));
select is(pg_temp.ls(pg_temp.g('d13b'), 'f7000000-0000-0000-0006-000000000001'),
  '{"status":"price_changed","blocking":true,"billable_qty":1,"price_notice":"expired_raised","unit_price":60,"line_total":60.00}'::jsonb,
  'D13 sin garantía, la subida (50.50 → 60) se cobra y bloquea hasta aceptarla');
update public.product_prices set amount = 40 where product_id = 'b7000000-0000-0000-0000-000000000006';
select pg_temp.rec('d13c', public.cart_get('a7000000-0000-0000-0000-000000000011', null));
select is(pg_temp.ls(pg_temp.g('d13c'), 'f7000000-0000-0000-0006-000000000001'),
  '{"status":"price_changed","blocking":false,"billable_qty":1,"price_notice":"expired_dropped","unit_price":40,"line_total":40.00}'::jsonb,
  'D13 sin garantía, la bajada (50.50 → 40) se cobra');
update public.store_settings set value = '7' where key = 'price_guarantee_days';
update public.product_prices set amount = 50.50 where product_id = 'b7000000-0000-0000-0000-000000000006';

-- D14 datos descriptivos e imagen de la línea (producto 06 en el carrito del usuario 04)
select pg_temp.rec('d14', public.cart_get('a7000000-0000-0000-0000-000000000004', null));
select is(jsonb_build_object('name', pg_temp.lin(pg_temp.g('d14'), 'f7000000-0000-0000-0006-000000000001') -> 'name', 'slug', pg_temp.lin(pg_temp.g('d14'), 'f7000000-0000-0000-0006-000000000001') -> 'slug',
    'sku', pg_temp.lin(pg_temp.g('d14'), 'f7000000-0000-0000-0006-000000000001') -> 'sku', 'color_name', pg_temp.lin(pg_temp.g('d14'), 'f7000000-0000-0000-0006-000000000001') -> 'color_name',
    'size_label', pg_temp.lin(pg_temp.g('d14'), 'f7000000-0000-0000-0006-000000000001') -> 'size_label'),
  '{"name":"Producto S7 06","slug":"s7-06","sku":"S7-06-UNICO-T1","color_name":"Único","size_label":"T1"}'::jsonb, 'D14 la línea trae nombre, slug, SKU, color y talla');
insert into public.product_images (product_id, color_id, path, sort_order) values
  ('b7000000-0000-0000-0000-000000000006', null, 'products/b7000000-0000-0000-0000-000000000006/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg', 0),
  ('b7000000-0000-0000-0000-000000000006', 'd7000000-0000-0000-0000-000000000006', 'products/b7000000-0000-0000-0000-000000000006/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg', 5);
select pg_temp.rec('d14', public.cart_get('a7000000-0000-0000-0000-000000000004', null));
select is(pg_temp.lin(pg_temp.g('d14'), 'f7000000-0000-0000-0006-000000000001') ->> 'image_path', 'products/b7000000-0000-0000-0000-000000000006/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg',
  'D14 la imagen del COLOR de la variante gana sobre la genérica aunque tenga mayor sort_order');
update public.product_images set archived_at = now() where path like '%bbbbbbbb%';
select pg_temp.rec('d14', public.cart_get('a7000000-0000-0000-0000-000000000004', null));
select is(pg_temp.lin(pg_temp.g('d14'), 'f7000000-0000-0000-0006-000000000001') ->> 'image_path', 'products/b7000000-0000-0000-0000-000000000006/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg',
  'D14 archivada la del color, cae a la imagen genérica');
update public.product_images set archived_at = now() where path like '%aaaaaaaa%';
select pg_temp.rec('d14', public.cart_get('a7000000-0000-0000-0000-000000000004', null));
select is(pg_temp.lin(pg_temp.g('d14'), 'f7000000-0000-0000-0006-000000000001') -> 'image_path', 'null'::jsonb, 'D14 sin imágenes activas, image_path es null');

-- ═══ E. Estados de línea (invitado te1; productos 04 y 05, precio 100.00) ══════════════════════════
select pg_temp.rec('e0', public.cart_set_item(null, repeat('e1', 32), 'f7000000-0000-0000-0004-000000000004', 2));
select pg_temp.rec('e0', public.cart_set_item(null, repeat('e1', 32), 'f7000000-0000-0000-0004-000000000001', 8));
select pg_temp.rec('e0', public.cart_set_item(null, repeat('e1', 32), 'f7000000-0000-0000-0004-000000000002', 4));
select pg_temp.rec('e0', public.cart_set_item(null, repeat('e1', 32), 'f7000000-0000-0000-0004-000000000003', 1));
select pg_temp.rec('e0', public.cart_set_item(null, repeat('e1', 32), 'f7000000-0000-0000-0005-000000000001', 2));
-- Baja el stock con el libro mayor (apply_stock_change): v0401 10 → 5 ; v0402 10 → 0. Archiva la variante v0403 y despublica el producto 05.
select public.apply_stock_change('f7000000-0000-0000-0004-000000000001', -5, 'adjust', 'S7 prueba');
select public.apply_stock_change('f7000000-0000-0000-0004-000000000002', -10, 'sale', 'S7 prueba');
update public.product_variants set archived_at = now() where id = 'f7000000-0000-0000-0004-000000000003';
update public.products set status = 'draft' where id = 'b7000000-0000-0000-0000-000000000005';
select pg_temp.rec('e1', public.cart_get(null, repeat('e1', 32)));
-- v0404: libre 10, pide 2 → ok, 2 × 100.00 = 200.00
select is(pg_temp.ls(pg_temp.g('e1'), 'f7000000-0000-0000-0004-000000000004'),
  '{"status":"ok","blocking":false,"billable_qty":2,"price_notice":null,"unit_price":100,"line_total":200.00}'::jsonb, 'E1 línea con stock de sobra: ok');
-- v0401: stock 5, pide 8 → low_stock; facturable = libres = 5 → 5 × 100.00 = 500.00
select is(pg_temp.ls(pg_temp.g('e1'), 'f7000000-0000-0000-0004-000000000001'),
  '{"status":"low_stock","blocking":true,"billable_qty":5,"price_notice":null,"unit_price":100,"line_total":500.00}'::jsonb,
  'E1 pide 8 con stock 5: low_stock, facturable 5, bloquea');
select is(pg_temp.ls(pg_temp.g('e1'), 'f7000000-0000-0000-0004-000000000002'),
  '{"status":"out_of_stock","blocking":true,"billable_qty":0,"price_notice":null,"unit_price":100,"line_total":0.00}'::jsonb,
  'E1 stock 0: out_of_stock, facturable 0, total 0.00, bloquea');
select is(pg_temp.ls(pg_temp.g('e1'), 'f7000000-0000-0000-0004-000000000003'),
  '{"status":"unavailable","blocking":true,"billable_qty":0,"price_notice":null,"unit_price":100,"line_total":0.00}'::jsonb,
  'E1 variante archivada: unavailable, facturable 0, bloquea');
select is(pg_temp.ls(pg_temp.g('e1'), 'f7000000-0000-0000-0005-000000000001'),
  '{"status":"unavailable","blocking":true,"billable_qty":0,"price_notice":null,"unit_price":100,"line_total":0.00}'::jsonb,
  'E1 producto despublicado (borrador): unavailable');
select is(jsonb_build_object('ok', pg_temp.lin(pg_temp.g('e1'), 'f7000000-0000-0000-0004-000000000004') -> 'available', 'low', pg_temp.lin(pg_temp.g('e1'), 'f7000000-0000-0000-0004-000000000001') -> 'available',
    'out', pg_temp.lin(pg_temp.g('e1'), 'f7000000-0000-0000-0004-000000000002') -> 'available'),
  '{"ok":10,"low":5,"out":0}'::jsonb, 'E1 "available" de cada línea: 10, 5 y 0');
-- subtotal = 200.00 + 500.00 (lo no comprable no suma) = 700.00 ; unidades = 2 + 8 + 4 + 1 + 2 = 17 ; 5 líneas
select is(pg_temp.g('e1') #> '{cart,totals}', '{"subtotal":700.00,"item_count":17,"line_count":5,"shipping":null,"discount":null,"total":700.00}'::jsonb,
  'E1 subtotal 700.00 (solo lo comprable); item_count 17 cuenta todas las unidades; 5 líneas');
select is((pg_temp.g('e1') #>> '{cart,can_checkout}')::boolean, false, 'E1 con líneas bloqueantes no se puede pagar');
select is((select status from public.stock_reservations where owner_id = pg_temp.gc(repeat('e1', 32)) and variant_id = 'f7000000-0000-0000-0004-000000000003'), 'released', 'E1 archivar la variante liberó su retención');
select is((select status from public.stock_reservations where owner_id = pg_temp.gc(repeat('e1', 32)) and variant_id = 'f7000000-0000-0000-0005-000000000001'), 'released', 'E1 despublicar el producto liberó su retención');
-- prioridad de estado: low_stock gana sobre price_changed (sube a 120 dentro de la garantía → se cobra 100)
update public.product_prices set amount = 120 where product_id = 'b7000000-0000-0000-0000-000000000004';
select pg_temp.rec('e2', public.cart_get(null, repeat('e1', 32)));
select is(pg_temp.ls(pg_temp.g('e2'), 'f7000000-0000-0000-0004-000000000001'),
  '{"status":"low_stock","blocking":true,"billable_qty":5,"price_notice":"guaranteed","unit_price":100,"line_total":500.00}'::jsonb,
  'E2 prioridad: low_stock sigue ganando a price_changed (aviso "guaranteed" y se cobra 100)');
select is(pg_temp.ls(pg_temp.g('e2'), 'f7000000-0000-0000-0004-000000000004'),
  '{"status":"price_changed","blocking":false,"billable_qty":2,"price_notice":"guaranteed","unit_price":100,"line_total":200.00}'::jsonb,
  'E2 la línea sana pasa a price_changed (no bloquea)');
-- aceptar precios con la garantía VIGENTE no hace nada (aceptar el vigente le haría perder el precio asegurado, S-04)
select pg_temp.rec('e2b', public.cart_accept_prices(null, repeat('e1', 32), null));
select is(jsonb_build_object('v0404', (select unit_price_at_add from public.cart_items where cart_id = pg_temp.gc(repeat('e1', 32)) and variant_id = 'f7000000-0000-0000-0004-000000000004'), 'v0403', (select unit_price_at_add from public.cart_items where cart_id = pg_temp.gc(repeat('e1', 32)) and variant_id = 'f7000000-0000-0000-0004-000000000003'), 'v0501', (select unit_price_at_add from public.cart_items where cart_id = pg_temp.gc(repeat('e1', 32)) and variant_id = 'f7000000-0000-0000-0005-000000000001')),
  '{"v0404":100,"v0403":100,"v0501":100}'::jsonb, 'E2 con la garantía vigente aceptar NO cambia nada: v0404 sigue en 100 (el precio asegurado)');
-- vence la garantía de todas las líneas; el cliente vio 119 pero el vigente ya es 120 → no se acepta nada
update public.cart_items set price_locked_until = now() - interval '1 minute' where cart_id = pg_temp.gc(repeat('e1', 32));
select pg_temp.rec('e2c', public.cart_accept_prices(null, repeat('e1', 32), 'f7000000-0000-0000-0004-000000000004', 119));
select is((select unit_price_at_add from public.cart_items where cart_id = pg_temp.gc(repeat('e1', 32)) and variant_id = 'f7000000-0000-0000-0004-000000000004'), 100::numeric, 'E2 si el precio vigente (120) ya no es el que la persona vio (119), no se acepta nada');
-- con el precio correcto sí, y lo no disponible (variante archivada, producto en borrador) se omite
select pg_temp.rec('e2d', public.cart_accept_prices(null, repeat('e1', 32), null));
select is(jsonb_build_object('v0404', (select unit_price_at_add from public.cart_items where cart_id = pg_temp.gc(repeat('e1', 32)) and variant_id = 'f7000000-0000-0000-0004-000000000004'), 'v0403', (select unit_price_at_add from public.cart_items where cart_id = pg_temp.gc(repeat('e1', 32)) and variant_id = 'f7000000-0000-0000-0004-000000000003'), 'v0501', (select unit_price_at_add from public.cart_items where cart_id = pg_temp.gc(repeat('e1', 32)) and variant_id = 'f7000000-0000-0000-0005-000000000001')),
  '{"v0404":120,"v0403":100,"v0501":100}'::jsonb, 'E2 vencida la garantía, aceptar sube v0404 a 120 y NO toca la variante archivada ni el producto en borrador');
select is((select price_locked_until from public.cart_items where cart_id = pg_temp.gc(repeat('e1', 32)) and variant_id = 'f7000000-0000-0000-0004-000000000004'), now() + interval '7 days', 'E2 …y renueva su garantía (7 días)');
update public.product_prices set amount = 100 where product_id = 'b7000000-0000-0000-0000-000000000004';
-- agregar a una línea no comprable no la modifica
select pg_temp.rec('e3', public.cart_set_item(null, repeat('e1', 32), 'f7000000-0000-0000-0004-000000000003', 3));
select is(pg_temp.oa(pg_temp.g('e3')), '{"outcome":"unavailable","applied":0,"requested":3}'::jsonb, 'E3 subir la cantidad de una línea archivada → unavailable');
select is((select qty from public.cart_items where cart_id = pg_temp.gc(repeat('e1', 32)) and variant_id = 'f7000000-0000-0000-0004-000000000003'), 1, 'E3 …y la línea conserva su cantidad (1)');
-- el cliente puede quitar lo no comprable y resolver el stock bajo
select pg_temp.rec('e4', public.cart_remove_item(null, repeat('e1', 32), 'f7000000-0000-0000-0004-000000000002'));
select pg_temp.rec('e4', public.cart_remove_item(null, repeat('e1', 32), 'f7000000-0000-0000-0004-000000000003'));
select pg_temp.rec('e4', public.cart_remove_item(null, repeat('e1', 32), 'f7000000-0000-0000-0005-000000000001'));
select is(pg_temp.oa(pg_temp.g('e4')), '{"outcome":"removed","applied":0,"requested":0}'::jsonb, 'E4 quitar líneas agotadas/archivadas/despublicadas se permite');
select pg_temp.rec('e4', public.cart_set_item(null, repeat('e1', 32), 'f7000000-0000-0000-0004-000000000001', 5));
select is(pg_temp.oa(pg_temp.g('e4')), '{"outcome":"ok","applied":5,"requested":5}'::jsonb, 'E4 bajar v0401 a 5 (= stock): ok');
select is(pg_temp.g('e4') #> '{cart,totals}', '{"subtotal":700.00,"item_count":7,"line_count":2,"shipping":null,"discount":null,"total":700.00}'::jsonb,
  'E4 2 líneas: 2 × 100.00 + 5 × 100.00 = 700.00; 7 unidades');
select is((pg_temp.g('e4') #>> '{cart,can_checkout}')::boolean, true, 'E4 sin líneas bloqueantes: can_checkout = true');

-- ═══ F. Fusión del carrito de invitado en el del usuario ═════════════════════════════════════════
-- F1 usuario SIN carrito + invitado con 2 líneas (v1001 × 2, v1002 × 1; 50.00)
select pg_temp.rec('f1g', public.cart_set_item(null, repeat('11', 32), 'f7000000-0000-0000-0010-000000000001', 2));
select pg_temp.rec('f1g', public.cart_set_item(null, repeat('11', 32), 'f7000000-0000-0000-0010-000000000002', 1));
select is(jsonb_build_object('v1001', pg_temp.held(pg_temp.gc(repeat('11', 32)), 'f7000000-0000-0000-0010-000000000001'), 'v1002', pg_temp.held(pg_temp.gc(repeat('11', 32)), 'f7000000-0000-0000-0010-000000000002')),
  '{"v1001":2,"v1002":1}'::jsonb, 'F1 antes de fusionar, el invitado retiene 2 y 1');
select pg_temp.rec('f1', public.merge_guest_cart('a7000000-0000-0000-0000-000000000007', repeat('11', 32)));
select is(pg_temp.ms(pg_temp.g('f1')), '{"token_state":"merged","merged":true,"merged_lines":2,"adjusted_lines":0,"skipped_lines":0}'::jsonb,
  'F1 se fusionan 2 líneas, sin ajustes ni omitidas');
select is(pg_temp.g('f1') #> '{cart,totals}', '{"subtotal":150.00,"item_count":3,"line_count":2,"shipping":null,"discount":null,"total":150.00}'::jsonb,
  'F1 el usuario queda con 2 líneas y 3 × 50.00 = 150.00');
select is((select count(*)::int from public.carts where profile_id = 'a7000000-0000-0000-0000-000000000007' and status = 'active'), 1, 'F1 fusionar creó el carrito del usuario (uno solo)');
select is((select status || '/' || (merged_into = pg_temp.uc('a7000000-0000-0000-0000-000000000007'))::text from public.carts where token_hash = repeat('11', 32)), 'merged/true',
  'F1 el carrito de invitado queda "merged" apuntando al del usuario');
select is(pg_temp.heldall(pg_temp.gc(repeat('11', 32))), 0, 'F1 el invitado ya no retiene nada');
select is(jsonb_build_object('v1001', pg_temp.held(pg_temp.uc('a7000000-0000-0000-0000-000000000007'), 'f7000000-0000-0000-0010-000000000001'), 'v1002', pg_temp.held(pg_temp.uc('a7000000-0000-0000-0000-000000000007'), 'f7000000-0000-0000-0010-000000000002')),
  '{"v1001":2,"v1002":1}'::jsonb, 'F1 el usuario retiene 2 y 1');
select is(jsonb_build_object('v1001', pg_temp.vheld('f7000000-0000-0000-0010-000000000001'), 'v1002', pg_temp.vheld('f7000000-0000-0000-0010-000000000002')), '{"v1001":2,"v1002":1}'::jsonb,
  'F1 la suma de retenciones por variante es 2 y 1 (no se retuvo doble)');
-- F1b idempotencia: la 2.ª llamada no cambia nada
select pg_temp.rec('f1res', (select coalesce(jsonb_agg(to_jsonb(r) order by r.variant_id, r.owner_id), '[]'::jsonb)
  from (select variant_id, owner_id, qty, status, expires_at from public.stock_reservations
         where owner_id in (pg_temp.gc(repeat('11', 32)), pg_temp.uc('a7000000-0000-0000-0000-000000000007'))) r));
select pg_temp.rec('f1b', public.merge_guest_cart('a7000000-0000-0000-0000-000000000007', repeat('11', 32)));
select is(jsonb_build_object('token_state', pg_temp.g('f1b') -> 'token_state', 'merged', pg_temp.g('f1b') -> 'merged', 'already', pg_temp.g('f1b') -> 'already'),
  '{"token_state":"retired","merged":false,"already":true}'::jsonb, 'F1b 2.ª fusión: merged false, already true, token "retired"');
select is(pg_temp.g('f1b') #> '{cart,lines}', pg_temp.g('f1') #> '{cart,lines}', 'F1b el carrito (líneas) es idéntico');
select is(pg_temp.g('f1b') #> '{cart,totals}', pg_temp.g('f1') #> '{cart,totals}', 'F1b …y los totales también');
select is((select coalesce(jsonb_agg(to_jsonb(r) order by r.variant_id, r.owner_id), '[]'::jsonb)
  from (select variant_id, owner_id, qty, status, expires_at from public.stock_reservations
         where owner_id in (pg_temp.gc(repeat('11', 32)), pg_temp.uc('a7000000-0000-0000-0000-000000000007'))) r),
  pg_temp.g('f1res'), 'F1b las reservas (filas, cantidades, estados y vencimientos) son idénticas');
select is((select count(*)::int from public.carts where profile_id = 'a7000000-0000-0000-0000-000000000007'), 1, 'F1b no se creó otro carrito');
select pg_temp.rec('f1c', public.cart_get(null, repeat('11', 32)));
select is(pg_temp.g('f1c') - 'server_time', '{"token_state":"retired","cart":null}'::jsonb, 'F1c cart_get con el token ya fusionado: "retired" y sin carrito');
select pg_temp.rec('f1d', public.cart_set_item(null, repeat('11', 32), 'f7000000-0000-0000-0010-000000000001', 1));
select is(pg_temp.oa(pg_temp.g('f1d')), '{"outcome":"token_retired","applied":0,"requested":1}'::jsonb, 'F1d agregar con el token fusionado → token_retired');
select is(pg_temp.g('f1d') ->> 'token_state', 'retired', 'F1d …con token_state "retired"');
select is((select count(*)::int from public.carts where token_hash = repeat('11', 32)), 1, 'F1d …y NO se creó otro carrito con ese token');
select pg_temp.rec('f1e', public.cart_remove_item(null, repeat('11', 32), 'f7000000-0000-0000-0010-000000000001'));
select is(jsonb_build_object('outcome', pg_temp.g('f1e') -> 'outcome', 'token_state', pg_temp.g('f1e') -> 'token_state', 'cart', pg_temp.g('f1e') -> 'cart'),
  '{"outcome":"ok","token_state":"retired","cart":null}'::jsonb, 'F1e quitar con el token fusionado: no hace nada (ok) e informa "retired"');

-- F2 ítems repetidos suman: v1003 2 + 3 = 5 ; v1004 8 + 5 = 13 → tope por variante 10
select pg_temp.rec('f2', public.cart_set_item('a7000000-0000-0000-0000-000000000008', null, 'f7000000-0000-0000-0010-000000000003', 2));
select pg_temp.rec('f2', public.cart_set_item('a7000000-0000-0000-0000-000000000008', null, 'f7000000-0000-0000-0010-000000000004', 8));
select pg_temp.rec('f2', public.cart_set_item(null, repeat('12', 32), 'f7000000-0000-0000-0010-000000000003', 3));
select pg_temp.rec('f2', public.cart_set_item(null, repeat('12', 32), 'f7000000-0000-0000-0010-000000000004', 5));
select pg_temp.rec('f2m', public.merge_guest_cart('a7000000-0000-0000-0000-000000000008', repeat('12', 32)));
select is(pg_temp.ms(pg_temp.g('f2m')), '{"token_state":"merged","merged":true,"merged_lines":2,"adjusted_lines":1,"skipped_lines":0}'::jsonb, 'F2 se fusionan 2 líneas; la de 8 + 5 = 13 se recortó al tope de 10, así que 1 línea ajustada (nada se pierde en silencio)');
select is(pg_temp.ls(pg_temp.g('f2m'), 'f7000000-0000-0000-0010-000000000003'),
  '{"status":"ok","blocking":false,"billable_qty":5,"price_notice":null,"unit_price":50,"line_total":250.00}'::jsonb, 'F2 2 + 3 = 5 unidades: 5 × 50.00 = 250.00');
select is(pg_temp.ls(pg_temp.g('f2m'), 'f7000000-0000-0000-0010-000000000004'),
  '{"status":"ok","blocking":false,"billable_qty":10,"price_notice":null,"unit_price":50,"line_total":500.00}'::jsonb, 'F2 8 + 5 = 13 se recorta al tope de 10: 10 × 50.00 = 500.00');
select is(pg_temp.g('f2m') #> '{cart,totals}', '{"subtotal":750.00,"item_count":15,"line_count":2,"shipping":null,"discount":null,"total":750.00}'::jsonb, 'F2 totales 250.00 + 500.00 = 750.00; 15 unidades');
select is(jsonb_build_object('v1003', pg_temp.held(pg_temp.uc('a7000000-0000-0000-0000-000000000008'), 'f7000000-0000-0000-0010-000000000003'), 'v1004', pg_temp.held(pg_temp.uc('a7000000-0000-0000-0000-000000000008'), 'f7000000-0000-0000-0010-000000000004'),
    'guest', pg_temp.heldall(pg_temp.gc(repeat('12', 32)))),
  '{"v1003":5,"v1004":10,"guest":0}'::jsonb, 'F2 el usuario retiene 5 y 10; el invitado, 0');
select is(jsonb_build_object('v1003', pg_temp.vheld('f7000000-0000-0000-0010-000000000003'), 'v1004', pg_temp.vheld('f7000000-0000-0000-0010-000000000004')), '{"v1003":5,"v1004":10}'::jsonb, 'F2 retención total por variante 5 y 10 (sin duplicados)');

-- F3 precio al fusionar. Variantes 1005…1010, cada una × 1 en ambos carritos; se arman los precios de entrada a mano (precio vigente = 50.00)
select pg_temp.rec('f3', public.cart_clear('a7000000-0000-0000-0000-000000000008', null));
select pg_temp.rec('f3', public.cart_set_item('a7000000-0000-0000-0000-000000000008', null, 'f7000000-0000-0000-0010-000000000005', 1));
select pg_temp.rec('f3', public.cart_set_item('a7000000-0000-0000-0000-000000000008', null, 'f7000000-0000-0000-0010-000000000006', 1));
select pg_temp.rec('f3', public.cart_set_item('a7000000-0000-0000-0000-000000000008', null, 'f7000000-0000-0000-0010-000000000007', 1));
select pg_temp.rec('f3', public.cart_set_item('a7000000-0000-0000-0000-000000000008', null, 'f7000000-0000-0000-0010-000000000008', 1));
select pg_temp.rec('f3', public.cart_set_item('a7000000-0000-0000-0000-000000000008', null, 'f7000000-0000-0000-0010-000000000009', 1));
select pg_temp.rec('f3', public.cart_set_item('a7000000-0000-0000-0000-000000000008', null, 'f7000000-0000-0000-0010-000000000010', 1));
select pg_temp.rec('f3', public.cart_set_item(null, repeat('13', 32), 'f7000000-0000-0000-0010-000000000005', 1));
select pg_temp.rec('f3', public.cart_set_item(null, repeat('13', 32), 'f7000000-0000-0000-0010-000000000006', 1));
select pg_temp.rec('f3', public.cart_set_item(null, repeat('13', 32), 'f7000000-0000-0000-0010-000000000007', 1));
select pg_temp.rec('f3', public.cart_set_item(null, repeat('13', 32), 'f7000000-0000-0000-0010-000000000008', 1));
select pg_temp.rec('f3', public.cart_set_item(null, repeat('13', 32), 'f7000000-0000-0000-0010-000000000009', 1));
select pg_temp.rec('f3', public.cart_set_item(null, repeat('13', 32), 'f7000000-0000-0000-0010-000000000010', 1));
-- (variante, precio de entrada, garantía restante, antigüedad) del INVITADO
update public.cart_items ci set unit_price_at_add = x.p, price_locked_until = now() + x.lk, added_at = now() - x.age
  from (values ('f7000000-0000-0000-0010-000000000005'::uuid, 50::numeric, interval '3 days', interval '0'),
               ('f7000000-0000-0000-0010-000000000006'::uuid, 45, interval '3 days', interval '0'),
               ('f7000000-0000-0000-0010-000000000007'::uuid, 52, interval '3 days', interval '0'),
               ('f7000000-0000-0000-0010-000000000008'::uuid, 45, interval '-1 day', interval '0'),
               ('f7000000-0000-0000-0010-000000000009'::uuid, 40, interval '-1 day', interval '2 days'),
               ('f7000000-0000-0000-0010-000000000010'::uuid, 50, interval '3 days', interval '2 days')) x(v, p, lk, age)
 where ci.cart_id = pg_temp.gc(repeat('13', 32)) and ci.variant_id = x.v;
-- …y los del USUARIO
update public.cart_items ci set unit_price_at_add = x.p, price_locked_until = now() + x.lk, added_at = now() - x.age
  from (values ('f7000000-0000-0000-0010-000000000005'::uuid, 45::numeric, interval '5 days', interval '0'),
               ('f7000000-0000-0000-0010-000000000006'::uuid, 50, interval '5 days', interval '0'),
               ('f7000000-0000-0000-0010-000000000007'::uuid, 45, interval '-1 day', interval '0'),
               ('f7000000-0000-0000-0010-000000000008'::uuid, 52, interval '5 days', interval '0'),
               ('f7000000-0000-0000-0010-000000000009'::uuid, 45, interval '-1 day', interval '0'),
               ('f7000000-0000-0000-0010-000000000010'::uuid, 50, interval '5 days', interval '1 day')) x(v, p, lk, age)
 where ci.cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000008') and ci.variant_id = x.v;
select pg_temp.rec('f3m', public.merge_guest_cart('a7000000-0000-0000-0000-000000000008', repeat('13', 32)));
select is(pg_temp.ms(pg_temp.g('f3m')), '{"token_state":"merged","merged":true,"merged_lines":6,"adjusted_lines":0,"skipped_lines":0}'::jsonb, 'F3 se fusionan 6 líneas');
select is((select count(*)::int from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000008') and qty = 2), 6, 'F3 las 6 líneas quedan en 2 (1 + 1)');
-- ambas vigentes: gana el MENOR (con su garantía)
select is((select unit_price_at_add::text || '|' || (price_locked_until = now() + interval '5 days')::text from public.cart_items
            where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000008') and variant_id = 'f7000000-0000-0000-0010-000000000005'), '45|true', 'F3 ambas vigentes, invitado 50 vs usuario 45: gana 45 (con la garantía del usuario, +5 días)');
select is((select unit_price_at_add::text || '|' || (price_locked_until = now() + interval '5 days')::text from public.cart_items
            where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000008') and variant_id = 'f7000000-0000-0000-0010-000000000006'), '45|true', 'F3 ambas vigentes, invitado 45 (+3 d) vs usuario 50 (+5 d): gana el menor precio (45) con la garantía MÁS larga (+5 días), nadie pierde lo asegurado');
-- solo una vigente: la suya (aunque sea mayor que el precio actual 50)
select is((select unit_price_at_add::text || '|' || (price_locked_until = now() + interval '3 days')::text from public.cart_items
            where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000008') and variant_id = 'f7000000-0000-0000-0010-000000000007'), '52|true', 'F3 solo el invitado vigente (52; usuario vencido 45): se conserva 52');
select is((select unit_price_at_add::text || '|' || (price_locked_until = now() + interval '5 days')::text from public.cart_items
            where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000008') and variant_id = 'f7000000-0000-0000-0010-000000000008'), '52|true', 'F3 solo el usuario vigente (52; invitado vencido 45): se conserva 52');
-- ninguna vigente (invitado 40 de hace 2 días, usuario 45 de hoy; ambos vencidos): gana la línea MÁS ANTIGUA (la del invitado, 40)
-- y conserva su garantía VENCIDA (hace 1 día): la fusión no la «estrena» con el precio actual, así el aviso sigue ahí
select is((select unit_price_at_add::text || '|' || (price_locked_until = now() - interval '1 day')::text || '|' || (added_at = now() - interval '2 days')::text from public.cart_items
            where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000008') and variant_id = 'f7000000-0000-0000-0010-000000000009'), '40|true|true',
  'F3 ninguna vigente (40 vencido de hace 2 días vs 45 vencido de hoy): gana la más antigua (40), sigue vencida y conserva su antigüedad');
select is(pg_temp.ls(pg_temp.g('f3m'), 'f7000000-0000-0000-0010-000000000009'),
  '{"status":"price_changed","blocking":true,"billable_qty":2,"price_notice":"expired_raised","unit_price":50.00,"line_total":100.00}'::jsonb,
  'F3 …y el cliente lo ve ANTES de pagar: precio de entrada 40 vencido y vigente 50.00 → «subió» y bloquea (2 × 50.00 = 100.00)');
-- empate de precio (50 y 50, ambas vigentes): precio 50, garantía MÁS larga (la del usuario, +5 días) y la antigüedad más vieja (hace 2 días)
select is((select unit_price_at_add::text || '|' || (price_locked_until = now() + interval '5 days')::text || '|' || (added_at = now() - interval '2 days')::text
             from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000008') and variant_id = 'f7000000-0000-0000-0010-000000000010'),
  '50|true|true', 'F3 empate 50 = 50 con ambas vigentes: precio 50, garantía más larga (+5 días) y la antigüedad más vieja (hace 2 días)');
-- sin línea previa del usuario: la del invitado pasa tal cual, con su garantía (aquí vencida) sin renovarla
select pg_temp.rec('f3x', public.cart_clear('a7000000-0000-0000-0000-000000000008', null));
select pg_temp.rec('f3x', public.cart_set_item(null, repeat('2c', 32), 'f7000000-0000-0000-0010-000000000005', 1));
update public.cart_items set unit_price_at_add = 40, price_locked_until = now() - interval '2 days' where cart_id = pg_temp.gc(repeat('2c', 32));
select pg_temp.rec('f3x', public.merge_guest_cart('a7000000-0000-0000-0000-000000000008', repeat('2c', 32)));
select is((select unit_price_at_add::text || '|' || (price_locked_until = now() - interval '2 days')::text from public.cart_items
            where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000008')), '40|true',
  'F3 sin línea previa del usuario, la del invitado pasa tal cual: entrada 40 con su garantía vencida (no se re-estrena a 50)');

-- F4 ajuste por stock y línea sin stock. v1011 stock 4: usuario 1 + invitado 3. v1012 stock 2: invitado 2.
select pg_temp.rec('f4', public.cart_clear('a7000000-0000-0000-0000-000000000008', null));
select pg_temp.rec('f4', public.cart_set_item('a7000000-0000-0000-0000-000000000008', null, 'f7000000-0000-0000-0010-000000000011', 1));
select pg_temp.rec('f4', public.cart_set_item(null, repeat('14', 32), 'f7000000-0000-0000-0010-000000000011', 3));
select pg_temp.rec('f4', public.cart_set_item(null, repeat('14', 32), 'f7000000-0000-0000-0010-000000000012', 2));
select public.apply_stock_change('f7000000-0000-0000-0010-000000000011', -1, 'adjust', 'S7 prueba');   -- stock 4 → 3
select public.apply_stock_change('f7000000-0000-0000-0010-000000000012', -2, 'sale', 'S7 prueba');     -- stock 2 → 0
select pg_temp.rec('f4m', public.merge_guest_cart('a7000000-0000-0000-0000-000000000008', repeat('14', 32)));
-- v1011: 1 + 3 = 4 pedido, hay 3 → ajustado a 3 (adjusted_lines 1). v1012: sin stock → se conserva SIN retención (qty 2).
select is(pg_temp.ms(pg_temp.g('f4m')), '{"token_state":"merged","merged":true,"merged_lines":2,"adjusted_lines":1,"skipped_lines":0}'::jsonb,
  'F4 2 líneas fusionadas, 1 ajustada por stock');
select is(pg_temp.ls(pg_temp.g('f4m'), 'f7000000-0000-0000-0010-000000000011'),
  '{"status":"ok","blocking":false,"billable_qty":3,"price_notice":null,"unit_price":50,"line_total":150.00}'::jsonb, 'F4 v1011: 1 + 3 = 4 pedidas, 3 en stock → queda en 3 (3 × 50.00 = 150.00)');
select is(pg_temp.held(pg_temp.uc('a7000000-0000-0000-0000-000000000008'), 'f7000000-0000-0000-0010-000000000011'), 3, 'F4 v1011: retiene las 3');
select is(pg_temp.ls(pg_temp.g('f4m'), 'f7000000-0000-0000-0010-000000000012'),
  '{"status":"out_of_stock","blocking":true,"billable_qty":0,"price_notice":null,"unit_price":50,"line_total":0.00}'::jsonb,
  'F4 v1012 sin stock: la línea se conserva y se ve agotada');
select is((select qty from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000008') and variant_id = 'f7000000-0000-0000-0010-000000000012'), 2, 'F4 …con su cantidad (2)');
select is(pg_temp.held(pg_temp.uc('a7000000-0000-0000-0000-000000000008'), 'f7000000-0000-0000-0010-000000000012'), 0, 'F4 …sin retención');
select is((pg_temp.g('f4m') #>> '{cart,can_checkout}')::boolean, false, 'F4 con una línea agotada no se puede pagar');
select is(pg_temp.heldall(pg_temp.gc(repeat('14', 32))), 0, 'F4 el invitado no retiene nada tras fusionar');

-- F5 tope de líneas (2): usuario con 1 línea + invitado con 2 nuevas → entra la primera por id, la 2.ª se omite
update public.store_settings set value = '2' where key = 'cart_max_lines';
select pg_temp.rec('f5', public.cart_clear('a7000000-0000-0000-0000-000000000008', null));
select pg_temp.rec('f5', public.cart_set_item('a7000000-0000-0000-0000-000000000008', null, 'f7000000-0000-0000-0011-000000000001', 1));
select pg_temp.rec('f5', public.cart_set_item(null, repeat('15', 32), 'f7000000-0000-0000-0011-000000000002', 1));
select pg_temp.rec('f5', public.cart_set_item(null, repeat('15', 32), 'f7000000-0000-0000-0011-000000000003', 1));
select pg_temp.rec('f5m', public.merge_guest_cart('a7000000-0000-0000-0000-000000000008', repeat('15', 32)));
select is(pg_temp.ms(pg_temp.g('f5m')), '{"token_state":"merged","merged":true,"merged_lines":1,"adjusted_lines":0,"skipped_lines":1}'::jsonb,
  'F5 con tope de 2 líneas: 1 fusionada y 1 omitida (skipped_lines)');
select is((select string_agg(right(variant_id::text, 4), ',' order by variant_id) from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000008')), '0001,0002',
  'F5 el usuario queda con v1101 y v1102 (la v1103, la última por id, es la omitida)');
select is(pg_temp.heldall(pg_temp.gc(repeat('15', 32))), 0, 'F5 también se liberó la retención de la línea omitida');
select is(pg_temp.vheld('f7000000-0000-0000-0011-000000000003'), 0, 'F5 …y nadie retiene la v1103');
update public.store_settings set value = '30' where key = 'cart_max_lines';

-- F6 tope de unidades (5): usuario 3 + invitado 4 (otra variante) → entran 2 (se cuenta como línea ajustada); luego otro invitado con 1 más → omitida
update public.store_settings set value = '5' where key = 'cart_max_reserved_units';
select pg_temp.rec('f6', public.cart_clear('a7000000-0000-0000-0000-000000000008', null));
select pg_temp.rec('f6', public.cart_set_item('a7000000-0000-0000-0000-000000000008', null, 'f7000000-0000-0000-0012-000000000001', 3));
select pg_temp.rec('f6', public.cart_set_item(null, repeat('16', 32), 'f7000000-0000-0000-0012-000000000002', 4));
select pg_temp.rec('f6m', public.merge_guest_cart('a7000000-0000-0000-0000-000000000008', repeat('16', 32)));
select is(pg_temp.ms(pg_temp.g('f6m')), '{"token_state":"merged","merged":true,"merged_lines":1,"adjusted_lines":1,"skipped_lines":0}'::jsonb,
  'F6 1 línea fusionada; pedía 4 y entraron 2 (tope de 5 unidades − 3 del usuario): 1 línea ajustada y se avisa');
select is((select qty from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000008') and variant_id = 'f7000000-0000-0000-0012-000000000002'), 2, 'F6 la línea del invitado entra con 2 (5 − 3 del usuario), no con 4');
select is(pg_temp.held(pg_temp.uc('a7000000-0000-0000-0000-000000000008'), 'f7000000-0000-0000-0012-000000000002'), 2, 'F6 …y retiene 2');
select pg_temp.rec('f6', public.cart_set_item(null, repeat('17', 32), 'f7000000-0000-0000-0012-000000000003', 1));
select pg_temp.rec('f6m2', public.merge_guest_cart('a7000000-0000-0000-0000-000000000008', repeat('17', 32)));
select is(pg_temp.ms(pg_temp.g('f6m2')), '{"token_state":"merged","merged":true,"merged_lines":0,"adjusted_lines":0,"skipped_lines":1}'::jsonb,
  'F6 con el carrito en 5 de 5 unidades, la línea nueva se omite');
select is((select count(*)::int from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000008')), 2, 'F6 el usuario sigue con 2 líneas');
update public.store_settings set value = '30' where key = 'cart_max_reserved_units';

-- F7 con reserve_on_add_to_cart = false: usuario 1 + invitado 2 de v1501 (stock 2) → 3 pedidas, 2 libres → 2, sin reservas
update public.store_settings set value = 'false' where key = 'reserve_on_add_to_cart';
select pg_temp.rec('f7', public.cart_clear('a7000000-0000-0000-0000-000000000008', null));
select pg_temp.rec('f7', public.cart_set_item('a7000000-0000-0000-0000-000000000008', null, 'f7000000-0000-0000-0015-000000000001', 1));
select pg_temp.rec('f7', public.cart_set_item(null, repeat('1a', 32), 'f7000000-0000-0000-0015-000000000001', 2));
select pg_temp.rec('f7m', public.merge_guest_cart('a7000000-0000-0000-0000-000000000008', repeat('1a', 32)));
select is(pg_temp.ms(pg_temp.g('f7m')), '{"token_state":"merged","merged":true,"merged_lines":1,"adjusted_lines":1,"skipped_lines":0}'::jsonb,
  'F7 sin retención: 1 + 2 = 3 pedidas, 2 en stock → 1 línea ajustada');
select is((select qty from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000008') and variant_id = 'f7000000-0000-0000-0015-000000000001'), 2, 'F7 la línea queda en 2');
select is((select count(*)::int from public.stock_reservations where variant_id = 'f7000000-0000-0000-0015-000000000001'), 0, 'F7 y no existe ninguna reserva de esa variante');
update public.store_settings set value = 'true' where key = 'reserve_on_add_to_cart';

-- F8 carrito de invitado vacío (se agregó y se quitó): fusiona sin líneas
select pg_temp.rec('f8', public.cart_set_item(null, repeat('1b', 32), 'f7000000-0000-0000-0010-000000000001', 1));
select pg_temp.rec('f8', public.cart_set_item(null, repeat('1b', 32), 'f7000000-0000-0000-0010-000000000001', 0));
select pg_temp.rec('f8m', public.merge_guest_cart('a7000000-0000-0000-0000-000000000008', repeat('1b', 32)));
select is(pg_temp.ms(pg_temp.g('f8m')), '{"token_state":"merged","merged":true,"merged_lines":0,"adjusted_lines":0,"skipped_lines":0}'::jsonb,
  'F8 fusionar un carrito de invitado vacío: merged true con 0 líneas');
select is((select status from public.carts where token_hash = repeat('1b', 32)), 'merged', 'F8 …y igual queda "merged"');
-- F9 token desconocido y argumentos inválidos
select pg_temp.rec('f9a', public.merge_guest_cart('a7000000-0000-0000-0000-000000000008', repeat('de', 32)));
select is(jsonb_build_object('token_state', pg_temp.g('f9a') -> 'token_state', 'merged', pg_temp.g('f9a') -> 'merged'),
  '{"token_state":"none","merged":false}'::jsonb, 'F9 token desconocido: token_state "none", nada fusionado');
select ok(pg_temp.g('f9a') #> '{cart,cart_id}' is not null, 'F9 …y devuelve igualmente el carrito actual del usuario');
select pg_temp.rec('f9b', public.merge_guest_cart('a7000000-0000-0000-0000-000000000010', repeat('de', 32)));
select is(pg_temp.g('f9b') - 'server_time', '{"token_state":"none","merged":false,"cart":null}'::jsonb, 'F9 usuario sin carrito + token desconocido: cart nulo');
select is((select count(*)::int from public.carts where profile_id = 'a7000000-0000-0000-0000-000000000010'), 0, 'F9 …y NO se le creó ningún carrito');
select throws_ok($$select public.merge_guest_cart(null, repeat('11', 32))$$, '22023', null, 'F9 fusionar sin usuario → 22023');
select throws_ok($$select public.merge_guest_cart('a7000000-0000-0000-0000-000000000008', null)$$, '22023', null, 'F9 fusionar sin token → 22023');
select throws_ok($$select public.merge_guest_cart('a7000000-0000-0000-0000-000000000008', 'abc')$$, '22023', null, 'F9 fusionar con un token mal formado → 22023');

-- F10 IDOR: un token solo da acceso a SU carrito; un usuario, al suyo
select pg_temp.rec('f10a', public.cart_set_item(null, repeat('18', 32), 'f7000000-0000-0000-0010-000000000001', 1));
select pg_temp.rec('f10b', public.cart_set_item(null, repeat('19', 32), 'f7000000-0000-0000-0010-000000000002', 4));
select pg_temp.rec('f10a', public.cart_get(null, repeat('18', 32)));
select pg_temp.rec('f10b', public.cart_get(null, repeat('19', 32)));
select is(jsonb_build_object('lines', pg_temp.nlines(pg_temp.g('f10a')), 'own', pg_temp.lin(pg_temp.g('f10a'), 'f7000000-0000-0000-0010-000000000001') is not null,
    'other', pg_temp.lin(pg_temp.g('f10a'), 'f7000000-0000-0000-0010-000000000002') is not null),
  '{"lines":1,"own":true,"other":false}'::jsonb, 'F10 el token A solo ve su línea, no la del carrito B');
select isnt(pg_temp.g('f10a') #>> '{cart,cart_id}', pg_temp.g('f10b') #>> '{cart,cart_id}', 'F10 cada token ve un carrito distinto');
select is(public.cart_get(null, repeat('5e', 32)) - 'server_time', '{"token_state":"none","cart":null}'::jsonb, 'F10 un token que no existe no da acceso a nada');
select isnt((public.cart_get('a7000000-0000-0000-0000-000000000007', null) #>> '{cart,cart_id}'), (public.cart_get('a7000000-0000-0000-0000-000000000008', null) #>> '{cart,cart_id}'), 'F10 dos usuarios ven carritos distintos');
select is(public.cart_get('a7000000-0000-0000-0000-000000000010', null) - 'server_time', '{"token_state":"none","cart":null}'::jsonb, 'F10 un usuario sin carrito no ve el de otros');
-- otro usuario intenta fusionar un token YA fusionado en el carrito del usuario 07
select pg_temp.rec('f10c', public.merge_guest_cart('a7000000-0000-0000-0000-000000000010', repeat('11', 32)));
select is(jsonb_build_object('token_state', pg_temp.g('f10c') -> 'token_state', 'merged', pg_temp.g('f10c') -> 'merged', 'already', pg_temp.g('f10c') -> 'already'),
  '{"token_state":"retired","merged":false,"already":true}'::jsonb, 'F10 el usuario 10 no puede reclamar el token que ya se fusionó en el usuario 07');
select is(pg_temp.nlines(pg_temp.g('f10c')), 0, 'F10 …y su propio carrito queda vacío (no heredó nada)');
select is((select qty from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000007') and variant_id = 'f7000000-0000-0000-0010-000000000001'), 2, 'F10 …y el carrito del usuario 07 sigue intacto (v1001 × 2)');
select pg_temp.rec('f10d', public.cart_set_item('a7000000-0000-0000-0000-000000000010', null, 'f7000000-0000-0000-0010-000000000001', 1));
select is((select qty from public.cart_items where cart_id = pg_temp.uc('a7000000-0000-0000-0000-000000000007') and variant_id = 'f7000000-0000-0000-0010-000000000001'), 2, 'F10 lo que agrega el usuario 10 no toca el carrito del 07');

-- F11 p_may_create: un token que el servidor no emitió no puede ESTRENAR carrito (D-02)
select pg_temp.rec('f11a', public.cart_set_item(null, repeat('5f', 32), 'f7000000-0000-0000-0010-000000000001', 1, false));
select is(pg_temp.oa(pg_temp.g('f11a')), '{"outcome":"token_retired","applied":0,"requested":1}'::jsonb, 'F11 token desconocido con p_may_create = false → token_retired');
select is(pg_temp.g('f11a') ->> 'token_state', 'none', 'F11 …con token_state "none"');
select is((select count(*)::int from public.carts where token_hash = repeat('5f', 32)), 0, 'F11 …y no se creó ningún carrito');
select pg_temp.rec('f11b', public.cart_set_item(null, repeat('5f', 32), 'f7000000-0000-0000-0010-000000000001', 1));
select is(pg_temp.oa(pg_temp.g('f11b')), '{"outcome":"ok","applied":1,"requested":1}'::jsonb, 'F11 con p_may_create por defecto (true) el mismo token SÍ estrena carrito');
select pg_temp.rec('f11c', public.cart_set_item(null, repeat('5f', 32), 'f7000000-0000-0000-0010-000000000002', 1, false));
select is(pg_temp.oa(pg_temp.g('f11c')), '{"outcome":"ok","applied":1,"requested":1}'::jsonb, 'F11 con el carrito ya creado, p_may_create = false deja agregar');
select pg_temp.rec('f11d', public.cart_set_item('a7000000-0000-0000-0000-000000000012', null, 'f7000000-0000-0000-0010-000000000001', 1, false));
select is(pg_temp.oa(pg_temp.g('f11d')), '{"outcome":"ok","applied":1,"requested":1}'::jsonb, 'F11 un usuario autenticado ignora p_may_create (su carrito se crea igual)');
select pg_temp.rec('f11e', public.cart_remove_item(null, repeat('5e', 32), 'f7000000-0000-0000-0010-000000000001'));
select is(jsonb_build_object('outcome', pg_temp.g('f11e') -> 'outcome', 'cart', pg_temp.g('f11e') -> 'cart'), '{"outcome":"ok","cart":null}'::jsonb,
  'F11 quitar de un carrito que no existe: ok y sin carrito');
select is((select count(*)::int from public.carts where token_hash = repeat('5e', 32)), 0, 'F11 …y quitar tampoco crea carritos');
select is(public.cart_clear(null, repeat('5e', 32)) - 'server_time', '{"token_state":"none","cart":null}'::jsonb, 'F11 cart_clear con un token que no existe: nada que limpiar');
select is(public.cart_refresh(null, repeat('5e', 32)) - 'server_time', '{"token_state":"none","cart":null,"renewed":0}'::jsonb, 'F11 cart_refresh con un token que no existe: renewed 0');
select is(public.cart_accept_prices(null, repeat('5e', 32), null) - 'server_time', '{"token_state":"none","cart":null}'::jsonb, 'F11 cart_accept_prices con un token que no existe: nada');
select is((select count(*)::int from public.carts where token_hash = repeat('5e', 32)), 0, 'F11 …y ninguna de las tres creó un carrito');
select throws_ok($$select public.cart_get(null, 'abc')$$, '22023', null, 'F11 cart_get con un token mal formado → 22023');
select throws_ok($$select public.cart_clear('a7000000-0000-0000-0000-000000000001', repeat('11', 32))$$, '22023', null, 'F11 cart_clear con usuario Y token → 22023');

-- F12 el invitado tenía una línea de una variante que luego se archivó: se fusiona conservada, sin retención, como no disponible
select pg_temp.rec('f12', public.cart_set_item(null, repeat('1c', 32), 'f7000000-0000-0000-0004-000000000005', 2));
update public.product_variants set archived_at = now() where id = 'f7000000-0000-0000-0004-000000000005';
select pg_temp.rec('f12m', public.merge_guest_cart('a7000000-0000-0000-0000-000000000010', repeat('1c', 32)));
select is(pg_temp.ms(pg_temp.g('f12m')), '{"token_state":"merged","merged":true,"merged_lines":1,"adjusted_lines":0,"skipped_lines":0}'::jsonb, 'F12 se fusiona 1 línea');
select is(pg_temp.ls(pg_temp.g('f12m'), 'f7000000-0000-0000-0004-000000000005'),
  '{"status":"unavailable","blocking":true,"billable_qty":0,"price_notice":null,"unit_price":100,"line_total":0.00}'::jsonb, 'F12 la línea de la variante archivada queda como unavailable');
select is(pg_temp.held(pg_temp.uc('a7000000-0000-0000-0000-000000000010'), 'f7000000-0000-0000-0004-000000000005') + pg_temp.vheld('f7000000-0000-0000-0004-000000000005'), 0, 'F12 …y nadie retiene esa variante');

-- ═══ G. Limpieza y ciclo de vida ═════════════════════════════════════════════════════════════════
-- G0 leer no marca actividad; cualquier cambio del cliente sí (si no, un carrito en uso se abandonaría)
select pg_temp.rec('g00', public.cart_set_item(null, repeat('a4', 32), 'f7000000-0000-0000-0013-000000000001', 1));
update public.carts set last_activity_at = now() - interval '25 days', updated_at = now() - interval '25 days' where token_hash = repeat('a4', 32);
select pg_temp.rec('g00', public.cart_get(null, repeat('a4', 32)));
select is((select last_activity_at from public.carts where token_hash = repeat('a4', 32)), now() - interval '25 days', 'G0 cart_get es de solo lectura: no marca actividad');
select pg_temp.rec('g00', public.cart_set_item(null, repeat('a4', 32), 'f7000000-0000-0000-0013-000000000001', 2));
select is((select last_activity_at from public.carts where token_hash = repeat('a4', 32)), now(), 'G0 cart_set_item marca actividad (last_activity_at = now())');
select pg_temp.rec('g0', public.cart_set_item(null, repeat('a1', 32), 'f7000000-0000-0000-0013-000000000001', 2));
select pg_temp.rec('g0', public.cart_set_item(null, repeat('a2', 32), 'f7000000-0000-0000-0013-000000000001', 2));
select pg_temp.rec('g0', public.cart_set_item(null, repeat('a3', 32), 'f7000000-0000-0000-0013-000000000001', 2));
update public.carts set last_activity_at = now() - interval '31 days' where token_hash = repeat('a1', 32);
update public.carts set last_activity_at = now() - interval '29 days' where token_hash = repeat('a2', 32);
update public.carts set last_activity_at = now() - interval '30 days' where token_hash = repeat('a3', 32);
-- un carrito de USUARIO y uno de invitado ya fusionado, ambos muy viejos: no se tocan
update public.carts set last_activity_at = now() - interval '40 days' where id = pg_temp.uc('a7000000-0000-0000-0000-000000000004') or token_hash = repeat('11', 32);
select is(public.cart_abandon_stale(), 1, 'G1 abandona SOLO 1 carrito de invitado: el de hace 31 días (29 y 30 días no; ni usuarios ni fusionados)');
select is((select status from public.carts where token_hash = repeat('a1', 32)), 'abandoned', 'G1 el de 31 días quedó "abandoned"');
select is(pg_temp.heldall(pg_temp.gc(repeat('a1', 32))), 0, 'G1 …y liberó su stock');
select is((select count(*)::int from public.cart_items where cart_id = pg_temp.gc(repeat('a1', 32))), 1, 'G1 …pero conserva sus líneas hasta la limpieza');
select is(jsonb_build_object('ta2', (select status from public.carts where token_hash = repeat('a2', 32)), 'ta3', (select status from public.carts where token_hash = repeat('a3', 32)),
    'held2', pg_temp.heldall(pg_temp.gc(repeat('a2', 32))), 'held3', pg_temp.heldall(pg_temp.gc(repeat('a3', 32)))),
  '{"ta2":"active","ta3":"active","held2":2,"held3":2}'::jsonb, 'G1 los de 29 y 30 días (el límite es estricto: "más viejo que") siguen activos y retienen');
select is(jsonb_build_object('user', (select status from public.carts where id = pg_temp.uc('a7000000-0000-0000-0000-000000000004')), 'merged', (select status from public.carts where token_hash = repeat('11', 32))),
  '{"user":"active","merged":"merged"}'::jsonb, 'G1 el carrito de usuario viejo sigue activo y el fusionado sigue fusionado');
select is(public.cart_abandon_stale(), 0, 'G1 es idempotente: la 2.ª ejecución no abandona nada');
select pg_temp.rec('g1c', public.cart_get(null, repeat('a1', 32)));
select is(pg_temp.g('g1c') - 'server_time', '{"token_state":"retired","cart":null}'::jsonb, 'G1 el token de un carrito abandonado queda "retired"');
select pg_temp.rec('g1d', public.cart_set_item(null, repeat('a1', 32), 'f7000000-0000-0000-0013-000000000001', 1));
select is(pg_temp.oa(pg_temp.g('g1d')), '{"outcome":"token_retired","applied":0,"requested":1}'::jsonb, 'G1 agregar con el token abandonado → token_retired');
select pg_temp.rec('g1e', public.merge_guest_cart('a7000000-0000-0000-0000-000000000008', repeat('a1', 32)));
select is(jsonb_build_object('token_state', pg_temp.g('g1e') -> 'token_state', 'merged', pg_temp.g('g1e') -> 'merged'), '{"token_state":"retired","merged":false}'::jsonb,
  'G1 fusionar un carrito abandonado no trae nada');
-- ajuste guest_cart_retention_days = 10: ahora los de 29 y 30 días también
update public.store_settings set value = '10' where key = 'guest_cart_retention_days';
select is(public.cart_abandon_stale(), 2, 'G1 con retención de 10 días se abandonan también los de 29 y 30 días (2)');
select is(pg_temp.heldall(pg_temp.gc(repeat('a2', 32))) + pg_temp.heldall(pg_temp.gc(repeat('a3', 32))), 0, 'G1 …y se libera su stock');
update public.store_settings set value = '30' where key = 'guest_cart_retention_days';

-- G2 purge_old_carts: solo invitados abandonados/fusionados de más de 60 días
insert into public.carts (token_hash, currency, status, updated_at) values
  (repeat('b3', 32), 'BOB', 'abandoned', now() - interval '59 days'),
  (repeat('b4', 32), 'BOB', 'abandoned', now() - interval '60 days'),
  (repeat('b6', 32), 'BOB', 'active',    now() - interval '90 days'),
  (repeat('b7', 32), 'BOB', 'converted', now() - interval '61 days');
insert into public.carts (token_hash, currency, status, merged_into, updated_at)
  values (repeat('b5', 32), 'BOB', 'merged', pg_temp.uc('a7000000-0000-0000-0000-000000000007'), now() - interval '61 days');
insert into public.carts (profile_id, currency, status, updated_at) values ('a7000000-0000-0000-0000-000000000007', 'BOB', 'abandoned', now() - interval '61 days');
update public.carts set updated_at = now() - interval '61 days' where token_hash = repeat('a1', 32);
select pg_temp.rec('g2id', jsonb_build_object('id', pg_temp.gc(repeat('a1', 32))));
select is(public.purge_old_carts(), 2, 'G2 purge borra 2: el abandonado de 61 días (ta1) y el fusionado de 61 días (tb5)');
select is((select count(*)::int from public.carts where token_hash in (repeat('a1', 32), repeat('b5', 32))), 0, 'G2 esos dos ya no existen');
select is((select count(*)::int from public.cart_items where cart_id = (pg_temp.g('g2id') ->> 'id')::uuid), 0, 'G2 sus líneas cayeron en cascada');
select is((select count(*)::int from public.carts where token_hash in (repeat('b3', 32), repeat('b4', 32), repeat('b6', 32), repeat('b7', 32), repeat('a2', 32), repeat('a3', 32))), 6,
  'G2 sobreviven: abandonado de 59 y de 60 días (límite estricto), activo de 90, convertido de 61 y los recién abandonados');
select is((select count(*)::int from public.carts where profile_id = 'a7000000-0000-0000-0000-000000000007' and status = 'abandoned'), 1, 'G2 el carrito ABANDONADO de un usuario (61 días) no se borra: purge es solo de invitados');
select is(public.purge_old_carts(), 0, 'G2 es idempotente');
select is(public.purge_old_carts(interval '58 days'), 2, 'G2 con 58 días de umbral se borran también el de 59 y el de 60 días (2)');
select is((select count(*)::int from public.carts where token_hash in (repeat('b6', 32), repeat('b7', 32))), 2, 'G2 el activo y el convertido siguen sin tocarse');
-- G2b cart_abandon_stale procesa hasta 200 por pasada (el resto cae en la siguiente): 205 carritos de invitado de hace 45 días
insert into public.carts (token_hash, currency, last_activity_at)
select md5('lote' || i) || md5('lote2' || i), 'BOB', now() - interval '45 days' from generate_series(1, 205) i;
select is(public.cart_abandon_stale(), 200, 'G2 cart_abandon_stale abandona como máximo 200 carritos por pasada');
select is(public.cart_abandon_stale(), 5, 'G2 …y la siguiente pasada termina los 5 restantes');
select is(public.cart_abandon_stale(), 0, 'G2 …y la tercera no encuentra nada');
select is((select count(*)::int from public.carts where last_activity_at = now() - interval '45 days' and status = 'abandoned'), 205, 'G2 los 205 quedaron abandonados');

-- G3 desactivar el perfil abandona su carrito y libera lo retenido
select pg_temp.rec('g3', public.cart_set_item('a7000000-0000-0000-0000-000000000009', null, 'f7000000-0000-0000-0013-000000000001', 3));
select is(pg_temp.heldall(pg_temp.uc('a7000000-0000-0000-0000-000000000009')), 3, 'G3 el usuario 09 retiene 3');
select pg_temp.rec('g3id', jsonb_build_object('id', pg_temp.uc('a7000000-0000-0000-0000-000000000009')));
update public.profiles set full_name = 'Nombre nuevo' where id = 'a7000000-0000-0000-0000-000000000009';
select is((select status from public.carts where id = (pg_temp.g('g3id') ->> 'id')::uuid), 'active', 'G3 cambiar otro dato del perfil NO toca el carrito');
update public.profiles set is_active = false where id = 'a7000000-0000-0000-0000-000000000009';
select is((select status from public.carts where id = (pg_temp.g('g3id') ->> 'id')::uuid), 'abandoned', 'G3 desactivar el perfil abandona su carrito');
select is(pg_temp.held((pg_temp.g('g3id') ->> 'id')::uuid, 'f7000000-0000-0000-0013-000000000001'), 0, 'G3 …y libera su stock');
select is((select count(*)::int from public.cart_items where cart_id = (pg_temp.g('g3id') ->> 'id')::uuid), 1, 'G3 …conservando la línea');
select is(public.cart_get('a7000000-0000-0000-0000-000000000009', null) - 'server_time', '{"token_state":"none","cart":null}'::jsonb, 'G3 cart_get ya no encuentra carrito activo');
update public.profiles set is_active = true where id = 'a7000000-0000-0000-0000-000000000009';
select pg_temp.rec('g3b', public.cart_set_item('a7000000-0000-0000-0000-000000000009', null, 'f7000000-0000-0000-0013-000000000001', 1));
select is(jsonb_build_object('new_cart', pg_temp.uc('a7000000-0000-0000-0000-000000000009') <> (pg_temp.g('g3id') ->> 'id')::uuid,
    'active_carts', (select count(*)::int from public.carts where profile_id = 'a7000000-0000-0000-0000-000000000009' and status = 'active')),
  '{"new_cart":true,"active_carts":1}'::jsonb, 'G3 al reactivarse, su primer agregado abre un carrito NUEVO (uno solo activo)');

-- G4 una cuenta desactivada no debería poder abrir un carrito nuevo ni retener stock (S6: «una cuenta desactivada ya no ve ni crea nada»)
select pg_temp.rec('g4', public.cart_set_item('a7000000-0000-0000-0000-000000000012', null, 'f7000000-0000-0000-0010-000000000001', 1));
select pg_temp.rec('g4id', jsonb_build_object('id', pg_temp.uc('a7000000-0000-0000-0000-000000000012')));
update public.profiles set is_active = false where id = 'a7000000-0000-0000-0000-000000000012';
select is((select status from public.carts where id = (pg_temp.g('g4id') ->> 'id')::uuid), 'abandoned', 'G4 desactivar a u12 abandona su carrito');
select pg_temp.rec('g4b', public.cart_set_item('a7000000-0000-0000-0000-000000000012', null, 'f7000000-0000-0000-0010-000000000001', 1));
select is((select count(*)::int from public.carts where profile_id = 'a7000000-0000-0000-0000-000000000012' and status = 'active'), 0,
  'G4 POSIBLE BUG: una cuenta DESACTIVADA no debería poder abrir un carrito nuevo ni retener stock con cart_set_item');
update public.profiles set is_active = true where id = 'a7000000-0000-0000-0000-000000000012';

-- ═══ H. Rangos de los ajustes ═══════════════════════════════════════════════════════════════════
select throws_ok($$update public.store_settings set value = '0' where key = 'cart_max_qty_per_variant'$$, '22023', null, 'H cart_max_qty_per_variant = 0 rechazado');
select throws_ok($$update public.store_settings set value = '1001' where key = 'cart_max_qty_per_variant'$$, '22023', null, 'H cart_max_qty_per_variant = 1001 rechazado');
select lives_ok($$update public.store_settings set value = '1000' where key = 'cart_max_qty_per_variant'$$, 'H cart_max_qty_per_variant = 1000 (máximo) aceptado');
select lives_ok($$update public.store_settings set value = '1' where key = 'cart_max_qty_per_variant'$$, 'H cart_max_qty_per_variant = 1 (mínimo) aceptado');
select throws_ok($$update public.store_settings set value = '0' where key = 'cart_max_lines'$$, '22023', null, 'H cart_max_lines = 0 rechazado');
select throws_ok($$update public.store_settings set value = '101' where key = 'cart_max_lines'$$, '22023', null, 'H cart_max_lines = 101 rechazado');
select lives_ok($$update public.store_settings set value = '100' where key = 'cart_max_lines'$$, 'H cart_max_lines = 100 (máximo) aceptado');
select throws_ok($$update public.store_settings set value = '0' where key = 'cart_max_reserved_units'$$, '22023', null, 'H cart_max_reserved_units = 0 rechazado');
select throws_ok($$update public.store_settings set value = '1001' where key = 'cart_max_reserved_units'$$, '22023', null, 'H cart_max_reserved_units = 1001 rechazado');
select lives_ok($$update public.store_settings set value = '1000' where key = 'cart_max_reserved_units'$$, 'H cart_max_reserved_units = 1000 (máximo) aceptado');
select throws_ok($$update public.store_settings set value = '366' where key = 'price_guarantee_days'$$, '22023', null, 'H price_guarantee_days = 366 rechazado');
select lives_ok($$update public.store_settings set value = '365' where key = 'price_guarantee_days'$$, 'H price_guarantee_days = 365 (máximo) aceptado');
select lives_ok($$update public.store_settings set value = '0' where key = 'price_guarantee_days'$$, 'H price_guarantee_days = 0 (sin garantía) aceptado');
select throws_ok($$update public.store_settings set value = '0' where key = 'guest_cart_retention_days'$$, '22023', null, 'H guest_cart_retention_days = 0 rechazado');
select throws_ok($$update public.store_settings set value = '366' where key = 'guest_cart_retention_days'$$, '22023', null, 'H guest_cart_retention_days = 366 rechazado');
select lives_ok($$update public.store_settings set value = '365' where key = 'guest_cart_retention_days'$$, 'H guest_cart_retention_days = 365 (máximo) aceptado');
select throws_ok($$update public.store_settings set value = '-1' where key = 'cart_max_lines'$$, '22023', null, 'H un entero negativo se rechaza (validador genérico)');
select throws_ok($$update public.store_settings set value = '"abc"' where key = 'cart_max_reserved_units'$$, '22023', null, 'H un texto en un ajuste int se rechaza');
select throws_ok($$update public.store_settings set value = '2.5' where key = 'price_guarantee_days'$$, '22023', null, 'H un decimal en un ajuste int se rechaza');
select throws_ok($$update public.store_settings set value = '"si"' where key = 'reserve_on_add_to_cart'$$, '22023', null, 'H reserve_on_add_to_cart exige un booleano (texto rechazado)');
select throws_ok($$update public.store_settings set value = '1' where key = 'reserve_on_add_to_cart'$$, '22023', null, 'H reserve_on_add_to_cart exige un booleano (número rechazado)');
-- restaurar los valores por defecto
update public.store_settings set value = '10' where key = 'cart_max_qty_per_variant';
update public.store_settings set value = '30' where key = 'cart_max_lines';
update public.store_settings set value = '30' where key = 'cart_max_reserved_units';
update public.store_settings set value = '7' where key = 'price_guarantee_days';
update public.store_settings set value = '30' where key = 'guest_cart_retention_days';
-- los topes se leen del ajuste: con tope de 3 por variante, pedir 5 → 3
update public.store_settings set value = '3' where key = 'cart_max_qty_per_variant';
select pg_temp.rec('h1', public.cart_set_item('a7000000-0000-0000-0000-000000000001', null, 'f7000000-0000-0000-0001-000000000005', 5));
select is(pg_temp.oa(pg_temp.g('h1')), '{"outcome":"capped_variant","applied":3,"requested":5}'::jsonb, 'H con cart_max_qty_per_variant = 3, pedir 5 → capped_variant, aplicadas 3');
select is(pg_temp.g('h1') #> '{cart,limits,max_qty_per_variant}', '3'::jsonb, 'H …y el snapshot informa el tope vigente (3)');
update public.store_settings set value = '10' where key = 'cart_max_qty_per_variant';

-- ═══ I: una bolsa cuyas ÚNICAS líneas no se pueden comprar no tiene nada que retener: estado 'none', sin vencimiento ═══
-- producto 19 (50.00, stock 3): se agrega 1 unidad y luego se despublica → la línea pasa a 'unavailable'
select pg_temp.mk('19', 50.00, 'active', array[3]);
select pg_temp.rec('i1', public.cart_set_item(null, repeat('e9', 32), 'f7000000-0000-0000-0019-000000000001', 1));
select is(pg_temp.g('i1') #> '{cart,reservation,state}', '"held"'::jsonb, 'I antes de despublicar: la línea comprable está retenida (held)');
update public.products set status = 'draft' where id = 'b7000000-0000-0000-0000-000000000019';
select pg_temp.rec('i2', public.cart_get(null, repeat('e9', 32)));
select is(pg_temp.g('i2') #>> '{cart,lines,0,status}', 'unavailable', 'I tras despublicar, la única línea es unavailable');
select is(pg_temp.g('i2') #> '{cart,reservation}', '{"state":"none","expires_at":null}'::jsonb,
  'I sin ninguna línea retenible el estado es none y no hay vencimiento (no "held" con fecha nula)');

-- ═══ J: cupo de unidades retenidas por red (`cart_max_units_per_ip`): lo que acota el acaparamiento aunque se renueve sin fin ═══
-- producto 20 (10.00, stock 40 y 40): v2001 y v2002. Usuarios nuevos 13 (se desactiva) y 14.
select pg_temp.mk('20', 10.00, 'active', array[40, 40]);
insert into auth.users (id, email, raw_user_meta_data, aud, role)
select ('a7000000-0000-0000-0000-0000000000' || i)::uuid, 'cliente' || i || '.s7@test.com', jsonb_build_object('full_name', 'Cliente S7 ' || i), 'authenticated', 'authenticated'
  from unnest(array['13', '14']) i;
select is((select (value #>> '{}') || '/' || value_type || '/' || is_public::text from public.store_settings where key = 'cart_max_units_per_ip'), '150/int/false', 'J el cupo por red existe: 150, entero, no público');
update public.store_settings set value = '5' where key = 'cart_max_units_per_ip';
-- 1) A (red 1…1) retiene 3 de las 5 unidades de cupo
select pg_temp.rec('j1', public.cart_set_item(null, repeat('21', 32), 'f7000000-0000-0000-0020-000000000001', 3, true, repeat('1', 64)));
select is(pg_temp.held(pg_temp.gc(repeat('21', 32)), 'f7000000-0000-0000-0020-000000000001'), 3, 'J1 A retiene 3 (cupo 5 − 0)');
select is((select ip_hash from public.carts where token_hash = repeat('21', 32)), repeat('1', 64), 'J1 el carrito guarda la huella de su red (nunca la IP)');
-- 2) B (misma red) pide 4: solo quedan 5 − 3 = 2 de cupo → se agrega SIN retención (hay stock: 40)
select pg_temp.rec('j2', public.cart_set_item(null, repeat('22', 32), 'f7000000-0000-0000-0020-000000000002', 4, true, repeat('1', 64)));
select is(pg_temp.oa(pg_temp.g('j2')), '{"outcome":"ok","applied":4,"requested":4}'::jsonb, 'J2 B pide 4 sin cupo: se agrega igual (hay stock)');
select is(pg_temp.held(pg_temp.gc(repeat('22', 32)), 'f7000000-0000-0000-0020-000000000002'), 0, 'J2 …pero sin retención (4 > cupo restante 2)');
select is(pg_temp.g('j2') #>> '{cart,reservation,state}', 'expired', 'J2 la interfaz lo ve: retención incompleta (expired) para ofrecer reintentar');
-- 3) refresh retiene hasta el cupo (parcial: 2) y no pasa de ahí ni alarga
select pg_temp.rec('j3', public.cart_refresh(null, repeat('22', 32)));
select is((pg_temp.g('j3') ->> 'renewed')::int, 1, 'J3 refresh retiene lo que cabe en el cupo (renewed = 1)');
select is(pg_temp.held(pg_temp.gc(repeat('22', 32)), 'f7000000-0000-0000-0020-000000000002'), 2, 'J3 …y retiene 2 = min(pedido 4, stock libre 40, cupo restante 2)');
select pg_temp.rec('j3', public.cart_refresh(null, repeat('22', 32)));
select is((pg_temp.g('j3') ->> 'renewed')::int, 0, 'J3 un segundo refresh no renueva nada (2 no es más que lo que ya tiene)');
select is(pg_temp.g('j3') #>> '{cart,reservation,state}', 'expired', 'J3 con retención parcial (2 de 4) el estado sigue siendo expired');
-- el total de la red 1…1 es 3 + 2 = 5 = cupo
select is((select coalesce(sum(r.qty), 0)::int from public.stock_reservations r join public.carts c on c.id = r.owner_id
            where r.owner_type = 'cart' and r.status = 'active' and c.ip_hash = repeat('1', 64)), 5, 'J3 la red 1…1 tiene retenidas 5 = su cupo');
-- 4) otra red NO se ve afectada; un usuario (sin huella) tampoco
select pg_temp.rec('j4', public.cart_set_item(null, repeat('23', 32), 'f7000000-0000-0000-0020-000000000002', 4, true, repeat('2', 64)));
select is(pg_temp.held(pg_temp.gc(repeat('23', 32)), 'f7000000-0000-0000-0020-000000000002'), 4, 'J4 otra red (2…2) retiene sus 4: el cupo es por red');
select pg_temp.rec('j4', public.cart_set_item('a7000000-0000-0000-0000-000000000014', null, 'f7000000-0000-0000-0020-000000000002', 10));
select is(pg_temp.held(pg_temp.uc('a7000000-0000-0000-0000-000000000014'), 'f7000000-0000-0000-0020-000000000002'), 10, 'J4 un usuario con sesión no lleva huella ni cupo por red: retiene 10');
-- 5) repetir la misma cantidad no cuenta contra sí misma; subir por encima del cupo libera la retención de esa línea
select pg_temp.rec('j5', public.cart_set_item(null, repeat('21', 32), 'f7000000-0000-0000-0020-000000000001', 3, true, repeat('1', 64)));
select is(pg_temp.held(pg_temp.gc(repeat('21', 32)), 'f7000000-0000-0000-0020-000000000001'), 3, 'J5 A repite 3: sigue retenido (su propia retención no cuenta contra su cupo: 5 − 2 de B = 3)');
select pg_temp.rec('j5', public.cart_set_item(null, repeat('21', 32), 'f7000000-0000-0000-0020-000000000001', 4, true, repeat('1', 64)));
select is(pg_temp.oa(pg_temp.g('j5')), '{"outcome":"ok","applied":4,"requested":4}'::jsonb, 'J5 A sube a 4: la línea se actualiza');
select is(pg_temp.held(pg_temp.gc(repeat('21', 32)), 'f7000000-0000-0000-0020-000000000001'), 0, 'J5 …pero 4 > cupo (5 − 2 = 3): la retención de esa línea se libera (no se queda con las 3 viejas)');
-- 6) la huella se borra al cerrar el carrito y solo existe en los de invitado
select pg_temp.rec('j6', public.merge_guest_cart('a7000000-0000-0000-0000-000000000014', repeat('21', 32)));
select is((select status || '|' || coalesce(ip_hash, 'sin huella') from public.carts where token_hash = repeat('21', 32)), 'merged|sin huella', 'J6 al fusionar, el carrito de invitado queda merged y sin huella de red');
update public.carts set last_activity_at = now() - interval '40 days' where token_hash = repeat('23', 32);
select public.cart_abandon_stale();
select is((select status || '|' || coalesce(ip_hash, 'sin huella') from public.carts where token_hash = repeat('23', 32)), 'abandoned|sin huella', 'J6 al abandonar por inactividad, también sin huella');
select throws_ok($$insert into public.carts (profile_id, currency, ip_hash) values ('a7000000-0000-0000-0000-000000000013', 'BOB', repeat('1', 64))$$, '23514', null, 'J6 un carrito de USUARIO no puede llevar huella de red');
select throws_ok($$insert into public.carts (token_hash, currency, ip_hash) values (repeat('2b', 32), 'BOB', 'no-es-hex')$$, '23514', null, 'J6 la huella tiene que ser hexadecimal de 64');
-- rangos del ajuste
select throws_ok($$update public.store_settings set value = '0' where key = 'cart_max_units_per_ip'$$, '22023', null, 'J el cupo por red 0 se rechaza');
select throws_ok($$update public.store_settings set value = '10001' where key = 'cart_max_units_per_ip'$$, '22023', null, 'J el cupo por red 10001 se rechaza');
select lives_ok($$update public.store_settings set value = '10000' where key = 'cart_max_units_per_ip'$$, 'J el cupo por red 10000 se acepta');
update public.store_settings set value = '150' where key = 'cart_max_units_per_ip';

-- ═══ K: pedir algo que no existe NO deja un carrito vacío (se valida la variante antes de crear el carrito) ═══
select pg_temp.rec('k1', public.cart_set_item(null, repeat('24', 32), '00000000-0000-4000-8000-0000000000aa', 1));
select is(pg_temp.oa(pg_temp.g('k1')), '{"outcome":"unavailable","applied":0,"requested":1}'::jsonb, 'K variante inexistente → unavailable');
select is((select count(*)::int from public.carts where token_hash = repeat('24', 32)), 0, 'K …y no se creó ningún carrito');
select pg_temp.rec('k2', public.cart_set_item(null, repeat('25', 32), 'f7000000-0000-0000-0002-000000000001', 1));
select is((select count(*)::int from public.carts where token_hash = repeat('25', 32)), 0, 'K producto en borrador al estrenar: unavailable y sin carrito');
select pg_temp.rec('k3', public.cart_set_item(null, repeat('26', 32), 'f7000000-0000-0000-0001-000000000006', 1));
select is((select count(*)::int from public.carts where token_hash = repeat('26', 32)), 0, 'K variante archivada al estrenar: unavailable y sin carrito');
select pg_temp.rec('k4', public.cart_set_item(null, repeat('27', 32), 'f7000000-0000-0000-0020-000000000001', 1));
select is((select count(*)::int from public.carts where token_hash = repeat('27', 32)), 1, 'K con una variante válida, el carrito sí se crea');
select is(pg_temp.g('k1') -> 'cart', 'null'::jsonb, 'K la respuesta de lo inexistente trae cart = null');

-- ═══ L: fusionar con una cuenta DESACTIVADA no falla ni toca nada ═══
update public.profiles set is_active = false where id = 'a7000000-0000-0000-0000-000000000013';
select pg_temp.rec('l1', public.cart_set_item(null, repeat('28', 32), 'f7000000-0000-0000-0020-000000000001', 2));
select pg_temp.rec('l1', public.cart_set_item(null, repeat('28', 32), 'f7000000-0000-0000-0020-000000000002', 1));
select lives_ok($$select public.merge_guest_cart('a7000000-0000-0000-0000-000000000013', repeat('28', 32))$$, 'L fusionar para una cuenta desactivada no lanza error');
select pg_temp.rec('l2', public.merge_guest_cart('a7000000-0000-0000-0000-000000000013', repeat('28', 32)));
select is(jsonb_build_object('token_state', pg_temp.g('l2') -> 'token_state', 'merged', pg_temp.g('l2') -> 'merged', 'cart', pg_temp.g('l2') -> 'cart'),
  '{"token_state":"none","merged":false,"cart":null}'::jsonb, 'L responde «nada que fusionar» y ningún carrito');
select is((select status from public.carts where token_hash = repeat('28', 32)), 'active', 'L el carrito de invitado queda activo e intacto');
select is((select count(*)::int from public.cart_items where cart_id = pg_temp.gc(repeat('28', 32))), 2, 'L …con sus 2 líneas');
select is(pg_temp.heldall(pg_temp.gc(repeat('28', 32))), 3, 'L …y sus retenciones (2 + 1)');
select is((select count(*)::int from public.carts where profile_id = 'a7000000-0000-0000-0000-000000000013'), 0, 'L la cuenta desactivada no se llevó un carrito nuevo');
-- carrito de invitado VACÍO (todas sus líneas quitadas) con cuenta desactivada: tampoco falla (antes: error 23514)
select pg_temp.rec('l3', public.cart_set_item(null, repeat('29', 32), 'f7000000-0000-0000-0020-000000000001', 1));
select pg_temp.rec('l3', public.cart_set_item(null, repeat('29', 32), 'f7000000-0000-0000-0020-000000000001', 0));
select lives_ok($$select public.merge_guest_cart('a7000000-0000-0000-0000-000000000013', repeat('29', 32))$$, 'L con el carrito de invitado vacío tampoco lanza error');

select pg_temp.mk('21', 10.00, 'active', array[2]);
-- ═══ M: el carrito no revela el stock exacto: `available` no pasa del máximo por variante ═══
-- v1301 tiene stock 30: con tope 10 se ve 10 (no 30); con tope 3 se ve 3; una línea con poco stock (v2101: 2) muestra 2
select pg_temp.rec('m1', public.cart_set_item(null, repeat('2a', 32), 'f7000000-0000-0000-0013-000000000001', 1));
select is(pg_temp.lin(pg_temp.g('m1'), 'f7000000-0000-0000-0013-000000000001') -> 'available', '10'::jsonb, 'M stock libre 30, tope 10: available = 10 (no revela 30)');
update public.store_settings set value = '3' where key = 'cart_max_qty_per_variant';
select pg_temp.rec('m2', public.cart_get(null, repeat('2a', 32)));
select is(pg_temp.lin(pg_temp.g('m2'), 'f7000000-0000-0000-0013-000000000001') -> 'available', '3'::jsonb, 'M con tope 3: available = 3');
update public.store_settings set value = '10' where key = 'cart_max_qty_per_variant';
select pg_temp.rec('m3', public.cart_set_item(null, repeat('2a', 32), 'f7000000-0000-0000-0021-000000000001', 1));
select is(pg_temp.lin(pg_temp.g('m3'), 'f7000000-0000-0000-0021-000000000001') -> 'available', '2'::jsonb, 'M con poco stock (2 < tope 10) se ve el real: 2');

-- ═══ N: el candado con revalidación (cierra la carrera «resolví el carrito, otro lo cerró, y luego tomé el candado») ═══
select is(public._cart_lock_active(pg_temp.gc(repeat('27', 32))), true, 'N un carrito activo toma el candado y devuelve true');
select is(public._cart_lock_active(pg_temp.gc(repeat('21', 32))), false, 'N uno ya fusionado devuelve false (no se le agrega ni retiene nada)');

-- ═══ P: lo recordado al quitar se limpia solo ═══
insert into public.cart_removed_items (cart_id, variant_id, unit_price_at_add, added_at, price_locked_until, removed_at)
values (pg_temp.gc(repeat('27', 32)), 'f7000000-0000-0000-0020-000000000002', 10, now(), now() + interval '1 day', now() - interval '2 days'),
       (pg_temp.gc(repeat('27', 32)), 'f7000000-0000-0000-0020-000000000001'::uuid, 10, now(), now() + interval '1 day', now());
select public.cart_abandon_stale();
select is((select count(*)::int from public.cart_removed_items where cart_id = pg_temp.gc(repeat('27', 32))), 1, 'P la limpieza borra lo recordado hace más de un día y conserva lo reciente');

-- ═══ Q: permisos de la tabla nueva ═══
select is(has_table_privilege('anon', 'public.cart_removed_items', 'select'), false, 'Q anon no lee lo recordado');
select is((select bool_or(has_table_privilege('service_role', 'public.cart_removed_items', priv)) from unnest(array['insert', 'update', 'delete']) priv), false, 'Q ni service_role escribe directo en lo recordado');
select is((select relrowsecurity from pg_class where oid = 'public.cart_removed_items'::regclass), true, 'Q la tabla tiene RLS activa');

-- ═══ Invariante global: ninguna variante tiene más unidades retenidas (vigentes) que stock físico ═══
select is((select count(*)::int from public.product_variants v join public.products p on p.id = v.product_id
            where p.code like 'S7-%'
              and (select coalesce(sum(r.qty), 0) from public.stock_reservations r
                    where r.variant_id = v.id and r.status = 'active' and (r.expires_at is null or r.expires_at > now())) > v.stock_on_hand),
  0, 'INVARIANTE S2: al terminar, ninguna variante tiene más retenido que stock físico');

select * from finish();
rollback;
