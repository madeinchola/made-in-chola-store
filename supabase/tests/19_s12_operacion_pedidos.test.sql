-- Sprint 12 · Administración de pedidos y operación: guardas del pedido (edición), lista negra, notas, avanzar y deshacer, edición
-- con recálculo de importes y stock, pedidos manuales, reembolsos (prorrateo al centavo, tope, idempotencia, cancelación con
-- reposición de stock y reversión de cupón), devoluciones, contra entrega cobrada o rechazada, incidencias, «atención requerida»,
-- RLS, permisos y auditoría. Los valores esperados se calcularon A MANO (la cuenta va en el comentario de cada bloque).
-- Todo ocurre en una transacción que se revierte: no deja pedidos, stock movido ni contador avanzado.
--
-- Fixture:  clientas u01..u24 (a5…00NN; correo uNN.s12@test.com; teléfono +5917000NNNN) · admins ad1 (…0d) y ad2 (…0e)
--           productos PA 100,00 [stock 20, costo 60] · PB 40,00 [100, costo 15] · PC 33,33 [50, costo 10] · PD 10,00 [1] · PE 20,00 [3]
--           envío a domicilio PLANO 15,00 dentro de 25 km del taller (La Paz) · recojo gratis · franjas S1 cupo 1 y S2 cupo 5
--           pedido n = c5…00NN con número MIC-9200NN, insertado directo por `pg_temp.mko` (el flujo del cliente es de S10)
begin;
select plan(693);

-- HERMÉTICO: la nube puede traer datos de ejemplo y pedidos de otras corridas; esta prueba parte de cero dentro de su transacción.
-- (`audit_log` y `stock_movements` son inmutables y persisten: todo se cuenta como DIFERENCIA o por ids de ESTA prueba.)
delete from public.discount_redemptions;
delete from public.coupons;
delete from public.discount_targets;
delete from public.discounts;
delete from public.customer_group_members;
delete from public.customer_groups;
delete from public.carts;
delete from public.delivery_bookings;
delete from public.delivery_slots;
delete from public.blocked_dates;
delete from public.shipping_rate_rules;
delete from public.shipping_zones;
delete from public.shipping_methods where code <> 'delivery';
delete from public.store_locations;
-- La lista negra de la nube trae bloqueos de las corridas E2E y de integración: esta prueba parte de una vacía (la guarda de «no se borra»
-- es un disparador de usuario; se apaga solo dentro de esta transacción).
alter table public.blacklist_entries disable trigger user;
delete from public.blacklist_entries;
alter table public.blacklist_entries enable trigger user;
update public.profiles set blacklisted = false where blacklisted;
update public.store_settings set value = 'true' where key = 'reserve_on_add_to_cart';
update public.store_settings set value = '130'  where key = 'shipping_route_factor_pct';
update public.store_settings set value = '24'   where key = 'delivery_min_lead_hours';
update public.store_settings set value = '30'   where key = 'delivery_max_days_ahead';
update public.store_settings set value = '24'   where key = 'order_reminder_hours';
update public.payment_methods set is_active = true, max_amount = null, window_minutes = null, archived_at = null
 where country = 'BO' and code in ('whatsapp', 'cash_on_delivery');
update public.payment_methods set is_active = false where country = 'BO' and code in ('qr_manual', 'qr_auto');

-- ── Ayudas (objetos temporales: viven y mueren con la transacción) ────────────────────────────
create function pg_temp.u(n int) returns uuid language sql as $$ select ('a5000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.ad(n int) returns uuid language sql as $$ select ('a6000000-0000-0000-0000-00000000000' || n::text)::uuid $$;
create function pg_temp.pr(n int) returns uuid language sql as $$ select ('b5000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.va(n int) returns uuid language sql as $$ select ('f5000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.o(n int) returns uuid language sql as $$ select ('c5000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.num(n int) returns text language sql as $$ select 'MIC-9200' || lpad(n::text, 2, '0') $$;
create function pg_temp.it(n int, l int) returns uuid language sql as
  $$ select ('e5000000-0000-0000-' || lpad(n::text, 4, '0') || '-0000000000' || lpad(l::text, 2, '0'))::uuid $$;
create function pg_temp.stock(n int) returns int language sql as $$ select stock_on_hand from public.product_variants where id = pg_temp.va(n) $$;
create function pg_temp.ost(n int) returns text language sql as $$ select status from public.orders where id = pg_temp.o(n) $$;
create function pg_temp.pay(n int) returns uuid language sql as
  $$ select id from public.payments where order_id = pg_temp.o(n) order by attempt desc limit 1 $$;
create function pg_temp.pst(n int) returns text language sql as $$ select status from public.payments where id = pg_temp.pay(n) $$;
create function pg_temp.tot(n int) returns numeric language sql as $$ select total from public.orders where id = pg_temp.o(n) $$;
create function pg_temp.upd(n int) returns timestamptz language sql as $$ select updated_at from public.orders where id = pg_temp.o(n) $$;
create function pg_temp.cnt() returns bigint language sql as $$ select last_value from public.order_counters where prefix = 'MIC' $$;
create temp table t_r (k text primary key, v jsonb);
create function pg_temp.rec(p_k text, p_v jsonb) returns void language sql as
  $$ insert into t_r values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.g(p_k text) returns jsonb language sql as $$ select v from t_r where k = p_k $$;
create function pg_temp.q(p_k text, p_path text) returns text language sql as
  $$ select v #>> string_to_array(p_path, '.') from t_r where k = p_k $$;
-- «Inicia sesión» como un usuario: solo fija las credenciales de la transacción (`auth.uid()` y por tanto `is_admin()`).
create function pg_temp.as_(p_uid uuid) returns void language sql as
  $$ select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p_uid), true) $$;
-- Dinero y stock de las pruebas: «foto» del mundo que una acción rechazada NO debe tocar.
create function pg_temp.state() returns text language sql as $$
  select pg_temp.cnt()::text || '|' ||
         (select coalesce(sum(stock_on_hand), 0) from public.product_variants where product_id::text like 'b5000000%')::text || '|' ||
         (select count(*) from public.orders)::text || '|' ||
         (select count(*) from public.refunds)::text || '|' ||
         (select count(*) from public.order_edits)::text || '|' ||
         (select count(*) from public.delivery_bookings where status = 'active')::text || '|' ||
         (select count(*) from public.stock_movements where variant_id in
            (select id from public.product_variants where product_id::text like 'b5000000%'))::text $$;
create temp table t_s (k text primary key, v text);
create function pg_temp.snap(p_k text) returns void language sql as
  $$ insert into t_s values (p_k, pg_temp.state()) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.same(p_k text) returns boolean language sql as $$ select pg_temp.state() = (select v from t_s where k = p_k) $$;

-- Producto activo con una variante: precio, stock y costo.
create function pg_temp.mk(p_n int, p_price numeric, p_stock int, p_cost numeric default null) returns void language plpgsql as $$
declare
  v_pp text := lpad(p_n::text, 2, '0');
  v_p uuid := pg_temp.pr(p_n);
  v_c uuid := ('d5000000-0000-0000-0000-0000000000' || v_pp)::uuid;
  v_s uuid := ('e6000000-0000-0000-0000-0000000000' || v_pp)::uuid;
begin
  insert into public.products (id, code, slug, name) values (v_p, 'S12-' || v_pp, 's12-' || v_pp, 'Producto S12 ' || v_pp);
  insert into public.product_colors (id, product_id, name) values (v_c, v_p, 'Único');
  insert into public.product_prices (product_id, currency, amount) values (v_p, 'BOB', p_price);
  insert into public.product_sizes (id, product_id, label) values (v_s, v_p, 'M');
  insert into public.product_variants (id, product_id, color_id, size_id) values (pg_temp.va(p_n), v_p, v_c, v_s);
  perform public.apply_stock_change(pg_temp.va(p_n), p_stock, 'import', 'carga inicial S12');
  update public.products set status = 'active', cost_base = p_cost where id = v_p;
end $$;

-- Un pedido insertado directo. p_lines = [{v: n del producto, qty, price, disc?}]. Resta el stock como lo haría la venta (salvo
-- que nazca cancelado). El cobro nace con `p_paystatus`; `p_received` fija el monto recibido (pagos que no cuadran).
create function pg_temp.mko(p_n int, p_u int, p_status text, p_lines jsonb, p_ship numeric default 0, p_ship_disc numeric default 0,
                            p_provider text default 'whatsapp', p_paystatus text default 'pending', p_age interval default interval '0',
                            p_received numeric default null) returns void language plpgsql as $$
declare
  l jsonb;
  i int := 0;
  v_sub numeric := 0;
  v_dis numeric := 0;
  v_tot numeric;
  v_code text := case p_provider when 'manual_qr' then 'qr_manual' else p_provider end;
begin
  for l in select value from jsonb_array_elements(p_lines) loop
    v_sub := v_sub + (l ->> 'price')::numeric * (l ->> 'qty')::int;
    v_dis := v_dis + coalesce((l ->> 'disc')::numeric, 0);
  end loop;
  v_tot := v_sub - v_dis + p_ship - p_ship_disc;
  insert into public.orders select * from jsonb_populate_record(null::public.orders, jsonb_build_object(
    'id', pg_temp.o(p_n), 'number', pg_temp.num(p_n), 'profile_id', pg_temp.u(p_u), 'status', p_status,
    'currency', 'BOB', 'base_currency', 'BOB', 'exchange_rate', 1, 'country', 'BO', 'subtotal', v_sub, 'discount_total', v_dis,
    'shipping_cost', p_ship, 'shipping_discount', p_ship_disc, 'total', v_tot, 'tax_included', true,
    'contact_name', 'Cliente ' || p_u, 'contact_email', 'u' || lpad(p_u::text, 2, '0') || '.s12@test.com',
    'contact_phone', '+5917000' || lpad(p_u::text, 4, '0'),
    'shipping_method', jsonb_build_object('code', 'delivery', 'name', 'A domicilio', 'kind', 'delivery',
                                          'quote', jsonb_build_object('cost', p_ship)),
    'shipping_address', jsonb_build_object('recipient', 'Cliente ' || p_u, 'phone_e164', '+5917000' || lpad(p_u::text, 4, '0'),
                                           'line1', 'Calle ' || p_u, 'city', 'La Paz', 'country', 'BO', 'lat', -16.52, 'lng', -68.15),
    'payment_method', v_code, 'payment_provider', p_provider, 'discounts', '[]'::jsonb, 'idempotency_key', 'key-s12-' || p_n,
    'channel', 'web', 'edit_count', 0, 'created_at', now() - p_age, 'updated_at', now(),
    'paid_at', case when p_status in ('paid', 'preparing', 'shipped', 'delivered', 'completed', 'refunded') then now() end,
    'cancelled_at', case when p_status = 'cancelled' then now() end,
    'cancelled_by', case when p_status = 'cancelled' then 'admin' end));
  for l in select value from jsonb_array_elements(p_lines) loop
    i := i + 1;
    insert into public.order_items (id, order_id, line_no, variant_id, product_id, product_name, color_name, size_label, qty,
                                    unit_price, line_total, discount, final_total, cost_unit)
    values (pg_temp.it(p_n, i), pg_temp.o(p_n), i, pg_temp.va((l ->> 'v')::int), pg_temp.pr((l ->> 'v')::int),
            'Producto S12 ' || (l ->> 'v'), 'Único', 'M', (l ->> 'qty')::int, (l ->> 'price')::numeric,
            (l ->> 'price')::numeric * (l ->> 'qty')::int, coalesce((l ->> 'disc')::numeric, 0),
            (l ->> 'price')::numeric * (l ->> 'qty')::int - coalesce((l ->> 'disc')::numeric, 0),
            (select p.cost_base from public.products p where p.id = pg_temp.pr((l ->> 'v')::int)));
    if p_status not in ('cancelled', 'refunded') then
      perform public.apply_stock_change(pg_temp.va((l ->> 'v')::int), -(l ->> 'qty')::int, 'sale', pg_temp.num(p_n), 'fixture S12');
    end if;
  end loop;
  insert into public.payments (order_id, provider, method, status, amount, currency, received_amount, paid_at)
  values (pg_temp.o(p_n), p_provider, v_code, p_paystatus, v_tot, 'BOB', p_received, case when p_paystatus = 'paid' then now() end);
  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_kind, reason)
  values (pg_temp.o(p_n), null, 'pending_payment', pg_temp.u(p_u), 'customer', 'created');
end $$;

-- ── Datos ───────────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data, aud, role)
select pg_temp.u(n), 'u' || lpad(n::text, 2, '0') || '.s12@test.com', jsonb_build_object('full_name', 'Clienta ' || n), 'authenticated', 'authenticated'
  from generate_series(1, 24) n;
update public.profiles set phone_e164 = '+5917000' || lpad(right(id::text, 2)::int::text, 4, '0') where id::text like 'a5000000%';
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  (pg_temp.ad(1), 'admin1.s12@test.com', '{"full_name":"Admin Uno S12"}', 'authenticated', 'authenticated'),
  (pg_temp.ad(2), 'admin2.s12@test.com', '{"full_name":"Admin Dos S12"}', 'authenticated', 'authenticated');
select public.set_user_role(pg_temp.ad(1), 'admin');
select public.set_user_role(pg_temp.ad(2), 'admin');

select pg_temp.mk(1, 100.00, 20, 60);   -- PA
select pg_temp.mk(2, 40.00, 100, 15);   -- PB
select pg_temp.mk(3, 33.33, 50, 10);    -- PC
select pg_temp.mk(4, 10.00, 1);         -- PD: la última unidad
select pg_temp.mk(5, 20.00, 3);         -- PE

-- Envíos: taller en La Paz, domicilio PLANO 15,00 dentro de 25 km, recojo gratis, dos franjas por día
insert into public.store_locations (id, name, address_text, city, lat, lng, is_active, is_primary)
values ('11111111-5000-0000-0000-000000000001', 'Taller', 'Calle Ejemplo 1', 'La Paz', -16.5, -68.15, true, true);
update public.shipping_methods set is_active = true where code = 'delivery';
insert into public.shipping_methods (code, name, kind, pickup_location_id)
values ('recojo', 'Recojo en el taller', 'pickup', '11111111-5000-0000-0000-000000000001');
insert into public.shipping_zones (id, name, kind, center_lat, center_lng, radius_km, allowed)
values ('22222222-5000-0000-0000-00000000000a', 'Cerca del taller', 'radius', -16.5, -68.15, 25, true);
insert into public.shipping_rate_rules (method_id, name, kind, params)
select id, 'Tarifa plana', 'flat', '{"cost": 15}' from public.shipping_methods where code = 'delivery';
insert into public.delivery_slots (method_id, weekday, start_time, end_time, capacity)
select m.id, d, '10:00', '12:00', 1 from public.shipping_methods m cross join generate_series(1, 7) d where m.code = 'delivery';
insert into public.delivery_slots (method_id, weekday, start_time, end_time, capacity)
select m.id, d, '14:00', '16:00', 5 from public.shipping_methods m cross join generate_series(1, 7) d where m.code = 'delivery';
create temp table t_day as select ((now() at time zone 'America/La_Paz')::date + 5) as d;
create function pg_temp.sl(p_start text) returns uuid language sql as $$
  select s.id from public.delivery_slots s join public.shipping_methods m on m.id = s.method_id
   where m.code = 'delivery' and s.weekday = extract(isodow from (select d from t_day))::int and s.start_time = p_start::time $$;

-- Desde aquí, todo lo hace el administrador 1 (la sesión de la transacción).
select pg_temp.as_(pg_temp.ad(1));


-- ═══ A. Estructura, ajustes y matriz de transiciones ═══════════════════════════════════════
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
              and c.relname in ('blacklist_entries', 'order_notes', 'order_edits', 'order_incidents', 'order_returns',
                                'order_return_items', 'refunds', 'refund_items')), 8, 'A1: las 8 tablas nuevas tienen RLS activa');
select is((select value #>> '{}' from public.store_settings where key = 'returns_enabled'), 'false', 'A2: las devoluciones nacen APAGADAS (la política la redacta la tienda)');
select is((select value #>> '{}' from public.store_settings where key = 'return_window_days'), '7', 'A2: plazo de devolución 7 días');
select is((select value #>> '{}' from public.store_settings where key = 'order_undo_window_minutes'), '5', 'A2: ventana de deshacer 5 minutos');
select throws_ok($$update public.store_settings set value = '0' where key = 'return_window_days'$$, '22023', null, 'A3: 0 días de plazo está fuera de rango');
select throws_ok($$update public.store_settings set value = '366' where key = 'return_window_days'$$, '22023', null, 'A3: 366 días también');
select throws_ok($$update public.store_settings set value = '61' where key = 'order_undo_window_minutes'$$, '22023', null, 'A3: 61 minutos para deshacer está fuera de rango');
select lives_ok($$update public.store_settings set value = '1' where key = 'order_undo_window_minutes'$$, 'A3: 1 minuto es el mínimo válido');
update public.store_settings set value = '5' where key = 'order_undo_window_minutes';
select throws_ok($$update public.store_settings set value = '"si"' where key = 'returns_enabled'$$, '22023', null, 'A4: returns_enabled solo admite verdadero o falso');

-- Matriz del admin: EXACTAMENTE 12 (S10 trajo 9; S12 suma enviado→cancelado, entregado→reembolsado, completado→reembolsado)
create temp table t_st as select unnest(array['pending_payment', 'paid', 'preparing', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded']) as s;
select is((select string_agg(a.s || '>' || b.s, ', ' order by a.s || '>' || b.s collate "C") from t_st a, t_st b where public._order_transition_ok(a.s, b.s, 'admin')),
  'cancelled>refunded, completed>refunded, delivered>completed, delivered>refunded, paid>cancelled, paid>preparing, pending_payment>cancelled, pending_payment>paid, preparing>cancelled, preparing>shipped, shipped>cancelled, shipped>delivered',
  'A5: el admin tiene EXACTAMENTE estas 12 transiciones');
select is((select string_agg(a.s || '>' || b.s, ', ' order by a.s || '>' || b.s collate "C") from t_st a, t_st b where public._order_transition_ok(a.s, b.s, 'customer')),
  'paid>cancelled, pending_payment>cancelled', 'A5: la clienta sigue cancelando solo pendiente o pagado (BR-ORD-02)');
select is((select string_agg(a.s || '>' || b.s, ', ' order by a.s || '>' || b.s collate "C") from t_st a, t_st b where public._order_transition_ok(a.s, b.s, 'system')),
  'pending_payment>cancelled, pending_payment>paid', 'A5: el sistema no ganó transiciones nuevas');
select is(public._order_transition_ok('completed', 'cancelled', 'admin'), false, 'A5: un pedido completado sigue sin poder cancelarse');
select is(public._order_transition_ok('delivered', 'cancelled', 'admin'), false, 'A5: ni uno entregado (se devuelve con una devolución)');

-- ═══ B. Guardas: el pedido sigue siendo una instantánea salvo en la edición ═════════════════
-- B-orden: PA × 2 @100 + PB × 1 @40 + envío 15 = 255,00 (pedido 1, clienta 1, WhatsApp pendiente). Stock PA 20 → 18, PB 100 → 99.
select pg_temp.mko(1, 1, 'pending_payment', '[{"v":1,"qty":2,"price":100},{"v":2,"qty":1,"price":40}]', 15);
select is(pg_temp.tot(1), 255.00, 'B0: el pedido de prueba suma 255,00 (240 + 15 de envío)');
select is(pg_temp.stock(1), 18, 'B0: el stock de PA bajó 20 → 18');
select is(pg_temp.stock(2), 99, 'B0: el de PB bajó 100 → 99');
select is((select channel from public.orders where id = pg_temp.o(1)), 'web', 'B0: canal «web» por omisión');
select throws_ok($$update public.orders set total = 1, subtotal = 1 where id = 'c5000000-0000-0000-0000-000000000001'$$, '42501', null, 'B1: sin la bandera de edición el pedido es una instantánea (importes)');
select throws_ok($$update public.orders set contact_name = 'Otro' where id = 'c5000000-0000-0000-0000-000000000001'$$, '42501', null, 'B1: …ni el contacto');
select throws_ok($$update public.order_items set qty = 5 where id = 'e5000000-0000-0000-0001-000000000001'$$, '42501', null, 'B2: sin la bandera las líneas son inmutables (cantidad)');
select throws_ok($$delete from public.order_items where id = 'e5000000-0000-0000-0001-000000000001'$$, '42501', null, 'B2: …no se borran');
select throws_ok($$update public.orders set status = 'paid' where id = 'c5000000-0000-0000-0000-000000000001'$$, '42501', null, 'B3: el estado solo cambia con transition_order_status');
select set_config('app.order_edit', '1', true);
select lives_ok($$update public.orders set contact_name = 'Otro nombre' where id = 'c5000000-0000-0000-0000-000000000001'$$, 'B4: con la bandera sí cambia el contacto');
select throws_ok($$update public.orders set number = 'MIC-111111' where id = 'c5000000-0000-0000-0000-000000000001'$$, '42501', null, 'B4: …pero NUNCA el número, ni con la bandera');
select throws_ok($$update public.orders set profile_id = 'a5000000-0000-0000-0000-000000000002' where id = 'c5000000-0000-0000-0000-000000000001'$$, '42501', null, 'B4: …ni la clienta');
select throws_ok($$update public.orders set channel = 'manual' where id = 'c5000000-0000-0000-0000-000000000001'$$, '42501', null, 'B4: …ni el canal');
select throws_ok($$update public.orders set payment_method = 'cash_on_delivery' where id = 'c5000000-0000-0000-0000-000000000001'$$, '42501', null, 'B4: …ni el método de pago');
select lives_ok($$update public.order_items set qty = 3, line_total = 300, final_total = 300 where id = 'e5000000-0000-0000-0001-000000000001'$$, 'B5: con la bandera cambian cantidad e importes de una línea');
select throws_ok($$update public.order_items set unit_price = 1 where id = 'e5000000-0000-0000-0001-000000000001'$$, '42501', null, 'B5: …pero NO el precio unitario (instantánea)');
select throws_ok($$update public.order_items set product_name = 'Otro' where id = 'e5000000-0000-0000-0001-000000000001'$$, '42501', null, 'B5: …ni el nombre del producto');
select set_config('app.order_edit', '', true);
select throws_ok($$update public.orders set contact_name = 'X' where id = 'c5000000-0000-0000-0000-000000000001'$$, '42501', null, 'B6: apagada la bandera vuelve a ser inmutable');
-- Se deshace el cambio de la prueba (la bandera aún permite revertirlo) para que el pedido 1 vuelva a ser 255,00.
select set_config('app.order_edit', '1', true);
update public.order_items set qty = 2, line_total = 200, final_total = 200 where id = pg_temp.it(1, 1);
update public.orders set contact_name = 'Cliente 1' where id = pg_temp.o(1);
select set_config('app.order_edit', '', true);
select is((select sum(final_total) from public.order_items where order_id = pg_temp.o(1)), 240.00, 'B7: el pedido quedó como estaba (240,00 en líneas)');


-- ═══ C. Lista negra (S-07) ══════════════════════════════════════════════════════════════════
create function pg_temp.mkaddr(p_u int, p_lat numeric default -16.52, p_lng numeric default -68.15) returns uuid language plpgsql as $$
begin
  insert into public.addresses (id, profile_id, label, recipient, phone_e164, line1, city, lat, lng)
  values (('a7000000-0000-0000-0000-0000000000' || lpad(p_u::text, 2, '0'))::uuid, pg_temp.u(p_u), 'Casa', 'Clienta ' || p_u,
          '+5917000' || lpad(p_u::text, 4, '0'), 'Calle ' || p_u, 'La Paz', p_lat, p_lng);
  return ('a7000000-0000-0000-0000-0000000000' || lpad(p_u::text, 2, '0'))::uuid;
end $$;

select is(public.is_blacklisted(pg_temp.u(1)), false, 'C1: una clienta normal no está bloqueada');
select pg_temp.rec('c1', public.admin_blacklist_add('profile', pg_temp.u(1), null, null, 'Rechazó dos paquetes', null, false));
select is(pg_temp.q('c1', 'outcome'), 'added', 'C2: se bloquea una cuenta');
select is(public.is_blacklisted(pg_temp.u(1)), true, 'C2: is_blacklisted lo ve');
select is((select blacklisted from public.profiles where id = pg_temp.u(1)), true, 'C2: el interruptor del perfil (S1) lo refleja');
select is((select created_by from public.blacklist_entries where id = pg_temp.q('c1', 'ids.0')::uuid), pg_temp.ad(1), 'C2: queda quién lo hizo');
select is(public.admin_blacklist_add('profile', pg_temp.u(1), null, null, 'otra vez', null, false) ->> 'outcome', 'already', 'C3: bloquear dos veces la misma cuenta no duplica');
select is(public.admin_blacklist_add('profile', pg_temp.u(2), null, null, '   ', null, false) -> 'errors' -> 0 ->> 'code', 'reason_required', 'C4: el motivo es obligatorio');
select is(public.is_blacklisted(pg_temp.u(2)), false, 'C4: y no se bloqueó nada sin motivo');
select is(public.admin_blacklist_add('profile', pg_temp.ad(2), null, null, 'prueba', null, false) -> 'errors' -> 0 ->> 'code', 'cannot_blacklist_admin', 'C5: un administrador no se bloquea');
select is(public.admin_blacklist_add('profile', gen_random_uuid(), null, null, 'prueba', null, false) ->> 'outcome', 'not_found', 'C5: una cuenta inexistente → not_found');
select is(public.admin_blacklist_add('cosa', null, null, null, 'prueba', null, false) -> 'errors' -> 0 ->> 'code', 'kind_invalid', 'C5: un tipo desconocido se rechaza');
select is(public.admin_blacklist_lift(pg_temp.q('c1', 'ids.0')::uuid, 'Pagó lo adeudado') ->> 'outcome', 'lifted', 'C6: se levanta el bloqueo');
select is(public.is_blacklisted(pg_temp.u(1)), false, 'C6: la clienta queda libre');
select is((select blacklisted from public.profiles where id = pg_temp.u(1)), false, 'C6: y el interruptor del perfil se apaga');
select is((select lifted_by from public.blacklist_entries where id = pg_temp.q('c1', 'ids.0')::uuid), pg_temp.ad(1), 'C6: queda quién lo levantó');
select is(public.admin_blacklist_lift(pg_temp.q('c1', 'ids.0')::uuid, 'otra vez') ->> 'outcome', 'already_lifted', 'C6: levantar dos veces no hace nada');
select is(public.admin_blacklist_lift(pg_temp.q('c1', 'ids.0')::uuid, ' ') -> 'errors' -> 0 ->> 'code', 'reason_required', 'C6: levantarlo también pide motivo');
select is(public.admin_blacklist_add('profile', pg_temp.u(1), null, null, 'reincidió', null, false) ->> 'outcome', 'added', 'C7: tras levantarlo se puede volver a bloquear (el índice único solo mira las activas)');
select is((select count(*)::int from public.blacklist_entries where profile_id = pg_temp.u(1)), 2, 'C7: queda el historial: dos entradas, una levantada');

-- Teléfono y correo: abrir otra cuenta con los mismos datos no evita el bloqueo
select is(public.admin_blacklist_add('phone', null, '+59170000005', null, 'Evadió el bloqueo', null, false) ->> 'outcome', 'added', 'C8: se bloquea un teléfono');
select is(public.is_blacklisted(pg_temp.u(5)), true, 'C8: la cuenta que tiene ese teléfono queda bloqueada');
select is(public.is_blacklisted(pg_temp.u(6), '+59170000005', null), true, 'C8: otra cuenta que ESCRIBE ese teléfono también');
select is(public.is_blacklisted(pg_temp.u(6)), false, 'C8: sin ese teléfono, no');
select is(public.admin_blacklist_add('phone', null, '71234567', null, 'x', null, false) -> 'errors' -> 0 ->> 'code', 'phone_invalid', 'C8: el teléfono va en E.164');
select is(public.admin_blacklist_add('email', null, null, ' Fraude@Test.com ', 'Contracargos', null, false) ->> 'outcome', 'added', 'C9: se bloquea un correo (normalizado)');
select is((select email from public.blacklist_entries where kind = 'email' and is_active), 'fraude@test.com', 'C9: queda en minúsculas y sin espacios');
select is(public.is_blacklisted(pg_temp.u(7), null, 'FRAUDE@test.com'), true, 'C9: se compara sin importar mayúsculas');
select is(public.admin_blacklist_add('email', null, null, 'sin-arroba', 'x', null, false) -> 'errors' -> 0 ->> 'code', 'email_invalid', 'C9: un correo inválido se rechaza');
select pg_temp.rec('c10', public.admin_blacklist_add('profile', pg_temp.u(8), null, null, 'Cuenta y contactos', null, true));
select is(jsonb_array_length(pg_temp.g('c10') -> 'ids'), 3, 'C10: con «incluir contactos» entran la cuenta, su teléfono y su correo');
select is((select count(*)::int from public.blacklist_entries where is_active and (profile_id = pg_temp.u(8) or phone_e164 = '+59170000008'
            or email = 'u08.s12@test.com')), 3, 'C10: son 3 entradas: cuenta, teléfono y correo');

-- El checkout lo consume: bloquea contra entrega, NO WhatsApp, y no le dice a la clienta que está en la lista
select lives_ok($$select pg_temp.mkaddr(9)$$, 'C11: la clienta 9 tiene dirección');
select lives_ok($$select public.cart_set_item(pg_temp.u(9), null, pg_temp.va(3), 1)$$, 'C11: y una bolsa con un producto');
select is((select m ->> 'available' from jsonb_array_elements(public.checkout_preview(pg_temp.u(9), 'a7000000-0000-0000-0000-000000000009', null, 'delivery', null, null, null) #> '{checkout,payment,methods}') m
            where m ->> 'code' = 'cash_on_delivery'), 'true', 'C11: sin bloqueo, la contra entrega está disponible');
select is(public.admin_blacklist_add('phone', null, '+59170000009', null, 'Rechazos previos', null, false) ->> 'outcome', 'added', 'C11: se bloquea el teléfono de la clienta 9');
select is((select m ->> 'available' from jsonb_array_elements(public.checkout_preview(pg_temp.u(9), 'a7000000-0000-0000-0000-000000000009', null, 'delivery', null, null, null) #> '{checkout,payment,methods}') m
            where m ->> 'code' = 'cash_on_delivery'), 'false', 'C11: bloqueado por su TELÉFONO (no por el interruptor del perfil), la contra entrega deja de estar disponible');
select is((select m ->> 'reason' from jsonb_array_elements(public.checkout_preview(pg_temp.u(9), 'a7000000-0000-0000-0000-000000000009', null, 'delivery', null, null, null) #> '{checkout,payment,methods}') m
            where m ->> 'code' = 'cash_on_delivery'), 'not_available', 'C11: con el código genérico «not_available» (no se revela la lista negra)');
select is((select m ->> 'available' from jsonb_array_elements(public.checkout_preview(pg_temp.u(9), 'a7000000-0000-0000-0000-000000000009', null, 'delivery', null, null, null) #> '{checkout,payment,methods}') m
            where m ->> 'code' = 'whatsapp'), 'true', 'C11: WhatsApp NO se bloquea (S-07)');

-- Coincidencias sugeridas (evasión con otra cuenta): misma dirección o mismo teléfono en el pedido
select pg_temp.mko(10, 10, 'pending_payment', '[{"v":2,"qty":1,"price":40}]');
select pg_temp.mko(11, 11, 'pending_payment', '[{"v":2,"qty":1,"price":40}]');
select set_config('app.order_edit', '1', true);
update public.orders set shipping_address = shipping_address || '{"line1":"Calle 10"}'::jsonb where id = pg_temp.o(11);
update public.orders set contact_phone = '+59170000013' where id = pg_temp.o(10);
select set_config('app.order_edit', '', true);
select is((select jsonb_agg(m ->> 'full_name' order by m ->> 'full_name') from jsonb_array_elements(public.admin_blacklist_matches(pg_temp.o(10))) m),
          '["Clienta 11", "Clienta 13"]'::jsonb, 'C12: coincidencias del pedido 10: la clienta 11 (misma dirección) y la 13 (mismo teléfono)');
select is((select m -> 'reasons' from jsonb_array_elements(public.admin_blacklist_matches(pg_temp.o(10))) m where m ->> 'full_name' = 'Clienta 13'),
          '["same_phone"]'::jsonb, 'C12: con su razón');
select is(public.admin_blacklist_matches(gen_random_uuid()), '[]'::jsonb, 'C12: un pedido inexistente no devuelve nada');
select pg_temp.as_(pg_temp.u(2));
select throws_ok($$select public.admin_blacklist_add('profile', 'a5000000-0000-0000-0000-000000000003', null, null, 'x', null, false)$$, '42501', 'solo administradores', 'C13: una clienta no administra la lista negra');
select throws_ok($$select public.admin_blacklist_lift(gen_random_uuid(), 'x')$$, '42501', 'solo administradores', 'C13: ni la levanta');
select throws_ok($$select public.admin_blacklist_matches(gen_random_uuid())$$, '42501', 'solo administradores', 'C13: ni ve coincidencias');
select pg_temp.as_(pg_temp.ad(1));

-- ═══ D. Notas internas ══════════════════════════════════════════════════════════════════════
select pg_temp.rec('d1', public.admin_add_order_note(pg_temp.o(1), '  Llamó la clienta, pasa a recoger  '));
select is(pg_temp.q('d1', 'outcome'), 'added', 'D1: se agrega una nota');
select is((select body from public.order_notes where id = pg_temp.q('d1', 'id')::bigint), 'Llamó la clienta, pasa a recoger', 'D1: queda sin espacios sobrantes');
select is((select author_id from public.order_notes where id = pg_temp.q('d1', 'id')::bigint), pg_temp.ad(1), 'D1: con su autor');
select is(public.admin_add_order_note(pg_temp.o(1), '   ') -> 'errors' -> 0 ->> 'code', 'body_invalid', 'D2: una nota vacía se rechaza');
select is(public.admin_add_order_note(pg_temp.o(1), repeat('x', 2001)) -> 'errors' -> 0 ->> 'code', 'body_invalid', 'D2: y una de más de 2 000 caracteres');
select is(public.admin_add_order_note(gen_random_uuid(), 'hola') ->> 'outcome', 'not_found', 'D2: sobre un pedido inexistente');
select throws_ok(format($$update public.order_notes set body = 'editada' where id = %s$$, pg_temp.q('d1', 'id')), '42501', null, 'D3: las notas no se editan (registro inmutable)');
select throws_ok(format($$delete from public.order_notes where id = %s$$, pg_temp.q('d1', 'id')), '42501', null, 'D3: ni se borran');
select pg_temp.as_(pg_temp.u(1));
set local role authenticated;
select is((select count(*)::int from public.order_notes), 0, 'D4: la clienta NO ve las notas internas de su propio pedido');
select throws_ok($$select public.admin_add_order_note('c5000000-0000-0000-0000-000000000001', 'x')$$, '42501', 'solo administradores', 'D4: ni puede escribirlas');
reset role;
select pg_temp.as_(pg_temp.ad(1));
set local role authenticated;
select ok((select count(*) from public.order_notes) >= 1, 'D5: el administrador sí las ve (RLS)');
reset role;

-- ═══ E. Avanzar con un clic, bloqueo optimista y contracargo ════════════════════════════════
-- Pedido 2 = PB × 1 (40,00) + envío 15,00 = 55,00, WhatsApp pendiente. Stock PB 99 → 98.
select pg_temp.mko(2, 2, 'pending_payment', '[{"v":2,"qty":1,"price":40}]', 15);
select is(pg_temp.tot(2), 55.00, 'E0: el pedido 2 suma 55,00');
select is(public.admin_transition_order(pg_temp.o(2), 'paid', null, 'preparing') ->> 'outcome', 'stale', 'E1: si otro administrador ya lo movió (esperaba «preparing»), responde stale');
select is(pg_temp.ost(2), 'pending_payment', 'E1: y el pedido no se tocó');
select is(public.admin_transition_order(pg_temp.o(2), 'paid', null, 'preparing') ->> 'current', 'pending_payment', 'E1: con el estado actual para mostrarlo');
select is(public.admin_transition_order(pg_temp.o(2), 'refunded') ->> 'outcome', 'use_refund', 'E2: «reembolsado» no se marca a mano: se llega por el reembolso');
select is(pg_temp.ost(2), 'pending_payment', 'E2: y no cambió nada');
select is(public.admin_transition_order(gen_random_uuid(), 'paid') ->> 'outcome', 'not_found', 'E3: un pedido inexistente');
select pg_temp.rec('e_stock', jsonb_build_object('pb', pg_temp.stock(2), 'moves', (select count(*) from public.stock_movements where variant_id = pg_temp.va(2))));
select is(public.admin_transition_order(pg_temp.o(2), 'paid', 'Confirmado por WhatsApp', 'pending_payment') ->> 'ok', 'true', 'E4: confirma el pago con el estado esperado');
select is(pg_temp.ost(2), 'paid', 'E4: queda pagado');
select is(pg_temp.pst(2), 'paid', 'E4: y su cobro también');
select is((select reason from public.order_status_history where order_id = pg_temp.o(2) and to_status = 'paid'), 'Confirmado por WhatsApp', 'E4: el motivo queda en el historial');
select is((select actor_id from public.order_status_history where order_id = pg_temp.o(2) and to_status = 'paid'), pg_temp.ad(1), 'E4: con el administrador que lo hizo');
select is(public.admin_transition_order(pg_temp.o(2), 'preparing', null, 'paid') ->> 'ok', 'true', 'E5: paid → preparing');
select is(public.admin_transition_order(pg_temp.o(2), 'shipped', null, 'preparing') ->> 'ok', 'true', 'E5: preparing → shipped');
select is(public.admin_transition_order(pg_temp.o(2), 'delivered', null, 'shipped') ->> 'ok', 'true', 'E5: shipped → delivered');
select is(public.admin_transition_order(pg_temp.o(2), 'completed', null, 'delivered') ->> 'ok', 'true', 'E5: delivered → completed');
select is(pg_temp.ost(2), 'completed', 'E5 (criterio 1): el pedido llegó de «pendiente de pago» a «completado» solo con acciones del administrador');
select is(public.admin_transition_order(pg_temp.o(2), 'cancelled') ->> 'outcome', 'invalid_transition', 'E6: un pedido completado no se cancela');
select is(pg_temp.stock(2), (pg_temp.g('e_stock') ->> 'pb')::int, 'E7: avanzar el pedido de pendiente a completado no mueve el stock');
select is((select count(*) from public.stock_movements where variant_id = pg_temp.va(2)), (pg_temp.g('e_stock') ->> 'moves')::bigint, 'E7: ni deja movimientos de stock');
select is(jsonb_array_length(public.admin_order_history(pg_temp.o(2))), 6, 'E8: el historial tiene 6 filas (creación + 5 cambios)');
select is(public.admin_order_history(pg_temp.o(2)) -> 5 ->> 'to_status', 'completed', 'E8: en orden: la última es «completed»');
select is(public.admin_order_history(pg_temp.o(2)) -> 1 ->> 'actor_name', 'Admin Uno S12', 'E8: con el nombre de quien lo hizo (el navegador no podría leerlo)');
select is(public.admin_order_history(pg_temp.o(2)) -> 1 ->> 'reason', 'Confirmado por WhatsApp', 'E8: y el motivo');
select pg_temp.as_(pg_temp.u(2));
select throws_ok($$select public.admin_order_history('c5000000-0000-0000-0000-000000000002')$$, '42501', 'solo administradores', 'E9: una clienta no lee el historial de administración');
select throws_ok($$select public.admin_transition_order('c5000000-0000-0000-0000-000000000002', 'paid')$$, '42501', 'solo administradores', 'E9: ni avanza pedidos');
select throws_ok($$select public.admin_orders_status_counts()$$, '42501', 'solo administradores', 'E9: ni cuenta pedidos');
select pg_temp.as_(pg_temp.ad(1));
select ok((public.admin_orders_status_counts() ->> 'completed')::int >= 1, 'E10: los contadores por estado cuentan (al menos el completado de esta prueba)');

-- Contracargo: no se prepara ni se envía (S-06); sí se puede cancelar. Pedido 3 pagado con el cobro en disputa.
select pg_temp.mko(3, 3, 'paid', '[{"v":2,"qty":1,"price":40}]', 0, 0, 'whatsapp', 'disputed');
select is(public.admin_transition_order(pg_temp.o(3), 'preparing') ->> 'outcome', 'payment_disputed', 'E11: con un contracargo abierto no se prepara');
select is(pg_temp.ost(3), 'paid', 'E11: el pedido sigue pagado');
select ok(exists (select 1 from jsonb_array_elements(public.admin_attention_orders()) a where a ->> 'kind' = 'payment_disputed' and a ->> 'order_id' = pg_temp.o(3)::text),
          'E12: el pedido con contracargo aparece en «atención requerida»');

-- ═══ F. Deshacer el último cambio ═══════════════════════════════════════════════════════════
select pg_temp.mko(4, 4, 'paid', '[{"v":2,"qty":1,"price":40}]');
select is(public.admin_transition_order(pg_temp.o(4), 'preparing', null, 'paid') ->> 'ok', 'true', 'F0: el administrador pasa el pedido 4 a preparación');
select is(pg_temp.ost(4), 'preparing', 'F0: el pedido 4 está en preparación');
select is(public.admin_undo_transition(pg_temp.o(4), 'shipped') ->> 'outcome', 'stale', 'F1: si el estado que veía ya no es el actual, no deshace');
select pg_temp.rec('f2', public.admin_undo_transition(pg_temp.o(4), 'preparing'));
select is(pg_temp.q('f2', 'outcome'), 'undone', 'F2: deshace la preparación dentro de la ventana');
select is(pg_temp.ost(4), 'paid', 'F2: vuelve a «pagado»');
select is((select reason from public.order_status_history where order_id = pg_temp.o(4) order by id desc limit 1), 'Deshacer: paid → preparing', 'F2: queda en el historial como un cambio más');
select is((select count(*)::int from public.order_status_history where order_id = pg_temp.o(4)), 3, 'F2: nada se borró: creación + preparar + deshacer');
select is(public.admin_undo_transition(pg_temp.o(4)) ->> 'outcome', 'not_undoable', 'F3: no se deshace lo deshecho (un bucle de deshacer/rehacer no existe)');
-- Fuera de la ventana: el último cambio es de hace 10 minutos
select pg_temp.mko(5, 5, 'shipped', '[{"v":2,"qty":1,"price":40}]');
insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_kind, created_at)
values (pg_temp.o(5), 'preparing', 'shipped', pg_temp.ad(1), 'admin', now() - interval '10 minutes');
select is(public.admin_undo_transition(pg_temp.o(5)) ->> 'outcome', 'window_expired', 'F4: pasados los 5 minutos ya no se deshace');
select is(pg_temp.ost(5), 'shipped', 'F4: y el pedido sigue enviado');
update public.store_settings set value = '30' where key = 'order_undo_window_minutes';
select is(public.admin_undo_transition(pg_temp.o(5)) ->> 'outcome', 'undone', 'F5: con una ventana de 30 minutos, el mismo cambio de hace 10 sí se deshace');
select is(pg_temp.ost(5), 'preparing', 'F5: enviado → preparación');
update public.store_settings set value = '5' where key = 'order_undo_window_minutes';
-- Lo que mueve stock o dinero no se deshace: una cancelación
select pg_temp.mko(6, 6, 'paid', '[{"v":2,"qty":1,"price":40}]');
select is(public.admin_transition_order(pg_temp.o(6), 'cancelled', 'Se arrepintió') ->> 'ok', 'true', 'F6: el administrador cancela el pedido 6');
select is(public.admin_undo_transition(pg_temp.o(6)) ->> 'outcome', 'not_undoable', 'F6: una cancelación NO se deshace (el stock ya volvió y el cupón se devolvió)');
select is(pg_temp.ost(6), 'cancelled', 'F6: sigue cancelado');
select pg_temp.as_(pg_temp.u(2));
select throws_ok($$select public.admin_undo_transition('c5000000-0000-0000-0000-000000000004')$$, '42501', 'solo administradores', 'F7: una clienta no deshace cambios');
select pg_temp.as_(pg_temp.ad(1));


-- ═══ G. Editar un pedido (admin_edit_order) ═════════════════════════════════════════════════
-- Pedido 20 (clienta 12): PA × 2 @100 + PB × 1 @40, envío 15 → subtotal 240, total 255, WhatsApp pendiente (cobro 255).
-- Stock antes: PA y PB tal como estén; se mide por diferencia.
select pg_temp.mko(20, 12, 'pending_payment', '[{"v":1,"qty":2,"price":100},{"v":2,"qty":1,"price":40}]', 15);
-- Dentro de una transacción now() no cambia: para que la versión del pedido (updated_at) pueda DISTINGUIRSE después de editarlo,
-- se la deja un minuto atrás (en producción cada edición es otra transacción).
update public.orders set updated_at = now() - interval '1 minute' where id = pg_temp.o(20);
select pg_temp.rec('g_stock0', jsonb_build_object('pa', pg_temp.stock(1), 'pb', pg_temp.stock(2)));
select pg_temp.snap('g0');

-- G1: vista previa: PA 2 → 3 ⇒ línea 300, subtotal 340, total 355; stock PA −1. NADA se escribe.
select pg_temp.rec('g1', public.admin_edit_order(pg_temp.o(20), pg_temp.upd(20),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(20, 1), 'qty', 3)), null, null, null, 0, 'La clienta pidió una más', true));
select is(pg_temp.q('g1', 'outcome'), 'preview', 'G1: la vista previa responde «preview»');
select is((pg_temp.g('g1') #>> '{after,subtotal}')::numeric, 340.00, 'G1: subtotal nuevo 3 × 100 + 40 = 340,00');
select is((pg_temp.g('g1') #>> '{after,total}')::numeric, 355.00, 'G1: total nuevo 340 + 15 = 355,00');
select is((pg_temp.g('g1') #>> '{diff,total_delta}')::numeric, 100.00, 'G1: diferencia de total +100,00');
select is((pg_temp.g('g1') #>> '{diff,stock,0,net}')::int, 1, 'G1: el stock de PA bajaría en 1');
select is(pg_temp.q('g1', 'diff.payment'), 'amount_updated', 'G1: antes de pagar, el cobro abierto tomaría el total nuevo');
select ok(pg_temp.same('g0'), 'G1: la vista previa NO escribe nada (ni stock, ni pedidos, ni libro de ediciones)');
select is(pg_temp.tot(20), 255.00, 'G1: el pedido sigue en 255,00');

-- G2: aplicar
select pg_temp.rec('g2', public.admin_edit_order(pg_temp.o(20), pg_temp.upd(20),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(20, 1), 'qty', 3)), null, null, null, 0, 'La clienta pidió una más', false));
select is(pg_temp.q('g2', 'outcome'), 'edited', 'G2: la edición se aplica');
select is(pg_temp.tot(20), 355.00, 'G2: total 355,00');
select is((select subtotal from public.orders where id = pg_temp.o(20)), 340.00, 'G2: subtotal 340,00');
select is((select qty from public.order_items where id = pg_temp.it(20, 1)), 3, 'G2: PA × 3');
select is((select line_total from public.order_items where id = pg_temp.it(20, 1)), 300.00, 'G2: línea 300,00');
select is((select final_total from public.order_items where id = pg_temp.it(20, 1)), 300.00, 'G2: y su final también (la restricción final = línea − descuento se cumple)');
select is(pg_temp.stock(1), (pg_temp.g('g_stock0') ->> 'pa')::int - 1, 'G2: el stock de PA bajó 1');
select is((select delta from public.stock_movements where variant_id = pg_temp.va(1) order by id desc limit 1), -1, 'G2: con su movimiento de −1');
select is((select reason from public.stock_movements where variant_id = pg_temp.va(1) order by id desc limit 1), 'sale', 'G2: de tipo «sale» (se sumó una unidad vendida)');
select is((select amount from public.payments where id = pg_temp.pay(20)), 355.00, 'G2: el cobro abierto ahora cobra 355,00');
select is((select edit_count from public.orders where id = pg_temp.o(20)), 1, 'G2: el pedido cuenta 1 edición');
select ok((select edited_at is not null from public.orders where id = pg_temp.o(20)), 'G2: con su fecha');
select is((select count(*)::int from public.order_edits where order_id = pg_temp.o(20)), 1, 'G2 (auditoría): una fila en el libro de ediciones');
select is((select actor_id from public.order_edits where order_id = pg_temp.o(20)), pg_temp.ad(1), 'G2: con quién editó');
select is((select reason from public.order_edits where order_id = pg_temp.o(20)), 'La clienta pidió una más', 'G2: y por qué');
select is((select (before ->> 'total')::numeric from public.order_edits where order_id = pg_temp.o(20)), 255.00, 'G2: el libro guarda el total de ANTES (255,00)');
select is((select (after ->> 'total')::numeric from public.order_edits where order_id = pg_temp.o(20)), 355.00, 'G2: y el de DESPUÉS (355,00)');
select is((select diff #>> '{items,0,op}' from public.order_edits where order_id = pg_temp.o(20)), 'changed', 'G2: el diff dice qué línea cambió');
select is((select (diff #>> '{items,0,qty_before}')::int || '→' || (diff #>> '{items,0,qty_after}')::int from public.order_edits where order_id = pg_temp.o(20)), '2→3', 'G2: de 2 a 3');
select ok(exists (select 1 from public.notification_outbox where dedupe_key = 'order_edited:' || pg_temp.o(20)::text || ':1:c'), 'G2: se avisa a la clienta de la edición');
select throws_ok(format($$update public.order_edits set reason = 'x' where order_id = %L$$, pg_temp.o(20)), '42501', null, 'G2: el libro de ediciones es inmutable');

-- G3: bloqueo optimista: otro administrador tenía la versión vieja
select is(public.admin_edit_order(pg_temp.o(20), pg_temp.q('g1', 'updated_at')::timestamptz,
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(20, 1), 'qty', 1)), null, null, null, 0, 'Otro admin', false) ->> 'outcome', 'stale',
  'G3: con la versión vieja del pedido responde «stale» (otro administrador ya lo cambió)');
select is(pg_temp.tot(20), 355.00, 'G3: y no tocó nada');
select is(public.admin_edit_order(pg_temp.o(20), null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(20, 1), 'qty', 3)), null, null, null, 0, 'Sin cambios', false) ->> 'outcome',
  'no_changes', 'G3: una edición que deja todo igual no hace nada (y sin versión esperada se aplica sobre lo vigente)');

-- G4: bajar cantidad con descuento: pedido 21: PA × 4 @100 con descuento 40 → línea 400, final 360; envío 15; total 375.
select pg_temp.mko(21, 13, 'pending_payment', '[{"v":1,"qty":4,"price":100,"disc":40}]', 15);
select is(pg_temp.tot(21), 375.00, 'G4: el pedido 21 suma 400 − 40 + 15 = 375,00');
-- 4 → 2: línea 200, descuento proporcional round(40 × 2 / 4) = 20 → final 180; subtotal 200; descuento 20; total 200 − 20 + 15 = 195
select pg_temp.rec('g4', public.admin_edit_order(pg_temp.o(21), pg_temp.upd(21),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(21, 1), 'qty', 2)), null, null, null, 0, 'Pidió menos', false));
select is((select discount from public.order_items where id = pg_temp.it(21, 1)), 20.00, 'G4: el descuento baja en proporción (40 × 2/4 = 20,00)');
select is((select final_total from public.order_items where id = pg_temp.it(21, 1)), 180.00, 'G4: final 200 − 20 = 180,00');
select is((select discount_total from public.orders where id = pg_temp.o(21)), 20.00, 'G4: descuento del pedido 20,00');
select is(pg_temp.tot(21), 195.00, 'G4: total 200 − 20 + 15 = 195,00');
select is((select delta from public.stock_movements where variant_id = pg_temp.va(1) order by id desc limit 1), 2, 'G4: el stock vuelve +2');
select is((select reason from public.stock_movements where variant_id = pg_temp.va(1) order by id desc limit 1), 'cancel', 'G4: como «cancel» (devolución por edición)');
-- 2 → 5: el descuento se QUEDA en 20 (no se inventan descuentos nuevos): línea 500 − 20 = 480; total 500 − 20 + 15 = 495
select is(public.admin_edit_order(pg_temp.o(21), pg_temp.upd(21),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(21, 1), 'qty', 5)), null, null, null, 0, 'Pidió más', false) ->> 'outcome', 'edited', 'G5: subir de 2 a 5');
select is((select discount from public.order_items where id = pg_temp.it(21, 1)), 20.00, 'G5: al SUBIR la cantidad el descuento no crece');
select is(pg_temp.tot(21), 495.00, 'G5: total 500 − 20 + 15 = 495,00');

-- G6: quitar una línea, sumar una variante nueva y repartir un descuento extra.
-- Pedido 22: PA × 1 @100 + PB × 1 @40, envío 15 → 155. Se quita PB y se suma PC × 3 (33,33 → 99,99). Subtotal 199,99.
-- Descuento extra 10,00 repartido en proporción a 100,00 y 99,99 (minor: 10000 y 9999; 1000 × 10000/19999 = 500,025 → 500; 1000 × 9999/19999 = 499,975 → 499;
-- sobra 1 centavo, que va al mayor resto (.975, la línea 2)) ⇒ 5,00 y 5,00. Descuento total 10,00; total 199,99 − 10 + 15 = 204,99.
select pg_temp.mko(22, 14, 'pending_payment', '[{"v":1,"qty":1,"price":100},{"v":2,"qty":1,"price":40}]', 15);
select pg_temp.rec('g6s', jsonb_build_object('pb', pg_temp.stock(2), 'pc', pg_temp.stock(3)));
select pg_temp.rec('g6', public.admin_edit_order(pg_temp.o(22), pg_temp.upd(22),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(22, 2), 'qty', 0), jsonb_build_object('variant_id', pg_temp.va(3), 'qty', 3)),
  null, null, null, 10.00, 'Cambió PB por PC y le damos 10 Bs', false));
select is(pg_temp.q('g6', 'outcome'), 'edited', 'G6: edición con línea quitada, línea nueva y descuento extra');
select is((select count(*)::int from public.order_items where order_id = pg_temp.o(22)), 2, 'G6: quedan dos líneas (PA y PC)');
select is((select count(*)::int from public.order_items where order_id = pg_temp.o(22) and variant_id = pg_temp.va(2)), 0, 'G6: PB ya no está');
select is((select unit_price from public.order_items where order_id = pg_temp.o(22) and variant_id = pg_temp.va(3)), 33.33, 'G6: la línea nueva toma el precio vigente (33,33)');
select is((select line_total from public.order_items where order_id = pg_temp.o(22) and variant_id = pg_temp.va(3)), 99.99, 'G6: 3 × 33,33 = 99,99');
select is((select cost_unit from public.order_items where order_id = pg_temp.o(22) and variant_id = pg_temp.va(3)), 10.00, 'G6: con el costo vigente congelado (10,00)');
select is((select discount from public.order_items where order_id = pg_temp.o(22) and variant_id = pg_temp.va(1)), 5.00, 'G6: reparto exacto del descuento extra: 5,00 a PA…');
select is((select discount from public.order_items where order_id = pg_temp.o(22) and variant_id = pg_temp.va(3)), 5.00, 'G6: …y 5,00 a PC');
select is((select discount_total from public.orders where id = pg_temp.o(22)), 10.00, 'G6: el descuento del pedido suma exactamente 10,00');
select is((select subtotal from public.orders where id = pg_temp.o(22)), 199.99, 'G6: subtotal 100 + 99,99 = 199,99');
select is(pg_temp.tot(22), 204.99, 'G6: total 199,99 − 10 + 15 = 204,99');
select is(pg_temp.stock(2), (pg_temp.g('g6s') ->> 'pb')::int + 1, 'G6: PB vuelve +1 al stock');
select is(pg_temp.stock(3), (pg_temp.g('g6s') ->> 'pc')::int - 3, 'G6: PC baja 3');
select is((select discount_offers #>> '{0,type}' from public.order_items where order_id = pg_temp.o(22) and variant_id = pg_temp.va(3)), 'manual', 'G6: el descuento queda anotado como «manual»');
select is((select discount_offers #>> '{0,reason}' from public.order_items where order_id = pg_temp.o(22) and variant_id = pg_temp.va(3)), 'Cambió PB por PC y le damos 10 Bs', 'G6: con su motivo');
select is((select line_no from public.order_items where order_id = pg_temp.o(22) and variant_id = pg_temp.va(3)), 3, 'G6: la línea nueva toma el siguiente número (3), sin reutilizar el de la quitada');
select is((select count(*)::int from jsonb_array_elements((select diff -> 'items' from public.order_edits where order_id = pg_temp.o(22))) e where e ->> 'op' = 'removed'), 1, 'G6: el diff registra la línea quitada');
select is((select count(*)::int from jsonb_array_elements((select diff -> 'items' from public.order_edits where order_id = pg_temp.o(22))) e where e ->> 'op' = 'added'), 1, 'G6: y la agregada');

-- G7: rechazos (nada se escribe)
select pg_temp.snap('g7');
select is(public.admin_edit_order(pg_temp.o(22), null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(22, 1), 'qty', 2)), null, null, null, 0, '', false) -> 'errors' -> 0 ->> 'code', 'reason_required', 'G7: el motivo es obligatorio');
select is(public.admin_edit_order(pg_temp.o(22), null, jsonb_build_array(jsonb_build_object('item_id', gen_random_uuid(), 'qty', 2)), null, null, null, 0, 'x', false) -> 'errors' -> 0 ->> 'code', 'item_not_found', 'G7: una línea que no es del pedido');
select is(public.admin_edit_order(pg_temp.o(22), null, jsonb_build_array(jsonb_build_object('variant_id', pg_temp.va(1), 'qty', 1)), null, null, null, 0, 'x', false) -> 'errors' -> 0 ->> 'code', 'duplicate_variant', 'G7: sumar una variante que ya está en el pedido (se edita su línea)');
select is(public.admin_edit_order(pg_temp.o(22), null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(22, 1), 'qty', 0), jsonb_build_object('item_id', (select id from public.order_items where order_id = pg_temp.o(22) and variant_id = pg_temp.va(3)), 'qty', 0)), null, null, null, 0, 'x', false) -> 'errors' -> 0 ->> 'code', 'order_empty', 'G7: dejar el pedido sin líneas se rechaza (para eso se cancela)');
select is(public.admin_edit_order(pg_temp.o(22), null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(22, 1), 'qty', 1)), null, null, null, 1000, 'x', false) -> 'errors' -> 0 ->> 'code', 'extra_discount_too_big', 'G7: un descuento extra mayor que lo que vale el pedido');
select is(public.admin_edit_order(pg_temp.o(22), null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(22, 1), 'qty', 1)), null, null, null, 1.005, 'x', false) -> 'errors' -> 0 ->> 'code', 'extra_discount_invalid', 'G7: un descuento con más decimales que la moneda');
select is(public.admin_edit_order(pg_temp.o(22), null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(22, 1), 'qty', -1)), null, null, null, 0, 'x', false) -> 'errors' -> 0 ->> 'code', 'items_invalid', 'G7: una cantidad negativa');
select is(public.admin_edit_order(pg_temp.o(22), null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(22, 1))), null, null, null, 0, 'x', false) -> 'errors' -> 0 ->> 'code', 'items_invalid', 'G7: sin cantidad');
select is(public.admin_edit_order(pg_temp.o(22), null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(22, 1), 'qty', 1, 'variant_id', pg_temp.va(1))), null, null, null, 0, 'x', false) -> 'errors' -> 0 ->> 'code', 'items_invalid', 'G7: línea Y variante a la vez');
select is(public.admin_edit_order(pg_temp.o(22), null, jsonb_build_array(jsonb_build_object('variant_id', gen_random_uuid(), 'qty', 1)), null, null, null, 0, 'x', false) -> 'errors' -> 0 ->> 'code', 'variant_unavailable', 'G7: una variante que no existe');
select is(public.admin_edit_order(pg_temp.o(22), null, '[]'::jsonb, null, null, -1, 0, 'x', false) -> 'errors' -> 0 ->> 'code', 'shipping_cost_invalid', 'G7: costo de envío negativo');
select is(public.admin_edit_order(pg_temp.o(22), null, '[]'::jsonb, '{"phone":"123"}'::jsonb, null, null, 0, 'x', false) -> 'errors' -> 0 ->> 'code', 'contact_invalid', 'G7: teléfono sin formato E.164');
select is(public.admin_edit_order(pg_temp.o(22), null, '[]'::jsonb, null, '{"line1":"x"}'::jsonb, null, 0, 'x', false) -> 'errors' -> 0 ->> 'code', 'address_invalid', 'G7: una dirección incompleta');
select ok(pg_temp.same('g7'), 'G7: ninguno de los rechazos dejó rastro (ni stock, ni libro, ni pedidos)');

-- G8: sin stock suficiente. PD tiene 1 unidad: pedido 23 con PD × 1 (stock 0) → pasar a 3 necesita 2 que no hay.
select pg_temp.mko(23, 15, 'pending_payment', '[{"v":4,"qty":1,"price":10}]');
select is(pg_temp.stock(4), 0, 'G8: PD quedó en 0');
select pg_temp.snap('g8');
select pg_temp.rec('g8', public.admin_edit_order(pg_temp.o(23), null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(23, 1), 'qty', 3)), null, null, null, 0, 'x', false));
select is(pg_temp.q('g8', 'outcome'), 'unavailable', 'G8: sin stock → «unavailable»');
select is((pg_temp.g('g8') #>> '{lines,0,available}')::int, 0, 'G8: con lo disponible (0)');
select is((pg_temp.g('g8') #>> '{lines,0,requested}')::int, 2, 'G8: y lo que faltaba (2)');
select ok(pg_temp.same('g8'), 'G8: y no se escribió nada');
-- Lo que otro cliente tiene retenido en su bolsa también cuenta: PC tiene 50 − 3 (pedido 22) − (la bolsa de u09 retiene 1) …
select is((select count(*)::int from public.stock_reservations where variant_id = pg_temp.va(3) and status = 'active'), 1, 'G9: la clienta 9 retiene 1 unidad de PC en su bolsa');
select is(public._order_stock_free(pg_temp.va(3)), pg_temp.stock(3) - 1, 'G9: lo libre descuenta la retención de las bolsas ajenas');

-- G10: estados y condiciones
select pg_temp.mko(24, 16, 'shipped', '[{"v":2,"qty":1,"price":40}]');
select is(public.admin_edit_order(pg_temp.o(24), null, '[]'::jsonb, '{"name":"Nuevo"}'::jsonb, null, null, 0, 'x', false) ->> 'outcome', 'not_editable', 'G10: un pedido enviado ya no se edita');
select is(public.admin_edit_order(pg_temp.o(2), null, '[]'::jsonb, '{"name":"Nuevo"}'::jsonb, null, null, 0, 'x', false) ->> 'outcome', 'not_editable', 'G10: ni uno completado (pedido 2)');
select is(public.admin_edit_order(pg_temp.o(6), null, '[]'::jsonb, '{"name":"Nuevo"}'::jsonb, null, null, 0, 'x', false) ->> 'outcome', 'not_editable', 'G10: ni uno cancelado (pedido 6)');
select is(public.admin_edit_order(gen_random_uuid(), null, '[]'::jsonb, null, null, null, 0, 'x', false) ->> 'outcome', 'not_found', 'G10: ni uno inexistente');
-- comprobante pendiente de revisión (QR): editar cambiaría el monto que ya pagó
select pg_temp.mko(25, 17, 'pending_payment', '[{"v":2,"qty":2,"price":40}]', 0, 0, 'manual_qr');
insert into public.payment_proofs (payment_id, order_id, profile_id, file_path, file_hash, mime, size_bytes)
values (pg_temp.pay(25), pg_temp.o(25), pg_temp.u(17),
        'a5000000-0000-0000-0000-000000000017/c5000000-0000-0000-0000-000000000025/f5000000-0000-0000-0000-000000000001.jpg',
        repeat('a', 64), 'image/jpeg', 1000);
select is(public.admin_edit_order(pg_temp.o(25), null, '[]'::jsonb, '{"name":"Nuevo"}'::jsonb, null, null, 0, 'x', false) ->> 'outcome', 'proof_pending', 'G11: con un comprobante por revisar no se edita (primero se decide el pago)');

-- G12: pedido YA PAGADO por un medio sin proveedor (WhatsApp): la diferencia queda como saldo, no se cobra sola.
-- Pedido 26: PA × 2 @100 = 200 (sin envío), pagado 200 por WhatsApp.
select pg_temp.mko(26, 18, 'paid', '[{"v":1,"qty":2,"price":100}]', 0, 0, 'whatsapp', 'paid');
select pg_temp.rec('g12', public.admin_edit_order(pg_temp.o(26), null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(26, 1), 'qty', 3)), null, null, null, 0, 'Pidió una más', true));
select is(pg_temp.q('g12', 'diff.payment'), 'balance_due', 'G12: subir un pedido ya pagado deja un saldo POR COBRAR');
select is((pg_temp.g('g12') ->> 'balance')::numeric, 100.00, 'G12: de 100,00 (300 − 200 pagados)');
select is((pg_temp.g('g12') ->> 'paid')::numeric, 200.00, 'G12: sobre 200,00 pagados');
select pg_temp.rec('g12b', public.admin_edit_order(pg_temp.o(26), null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(26, 1), 'qty', 3)), null, null, null, 0, 'Pidió una más', false));
select is(pg_temp.tot(26), 300.00, 'G12: el pedido vale 300,00');
select is((select amount from public.payments where id = pg_temp.pay(26)), 200.00, 'G12: el cobro conserva lo que SE PAGÓ (200,00): el saldo no se inventa como pagado');
select is(public._order_balance(pg_temp.o(26)), 100.00, 'G12: el saldo del pedido es +100,00');
select ok(exists (select 1 from jsonb_array_elements(public.admin_attention_orders()) a where a ->> 'kind' = 'balance_due' and a ->> 'order_id' = pg_temp.o(26)::text and (a #>> '{detail,amount}')::numeric = 100.00),
          'G12: aparece en «atención requerida» como saldo por cobrar de 100,00');
-- y a la inversa: bajar a 1 unidad (100) con 200 pagados ⇒ hay 100,00 de más que devolver
select pg_temp.rec('g13', public.admin_edit_order(pg_temp.o(26), null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(26, 1), 'qty', 1)), null, null, null, 0, 'Se quedó con una', false));
select is(pg_temp.q('g13', 'diff.payment'), 'refund_due', 'G13: bajar un pedido ya pagado deja dinero por DEVOLVER');
select is(public._order_balance(pg_temp.o(26)), -100.00, 'G13: saldo −100,00');
select ok(exists (select 1 from jsonb_array_elements(public.admin_attention_orders()) a where a ->> 'kind' = 'refund_due' and a ->> 'order_id' = pg_temp.o(26)::text and (a #>> '{detail,amount}')::numeric = 100.00),
          'G13: aparece como «por devolver» 100,00');

-- G14: contra entrega confirmada y sin cobrar: la edición cambia lo que se cobrará (no hay saldo)
select pg_temp.mko(27, 19, 'paid', '[{"v":2,"qty":1,"price":40}]', 0, 0, 'cash_on_delivery', 'paid');
select is(public.admin_edit_order(pg_temp.o(27), null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(27, 1), 'qty', 2)), null, null, null, 0, 'Pidió dos', false) ->> 'outcome', 'edited', 'G14: se edita un pedido de contra entrega confirmado');
select is((select amount from public.payments where id = pg_temp.pay(27)), 80.00, 'G14: lo que se cobrará en la entrega pasa a 80,00');
select is(public._order_balance(pg_temp.o(27)), 0::numeric, 'G14: sin saldo mientras no se cobre');

-- G15: contacto, dirección y envío
select pg_temp.mko(28, 20, 'pending_payment', '[{"v":2,"qty":1,"price":40}]', 15);
select pg_temp.rec('g15', public.admin_edit_order(pg_temp.o(28), null, '[]'::jsonb, '{"name":"  Nombre Nuevo  ","email":"NUEVO@Test.com","phone":"+59171112222"}'::jsonb,
  '{"recipient":"Rita","phone_e164":"+59171112222","line1":"Av. Nueva 123","city":"El Alto","lat":-16.5,"lng":-68.2}'::jsonb, 20.00, 0, 'Se mudó', true));
select is(pg_temp.q('g15', 'outcome'), 'preview', 'G15: vista previa de contacto + dirección + envío');
select is((pg_temp.g('g15') #>> '{after,shipping_cost}')::numeric, 20.00, 'G15: el envío nuevo lo fija el administrador (20,00)');
select is((pg_temp.g('g15') #>> '{after,total}')::numeric, 60.00, 'G15: total 40 + 20 = 60,00');
select ok((pg_temp.g('g15') -> 'suggested_shipping') is not null and pg_temp.g('g15') #>> '{suggested_shipping,cost}' = '15.00',
          'G15: la vista previa trae la cotización SUGERIDA para la dirección nueva (15,00 plano), sin aplicarla');
select pg_temp.rec('g15b', public.admin_edit_order(pg_temp.o(28), null, '[]'::jsonb, '{"name":"  Nombre Nuevo  ","email":"NUEVO@Test.com","phone":"+59171112222"}'::jsonb,
  '{"recipient":"Rita","phone_e164":"+59171112222","line1":"Av. Nueva 123","city":"El Alto","lat":-16.5,"lng":-68.2}'::jsonb, 20.00, 0, 'Se mudó', false));
select is((select contact_name from public.orders where id = pg_temp.o(28)), 'Nombre Nuevo', 'G15: el nombre queda sin espacios');
select is((select contact_email from public.orders where id = pg_temp.o(28)), 'nuevo@test.com', 'G15: el correo en minúsculas');
select is((select shipping_address ->> 'line1' from public.orders where id = pg_temp.o(28)), 'Av. Nueva 123', 'G15: la dirección nueva');
select is((select shipping_address ->> 'id' from public.orders where id = pg_temp.o(28)), null, 'G15: sin el id de la dirección guardada (ya no es esa)');
select is((select shipping_method #>> '{quote,manual}' from public.orders where id = pg_temp.o(28)), 'true', 'G15: el costo de envío queda marcado como fijado a mano');
select is(pg_temp.tot(28), 60.00, 'G15: total 60,00');
select is((select (diff ->> 'contact_changed')::boolean and (diff ->> 'address_changed')::boolean from public.order_edits where order_id = pg_temp.o(28)), true,
          'G15: el libro anota que cambiaron contacto y dirección…');
select is((select before::text || after::text like '%Av. Nueva%' from public.order_edits where order_id = pg_temp.o(28)), false, 'G15: …pero NO guarda los datos personales (el libro no se puede anonimizar)');
-- envío gratis sigue gratis: pedido 29 con envío 15 y descuento de envío 15 ⇒ al fijar 25, el descuento sigue cubriéndolo
select pg_temp.mko(29, 21, 'pending_payment', '[{"v":2,"qty":1,"price":40}]', 15, 15);
select pg_temp.rec('g16', public.admin_edit_order(pg_temp.o(29), null, '[]'::jsonb, null, null, 25.00, 0, 'Más lejos', false));
select is((select shipping_discount from public.orders where id = pg_temp.o(29)), 25.00, 'G16: un envío que era gratis sigue gratis con el costo nuevo');
select is(pg_temp.tot(29), 40.00, 'G16: total 40,00');
-- pickup: no admite dirección
select pg_temp.mko(30, 22, 'pending_payment', '[{"v":2,"qty":1,"price":40}]');
select set_config('app.order_edit', '1', true);
update public.orders set shipping_method = '{"code":"recojo","name":"Recojo","kind":"pickup"}'::jsonb, shipping_address = null where id = pg_temp.o(30);
select set_config('app.order_edit', '', true);
select is(public.admin_edit_order(pg_temp.o(30), null, '[]'::jsonb, null, '{"recipient":"R","phone_e164":"+59171112222","line1":"Calle 1","city":"La Paz"}'::jsonb, null, 0, 'x', false) -> 'errors' -> 0 ->> 'code', 'address_not_applicable', 'G17: un pedido de recojo no lleva dirección');

-- G18: con un reembolso o una devolución abierta las líneas no se mueven (el prorrateo se apoya en ellas)
insert into public.refunds (order_id, kind, amount, currency, reason, status, idempotency_key)
values (pg_temp.o(26), 'amount', 10.00, 'BOB', 'Prueba', 'requested', 'g18-refund-key');
select is(public.admin_edit_order(pg_temp.o(26), null, '[]'::jsonb, '{"name":"Nuevo"}'::jsonb, null, null, 0, 'x', false) ->> 'outcome', 'has_refunds', 'G18: con un reembolso en curso no se edita');

-- G19: permisos
select pg_temp.as_(pg_temp.u(12));
select throws_ok($$select public.admin_edit_order('c5000000-0000-0000-0000-000000000020', null, '[]'::jsonb, null, null, null, 0, 'x', true)$$, '42501', 'solo administradores', 'G19: la clienta dueña del pedido NO lo edita');
select pg_temp.as_(pg_temp.ad(1));
select pg_temp.as_(pg_temp.u(12));
set local role authenticated;
select is((select count(*)::int from public.order_edits), 0, 'G19: la clienta no ve el libro de ediciones de su pedido');
select throws_ok($$update public.orders set total = 1 where id = 'c5000000-0000-0000-0000-000000000020'$$, '42501', null, 'G19: ni edita su pedido por la API');
reset role;
select pg_temp.as_(pg_temp.ad(1));


-- ═══ H. Pedido manual (ventas por WhatsApp) ═════════════════════════════════════════════════
create function pg_temp.mo(p_u int, p_items jsonb, p_key text, p_pay text default 'whatsapp', p_ship text default 'delivery',
                           p_addr jsonb default '{"recipient":"Rosa","phone_e164":"+59172223333","line1":"Av. Arce 100","city":"La Paz","lat":-16.52,"lng":-68.15}',
                           p_cost numeric default null, p_slot uuid default null, p_date date default null, p_disc numeric default 0,
                           p_dreason text default null, p_paid boolean default false, p_dry boolean default false,
                           p_channel text default 'whatsapp', p_note text default null) returns jsonb language sql as $$
  select public.admin_create_manual_order(pg_temp.u(p_u), p_items, p_channel, p_pay, p_ship, p_addr, p_key, p_cost, p_slot, p_date,
                                          p_disc, p_dreason, null, null, null, p_note, p_paid, p_dry) $$;

-- H1: vista previa. PA × 2 @100 + PB × 1 @40 = 240; envío plano 15; total 255. No escribe nada.
select pg_temp.snap('h1');
select pg_temp.rec('h1', pg_temp.mo(23, '[{"variant_id":"f5000000-0000-0000-0000-000000000001","qty":2},{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', null, p_dry => true));
select is(pg_temp.q('h1', 'outcome'), 'preview', 'H1: la vista previa responde «preview»');
select is((pg_temp.g('h1') #>> '{totals,subtotal}')::numeric, 240.00, 'H1: subtotal 2 × 100 + 40 = 240,00');
select is((pg_temp.g('h1') #>> '{totals,shipping}')::numeric, 15.00, 'H1: envío plano 15,00');
select is((pg_temp.g('h1') #>> '{totals,total}')::numeric, 255.00, 'H1: total 255,00');
select is(jsonb_array_length(pg_temp.g('h1') -> 'lines'), 2, 'H1: dos líneas');
select ok(pg_temp.same('h1'), 'H1: la vista previa NO escribe nada (contador, stock, pedidos)');

-- H2: crear. El contador avanza 1 y el número es el siguiente correlativo sin huecos.
select pg_temp.rec('h2n', jsonb_build_object('c', pg_temp.cnt(), 'pa', pg_temp.stock(1), 'pb', pg_temp.stock(2)));
select pg_temp.snap('h2');
select pg_temp.rec('h2', pg_temp.mo(23, '[{"variant_id":"f5000000-0000-0000-0000-000000000001","qty":2},{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]',
                                    'manual-key-0001', p_note => 'Pidió por WhatsApp el 14/11'));
select is(pg_temp.q('h2', 'outcome'), 'created', 'H2: el pedido manual se crea');
select is(pg_temp.q('h2', 'number'), 'MIC-' || lpad(((pg_temp.g('h2n') ->> 'c')::bigint + 1)::text, 6, '0'), 'H2 (criterio 3): recibe el siguiente número MIC-… correlativo');
select is(pg_temp.cnt(), (pg_temp.g('h2n') ->> 'c')::bigint + 1, 'H2: el contador avanzó exactamente 1');
select is(pg_temp.q('h2', 'status'), 'pending_payment', 'H2: nace pendiente de pago');
select is((pg_temp.g('h2') ->> 'total')::numeric, 255.00, 'H2: total 255,00');
select is((select channel from public.orders where id = pg_temp.q('h2', 'order_id')::uuid), 'whatsapp', 'H2: canal «whatsapp»');
select is((select profile_id from public.orders where id = pg_temp.q('h2', 'order_id')::uuid), pg_temp.u(23), 'H2: a nombre de la clienta elegida');
select is((select contact_name from public.orders where id = pg_temp.q('h2', 'order_id')::uuid), 'Clienta 23', 'H2: contacto tomado de la cuenta si no se escribe otro');
select is((select contact_phone from public.orders where id = pg_temp.q('h2', 'order_id')::uuid), '+59170000023', 'H2: …también el teléfono');
select is((select shipping_address ->> 'line1' from public.orders where id = pg_temp.q('h2', 'order_id')::uuid), 'Av. Arce 100', 'H2: dirección de entrega');
select is((select shipping_method ->> 'kind' from public.orders where id = pg_temp.q('h2', 'order_id')::uuid), 'delivery', 'H2: con su método de envío');
select is(pg_temp.stock(1), (pg_temp.g('h2n') ->> 'pa')::int - 2, 'H2: el stock firme de PA bajó 2');
select is(pg_temp.stock(2), (pg_temp.g('h2n') ->> 'pb')::int - 1, 'H2: el de PB bajó 1');
select is((select count(*)::int from public.order_items where order_id = pg_temp.q('h2', 'order_id')::uuid), 2, 'H2: dos líneas');
select is((select cost_unit from public.order_items where order_id = pg_temp.q('h2', 'order_id')::uuid and variant_id = pg_temp.va(1)), 60.00, 'H2: con el costo de PA congelado (60,00)');
select is((select sum(final_total) from public.order_items where order_id = pg_temp.q('h2', 'order_id')::uuid), 240.00, 'H2: las líneas suman el subtotal');
select is((select actor_kind || '|' || reason || '|' || (actor_id = pg_temp.ad(1))::text from public.order_status_history where order_id = pg_temp.q('h2', 'order_id')::uuid), 'admin|manual:whatsapp|true',
          'H2: el historial dice quién lo creó (el administrador) y por qué canal');
select is((select status || '|' || amount::text || '|' || provider from public.payments where order_id = pg_temp.q('h2', 'order_id')::uuid), 'pending|255.00|whatsapp', 'H2: cobro pendiente por el total');
select is((select payment_expires_at is null from public.orders where id = pg_temp.q('h2', 'order_id')::uuid), true, 'H2: WhatsApp no vence (S-05)');
select is((select body from public.order_notes where order_id = pg_temp.q('h2', 'order_id')::uuid), 'Pidió por WhatsApp el 14/11', 'H2: la nota queda en el pedido');
select ok(exists (select 1 from public.notification_outbox where dedupe_key = 'order_created:' || pg_temp.q('h2', 'order_id') || ':c'), 'H2: se avisa a la clienta');
select is((select count(*)::int from public.order_counters where prefix = 'MIC'), 1, 'H2: sigue habiendo un solo contador');

-- H3: idempotencia (doble clic)
select pg_temp.snap('h3');
select is(pg_temp.mo(23, '[{"variant_id":"f5000000-0000-0000-0000-000000000001","qty":2},{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', 'manual-key-0001', p_note => 'Pidió por WhatsApp el 14/11') ->> 'outcome', 'existing', 'H3: la misma llave y lo mismo devuelve el pedido ya creado');
select is(pg_temp.mo(23, '[{"variant_id":"f5000000-0000-0000-0000-000000000001","qty":2},{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', 'manual-key-0001', p_note => 'Pidió por WhatsApp el 14/11') ->> 'number', pg_temp.q('h2', 'number'), 'H3: con el MISMO número');
select ok(pg_temp.same('h3'), 'H3: sin descontar stock ni avanzar el contador otra vez');
select is(pg_temp.mo(23, '[{"variant_id":"f5000000-0000-0000-0000-000000000001","qty":3}]', 'manual-key-0001') -> 'errors' -> 0 ->> 'code', 'idempotency_conflict', 'H4: la misma llave con OTRO contenido es un conflicto (no devuelve el pedido viejo como si fuera el nuevo)');
select ok(pg_temp.same('h3'), 'H4: y no escribe nada');

-- H5: ya pagado, con recojo (envío 0): PB × 2 @40 = 80
select pg_temp.rec('h5', pg_temp.mo(24, '[{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":2}]', 'manual-key-0002', p_ship => 'recojo', p_addr => null, p_paid => true, p_channel => 'manual'));
select is(pg_temp.q('h5', 'outcome'), 'created', 'H5: pedido manual de recojo, ya pagado');
select is(pg_temp.q('h5', 'status'), 'paid', 'H5: nace «pagado» (el dinero ya se recibió)');
select is((pg_temp.g('h5') ->> 'total')::numeric, 80.00, 'H5: total 80,00 (recojo, sin envío)');
select is((select status from public.payments where order_id = pg_temp.q('h5', 'order_id')::uuid), 'paid', 'H5: su cobro también');
select is((select channel from public.orders where id = pg_temp.q('h5', 'order_id')::uuid), 'manual', 'H5: canal «manual»');
select is((select to_status from public.order_status_history where order_id = pg_temp.q('h5', 'order_id')::uuid order by id desc limit 1), 'paid', 'H5: el historial termina en «paid», hecho por el administrador');
select is((select shipping_address is null from public.orders where id = pg_temp.q('h5', 'order_id')::uuid), true, 'H5: sin dirección');

-- H6: descuento manual 25,00 sobre PA × 2 (200) y PB × 1 (40). Reparto por el mayor resto: 2083 y 417 centavos ⇒ 20,83 y 4,17.
select is(pg_temp.mo(22, '[{"variant_id":"f5000000-0000-0000-0000-000000000001","qty":2},{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', 'manual-key-0003', p_disc => 25.00) -> 'errors' -> 0 ->> 'code', 'discount_reason_required', 'H6: un descuento sin motivo se rechaza');
select is(pg_temp.mo(22, '[{"variant_id":"f5000000-0000-0000-0000-000000000001","qty":1}]', 'manual-key-0003', p_disc => 101.00, p_dreason => 'x') -> 'errors' -> 0 ->> 'code', 'discount_too_big', 'H6: un descuento mayor que el subtotal también');
select pg_temp.rec('h6', pg_temp.mo(22, '[{"variant_id":"f5000000-0000-0000-0000-000000000001","qty":2},{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', 'manual-key-0003', p_disc => 25.00, p_dreason => 'Cliente frecuente'));
select is(pg_temp.q('h6', 'outcome'), 'created', 'H6: pedido con descuento manual');
select is((select discount from public.order_items where order_id = pg_temp.q('h6', 'order_id')::uuid and variant_id = pg_temp.va(1)), 20.83, 'H6: PA recibe 20,83');
select is((select discount from public.order_items where order_id = pg_temp.q('h6', 'order_id')::uuid and variant_id = pg_temp.va(2)), 4.17, 'H6: PB recibe 4,17');
select is((select discount_total from public.orders where id = pg_temp.q('h6', 'order_id')::uuid), 25.00, 'H6: la suma es EXACTAMENTE 25,00');
select is((pg_temp.g('h6') ->> 'total')::numeric, 230.00, 'H6: total 240 − 25 + 15 = 230,00');
select is((select discounts #>> '{0,reason}' from public.orders where id = pg_temp.q('h6', 'order_id')::uuid), 'Cliente frecuente', 'H6: el motivo queda en el pedido');
select is((select discount_offers #>> '{0,type}' from public.order_items where order_id = pg_temp.q('h6', 'order_id')::uuid and variant_id = pg_temp.va(1)), 'manual', 'H6: y en cada línea, como «manual»');

-- H7: precio fijado a mano (PA a 80,00) ⇒ línea 80; total 80 + 15 = 95; queda anotado en las notas
select pg_temp.rec('h7', pg_temp.mo(21, '[{"variant_id":"f5000000-0000-0000-0000-000000000001","qty":1,"unit_price":80}]', 'manual-key-0004'));
select is((pg_temp.g('h7') ->> 'total')::numeric, 95.00, 'H7: total 80 + 15 = 95,00');
select is((select unit_price from public.order_items where order_id = pg_temp.q('h7', 'order_id')::uuid), 80.00, 'H7: precio unitario 80,00');
select is((select body from public.order_notes where order_id = pg_temp.q('h7', 'order_id')::uuid), 'Precio fijado a mano en: Producto S12 01', 'H7: el precio fijado a mano queda a la vista');

-- H8: sin stock y lista negra: no crean nada
select pg_temp.snap('h8');
select is(pg_temp.stock(4), 0, 'H8: PD no tiene stock');
select pg_temp.rec('h8', pg_temp.mo(23, '[{"variant_id":"f5000000-0000-0000-0000-000000000004","qty":1}]', 'manual-key-0005'));
select is(pg_temp.q('h8', 'outcome'), 'unavailable', 'H8: sin stock → «unavailable»');
select is((pg_temp.g('h8') #>> '{lines,0,available}')::int, 0, 'H8: con lo disponible');
select ok(pg_temp.same('h8'), 'H8: y el contador, el stock y los pedidos quedan intactos');
select is(pg_temp.mo(1, '[{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', 'manual-key-0006') ->> 'outcome', 'blacklisted', 'H9 (criterio 3, S-07): una cuenta en lista negra no recibe pedidos manuales');
select is(pg_temp.mo(5, '[{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', 'manual-key-0007') ->> 'outcome', 'blacklisted', 'H9: ni una cuyo TELÉFONO está bloqueado');
select is(pg_temp.mo(1, '[{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', null, p_dry => true) ->> 'outcome', 'blacklisted', 'H9: tampoco en la vista previa');
select ok(pg_temp.same('h8'), 'H9: nada se creó');

-- H10: validaciones
update public.profiles set is_active = false where id = pg_temp.u(19);
select is(pg_temp.mo(19, '[{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', 'manual-key-0008') -> 'errors' -> 0 ->> 'code', 'account_inactive', 'H10: una cuenta desactivada no recibe pedidos');
select is(pg_temp.mo(23, '[{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', 'manual-key-0009', p_channel => 'web') -> 'errors' -> 0 ->> 'code', 'request_invalid', 'H10: el canal «web» no existe para pedidos manuales');
select is(pg_temp.mo(23, '[]', 'manual-key-0009') -> 'errors' -> 0 ->> 'code', 'request_invalid', 'H10: sin productos');
select is(pg_temp.mo(23, '[{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', null) -> 'errors' -> 0 ->> 'code', 'request_invalid', 'H10: aplicar sin llave de idempotencia');
select is(pg_temp.mo(23, '[{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":0}]', 'manual-key-0010') -> 'errors' -> 0 ->> 'code', 'items_invalid', 'H10: cantidad 0');
select is(pg_temp.mo(23, '[{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1},{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":2}]', 'manual-key-0010') -> 'errors' -> 0 ->> 'code', 'duplicate_variant', 'H10: la misma variante dos veces');
select is(pg_temp.mo(23, '[{"variant_id":"f5000000-0000-0000-0000-000000000099","qty":1}]', 'manual-key-0010') -> 'errors' -> 0 ->> 'code', 'variant_unavailable', 'H10: una variante inexistente');
select is(pg_temp.mo(23, '[{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', 'manual-key-0010', p_pay => 'inventado') -> 'errors' -> 0 ->> 'code', 'payment_unavailable', 'H10: un método de pago que no existe');
select is(pg_temp.mo(23, '[{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', 'manual-key-0010', p_ship => 'inventado') -> 'errors' -> 0 ->> 'code', 'method_not_found', 'H10: un método de envío que no existe');
select is(pg_temp.mo(23, '[{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', 'manual-key-0010', p_addr => null) -> 'errors' -> 0 ->> 'code', 'address_required', 'H10: a domicilio sin dirección');
select is(pg_temp.mo(23, '[{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', 'manual-key-0010', p_addr => '{"line1":"x"}') -> 'errors' -> 0 ->> 'code', 'address_invalid', 'H10: dirección incompleta');
select is(pg_temp.mo(23, '[{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', 'manual-key-0010', p_cost => -1) -> 'errors' -> 0 ->> 'code', 'shipping_cost_invalid', 'H10: costo de envío negativo');
update public.payment_methods set max_amount = 100 where country = 'BO' and code = 'cash_on_delivery';
select is(pg_temp.mo(23, '[{"variant_id":"f5000000-0000-0000-0000-000000000001","qty":2}]', 'manual-key-0010', p_pay => 'cash_on_delivery') -> 'errors' -> 0 ->> 'reason', 'over_max_amount', 'H11: el tope de monto de contra entrega también rige para pedidos manuales');
update public.payment_methods set max_amount = null where country = 'BO' and code = 'cash_on_delivery';
select ok(pg_temp.same('h8'), 'H10-11: ninguna validación fallida dejó rastro');

-- H12: dirección fuera de cobertura: se rechaza, salvo que el administrador fije el costo (y lo decide él)
select is(pg_temp.mo(23, '[{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', null, p_dry => true,
          p_addr => '{"recipient":"Lejos","phone_e164":"+59172223333","line1":"Pueblo lejano","city":"Oruro","lat":-17.97,"lng":-67.11}') ->> 'outcome', 'rejected', 'H12: una dirección fuera de la cobertura se rechaza');
select pg_temp.rec('h12', pg_temp.mo(23, '[{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', null, p_dry => true, p_cost => 30.00,
          p_addr => '{"recipient":"Lejos","phone_e164":"+59172223333","line1":"Pueblo lejano","city":"Oruro","lat":-17.97,"lng":-67.11}'));
select is(pg_temp.q('h12', 'outcome'), 'preview', 'H12: con el costo fijado por el administrador, se acepta');
select is((pg_temp.g('h12') #>> '{totals,shipping}')::numeric, 30.00, 'H12: envío 30,00');
select is((pg_temp.g('h12') #>> '{totals,total}')::numeric, 70.00, 'H12: total 40 + 30 = 70,00');
select is(pg_temp.g('h12') #>> '{shipping,manual_cost}', 'true', 'H12: marcado como costo manual');

-- H13: contra entrega «pagado» = confirmado, NO cobrado: no cuenta como dinero pagado (BR-PAY-07)
select pg_temp.rec('h13', pg_temp.mo(21, '[{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', 'manual-key-0011', p_pay => 'cash_on_delivery', p_paid => true));
select is(pg_temp.q('h13', 'status'), 'paid', 'H13: contra entrega confirmada');
select is((select status from public.payments where order_id = pg_temp.q('h13', 'order_id')::uuid), 'paid', 'H13: su cobro queda «pagado» (confirmado)…');
select is(public._order_paid_amount(pg_temp.q('h13', 'order_id')::uuid), 0::numeric, 'H13: …pero NO hay dinero pagado hasta que se cobre en la entrega');

-- H14: una franja con cupo 1: el segundo pedido en la misma franja se rechaza y NO deja rastro (la numeración no avanza)
select pg_temp.rec('h14a', pg_temp.mo(20, '[{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', 'manual-key-0012', p_slot => pg_temp.sl('10:00'), p_date => (select d from t_day)));
select is(pg_temp.q('h14a', 'outcome'), 'created', 'H14: el primero ocupa el cupo de la franja de 10:00');
select is((select delivery_slot ->> 'slot_id' from public.orders where id = pg_temp.q('h14a', 'order_id')::uuid), pg_temp.sl('10:00')::text, 'H14: la franja queda en el pedido');
select is((select count(*)::int from public.delivery_bookings where owner_type = 'order' and owner_id = pg_temp.q('h14a', 'order_id')::uuid and status = 'active'), 1, 'H14: y reserva su cupo');
select pg_temp.snap('h14');
select is(pg_temp.mo(18, '[{"variant_id":"f5000000-0000-0000-0000-000000000002","qty":1}]', 'manual-key-0013', p_slot => pg_temp.sl('10:00'), p_date => (select d from t_day)) ->> 'outcome', 'rejected', 'H14: el segundo (franja llena) se rechaza');
select ok(pg_temp.same('h14'), 'H14: sin avanzar el contador, sin mover stock y sin crear pedido (numeración sin huecos)');
-- cancelar libera el cupo
select public.admin_transition_order(pg_temp.q('h14a', 'order_id')::uuid, 'cancelled', 'Prueba de cupo');
select is((select count(*)::int from public.delivery_bookings where owner_type = 'order' and owner_id = pg_temp.q('h14a', 'order_id')::uuid and status = 'active'), 0, 'H14: cancelar el pedido manual libera su cupo');

-- H15: permisos
select pg_temp.as_(pg_temp.u(23));
select throws_ok($$select public.admin_create_manual_order('a5000000-0000-0000-0000-000000000023', '[]'::jsonb, 'manual', 'whatsapp', 'delivery', null, null, null, null, null, 0, null, null, null, null, null, false, true)$$,
  '42501', 'solo administradores', 'H15: una clienta no crea pedidos manuales');
select pg_temp.as_(pg_temp.ad(1));


-- ═══ I. Reembolsos ══════════════════════════════════════════════════════════════════════════
create function pg_temp.rf(p_n int, p_key text, p_mode text, p_items jsonb default null, p_ship boolean default false,
                           p_ded numeric default 0, p_amount numeric default null, p_reason text default 'Prueba', p_method text default 'bank_transfer',
                           p_cancel boolean default false, p_done boolean default false, p_dry boolean default false, p_return uuid default null)
returns jsonb language sql as $$
  select public.admin_refund_order(pg_temp.o(p_n), p_key, p_mode, p_items, p_ship, p_ded, p_amount, p_reason, p_method, 'Cuenta de prueba', null,
                                   p_return, p_cancel, p_done, p_dry) $$;
-- stock extra para las pruebas de propiedades
select lives_ok($$select public.apply_stock_change(pg_temp.va(2), 600, 'import', 'S12 refunds')$$, 'I0: stock extra de PB para las pruebas de propiedades');
select lives_ok($$select public.apply_stock_change(pg_temp.va(1), 100, 'import', 'S12 refunds')$$, 'I0: y de PA');

-- Pedido 40 (clienta 2): L1 = PA × 2 @100 con descuento 20 (final 180) · L2 = PB × 3 @40 con descuento 12 (línea 120, final 108)
-- envío 15 · subtotal 320 · descuento 32 · total 320 − 32 + 15 = 303 · pagado 303 (WhatsApp, confirmado).
select pg_temp.mko(40, 2, 'paid', '[{"v":1,"qty":2,"price":100,"disc":20},{"v":2,"qty":3,"price":40,"disc":12}]', 15, 0, 'whatsapp', 'paid');
select is(pg_temp.tot(40), 303.00, 'I0: el pedido 40 suma 303,00');
select is(public._order_paid_amount(pg_temp.o(40)), 303.00, 'I0: pagado 303,00 (lo efectivamente pagado)');
select pg_temp.snap('i0');

-- I1: vistas previas (no escriben). Cada importe sale de una cuenta hecha a mano.
select pg_temp.rec('i1', pg_temp.rf(40, null, 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 1), 'qty', 1)), p_dry => true));
select is(pg_temp.q('i1', 'outcome'), 'preview', 'I1: vista previa de devolver 1 de las 2 unidades de L1');
select is((pg_temp.g('i1') #>> '{refund,amount}')::numeric, 90.00, 'I1: 180 × 1/2 = 90,00 (el descuento va prorrateado: la clienta devuelve lo que pagó por esa unidad)');
select is((pg_temp.g('i1') #>> '{refund,left_after}')::numeric, 213.00, 'I1: quedarían 303 − 90 = 213,00 por devolver');
select is((pg_temp.g('i1') #>> '{refund,lines,0,amount}')::numeric, 90.00, 'I1: el desglose por línea');
select is((pg_temp.rf(40, null, 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 2), 'qty', 1)), p_dry => true) #>> '{refund,amount}')::numeric, 36.00,
          'I2: 1 de las 3 unidades de L2: 108 × 1/3 = 36,00');
select is((pg_temp.rf(40, null, 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 2), 'qty', 2)), p_dry => true) #>> '{refund,amount}')::numeric, 72.00,
          'I2: 2 de 3: 72,00');
select is((pg_temp.rf(40, null, 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 1), 'qty', 1), jsonb_build_object('item_id', pg_temp.it(40, 2), 'qty', 1)), p_ship => true, p_dry => true) #>> '{refund,amount}')::numeric,
          141.00, 'I3: L1 × 1 (90) + L2 × 1 (36) + envío pagado (15) = 141,00');
select is((pg_temp.rf(40, null, 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 1), 'qty', 1), jsonb_build_object('item_id', pg_temp.it(40, 2), 'qty', 1)), p_ship => true, p_ded => 8, p_dry => true) #>> '{refund,amount}')::numeric,
          133.00, 'I3: con una retención de 8,00 (con motivo): 133,00');
select is((pg_temp.rf(40, null, 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 1), 'qty', 2), jsonb_build_object('item_id', pg_temp.it(40, 2), 'qty', 3)), p_ship => true, p_dry => true) #>> '{refund,amount}')::numeric,
          303.00, 'I4: devolver TODO (180 + 108 + 15) = 303,00 = lo pagado: la suma de las líneas cuadra con el total del pedido');
select is((pg_temp.rf(40, null, 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 1), 'qty', 3)), p_dry => true) -> 'refund' -> 'errors' -> 0 ->> 'code'), 'qty_exceeds', 'I5: más unidades que las compradas');
select is((pg_temp.rf(40, null, 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 1), 'qty', 3)), p_dry => true) -> 'refund' -> 'errors' -> 0 ->> 'max')::int, 2, 'I5: con el máximo que sí se puede');
select is((pg_temp.rf(40, null, 'items', '[]'::jsonb, p_dry => true) -> 'refund' -> 'errors' -> 0 ->> 'code'), 'nothing_selected', 'I6: sin líneas ni envío no hay nada que devolver');
select is((pg_temp.rf(40, null, 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 1), 'qty', 1)), p_ded => 95, p_dry => true) -> 'refund' -> 'errors' -> 0 ->> 'code'), 'deduction_too_big', 'I6: una retención mayor que lo devuelto');
select is((pg_temp.rf(40, null, 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 1), 'qty', 1)), p_ded => 1.005, p_dry => true) -> 'refund' -> 'errors' -> 0 ->> 'code'), 'deduction_invalid', 'I6: ni con más decimales que la moneda');
select is((pg_temp.rf(40, null, 'items', jsonb_build_array(jsonb_build_object('item_id', gen_random_uuid(), 'qty', 1)), p_dry => true) -> 'refund' -> 'errors' -> 0 ->> 'code'), 'item_not_found', 'I6: una línea que no es del pedido');
select is((pg_temp.rf(40, null, 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 1), 'qty', 1), jsonb_build_object('item_id', pg_temp.it(40, 1), 'qty', 1)), p_dry => true) -> 'refund' -> 'errors' -> 0 ->> 'code'), 'duplicate_item', 'I6: la misma línea dos veces');
select is((pg_temp.rf(40, null, 'items', '[{"item_id":"no-uuid","qty":1}]', p_dry => true) -> 'refund' -> 'errors' -> 0 ->> 'code'), 'items_invalid', 'I6: un id que no es uuid');
select is((pg_temp.rf(40, null, 'amount', p_amount => 303.01, p_dry => true) -> 'refund' -> 'errors' -> 0 ->> 'code'), 'exceeds_paid', 'I7 (criterio 4): no se puede devolver más de lo pagado');
select is((pg_temp.rf(40, null, 'amount', p_amount => 303.01, p_dry => true) -> 'refund' -> 'errors' -> 0 ->> 'left')::numeric, 303.00, 'I7: con lo que sí queda por devolver');
select is((pg_temp.rf(40, null, 'amount', p_amount => 0, p_dry => true) -> 'refund' -> 'errors' -> 0 ->> 'code'), 'amount_invalid', 'I7: monto 0');
select is((pg_temp.rf(40, null, 'amount', p_amount => 10.001, p_dry => true) -> 'refund' -> 'errors' -> 0 ->> 'code'), 'amount_invalid', 'I7: más decimales que la moneda');
select ok(pg_temp.same('i0'), 'I8: ninguna vista previa ni rechazo escribió nada');

-- I9: aplicar (1) — L1 × 1 solicitado (aún no devuelto el dinero): 90,00
select pg_temp.rec('i9', pg_temp.rf(40, 'refund-key-0001', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 1), 'qty', 1)), p_reason => 'Devolvió una prenda'));
select is(pg_temp.q('i9', 'outcome'), 'requested', 'I9: el reembolso queda «solicitado»');
select is((pg_temp.g('i9') ->> 'amount')::numeric, 90.00, 'I9: 90,00');
select is((select status || '|' || kind || '|' || method from public.refunds where id = pg_temp.q('i9', 'refund_id')::uuid), 'requested|items|bank_transfer', 'I9: estado, tipo y forma');
select is((select requested_by from public.refunds where id = pg_temp.q('i9', 'refund_id')::uuid), pg_temp.ad(1), 'I9: con quién lo pidió');
select is((select qty || '|' || amount from public.refund_items where refund_id = pg_temp.q('i9', 'refund_id')::uuid), '1|90.00', 'I9: el desglose por línea queda guardado');
select is(pg_temp.ost(40), 'paid', 'I9: el pedido sigue pagado (devolver una prenda no lo cancela)');
select is(pg_temp.pst(40), 'paid', 'I9: y su cobro también');
select is(public._order_refunded_amount(pg_temp.o(40)), 90.00, 'I9: ya comprometidos 90,00 a devolver');
select is(public._order_refunded_amount(pg_temp.o(40), true), 0::numeric, 'I9: pero devueltos (procesados) aún 0');
select ok(not exists (select 1 from public.notification_outbox where dedupe_key like 'order_refund_processed:' || pg_temp.o(40)::text || '%'), 'I9: no se avisa a la clienta hasta que el dinero se devuelve');
-- idempotencia
select pg_temp.snap('i10');
select is(pg_temp.rf(40, 'refund-key-0001', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 1), 'qty', 1)), p_reason => 'Devolvió una prenda') ->> 'outcome', 'existing', 'I10 (idempotencia): el doble clic devuelve el mismo reembolso');
select is(pg_temp.rf(40, 'refund-key-0001', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 1), 'qty', 1)), p_reason => 'Devolvió una prenda') ->> 'refund_id', pg_temp.q('i9', 'refund_id'), 'I10: con el MISMO id');
select is(pg_temp.rf(40, 'refund-key-0001', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 2), 'qty', 1)), p_reason => 'Devolvió una prenda') -> 'errors' -> 0 ->> 'code', 'idempotency_conflict', 'I10: la misma llave con OTRO contenido es un conflicto');
select ok(pg_temp.same('i10'), 'I10: y no escribió nada');
-- doble administrador (otra llave) sobre lo mismo: el segundo ya no encuentra tantas unidades
select is(pg_temp.rf(40, 'refund-key-0002', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 1), 'qty', 2))) -> 'refund' -> 'errors' -> 0 ->> 'code', 'qty_exceeds', 'I11: otra persona que intenta devolver las 2 unidades de L1 ve que 1 ya está en camino');
select is(pg_temp.rf(40, 'refund-key-0002', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 1), 'qty', 2))) -> 'refund' -> 'errors' -> 0 ->> 'max', '1', 'I11: máximo 1');
select ok(pg_temp.same('i10'), 'I11: sin escribir nada');
-- aplicar (2): la segunda unidad de L1, ya devuelta (procesado). El importe es el RESTO exacto: 180 − 90 = 90,00
select pg_temp.rec('i12', pg_temp.rf(40, 'refund-key-0003', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 1), 'qty', 1)), p_done => true));
select is(pg_temp.q('i12', 'outcome'), 'refunded', 'I12: devuelta la segunda unidad');
select is((pg_temp.g('i12') ->> 'amount')::numeric, 90.00, 'I12: 90,00 (la última unidad toma el resto exacto)');
select is((select processed_by::text from public.refunds where id = pg_temp.q('i12', 'refund_id')::uuid), pg_temp.ad(1)::text, 'I12: con quién devolvió el dinero');
select ok(exists (select 1 from public.notification_outbox where dedupe_key = 'order_refund_processed:' || pg_temp.o(40)::text || ':' || pg_temp.q('i12', 'refund_id') || ':c'), 'I12: se avisa a la clienta que ya se le devolvió');
select is((select sum(ri.amount) from public.refund_items ri join public.refunds r on r.id = ri.refund_id where ri.order_item_id = pg_temp.it(40, 1) and r.status <> 'rejected'), 180.00, 'I12: entre las dos, L1 sumó EXACTO su valor (180,00), ni un centavo más');
select is(pg_temp.rf(40, 'refund-key-0004', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 1), 'qty', 1))) -> 'refund' -> 'errors' -> 0 ->> 'code', 'qty_exceeds', 'I12: L1 ya no tiene unidades por devolver');
-- procesar la solicitada
select pg_temp.rec('i13', public.admin_process_refund(pg_temp.q('i9', 'refund_id')::uuid, 'TRX-778899', 'Transferido el 14/11'));
select is(pg_temp.q('i13', 'outcome'), 'processed', 'I13: se marca como devuelta la solicitud');
select is((select external_ref from public.refunds where id = pg_temp.q('i9', 'refund_id')::uuid), 'TRX-778899', 'I13: con la referencia de la transferencia');
select is(public.admin_process_refund(pg_temp.q('i9', 'refund_id')::uuid) ->> 'outcome', 'already_processed', 'I13 (resiliencia): repetirlo no devuelve dos veces');
select is(public.admin_reject_refund(pg_temp.q('i9', 'refund_id')::uuid, 'ya no') ->> 'outcome', 'already_processed', 'I13: ni se puede rechazar uno ya devuelto');
select is(public.admin_process_refund(gen_random_uuid()) ->> 'outcome', 'not_found', 'I13: inexistente');
select is(public._order_refunded_amount(pg_temp.o(40), true), 180.00, 'I13: devueltos 180,00 en total');
select is(pg_temp.ost(40), 'paid', 'I13: la devolución PARCIAL no cambia el estado del pedido');
-- solicitud rechazada: libera el monto
select pg_temp.rec('i14', pg_temp.rf(40, 'refund-key-0005', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 2), 'qty', 1))));
select is(public._order_refunded_amount(pg_temp.o(40)), 216.00, 'I14: con la solicitud de L2 × 1 (36,00) comprometidos 216,00');
select is(public.admin_reject_refund(pg_temp.q('i14', 'refund_id')::uuid, '  ') -> 'errors' -> 0 ->> 'code', 'reason_required', 'I14: rechazar pide motivo');
select is(public.admin_reject_refund(pg_temp.q('i14', 'refund_id')::uuid, 'La clienta se arrepintió') ->> 'outcome', 'rejected', 'I14: se rechaza la solicitud');
select is(public._order_refunded_amount(pg_temp.o(40)), 180.00, 'I14: el monto rechazado se libera (vuelve a 180,00)');
select is((select processed_by is not null from public.refunds where id = pg_temp.q('i14', 'refund_id')::uuid), true, 'I14: queda quién lo rechazó');
select is(public.admin_process_refund(pg_temp.q('i14', 'refund_id')::uuid) ->> 'outcome', 'already_rejected', 'I14: uno rechazado no se procesa después');
select is((pg_temp.rf(40, 'refund-key-0006', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 2), 'qty', 3)), p_dry => true) #>> '{refund,amount}')::numeric, 108.00,
          'I14: y L2 vuelve a poder devolverse completa: 108,00');
-- el tope
select is(pg_temp.rf(40, 'refund-key-0007', 'amount', p_amount => 123.01) -> 'refund' -> 'errors' -> 0 ->> 'code', 'exceeds_paid', 'I15 (criterio 4): quedan 303 − 180 = 123,00; 123,01 se rechaza');
select is(pg_temp.rf(40, 'refund-key-0007', 'amount', p_amount => 123.01) -> 'refund' -> 'errors' -> 0 ->> 'left', '123.00', 'I15: diciendo cuánto queda');
select throws_ok($$insert into public.refunds (order_id, kind, amount, currency, reason, status, idempotency_key)
                     values ('c5000000-0000-0000-0000-000000000040', 'amount', 5, 'BOB', 'x', 'requested', 'corta')$$, '23514', null, 'I17: la llave de idempotencia tiene 8 caracteres como mínimo');
select throws_ok($$insert into public.refunds (order_id, kind, amount, currency, reason, status, idempotency_key)
                     values ('c5000000-0000-0000-0000-000000000040', 'amount', 0, 'BOB', 'x', 'requested', 'amount-zero-1')$$, '23514', null, 'I17: monto cero');
select throws_ok($$insert into public.refunds (order_id, kind, amount, currency, reason, status, idempotency_key)
                     values ('c5000000-0000-0000-0000-000000000040', 'amount', 123.01, 'BOB', 'directo', 'requested', 'direct-cap-0001')$$, '23514', null,
                 'I16 (defensa en la tabla): aunque alguien escriba directo, el libro no acepta más que lo pagado');
select lives_ok($$insert into public.refunds (order_id, kind, amount, currency, reason, status, idempotency_key)
                    values ('c5000000-0000-0000-0000-000000000040', 'amount', 123.00, 'BOB', 'directo', 'requested', 'direct-cap-0002')$$,
                'I16: el tope exacto (123,00) sí cabe');
select throws_ok($$insert into public.refunds (order_id, kind, amount, currency, reason, status, idempotency_key)
                     values ('c5000000-0000-0000-0000-000000000040', 'amount', 0.01, 'BOB', 'directo', 'requested', 'direct-cap-0003')$$, '23514', null,
                 'I16: y con eso agotado, ni un centavo más');
select throws_ok($$update public.refunds set amount = 1 where idempotency_key = 'direct-cap-0002'$$, '42501', null, 'I17: un reembolso no cambia su importe');
select throws_ok($$update public.refunds set reason = 'otro' where idempotency_key = 'direct-cap-0002'$$, '42501', null, 'I17: ni su motivo');
select throws_ok($$delete from public.refunds where idempotency_key = 'direct-cap-0002'$$, '42501', null, 'I17: ni se borra');
select lives_ok($$update public.refunds set status = 'processed', processed_at = now() where idempotency_key = 'direct-cap-0002'$$, 'I17: solicitado → procesado sí');
select throws_ok($$update public.refunds set status = 'requested', processed_at = null where idempotency_key = 'direct-cap-0002'$$, '22023', null, 'I17: pero un reembolso devuelto no vuelve atrás');
select throws_ok($$update public.refunds set status = 'rejected', decision_note = 'x' where idempotency_key = 'direct-cap-0002'$$, '22023', null, 'I17: ni se rechaza después de devuelto');
select throws_ok($$insert into public.refunds (order_id, kind, amount, currency, reason, status, idempotency_key)
                     values ('c5000000-0000-0000-0000-000000000040', 'amount', 5, 'BOB', 'x', 'rejected', 'direct-cap-0004')$$, '22023', null, 'I17: un reembolso no nace rechazado');

-- I18: pedido 41: exactos y la seguridad del borde. PA × 1 @100, sin envío, pagado 100.
select pg_temp.mko(41, 3, 'paid', '[{"v":1,"qty":1,"price":100}]', 0, 0, 'whatsapp', 'paid');
select is(pg_temp.rf(41, 'refund-key-1001', 'amount', p_amount => 40.00, p_done => true) ->> 'outcome', 'refunded', 'I18: 40,00 devueltos');
select is(pg_temp.rf(41, 'refund-key-1002', 'amount', p_amount => 60.01, p_done => true) -> 'refund' -> 'errors' -> 0 ->> 'code', 'exceeds_paid', 'I18: 60,01 ya no cabe (quedan 60,00)');
select is(pg_temp.rf(41, 'refund-key-1002', 'amount', p_amount => 60.00, p_done => true) ->> 'outcome', 'refunded', 'I18: 60,00 sí (el borde exacto)');
select is(public._order_refunded_amount(pg_temp.o(41), true), 100.00, 'I18: lo devuelto suma EXACTAMENTE lo pagado');
select is(pg_temp.rf(41, 'refund-key-1003', 'amount', p_amount => 0.01) -> 'refund' -> 'errors' -> 0 ->> 'code', 'exceeds_paid', 'I18: ni un centavo más (dos veces no se reembolsa)');
select is(pg_temp.rf(41, 'refund-key-1004', 'all', p_dry => true) -> 'refund' -> 'errors' -> 0 ->> 'code', 'nothing_to_refund', 'I18: «todo lo pagado» ya no tiene nada que devolver');

-- I19: prorrateo con centavos (criterio 4, redondeo). Pedido 42: PC × 3 @33,33 con descuento 0,01 ⇒ línea 99,99, final 99,98.
-- Acumulados: round(99,98 × 1/3) = 33,33 · round(99,98 × 2/3) = 66,65 · 99,98 (la última toma el resto) ⇒ 33,33 + 33,32 + 33,33 = 99,98.
select pg_temp.mko(42, 4, 'paid', '[{"v":3,"qty":3,"price":33.33,"disc":0.01}]', 0, 0, 'whatsapp', 'paid');
select is(pg_temp.tot(42), 99.98, 'I19: el pedido suma 99,98');
select is((pg_temp.rf(42, 'refund-key-2001', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(42, 1), 'qty', 1)), p_done => true) ->> 'amount')::numeric, 33.33, 'I19: la primera unidad 33,33');
select is((pg_temp.rf(42, 'refund-key-2002', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(42, 1), 'qty', 1)), p_done => true) ->> 'amount')::numeric, 33.32, 'I19: la segunda 33,32 (66,65 − 33,33)');
select is((pg_temp.rf(42, 'refund-key-2003', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(42, 1), 'qty', 1)), p_done => true) ->> 'amount')::numeric, 33.33, 'I19: la tercera 33,33 (el resto exacto)');
select is(public._order_refunded_amount(pg_temp.o(42), true), 99.98, 'I19: sumaron exactamente 99,98 — ni un centavo de más ni de menos');
-- ... y si se devuelven 2 de una vez y luego 1, el total es el mismo
select pg_temp.mko(43, 5, 'paid', '[{"v":3,"qty":3,"price":33.33,"disc":0.01}]', 0, 0, 'whatsapp', 'paid');
select is((pg_temp.rf(43, 'refund-key-2101', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(43, 1), 'qty', 2)), p_done => true) ->> 'amount')::numeric, 66.65, 'I19: dos de golpe 66,65');
select is((pg_temp.rf(43, 'refund-key-2102', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(43, 1), 'qty', 1)), p_done => true) ->> 'amount')::numeric, 33.33, 'I19: la restante 33,33');
select is(public._order_refunded_amount(pg_temp.o(43), true), 99.98, 'I19: en cualquier orden el total es 99,98');

-- I20: PROPIEDAD: para precios, cantidades y descuentos «incómodos», devolver las unidades UNA POR UNA suma exactamente el valor de la línea.
create temp table t_prop (n int, final numeric, units int, refunded numeric, max_step numeric, min_step numeric);
do $$
declare
  v_prices numeric[] := array[33.33, 12.34, 0.99, 7.77, 100.01, 19.99, 3.33, 45.45, 8.88, 66.66, 1.10, 99.99];
  v_qtys   int[]     := array[3, 7, 5, 3, 6, 4, 9, 3, 7, 5, 3, 8];
  v_discs  numeric[] := array[0.01, 0.50, 0.33, 1.00, 3.17, 0, 0.99, 5.55, 0.07, 10.00, 0.11, 0.13];
  i int;
  k int;
  v_n int;
  v_total numeric;
  v_step numeric;
  v_max numeric;
  v_min numeric;
begin
  for i in 1..12 loop
    v_n := 59 + i;
    perform pg_temp.mko(v_n, 6, 'paid', jsonb_build_array(jsonb_build_object('v', 2, 'qty', v_qtys[i], 'price', v_prices[i], 'disc', v_discs[i])),
                        0, 0, 'whatsapp', 'paid');
    v_total := 0; v_max := 0; v_min := 1e9;
    for k in 1..v_qtys[i] loop
      v_step := (pg_temp.rf(v_n, 'prop-' || i || '-' || k, 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(v_n, 1), 'qty', 1)), p_done => true) ->> 'amount')::numeric;
      v_total := v_total + v_step; v_max := greatest(v_max, v_step); v_min := least(v_min, v_step);
    end loop;
    insert into t_prop values (i, (select final_total from public.order_items where id = pg_temp.it(v_n, 1)), v_qtys[i], v_total, v_max, v_min);
  end loop;
end $$;
select is((select count(*)::int from t_prop), 12, 'I20: 12 combinaciones de precio, cantidad y descuento');
select is((select count(*)::int from t_prop where refunded = final), 12, 'I20 (propiedad): en las 12, devolver unidad por unidad suma EXACTAMENTE el valor de la línea');
select is((select count(*)::int from t_prop where min_step < 0), 0, 'I20: ningún paso es negativo');
select is((select count(*)::int from t_prop where max_step - min_step > 0.02 and final > 1), 0, 'I20: y los pasos difieren a lo sumo en 2 centavos (el redondeo se reparte, no se acumula en uno)');
select is((select count(*)::int from public.orders o where o.id in (select pg_temp.o(59 + n) from t_prop) and public._order_refunded_amount(o.id, true) = public._order_paid_amount(o.id)), 12,
          'I20: en cada pedido lo devuelto = lo pagado (nunca más)');

-- I20b: el caso extremo. Una línea de 4 unidades que vale 3 centavos en total: unidad por unidad, la tercera redondea a 0,00 y un
-- reembolso de cero no existe; devolviendo las dos últimas JUNTAS el total sigue siendo exacto.
select pg_temp.mko(72, 6, 'paid', '[{"v":2,"qty":4,"price":0.01,"disc":0.01}]', 0, 0, 'whatsapp', 'paid');
select is(pg_temp.tot(72), 0.03, 'I20b: la línea vale 0,03');
select is((pg_temp.rf(72, 'refund-key-4001', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(72, 1), 'qty', 1)), p_done => true) ->> 'amount')::numeric, 0.01, 'I20b: la 1.ª unidad 0,01');
select is((pg_temp.rf(72, 'refund-key-4002', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(72, 1), 'qty', 1)), p_done => true) ->> 'amount')::numeric, 0.01, 'I20b: la 2.ª 0,01');
select is(pg_temp.rf(72, 'refund-key-4003', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(72, 1), 'qty', 1)), p_dry => true) -> 'refund' -> 'errors' -> 0 ->> 'code', 'nothing_to_refund', 'I20b: la 3.ª vale 0,00 y un reembolso de cero no se registra');
select is((pg_temp.rf(72, 'refund-key-4004', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(72, 1), 'qty', 2)), p_done => true) ->> 'amount')::numeric, 0.01, 'I20b: las dos últimas JUNTAS valen 0,01');
select is(public._order_refunded_amount(pg_temp.o(72), true), 0.03, 'I20b: el total devuelto sigue siendo exacto (0,03)');

-- I21: envío gratis: devolver parte avisa que el envío gratis podría haber dejado de corresponder (la tienda decide la retención)
select pg_temp.mko(44, 7, 'paid', '[{"v":1,"qty":2,"price":100}]', 15, 15, 'whatsapp', 'paid');
select is(pg_temp.tot(44), 200.00, 'I21: pedido con envío gratis: 200,00');
select is(jsonb_array_length(pg_temp.rf(44, null, 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(44, 1), 'qty', 1)), p_dry => true) #> '{refund,warnings}'), 1, 'I21: devolver 1 de 2 trae un aviso');
select is(pg_temp.rf(44, null, 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(44, 1), 'qty', 1)), p_dry => true) #>> '{refund,warnings,0,code}', 'free_shipping_may_apply', 'I21: «el envío gratis puede ya no corresponder»');
select is(jsonb_array_length(pg_temp.rf(44, null, 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(44, 1), 'qty', 2)), p_dry => true) #> '{refund,warnings}'), 0, 'I21: devolver todo no trae aviso');
select is((pg_temp.rf(44, null, 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(44, 1), 'qty', 2)), p_ship => true, p_dry => true) #>> '{refund,amount}')::numeric, 200.00,
          'I21: el envío que se devuelve es solo el PAGADO (15 − 15 = 0): todo = 200,00');
select is((pg_temp.rf(44, null, 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(44, 1), 'qty', 1)), p_ship => true, p_ded => 15, p_dry => true) #>> '{refund,amount}')::numeric, 85.00,
          'I21: con una retención de 15,00 (el envío que ya no era gratis): 100 − 15 = 85,00');
select is(pg_temp.rf(44, 'refund-key-3001', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(44, 1), 'qty', 1)), p_ship => true, p_ded => 15, p_done => true) ->> 'outcome', 'refunded', 'I21: se aplica');
select is((select deduction from public.refunds where idempotency_key = 'refund-key-3001'), 15.00, 'I21: la retención queda registrada');
select is(pg_temp.rf(44, 'refund-key-3002', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(44, 1), 'qty', 1)), p_ship => true, p_done => true) ->> 'outcome', 'refunded', 'I21: la última unidad (con envío, que ya había salido en 0)');
select is((select amount from public.refunds where idempotency_key = 'refund-key-3002'), 100.00, 'I21: 100,00 (el resto exacto de la línea; la retención de 15 NO se devuelve después)');


-- ═══ J. Cancelar y reembolsar: stock, cupón y dinero ═══════════════════════════════════════
insert into public.discounts (id, name, kind, params, scope, currency, requires_coupon, stackable_with_automatic, priority, starts_at, ends_at, is_active)
values ('d9000000-0000-0000-0000-000000000001', 'Oferta 10 (S12)', 'flash', '{"percent":10}', 'order', 'BOB', false, false, 100,
        now() - interval '1 day', now() + interval '1 day', true);

-- Pedido 80 (clienta 6), EN PREPARACIÓN y pagado: PA × 2 @100 con descuento 20 (final 180) + PB × 1 @40 + envío 15 = 235,00
select pg_temp.mko(80, 6, 'preparing', '[{"v":1,"qty":2,"price":100,"disc":20},{"v":2,"qty":1,"price":40}]', 15, 0, 'whatsapp', 'paid');
insert into public.discount_redemptions (discount_id, profile_id, owner_type, owner_id, amount, currency, status)
values ('d9000000-0000-0000-0000-000000000001', pg_temp.u(6), 'order', pg_temp.o(80), 20.00, 'BOB', 'applied');
select is(pg_temp.tot(80), 235.00, 'J0: el pedido 80 suma 235,00');
select pg_temp.rec('j0', jsonb_build_object('pa', pg_temp.stock(1), 'pb', pg_temp.stock(2)));
select pg_temp.snap('j0');

-- J1: vista previa del asistente «cancelar y reembolsar»: muestra el IMPACTO (stock, cupón, dinero) sin tocar nada
select pg_temp.rec('j1', pg_temp.rf(80, null, 'all', p_cancel => true, p_done => true, p_dry => true, p_reason => 'x'));
select is(pg_temp.q('j1', 'outcome'), 'preview', 'J1: vista previa');
select is((pg_temp.g('j1') #>> '{refund,amount}')::numeric, 235.00, 'J1: se devolverían 235,00 (todo lo pagado)');
select is(pg_temp.q('j1', 'status_after'), 'refunded', 'J1: el pedido quedaría «reembolsado» (cancelado y devuelto)');
select is(jsonb_array_length(pg_temp.g('j1') -> 'restock'), 2, 'J1: volverían al stock 2 productos…');
select is((pg_temp.g('j1') #>> '{restock,0,qty}')::int, 2, 'J1: …2 de PA');
select is((pg_temp.g('j1') #>> '{restock,1,qty}')::int, 1, 'J1: …y 1 de PB');
select is(pg_temp.q('j1', 'coupon_release'), 'true', 'J1: y se devolvería el uso del descuento');
select is(pg_temp.rf(80, null, 'all', p_cancel => true, p_done => false, p_dry => true, p_reason => 'x') ->> 'status_after', 'cancelled', 'J1: si el dinero aún no se devuelve, queda «cancelado»');
select ok(pg_temp.same('j0'), 'J1: nada se escribió');

-- J2: aplicar
select pg_temp.rec('j2', pg_temp.rf(80, 'cancel-key-0001', 'all', p_cancel => true, p_done => true, p_reason => 'La clienta ya no lo quiere', p_method => 'bank_transfer'));
select is(pg_temp.q('j2', 'outcome'), 'refunded', 'J2: cancelado y reembolsado');
select is(pg_temp.ost(80), 'refunded', 'J2: el pedido termina «reembolsado»');
select is(pg_temp.pst(80), 'refunded', 'J2: y su cobro también');
select is((select amount::numeric(12,2) || '|' || kind || '|' || status from public.refunds where id = pg_temp.q('j2', 'refund_id')::uuid), '235.00|cancel|processed', 'J2: reembolso de 235,00, tipo cancelación, ya procesado');
select is(pg_temp.stock(1), (pg_temp.g('j0') ->> 'pa')::int + 2, 'J2 (criterio): el stock de PA se repone (+2)');
select is(pg_temp.stock(2), (pg_temp.g('j0') ->> 'pb')::int + 1, 'J2: el de PB (+1)');
select is((select reason from public.stock_movements where variant_id = pg_temp.va(1) order by id desc limit 1), 'cancel', 'J2: con movimientos «cancel»');
select is((select status from public.discount_redemptions where owner_id = pg_temp.o(80)), 'reverted', 'J2 (BR-PRC-03): el uso del descuento se revierte');
select is((select cancelled_by || '|' || cancel_reason from public.orders where id = pg_temp.o(80)), 'admin|La clienta ya no lo quiere', 'J2: queda quién canceló y por qué');
select is((select string_agg(from_status || '>' || to_status, ', ' order by id) from public.order_status_history where order_id = pg_temp.o(80)),
          'preparing>cancelled, cancelled>refunded' , 'J2: el historial: preparando → cancelado → reembolsado');
select ok(exists (select 1 from public.notification_outbox where dedupe_key = 'order_cancelled:' || pg_temp.o(80)::text || ':c')
          and exists (select 1 from public.notification_outbox where dedupe_key like 'order_refund_processed:' || pg_temp.o(80)::text || ':%'),
          'J2: se avisa de la cancelación y de la devolución');
select is(pg_temp.rf(80, 'cancel-key-0001', 'all', p_cancel => true, p_done => true, p_reason => 'La clienta ya no lo quiere', p_method => 'bank_transfer') ->> 'outcome', 'existing', 'J3 (doble clic): repetirlo devuelve lo ya hecho');
select is((select count(*)::int from public.refunds where order_id = pg_temp.o(80)), 1, 'J3: UN solo reembolso (no se devolvió dos veces)');
select is(pg_temp.stock(1), (pg_temp.g('j0') ->> 'pa')::int + 2, 'J3: ni se repuso el stock otra vez');
select is(pg_temp.rf(80, 'cancel-key-0002', 'all', p_dry => true) -> 'refund' -> 'errors' -> 0 ->> 'code', 'nothing_to_refund', 'J4: otro administrador, con otra llave: ya no hay nada que devolver');
select is(pg_temp.rf(80, 'cancel-key-0002', 'all', p_cancel => true) -> 'errors' -> 0 ->> 'code', 'not_cancellable', 'J4: y un pedido reembolsado no se cancela otra vez');

-- J5: solicitar el reembolso (aún sin devolver el dinero) y procesarlo después. Pedido 81 (clienta 7): PB × 2 @40 = 80, pagado.
select pg_temp.mko(81, 7, 'paid', '[{"v":2,"qty":2,"price":40}]', 0, 0, 'whatsapp', 'paid');
select pg_temp.rec('j5', pg_temp.rf(81, 'cancel-key-1001', 'all', p_cancel => true, p_done => false, p_reason => 'Error de precio'));
select is(pg_temp.q('j5', 'outcome'), 'requested', 'J5: queda solicitado');
select is(pg_temp.ost(81), 'cancelled', 'J5: el pedido ya está cancelado (el stock volvió)');
select is(pg_temp.pst(81), 'paid', 'J5: pero el cobro sigue «pagado» hasta que se devuelva el dinero');
select ok(exists (select 1 from jsonb_array_elements(public.admin_attention_orders()) a where a ->> 'kind' = 'refund_pending' and a ->> 'order_id' = pg_temp.o(81)::text and (a #>> '{detail,amount}')::numeric = 80.00),
          'J5: aparece en «atención requerida» como reembolso pendiente de 80,00');
select ok(not exists (select 1 from jsonb_array_elements(public.admin_attention_orders()) a where a ->> 'kind' = 'refund_due' and a ->> 'order_id' = pg_temp.o(81)::text),
          'J5: pero NO como «por devolver» (ya hay una solicitud)');
select pg_temp.rec('j5b', public.admin_process_refund(pg_temp.q('j5', 'refund_id')::uuid, 'TRX-1'));
select is(pg_temp.q('j5b', 'outcome'), 'processed', 'J5: se procesa');
select is(pg_temp.q('j5b', 'status_after'), 'refunded', 'J5: el pedido pasa a «reembolsado» (lo devuelto cubre todo lo pagado)');
select is(pg_temp.pst(81), 'refunded', 'J5: y el cobro también');

-- J6: cancelar un pedido SIN dinero recibido: solo se cancela (stock vuelve)
select pg_temp.mko(82, 10, 'pending_payment', '[{"v":2,"qty":1,"price":40}]');
select pg_temp.rec('j6s', jsonb_build_object('pb', pg_temp.stock(2)));
select is(pg_temp.rf(82, null, 'all', p_cancel => true, p_dry => true, p_reason => 'x') -> 'refund', 'null'::jsonb, 'J6: la vista previa dice que no hay reembolso');
select is(pg_temp.rf(82, 'cancel-key-1002', 'all', p_cancel => true, p_reason => 'No pagó') ->> 'outcome', 'cancelled_no_refund', 'J6: se cancela sin reembolso');
select is(pg_temp.ost(82), 'cancelled', 'J6: cancelado');
select is(pg_temp.stock(2), (pg_temp.g('j6s') ->> 'pb')::int + 1, 'J6: el stock vuelve');
select is((select count(*)::int from public.refunds where order_id = pg_temp.o(82)), 0, 'J6: sin reembolso');
-- cancelar un pedido completado se rechaza
select is(pg_temp.rf(2, 'cancel-key-1003', 'all', p_cancel => true, p_reason => 'x') -> 'errors' -> 0 ->> 'code', 'not_cancellable', 'J7: un pedido completado no se cancela (se devuelve con una devolución)');

-- J8: cancelado antes (por la clienta) con dinero pagado: queda «por devolver» y se resuelve con un reembolso
select pg_temp.mko(84, 11, 'paid', '[{"v":2,"qty":1,"price":40}]', 15, 0, 'whatsapp', 'paid');
select is(public.admin_transition_order(pg_temp.o(84), 'cancelled', 'Cancelado sin reembolso') ->> 'ok', 'true', 'J8: el administrador cancela SOLO (sin reembolso)');
select ok(exists (select 1 from jsonb_array_elements(public.admin_attention_orders()) a where a ->> 'kind' = 'refund_due' and a ->> 'order_id' = pg_temp.o(84)::text and (a #>> '{detail,amount}')::numeric = 55.00),
          'J8: queda «por devolver» 55,00: el dinero no se pierde de vista');
select is(pg_temp.rf(84, 'cancel-key-1004', 'all', p_done => true, p_reason => 'Reembolso pendiente') ->> 'outcome', 'refunded', 'J8: se devuelve sin volver a cancelar');
select is(pg_temp.ost(84), 'refunded', 'J8: «cancelado» → «reembolsado»');
select ok(not exists (select 1 from jsonb_array_elements(public.admin_attention_orders()) a where a ->> 'kind' in ('refund_due', 'refund_pending') and a ->> 'order_id' = pg_temp.o(84)::text),
          'J8: y desaparece de la lista de atención');

-- J9: contra entrega confirmada y NUNCA cobrada: al cancelar no hay dinero que devolver y su cobro se cancela
select pg_temp.mko(85, 13, 'paid', '[{"v":2,"qty":1,"price":40}]', 0, 0, 'cash_on_delivery', 'paid');
select is(public._order_paid_amount(pg_temp.o(85)), 0::numeric, 'J9: confirmado pero sin cobrar: dinero pagado 0');
select is(pg_temp.rf(85, 'cancel-key-1005', 'all', p_cancel => true, p_reason => 'x') ->> 'outcome', 'cancelled_no_refund', 'J9: se cancela sin reembolso');
select is(pg_temp.pst(85), 'cancelled', 'J9: y su cobro queda «cancelado» (no «pagado»)');

-- J10: llegó un monto distinto y el pedido se canceló: ese dinero existe y se puede devolver. Pedido 86 = 80,00; llegaron 40,00.
select pg_temp.mko(86, 14, 'cancelled', '[{"v":2,"qty":2,"price":40}]', 0, 0, 'manual_qr', 'cancelled', interval '0', 40.00);
select is(public._order_paid_amount(pg_temp.o(86)), 40.00, 'J10: lo realmente pagado son 40,00 (no los 80 del pedido)');
select is((pg_temp.rf(86, null, 'all', p_dry => true) #>> '{refund,amount}')::numeric, 40.00, 'J10: se devuelven los 40,00 que llegaron');
select is(pg_temp.rf(86, 'cancel-key-1006', 'all', p_done => true, p_reason => 'Pago incompleto') ->> 'status_after', 'refunded', 'J10: el pedido cancelado termina «reembolsado»');

-- J11: el proveedor reembolsó por su lado: también entra al libro (no se puede devolver dos veces lo mismo)
select pg_temp.mko(87, 15, 'paid', '[{"v":1,"qty":1,"price":100}]', 0, 0, 'manual_qr', 'paid');
select pg_temp.rec('j11', public.payment_apply_event('manual_qr', 'evt-s12-ref-1', 'refunded', 'MIC-920087', 30.00, 'BOB', null, '{}'::jsonb, null));
select is(pg_temp.q('j11', 'outcome'), 'review', 'J11: el aviso de reembolso del proveedor se registra y se revisa (S11)');
select is(pg_temp.pst(87), 'refunded', 'J11: el cobro queda «refunded»');
select is((select amount::numeric(12,2) || '|' || kind || '|' || status || '|' || method from public.refunds where order_id = pg_temp.o(87)), '30.00|provider|processed|provider', 'J11 (S12): y el libro anota los 30,00 devueltos por el proveedor');
select is(public._order_paid_amount(pg_temp.o(87)), 100.00, 'J11: lo pagado sigue siendo 100,00 (el cobro «reembolsado» cuenta)');
select is(public.payment_apply_event('manual_qr', 'evt-s12-ref-1', 'refunded', 'MIC-920087', 30.00, 'BOB', null, '{}'::jsonb, null) ->> 'outcome', 'duplicate', 'J11: el mismo aviso otra vez es un duplicado');
select is(public.payment_apply_event('manual_qr', 'evt-s12-ref-2', 'refunded', 'MIC-920087', 30.00, 'BOB', null, '{}'::jsonb, null) ->> 'outcome', 'ignored', 'J11: otro aviso de reembolso sobre el mismo cobro se ignora (ya está reembolsado)');
select is((select count(*)::int from public.refunds where order_id = pg_temp.o(87)), 1, 'J11: sigue habiendo UNA sola fila en el libro');
select is(pg_temp.rf(87, 'cancel-key-1007', 'amount', p_amount => 70.01) -> 'refund' -> 'errors' -> 0 ->> 'left', '70.00', 'J11 (criterio 4): por devolver quedan 70,00 (100 − 30 que ya devolvió el proveedor)');
select is(pg_temp.rf(87, 'cancel-key-1007', 'amount', p_amount => 70.00, p_done => true) ->> 'outcome', 'refunded', 'J11: 70,00 sí');
select is(public._order_refunded_amount(pg_temp.o(87), true), 100.00, 'J11: entre el proveedor y la tienda: 100,00 = lo pagado');

-- J13: cancelar y reembolsar un pedido con QR YA PAGADO no deja una tarea pendiente en Pagos (S11 abre una revisión «tardía» al
-- cancelar con dinero recibido; al devolver todo lo pagado, esa revisión ya no tiene nada que decidir).
select pg_temp.mko(88, 12, 'paid', '[{"v":2,"qty":1,"price":40}]', 0, 0, 'manual_qr', 'paid');
select is(pg_temp.rf(88, 'cancel-key-1500', 'all', p_cancel => true, p_done => true, p_reason => 'QR cancelado') ->> 'outcome', 'refunded', 'J13: cancelado y reembolsado');
select is((select status || '|' || (note like 'Reembolso registrado%')::text from public.payment_reviews where payment_id = pg_temp.pay(88) and reason = 'late'),
          'resolved|true', 'J13: la revisión «tardía» que S11 abrió al cancelar queda resuelta sola');
select is((select count(*)::int from public.payment_reviews where payment_id = pg_temp.pay(88) and status = 'open'), 0, 'J13: no queda nada abierto en Pagos');
-- …pero con un reembolso PARCIAL la revisión sigue abierta (aún hay dinero sin devolver)
select pg_temp.mko(89, 13, 'paid', '[{"v":2,"qty":2,"price":40}]', 0, 0, 'manual_qr', 'paid');
select is(pg_temp.rf(89, 'cancel-key-1501', 'all', p_cancel => true, p_done => false, p_reason => 'QR cancelado, devolución pendiente') ->> 'outcome', 'requested', 'J13: cancelado con el reembolso solo solicitado');
select is((select status from public.payment_reviews where payment_id = pg_temp.pay(89) and reason = 'late'), 'open', 'J13: mientras el dinero no se devuelve, la revisión sigue abierta');
select pg_temp.rec('j13b', jsonb_build_object('id', (select id from public.refunds where order_id = pg_temp.o(89))));
select is(public.admin_process_refund(pg_temp.q('j13b', 'id')::uuid, 'TRX-J13') ->> 'outcome', 'processed', 'J13: al marcarlo como devuelto…');
select is((select status from public.payment_reviews where payment_id = pg_temp.pay(89) and reason = 'late'), 'resolved', 'J13: …la revisión se resuelve');

-- J12: validaciones del asistente
select is(pg_temp.rf(81, 'cancel-key-2001', 'cosa') -> 'errors' -> 0 ->> 'code', 'request_invalid', 'J12: un modo desconocido');
select is(pg_temp.rf(81, 'cancel-key-2001', 'all', p_method => 'provider') -> 'errors' -> 0 ->> 'code', 'request_invalid', 'J12: el método «provider» solo lo anota el sistema');
select is(pg_temp.rf(81, 'cancel-key-2001', 'items', p_cancel => true) -> 'errors' -> 0 ->> 'code', 'cancel_needs_all', 'J12: cancelar exige devolver todo');
select is(pg_temp.rf(81, 'cancel-key-2001', 'all', p_reason => '') -> 'errors' -> 0 ->> 'code', 'reason_required', 'J12: el motivo es obligatorio');
select is(pg_temp.rf(81, 'corta', 'all') -> 'errors' -> 0 ->> 'code', 'request_invalid', 'J12: la llave de idempotencia debe ser válida');
select is(pg_temp.rf(81, 'cancel-key-2001', 'all', p_return => gen_random_uuid(), p_dry => true) -> 'errors' -> 0 ->> 'code', 'return_not_found', 'J12: una devolución que no es de este pedido');
select is(public.admin_refund_order(gen_random_uuid(), 'cancel-key-2002', 'all', null, false, 0, null, 'x', 'cash', null, null, null, false, false, false) ->> 'outcome', 'not_found', 'J12: un pedido inexistente');

-- ═══ K. Devoluciones ════════════════════════════════════════════════════════════════════════
-- Pedido 90 (clienta 16): ENTREGADO, PA × 2 @100 = 200, pagado. Plazo de 7 días desde la entrega.
select pg_temp.mko(90, 16, 'delivered', '[{"v":1,"qty":2,"price":100}]', 0, 0, 'whatsapp', 'paid');
insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_kind, created_at)
values (pg_temp.o(90), 'shipped', 'delivered', pg_temp.ad(1), 'admin', now() - interval '2 days');
create function pg_temp.ro(p_n int, p_items jsonb, p_reason text default 'Llegó dañado', p_ovr text default null) returns jsonb language sql as
  $$ select public.admin_return_open(pg_temp.o(p_n), p_items, p_reason, p_ovr) $$;
select is(pg_temp.ro(90, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(90, 1), 'qty', 1, 'reason_code', 'damaged', 'restock', 'inspection'))) ->> 'outcome', 'returns_disabled', 'K1: con las devoluciones apagadas (la tienda aún no redactó su política) no se abren');
update public.store_settings set value = 'true' where key = 'returns_enabled';
select is(pg_temp.ro(40, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 1), 'qty', 1, 'reason_code', 'damaged', 'restock', 'no'))) ->> 'outcome', 'not_returnable', 'K2: un pedido que aún no se entregó no se devuelve');
select pg_temp.rec('k3', pg_temp.ro(90, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(90, 1), 'qty', 1, 'reason_code', 'damaged', 'restock', 'inspection'))));
select is(pg_temp.q('k3', 'outcome'), 'opened', 'K3: se abre una devolución de 1 de las 2 unidades');
select is(pg_temp.q('k3', 'outside_window'), 'false', 'K3: dentro del plazo (entregado hace 2 días, plazo 7)');
select is((select status from public.order_returns where id = pg_temp.q('k3', 'id')::uuid), 'open', 'K3: abierta');
select is(pg_temp.ro(90, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(90, 1), 'qty', 2, 'reason_code', 'damaged', 'restock', 'no'))) -> 'errors' -> 0 ->> 'code', 'qty_exceeds', 'K4: no se devuelven más unidades que las compradas (1 ya está en una devolución)');
select is(pg_temp.ro(90, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(90, 1), 'qty', 2, 'reason_code', 'damaged', 'restock', 'no'))) -> 'errors' -> 0 ->> 'max', '1', 'K4: queda 1');
select is(pg_temp.ro(90, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(90, 1), 'qty', 1, 'reason_code', 'x', 'restock', 'no'))) -> 'errors' -> 0 ->> 'code', 'items_invalid', 'K5: un motivo desconocido');
select is(pg_temp.ro(90, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(90, 1), 'qty', 1, 'reason_code', 'damaged', 'restock', 'tal vez'))) -> 'errors' -> 0 ->> 'code', 'items_invalid', 'K5: un destino de stock desconocido');
select is(pg_temp.ro(90, '[]'::jsonb) -> 'errors' -> 0 ->> 'code', 'request_invalid', 'K5: sin productos');
select is(pg_temp.ro(90, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(90, 1), 'qty', 1, 'reason_code', 'damaged', 'restock', 'no')), '') -> 'errors' -> 0 ->> 'code', 'request_invalid', 'K5: sin motivo');
-- cerrar: el producto «por inspeccionar» debe resolverse
select pg_temp.rec('k6s', jsonb_build_object('pa', pg_temp.stock(1)));
select is(public.admin_return_close(pg_temp.q('k3', 'id')::uuid) ->> 'outcome', 'inspection_pending', 'K6: no se cierra con productos por inspeccionar');
select is(pg_temp.stock(1), (pg_temp.g('k6s') ->> 'pa')::int, 'K6: y el stock no se movió');
select pg_temp.rec('k6', public.admin_return_close(pg_temp.q('k3', 'id')::uuid, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(90, 1), 'restock', 'yes'))));
select is(pg_temp.q('k6', 'outcome'), 'closed', 'K6: resuelto como «vuelve al stock», se cierra');
select is((pg_temp.g('k6') ->> 'restocked_units')::int, 1, 'K6: 1 unidad vuelve al stock');
select is(pg_temp.stock(1), (pg_temp.g('k6s') ->> 'pa')::int + 1, 'K6: el stock de PA sube 1');
select is((select reason from public.stock_movements where variant_id = pg_temp.va(1) order by id desc limit 1), 'return', 'K6: con un movimiento «return»');
select is((select restocked_at is not null from public.order_return_items where return_id = pg_temp.q('k3', 'id')::uuid), true, 'K6: y la línea queda marcada como reingresada');
select is(public.admin_return_close(pg_temp.q('k3', 'id')::uuid) ->> 'outcome', 'already_closed', 'K6 (idempotencia): cerrar otra vez no repone el stock dos veces');
select is(pg_temp.stock(1), (pg_temp.g('k6s') ->> 'pa')::int + 1, 'K6: el stock sigue igual');
-- producto dañado que NO vuelve al stock
select pg_temp.rec('k7', pg_temp.ro(90, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(90, 1), 'qty', 1, 'reason_code', 'damaged', 'restock', 'no'))));
select is(pg_temp.q('k7', 'outcome'), 'opened', 'K7: la segunda unidad se devuelve dañada');
select is((public.admin_return_close(pg_temp.q('k7', 'id')::uuid) ->> 'restocked_units')::int, 0, 'K7: dañada: NO vuelve al stock');
select is(pg_temp.stock(1), (pg_temp.g('k6s') ->> 'pa')::int + 1, 'K7: el stock no cambia');
-- fuera de plazo
select pg_temp.mko(91, 17, 'delivered', '[{"v":1,"qty":1,"price":100}]', 0, 0, 'whatsapp', 'paid');
insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_kind, created_at)
values (pg_temp.o(91), 'shipped', 'delivered', pg_temp.ad(1), 'admin', now() - interval '30 days');
select is(pg_temp.ro(91, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(91, 1), 'qty', 1, 'reason_code', 'changed_mind', 'restock', 'yes'))) ->> 'outcome', 'outside_window', 'K8: entregado hace 30 días, fuera del plazo de 7: se rechaza');
select is(pg_temp.ro(91, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(91, 1), 'qty', 1, 'reason_code', 'changed_mind', 'restock', 'yes'))) ->> 'window_days', '7', 'K8: diciendo cuál es el plazo');
select pg_temp.rec('k8', pg_temp.ro(91, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(91, 1), 'qty', 1, 'reason_code', 'changed_mind', 'restock', 'yes')), 'Cambió de opinión', 'Cliente antigua, se acepta'));
select is(pg_temp.q('k8', 'outcome'), 'opened', 'K8: con una justificación especial sí se acepta');
select is((select outside_window::text || '|' || override_reason from public.order_returns where id = pg_temp.q('k8', 'id')::uuid), 'true|Cliente antigua, se acepta', 'K8: y queda anotado que fue una excepción, y por qué');
update public.store_settings set value = '60' where key = 'return_window_days';
select is(pg_temp.ro(91, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(91, 1), 'qty', 1, 'reason_code', 'changed_mind', 'restock', 'yes'))) -> 'errors' -> 0 ->> 'code', 'qty_exceeds', 'K9: (con un plazo de 60 días entraría, pero esa unidad ya está en otra devolución abierta)');
update public.store_settings set value = '7' where key = 'return_window_days';
-- rechazar una devolución libera las unidades
select is(public.admin_return_reject(pg_temp.q('k8', 'id')::uuid, '') -> 'errors' -> 0 ->> 'code', 'reason_required', 'K10: rechazar pide motivo');
select is(public.admin_return_reject(pg_temp.q('k8', 'id')::uuid, 'Fuera de plazo') ->> 'outcome', 'rejected', 'K10: se rechaza la devolución');
select is(public.admin_return_reject(pg_temp.q('k8', 'id')::uuid, 'otra vez') ->> 'outcome', 'already_closed', 'K10: una vez cerrada no se rechaza otra vez');
select is(pg_temp.ro(91, jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(91, 1), 'qty', 1, 'reason_code', 'changed_mind', 'restock', 'yes')), 'Otra vez', 'Excepción') ->> 'outcome', 'opened', 'K10: tras rechazarla, esa unidad puede volver a devolverse');
-- reembolso ligado a la devolución: pedido 90 entregado, pagado 200; las dos unidades en devoluciones cerradas
select is(pg_temp.rf(90, 'return-refund-01', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(90, 1), 'qty', 1)), p_return => pg_temp.q('k3', 'id')::uuid, p_done => true, p_reason => 'Devolución 1') ->> 'outcome', 'refunded', 'K11: se reembolsa la primera unidad devuelta');
select is((select return_id from public.refunds where idempotency_key = 'return-refund-01'), pg_temp.q('k3', 'id')::uuid, 'K11: ligado a su devolución');
select is(pg_temp.ost(90), 'delivered', 'K11: con una unidad devuelta, el pedido sigue «entregado»');
select is(pg_temp.rf(90, 'return-refund-02', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(90, 1), 'qty', 1)), p_return => pg_temp.q('k7', 'id')::uuid, p_done => true, p_reason => 'Devolución 2') ->> 'status_after', 'refunded', 'K11: devueltas todas las unidades, el pedido ENTREGADO pasa a «reembolsado»');
select is(pg_temp.pst(90), 'refunded', 'K11: y su cobro');
select is(pg_temp.rf(40, 'return-refund-03', 'items', jsonb_build_array(jsonb_build_object('item_id', pg_temp.it(40, 2), 'qty', 1)), p_return => pg_temp.q('k3', 'id')::uuid, p_dry => true) -> 'errors' -> 0 ->> 'code', 'return_not_found', 'K11: una devolución de OTRO pedido no se puede ligar');

-- ═══ L. Contra entrega: cobrado o rechazado (BR-PAY-07) ═════════════════════════════════════
-- Pedido 95 (clienta 17): contra entrega, enviado, total 55,00 (PB × 1 @40 + envío 15), confirmado.
select pg_temp.mko(95, 17, 'shipped', '[{"v":2,"qty":1,"price":40}]', 15, 0, 'cash_on_delivery', 'paid');
select pg_temp.mko(96, 17, 'paid', '[{"v":2,"qty":1,"price":40}]', 15, 0, 'cash_on_delivery', 'paid');
select is(public.admin_cod_collect(pg_temp.o(96)) ->> 'outcome', 'not_collectable', 'L1: no se cobra un pedido que aún no salió');
select is(public.admin_cod_collect(pg_temp.o(1)) ->> 'outcome', 'not_cod', 'L1: ni uno que no es contra entrega');
select is(public._order_paid_amount(pg_temp.o(95)), 0::numeric, 'L1: antes del cobro no hay dinero pagado');
select pg_temp.rec('l2', public.admin_cod_collect(pg_temp.o(95), null, 'Cobrado por el repartidor'));
select is(pg_temp.q('l2', 'outcome'), 'collected', 'L2: se registra el cobro');
select is((pg_temp.g('l2') ->> 'amount')::numeric, 55.00, 'L2: por el monto esperado (55,00)');
select is((select collected_by from public.payments where id = pg_temp.pay(95)), pg_temp.ad(1), 'L2: con quién lo registró');
select is((select received_amount from public.payments where id = pg_temp.pay(95)), 55.00, 'L2: monto recibido 55,00');
select is(public._order_paid_amount(pg_temp.o(95)), 55.00, 'L2: ahora SÍ cuenta como dinero pagado');
select is((select body from public.order_notes where order_id = pg_temp.o(95)), 'Contra entrega cobrado: BOB 55.00 — Cobrado por el repartidor', 'L2: queda una nota del pedido');
select is(public.admin_cod_collect(pg_temp.o(95)) ->> 'outcome', 'already_collected', 'L2: cobrar dos veces no se puede');
-- cobro incompleto
select pg_temp.mko(97, 18, 'shipped', '[{"v":2,"qty":1,"price":40}]', 15, 0, 'cash_on_delivery', 'paid');
select is(public.admin_cod_collect(pg_temp.o(97), 56.00) -> 'errors' -> 0 ->> 'code', 'amount_invalid', 'L3: no se puede cobrar MÁS de lo esperado');
select is(public.admin_cod_collect(pg_temp.o(97), 0) -> 'errors' -> 0 ->> 'code', 'amount_invalid', 'L3: ni 0');
select is(public.admin_cod_collect(pg_temp.o(97), 50.00) ->> 'short', 'true', 'L3: 50,00 de 55,00: queda anotado como cobro corto');
select is(public._order_balance(pg_temp.o(97)), 5.00, 'L3: faltan 5,00 por cobrar');
select ok(exists (select 1 from jsonb_array_elements(public.admin_attention_orders()) a where a ->> 'kind' = 'balance_due' and a ->> 'order_id' = pg_temp.o(97)::text and (a #>> '{detail,amount}')::numeric = 5.00),
          'L3: y aparece en «atención» con 5,00');
-- entregado y no cobrado ni rechazado: pide atención
select pg_temp.mko(73, 19, 'delivered', '[{"v":2,"qty":1,"price":40}]', 0, 0, 'cash_on_delivery', 'paid');
select ok(exists (select 1 from jsonb_array_elements(public.admin_attention_orders()) a where a ->> 'kind' = 'cod_uncollected' and a ->> 'order_id' = pg_temp.o(73)::text),
          'L4: una contra entrega entregada sin cobro registrado pide atención');
select is(public.admin_cod_collect(pg_temp.o(73)) ->> 'outcome', 'collected', 'L4: se registra el cobro de la contra entrega entregada');
select ok(not exists (select 1 from jsonb_array_elements(public.admin_attention_orders()) a where a ->> 'kind' = 'cod_uncollected' and a ->> 'order_id' = pg_temp.o(73)::text),
          'L4: y deja de hacerlo al registrar el cobro');
-- la entrega cobrada no se deshace
select pg_temp.mko(74, 20, 'shipped', '[{"v":2,"qty":1,"price":40}]', 0, 0, 'cash_on_delivery', 'paid');
select is(public.admin_transition_order(pg_temp.o(74), 'delivered', null, 'shipped') ->> 'ok', 'true', 'L5: se marca entregada');
select is(public.admin_cod_collect(pg_temp.o(74)) ->> 'outcome', 'collected', 'L5: se registra el cobro');
select is(public.admin_undo_transition(pg_temp.o(74)) ->> 'outcome', 'not_undoable', 'L5: con el cobro registrado, la entrega ya no se deshace');
-- rechazo: pedido 98 (clienta 21) tiene un rechazo previo (pedido 99)
select pg_temp.mko(99, 21, 'shipped', '[{"v":2,"qty":1,"price":40}]', 15, 0, 'cash_on_delivery', 'paid');
select pg_temp.mko(98, 21, 'shipped', '[{"v":2,"qty":1,"price":40}]', 15, 0, 'cash_on_delivery', 'paid');
select pg_temp.rec('l6s', jsonb_build_object('pb', pg_temp.stock(2)));
select is(public.admin_cod_reject(pg_temp.o(99), 8.00, 'No quiso recibirlo') ->> 'previous_rejections', '0', 'L6: el primer rechazo de la clienta 21: 0 previos');
select is(pg_temp.ost(99), 'cancelled', 'L6: el pedido se cancela');
select is(pg_temp.pst(99), 'cancelled', 'L6: su cobro (nunca cobrado) también');
select is(pg_temp.stock(2), (pg_temp.g('l6s') ->> 'pb')::int + 1, 'L6: el paquete vuelve y el stock se repone');
select is((select type || '|' || cost_assumed::numeric(12,2) || '|' || cost_borne_by || '|' || status from public.order_incidents where order_id = pg_temp.o(99)), 'rejected|8.00|store|open',
          'L6 (BR-PAY-07): queda una incidencia «rechazado» con 8,00 que asume la tienda');
select pg_temp.rec('l7', public.admin_cod_reject(pg_temp.o(98), 8.00, null, true, 'Dos paquetes rechazados'));
select is(pg_temp.q('l7', 'previous_rejections'), '1', 'L7: el segundo rechazo ya sabe que hubo uno antes (para sugerir la lista negra)');
select is(pg_temp.q('l7', 'blacklist'), 'added', 'L7: se añade a la lista negra con un clic');
select is(public.is_blacklisted(pg_temp.u(21)), true, 'L7: la cuenta queda bloqueada');
select is((select source_order_id from public.blacklist_entries where profile_id = pg_temp.u(21) and is_active), pg_temp.o(98), 'L7: con el pedido que la originó');
select is(public.admin_cod_reject(pg_temp.o(98), 0) ->> 'outcome', 'not_rejectable', 'L8: rechazar dos veces no se puede');
select is(public.admin_cod_reject(pg_temp.o(95)) ->> 'outcome', 'already_collected', 'L8: ni uno ya cobrado');
select is(public.admin_cod_reject(pg_temp.o(1)) ->> 'outcome', 'not_cod', 'L8: ni uno que no es contra entrega');
select pg_temp.mko(75, 22, 'paid', '[{"v":2,"qty":1,"price":40}]', 0, 0, 'cash_on_delivery', 'paid');
select is(public.admin_cod_reject(pg_temp.o(75)) ->> 'outcome', 'not_rejectable', 'L8: solo se rechaza un paquete ya enviado');
select pg_temp.mko(76, 22, 'shipped', '[{"v":2,"qty":1,"price":40}]', 0, 0, 'cash_on_delivery', 'paid');
select is(public.admin_cod_reject(pg_temp.o(76), 0, null, true, '  ') -> 'errors' -> 0 ->> 'code', 'reason_required', 'L8: bloquear sin motivo se rechaza…');
select is(pg_temp.ost(76), 'shipped', 'L8: …y no cancela nada (la validación va antes)');
select is(public.admin_cod_reject(pg_temp.o(76), -1) -> 'errors' -> 0 ->> 'code', 'request_invalid', 'L8: costo negativo');

-- ═══ M. Incidencias de entrega ══════════════════════════════════════════════════════════════
select pg_temp.rec('m1', public.admin_incident_open(pg_temp.o(40), 'lost', 'El paquete no llegó', 25.00, 'carrier'));
select is(pg_temp.q('m1', 'outcome'), 'opened', 'M1: se abre una incidencia de paquete perdido');
select is((select status || '|' || cost_assumed::numeric(12,2) || '|' || cost_borne_by from public.order_incidents where id = pg_temp.q('m1', 'id')::uuid), 'open|25.00|carrier', 'M1: con el costo y quién lo asume');
select ok(exists (select 1 from jsonb_array_elements(public.admin_attention_orders()) a where a ->> 'kind' = 'incident_open' and a ->> 'order_id' = pg_temp.o(40)::text), 'M1: pide atención mientras esté abierta');
select is(public.admin_incident_update(pg_temp.q('m1', 'id')::uuid, 'investigating') ->> 'outcome', 'updated', 'M2: pasa a «investigando»');
select is(public.admin_incident_update(pg_temp.q('m1', 'id')::uuid, 'resolved') -> 'errors' -> 0 ->> 'code', 'resolution_required', 'M2: resolverla exige decir cómo');
select is(public.admin_incident_update(pg_temp.q('m1', 'id')::uuid, 'resolved', 'Se reenvió el pedido', 30.00, 'store') ->> 'outcome', 'resolved', 'M2: se resuelve con su resolución');
select is((select cost_assumed::numeric(12,2) || '|' || cost_borne_by || '|' || resolution from public.order_incidents where id = pg_temp.q('m1', 'id')::uuid), '30.00|store|Se reenvió el pedido', 'M2: el costo final y quién lo asumió');
select is((select resolved_by from public.order_incidents where id = pg_temp.q('m1', 'id')::uuid), pg_temp.ad(1), 'M2: quién la resolvió');
select is(public.admin_incident_update(pg_temp.q('m1', 'id')::uuid, 'investigating') ->> 'outcome', 'already_resolved', 'M2: una incidencia resuelta no se reabre (se abre otra)');
select ok(not exists (select 1 from jsonb_array_elements(public.admin_attention_orders()) a where a ->> 'kind' = 'incident_open' and a ->> 'order_id' = pg_temp.o(40)::text), 'M2: ya no pide atención');
select is(public.admin_incident_open(pg_temp.o(40), 'cosa', 'x') -> 'errors' -> 0 ->> 'code', 'incident_invalid', 'M3: un tipo desconocido');
select is(public.admin_incident_open(pg_temp.o(40), 'lost', 'x', -1) -> 'errors' -> 0 ->> 'code', 'incident_invalid', 'M3: costo negativo');
select is(public.admin_incident_open(pg_temp.o(40), 'lost', 'x', 1, 'el vecino') -> 'errors' -> 0 ->> 'code', 'incident_invalid', 'M3: quién asume el costo debe ser uno de los cuatro');
select is(public.admin_incident_open(gen_random_uuid(), 'lost', 'x') ->> 'outcome', 'not_found', 'M3: un pedido inexistente');
select is(public.admin_incident_update(gen_random_uuid(), 'investigating') ->> 'outcome', 'not_found', 'M3: una incidencia inexistente');
select is(public.admin_incident_update(pg_temp.q('m1', 'id')::uuid, 'open') -> 'errors' -> 0 ->> 'code', 'incident_invalid', 'M3: «open» no es un estado al que se vuelva');
select throws_ok(format($$delete from public.order_incidents where id = %L$$, pg_temp.q('m1', 'id')), '42501', null, 'M4: las incidencias no se borran');
-- tras la entrega: una incidencia sobre un pedido ya entregado (paquete dañado)
select is(public.admin_incident_open(pg_temp.o(2), 'damaged', 'La clienta dice que llegó roto', 0, 'none') ->> 'outcome', 'opened', 'M5: se puede abrir una incidencia sobre un pedido ya COMPLETADO');


-- ═══ N. Atención requerida ══════════════════════════════════════════════════════════════════
-- Pedido 77: WhatsApp pendiente desde hace 48 h (el ajuste es 24 h) · pedido 78: pendiente desde hace 1 h.
select pg_temp.mko(77, 22, 'pending_payment', '[{"v":2,"qty":1,"price":40}]', 0, 0, 'whatsapp', 'pending', interval '48 hours');
select pg_temp.mko(78, 22, 'pending_payment', '[{"v":2,"qty":1,"price":40}]', 0, 0, 'whatsapp', 'pending', interval '1 hour');
create function pg_temp.att(p_kind text, p_n int) returns boolean language sql as
  $$ select exists (select 1 from jsonb_array_elements(public.admin_attention_orders()) a where a ->> 'kind' = p_kind and a ->> 'order_id' = pg_temp.o(p_n)::text) $$;
select is(pg_temp.att('stale_pending', 77), true, 'N1 (S-05): un pedido de WhatsApp sin confirmar hace 48 h (ajuste: 24 h) pide atención');
select is(pg_temp.att('stale_pending', 78), false, 'N1: uno de hace 1 hora no');
select is(pg_temp.att('proof_pending', 25), true, 'N2: un comprobante por revisar pide atención (pedido 25)');
select is(pg_temp.att('review_open', 87), true, 'N3: un pago que necesita una decisión (reembolso del proveedor) pide atención (pedido 87)');
select is(pg_temp.att('payment_disputed', 3), true, 'N4: un contracargo sobre un pedido activo');
select is(pg_temp.att('refund_pending', 81), false, 'N5: un reembolso ya procesado deja de pedir atención (pedido 81)');
select is(pg_temp.att('balance_due', 97), true, 'N6: un saldo por cobrar (contra entrega cobrada de menos, pedido 97)');
select is(pg_temp.att('refund_due', 26), true, 'N6: dinero por devolver tras bajar un pedido ya pagado (pedido 26: 200 pagados − 100 que vale − 10 ya solicitados)');
select is(((select a #>> '{detail,amount}' from jsonb_array_elements(public.admin_attention_orders()) a where a ->> 'kind' = 'refund_due' and a ->> 'order_id' = pg_temp.o(26)::text))::numeric, 90.00, 'N6: por 90,00');
select ok((select count(*) from public._attention_rows()) <= 500, 'N7: (condición de la prueba) la lista cabe en el tope de 500 filas');
select is((select jsonb_object_agg(k, n) from (select a ->> 'kind' as k, count(*)::int as n from jsonb_array_elements(public.admin_attention_orders()) a group by 1) s)::text,
          (select (public.admin_attention_summary() - 'orders')::text), 'N7: el resumen por categoría coincide EXACTO con la lista');
select is((public.admin_attention_summary() ->> 'orders')::int, (select count(distinct a ->> 'order_id')::int from jsonb_array_elements(public.admin_attention_orders()) a),
          'N7: y «pedidos con algo pendiente» cuenta cada pedido una sola vez');
select pg_temp.as_(pg_temp.u(2));
select throws_ok($$select public.admin_attention_summary()$$, '42501', 'solo administradores', 'N8: una clienta no ve la lista de atención');
select throws_ok($$select public.admin_attention_orders()$$, '42501', 'solo administradores', 'N8: ni el detalle');
select pg_temp.as_(pg_temp.ad(1));

-- ═══ O. RLS y permisos (criterio 6: ninguna acción de administración sin ser administrador) ═══
create function pg_temp.denied(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'permitido';
exception when others then
  return sqlstate || ':' || sqlerrm;
end $$;
select pg_temp.as_(pg_temp.u(2));
select is(pg_temp.denied($$select public.admin_refund_order(gen_random_uuid(), 'k-12345678', 'all', null, false, 0, null, 'x', 'cash', null, null, null, false, false, true)$$), '42501:solo administradores', 'O1: reembolsar');
select is(pg_temp.denied($$select public.admin_process_refund(gen_random_uuid())$$), '42501:solo administradores', 'O1: marcar un reembolso como devuelto');
select is(pg_temp.denied($$select public.admin_reject_refund(gen_random_uuid(), 'x')$$), '42501:solo administradores', 'O1: rechazar un reembolso');
select is(pg_temp.denied($$select public.admin_return_open(gen_random_uuid(), '[]', 'x')$$), '42501:solo administradores', 'O1: abrir una devolución');
select is(pg_temp.denied($$select public.admin_return_close(gen_random_uuid())$$), '42501:solo administradores', 'O1: cerrarla');
select is(pg_temp.denied($$select public.admin_return_reject(gen_random_uuid(), 'x')$$), '42501:solo administradores', 'O1: rechazarla');
select is(pg_temp.denied($$select public.admin_cod_collect(gen_random_uuid())$$), '42501:solo administradores', 'O1: cobrar contra entrega');
select is(pg_temp.denied($$select public.admin_cod_reject(gen_random_uuid())$$), '42501:solo administradores', 'O1: rechazar contra entrega');
select is(pg_temp.denied($$select public.admin_incident_open(gen_random_uuid(), 'lost', 'x')$$), '42501:solo administradores', 'O1: abrir una incidencia');
select is(pg_temp.denied($$select public.admin_incident_update(gen_random_uuid(), 'resolved', 'x')$$), '42501:solo administradores', 'O1: resolverla');
select is(pg_temp.denied($$select public.admin_blacklist_add('phone', null, '+59170000099', null, 'x')$$), '42501:solo administradores', 'O1: lista negra (alta)');
select is(pg_temp.denied($$select public.admin_add_order_note(gen_random_uuid(), 'x')$$), '42501:solo administradores', 'O1: notas');
select is(pg_temp.denied($$select public.admin_edit_order(gen_random_uuid(), null, '[]', null, null, null, 0, 'x', true)$$), '42501:solo administradores', 'O1: editar');
select is(pg_temp.denied($$select public.admin_create_manual_order(gen_random_uuid(), '[]', 'manual', 'whatsapp', 'delivery', null, null, null, null, null, 0, null, null, null, null, null, false, true)$$), '42501:solo administradores', 'O1: pedidos manuales');
select is(pg_temp.denied($$select public.admin_undo_transition(gen_random_uuid())$$), '42501:solo administradores', 'O1: deshacer');
select is(pg_temp.denied($$select public.admin_transition_order(gen_random_uuid(), 'paid')$$), '42501:solo administradores', 'O1: avanzar');
select pg_temp.as_(pg_temp.ad(1));

-- Las funciones internas NO las ejecuta nadie desde fuera; las de administración, solo usuarios autenticados
select is((select coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_attention_rows', '_refund_compute', '_refund_settle', '_order_paid_amount', '_order_refunded_amount',
              '_order_balance', '_order_stock_free', '_order_address_clean', 'is_blacklisted', 'refunds_guard', 'order_items_guard', 'store_settings_validate_s12')
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                   or has_function_privilege('service_role', p.oid, 'execute'))), '', 'O2: las funciones internas de S12 no las ejecuta anon, authenticated ni service_role');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('admin_order_history', 'admin_orders_status_counts', 'admin_attention_summary', 'admin_attention_orders',
              'admin_add_order_note', 'admin_transition_order', 'admin_undo_transition', 'admin_blacklist_add', 'admin_blacklist_lift', 'admin_blacklist_matches',
              'admin_incident_open', 'admin_incident_update', 'admin_refund_order', 'admin_process_refund', 'admin_reject_refund', 'admin_return_open',
              'admin_return_close', 'admin_return_reject', 'admin_cod_collect', 'admin_cod_reject', 'admin_edit_order', 'admin_create_manual_order')
              and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
              and not has_function_privilege('service_role', p.oid, 'execute')), 22, 'O3: las 22 funciones de administración las ejecuta authenticated (y adentro exigen ser admin), no anon ni service_role');
select is((select count(*)::int from unnest(array['refunds', 'refund_items', 'order_returns', 'order_return_items', 'order_incidents', 'order_notes', 'order_edits', 'blacklist_entries']) t
            where has_table_privilege('service_role', 'public.' || t, 'insert') or has_table_privilege('service_role', 'public.' || t, 'update')
               or has_table_privilege('service_role', 'public.' || t, 'delete')), 0, 'O4: service_role no escribe en ninguna tabla nueva (solo las funciones)');
select is((select count(*)::int from unnest(array['refunds', 'refund_items', 'order_returns', 'order_return_items', 'order_incidents', 'order_notes', 'order_edits', 'blacklist_entries']) t
            where has_table_privilege('authenticated', 'public.' || t, 'insert') or has_table_privilege('authenticated', 'public.' || t, 'update')
               or has_table_privilege('authenticated', 'public.' || t, 'delete') or has_table_privilege('anon', 'public.' || t, 'select')), 0,
          'O5: authenticated no escribe y anon no lee ninguna tabla nueva');
-- la clienta no ve NADA de la administración, ni de sus propios pedidos
select pg_temp.as_(pg_temp.u(2));
set local role authenticated;
select is((select count(*)::int from public.refunds), 0, 'O6: la clienta 2 (con reembolsos en su pedido 40) no ve el libro de reembolsos');
select is((select count(*)::int from public.refund_items), 0, 'O6: ni sus líneas');
select is((select count(*)::int from public.order_returns), 0, 'O6: ni las devoluciones');
select is((select count(*)::int from public.order_return_items), 0, 'O6: ni sus productos');
select is((select count(*)::int from public.order_incidents), 0, 'O6: ni las incidencias');
select is((select count(*)::int from public.order_notes), 0, 'O6: ni las notas internas');
select is((select count(*)::int from public.order_edits), 0, 'O6: ni el libro de ediciones');
select is((select count(*)::int from public.blacklist_entries), 0, 'O6: ni la lista negra');
select ok((select count(*) from public.orders where profile_id = 'a5000000-0000-0000-0000-000000000002') >= 1, 'O7 (regresión): pero SÍ sigue viendo su propio pedido');
select ok((select count(*) from public.orders where number is not null and channel is not null and edit_count is not null) >= 1, 'O7: con las columnas nuevas (canal, ediciones)');
select throws_ok($$insert into public.refunds (order_id, kind, amount, currency, reason, idempotency_key) values ('c5000000-0000-0000-0000-000000000040', 'amount', 1, 'BOB', 'x', 'client-write-1')$$, '42501', null, 'O8: la clienta no escribe reembolsos');
select throws_ok($$update public.orders set total = 1 where profile_id = 'a5000000-0000-0000-0000-000000000002'$$, '42501', null, 'O8: ni edita su pedido');
reset role;
-- anon
set local role anon;
select throws_ok($$select count(*) from public.refunds$$, '42501', null, 'O9: anon no lee reembolsos');
select throws_ok($$select count(*) from public.blacklist_entries$$, '42501', null, 'O9: ni la lista negra');
reset role;
-- el administrador SÍ lee, pero tampoco escribe directo (solo por las funciones, que dejan rastro)
select pg_temp.as_(pg_temp.ad(1));
set local role authenticated;
select ok((select count(*) from public.refunds) > 0, 'O10: el administrador lee el libro de reembolsos');
select ok((select count(*) from public.refund_items) > 0, 'O10: …sus líneas');
select ok((select count(*) from public.order_returns) > 0, 'O10: …las devoluciones');
select ok((select count(*) from public.order_incidents) > 0, 'O10: …las incidencias');
select ok((select count(*) from public.order_notes) > 0, 'O10: …las notas');
select ok((select count(*) from public.order_edits) > 0, 'O10: …el libro de ediciones');
select ok((select count(*) from public.blacklist_entries) > 0, 'O10: …y la lista negra');
select throws_ok($$insert into public.refunds (order_id, kind, amount, currency, reason, idempotency_key) values ('c5000000-0000-0000-0000-000000000040', 'amount', 1, 'BOB', 'x', 'admin-write-1')$$, '42501', null, 'O11: ni el administrador escribe reembolsos directo (el tope y la auditoría viven en la función)');
select throws_ok($$update public.orders set total = 1 where id = 'c5000000-0000-0000-0000-000000000040'$$, '42501', null, 'O11: ni edita pedidos directo');
select throws_ok($$update public.order_items set qty = 9 where order_id = 'c5000000-0000-0000-0000-000000000040'$$, '42501', null, 'O11: ni sus líneas');
select throws_ok($$select cost_unit from public.order_items limit 1$$, '42501', null, 'O12: el costo de los productos sigue sin leerse desde el navegador (también el administrador)');
select throws_ok($$select reason from public.order_status_history limit 1$$, '42501', null, 'O12: ni el motivo del historial: para eso está admin_order_history');
reset role;

-- ═══ P. Auditoría (BR-ADM-03): quién, qué y cuándo ═════════════════════════════════════════
select is((select actor_id from public.audit_log where table_name = 'refunds' and action = 'INSERT' and record_id = pg_temp.q('i9', 'refund_id') order by id desc limit 1),
          pg_temp.ad(1), 'P1: crear un reembolso queda auditado con SU administrador');
select is((select diff -> 'destination' from public.audit_log where table_name = 'refunds' and action = 'INSERT' and record_id = pg_temp.q('i9', 'refund_id') order by id desc limit 1),
          '"[redacted]"'::jsonb, 'P1: sin copiar a dónde se devolvió el dinero (dato personal)');
select ok((select count(*) from public.audit_log where table_name = 'refunds' and action = 'UPDATE' and record_id = pg_temp.q('i9', 'refund_id')
            and diff ? 'status' and diff #>> '{status,new}' = 'processed') >= 1, 'P2: y procesarlo también');
select is((select diff -> 'phone_e164' from public.audit_log where table_name = 'blacklist_entries' and action = 'INSERT' and diff ->> 'kind' = 'phone' order by id limit 1),
          '"[redacted]"'::jsonb, 'P3: la lista negra no copia el teléfono al registro (se podría anonimizar)');
select ok((select count(*) from public.audit_log where table_name = 'blacklist_entries' and action = 'UPDATE' and diff ? 'is_active' and actor_id = pg_temp.ad(1)) >= 1, 'P3: levantar un bloqueo queda auditado');
select ok((select count(*) from public.audit_log where table_name = 'order_incidents' and action in ('INSERT', 'UPDATE') and actor_id = pg_temp.ad(1)) >= 3, 'P4: las incidencias quedan auditadas (abrir, investigar, resolver)');
select ok((select count(*) from public.audit_log where table_name = 'order_returns' and action in ('INSERT', 'UPDATE') and actor_id = pg_temp.ad(1)) >= 3, 'P4: las devoluciones también');
select is((select actor_id from public.audit_log where table_name = 'orders' and action = 'UPDATE' and record_id = pg_temp.o(28)::text and diff ? 'shipping_address' limit 1),
          pg_temp.ad(1), 'P5: editar un pedido queda en la auditoría general con SU administrador…');
select is((select diff -> 'shipping_address' from public.audit_log where table_name = 'orders' and action = 'UPDATE' and record_id = pg_temp.o(28)::text and diff ? 'shipping_address' limit 1),
          '{"changed": true}'::jsonb, 'P5: …diciendo que la dirección cambió, no cuál es');
select is((select count(*)::int from public.audit_log where table_name = 'orders' and record_id = pg_temp.o(28)::text and diff::text like '%Av. Nueva%'), 0, 'P5: la dirección nueva no aparece en ninguna parte del registro');
select ok((select count(*) from public.audit_log where table_name = 'payments' and action = 'UPDATE' and record_id = pg_temp.pay(20)::text and diff ? 'amount') >= 1,
          'P6: el cambio del monto a cobrar por una edición también queda auditado');
select is((select count(*)::int from public.order_edits where actor_id is null), 0, 'P7: todo registro del libro de ediciones tiene su autor');

select * from finish();
rollback;
