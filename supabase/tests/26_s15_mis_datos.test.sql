-- Sprint 15 · Fase B — Exportar los datos personales (`my_data_export`): solo para quien tiene sesión; devuelve TODO lo propio (perfil,
-- direcciones, datos fiscales, pedidos con líneas, cobros e historial, lo aceptado, preferencias y reclamos) y NADA que no deba salir del
-- negocio ni de otra persona: ni el costo de los productos, ni la llave de idempotencia, ni la huella de red, ni el rol, ni lo de otras
-- clientas. Todo ocurre en una transacción que se revierte.
--
-- Fixture: u1 (la que exporta: dirección, dato fiscal, preferencias, un pedido con 2 líneas con costo, un cobro, un cambio de estado,
-- una aceptación con huella y un reclamo) y u2 (otra clienta con sus propios datos).
begin;
select plan(33);

create function pg_temp.u(n int) returns uuid language sql as $$ select ('a6000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.as_(p_uid uuid) returns void language sql as
  $$ select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p_uid), true) $$;
create function pg_temp.anon_() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"anon"}', true) $$;
create temp table t_r (k text primary key, v jsonb);
create function pg_temp.x() returns jsonb language sql as $$ select v from t_r where k = 'x' $$;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  (pg_temp.u(1), 'u1.s15d@test.com', '{"full_name":"Clienta Uno S15D"}', 'authenticated', 'authenticated'),
  (pg_temp.u(2), 'u2.s15d@test.com', '{"full_name":"Clienta Dos S15D"}', 'authenticated', 'authenticated');
select public.set_user_role(pg_temp.u(1), 'customer');

-- producto con costo (lo que NO debe salir)
insert into public.products (id, code, slug, name) values ('b6000000-0000-0000-0000-000000000001', 'S15D-01', 's15d-01', 'Producto S15D');
insert into public.product_colors (id, product_id, name) values ('d6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'Rojo');
insert into public.product_prices (product_id, currency, amount) values ('b6000000-0000-0000-0000-000000000001', 'BOB', 100);
insert into public.product_sizes (id, product_id, label) values ('e6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'M');
insert into public.product_variants (id, product_id, color_id, size_id) values
  ('f6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001');

insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city, country, lat, lng) values
  (pg_temp.u(1), 'Casa', 'Clienta Uno', '+59171111111', 'Calle Secreta Uno 111', 'La Paz', 'BO', -16.5, -68.1),
  (pg_temp.u(2), 'Casa', 'Clienta Dos', '+59172222222', 'Calle Secreta Dos 222', 'La Paz', 'BO', -16.5, -68.1);
insert into public.tax_profiles (profile_id, doc_type, doc_number, legal_name) values
  (pg_temp.u(1), 'nit', '1020304050', 'Uno SRL'), (pg_temp.u(2), 'nit', '9999999999', 'Dos SRL');
insert into public.notification_preferences (profile_id, preferred_channel) values (pg_temp.u(1), 'email'), (pg_temp.u(2), 'whatsapp')
  on conflict (profile_id) do update set preferred_channel = excluded.preferred_channel;

create function pg_temp.mko(p_n int, p_u int) returns void language plpgsql as $$
begin
  insert into public.orders select * from jsonb_populate_record(null::public.orders, jsonb_build_object(
    'id', ('c6000000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0'))::uuid, 'number', 'MIC-9260' || lpad(p_n::text, 2, '0'),
    'profile_id', pg_temp.u(p_u), 'status', 'paid', 'currency', 'BOB', 'base_currency', 'BOB', 'exchange_rate', 1, 'country', 'BO',
    'subtotal', 300, 'discount_total', 0, 'shipping_cost', 15, 'shipping_discount', 0, 'total', 315, 'tax_included', true,
    'contact_name', 'Clienta ' || p_u, 'contact_email', 'u' || p_u || '.s15d@test.com', 'contact_phone', '+5917000000' || p_u,
    'shipping_method', jsonb_build_object('code', 'delivery', 'name', 'A domicilio', 'kind', 'delivery'),
    'shipping_address', jsonb_build_object('line1', 'Calle Secreta ' || p_u),
    'payment_method', 'whatsapp', 'payment_provider', 'whatsapp', 'discounts', '[]'::jsonb,
    'idempotency_key', 'llave-secreta-s15d-' || p_n, 'request_hash', 'hash-secreto-' || p_n,
    'channel', 'web', 'edit_count', 0, 'created_at', now() - interval '2 days', 'updated_at', now() - interval '2 days', 'paid_at', now() - interval '2 days'));
  insert into public.order_items (order_id, line_no, variant_id, product_id, product_name, color_name, size_label, qty, unit_price, line_total, discount, final_total, cost_unit)
  values (('c6000000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0'))::uuid, 1, 'f6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'Producto S15D', 'Rojo', 'M', 2, 100, 200, 0, 200, 61.5),
         (('c6000000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0'))::uuid, 2, 'f6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'Producto S15D', 'Rojo', 'M', 1, 100, 100, 0, 100, 61.5);
  insert into public.payments (order_id, provider, method, status, amount, currency, paid_at)
  values (('c6000000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0'))::uuid, 'whatsapp', 'whatsapp', 'paid', 315, 'BOB', now() - interval '2 days');
end $$;
select pg_temp.mko(1, 1);
select pg_temp.mko(2, 2);
insert into public.order_status_history (order_id, from_status, to_status, actor_kind) values
  ('c6000000-0000-0000-0000-000000000001', 'pending_payment', 'paid', 'system'),
  ('c6000000-0000-0000-0000-000000000002', 'pending_payment', 'paid', 'system');
alter table public.legal_acceptances disable trigger legal_acceptances_immutable;
insert into public.legal_acceptances (profile_id, context, kind, version, ip_hash) values
  (pg_temp.u(1), 'register', 'terms', 1, repeat('a', 64)), (pg_temp.u(1), 'register', 'privacy', 1, repeat('a', 64)),
  (pg_temp.u(2), 'register', 'terms', 1, repeat('b', 64));
alter table public.legal_acceptances enable trigger legal_acceptances_immutable;
insert into public.complaints (profile_id, contact_name, contact_email, kind, detail, due_at, ip_hash) values
  (pg_temp.u(1), 'Clienta Uno', 'u1.s15d@test.com', 'product', 'Mi reclamo de la clienta uno con más de veinte caracteres.', now() + interval '10 days', repeat('c', 64)),
  (pg_temp.u(2), 'Clienta Dos', 'u2.s15d@test.com', 'other', 'El reclamo de la clienta dos con más de veinte caracteres.', now() + interval '10 days', repeat('d', 64)),
  (null, 'Anónimo', 'anon@example.com', 'other', 'Un reclamo anónimo con más de veinte caracteres de largo.', now() + interval '10 days', repeat('e', 64));

-- ═══ A. Permisos ═════════════════════════════════════════════════════════════════════════
select is((select has_function_privilege('authenticated', 'public.my_data_export()', 'execute')
              and not has_function_privilege('anon', 'public.my_data_export()', 'execute')
              and not has_function_privilege('service_role', 'public.my_data_export()', 'execute')), true,
          'A1: la ejecuta quien tiene sesión; no anon ni el servicio');
select pg_temp.anon_();
select throws_ok($$select public.my_data_export()$$, '42501', 'login_required', 'A2: sin sesión no devuelve nada');

-- ═══ B. Lo que SÍ trae ═══════════════════════════════════════════════════════════════════
select pg_temp.as_(pg_temp.u(1));
insert into t_r select 'x', public.my_data_export();
select is(pg_temp.x() ->> 'format_version', '1', 'B1: lleva su versión de formato');
select ok((pg_temp.x() ->> 'generated_at')::timestamptz between now() - interval '1 minute' and now() + interval '1 minute', 'B2: y la fecha en que se generó');
select is(pg_temp.x() -> 'profile' ->> 'full_name', 'Clienta Uno S15D', 'B3: su perfil');
select is(pg_temp.x() -> 'profile' ->> 'email', 'u1.s15d@test.com', 'B4: con su correo');
select is(jsonb_array_length(pg_temp.x() -> 'addresses'), 1, 'B5: sus direcciones (1)');
select is(pg_temp.x() -> 'addresses' -> 0 ->> 'line1', 'Calle Secreta Uno 111', 'B6: con su calle');
select is(pg_temp.x() -> 'tax_profiles' -> 0 ->> 'doc_number', '1020304050', 'B7: sus datos fiscales');
select is(pg_temp.x() -> 'notification_preferences' ->> 'preferred_channel', 'email', 'B8: sus preferencias de avisos');
select is(jsonb_array_length(pg_temp.x() -> 'orders'), 1, 'B9: sus pedidos (1)');
select is(pg_temp.x() -> 'orders' -> 0 ->> 'number', 'MIC-926001', 'B10: con su número');
select is((pg_temp.x() -> 'orders' -> 0 ->> 'total')::numeric, 315::numeric, 'B11: y su total');
select is(jsonb_array_length(pg_temp.x() -> 'orders' -> 0 -> 'items'), 2, 'B12: sus 2 líneas');
select is((select string_agg((i ->> 'line_no') || ':' || (i ->> 'qty') || ':' || (i ->> 'final_total'), ',' order by ord)
             from jsonb_array_elements(pg_temp.x() -> 'orders' -> 0 -> 'items') with ordinality as t(i, ord)), '1:2:200,2:1:100', 'B13: las líneas VIENEN en orden (la 1 y luego la 2), con cantidad e importe');
select is(pg_temp.x() -> 'orders' -> 0 -> 'payments' -> 0 ->> 'status', 'paid', 'B14: el cobro del pedido');
select is(pg_temp.x() -> 'orders' -> 0 -> 'status_history' -> 0 ->> 'to', 'paid', 'B15: y el historial de estados');
select is((select string_agg(l ->> 'kind' || ':' || (l ->> 'version'), ',' order by l ->> 'kind') from jsonb_array_elements(pg_temp.x() -> 'legal_acceptances') l),
          'privacy:1,terms:1', 'B16: lo que aceptó (texto y versión)');
select is(jsonb_array_length(pg_temp.x() -> 'complaints'), 1, 'B17: sus reclamos (solo el suyo, no el anónimo ni el de otra)');
select is(pg_temp.x() -> 'complaints' -> 0 ->> 'detail', 'Mi reclamo de la clienta uno con más de veinte caracteres.', 'B18: con lo que contó');

-- ═══ C. Lo que NO trae ═══════════════════════════════════════════════════════════════════
select is((pg_temp.x()::text ~ 'cost_unit|61\.5'), false, 'C1: NUNCA el costo del producto (es del negocio)');
select is((pg_temp.x()::text ~ 'ip_hash|aaaaaaaaaaaaaaaa|cccccccccccccccc'), false, 'C2: NUNCA la huella de red');
select is((pg_temp.x()::text ~ 'idempotency_key|llave-secreta|request_hash|hash-secreto'), false, 'C3: ni la llave de idempotencia ni la huella del pedido');
select is(pg_temp.x() -> 'profile' ? 'role', false, 'C4: ni su rol interno');
select is((pg_temp.x()::text ~ 'Calle Secreta Dos|Dos SRL|9999999999|u2\.s15d|Clienta Dos|MIC-926002|reclamo de la clienta dos|anon@example'), false,
          'C5: NADA de otras personas (ni su dirección, ni su dato fiscal, ni su pedido, ni su reclamo, ni el anónimo)');
select is(pg_temp.x() -> 'orders' -> 0 ? 'profile_id', false, 'C6: el pedido no repite el identificador interno de la cuenta');
select is(pg_temp.x() -> 'notification_preferences' ->> 'preferred_channel', 'email', 'C7: sus preferencias son las SUYAS (no las de otra persona: hay otra con «whatsapp»)');

-- ═══ D. Cada quien exporta lo suyo ═══════════════════════════════════════════════════════
select pg_temp.as_(pg_temp.u(2));
insert into t_r select 'y', public.my_data_export();
select is((select v -> 'orders' -> 0 ->> 'number' from t_r where k = 'y'), 'MIC-926002', 'D1: la otra clienta recibe SU pedido');
select is((select (v::text ~ 'Calle Secreta Uno|Uno SRL|1020304050|u1\.s15d|MIC-926001|reclamo de la clienta uno') from t_r where k = 'y'), false, 'D2: y nada de la primera');
select is((select jsonb_array_length(v -> 'legal_acceptances') from t_r where k = 'y'), 1, 'D3: con lo que ELLA aceptó (1)');
select is((select v -> 'notification_preferences' ->> 'preferred_channel' from t_r where k = 'y'), 'whatsapp', 'D3b: y con SUS preferencias («whatsapp»)');
select pg_temp.as_('00000000-0000-4000-8000-0000000000aa');
select is((select v from (select public.my_data_export() v) q) -> 'orders', '[]'::jsonb, 'D4: alguien sin pedidos recibe listas vacías, no errores');
select is((select (v -> 'profile') is null or (v -> 'profile') = 'null'::jsonb from (select public.my_data_export() v) q), true, 'D5: ni un perfil que no existe');

select * from finish();
rollback;
