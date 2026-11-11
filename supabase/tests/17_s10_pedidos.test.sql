-- Sprint 10 · Pedidos y checkout: numeración sin huecos, restricciones y guardas, create_order (camino feliz, validaciones,
-- stock, precios, descuentos, franjas), idempotencia, atomicidad, máquina de estados, cancelación, vencimiento y recordatorios,
-- RLS y permisos. Los valores esperados se calcularon A MANO (la cuenta va en el comentario de cada bloque).
-- Todo ocurre en una transacción que se revierte: no deja pedidos, stock movido ni contador avanzado.
--
-- Fixture:  clientas u01..u30 (a1…00NN; u01 = ana, u02 = bia, u03 = cora EN LISTA NEGRA, u04 = dani se desactiva) · admin ad1…0d
--           productos PA 100,00 [stock 20, costo 60] · PB 40,00 [100, costo 15] · PC 33,33 [50] · PD 10,00 [1] · PE 20,00 [3]
--           PF 5,00 [5] · PG 50,00 [20]    envío a domicilio PLANO 15,00 dentro de 25 km del taller (La Paz) · recojo gratis
--           franjas: S1 10:00–12:00 cupo 1 · S2 14:00–16:00 cupo 5, todos los días; el día de prueba es hoy + 5
begin;
select plan(367);

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
update public.store_settings set value = 'true' where key = 'reserve_on_add_to_cart';
update public.store_settings set value = '130'  where key = 'shipping_route_factor_pct';
update public.store_settings set value = '24'   where key = 'delivery_min_lead_hours';
update public.store_settings set value = '30'   where key = 'delivery_max_days_ahead';
update public.store_settings set value = '7'    where key = 'price_guarantee_days';
-- (S11) los métodos QR tienen su propia ventana y exigen imagen: solo se restablecen los de WhatsApp y contra entrega.
update public.payment_methods set is_active = true, max_amount = null, window_minutes = null, archived_at = null
 where country = 'BO' and code in ('whatsapp', 'cash_on_delivery');

-- ── Ayudas (objetos temporales: viven y mueren con la transacción) ────────────────────────────
create function pg_temp.u(n int) returns uuid language sql as $$ select ('a1000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.ad(n int) returns uuid language sql as $$ select ('a2000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.pr(n int) returns uuid language sql as $$ select ('b1000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.va(n int) returns uuid language sql as $$ select ('f1000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.stock(n int) returns int language sql as $$ select stock_on_hand from public.product_variants where id = pg_temp.va(n) $$;
create temp table t_r (k text primary key, v jsonb);
create function pg_temp.rec(p_k text, p_v jsonb) returns void language sql as
  $$ insert into t_r values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.g(p_k text) returns jsonb language sql as $$ select v from t_r where k = p_k $$;
create function pg_temp.q(p_k text, p_path text) returns text language sql as
  $$ select v #>> string_to_array(p_path, '.') from t_r where k = p_k $$;
create function pg_temp.cnt() returns bigint language sql as $$ select last_value from public.order_counters where prefix = 'MIC' $$;
-- La «foto» del mundo que un pedido fallido NO debe tocar: contador, stock de los productos de la prueba, pedidos, usos de
-- descuentos, cupos de franjas y movimientos de venta/cancelación.
create function pg_temp.state() returns text language sql as $$
  select pg_temp.cnt()::text || '|' ||
         (select coalesce(sum(stock_on_hand), 0) from public.product_variants where product_id::text like 'b1000000%')::text || '|' ||
         (select count(*) from public.orders)::text || '|' ||
         (select count(*) from public.discount_redemptions)::text || '|' ||
         (select count(*) from public.delivery_bookings where status = 'active')::text || '|' ||
         (select count(*) from public.stock_movements where reason in ('sale', 'cancel')
            and variant_id in (select id from public.product_variants where product_id::text like 'b1000000%'))::text $$;
create temp table t_s (k text primary key, v text);
create function pg_temp.snap(p_k text) returns void language sql as
  $$ insert into t_s values (p_k, pg_temp.state()) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.same(p_k text) returns boolean language sql as $$ select pg_temp.state() = (select v from t_s where k = p_k) $$;

-- Producto activo con una variante: precio, stock y costo.
create function pg_temp.mk(p_n int, p_price numeric, p_stock int, p_cost numeric default null) returns void language plpgsql as $$
declare
  v_pp text := lpad(p_n::text, 2, '0');
  v_p uuid := pg_temp.pr(p_n);
  v_c uuid := ('d1000000-0000-0000-0000-0000000000' || v_pp)::uuid;
  v_s uuid := ('e1000000-0000-0000-0000-0000000000' || v_pp)::uuid;
begin
  insert into public.products (id, code, slug, name) values (v_p, 'S10-' || v_pp, 's10-' || v_pp, 'Producto S10 ' || v_pp);
  insert into public.product_colors (id, product_id, name) values (v_c, v_p, 'Único');
  insert into public.product_prices (product_id, currency, amount) values (v_p, 'BOB', p_price);
  insert into public.product_sizes (id, product_id, label) values (v_s, v_p, 'M');
  insert into public.product_variants (id, product_id, color_id, size_id) values (pg_temp.va(p_n), v_p, v_c, v_s);
  perform public.apply_stock_change(pg_temp.va(p_n), p_stock, 'import', 'carga inicial S10');
  update public.products set status = 'active', cost_base = p_cost where id = v_p;
end $$;

-- Carrito de la clienta n con hasta dos líneas (producto, cantidad).
create function pg_temp.cart(p_u int, p_a int, p_qa int, p_b int default null, p_qb int default null) returns void language plpgsql as $$
begin
  perform public.cart_set_item(pg_temp.u(p_u), null, pg_temp.va(p_a), p_qa);
  if p_b is not null then perform public.cart_set_item(pg_temp.u(p_u), null, pg_temp.va(p_b), p_qb); end if;
end $$;
-- Dirección de la clienta n (con pin dentro de la cobertura, salvo que se pida otra cosa).
create function pg_temp.mkaddr(p_u int, p_lat numeric default -16.52, p_lng numeric default -68.15, p_city text default 'La Paz') returns uuid
language plpgsql as $$
begin
  insert into public.addresses (id, profile_id, label, recipient, phone_e164, line1, city, lat, lng)
  values (pg_temp.ad(p_u), pg_temp.u(p_u), 'Casa', 'Clienta ' || p_u, '+59171234567', 'Calle ' || p_u, p_city, p_lat, p_lng);
  return pg_temp.ad(p_u);
end $$;
-- create_order con valores por omisión; el correo y el teléfono son los de la clienta 1.
create function pg_temp.co(p_u int, p_total numeric, p_key text, p_addr int default null, p_method text default 'delivery',
                           p_pay text default 'whatsapp', p_slot uuid default null, p_date date default null, p_tax uuid default null)
returns jsonb language sql as $$
  select public.create_order(pg_temp.u(p_u), case when p_addr is null then pg_temp.ad(p_u) else pg_temp.ad(p_addr) end, p_tax,
                             p_method, p_slot, p_date, p_pay, 'Ana Pérez', 'ana.s10@test.com', '+59171234567', p_total, p_key) $$;
create function pg_temp.pv(p_u int, p_pay text default 'whatsapp', p_addr int default null) returns jsonb language sql as $$
  select public.checkout_preview(pg_temp.u(p_u), case when p_addr is null then pg_temp.ad(p_u) else pg_temp.ad(p_addr) end, null,
                                 'delivery', null, null, p_pay) $$;
create function pg_temp.dc(p jsonb) returns uuid language plpgsql as $$
declare
  r public.discounts;
  v uuid;
begin
  r := jsonb_populate_record(null::public.discounts, p);
  insert into public.discounts (id, name, kind, params, scope, currency, min_order_amount, requires_coupon, stackable_with_automatic,
    usage_limit_total, usage_limit_per_customer, priority, starts_at, ends_at, is_active)
  values (coalesce(r.id, gen_random_uuid()), coalesce(r.name, 'D'), r.kind, r.params, coalesce(r.scope, 'order'),
    coalesce(r.currency, 'BOB'), r.min_order_amount, coalesce(r.requires_coupon, false), coalesce(r.stackable_with_automatic, false),
    r.usage_limit_total, r.usage_limit_per_customer, coalesce(r.priority, 100), r.starts_at, r.ends_at, coalesce(r.is_active, true))
  returning id into v;
  return v;
end $$;
-- Oferta automática del 10 % de todo el pedido: los porcentajes automáticos son de tipo «flash» (con inicio y fin).
create function pg_temp.flash10() returns uuid language sql as $$
  select pg_temp.dc(jsonb_build_object('name', 'Oferta 10', 'kind', 'flash', 'params', '{"percent":10}'::jsonb,
                                       'starts_at', now() - interval '1 day', 'ends_at', now() + interval '1 day')) $$;
-- Apaga los descuentos (NO borra las redenciones: los pedidos ya creados las conservan para probar su confirmación y su devolución).
create function pg_temp.wipe() returns void language sql as $$ update public.discounts set is_active = false where is_active $$;
-- Un pedido insertado directo (solo para probar restricciones): el perfil es la clienta 20, que no se usa en otro sitio.
create function pg_temp.ins(p jsonb) returns void language plpgsql as $$
begin
  insert into public.orders select * from jsonb_populate_record(null::public.orders, jsonb_build_object(
    'id', gen_random_uuid(), 'number', 'MIC-900001', 'profile_id', pg_temp.u(20), 'status', 'pending_payment',
    'currency', 'BOB', 'base_currency', 'BOB', 'exchange_rate', 1, 'country', 'BO', 'subtotal', 100, 'discount_total', 0,
    'shipping_cost', 0, 'shipping_discount', 0, 'total', 100, 'tax_included', true, 'contact_name', 'X',
    'contact_phone', '+59171234567', 'shipping_method', '{}'::jsonb, 'payment_method', 'whatsapp',
    'payment_provider', 'whatsapp', 'discounts', '[]'::jsonb, 'idempotency_key', 'key-direct-1',
    'created_at', now(), 'updated_at', now()) || p);
end $$;

insert into auth.users (id, email, raw_user_meta_data, aud, role)
select pg_temp.u(n), 'u' || lpad(n::text, 2, '0') || '.s10@test.com', jsonb_build_object('full_name', 'Clienta ' || n), 'authenticated', 'authenticated'
  from generate_series(1, 30) n;
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('ad100000-0000-0000-0000-00000000000d', 'admin.s10@test.com', '{"full_name":"Admin S10"}', 'authenticated', 'authenticated');
select public.set_user_role('ad100000-0000-0000-0000-00000000000d', 'admin');
update public.profiles set blacklisted = true where id = pg_temp.u(3);

select pg_temp.mk(1, 100.00, 20, 60);   -- PA
select pg_temp.mk(2, 40.00, 100, 15);   -- PB
select pg_temp.mk(3, 33.33, 50);        -- PC
select pg_temp.mk(4, 10.00, 1);         -- PD: la última unidad
select pg_temp.mk(5, 20.00, 3);         -- PE
select pg_temp.mk(6, 5.00, 5);          -- PF
select pg_temp.mk(7, 50.00, 20);        -- PG
select pg_temp.mk(8, 10.00, 6);         -- PH: para la alerta de stock (6 → 1 cruza el umbral crítico)

-- Envíos: taller en La Paz, domicilio PLANO 15,00 dentro de 25 km, recojo gratis, dos franjas por día
insert into public.store_locations (id, name, address_text, city, lat, lng, is_active, is_primary)
values ('11111111-1000-0000-0000-000000000001', 'Taller', 'Calle Ejemplo 1', 'La Paz', -16.5, -68.15, true, true);
update public.shipping_methods set is_active = true where code = 'delivery';
insert into public.shipping_methods (code, name, kind, pickup_location_id)
values ('recojo', 'Recojo en el taller', 'pickup', '11111111-1000-0000-0000-000000000001');
insert into public.shipping_zones (id, name, kind, center_lat, center_lng, radius_km, allowed)
values ('22222222-1000-0000-0000-00000000000a', 'Cerca del taller', 'radius', -16.5, -68.15, 25, true);
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

-- Direcciones: una por clienta que compra (las otras se crean donde hacen falta)
select pg_temp.mkaddr(n) from generate_series(1, 30) n;
insert into public.tax_profiles (id, profile_id, doc_type, doc_number, legal_name)
values ('a3000000-0000-0000-0000-000000000001', pg_temp.u(1), 'ci', '1234567', 'Ana Pérez'),
       ('a3000000-0000-0000-0000-000000000002', pg_temp.u(2), 'nit', '1020304050', 'Bia SRL');

-- ═══ A. Numeración, contador y restricciones ═════════════════════════════════════════════════
create temp table t_cnt as select last_value from public.order_counters where prefix = 'MIC';
alter table public.order_counters disable trigger order_counters_guard;
update public.order_counters set last_value = 999998 where prefix = 'MIC';
select is(public._next_order_number('MIC'), 'MIC-999999', 'número: seis cifras con ceros a la izquierda');
select is(public._next_order_number('MIC'), 'MIC-1000000', 'número: a partir de un millón se escribe completo (lpad no lo recorta)');
update public.order_counters set last_value = (select last_value from t_cnt) where prefix = 'MIC';
alter table public.order_counters enable trigger order_counters_guard;
select is(pg_temp.cnt(), (select last_value from t_cnt), 'contador: restaurado tras la prueba de formato');
select throws_ok($$select public._next_order_number('ZZZ')$$, 'P0002', null, 'número: un prefijo sin contador falla');
select throws_ok($$update public.order_counters set last_value = last_value + 5 where prefix = 'MIC'$$, '42501', null, 'contador: no se puede saltar números');
select throws_ok($$update public.order_counters set last_value = last_value - 1 where prefix = 'MIC'$$, '42501', null, 'contador: no retrocede');
select throws_ok($$delete from public.order_counters$$, '42501', null, 'contador: no se borra');
select throws_ok($$truncate public.order_counters$$, '42501', null, 'contador: no se vacía');

select lives_ok($$select pg_temp.ins('{}')$$, 'tabla: un pedido válido insertado directo entra (control de las pruebas siguientes)');
select throws_ok($$select pg_temp.ins('{"number":"mic-1","idempotency_key":"key-direct-2"}')$$, '23514', null, 'tabla: el número lleva prefijo en mayúsculas y al menos 6 cifras');
select throws_ok($$select pg_temp.ins('{"number":"MIC-900002","idempotency_key":"key-direct-2","status":"hola"}')$$, '23514', null, 'tabla: un estado inventado se rechaza');
select throws_ok($$select pg_temp.ins('{"number":"MIC-900002","idempotency_key":"key-direct-2","total":99}')$$, '23514', null, 'tabla: el total tiene que cuadrar AL CENTAVO (subtotal − descuento + envío − descuento de envío)');
select throws_ok($$select pg_temp.ins('{"number":"MIC-900002","idempotency_key":"key-direct-2","shipping_cost":5,"shipping_discount":6,"total":99}')$$, '23514', null, 'tabla: el descuento de envío no puede pasar del envío');
select throws_ok($$select pg_temp.ins('{"number":"MIC-900002","idempotency_key":"key-direct-2","contact_phone":"71234567"}')$$, '23514', null, 'tabla: el teléfono va en E.164');
select throws_ok($$select pg_temp.ins('{"number":"MIC-900002","idempotency_key":"key-direct-2","contact_email":"A@B.com"}')$$, '23514', null, 'tabla: el correo va en minúsculas');
select throws_ok($$select pg_temp.ins('{"number":"MIC-900002","idempotency_key":"abc"}')$$, '23514', null, 'tabla: la llave de idempotencia tiene 8 a 64 caracteres');
select throws_ok($$select pg_temp.ins('{"number":"MIC-900002","status":"cancelled"}')$$, '23514', null, 'tabla: un pedido cancelado necesita su fecha de cancelación');
select throws_ok($$select pg_temp.ins('{"number":"MIC-900002"}')$$, '23505', null, 'tabla: la misma llave de la misma clienta no se repite');
select throws_ok($$select pg_temp.ins('{"idempotency_key":"key-direct-3"}')$$, '23505', null, 'tabla: el número de pedido es único');

-- Transiciones válidas: 9 del admin, 2 de la clienta, 1 del sistema (BR-ORD-01/02)
create temp table t_st as select unnest(array['pending_payment', 'paid', 'preparing', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded']) as s;
select is((select string_agg(a.s || '>' || b.s, ', ' order by a.s || '>' || b.s collate "C") from t_st a, t_st b where public._order_transition_ok(a.s, b.s, 'admin')),
  'cancelled>refunded, delivered>completed, paid>cancelled, paid>preparing, pending_payment>cancelled, pending_payment>paid, preparing>cancelled, preparing>shipped, shipped>delivered',
  'transiciones: el admin tiene EXACTAMENTE estas 9');
select is((select string_agg(a.s || '>' || b.s, ', ' order by a.s || '>' || b.s collate "C") from t_st a, t_st b where public._order_transition_ok(a.s, b.s, 'customer')),
  'paid>cancelled, pending_payment>cancelled', 'transiciones: la clienta solo cancela, y solo pendiente o pagado');
select is((select string_agg(a.s || '>' || b.s, ', ' order by a.s || '>' || b.s collate "C") from t_st a, t_st b where public._order_transition_ok(a.s, b.s, 'system')),
  'pending_payment>cancelled, pending_payment>paid', 'transiciones: el sistema vence pedidos sin pagar y (S11) confirma los que se pagan; nada más');
select is((select count(*)::int from t_st a, t_st b where public._order_transition_ok(a.s, b.s, 'otro')), 0, 'transiciones: un actor desconocido no puede nada');
select is(public._order_transition_ok('preparing', 'cancelled', 'customer'), false, 'transiciones: la clienta NO cancela desde «preparing» (BR-ORD-02)');
select is(public._order_transition_ok('preparing', 'cancelled', 'admin'), true, 'transiciones: el admin sí');
select is(public._order_transition_ok('completed', 'cancelled', 'admin'), false, 'transiciones: un pedido completado no se cancela');
select is(public._order_transition_ok('paid', 'pending_payment', 'admin'), false, 'transiciones: no se retrocede');
select is(public._order_transition_ok('pending_payment', 'shipped', 'admin'), false, 'transiciones: no se salta de pendiente a enviado');

-- ═══ B. Camino feliz ═══════════════════════════════════════════════════════════════════════
-- u01: PA × 2 (200,00) + PB × 1 (40,00) = 240,00 · envío plano 15,00 · total 255,00 · stock PA 20 → 18, PB 100 → 99
select pg_temp.cart(1, 1, 2, 2, 1);
select pg_temp.rec('pv1', pg_temp.pv(1));
select is(pg_temp.q('pv1', 'outcome'), 'preview', 'vista previa: responde «preview»');
select is((pg_temp.g('pv1') #>> '{checkout,ok}')::boolean, true, 'vista previa: sin errores');
select is((pg_temp.g('pv1') #>> '{checkout,totals,subtotal}')::numeric, 240.00, 'vista previa: subtotal 2 × 100,00 + 40,00 = 240,00');
select is((pg_temp.g('pv1') #>> '{checkout,totals,shipping}')::numeric, 15.00, 'vista previa: envío plano 15,00');
select is((pg_temp.g('pv1') #>> '{checkout,totals,total}')::numeric, 255.00, 'vista previa: total 255,00');
-- la vista previa NO exige método de pago (no cambia ningún importe): sirve para listar los métodos disponibles y calcular
select pg_temp.rec('pv1b', public.checkout_preview(pg_temp.u(1), pg_temp.ad(1), null, 'delivery', null, null, null));
select is((pg_temp.g('pv1b') #>> '{checkout,ok}')::boolean, true, 'vista previa sin método de pago: no es un error (aún no eligió)');
select is((pg_temp.g('pv1b') #>> '{checkout,totals,total}')::numeric, 255.00, 'vista previa sin método de pago: calcula el mismo total (255,00)');
select is(jsonb_array_length(pg_temp.g('pv1b') #> '{checkout,payment,methods}'), 2, 'vista previa sin método de pago: igual lista los dos métodos disponibles');
select is(jsonb_array_length(pg_temp.g('pv1') #> '{checkout,payment,methods}'), 2, 'vista previa: dos métodos de pago (WhatsApp y contra entrega)');
select cmp_ok(jsonb_array_length(pg_temp.g('pv1') #> '{checkout,shipping,quote,slots}'), '>', 0, 'vista previa: ofrece franjas de entrega');
select is((select count(*)::int from public.orders where profile_id = pg_temp.u(1)), 0, 'vista previa: no crea nada');

create temp table t_exp as select 'MIC-' || lpad((pg_temp.cnt() + 1)::text, 6, '0') as n;
select pg_temp.snap('antes_b1');
select pg_temp.rec('b1', pg_temp.co(1, 255.00, 'key-b1-0001', 1, 'delivery', 'whatsapp', null, null, 'a3000000-0000-0000-0000-000000000001'));
select is(pg_temp.q('b1', 'outcome'), 'created', 'B1: el pedido se crea');
select is(pg_temp.q('b1', 'order.number'), (select n from t_exp), 'B1: recibe el siguiente número correlativo');
select is(pg_temp.cnt(), (select last_value + 1 from t_cnt), 'B1: el contador avanzó exactamente 1');
select is(pg_temp.q('b1', 'order.status'), 'pending_payment', 'B1: nace «pending_payment»');
select is((pg_temp.g('b1') #>> '{order,subtotal}')::numeric, 240.00, 'B1: subtotal 240,00');
select is((pg_temp.g('b1') #>> '{order,discount_total}')::numeric, 0.00, 'B1: sin descuento');
select is((pg_temp.g('b1') #>> '{order,shipping_cost}')::numeric, 15.00, 'B1: envío 15,00');
select is((pg_temp.g('b1') #>> '{order,total}')::numeric, 255.00, 'B1: total 255,00');
select is(pg_temp.q('b1', 'order.currency'), 'BOB', 'B1: moneda BOB');
select is((select exchange_rate from public.orders where number = (select n from t_exp)), 1.00000000, 'B1: tipo de cambio congelado en 1 (base = moneda del pedido)');
select is(jsonb_array_length(pg_temp.g('b1') #> '{order,items}'), 2, 'B1: dos líneas');
select is((select qty from public.order_items i join public.orders o on o.id = i.order_id where o.number = (select n from t_exp) and i.variant_id = pg_temp.va(1)), 2, 'B1: PA × 2');
select is((select line_total from public.order_items i join public.orders o on o.id = i.order_id where o.number = (select n from t_exp) and i.variant_id = pg_temp.va(1)), 200.00, 'B1: línea de PA = 200,00');
select is((select cost_unit from public.order_items i join public.orders o on o.id = i.order_id where o.number = (select n from t_exp) and i.variant_id = pg_temp.va(1)), 60.00, 'B1: el costo unitario de PA queda congelado en 60,00');
select is((select cost_unit from public.order_items i join public.orders o on o.id = i.order_id where o.number = (select n from t_exp) and i.variant_id = pg_temp.va(2)), 15.00, 'B1: costo de PB 15,00');
select is((select sum(final_total) from public.order_items i join public.orders o on o.id = i.order_id where o.number = (select n from t_exp)), 240.00, 'B1: la suma de las líneas cuadra con el subtotal');
select is(pg_temp.stock(1), 18, 'B1: stock firme de PA 20 → 18');
select is(pg_temp.stock(2), 99, 'B1: stock firme de PB 100 → 99');
select is((select count(*)::int from public.stock_movements where ref = (select n from t_exp) and reason = 'sale'), 2, 'B1: dos movimientos de venta con el número del pedido');
select is((select sum(delta)::int from public.stock_movements where ref = (select n from t_exp)), -3, 'B1: …que suman −3 unidades');
select is((select status from public.carts where profile_id = pg_temp.u(1) order by created_at desc limit 1), 'converted', 'B1: el carrito queda convertido');
select is((select count(*)::int from public.stock_reservations r join public.carts c on c.id = r.owner_id where c.profile_id = pg_temp.u(1) and r.status = 'active'), 0, 'B1: ninguna retención activa del carrito');
select is((select count(*)::int from public.stock_reservations r join public.carts c on c.id = r.owner_id where c.profile_id = pg_temp.u(1) and r.status = 'consumed'), 2, 'B1: las 2 retenciones quedaron «consumed»');
select is((select count(*)::int from public.order_status_history where order_id = (pg_temp.g('b1') #>> '{order,id}')::uuid and to_status = 'pending_payment' and from_status is null and actor_kind = 'customer'), 1, 'B1: una fila de historial (creado)');
select is((select provider || '/' || status || '/' || amount::text from public.payments where order_id = (pg_temp.g('b1') #>> '{order,id}')::uuid), 'whatsapp/pending/255.00', 'B1: pago base: whatsapp, pendiente, 255,00');
select is((select payment_expires_at from public.orders where number = (select n from t_exp)), null, 'B1: WhatsApp no vence (S-05)');
select is((pg_temp.g('b1') #>> '{order,tax_profile,doc_number}'), '1234567', 'B1: datos fiscales congelados');
select is((pg_temp.g('b1') #>> '{order,shipping_address,line1}'), 'Calle 1', 'B1: dirección de envío congelada');
select is((pg_temp.g('b1') #>> '{order,shipping_method,code}') || '/' || (pg_temp.g('b1') #>> '{order,shipping_method,quote,cost}'), 'delivery/15.00', 'B1: método y cotización congelados');
select is((select count(*)::int from public.notification_outbox where dedupe_key = 'order_created:' || (pg_temp.g('b1') #>> '{order,id}') || ':c' and recipient = 'u01.s10@test.com' and channel = 'email'), 1, 'B1: aviso al cliente en la cola, al correo de su CUENTA');
select is((select count(*)::int from public.notification_outbox where recipient = 'ana.s10@test.com'), 0, 'B1: el correo escrito en el formulario NO recibe avisos (no está verificado: sería un relevo de correo a terceros)');
select is((select count(*)::int from public.notification_outbox where dedupe_key = 'order_new:' || (pg_temp.g('b1') #>> '{order,id}') || ':a' and recipient is null), 1, 'B1: aviso a los administradores en la cola');
select is((select count(*)::int from public.notification_outbox where payload::text like '%Ana%' and dedupe_key like 'order_created:%'), 0, 'B1: el aviso no lleva datos personales en el payload');
select is(public.checkout_preview(pg_temp.u(1), pg_temp.ad(1), null, 'delivery', null, null, 'whatsapp') ->> 'outcome', 'no_cart', 'B1: tras comprar no hay carrito activo');

-- Idempotencia (criterio 4): misma llave = mismo pedido, sin descontar dos veces
select pg_temp.snap('despues_b1');
select pg_temp.rec('b1r', pg_temp.co(1, 255.00, 'key-b1-0001', 1, 'delivery', 'whatsapp', null, null, 'a3000000-0000-0000-0000-000000000001'));
select is(pg_temp.q('b1r', 'outcome'), 'existing', 'idempotencia: la misma llave devuelve «existing»');
select is(pg_temp.q('b1r', 'order.id'), pg_temp.q('b1', 'order.id'), 'idempotencia: el MISMO pedido');
select is(pg_temp.same('despues_b1'), true, 'idempotencia: ni contador, ni stock, ni pedidos, ni usos cambian');
select is(pg_temp.co(1, 1.00, 'key-b1-0001', 1, 'delivery', 'whatsapp', null, null, 'a3000000-0000-0000-0000-000000000001') ->> 'outcome', 'existing', 'idempotencia: aunque el total esperado sea otro, gana el pedido ya creado');
select is(pg_temp.co(1, 255.00, 'key-b1-0002', 1) -> 'errors' -> 0 ->> 'code', 'cart_empty', 'idempotencia: con OTRA llave y el carrito ya convertido no se crea otro pedido');
select is(pg_temp.same('despues_b1'), true, 'idempotencia: tampoco cambió nada');
select is(pg_temp.co(2, 55.00, 'key-b1-0001', 2) -> 'errors' -> 0 ->> 'code', 'cart_empty', 'idempotencia: la llave es POR clienta (otra clienta con la misma llave no recibe tu pedido NI se entera de que existe: su respuesta es la de una bolsa vacía, no un conflicto)');
select is(pg_temp.co(1, 255.00, 'key-b1-0001', 1, 'delivery', 'cash_on_delivery', null, null, 'a3000000-0000-0000-0000-000000000001') -> 'errors' -> 0 ->> 'code', 'idempotency_conflict', 'idempotencia: la MISMA llave con OTRO contenido (otro método de pago) es un conflicto, no el pedido viejo');
select is(pg_temp.co(1, 255.00, 'key-b1-0001', 1, 'recojo', 'whatsapp', null, null, 'a3000000-0000-0000-0000-000000000001') -> 'errors' -> 0 ->> 'code', 'idempotency_conflict', 'idempotencia: …tampoco con otra forma de entrega');
select is(pg_temp.co(1, 255.00, 'key-b1-0001', 1) -> 'errors' -> 0 ->> 'code', 'idempotency_conflict', 'idempotencia: …ni sin los datos fiscales que llevaba el primer intento');
select is(pg_temp.same('despues_b1'), true, 'idempotencia: los conflictos no tocan nada');

-- Numeración sin huecos entre clientas: u02 PB × 1 = 40,00 + 15,00 = 55,00
select pg_temp.cart(2, 2, 1);
select pg_temp.rec('b3', pg_temp.co(2, 55.00, 'key-b3-0001'));
select is(pg_temp.q('b3', 'outcome'), 'created', 'B3: otra clienta compra');
select is(pg_temp.q('b3', 'order.number'), 'MIC-' || lpad(((select last_value from t_cnt) + 2)::text, 6, '0'), 'B3: el número siguiente, sin hueco');

-- Instantánea (criterio 3): editar o archivar productos después no altera el pedido
update public.products set name = 'Renombrado' where id = pg_temp.pr(1);
update public.product_prices set amount = 999 where product_id = pg_temp.pr(1);
update public.products set status = 'draft' where id = pg_temp.pr(1);
update public.products set archived_at = now() where id = pg_temp.pr(1);
select is(public._order_json((pg_temp.g('b1') #>> '{order,id}')::uuid) #>> '{items,0,product_name}', 'Producto S10 01', 'instantánea: el nombre del producto no cambia');
select is((public._order_json((pg_temp.g('b1') #>> '{order,id}')::uuid) #>> '{items,0,unit_price}')::numeric, 100.00, 'instantánea: el precio unitario no cambia');
select is((select total from public.orders where id = (pg_temp.g('b1') #>> '{order,id}')::uuid), 255.00, 'instantánea: el total no cambia');
update public.products set archived_at = null where id = pg_temp.pr(1);
update public.products set status = 'active' where id = pg_temp.pr(1);
update public.product_prices set amount = 100 where product_id = pg_temp.pr(1);
update public.products set name = 'Producto S10 01' where id = pg_temp.pr(1);
-- borrar el carrito (los pgTAP antiguos lo hacen) no puede romper la guarda de los pedidos
select lives_ok($$delete from public.carts where profile_id = 'a1000000-0000-0000-0000-000000000001'$$, 'guarda: borrar el carrito del pedido NO falla (cart_id pasa a null)');
select is((select cart_id from public.orders where id = (pg_temp.g('b1') #>> '{order,id}')::uuid), null, 'guarda: …y el pedido conserva todo salvo el enlace al carrito');

-- Guardas de inmutabilidad
select throws_ok($$update public.orders set total = 1 where number = (select n from t_exp)$$, '42501', null, 'guarda: el total de un pedido no se edita');
select throws_ok($$update public.orders set status = 'paid' where number = (select n from t_exp)$$, '42501', null, 'guarda: el estado NO se cambia con un UPDATE directo');
select throws_ok($$update public.orders set contact_name = 'Otra' where number = (select n from t_exp)$$, '42501', null, 'guarda: la instantánea de contacto no se edita');
select throws_ok($$delete from public.orders where number = (select n from t_exp)$$, '42501', null, 'guarda: los pedidos no se borran');
select throws_ok($$truncate public.orders$$, '0A000', null, 'guarda: los pedidos no se vacían (la base lo impide: las líneas los referencian)');
select throws_ok($$truncate public.order_items$$, '42501', null, 'guarda: las líneas no se vacían');
select throws_ok($$truncate public.order_status_history$$, '42501', null, 'guarda: el historial no se vacía');
select throws_ok($$insert into public.payment_methods (country, code, provider, name) values ('BO', 'qr_falso', 'stripe', 'QR')$$, '23514', null, 'pagos: un método con un proveedor que no existe se rechaza (dejaría pedidos sin forma de completarse)');
select lives_ok($t$do $x$ begin
  insert into public.payment_methods (country, code, provider, name, is_active) values ('BO', 'wa_dos', 'whatsapp', 'WhatsApp 2', false);
  delete from public.payment_methods where code = 'wa_dos';
end $x$$t$, 'pagos: un método con un proveedor implementado entra');
select throws_ok($$update public.order_items set qty = 99$$, '42501', null, 'guarda: las líneas del pedido no se editan');
select throws_ok($$delete from public.order_items$$, '42501', null, 'guarda: las líneas no se borran');
select throws_ok($$update public.order_status_history set reason = 'x'$$, '42501', null, 'guarda: el historial es inmutable');
select throws_ok($$delete from public.order_status_history$$, '42501', null, 'guarda: el historial no se borra');

-- ═══ C. Lo que la persona debe corregir: NADA se crea (ni stock, ni contador, ni usos) ═══════════════
-- u05: PA × 1 = 100,00 + envío 15,00 = 115,00
select pg_temp.cart(5, 1, 1);
insert into public.addresses (id, profile_id, label, recipient, phone_e164, line1, city) values
  (pg_temp.ad(31), pg_temp.u(5), 'Sin pin', 'Clienta 5', '+59171234567', 'Calle sin pin', 'La Paz');
insert into public.addresses (id, profile_id, label, recipient, phone_e164, line1, city, lat, lng) values
  (pg_temp.ad(32), pg_temp.u(5), 'Lejos', 'Clienta 5', '+59171234567', 'Calle lejana', 'Cochabamba', -17.3895, -66.1568);
select pg_temp.snap('c0');
select is(public.create_order(pg_temp.u(5), null, null, 'delivery', null, null, 'whatsapp', 'Ana', null, '+59171234567', 115.00, 'key-c-0001') ->> 'outcome', 'rejected', 'C1: sin dirección → rechazado');
select is(public.create_order(pg_temp.u(5), null, null, 'delivery', null, null, 'whatsapp', 'Ana', null, '+59171234567', 115.00, 'key-c-0001') -> 'errors' -> 0 ->> 'code', 'address_required', 'C1: «address_required»');
select is(pg_temp.co(5, 115.00, 'key-c-0002', 2) -> 'errors' -> 0 ->> 'code', 'address_invalid', 'C2: la dirección de OTRA clienta no sirve («address_invalid»)');
select is(pg_temp.co(5, 115.00, 'key-c-0003', 31) -> 'errors' -> 0 ->> 'code', 'location_required', 'C3: una dirección sin pin no se puede cotizar («location_required»)');
select is(pg_temp.co(5, 115.00, 'key-c-0004', 32) -> 'errors' -> 0 ->> 'code', 'out_of_coverage', 'C4: fuera de la cobertura («out_of_coverage»), no un envío con costo 0');
select is(pg_temp.co(5, 115.00, 'key-c-0005', null, 'moto') -> 'errors' -> 0 ->> 'code', 'method_not_found', 'C5: un método de envío inexistente');
select is(public.create_order(pg_temp.u(5), pg_temp.ad(5), null, 'delivery', null, null, null, 'Ana', null, '+59171234567', 115.00, 'key-c-0006') -> 'errors' -> 0 ->> 'code', 'payment_method_required', 'C6: sin método de pago');
select is(pg_temp.co(5, 115.00, 'key-c-0007', null, 'delivery', 'paypal') -> 'errors' -> 0 ->> 'code', 'payment_unavailable', 'C6: un método de pago que no existe');
select is(pg_temp.co(5, 115.00, 'key-c-0008', null, 'delivery', 'whatsapp', null, null, 'a3000000-0000-0000-0000-000000000002') -> 'errors' -> 0 ->> 'code', 'tax_profile_invalid', 'C7: los datos fiscales de OTRA clienta no sirven');
select is(pg_temp.same('c0'), true, 'C1–C7: ninguno dejó rastro (contador, stock, pedidos, usos, cupos y movimientos intactos)');

-- C9 lista negra (S-07): bloquea contra entrega pero NO el resto de la cuenta
select pg_temp.cart(3, 2, 1);
select pg_temp.snap('c9');
select is(pg_temp.co(3, 55.00, 'key-c9-0001', null, 'delivery', 'cash_on_delivery') -> 'errors' -> 0 ->> 'reason', 'not_available', 'C9: lista negra + contra entrega → rechazado, sin decirle que está en la lista');
select is((pg_temp.pv(3, 'whatsapp') #> '{checkout,payment,methods}' -> 1 ->> 'available')::boolean, false, 'C9: la vista previa muestra contra entrega NO disponible');
select is((pg_temp.pv(3, 'whatsapp') #> '{checkout,payment,methods}' -> 0 ->> 'available')::boolean, true, 'C9: …y WhatsApp sí');
select is(pg_temp.same('c9'), true, 'C9: el rechazo no dejó rastro');
select is(pg_temp.co(3, 55.00, 'key-c9-0002') ->> 'outcome', 'created', 'C9: la misma clienta compra por WhatsApp sin problema');

-- C10 tope de contra entrega: u06 PA×2 + PB×1 = 240,00 + 15,00 = 255,00; el tope es INCLUSIVO
select pg_temp.cart(6, 1, 2, 2, 1);
update public.payment_methods set max_amount = 254.99 where code = 'cash_on_delivery';
select pg_temp.snap('c10');
select is(pg_temp.co(6, 255.00, 'key-c10-0001', null, 'delivery', 'cash_on_delivery') -> 'errors' -> 0 ->> 'reason', 'over_max_amount', 'C10: 255,00 pasa el tope de 254,99 → «over_max_amount»');
select is(pg_temp.same('c10'), true, 'C10: sin rastro');
update public.payment_methods set max_amount = 255.00 where code = 'cash_on_delivery';
select is(pg_temp.co(6, 255.00, 'key-c10-0002', null, 'delivery', 'cash_on_delivery') ->> 'outcome', 'created', 'C10: con el tope EXACTO (255,00) sí se crea (borde inclusivo)');
update public.payment_methods set max_amount = null where code = 'cash_on_delivery';

-- C11 cuenta desactivada
update public.profiles set is_active = false where id = pg_temp.u(4);
select pg_temp.snap('c11');
select is(pg_temp.co(4, 55.00, 'key-c11-0001') -> 'errors' -> 0 ->> 'code', 'account_inactive', 'C11: una cuenta desactivada no compra («account_inactive»)');
select is(pg_temp.same('c11'), true, 'C11: sin rastro');

-- C12 entradas basura = error de petición (22023), no un resultado de negocio
select throws_ok($$select public.create_order('a1000000-0000-0000-0000-000000000005', null, null, 'delivery', null, null, 'whatsapp', 'Ana', null, '71234567', 1, 'key-c12-0001')$$, '22023', null, 'C12: teléfono sin código de país');
select throws_ok($$select public.create_order('a1000000-0000-0000-0000-000000000005', null, null, 'delivery', null, null, 'whatsapp', 'Ana', null, '+59171234567', 1, 'corta')$$, '22023', null, 'C12: llave de idempotencia demasiado corta');
select throws_ok($$select public.create_order('a1000000-0000-0000-0000-000000000005', null, null, 'delivery', null, null, 'whatsapp', 'Ana', null, '+59171234567', -1, 'key-c12-0002')$$, '22023', null, 'C12: total esperado negativo');
select throws_ok($$select public.create_order('a1000000-0000-0000-0000-000000000005', null, null, 'delivery', null, null, 'whatsapp', '   ', null, '+59171234567', 1, 'key-c12-0003')$$, '22023', null, 'C12: nombre vacío');
select throws_ok($$select public.create_order('a1000000-0000-0000-0000-000000000005', null, null, 'delivery', null, null, 'whatsapp', 'Ana', 'sin-arroba', '+59171234567', 1, 'key-c12-0004')$$, '22023', null, 'C12: correo inválido');
select throws_ok($$select public.create_order(null, null, null, 'delivery', null, null, 'whatsapp', 'Ana', null, '+59171234567', 1, 'key-c12-0005')$$, '22023', null, 'C12: sin clienta');
select throws_ok($$select public.create_order('a1000000-0000-0000-0000-000000000005', null, null, 'delivery', null, null, 'whatsapp', 'Ana', null, '+59171234567', null, 'key-c12-0006')$$, '22023', null, 'C12: sin total esperado');

-- C13 recojo en el taller: sin dirección ni cotización por distancia, envío 0,00. u07: PB × 1 = 40,00
select pg_temp.cart(7, 2, 1);
select pg_temp.rec('c13', pg_temp.co(7, 40.00, 'key-c13-0001', null, 'recojo'));
select is(pg_temp.q('c13', 'outcome'), 'created', 'C13: el recojo se crea');
select is((pg_temp.g('c13') #>> '{order,shipping_cost}')::numeric, 0.00, 'C13: envío 0,00');
select is((pg_temp.g('c13') #>> '{order,total}')::numeric, 40.00, 'C13: total 40,00');
select is((pg_temp.g('c13') #>> '{order,shipping_address}'), null, 'C13: sin dirección de envío');
select is((pg_temp.g('c13') #>> '{order,shipping_method,kind}'), 'pickup', 'C13: método de recojo congelado');

-- ═══ D. Stock (criterios 2 y BR-INV-04): la última unidad, reservas vencidas, líneas ya no vendibles ═══
-- PD tiene 1 unidad. u08 la retiene; la retención VENCE; u09 la toma; u08 llega a pagar tarde.
select pg_temp.cart(8, 4, 1);
update public.stock_reservations set expires_at = now() - interval '1 minute'
 where owner_type = 'cart' and owner_id = (select id from public.carts where profile_id = pg_temp.u(8) and status = 'active');
select pg_temp.cart(9, 4, 1);
select pg_temp.snap('d1');
select pg_temp.rec('d1', pg_temp.co(8, 25.00, 'key-d1-0001'));
select is(pg_temp.q('d1', 'outcome'), 'unavailable', 'D1: u08 llega tarde: «unavailable»');
select is(pg_temp.q('d1', 'lines.0.status'), 'out_of_stock', 'D1: …la línea dice «out_of_stock»');
select is(pg_temp.same('d1'), true, 'D1: sin rastro');
select is(pg_temp.co(9, 25.00, 'key-d1-0002') ->> 'outcome', 'created', 'D1: u09, que tiene la retención vigente, se queda con la última unidad');
select is(pg_temp.stock(4), 0, 'D1: stock de PD 1 → 0');
select is(pg_temp.co(8, 25.00, 'key-d1-0003') ->> 'outcome', 'unavailable', 'D1: u08 sigue sin poder comprar (nunca stock negativo)');
select pg_temp.rec('d1c', public.cancel_order_by_customer(pg_temp.u(9), (select id from public.orders where profile_id = pg_temp.u(9)), 'Cambié de opinión'));
select is(pg_temp.stock(4), 1, 'D1: u09 cancela y la unidad vuelve al stock (0 → 1)');
select is(pg_temp.co(8, 25.00, 'key-d1-0004') ->> 'outcome', 'created', 'D1: u08 ahora sí la compra (con stock libre se re-reserva sola)');
select is(pg_temp.stock(4), 0, 'D1: PD otra vez en 0');

-- D2: u10 retiene 3 de PE (stock 3) y el admin baja el stock a 1 → «low_stock»
select pg_temp.cart(10, 5, 3);
select public.apply_stock_change(pg_temp.va(5), -2, 'adjust', 'prueba S10');
select pg_temp.snap('d2');
select pg_temp.rec('d2', pg_temp.co(10, 75.00, 'key-d2-0001'));
select is(pg_temp.q('d2', 'outcome'), 'unavailable', 'D2: pidió 3 y solo queda 1: «unavailable»');
select is(pg_temp.q('d2', 'lines.0.status'), 'low_stock', 'D2: la línea dice «low_stock»');
select is(pg_temp.same('d2'), true, 'D2: sin rastro');
select public.apply_stock_change(pg_temp.va(5), 2, 'import', 'prueba S10');

-- D3: un producto archivado entre la bolsa y el pago
select pg_temp.cart(11, 6, 2);
update public.products set status = 'draft' where id = pg_temp.pr(6);
update public.products set archived_at = now() where id = pg_temp.pr(6);
select pg_temp.snap('d3');
select is(pg_temp.co(11, 25.00, 'key-d3-0001') -> 'lines' -> 0 ->> 'status', 'unavailable', 'D3: el producto archivado figura «unavailable»');
select is(pg_temp.co(11, 25.00, 'key-d3-0002') ->> 'outcome', 'unavailable', 'D3: …y el resultado es «unavailable» (no se ofrece como un cambio de precio)');
select is(pg_temp.same('d3'), true, 'D3: sin rastro');
update public.products set archived_at = null where id = pg_temp.pr(6);
update public.products set status = 'active' where id = pg_temp.pr(6);

-- D4: la retención venció pero HAY stock → se compra igual. u12: PG × 1 = 50,00 + 15,00 = 65,00; stock PG 20 → 19
select pg_temp.cart(12, 7, 1);
update public.stock_reservations set expires_at = now() - interval '1 minute'
 where owner_type = 'cart' and owner_id = (select id from public.carts where profile_id = pg_temp.u(12) and status = 'active');
select is(pg_temp.co(12, 65.00, 'key-d4-0001') ->> 'outcome', 'created', 'D4: con la retención vencida pero stock disponible, se compra');
select is(pg_temp.stock(7), 19, 'D4: stock de PG 20 → 19');

-- ═══ E. Precios y total (BR-CHK-04, BR-PRC-05, S-04) ═════════════════════════════════════════
-- E1: u13 PB × 1 = 40,00 + 15,00 = 55,00. La persona vio 50,00 → se le muestra la diferencia y NO se crea.
select pg_temp.cart(13, 2, 1);
select pg_temp.snap('e1');
select pg_temp.rec('e1', pg_temp.co(13, 50.00, 'key-e1-0001'));
select is(pg_temp.q('e1', 'outcome'), 'changed', 'E1: el total esperado no coincide → «changed»');
select is(pg_temp.q('e1', 'reason'), 'total', 'E1: motivo «total»');
select is((pg_temp.g('e1') ->> 'actual_total')::numeric, 55.00, 'E1: el total real es 55,00');
select is((pg_temp.g('e1') ->> 'expected_total')::numeric, 50.00, 'E1: …y el esperado 50,00');
select is(pg_temp.same('e1'), true, 'E1: sin rastro');
select is(pg_temp.co(13, 55.00, 'key-e1-0001') ->> 'outcome', 'created', 'E1: con el total correcto (misma llave: la anterior no consumió nada) se crea');

-- E2: dentro de la garantía el precio BAJA → se cobra el menor (S-04). u14 PC × 1: 33,33 → 30,00 → total 45,00
select pg_temp.cart(14, 3, 1);
update public.product_prices set amount = 30 where product_id = pg_temp.pr(3);
select is(pg_temp.co(14, 48.33, 'key-e2-0001') ->> 'outcome', 'changed', 'E2: la persona vio 48,33 (33,33 + 15,00) y ahora cuesta menos → «changed»');
select is((pg_temp.co(14, 48.33, 'key-e2-0001') ->> 'actual_total')::numeric, 45.00, 'E2: el total real es 45,00 (30,00 + 15,00)');
select pg_temp.rec('e2', pg_temp.co(14, 45.00, 'key-e2-0001'));
select is(pg_temp.q('e2', 'outcome'), 'created', 'E2: con el total nuevo se crea');
select is((pg_temp.g('e2') #>> '{order,items,0,unit_price}')::numeric, 30.00, 'E2: se cobra el precio MENOR (30,00)');
update public.product_prices set amount = 33.33 where product_id = pg_temp.pr(3);

-- E3: garantía VENCIDA y el precio SUBE (40 → 50): bloquea hasta que la persona lo acepte en la bolsa
select pg_temp.cart(15, 2, 1);
update public.cart_items set price_locked_until = now() - interval '1 minute'
 where cart_id = (select id from public.carts where profile_id = pg_temp.u(15) and status = 'active');
update public.product_prices set amount = 50 where product_id = pg_temp.pr(2);
select pg_temp.snap('e3');
select pg_temp.rec('e3', pg_temp.co(15, 55.00, 'key-e3-0001'));
select is(pg_temp.q('e3', 'outcome'), 'changed', 'E3: precio subido tras vencer la garantía → «changed»');
select is(pg_temp.q('e3', 'reason'), 'price', 'E3: motivo «price»');
select is(pg_temp.q('e3', 'lines.0.price_notice'), 'expired_raised', 'E3: la línea trae el aviso «expired_raised»');
select is(pg_temp.same('e3'), true, 'E3: sin rastro');
select is(public.cart_accept_prices(pg_temp.u(15), null, null) #>> '{cart,can_checkout}', 'true', 'E3: aceptar el precio en la bolsa desbloquea el pago');
select pg_temp.rec('e3b', pg_temp.co(15, 65.00, 'key-e3-0002'));
select is(pg_temp.q('e3b', 'outcome'), 'created', 'E3: con el precio aceptado se crea (50,00 + 15,00 = 65,00)');
select is((pg_temp.g('e3b') #>> '{order,items,0,unit_price}')::numeric, 50.00, 'E3: se cobra 50,00');
update public.product_prices set amount = 40 where product_id = pg_temp.pr(2);

-- ═══ F. Descuentos (S9 → S10): usos reservados, redondeo, cupón agotado, envío gratis, primera compra ═══
select pg_temp.wipe();
select pg_temp.flash10();
-- F1: u16 PA×2 (200,00) + PB×1 (40,00): 10 % por línea = 20,00 + 4,00 = 24,00 · total 240 − 24 + 15 = 231,00
select pg_temp.cart(16, 1, 2, 2, 1);
select is(pg_temp.co(16, 255.00, 'key-f1-0001') ->> 'outcome', 'changed', 'F1: la persona vio 255,00 (sin la oferta) → «changed»');
select pg_temp.rec('f1', pg_temp.co(16, 231.00, 'key-f1-0001'));
select is(pg_temp.q('f1', 'outcome'), 'created', 'F1: con 231,00 se crea');
select is((pg_temp.g('f1') #>> '{order,discount_total}')::numeric, 24.00, 'F1: descuento 24,00');
select is((pg_temp.g('f1') #>> '{order,total}')::numeric, 231.00, 'F1: total 231,00');
select is((select sum(discount) from public.order_items where order_id = (pg_temp.g('f1') #>> '{order,id}')::uuid), 24.00, 'F1: los descuentos por línea suman 24,00');
select is((select sum(final_total) + 15 from public.order_items where order_id = (pg_temp.g('f1') #>> '{order,id}')::uuid), 231.00, 'F1: Σ líneas + envío = total (cuadra al centavo)');
select is((select discount from public.order_items where order_id = (pg_temp.g('f1') #>> '{order,id}')::uuid and variant_id = pg_temp.va(1)), 20.00, 'F1: PA baja 20,00');
select is((select status || '/' || round(amount, 2)::text || '/' || owner_type from public.discount_redemptions where owner_id = (pg_temp.g('f1') #>> '{order,id}')::uuid), 'reserved/24.00/order', 'F1: el uso quedó RESERVADO a nombre del pedido (24,00)');
select is(jsonb_array_length(pg_temp.g('f1') #> '{order,discounts}'), 1, 'F1: la oferta aplicada queda en la instantánea');
select is(jsonb_array_length((select discount_offers from public.order_items where order_id = (pg_temp.g('f1') #>> '{order,id}')::uuid and variant_id = pg_temp.va(1))), 1, 'F1: el desglose por línea queda guardado (para el reembolso prorrateado de S12)');

-- F2: redondeo. u17 PC × 3 = 99,99; 10 % = 9,999 → 10,00 (medio centavo hacia arriba) · final 89,99 · total 89,99 + 15 = 104,99
select pg_temp.cart(17, 3, 3);
select pg_temp.rec('f2', pg_temp.co(17, 104.99, 'key-f2-0001'));
select is(pg_temp.q('f2', 'outcome'), 'created', 'F2: se crea con 104,99');
select is((pg_temp.g('f2') #>> '{order,subtotal}')::numeric, 99.99, 'F2: subtotal 3 × 33,33 = 99,99');
select is((pg_temp.g('f2') #>> '{order,discount_total}')::numeric, 10.00, 'F2: 10 % de 99,99 = 9,999 → 10,00');
select is((pg_temp.g('f2') #>> '{order,total}')::numeric, 104.99, 'F2: total 104,99');
select is((select sum(final_total) from public.order_items where order_id = (pg_temp.g('f2') #>> '{order,id}')::uuid), 89.99, 'F2: la línea queda en 89,99');

-- F3: cupón de UN solo uso: dos clientas lo aplican a la bolsa, la primera compra y a la segunda ya no le vale
select pg_temp.wipe();
select pg_temp.dc('{"id":"13100000-0000-0000-0000-000000000001","name":"Verano 20","kind":"percent","params":{"percent":20},"requires_coupon":true}');
insert into public.coupons (discount_id, code, usage_limit) values ('13100000-0000-0000-0000-000000000001', 'VERANO20', 1);
select pg_temp.cart(18, 2, 2);
select pg_temp.cart(19, 2, 2);
select is(public.cart_set_coupon(pg_temp.u(18), null, 'verano20') ->> 'outcome', 'coupon_set', 'F3: u18 aplica el cupón');
select is(public.cart_set_coupon(pg_temp.u(19), null, 'verano20') ->> 'outcome', 'coupon_set', 'F3: u19 también (todavía no se ha usado)');
-- 2 × 40,00 = 80,00 · 20 % = 16,00 · 80 − 16 + 15 = 79,00
select pg_temp.rec('f3a', pg_temp.co(18, 79.00, 'key-f3-0001'));
select is(pg_temp.q('f3a', 'outcome'), 'created', 'F3: u18 compra con el cupón (79,00)');
select is(pg_temp.q('f3a', 'order.coupon_code'), 'VERANO20', 'F3: queda el código canónico');
select is((select count(*)::int from public.discount_redemptions where coupon_id is not null and status = 'reserved' and owner_id = (pg_temp.g('f3a') #>> '{order,id}')::uuid), 1, 'F3: el uso del cupón quedó reservado');
select pg_temp.snap('f3');
select pg_temp.rec('f3b', pg_temp.co(19, 79.00, 'key-f3-0002'));
select is(pg_temp.q('f3b', 'outcome'), 'changed', 'F3: a u19 el cupón se le agotó mientras compraba → «changed»');
select is((pg_temp.g('f3b') ->> 'actual_total')::numeric, 95.00, 'F3: el total real es 95,00 (80,00 + 15,00, sin descuento)');
select is(pg_temp.same('f3'), true, 'F3: sin rastro');
select pg_temp.rec('f3c', pg_temp.co(19, 95.00, 'key-f3-0002'));
select is(pg_temp.q('f3c', 'outcome'), 'created', 'F3: u19 confirma el total sin cupón y compra');
select is(pg_temp.q('f3c', 'order.coupon_code'), null, 'F3: sin cupón en el pedido');
select is((pg_temp.g('f3c') #>> '{order,discount_total}')::numeric, 0.00, 'F3: sin descuento');

-- F4: envío gratis sobre 300,00 (se evalúa DESPUÉS de los descuentos y es INCLUSIVO)
select pg_temp.wipe();
select pg_temp.dc('{"name":"Envío gratis 300","kind":"free_shipping","params":{},"min_order_amount":300}');
select pg_temp.cart(21, 7, 6);     -- 6 × 50,00 = 300,00 EXACTOS
select pg_temp.cart(22, 7, 5);     -- 5 × 50,00 = 250,00
select pg_temp.rec('f4a', pg_temp.co(21, 300.00, 'key-f4-0001'));
select is(pg_temp.q('f4a', 'outcome'), 'created', 'F4: con 300,00 exactos se crea');
select is((pg_temp.g('f4a') #>> '{order,shipping_cost}')::numeric, 15.00, 'F4: el envío cuesta 15,00…');
select is((pg_temp.g('f4a') #>> '{order,shipping_discount}')::numeric, 15.00, 'F4: …y se descuenta 15,00 (envío gratis en el borde)');
select is((pg_temp.g('f4a') #>> '{order,total}')::numeric, 300.00, 'F4: total 300,00 + 15,00 − 15,00 = 300,00');
select pg_temp.rec('f4b', pg_temp.co(22, 265.00, 'key-f4-0002'));
select is((pg_temp.g('f4b') #>> '{order,shipping_discount}')::numeric, 0.00, 'F4: con 250,00 NO hay envío gratis');
select is((pg_temp.g('f4b') #>> '{order,total}')::numeric, 265.00, 'F4: total 250,00 + 15,00 = 265,00');

-- F5: primera compra (20 %, tope 1 por clienta): solo la primera; al cancelar se libera
select pg_temp.wipe();
select pg_temp.dc('{"name":"Primera 20","kind":"first_purchase","params":{"percent":20},"usage_limit_per_customer":1}');
-- u05 (PA × 1 = 100,00): 20 % = 20,00 · total 100 − 20 + 15 = 95,00
select pg_temp.rec('f5a', pg_temp.co(5, 95.00, 'key-f5-0001'));
select is(pg_temp.q('f5a', 'outcome'), 'created', 'F5: la primera compra recibe el 20 %');
select is((pg_temp.g('f5a') #>> '{order,discount_total}')::numeric, 20.00, 'F5: descuento 20,00');
select pg_temp.cart(5, 2, 1);
select is((pg_temp.pv(5) #>> '{checkout,totals,discount}')::numeric, 0.00, 'F5: la SEGUNDA compra ya no recibe el descuento (tiene un pedido no cancelado)');
select pg_temp.rec('f5b', pg_temp.co(5, 55.00, 'key-f5-0002'));
select is(pg_temp.q('f5b', 'outcome'), 'created', 'F5: la segunda compra se crea sin descuento (55,00)');
select pg_temp.rec('c5a', public.cancel_order_by_customer(pg_temp.u(5), (pg_temp.g('f5a') #>> '{order,id}')::uuid, null));
select pg_temp.rec('c5b', public.cancel_order_by_customer(pg_temp.u(5), (pg_temp.g('f5b') #>> '{order,id}')::uuid, null));
select is((select status from public.discount_redemptions where owner_id = (pg_temp.g('f5a') #>> '{order,id}')::uuid), 'reverted', 'F5: al cancelar, el uso se DEVUELVE (reverted)');
select is(public._customer_order_count(pg_temp.u(5)), 0, 'F5: sin pedidos vigentes vuelve a contar 0 (los cancelados no cuentan)');
select pg_temp.cart(5, 1, 1);
select is((pg_temp.pv(5) #>> '{checkout,totals,discount}')::numeric, 20.00, 'F5: tras cancelar todo, vuelve a ser «primera compra» y el descuento reaparece (20,00)');
select pg_temp.wipe();

-- ═══ F6. Tope de pedidos sin confirmar por clienta (S-05 compromete stock sin vencimiento) ══════════
-- u29 hace 5 pedidos de PB × 1 (40,00 + 15,00 = 55,00): el tope por omisión. El 6.º se rechaza; al cancelar uno, vuelve a poder.
select pg_temp.wipe();
do $$
begin
  for i in 1..5 loop
    perform pg_temp.cart(29, 2, 1);
    perform pg_temp.co(29, 55.00, 'key-m2-000' || i);
  end loop;
end $$;
select is((select count(*)::int from public.orders where profile_id = pg_temp.u(29) and status = 'pending_payment'), 5, 'F6: 5 pedidos pendientes (el tope por omisión)');
select pg_temp.cart(29, 2, 1);
select pg_temp.snap('f6');
select is(pg_temp.co(29, 55.00, 'key-m2-0006') -> 'errors' -> 0 ->> 'code', 'too_many_open_orders', 'F6: el 6.º se rechaza («too_many_open_orders»)');
select is(pg_temp.same('f6'), true, 'F6: …sin tocar stock, contador ni usos');
select is(pg_temp.co(29, 55.00, 'key-m2-0001') ->> 'outcome', 'existing', 'F6: un reintento de uno ya creado SIGUE devolviendo ese pedido (no cuenta como uno nuevo)');
select public.cancel_order_by_customer(pg_temp.u(29), (select id from public.orders where profile_id = pg_temp.u(29) order by created_at, number limit 1), 'prueba');
select is(pg_temp.co(29, 55.00, 'key-m2-0007') ->> 'outcome', 'created', 'F6: al cancelar uno, puede crear otro');
update public.store_settings set value = '6' where key = 'open_orders_max';
select pg_temp.cart(29, 2, 1);
select is(pg_temp.co(29, 55.00, 'key-m2-0008') ->> 'outcome', 'created', 'F6: el tope se sube desde los ajustes (6 → entra el 6.º pendiente)');
update public.store_settings set value = '5' where key = 'open_orders_max';
select is(pg_temp.co(29, 55.00, 'key-m2-0009') -> 'errors' -> 0 ->> 'code', 'too_many_open_orders', 'F6: …y bajarlo de nuevo vuelve a frenar');
select throws_ok($$update public.store_settings set value = '0' where key = 'open_orders_max'$$, '22023', null, 'F6: un tope de 0 pedidos está fuera de rango');
select throws_ok($$update public.store_settings set value = '201' where key = 'open_orders_max'$$, '22023', null, 'F6: un tope de 201 está fuera de rango');

-- ═══ F7. El total esperado llega con ruido de decimales: se redondea a la moneda antes de comparar ═══════════
-- u28: PB × 1 = 40,00 + envío 15,00 = 55,00. Con 55,006 (≈ 55,01) NO coincide: «changed». Con 55,0000001 (ruido de coma flotante) SÍ.
select pg_temp.cart(28, 2, 1);
select pg_temp.snap('f7');
select is(pg_temp.co(28, 55.006, 'key-f7-0001') ->> 'outcome', 'changed', 'F7: 55,006 se redondea a 55,01 y no coincide con 55,00: «changed»');
select is(pg_temp.same('f7'), true, 'F7: …sin tocar nada');
select is(pg_temp.co(28, 55.0000001, 'key-f7-0002') ->> 'outcome', 'created', 'F7: 55,0000001 (ruido de decimales) se redondea a 55,00 y SÍ coincide');

-- ═══ F8. Una cuenta sin correo (solo teléfono) recibe los avisos en el teléfono de su CUENTA, no en el del formulario ═══
update public.profiles set email = null, phone_e164 = '+59170000028' where id = pg_temp.u(28);
select pg_temp.cart(28, 2, 1);
select pg_temp.rec('f8', pg_temp.co(28, 55.00, 'key-f8-0001'));
select is(pg_temp.q('f8', 'outcome'), 'created', 'F8: la cuenta solo-teléfono compra');
select is((select count(*)::int from public.notification_outbox where dedupe_key = 'order_created:' || pg_temp.q('f8', 'order.id') || ':c' and channel = 'whatsapp' and recipient = '+59170000028'), 1, 'F8: el aviso va por WhatsApp al teléfono de la CUENTA');
-- (la cola persiste entre corridas: solo cuentan los avisos de ESTA transacción, que llevan su marca de tiempo)
select is((select count(*)::int from public.notification_outbox where created_at = now() and channel = 'whatsapp' and recipient = '+59171234567'), 0, 'F8: …y ninguno al teléfono escrito en el formulario (no verificado)');

-- ═══ G. Máquina de estados y cancelación ═══════════════════════════════════════════════════
-- G1: u02 (B3, 55,00) lo confirma el admin
select pg_temp.rec('g1', public.transition_order_status((pg_temp.g('b3') #>> '{order,id}')::uuid, 'paid', 'ad100000-0000-0000-0000-00000000000d', 'admin', 'Pago recibido'));
select is(pg_temp.q('g1', 'ok'), 'true', 'G1: pendiente → pagado');
select is((select status from public.orders where id = (pg_temp.g('b3') #>> '{order,id}')::uuid), 'paid', 'G1: el pedido queda «paid»');
select is((select paid_at is not null from public.orders where id = (pg_temp.g('b3') #>> '{order,id}')::uuid), true, 'G1: con su fecha de pago');
select is((select status from public.payments where order_id = (pg_temp.g('b3') #>> '{order,id}')::uuid), 'paid', 'G1: el pago pasa a «paid»');
select is((select count(*)::int from public.order_status_history where order_id = (pg_temp.g('b3') #>> '{order,id}')::uuid), 2, 'G1: dos filas de historial');
select is((select reason from public.order_status_history where order_id = (pg_temp.g('b3') #>> '{order,id}')::uuid and to_status = 'paid'), 'Pago recibido', 'G1: con el motivo');
select is((select count(*)::int from public.notification_outbox where dedupe_key = 'order_confirmed:' || (pg_temp.g('b3') #>> '{order,id}') || ':c'), 1, 'G1: aviso «confirmado» encolado');
select is(public.transition_order_status((pg_temp.g('b3') #>> '{order,id}')::uuid, 'shipped', null, 'admin') ->> 'outcome', 'invalid_transition', 'G2: pagado → enviado (saltándose «preparing») es inválido');
select is(public.transition_order_status(gen_random_uuid(), 'paid', null, 'admin') ->> 'outcome', 'not_found', 'G2: un pedido que no existe');
select throws_ok($$select public.transition_order_status(gen_random_uuid(), 'paid', null, 'robot')$$, '22023', null, 'G2: un actor desconocido es un error de petición');
select is(public.transition_order_status((pg_temp.g('b3') #>> '{order,id}')::uuid, 'preparing', null, 'admin') ->> 'ok', 'true', 'G3: pagado → preparando');
select is(public.transition_order_status((pg_temp.g('b3') #>> '{order,id}')::uuid, 'shipped', null, 'admin') ->> 'ok', 'true', 'G3: → enviado');
select is(public.transition_order_status((pg_temp.g('b3') #>> '{order,id}')::uuid, 'delivered', null, 'admin') ->> 'ok', 'true', 'G3: → entregado');
select is(public.transition_order_status((pg_temp.g('b3') #>> '{order,id}')::uuid, 'completed', null, 'admin') ->> 'ok', 'true', 'G3: → completado');
select is((select count(*)::int from public.order_status_history where order_id = (pg_temp.g('b3') #>> '{order,id}')::uuid), 6, 'G3: seis filas de historial (creado + 5 transiciones)');
select is(public.transition_order_status((pg_temp.g('b3') #>> '{order,id}')::uuid, 'cancelled', null, 'admin') ->> 'outcome', 'invalid_transition', 'G3: un pedido completado no se cancela');
select is((select count(*)::int from public.notification_outbox where dedupe_key in (
    'order_packed:' || (pg_temp.g('b3') #>> '{order,id}') || ':c', 'order_shipped:' || (pg_temp.g('b3') #>> '{order,id}') || ':c',
    'order_delivered:' || (pg_temp.g('b3') #>> '{order,id}') || ':c', 'order_completed:' || (pg_temp.g('b3') #>> '{order,id}') || ':c')), 4, 'G3: avisos de empacado, enviado, entregado y completado (BR-SHP-04)');

-- G4: cancelación por la clienta (criterio 5). u01 (B1): PA×2 + PB×1 con datos fiscales
select pg_temp.rec('s_pa', jsonb_build_object('v', pg_temp.stock(1)));
select pg_temp.rec('s_pb', jsonb_build_object('v', pg_temp.stock(2)));
select is(public.cancel_order_by_customer(pg_temp.u(2), (pg_temp.g('b1') #>> '{order,id}')::uuid, 'ajeno') ->> 'outcome', 'not_found', 'G4: un pedido AJENO responde «not_found» (no se revela que existe)');
select is((select status from public.orders where id = (pg_temp.g('b1') #>> '{order,id}')::uuid), 'pending_payment', 'G4: …y no cambió');
select pg_temp.rec('g4', public.cancel_order_by_customer(pg_temp.u(1), (pg_temp.g('b1') #>> '{order,id}')::uuid, 'Me equivoqué de talla'));
select is(pg_temp.q('g4', 'ok'), 'true', 'G4: la clienta cancela su pedido pendiente');
select is((select status || '/' || cancelled_by || '/' || cancel_reason from public.orders where id = (pg_temp.g('b1') #>> '{order,id}')::uuid), 'cancelled/customer/Me equivoqué de talla', 'G4: queda «cancelled», por la clienta y con su motivo');
select is(pg_temp.stock(1) - (pg_temp.g('s_pa') ->> 'v')::int, 2, 'G4: el stock de PA se repone (+2)');
select is(pg_temp.stock(2) - (pg_temp.g('s_pb') ->> 'v')::int, 1, 'G4: el stock de PB se repone (+1)');
select is((select count(*)::int from public.stock_movements where ref = pg_temp.q('b1', 'order.number') and reason = 'cancel'), 2, 'G4: dos movimientos de cancelación con el número del pedido');
select is((select sum(delta)::int from public.stock_movements where ref = pg_temp.q('b1', 'order.number')), 0, 'G4: venta + cancelación suman 0 (el libro mayor cuadra)');
select is((select status from public.payments where order_id = (pg_temp.g('b1') #>> '{order,id}')::uuid), 'cancelled', 'G4: el pago queda «cancelled»');
select is((select count(*)::int from public.notification_outbox where dedupe_key in (
    'order_cancelled_by_customer:' || (pg_temp.g('b1') #>> '{order,id}') || ':a', 'order_cancelled:' || (pg_temp.g('b1') #>> '{order,id}') || ':c')), 2, 'G4: aviso a la clienta y al admin');
select pg_temp.snap('g4');
select is(public.cancel_order_by_customer(pg_temp.u(1), (pg_temp.g('b1') #>> '{order,id}')::uuid, null) ->> 'outcome', 'invalid_transition', 'G4: cancelar dos veces no hace nada');
select is(pg_temp.same('g4'), true, 'G4: …ni repone el stock dos veces');
select is(public.transition_order_status((pg_temp.g('b1') #>> '{order,id}')::uuid, 'refunded', null, 'admin') ->> 'ok', 'true', 'G4: cancelado → reembolsado (S12 hará el dinero)');

-- G5: pagado → la clienta aún puede cancelar; preparando → ya no (BR-ORD-02). F1 (u16): oferta del 10 %, uso reservado
select public.transition_order_status((pg_temp.g('f1') #>> '{order,id}')::uuid, 'paid', null, 'admin');
select is((select status from public.discount_redemptions where owner_id = (pg_temp.g('f1') #>> '{order,id}')::uuid), 'applied', 'G5: al pagar, el uso se CONFIRMA (applied)');
select pg_temp.rec('s_pa5', jsonb_build_object('v', pg_temp.stock(1)));
select is(public.cancel_order_by_customer(pg_temp.u(16), (pg_temp.g('f1') #>> '{order,id}')::uuid, null) ->> 'ok', 'true', 'G5: la clienta cancela un pedido PAGADO (antes de «preparing»)');
select is((select status from public.discount_redemptions where owner_id = (pg_temp.g('f1') #>> '{order,id}')::uuid), 'reverted', 'G5: el uso del descuento se devuelve');
select is(pg_temp.stock(1) - (pg_temp.g('s_pa5') ->> 'v')::int, 2, 'G5: el stock se repone (+2)');
select is((select status from public.payments where order_id = (pg_temp.g('f1') #>> '{order,id}')::uuid), 'paid', 'G5: el pago ya cobrado NO se marca cancelado (lo resuelve el reembolso)');
select public.transition_order_status((pg_temp.g('f1') #>> '{order,id}')::uuid, 'refunded', null, 'admin');
select is((select status from public.payments where order_id = (pg_temp.g('f1') #>> '{order,id}')::uuid), 'refunded', 'G5: al reembolsar, el pago pasa a «refunded»');
-- preparando: la clienta ya no puede; el admin sí
select public.transition_order_status((pg_temp.g('f2') #>> '{order,id}')::uuid, 'paid', null, 'admin');
select public.transition_order_status((pg_temp.g('f2') #>> '{order,id}')::uuid, 'preparing', null, 'admin');
select pg_temp.snap('g5');
select is(public.cancel_order_by_customer(pg_temp.u(17), (pg_temp.g('f2') #>> '{order,id}')::uuid, null) ->> 'outcome', 'invalid_transition', 'G5: desde «preparing» la clienta NO cancela');
select is(pg_temp.same('g5'), true, 'G5: …y no pasa nada');
select pg_temp.rec('s_pc', jsonb_build_object('v', pg_temp.stock(3)));
select is(public.transition_order_status((pg_temp.g('f2') #>> '{order,id}')::uuid, 'cancelled', null, 'admin', 'Sin stock real') ->> 'ok', 'true', 'G5: el admin sí cancela un pedido en preparación');
select is(pg_temp.stock(3) - (pg_temp.g('s_pc') ->> 'v')::int, 3, 'G5: el stock de PC se repone (+3)');
select is((select cancelled_by from public.orders where id = (pg_temp.g('f2') #>> '{order,id}')::uuid), 'admin', 'G5: cancelado por el admin');

-- G6: solo vencen los pedidos con VENTANA de pago (QR); WhatsApp y contra entrega no (S-05). u20: PF × 1 = 5,00 + 15,00
select pg_temp.cart(20, 6, 1);
update public.payment_methods set window_minutes = 10 where code = 'whatsapp';
select pg_temp.rec('g6', pg_temp.co(20, 20.00, 'key-g6-0001'));
select is((select payment_expires_at from public.orders where id = (pg_temp.g('g6') #>> '{order,id}')::uuid), now() + interval '10 minutes', 'G6: con ventana de 10 minutos el pedido vence en 10 minutos');
update public.payment_methods set window_minutes = null where code = 'whatsapp';
select is(public.expire_unconfirmed_orders(), 0, 'G6: antes de vencer no se cancela nada');
alter table public.orders disable trigger orders_guard;
update public.orders set payment_expires_at = now() where id = (pg_temp.g('g6') #>> '{order,id}')::uuid;
alter table public.orders enable trigger orders_guard;
select pg_temp.rec('s_pf', jsonb_build_object('v', pg_temp.stock(6)));
select is(public.expire_unconfirmed_orders(), 1, 'G6: vencido el plazo se cancela EXACTAMENTE ese pedido (los de WhatsApp sin ventana no)');
select is((select status || '/' || cancelled_by || '/' || cancel_reason from public.orders where id = (pg_temp.g('g6') #>> '{order,id}')::uuid), 'cancelled/system/expired', 'G6: cancelado por el sistema («expired»)');
select is(pg_temp.stock(6) - (pg_temp.g('s_pf') ->> 'v')::int, 1, 'G6: el stock se repone');
select is(public.expire_unconfirmed_orders(), 0, 'G6: repetirlo no hace nada');

-- G7: recordatorio de pedidos sin confirmar (S-05). El pedido insertado a mano (u20) se envejece 25 h
alter table public.orders disable trigger orders_guard;
update public.orders set created_at = now() - interval '25 hours' where number = 'MIC-900001';
alter table public.orders enable trigger orders_guard;
select is(public.remind_pending_orders(), 1, 'G7: un pedido sin confirmar con más de 24 h → un recordatorio');
select is((select count(*)::int from public.notification_outbox where type = 'order_pending_reminder' and payload ->> 'number' = 'MIC-900001' and recipient is null), 1, 'G7: encolado para los administradores');
select is((select reminder_sent_at is not null from public.orders where number = 'MIC-900001'), true, 'G7: queda anotada la hora del recordatorio');
select is(public.remind_pending_orders(), 0, 'G7: no se repite antes de 24 h');

-- ═══ H. Franjas de entrega (S8 → S10): cupo atómico ═══════════════════════════════════════════
-- u23 reserva la franja de 10:00 (cupo 1); u24 ya no puede; al cancelar u23 el cupo se libera
select pg_temp.cart(23, 2, 1);
select pg_temp.cart(24, 2, 1);
select pg_temp.cart(25, 2, 1);
select pg_temp.rec('h1', pg_temp.co(23, 55.00, 'key-h1-0001', null, 'delivery', 'whatsapp', pg_temp.sl('10:00'), (select d from t_day)));
select is(pg_temp.q('h1', 'outcome'), 'created', 'H1: se crea con franja');
select is(pg_temp.q('h1', 'order.delivery_slot.start') || '-' || pg_temp.q('h1', 'order.delivery_slot.end'), '10:00-12:00', 'H1: la franja queda en la instantánea');
select is((pg_temp.g('h1') #>> '{order,delivery_slot,date}')::date, (select d from t_day), 'H1: …con su fecha');
select is((select count(*)::int from public.delivery_bookings where owner_type = 'order' and owner_id = (pg_temp.g('h1') #>> '{order,id}')::uuid and status = 'active'), 1, 'H1: el cupo quedó reservado a nombre del pedido');
select pg_temp.snap('h2');
select is(pg_temp.co(24, 55.00, 'key-h2-0001', null, 'delivery', 'whatsapp', pg_temp.sl('10:00'), (select d from t_day)) -> 'errors' -> 0 ->> 'code', 'slot_full', 'H2: la franja ya está llena («slot_full»)');
select is(pg_temp.same('h2'), true, 'H2: sin rastro');
select is(pg_temp.co(24, 55.00, 'key-h2-0002', null, 'delivery', 'whatsapp', pg_temp.sl('14:00'), (select d from t_day)) ->> 'outcome', 'created', 'H3: la franja de la tarde (cupo 5) sí');
select is(public.cancel_order_by_customer(pg_temp.u(23), (pg_temp.g('h1') #>> '{order,id}')::uuid, null) ->> 'ok', 'true', 'H4: u23 cancela');
select is((select count(*)::int from public.delivery_bookings where owner_id = (pg_temp.g('h1') #>> '{order,id}')::uuid and status = 'released'), 1, 'H4: el cupo queda LIBERADO');
select is(pg_temp.co(25, 55.00, 'key-h4-0001', null, 'delivery', 'whatsapp', pg_temp.sl('10:00'), (select d from t_day)) ->> 'outcome', 'created', 'H4: y otra clienta puede tomarlo');
select pg_temp.cart(26, 2, 1);
select pg_temp.snap('h5');
select is(pg_temp.co(26, 55.00, 'key-h5-0001', null, 'delivery', 'whatsapp', null, (select d from t_day)) -> 'errors' -> 0 ->> 'code', 'slot_required', 'H5: una fecha sin franja → «slot_required»');
select is(pg_temp.co(26, 55.00, 'key-h5-0002', null, 'delivery', 'whatsapp', pg_temp.sl('14:00'), (select d from t_day) - 10) ->> 'outcome', 'rejected', 'H5: una fecha pasada o sin antelación se rechaza');
select is(pg_temp.co(26, 55.00, 'key-h5-0003', null, 'delivery', 'whatsapp', pg_temp.sl('14:00'), (select d from t_day) + 40) ->> 'outcome', 'rejected', 'H5: una fecha más allá del máximo (30 días) se rechaza');
select is(pg_temp.same('h5'), true, 'H5: sin rastro');

-- ═══ I. Atomicidad: un fallo A MEDIAS no deja nada y el número no se pierde ═══════════════════
-- u27: PB × 2 = 80,00, oferta del 10 % (−8,00) y franja de la tarde; se hace fallar el INSERT de las líneas, cuando ya se
-- reservaron la franja y el uso del descuento y se avanzó el contador.
select pg_temp.flash10();
select pg_temp.cart(27, 2, 2);
create function pg_temp.boom() returns trigger language plpgsql as $$ begin raise exception 'boom' using errcode = 'P0001'; end $$;
create trigger boom_s10 before insert on public.order_items for each row execute function pg_temp.boom();
select pg_temp.snap('i1');
select throws_ok($$select pg_temp.co(27, 87.00, 'key-i1-0001', null, 'delivery', 'whatsapp', pg_temp.sl('14:00'), (select d from t_day))$$, 'P0001', 'boom', 'I1: un fallo en mitad de la creación aborta la operación');
select is(pg_temp.same('i1'), true, 'I1: sin rastro: contador, stock, pedidos, usos de descuento, cupos y movimientos intactos');
select is((select status from public.carts where profile_id = pg_temp.u(27) and status <> 'abandoned' order by created_at desc limit 1), 'active', 'I1: el carrito sigue activo');
drop trigger boom_s10 on public.order_items;
select pg_temp.rec('i2', pg_temp.co(27, 87.00, 'key-i1-0001', null, 'delivery', 'whatsapp', pg_temp.sl('14:00'), (select d from t_day)));
select is(pg_temp.q('i2', 'outcome'), 'created', 'I2: quitado el fallo, el mismo reintento crea el pedido');
select is(pg_temp.q('i2', 'order.number'), 'MIC-' || lpad(((select split_part(v, '|', 1)::bigint from t_s where k = 'i1') + 1)::text, 6, '0'), 'I2: el número es el SIGUIENTE al del intento fallido: sin huecos');
select is((pg_temp.g('i2') #>> '{order,total}')::numeric, 87.00, 'I2: total 80,00 − 8,00 + 15,00 = 87,00');
select pg_temp.wipe();

-- ═══ I3. Un fallo en CUALQUIER paso deshace TODO (también lo reservado antes: franja y usos de descuento) ═══
-- u27 vuelve a tener una bolsa (PB × 2 = 80,00, oferta del 10 % = −8,00, envío 15,00 → 87,00) con la franja de la tarde.
select pg_temp.flash10();
select pg_temp.cart(27, 2, 2);
create function pg_temp.fail_at(p_table text, p_event text) returns void language plpgsql as $$
begin
  execute format('create trigger boom_s10 before %s on public.%I for each row execute function pg_temp.boom()', p_event, p_table);
end $$;
create function pg_temp.heal(p_table text) returns void language plpgsql as $$
begin
  execute format('drop trigger boom_s10 on public.%I', p_table);
end $$;
select pg_temp.snap('i3');
select pg_temp.fail_at('discount_redemptions', 'insert');
select throws_ok($$select pg_temp.co(27, 87.00, 'key-i3-0001', null, 'delivery', 'whatsapp', pg_temp.sl('14:00'), (select d from t_day))$$, 'P0001', 'boom', 'I3: falla al reservar el uso del descuento (la franja YA estaba reservada)');
select pg_temp.heal('discount_redemptions');
select is(pg_temp.same('i3'), true, 'I3: …y la franja reservada antes también se deshizo');
select pg_temp.fail_at('orders', 'insert');
select throws_ok($$select pg_temp.co(27, 87.00, 'key-i3-0001', null, 'delivery', 'whatsapp', pg_temp.sl('14:00'), (select d from t_day))$$, 'P0001', 'boom', 'I3: falla al insertar el pedido (franja y usos ya reservados)');
select pg_temp.heal('orders');
select is(pg_temp.same('i3'), true, 'I3: …nada queda');
select pg_temp.fail_at('stock_movements', 'insert');
select throws_ok($$select pg_temp.co(27, 87.00, 'key-i3-0001', null, 'delivery', 'whatsapp', pg_temp.sl('14:00'), (select d from t_day))$$, 'P0001', 'boom', 'I3: falla al descontar el stock (el pedido y sus líneas ya estaban escritos)');
select pg_temp.heal('stock_movements');
select is(pg_temp.same('i3'), true, 'I3: …nada queda (ni pedido, ni líneas, ni franja, ni usos, ni número)');
select pg_temp.fail_at('stock_reservations', 'update');
select throws_ok($$select pg_temp.co(27, 87.00, 'key-i3-0001', null, 'delivery', 'whatsapp', pg_temp.sl('14:00'), (select d from t_day))$$, 'P0001', 'boom', 'I3: falla al consumir las retenciones del carrito (el stock ya estaba descontado)');
select pg_temp.heal('stock_reservations');
select is(pg_temp.same('i3'), true, 'I3: …el stock descontado se devolvió');
select pg_temp.fail_at('carts', 'update');
select throws_ok($$select pg_temp.co(27, 87.00, 'key-i3-0001', null, 'delivery', 'whatsapp', pg_temp.sl('14:00'), (select d from t_day))$$, 'P0001', 'boom', 'I3: falla al convertir el carrito');
select pg_temp.heal('carts');
select is(pg_temp.same('i3'), true, 'I3: …nada queda');
select pg_temp.fail_at('order_status_history', 'insert');
select throws_ok($$select pg_temp.co(27, 87.00, 'key-i3-0001', null, 'delivery', 'whatsapp', pg_temp.sl('14:00'), (select d from t_day))$$, 'P0001', 'boom', 'I3: falla al escribir el historial (casi al final)');
select pg_temp.heal('order_status_history');
select is(pg_temp.same('i3'), true, 'I3: …nada queda');
select pg_temp.fail_at('payments', 'insert');
select throws_ok($$select pg_temp.co(27, 87.00, 'key-i3-0001', null, 'delivery', 'whatsapp', pg_temp.sl('14:00'), (select d from t_day))$$, 'P0001', 'boom', 'I3: falla al crear el pago (el último paso)');
select pg_temp.heal('payments');
select is(pg_temp.same('i3'), true, 'I3: …nada queda');
select is((select count(*)::int from public.carts where profile_id = pg_temp.u(27) and status = 'active'), 1, 'I3: tras tantos fallos el carrito sigue activo (y es uno solo)');
select is(pg_temp.co(27, 87.00, 'key-i3-0001', null, 'delivery', 'whatsapp', pg_temp.sl('14:00'), (select d from t_day)) ->> 'outcome', 'created', 'I3: sana la causa, el mismo intento crea el pedido');
select pg_temp.wipe();

-- Un fallo de la cola de avisos NO revierte el pedido (ni los de S10 ni la alerta de stock de S3, que corre dentro de la venta)
create function pg_temp.boom_q() returns trigger language plpgsql as $$ begin raise exception 'cola caída' using errcode = 'P0001'; end $$;
create trigger boom_outbox before insert on public.notification_outbox for each row execute function pg_temp.boom_q();
select pg_temp.cart(30, 8, 5);        -- PH × 5 = 50,00 + envío 15,00 = 65,00; el stock baja de 6 a 1 (cruza el umbral crítico: la alerta de stock intentaría encolar)
select pg_temp.rec('i4', pg_temp.co(30, 65.00, 'key-i4-0001'));
drop trigger boom_outbox on public.notification_outbox;
select is(pg_temp.q('i4', 'outcome'), 'created', 'I4: con la cola de avisos CAÍDA el pedido se crea igual');
select is(pg_temp.stock(8), 1, 'I4: …y el stock se descontó');
select is((select count(*)::int from public.notification_outbox where dedupe_key like 'order_%:' || pg_temp.q('i4', 'order.id') || ':%'), 0, 'I4: …sin avisos (la cola falló) pero sin tumbar nada');

-- ═══ I5. Líneas que no cuadran con los totales (dos fotos del carrito): no se guarda un pedido incoherente ═══
-- Se simula con un trigger que cambia el descuento de la línea (final_total sigue cuadrando con su CHECK): la suma de las líneas
-- ya no es la del cálculo. En la vida real solo ocurre si el admin cambia un precio en ese milisegundo.
create function pg_temp.skew() returns trigger language plpgsql as $$
begin new.discount := new.discount + 1; new.final_total := new.final_total - 1; return new; end $$;
select pg_temp.cart(28, 2, 1);
select pg_temp.snap('i5');
create trigger skew_s10 before insert on public.order_items for each row execute function pg_temp.skew();
select is(pg_temp.co(28, 55.00, 'key-i5-0001') -> 'errors' -> 0 ->> 'code', 'stale_prices', 'I5: líneas que no suman el descuento del cálculo → «stale_prices»');
select is(pg_temp.same('i5'), true, 'I5: …y no queda nada (ni pedido, ni stock, ni número)');
drop trigger skew_s10 on public.order_items;
-- …y la otra mitad de la comparación: las líneas suman OTRO subtotal (line_total y final_total +1, que cuadran entre sí)
create function pg_temp.skew2() returns trigger language plpgsql as $$
begin new.line_total := new.line_total + 1; new.final_total := new.final_total + 1; return new; end $$;
create trigger skew_s10 before insert on public.order_items for each row execute function pg_temp.skew2();
select is(pg_temp.co(28, 55.00, 'key-i5-0001') -> 'errors' -> 0 ->> 'code', 'stale_prices', 'I5: líneas que no suman el subtotal del cálculo → «stale_prices»');
select is(pg_temp.same('i5'), true, 'I5: …y tampoco queda nada');
drop trigger skew_s10 on public.order_items;
select is(pg_temp.co(28, 55.00, 'key-i5-0001') ->> 'outcome', 'created', 'I5: sin la incoherencia, el mismo intento crea el pedido');

-- ═══ J. RLS ══════════════════════════════════════════════════════════════════════════════════
-- ana (u01) solo tiene su pedido B1 (reembolsado, con 2 líneas, 3 filas de historial y 1 pago). bia (u02), el suyo (B3).
set local role anon;
select throws_ok($$select * from public.orders$$, '42501', null, 'RLS: anon no lee pedidos');
select throws_ok($$select * from public.order_items$$, '42501', null, 'RLS: anon no lee líneas');
select throws_ok($$select * from public.payments$$, '42501', null, 'RLS: anon no lee pagos');
select throws_ok($$select * from public.order_counters$$, '42501', null, 'RLS: anon no lee el contador');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.orders), 1, 'RLS: ana ve SOLO su pedido (ninguno de las demás clientas)');
select is((select count(*)::int from public.order_items), 2, 'RLS: …sus 2 líneas');
select is((select count(*)::int from public.order_status_history), 3, 'RLS: …su historial (creado, cancelado y reembolsado)');
select is((select count(*)::int from public.payments), 1, 'RLS: …su pago');
select is((select count(*)::int from public.order_counters), 0, 'RLS: un cliente no ve el contador');
select is((select count(*)::int from public.payment_methods), 0, 'RLS: un cliente no lee la configuración de pagos');
select throws_ok($$select cost_unit from public.order_items$$, '42501', null, 'RLS: la clienta NO puede leer el costo del producto (order_items.cost_unit)');
select throws_ok($$select * from public.order_items$$, '42501', null, 'RLS: ni con «select *» (incluiría el costo)');
select is((select sum(qty)::int from public.order_items), 3, 'RLS: …pero sí lo que muestra «Mis pedidos» (cantidades de SUS líneas: 2 + 1)');
select throws_ok($$select reason from public.order_status_history$$, '42501', null, 'RLS: tampoco las notas internas del historial (reason)');
select throws_ok($$select actor_id from public.order_status_history$$, '42501', null, 'RLS: ni quién hizo cada cambio (actor_id)');
select is((select count(*)::int from public.order_status_history where to_status = 'cancelled'), 1, 'RLS: …pero sí los estados y sus fechas');
select throws_ok($$insert into public.orders (number) values ('MIC-000001')$$, '42501', null, 'RLS: un cliente no crea pedidos');
select throws_ok($$update public.orders set total = 1$$, '42501', null, 'RLS: un cliente no edita pedidos');
select throws_ok($$delete from public.orders$$, '42501', null, 'RLS: un cliente no borra pedidos');
select throws_ok($$select public.create_order('a1000000-0000-0000-0000-000000000001', null, null, 'delivery', null, null, 'whatsapp', 'Ana', null, '+59171234567', 1, 'key-j-0001')$$, '42501', null, 'RLS: un cliente no ejecuta create_order directo (solo la función del servidor)');
select throws_ok($$select public.cancel_order_by_customer('a1000000-0000-0000-0000-000000000001', gen_random_uuid(), null)$$, '42501', null, 'RLS: tampoco cancel_order_by_customer');
select throws_ok($$select public.transition_order_status(gen_random_uuid(), 'paid', null, 'admin')$$, '42501', null, 'RLS: tampoco transition_order_status');
select throws_ok($$select public.admin_transition_order(gen_random_uuid(), 'paid')$$, '42501', 'solo administradores', 'RLS: un cliente no avanza pedidos por la vía del admin');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.orders where profile_id = 'a1000000-0000-0000-0000-000000000001'), 0, 'RLS: bia NO ve el pedido de ana');
select is((select count(*)::int from public.orders), 1, 'RLS: bia ve solo el suyo');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ad100000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select is((select count(*)::int from public.orders where profile_id in ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002')), 2, 'RLS: el admin ve los pedidos de todas');
select is((select count(*)::int from public.payment_methods where country = 'BO'), 4, 'RLS: el admin lee la configuración de pagos (WhatsApp, contra entrega y los dos QR de S11)');
select is(public.admin_transition_order((select id from public.orders where profile_id = 'a1000000-0000-0000-0000-000000000003'), 'paid', 'Confirmado por el admin') ->> 'ok', 'true', 'RLS: el admin avanza un pedido con admin_transition_order');
select throws_ok($$select actor_id from public.order_status_history$$, '42501', null, 'RLS: ni el admin lee actor_id desde el navegador (el panel S12 lo leerá por una función de administración)');
reset role;
select is((select actor_kind || '/' || (actor_id = 'ad100000-0000-0000-0000-00000000000d')::text from public.order_status_history
            where order_id = (select id from public.orders where profile_id = 'a1000000-0000-0000-0000-000000000003') and to_status = 'paid'), 'admin/true', 'historial: anota QUÉ admin lo hizo (se lee con el rol del servidor)');

-- ═══ K. Permisos de funciones y de tablas ═══════════════════════════════════════════════════
select is((select count(*)::int from unnest(array[
  'public.checkout_preview(uuid,uuid,uuid,text,uuid,date,text)',
  'public.create_order(uuid,uuid,uuid,text,uuid,date,text,text,text,text,numeric,text)',
  'public.transition_order_status(uuid,text,uuid,text,text)', 'public.cancel_order_by_customer(uuid,uuid,text)']) f
  where has_function_privilege('service_role', f, 'execute') and not has_function_privilege('anon', f, 'execute')
    and not has_function_privilege('authenticated', f, 'execute')), 4, 'permisos: las 4 funciones del servidor las ejecuta SOLO service_role');
select is((select count(*)::int from unnest(array[
  'public._checkout_compute(uuid,uuid,uuid,uuid,text,uuid,date,text,int,boolean)', 'public._next_order_number(text)', 'public._order_json(uuid)',
  'public._order_notify(uuid,text,text,text,jsonb)', 'public._order_transition_ok(text,text,text)', 'public.expire_unconfirmed_orders()',
  'public.remind_pending_orders()']) f
  where has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') or has_function_privilege('service_role', f, 'execute')), 0, 'permisos: las 7 internas no las ejecuta NADIE fuera (ni service_role)');
select is(has_column_privilege('authenticated', 'public.order_items', 'cost_unit', 'select'), false, 'permisos: authenticated NO lee order_items.cost_unit (el costo del negocio)');
select is(has_column_privilege('authenticated', 'public.order_items', 'product_name', 'select'), true, 'permisos: …pero sí el nombre del producto');
select is(has_column_privilege('authenticated', 'public.order_status_history', 'reason', 'select'), false, 'permisos: authenticated NO lee order_status_history.reason');
select is(has_column_privilege('authenticated', 'public.order_status_history', 'to_status', 'select'), true, 'permisos: …pero sí el estado');
select is(has_column_privilege('service_role', 'public.order_items', 'cost_unit', 'select'), true, 'permisos: el servidor sí puede leer el costo (informes de margen, S14)');
select is(has_function_privilege('authenticated', 'public.admin_transition_order(uuid,text,text)', 'execute'), true, 'permisos: authenticated ejecuta admin_transition_order (adentro se exige ser admin)');
select is(has_function_privilege('anon', 'public.admin_transition_order(uuid,text,text)', 'execute'), false, 'permisos: anon no');
select is((select string_agg(t, ', ' order by t) from unnest(array['orders', 'order_items', 'order_status_history', 'payments', 'order_counters']) t
  where has_table_privilege('service_role', 'public.' || t, 'insert') or has_table_privilege('service_role', 'public.' || t, 'update')
     or has_table_privilege('service_role', 'public.' || t, 'delete')), null, 'permisos: service_role no escribe directo en ninguna tabla de pedidos (solo las funciones)');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname in ('orders', 'order_items', 'order_status_history', 'payments', 'order_counters', 'payment_methods')
              and c.relrowsecurity), 6, 'permisos: las 6 tablas nuevas tienen RLS activada');

-- ═══ L. Ajustes y auditoría ═══════════════════════════════════════════════════════════════════
select is((select value #>> '{}' from public.store_settings where key = 'order_reminder_hours'), '24', 'ajustes: «order_reminder_hours» nace en 24');
select throws_ok($$update public.store_settings set value = '0' where key = 'order_reminder_hours'$$, '22023', null, 'ajustes: 0 horas está fuera de rango');
select throws_ok($$update public.store_settings set value = '721' where key = 'order_reminder_hours'$$, '22023', null, 'ajustes: 721 horas está fuera de rango');
select lives_ok($$update public.store_settings set value = '48' where key = 'order_reminder_hours'$$, 'ajustes: 48 horas es válido');
update public.store_settings set value = '24' where key = 'order_reminder_hours';
select is((select count(*)::int from public.audit_log where table_name = 'orders' and action = 'INSERT' and record_id = pg_temp.q('b1', 'order.id')), 1, 'auditoría: la creación del pedido queda registrada');
select is((select count(*)::int from public.audit_log where table_name = 'orders' and record_id = pg_temp.q('b1', 'order.id')
            and (diff::text like '%Ana Pérez%' or diff::text like '%ana.s10@test.com%' or diff::text like '%Calle 1%')), 0, 'auditoría: sin datos personales (nombre, correo, dirección) en el registro');
select is((select count(*)::int from public.audit_log where table_name = 'orders' and action = 'UPDATE' and record_id = pg_temp.q('b1', 'order.id')), 3, 'auditoría: los 3 cambios posteriores quedan registrados (enlace del carrito, cancelación y reembolso)');


select * from finish();
rollback;
