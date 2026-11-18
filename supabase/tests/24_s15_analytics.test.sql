-- Sprint 15 · Fase D — Analítica y atribución: los dos ajustes públicos (con su validación), la tabla `order_attribution` (nadie la toca
-- directo), `record_order_attribution` (solo la dueña del pedido, una vez, solo pedidos recientes, todo limpio y acotado) y
-- `admin_attribution_summary` (ventas por origen con la MISMA definición de «venta» que el resto). Los valores esperados se calcularon
-- A MANO (la cuenta va en el comentario). Todo ocurre en una transacción que se revierte.
--
-- HERMÉTICO: los pedidos de prueba tienen fecha de MARZO DE 2021 (la nube no tiene nada de esa época).
-- Fixture: un administrador (u1) y dos clientas (u2, u3) · pedidos en BOB salvo N6 (USD):
--   N1 u2 02-mar paid       100  facebook / cpc / lanzamiento          N2 u2 03-mar paid       50   facebook / cpc / lanzamiento
--   N3 u3 04-mar paid        80  google / organic / (sin campaña)      N4 u3 05-mar completed  70   SIN origen
--   N5 u3 06-mar cancelled   90  facebook / cpc / lanzamiento → NO es venta
--   N6 u2 06-mar paid USD    10  facebook / cpc / lanzamiento → otra moneda, otro renglón
--   N7 u2 HOY pending_payment 40 (reciente: para probar el registro del origen)
-- Esperado (1–31 de marzo): BOB facebook/cpc/lanzamiento 2 pedidos, bruto 150, neto 150 · BOB google/organic 1, 80 · BOB sin origen 1, 70 · USD facebook 1, 10.
begin;
select plan(55);

create function pg_temp.u(n int) returns uuid language sql as $$ select ('a4000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.o(n int) returns uuid language sql as $$ select ('c4000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.num(n int) returns text language sql as $$ select 'MIC-9240' || lpad(n::text, 2, '0') $$;
create function pg_temp.as_(p_uid uuid) returns void language sql as
  $$ select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p_uid), true) $$;
create function pg_temp.anon_() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"anon"}', true) $$;

create function pg_temp.mk(p_n int, p_u int, p_status text, p_total numeric, p_created timestamptz, p_currency text default 'BOB') returns void language plpgsql as $$
begin
  insert into public.orders select * from jsonb_populate_record(null::public.orders, jsonb_build_object(
    'id', pg_temp.o(p_n), 'number', pg_temp.num(p_n), 'profile_id', pg_temp.u(p_u), 'status', p_status,
    'currency', p_currency, 'base_currency', 'BOB', 'exchange_rate', case when p_currency = 'USD' then 0.125 else 1 end, 'country', 'BO',
    'subtotal', p_total, 'discount_total', 0, 'shipping_cost', 0, 'shipping_discount', 0, 'total', p_total, 'tax_included', true,
    'contact_name', 'Clienta ' || p_u, 'contact_email', 'u0' || p_u || '.s15a@test.com', 'contact_phone', '+5917000000' || p_u,
    'shipping_method', jsonb_build_object('code', 'delivery', 'name', 'A domicilio', 'kind', 'delivery'),
    'payment_method', 'whatsapp', 'payment_provider', 'whatsapp', 'discounts', '[]'::jsonb, 'idempotency_key', 'key-s15a-' || p_n,
    'channel', 'web', 'edit_count', 0, 'created_at', p_created, 'updated_at', p_created,
    'paid_at', case when p_status in ('paid', 'completed') then p_created end,
    'cancelled_at', case when p_status = 'cancelled' then p_created end, 'cancelled_by', case when p_status = 'cancelled' then 'admin' end));
end;
$$;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  (pg_temp.u(1), 'admin.s15a@test.com', '{"full_name":"Admin S15A"}', 'authenticated', 'authenticated'),
  (pg_temp.u(2), 'c1.s15a@test.com', '{"full_name":"Clienta Uno S15A"}', 'authenticated', 'authenticated'),
  (pg_temp.u(3), 'c2.s15a@test.com', '{"full_name":"Clienta Dos S15A"}', 'authenticated', 'authenticated');
select public.set_user_role(pg_temp.u(1), 'admin');

select pg_temp.mk(1, 2, 'paid', 100, '2021-03-02 14:00+00');
select pg_temp.mk(2, 2, 'paid', 50, '2021-03-03 14:00+00');
select pg_temp.mk(3, 3, 'paid', 80, '2021-03-04 14:00+00');
select pg_temp.mk(4, 3, 'completed', 70, '2021-03-05 14:00+00');
select pg_temp.mk(5, 3, 'cancelled', 90, '2021-03-06 14:00+00');
select pg_temp.mk(6, 2, 'paid', 10, '2021-03-06 15:00+00', 'USD');
select pg_temp.mk(7, 2, 'pending_payment', 40, now());
-- el origen de los pedidos viejos se inserta directo (la función solo anota pedidos de las últimas 24 horas)
insert into public.order_attribution (order_id, utm_source, utm_medium, utm_campaign) values
  (pg_temp.o(1), 'facebook', 'cpc', 'lanzamiento'), (pg_temp.o(2), 'facebook', 'cpc', 'lanzamiento'),
  (pg_temp.o(3), 'google', 'organic', null), (pg_temp.o(5), 'facebook', 'cpc', 'lanzamiento'),
  (pg_temp.o(6), 'facebook', 'cpc', 'lanzamiento');
-- N2 (50) devolvió 10 (reembolso solicitado: cuenta como devuelto): su neto es 40, no 50
insert into public.payments (order_id, provider, method, status, amount, currency, paid_at)
  values (pg_temp.o(2), 'whatsapp', 'whatsapp', 'paid', 50, 'BOB', '2021-03-03 14:00+00');
insert into public.refunds (order_id, payment_id, kind, amount, shipping_amount, deduction, currency, reason, status, method, idempotency_key)
select pg_temp.o(2), p.id, 'amount', 10, 0, 0, 'BOB', 'cortesía por demora', 'requested', 'cash', 'rf-s15a-0001'
  from public.payments p where p.order_id = pg_temp.o(2);
select pg_temp.as_(pg_temp.u(1));

-- ═══ A. Ajustes públicos y su validación ══════════════════════════════════════════════════
select is((select string_agg(key || '=' || (value #>> '{}'), ',' order by key) from public.store_settings
            where key in ('analytics_meta_pixel_id', 'analytics_ga4_id') and (value #>> '{}') = ''), 'analytics_ga4_id=,analytics_meta_pixel_id=',
          'A1: nacen VACÍOS (sin analítica hasta que el dueño ponga los IDs)');
select is((select count(*)::int from public.store_settings where key in ('analytics_meta_pixel_id', 'analytics_ga4_id') and is_public), 2,
          'A2: y son públicos (la tienda los lee para saber si carga algo)');
select lives_ok($$update public.store_settings set value = '"1234567890123"' where key = 'analytics_meta_pixel_id'$$, 'A3: un Pixel de 13 dígitos se acepta');
select lives_ok($$update public.store_settings set value = '"G-ABC123DEF4"' where key = 'analytics_ga4_id'$$, 'A4: un ID de GA4 válido se acepta');
select lives_ok($$update public.store_settings set value = '""' where key = 'analytics_meta_pixel_id'$$, 'A5: y vaciarlo apaga el Pixel');
select throws_ok($$update public.store_settings set value = '"abc"' where key = 'analytics_meta_pixel_id'$$, '22023', null, 'A6: el Pixel con letras se rechaza');
select throws_ok($$update public.store_settings set value = '"1234567"' where key = 'analytics_meta_pixel_id'$$, '22023', null, 'A7: ni con menos de 8 dígitos');
select throws_ok($$update public.store_settings set value = '"123456789012345678901"' where key = 'analytics_meta_pixel_id'$$, '22023', null, 'A8: ni con más de 20');
select throws_ok($$update public.store_settings set value = '"UA-12345-1"' where key = 'analytics_ga4_id'$$, '22023', null, 'A9: un ID de Universal Analytics (UA-) no vale: ya no existe');
select throws_ok($$update public.store_settings set value = '"g-abc123def4"' where key = 'analytics_ga4_id'$$, '22023', null, 'A10: GA4 en minúsculas se rechaza (el ID es en mayúsculas)');
select throws_ok($$update public.store_settings set value = '"G-<script>"' where key = 'analytics_ga4_id'$$, '22023', null, 'A11: y nada que no sea un ID (no se cuela código en la página)');
select throws_ok($$update public.store_settings set value = '12345678' where key = 'analytics_meta_pixel_id'$$, '22023', null, 'A12: el valor tiene que ser un TEXTO, no un número');
select throws_ok($$update public.store_settings set value = '"abcdefgh12"' where key = 'analytics_meta_pixel_id'$$, '22023', null, 'A13: un Pixel con letras y del largo correcto (10) tampoco');
select throws_ok($$update public.store_settings set value = '"X-ABC123DEF4"' where key = 'analytics_ga4_id'$$, '22023', null, 'A14: un ID de medición con otro prefijo (X-) se rechaza: solo «G-»');
select throws_ok($$update public.store_settings set value = '"G-abc123def4"' where key = 'analytics_ga4_id'$$, '22023', null, 'A15: y con el cuerpo en minúsculas (G-abc123def4)');

-- ═══ B. Estructura y permisos ═════════════════════════════════════════════════════════════
select is((select c.relrowsecurity from pg_class c where c.oid = 'public.order_attribution'::regclass), true, 'B1: order_attribution tiene RLS activa');
select is((select count(*)::int from information_schema.role_table_grants g
            where g.table_schema = 'public' and g.table_name = 'order_attribution' and g.grantee in ('anon', 'authenticated', 'service_role')), 0,
          'B2: ni anon, ni authenticated, ni service_role tocan la tabla (solo las funciones)');
select is((select has_function_privilege('authenticated', 'public.record_order_attribution(text, jsonb)', 'execute')
              and not has_function_privilege('anon', 'public.record_order_attribution(text, jsonb)', 'execute')
              and not has_function_privilege('service_role', 'public.record_order_attribution(text, jsonb)', 'execute')), true,
          'B3: anotar el origen lo ejecuta quien tiene sesión (no anon ni el servicio)');
select is((select has_function_privilege('authenticated', 'public.admin_attribution_summary(date, date)', 'execute')
              and not has_function_privilege('anon', 'public.admin_attribution_summary(date, date)', 'execute')
              and not has_function_privilege('service_role', 'public.admin_attribution_summary(date, date)', 'execute')), true,
          'B4: el resumen lo ejecuta authenticated (y adentro exige ser admin), no anon ni el servicio');
select is((select has_function_privilege('authenticated', 'public._attr_text(jsonb, text)', 'execute')
              or has_function_privilege('anon', 'public._attr_text(jsonb, text)', 'execute')), false, 'B5: la función de limpieza es interna');
select is((select has_function_privilege('authenticated', 'public.store_settings_validate_s15()', 'execute')), false, 'B6: ni el validador de ajustes');

-- ═══ C. record_order_attribution ══════════════════════════════════════════════════════════
select pg_temp.anon_();
select throws_ok(format($$select public.record_order_attribution(%L, '{"utm_source":"x"}')$$, pg_temp.num(7)), '42501', 'login_required', 'C1: sin sesión no se anota nada');
select pg_temp.as_(pg_temp.u(3));
select throws_ok(format($$select public.record_order_attribution(%L, '{"utm_source":"x"}')$$, pg_temp.num(7)), '22023', 'order_not_found', 'C2: el pedido de OTRA persona no se toca (parece que no existe)');
select pg_temp.as_(pg_temp.u(2));
select throws_ok($$select public.record_order_attribution('MIC-999999', '{"utm_source":"x"}')$$, '22023', 'order_not_found', 'C3: un pedido que no existe');
select throws_ok(format($$select public.record_order_attribution(%L, '{"utm_source":"x"}')$$, pg_temp.num(4)), '22023', 'order_not_found', 'C4: ni uno ajeno (N4 es de u3)');
select throws_ok(format($$select public.record_order_attribution(%L, '{"utm_source":"x"}')$$, pg_temp.num(2)), '22023', 'order_too_old', 'C5: el pedido propio de hace años ya no se anota (solo las primeras 24 horas)');
select throws_ok(format($$select public.record_order_attribution(%L, '[1,2]')$$, pg_temp.num(7)), '22023', 'invalid_data', 'C6: los datos tienen que ser un objeto');
select throws_ok(format($$select public.record_order_attribution(%L, null)$$, pg_temp.num(7)), '22023', 'invalid_data', 'C7: ni nulos');
select lives_ok(format($$select public.record_order_attribution(%L, %L::jsonb)$$, pg_temp.num(7),
  jsonb_build_object('utm_source', '  Facebook ', 'utm_medium', 'CPC', 'utm_campaign', E'lan\u0007zamiento', 'utm_content', repeat('x', 300),
                     'utm_term', 5, 'click_id_kind', 'fbclid', 'landing_path', '/producto/blusa', 'referrer_host', 'L.Facebook.com',
                     'fbclid', 'IwAR0-secreto', 'otro', 'ignorado')), 'C8: la dueña anota el origen de su pedido reciente (y los campos que no conoce se ignoran)');
select is((select utm_source || '|' || utm_medium || '|' || utm_campaign from public.order_attribution where order_id = pg_temp.o(7)),
          'facebook|cpc|lanzamiento', 'C9: se guarda limpio: sin espacios, en minúsculas y sin caracteres de control');
select is((select char_length(utm_content) from public.order_attribution where order_id = pg_temp.o(7)), 100, 'C10: un texto largo se corta a 100 caracteres');
select is((select utm_term from public.order_attribution where order_id = pg_temp.o(7)), null, 'C11: un valor que no es texto (5) se descarta');
select is((select click_id_kind || '|' || landing_path || '|' || referrer_host from public.order_attribution where order_id = pg_temp.o(7)),
          'fbclid|/producto/blusa|l.facebook.com', 'C12: tipo de clic, página de entrada y sitio de procedencia (en minúsculas)');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'order_attribution'
            and column_name ~ '(fbclid|gclid)$' and column_name <> 'click_id_kind'), 0, 'C13: NO existe dónde guardar el identificador del clic (solo de qué tipo era)');
select lives_ok(format($$select public.record_order_attribution(%L, '{"utm_source":"google","utm_medium":"cpc"}')$$, pg_temp.num(7)), 'C14: anotar de nuevo no falla…');
select is((select utm_source from public.order_attribution where order_id = pg_temp.o(7)), 'facebook', 'C15: …pero NO pisa lo primero (una sola vez)');
select is((select count(*)::int from public.order_attribution where order_id = pg_temp.o(7)), 1, 'C16: hay UNA fila por pedido');

-- datos sucios: se descartan los campos malos, no el pedido
select pg_temp.mk(8, 2, 'pending_payment', 10, now());
select lives_ok(format($$select public.record_order_attribution(%L, %L::jsonb)$$, pg_temp.num(8),
  '{"utm_source":"tiktok","landing_path":"sin-barra","referrer_host":"evil.com/ruta con espacios","click_id_kind":"otro"}'), 'C17: campos malos no tumban el registro');
select is((select utm_source || '|' || coalesce(landing_path, '·') || '|' || coalesce(referrer_host, '·') || '|' || coalesce(click_id_kind, '·')
             from public.order_attribution where order_id = pg_temp.o(8)), 'tiktok|·|·|·',
          'C18: una ruta sin «/», un sitio con caracteres raros y un tipo de clic desconocido quedan en blanco');
select pg_temp.mk(9, 2, 'pending_payment', 10, now());
select lives_ok(format($$select public.record_order_attribution(%L, '{}')$$, pg_temp.num(9)), 'C19: un objeto vacío (llegó directo) se anota sin nada');
select is((select concat_ws('|', utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_id_kind, landing_path, referrer_host)
             from public.order_attribution where order_id = pg_temp.o(9)), '', 'C20: y queda todo en blanco');

-- ═══ D. admin_attribution_summary ═════════════════════════════════════════════════════════
select pg_temp.as_(pg_temp.u(2));
select throws_ok($$select * from public.admin_attribution_summary('2021-03-01', '2021-03-31')$$, '42501', 'solo administradores', 'D1: una clienta no ve las ventas por origen');
select pg_temp.anon_();
select throws_ok($$select * from public.admin_attribution_summary('2021-03-01', '2021-03-31')$$, '42501', 'solo administradores', 'D2: ni sin sesión');
select pg_temp.as_(pg_temp.u(1));
select throws_ok($$select * from public.admin_attribution_summary('2021-04-01', '2021-03-01')$$, '22023', 'invalid_range', 'D3: un rango al revés se rechaza');
select is((select count(*)::int from public.admin_attribution_summary('2021-03-01', '2021-03-31')), 4, 'D4: 4 renglones: tres en BOB y uno en USD');
select is((select orders || '/' || gross || '/' || net from public.admin_attribution_summary('2021-03-01', '2021-03-31')
            where currency = 'BOB' and utm_source = 'facebook' and utm_medium = 'cpc' and utm_campaign = 'lanzamiento'), '2/150/140',
          'D5: facebook/cpc/lanzamiento en BOB: 2 pedidos (N1 y N2), bruto 100 + 50 = 150 y NETO 100 + (50 − 10 devueltos) = 140 (N5 cancelado NO cuenta)');
select is((select orders || '/' || net from public.admin_attribution_summary('2021-03-01', '2021-03-31')
            where currency = 'BOB' and utm_source = 'google' and utm_medium = 'organic' and utm_campaign is null), '1/80', 'D6: google/organic sin campaña: 1 pedido de 80');
select is((select orders || '/' || net from public.admin_attribution_summary('2021-03-01', '2021-03-31')
            where currency = 'BOB' and utm_source is null and utm_medium is null and utm_campaign is null), '1/70', 'D7: sin origen (N4, completado): 1 pedido de 70');
select is((select orders || '/' || net from public.admin_attribution_summary('2021-03-01', '2021-03-31')
            where currency = 'USD' and utm_source = 'facebook'), '1/10', 'D8: el pedido en USD es OTRO renglón (nunca se suman monedas)');
select is((select string_agg(coalesce(utm_source, '·'), ',') from (select * from public.admin_attribution_summary('2021-03-01', '2021-03-31') where currency = 'BOB') x),
          'facebook,google,·', 'D9: ordenado por neto de mayor a menor (150, 80, 70)');
select is((select sum(net) from public.admin_attribution_summary('2021-03-01', '2021-03-31') where currency = 'BOB'),
          (select sum(s.net) from public._sales_orders('2021-03-01'::timestamp at time zone 'America/La_Paz', '2021-04-01'::timestamp at time zone 'America/La_Paz') s where s.currency = 'BOB'),
          'D10: la suma por origen es EXACTAMENTE la de «venta» (una sola definición: _sales_orders)');
select is((select count(*)::int from public.admin_attribution_summary('2021-03-02', '2021-03-02')), 1, 'D11: un solo día: solo N1 (02-mar)');
select is((select count(*)::int from public.admin_attribution_summary('2021-03-07', '2021-03-31')), 0, 'D12: un rango sin ventas no devuelve renglones');

-- ═══ E. El origen es del pedido ═══════════════════════════════════════════════════════════
-- Si el pedido desaparece (las suites de prueba limpian la tabla de pedidos; en producción no se borra) su origen se va con él y no lo impide.
alter table public.orders disable trigger user;
delete from public.orders where id = pg_temp.o(8);
alter table public.orders enable trigger user;
select is((select count(*)::int from public.order_attribution where order_id = pg_temp.o(8)), 0, 'E1: al borrar un pedido, su origen se va con él (no impide limpiar pedidos)');
select is((select count(*)::int from public.order_attribution where order_id = pg_temp.o(7)), 1, 'E2: y el de los demás pedidos se queda');

select * from finish();
rollback;
