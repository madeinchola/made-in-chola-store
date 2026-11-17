-- Sprint 14 · Fases A y C — Métricas del negocio (definición única de «venta», indicadores por moneda, comparativa, serie sin huecos,
-- rankings, desgloses, mezcla de pagos, sin rotación, inventario, cobertura y embudo) y reportes con filas (ventas, productos,
-- inventario, descuentos, pagos, devoluciones y clientas). Los valores esperados se calcularon A MANO
-- (la cuenta va en el comentario de cada bloque). Todo ocurre en una transacción que se revierte.
--
-- HERMÉTICO: los pedidos de prueba tienen fecha de MARZO DE 2020 (la nube no tiene nada de esa época) y el inventario se mide con todos
-- los demás productos archivados DENTRO de esta transacción; no se asume nada de lo que dejaron otras corridas.
--
-- Fixture (zona La Paz = UTC−4; los importes son de BOB salvo O10 que es USD):
--   productos  PA 100,00 [stock 20, costo 60, «Rojo»] · PB 40,00 [100, costo 15, «Azul»] · PC 33,33 [50, costo 10]
--              PX 50,00 [8, SIN costo] · PS 20,00 [5, costo 20, nunca vendido] · PK [2, costo 40] · PZ [0, SIN costo]
--   clientas   u1 (O1, O2, O5, O10, O11) y u3 (O3, O4): u1 ya había comprado el 27-feb (recurrente), u3 compra por primera vez el 3-mar (nueva)
--   pedidos    O1  02-mar 10:00 delivered   whatsapp  web       PA×2 (100, desc 10 → 190, costo 60) + PB×1 (40)   envío 15  → total 245
--              O2  02-mar 23:30 paid        cash_on_delivery  web   PC×3 (99,99)                                    envío 0   → total 99,99
--              O3  03-mar 00:15 shipped     whatsapp  manual    PA×1 (100) + PX×2 (100, sin costo)  envío 15 con 15 de descuento → 200
--              O4  05-mar 09:00 completed   qr_manual web       PB×4 (160, desc 20 → 140)  envío 15 → 155  · reembolso por productos 30
--                                                               (1 unidad = 35, retención 5) y uno RECHAZADO de 20 (no cuenta)
--              O5  05-mar 18:00 preparing   qr_manual whatsapp  PA×1 (100)  envío 15 → 115 · reembolso de monto libre 10 (solicitado)
--              O6  06-mar       cancelled (pagado y devuelto: 115)        → NO es venta       O7  06-mar refunded → NO es venta
--              O8  07-mar pending_payment                                 → NO es venta       O9  07-mar cancelled sin pagar → NO
--              O10 04-mar 11:00 paid USD (tipo 0,125 USD por BOB)  PB×1 (25)  → total 25 USD = 200 BOB
--              O11 27-feb 12:00 completed PA×1 (100, costo 60)            → período ANTERIOR del rango 1–7 de marzo
--              O14 05-abr completed PA×2 (200) + envío 15 = 215 · reembolso por productos de 1 unidad (100) con el ENVÍO devuelto (15) = 115
--              O16 y O17: mayo de 2020, PA×1 cada uno: el primero SIN costo y el segundo con costo 60 (un producto con ventas con y sin costo)
--              O15: hace 9 días, PB×1 (el primer día de la ventana de la cobertura)
--              O12 y O13: HOY, PA×3 (300) y PB×1 (40): para la cobertura y para que PA/PB no figuren «sin rotación»
begin;
select plan(156);

-- ── Ayudas (viven y mueren con la transacción) ─────────────────────────────────────────────
create function pg_temp.u(n int) returns uuid language sql as $$ select ('a1400000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.pr(n int) returns uuid language sql as $$ select ('b1400000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.va(n int) returns uuid language sql as $$ select ('f1400000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.o(n int) returns uuid language sql as $$ select ('c1400000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.num(n int) returns text language sql as $$ select 'MIC-9140' || lpad(n::text, 2, '0') $$;
create function pg_temp.it(n int, l int) returns uuid language sql as
  $$ select ('e1400000-0000-0000-' || lpad(n::text, 4, '0') || '-0000000000' || lpad(l::text, 2, '0'))::uuid $$;
create temp table t_r (k text primary key, v jsonb);
create function pg_temp.rec(p_k text, p_v jsonb) returns void language sql as
  $$ insert into t_r values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.g(p_k text) returns jsonb language sql as $$ select v from t_r where k = p_k $$;
create function pg_temp.as_(p_uid uuid) returns void language sql as
  $$ select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p_uid), true) $$;
-- Un indicador (campo) de una moneda, del bloque «current» o «previous» de un resumen guardado.
create function pg_temp.k(p_key text, p_cur text, p_block text, p_field text) returns numeric language sql as $$
  select (c -> p_block ->> p_field)::numeric from jsonb_array_elements(pg_temp.g(p_key) -> 'currencies') c where c ->> 'currency' = p_cur $$;
create function pg_temp.kt(p_key text, p_cur text, p_block text, p_field text) returns text language sql as $$
  select c -> p_block ->> p_field from jsonb_array_elements(pg_temp.g(p_key) -> 'currencies') c where c ->> 'currency' = p_cur $$;
-- Un cubo de la serie de una moneda.
create function pg_temp.sr(p_key text, p_cur text, p_bucket text, p_field text) returns text language sql as $$
  select s ->> p_field from jsonb_array_elements(pg_temp.g(p_key) -> 'currencies') c, jsonb_array_elements(c -> 'series') s
   where c ->> 'currency' = p_cur and s ->> 'bucket' = p_bucket $$;

create function pg_temp.srn(p_key text, p_cur text, p_bucket text, p_field text) returns numeric language sql as $$
  select pg_temp.sr(p_key, p_cur, p_bucket, p_field)::numeric $$;
-- Dinero con 2 decimales siempre (el texto de un numeric depende de su escala).
create function pg_temp.m(p_x numeric) returns text language sql as $$ select round(p_x, 2)::text $$;

-- Producto activo con una variante: precio, stock y costo (NULL = sin costo registrado).
create function pg_temp.mk(p_n int, p_price numeric, p_stock int, p_cost numeric, p_color text) returns void language plpgsql as $$
declare
  v_pp text := lpad(p_n::text, 2, '0');
  v_p uuid := pg_temp.pr(p_n);
  v_c uuid := ('d1400000-0000-0000-0000-0000000000' || v_pp)::uuid;
  v_s uuid := ('e2400000-0000-0000-0000-0000000000' || v_pp)::uuid;
begin
  insert into public.products (id, code, slug, name) values (v_p, 'S14-' || v_pp, 's14-' || v_pp, 'Producto S14 ' || v_pp);
  insert into public.product_colors (id, product_id, name) values (v_c, v_p, p_color);
  insert into public.product_prices (product_id, currency, amount) values (v_p, 'BOB', p_price);
  insert into public.product_sizes (id, product_id, label) values (v_s, v_p, 'M');
  insert into public.product_variants (id, product_id, color_id, size_id) values (pg_temp.va(p_n), v_p, v_c, v_s);
  if p_stock > 0 then
    perform public.apply_stock_change(pg_temp.va(p_n), p_stock, 'import', 'carga inicial S14');
  end if;
  update public.products set status = 'active', cost_base = p_cost where id = v_p;
end $$;

-- Un pedido insertado directo. p_lines = [{v: n del producto, qty, price, disc, cost, color}]. NO mueve stock (el inventario se prueba
-- aparte). Con pago «pagado» por el total, que es lo que permite registrar reembolsos.
create function pg_temp.mko(p_n int, p_status text, p_currency text, p_rate numeric, p_created timestamptz, p_paid timestamptz,
                            p_ship numeric, p_ship_disc numeric, p_method text, p_channel text, p_lines jsonb, p_u int default 1) returns void
language plpgsql as $$
declare
  l jsonb;
  i int := 0;
  v_sub numeric := 0;
  v_dis numeric := 0;
  v_tot numeric;
begin
  for l in select value from jsonb_array_elements(p_lines) loop
    v_sub := v_sub + (l ->> 'price')::numeric * (l ->> 'qty')::int;
    v_dis := v_dis + coalesce((l ->> 'disc')::numeric, 0);
  end loop;
  v_tot := v_sub - v_dis + p_ship - p_ship_disc;
  insert into public.orders select * from jsonb_populate_record(null::public.orders, jsonb_build_object(
    'id', pg_temp.o(p_n), 'number', pg_temp.num(p_n), 'profile_id', pg_temp.u(p_u), 'status', p_status,
    'currency', p_currency, 'base_currency', 'BOB', 'exchange_rate', p_rate, 'country', 'BO', 'subtotal', v_sub, 'discount_total', v_dis,
    'shipping_cost', p_ship, 'shipping_discount', p_ship_disc, 'total', v_tot, 'tax_included', true,
    'contact_name', case p_u when 1 then 'Clienta Uno' else 'Clienta Tres' end, 'contact_email', 'u0' || p_u || '.s14@test.com',
    'contact_phone', '+5917000000' || p_u,
    'shipping_method', jsonb_build_object('code', 'delivery', 'name', 'A domicilio', 'kind', 'delivery'),
    'payment_method', p_method, 'payment_provider', 'whatsapp', 'discounts', '[]'::jsonb, 'idempotency_key', 'key-s14-' || p_n,
    'channel', p_channel, 'edit_count', 0, 'created_at', p_created, 'updated_at', p_created, 'paid_at', p_paid,
    'cancelled_at', case when p_status = 'cancelled' then p_created end, 'cancelled_by', case when p_status = 'cancelled' then 'admin' end));
  for l in select value from jsonb_array_elements(p_lines) loop
    i := i + 1;
    insert into public.order_items (id, order_id, line_no, variant_id, product_id, product_name, color_name, size_label, qty,
                                    unit_price, line_total, discount, final_total, cost_unit)
    values (pg_temp.it(p_n, i), pg_temp.o(p_n), i, pg_temp.va((l ->> 'v')::int), pg_temp.pr((l ->> 'v')::int),
            'Producto S14 ' || lpad((l ->> 'v'), 2, '0'), l ->> 'color', 'M', (l ->> 'qty')::int, (l ->> 'price')::numeric,
            (l ->> 'price')::numeric * (l ->> 'qty')::int, coalesce((l ->> 'disc')::numeric, 0),
            (l ->> 'price')::numeric * (l ->> 'qty')::int - coalesce((l ->> 'disc')::numeric, 0), (l ->> 'cost')::numeric);
  end loop;
  insert into public.payments (order_id, provider, method, status, amount, currency, paid_at, created_at)
  values (pg_temp.o(p_n), 'whatsapp', p_method, case when p_paid is not null then 'paid' else 'pending' end, v_tot, p_currency, p_paid,
          p_created);
end $$;

-- ── Datos ───────────────────────────────────────────────────────────────────────────────────
-- Inventario hermético: todo lo demás, archivado dentro de esta transacción (nada de lo que dejaron otras corridas cuenta).
update public.products set archived_at = now() where archived_at is null;
update public.store_settings set value = 'false' where key = 'reserve_on_add_to_cart';

insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (pg_temp.u(1), 'u01.s14@test.com', '{"full_name":"Clienta Uno S14"}', 'authenticated', 'authenticated'),
         (pg_temp.u(2), 'admin1.s14@test.com', '{"full_name":"Admin Uno S14"}', 'authenticated', 'authenticated'),
         (pg_temp.u(3), 'u03.s14@test.com', '{"full_name":"Clienta Tres S14"}', 'authenticated', 'authenticated');
update public.profiles set phone_e164 = '+59170000001' where id = pg_temp.u(1);
update public.profiles set phone_e164 = '+59170000003', created_at = '2020-03-03 09:00-04' where id = pg_temp.u(3);
update public.profiles set created_at = '2020-03-04 09:00-04' where id = pg_temp.u(2);   -- el administrador: no es una cuenta de clienta
select public.set_user_role(pg_temp.u(2), 'admin');

select pg_temp.mk(1, 100.00, 20, 60, 'Rojo');    -- PA
select pg_temp.mk(2, 40.00, 100, 15, 'Azul');    -- PB
select pg_temp.mk(3, 33.33, 50, 10, 'Único');    -- PC
select pg_temp.mk(4, 50.00, 8, null, 'Único');   -- PX: sin costo
select pg_temp.mk(5, 20.00, 5, 20, 'Único');     -- PS: nunca vendido, stock en el umbral «bajo»
select pg_temp.mk(6, 20.00, 2, 40, 'Único');     -- PK: crítico
select pg_temp.mk(7, 20.00, 0, null, 'Único');   -- PZ: agotado y SIN costo (sin stock no hay nada que valorar: no cuenta como «sin costo»)

-- Una categoría y una colección con PA y PB
insert into public.categories (id, name, slug) values ('ca140000-0000-0000-0000-000000000001', 'Categoría S14', 'cat-s14');
insert into public.product_categories (product_id, category_id) values
  (pg_temp.pr(1), 'ca140000-0000-0000-0000-000000000001'), (pg_temp.pr(2), 'ca140000-0000-0000-0000-000000000001');
insert into public.collections (id, name, slug) values ('c0140000-0000-0000-0000-000000000001', 'Colección S14', 'col-s14');
insert into public.product_collections (product_id, collection_id) values (pg_temp.pr(1), 'c0140000-0000-0000-0000-000000000001');

select pg_temp.mko(1, 'delivered', 'BOB', 1, '2020-03-02 09:00-04', '2020-03-02 10:00-04', 15, 0, 'whatsapp', 'web',
  '[{"v":1,"qty":2,"price":100,"disc":10,"cost":60,"color":"Rojo"},{"v":2,"qty":1,"price":40,"cost":15,"color":"Azul"}]');
select pg_temp.mko(2, 'paid', 'BOB', 1, '2020-03-02 22:00-04', '2020-03-02 23:30-04', 0, 0, 'cash_on_delivery', 'web',
  '[{"v":3,"qty":3,"price":33.33,"cost":10,"color":"Único"}]');
select pg_temp.mko(3, 'shipped', 'BOB', 1, '2020-03-03 00:10-04', '2020-03-03 00:15-04', 15, 15, 'whatsapp', 'manual',
  '[{"v":1,"qty":1,"price":100,"cost":60,"color":"Rojo"},{"v":4,"qty":2,"price":50,"color":"Único"}]', 3);
select pg_temp.mko(4, 'completed', 'BOB', 1, '2020-03-05 08:00-04', '2020-03-05 09:00-04', 15, 0, 'qr_manual', 'web',
  '[{"v":2,"qty":4,"price":40,"disc":20,"cost":15,"color":"Azul"}]', 3);
select pg_temp.mko(5, 'preparing', 'BOB', 1, '2020-03-05 17:00-04', '2020-03-05 18:00-04', 15, 0, 'qr_manual', 'whatsapp',
  '[{"v":1,"qty":1,"price":100,"cost":60,"color":"Rojo"}]');
select pg_temp.mko(6, 'cancelled', 'BOB', 1, '2020-03-06 10:00-04', '2020-03-06 11:00-04', 15, 0, 'qr_manual', 'web',
  '[{"v":1,"qty":1,"price":100,"cost":60,"color":"Rojo"}]');
select pg_temp.mko(7, 'refunded', 'BOB', 1, '2020-03-06 13:00-04', '2020-03-06 14:00-04', 0, 0, 'whatsapp', 'web',
  '[{"v":2,"qty":1,"price":40,"cost":15,"color":"Azul"}]');
select pg_temp.mko(8, 'pending_payment', 'BOB', 1, '2020-03-07 09:00-04', null, 0, 0, 'qr_manual', 'web',
  '[{"v":2,"qty":1,"price":40,"cost":15,"color":"Azul"}]');
select pg_temp.mko(9, 'cancelled', 'BOB', 1, '2020-03-07 10:00-04', null, 0, 0, 'qr_manual', 'web',
  '[{"v":2,"qty":1,"price":40,"cost":15,"color":"Azul"}]');
select pg_temp.mko(10, 'paid', 'USD', 0.125, '2020-03-04 10:30-04', '2020-03-04 11:00-04', 0, 0, 'whatsapp', 'web',
  '[{"v":2,"qty":1,"price":25,"cost":5,"color":"Azul"}]');
select pg_temp.mko(11, 'completed', 'BOB', 1, '2020-02-27 11:00-04', '2020-02-27 12:00-04', 0, 0, 'whatsapp', 'web',
  '[{"v":1,"qty":1,"price":100,"cost":60,"color":"Rojo"}]');
select pg_temp.mko(12, 'paid', 'BOB', 1, now() - interval '1 hour', now() - interval '1 hour', 0, 0, 'whatsapp', 'web',
  '[{"v":1,"qty":3,"price":100,"cost":60,"color":"Rojo"}]');
select pg_temp.mko(13, 'paid', 'BOB', 1, now() - interval '1 hour', now() - interval '1 hour', 0, 0, 'whatsapp', 'web',
  '[{"v":2,"qty":1,"price":40,"cost":15,"color":"Azul"}]');

-- O15: una venta de PB de hace EXACTAMENTE 9 días (La Paz): es el primer día de la ventana de 10 días de la cobertura.
select pg_temp.mko(15, 'paid', 'BOB', 1, now() - interval '9 days', now() - interval '9 days', 0, 0, 'whatsapp', 'web',
  '[{"v":2,"qty":1,"price":40,"cost":15,"color":"Azul"}]');

-- O16 y O17 (mayo): el MISMO producto vendido una vez sin costo registrado y otra con costo.
select pg_temp.mko(16, 'paid', 'BOB', 1, '2020-05-05 09:00-04', '2020-05-05 10:00-04', 0, 0, 'whatsapp', 'web',
  '[{"v":1,"qty":1,"price":100,"color":"Rojo"}]');
select pg_temp.mko(17, 'paid', 'BOB', 1, '2020-05-06 09:00-04', '2020-05-06 10:00-04', 0, 0, 'whatsapp', 'web',
  '[{"v":1,"qty":1,"price":100,"cost":60,"color":"Rojo"}]');

-- O14 (abril): 2 unidades de PA con envío; después se devuelve 1 unidad y el envío.
select pg_temp.mko(14, 'completed', 'BOB', 1, '2020-04-05 09:00-04', '2020-04-05 10:00-04', 15, 0, 'whatsapp', 'web',
  '[{"v":1,"qty":2,"price":100,"cost":60,"color":"Rojo"}]');

-- Reembolsos (el libro de S12): O4 por productos (1 unidad de 35, retención 5 → 30) y uno rechazado de 20; O5 de monto libre (10,
-- solicitado); O6 por cancelación (115) en un pedido que ya NO es venta.
insert into public.refunds (id, order_id, payment_id, kind, amount, shipping_amount, deduction, currency, reason, status, method,
                            idempotency_key, processed_at, created_at)
select 'a0140000-0000-0000-0000-000000000001', pg_temp.o(4), p.id, 'items', 30, 0, 5, 'BOB', 'devolución de una prenda', 'processed',
       'cash', 'rf-s14-items-0001', now(), '2020-03-05 12:00-04' from public.payments p where p.order_id = pg_temp.o(4);
insert into public.refund_items (refund_id, order_item_id, qty, amount)
values ('a0140000-0000-0000-0000-000000000001', pg_temp.it(4, 1), 1, 35);
insert into public.refunds (id, order_id, payment_id, kind, amount, shipping_amount, deduction, currency, reason, status, method,
                            idempotency_key, created_at)
select 'a0140000-0000-0000-0000-000000000002', pg_temp.o(4), p.id, 'amount', 20, 0, 0, 'BOB', 'pedido rechazado', 'requested',
       'cash', 'rf-s14-rejected-02', '2020-03-05 13:00-04' from public.payments p where p.order_id = pg_temp.o(4);
update public.refunds set status = 'rejected', decision_note = 'no procede' where id = 'a0140000-0000-0000-0000-000000000002';
insert into public.refunds (id, order_id, payment_id, kind, amount, shipping_amount, deduction, currency, reason, status, method,
                            idempotency_key, created_at)
select 'a0140000-0000-0000-0000-000000000003', pg_temp.o(5), p.id, 'amount', 10, 0, 0, 'BOB', 'cortesía por demora', 'requested',
       'cash', 'rf-s14-amount-003', '2020-03-05 19:00-04' from public.payments p where p.order_id = pg_temp.o(5);
insert into public.refunds (id, order_id, payment_id, kind, amount, shipping_amount, deduction, currency, reason, status, method,
                            idempotency_key, processed_at, created_at)
select 'a0140000-0000-0000-0000-000000000004', pg_temp.o(6), p.id, 'cancel', 115, 15, 0, 'BOB', 'cancelado y devuelto', 'processed',
       'cash', 'rf-s14-cancel-004', now(), '2020-03-06 12:00-04' from public.payments p where p.order_id = pg_temp.o(6);

-- Un descuento con 4 canjes: dos aplicados (O1: 10, O4: 20), uno reservado (O8: 5) y uno revertido (O6: 99, no cuenta).
insert into public.discounts (id, name, kind, params, scope, currency, requires_coupon)
values ('d1140000-0000-0000-0000-000000000001', 'Descuento S14', 'percent', '{"percent": 10}', 'order', 'BOB', true);
insert into public.discount_redemptions (discount_id, profile_id, owner_type, owner_id, amount, currency, status, created_at) values
  ('d1140000-0000-0000-0000-000000000001', pg_temp.u(1), 'order', pg_temp.o(1), 10, 'BOB', 'applied', '2020-03-02 10:00-04'),
  ('d1140000-0000-0000-0000-000000000001', pg_temp.u(3), 'order', pg_temp.o(4), 20, 'BOB', 'applied', '2020-03-05 09:00-04'),
  ('d1140000-0000-0000-0000-000000000001', pg_temp.u(1), 'order', pg_temp.o(8), 5, 'BOB', 'reserved', '2020-03-07 09:00-04'),
  ('d1140000-0000-0000-0000-000000000001', pg_temp.u(1), 'order', pg_temp.o(6), 99, 'BOB', 'reverted', '2020-03-06 10:00-04');
-- Un segundo descuento cuyo ÚNICO canje del período fue revertido: no debe aparecer en el reporte.
insert into public.discounts (id, name, kind, params, scope, currency, requires_coupon)
values ('d1140000-0000-0000-0000-000000000002', 'Descuento revertido S14', 'percent', '{"percent": 5}', 'order', 'BOB', true);
insert into public.discount_redemptions (discount_id, profile_id, owner_type, owner_id, amount, currency, status, created_at)
values ('d1140000-0000-0000-0000-000000000002', pg_temp.u(1), 'order', pg_temp.o(7), 5, 'BOB', 'reverted', '2020-03-03 09:00-04');
-- Una devolución de productos abierta el 6-mar sobre O4.
insert into public.order_returns (order_id, status, reason, opened_at) values (pg_temp.o(4), 'open', 'la talla no era', '2020-03-06 10:00-04');

insert into public.refunds (id, order_id, payment_id, kind, amount, shipping_amount, deduction, currency, reason, status, method,
                            idempotency_key, processed_at, created_at)
select 'a0140000-0000-0000-0000-000000000005', pg_temp.o(14), p.id, 'items', 115, 15, 0, 'BOB', 'devolución de una prenda y su envío', 'processed',
       'cash', 'rf-s14-ship-00005', now(), '2020-04-06 10:00-04' from public.payments p where p.order_id = pg_temp.o(14);
insert into public.refund_items (refund_id, order_item_id, qty, amount)
values ('a0140000-0000-0000-0000-000000000005', pg_temp.it(14, 1), 1, 100);

-- Incidencias: O1 asume la tienda 12 (5-mar); la misma fecha pero la asume la clienta (8: no cuenta); O2 asume la tienda 7 (20-mar).
insert into public.order_incidents (order_id, type, status, cost_assumed, cost_borne_by, opened_at) values
  (pg_temp.o(1), 'rejected', 'open', 12.00, 'store', '2020-03-05 10:00-04'),
  (pg_temp.o(1), 'absent', 'open', 8.00, 'customer', '2020-03-05 11:00-04'),
  (pg_temp.o(2), 'lost', 'open', 7.00, 'store', '2020-03-20 10:00-04');

-- Carritos de marzo de 2020 (embudo): tres, dos con productos.
insert into public.carts (id, currency, status, token_hash, created_at) values
  ('ca000000-0000-0000-0000-000000000141', 'BOB', 'converted', encode(sha256('s14-1'::bytea), 'hex'), '2020-03-02 10:00-04'),
  ('ca000000-0000-0000-0000-000000000142', 'BOB', 'abandoned', encode(sha256('s14-2'::bytea), 'hex'), '2020-03-03 10:00-04'),
  ('ca000000-0000-0000-0000-000000000143', 'BOB', 'abandoned', encode(sha256('s14-3'::bytea), 'hex'), '2020-03-04 10:00-04');
insert into public.cart_items (cart_id, variant_id, qty, unit_price_at_add, currency, price_locked_until) values
  ('ca000000-0000-0000-0000-000000000141', pg_temp.va(1), 1, 100, 'BOB', now()),
  ('ca000000-0000-0000-0000-000000000142', pg_temp.va(2), 2, 40, 'BOB', now());

create temp table t_snap as
select (select count(*) from public.orders) as orders, (select count(*) from public.refunds) as refunds,
       (select count(*) from public.order_items) as items, (select count(*) from public.product_variants) as variants,
       (select coalesce(sum(stock_on_hand), 0) from public.product_variants) as stock;

-- ═══ A. Estructura y permisos ══════════════════════════════════════════════════════════════
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('admin_sales_summary', 'admin_top_products', 'admin_sales_breakdown',
              'admin_slow_movers', 'admin_inventory_summary', 'admin_inventory_coverage', 'admin_funnel', 'admin_payment_mix')
              and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
              and not has_function_privilege('service_role', p.oid, 'execute')), 8,
          'A1: las 8 funciones de métricas las ejecuta authenticated (y adentro exigen ser admin), no anon ni service_role');
select is((select coalesce(string_agg(p.proname, ','), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_report_bounds', '_sales_orders', '_sales_lines', '_sales_kpis')
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                   or has_function_privilege('service_role', p.oid, 'execute'))), '',
          'A2: las funciones internas (la definición de «venta») no las ejecuta nadie desde la API');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('admin_report_sales', 'admin_report_products', 'admin_report_inventory',
              'admin_report_discounts', 'admin_report_payments', 'admin_report_returns', 'admin_report_customers', 'admin_customers_summary')
              and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
              and not has_function_privilege('service_role', p.oid, 'execute')), 8,
          'A4: los 8 reportes los ejecuta authenticated (y adentro exigen ser admin), no anon ni service_role');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = '_report_page'
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                   or has_function_privilege('service_role', p.oid, 'execute'))), 0, 'A5: la validación de página no se llama desde la API');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'orders_sold_at_idx'),
          'A3: las ventas por fecha tienen su índice (no recorren todos los pedidos)');

-- ═══ B. Solo administradores ═══════════════════════════════════════════════════════════════
select pg_temp.as_(pg_temp.u(1));
set local role authenticated;
select throws_ok($$select public.admin_sales_summary('2020-03-01', '2020-03-07')$$, '42501', null, 'B1: una clienta no ve el resumen de ventas');
select throws_ok($$select * from public.admin_top_products('2020-03-01', '2020-03-07')$$, '42501', null, 'B2: ni los más vendidos');
select throws_ok($$select * from public.admin_sales_breakdown('2020-03-01', '2020-03-07', 'channel')$$, '42501', null, 'B3: ni el desglose');
select throws_ok($$select * from public.admin_slow_movers()$$, '42501', null, 'B4: ni lo que no rota');
select throws_ok($$select public.admin_inventory_summary()$$, '42501', null, 'B5: ni el valor del inventario');
select throws_ok($$select * from public.admin_inventory_coverage()$$, '42501', null, 'B6: ni la cobertura');
select throws_ok($$select public.admin_funnel('2020-03-01', '2020-03-07')$$, '42501', null, 'B7: ni el embudo');
select throws_ok($$select * from public.admin_payment_mix('2020-03-01', '2020-03-07')$$, '42501', null, 'B8: ni la mezcla de pagos');
select throws_ok($$select * from public._sales_orders('2020-03-01', '2020-03-08')$$, '42501', null, 'B9: la definición interna de venta no se llama desde la API');
select throws_ok($$select * from public.admin_report_sales('2020-03-01', '2020-03-07')$$, '42501', null, 'B11: una clienta no ve el reporte de ventas…');
select throws_ok($$select * from public.admin_report_customers('2020-03-01', '2020-03-07')$$, '42501', null, 'B11: …ni el de clientas (datos personales)');
select throws_ok($$select * from public.admin_report_payments('2020-03-01', '2020-03-07')$$, '42501', null, 'B11: …ni el de pagos');
select throws_ok($$select * from public.admin_report_inventory()$$, '42501', null, 'B11: …ni el de inventario');
select throws_ok($$select public.admin_customers_summary('2020-03-01', '2020-03-07')$$, '42501', null, 'B11: …ni el resumen de clientas');
reset role;
set local role anon;
select throws_ok($$select public.admin_sales_summary('2020-03-01', '2020-03-07')$$, '42501', null, 'B10: anon no ejecuta nada de esto');
reset role;
select pg_temp.as_(pg_temp.u(2));

-- ═══ C. Rangos y parámetros inválidos ══════════════════════════════════════════════════════
set local role authenticated;
select throws_ok($$select public.admin_sales_summary('2020-03-08', '2020-03-01')$$, '22023', 'invalid_range', 'C1: «desde» posterior a «hasta» se rechaza');
select throws_ok($$select public.admin_sales_summary(null, '2020-03-01')$$, '22023', 'invalid_range', 'C2: sin fecha de inicio se rechaza');
select throws_ok($$select public.admin_sales_summary('2020-03-01', null)$$, '22023', 'invalid_range', 'C3: sin fecha de fin se rechaza');
select lives_ok($$select public.admin_sales_summary('2018-03-01', '2020-02-29')$$, 'C4: 731 días justos se aceptan');
select throws_ok($$select public.admin_sales_summary('2018-03-01', '2020-03-01')$$, '22023', 'invalid_range', 'C5: 732 días ya no (un rango sin tope pondría de rodillas a la base)');
select throws_ok($$select public.admin_sales_summary('2020-03-01', '2020-03-07', 'hour')$$, '22023', 'invalid_granularity', 'C6: solo día, semana o mes');
select throws_ok($$select * from public.admin_top_products('2020-03-01', '2020-03-07', null, 'margin')$$, '22023', 'invalid_parameters', 'C7: ordenar solo por unidades o ingresos');
select throws_ok($$select * from public.admin_top_products('2020-03-01', '2020-03-07', null, 'units', 'up')$$, '22023', 'invalid_parameters', 'C8: dirección asc o desc');
select throws_ok($$select * from public.admin_top_products('2020-03-01', '2020-03-07', null, 'units', 'desc', 0)$$, '22023', 'invalid_parameters', 'C9: el límite es de 1 a 200');
select throws_ok($$select * from public.admin_sales_breakdown('2020-03-01', '2020-03-07', 'color')$$, '22023', 'invalid_parameters', 'C10: solo las dimensiones conocidas');
select throws_ok($$select * from public.admin_slow_movers(0)$$, '22023', 'invalid_parameters', 'C11: «sin rotación» de 0 días no tiene sentido');
select throws_ok($$select * from public.admin_inventory_coverage(400)$$, '22023', 'invalid_parameters', 'C12: la cobertura mira hasta 365 días');
select throws_ok($$select * from public.admin_report_sales('2020-03-01', '2020-03-07', null, 0, 0)$$, '22023', 'invalid_parameters', 'C13: una página de 0 filas no tiene sentido');
select throws_ok($$select * from public.admin_report_sales('2020-03-01', '2020-03-07', null, 0, 5001)$$, '22023', 'invalid_parameters', 'C14: ni de más de 5000 (la base corta a los 8 s)');
select throws_ok($$select * from public.admin_report_sales('2020-03-01', '2020-03-07', null, -1, 10)$$, '22023', 'invalid_parameters', 'C15: ni un desplazamiento negativo');
select throws_ok($$select * from public.admin_report_inventory(0, 0)$$, '22023', 'invalid_parameters', 'C16: lo mismo en el inventario');
select throws_ok($$select * from public.admin_report_returns('2020-03-08', '2020-03-01')$$, '22023', 'invalid_range', 'C17: el rango inválido se rechaza en todos los reportes');
reset role;

-- ═══ D. Resumen del 1 al 7 de marzo de 2020 ════════════════════════════════════════════════
-- BOB (O1–O5 son ventas): pedidos 5 · unidades 3+3+3+4+1 = 14 · bruto 245 + 99,99 + 200 + 155 + 115 = 814,99
--   descuentos 10 + 0 + 0 + 20 + 0 = 30 · envío cobrado 15 + 0 + (15−15) + 15 + 15 = 45 · reembolsos 30 + 10 = 40 (el rechazado de 20
--   y el de la cancelación NO cuentan) · neto 774,99 · ticket 774,99 / 5 = 154,998
--   ingreso de productos: O1 230 · O2 99,99 · O3 200 · O4 140 − 30 = 110 · O5 100 − 10 = 90 → 729,99
--   margen (solo O1, O2, O4, O5, que tienen costo en todas sus líneas): O1 230 − 135 = 95 · O2 99,99 − 30 = 69,99 ·
--   O4 110 − 3×15 = 65 · O5 90 − 60 = 30 → 259,99 sobre un ingreso de 529,99 = 49,1 % · 4 de 5 pedidos con costo = 80,0 %
--   incidencias de la tienda en el rango: 12 → utilidad 259,99 − 12 = 247,99
-- La llamada positiva, como administrador autenticado de verdad (no como superusuario): la regla de permisos funciona de punta a punta.
set local role authenticated;
select is(public.admin_sales_summary('2020-03-01', '2020-03-07') #>> '{currencies,0,current,orders}', '5',
          'D0: un administrador autenticado obtiene el resumen por la API (5 pedidos de BOB)');
reset role;
select pg_temp.rec('s1', public.admin_sales_summary('2020-03-01', '2020-03-07'));
select is(pg_temp.g('s1') #>> '{range,days}', '7', 'D1: el rango dura 7 días');
select is(pg_temp.g('s1') #>> '{range,timezone}', 'America/La_Paz', 'D2: y está en la zona America/La_Paz');
select is((pg_temp.g('s1') #>> '{previous,from}') || '→' || (pg_temp.g('s1') #>> '{previous,to}'), '2020-02-23→2020-02-29', 'D3: el período anterior es el mismo largo, justo antes');
select is(pg_temp.k('s1', 'BOB', 'current', 'orders'), 5::numeric, 'D4: 5 pedidos vendidos (no cuentan cancelados, reembolsados ni pendientes)');
select is(pg_temp.k('s1', 'BOB', 'current', 'units'), 14::numeric, 'D5: 14 unidades');
select is(pg_temp.k('s1', 'BOB', 'current', 'gross'), 814.99::numeric, 'D6: ventas brutas 814,99');
select is(pg_temp.k('s1', 'BOB', 'current', 'discounts'), 30::numeric, 'D7: descuentos 30');
select is(pg_temp.k('s1', 'BOB', 'current', 'shipping'), 45::numeric, 'D8: envío cobrado 45 (el envío gratis de O3 resta su descuento)');
select is(pg_temp.k('s1', 'BOB', 'current', 'refunds'), 40::numeric, 'D9: reembolsos 40 (ni el rechazado ni el de un pedido cancelado)');
select is(pg_temp.k('s1', 'BOB', 'current', 'net'), 774.99::numeric, 'D10: ventas netas 774,99');
select is(round(pg_temp.k('s1', 'BOB', 'current', 'avg_ticket'), 3), 154.998::numeric, 'D11: ticket promedio 154,998 (neto entre pedidos)');
select is(pg_temp.k('s1', 'BOB', 'current', 'product_revenue'), 729.99::numeric, 'D12: ingreso de productos 729,99 (lo devuelto por productos o monto libre lo baja, el envío no)');
select is(pg_temp.k('s1', 'BOB', 'current', 'margin_revenue'), 529.99::numeric, 'D13: el margen se calcula sobre el ingreso de los pedidos CON costo (529,99)…');
select is(pg_temp.k('s1', 'BOB', 'current', 'margin'), 259.99::numeric, 'D14: margen 259,99');
select is(pg_temp.k('s1', 'BOB', 'current', 'margin_pct'), 49.1::numeric, 'D15: margen 49,1 %');
select is(pg_temp.k('s1', 'BOB', 'current', 'costed_orders'), 4::numeric, 'D16: …porque O3 tiene una línea sin costo y su margen es DESCONOCIDO (nunca 100 % falso)');
select is(pg_temp.k('s1', 'BOB', 'current', 'cost_coverage_pct'), 80.0::numeric, 'D17: cobertura de costos 80 %');
select is(pg_temp.k('s1', 'BOB', 'current', 'incident_cost'), 12::numeric, 'D18: incidencias asumidas por la tienda 12 (la que asume la clienta y la de otra fecha no)');
select is(pg_temp.k('s1', 'BOB', 'current', 'profit'), 247.99::numeric, 'D19: utilidad 247,99');
-- USD: moneda aparte, jamás sumada con BOB
select is(pg_temp.k('s1', 'USD', 'current', 'orders'), 1::numeric, 'D20: el pedido en USD va en su propia moneda');
select is(pg_temp.m(pg_temp.k('s1', 'USD', 'current', 'gross')) || '/' || pg_temp.m(pg_temp.k('s1', 'USD', 'current', 'net')), '25.00/25.00', 'D21: 25 USD (no se mezcla con los 814,99 BOB)');
select ok(pg_temp.kt('s1', 'USD', 'current', 'margin') is null and pg_temp.kt('s1', 'USD', 'current', 'profit') is null,
          'D22: y su margen y utilidad son desconocidos (el costo está en la moneda base: no se mezcla)');
select is((select jsonb_agg(c ->> 'currency' order by c ->> 'currency') from jsonb_array_elements(pg_temp.g('s1') -> 'currencies') c),
          '["BOB", "USD"]'::jsonb, 'D23: solo las monedas que tuvieron movimiento');
-- Período anterior: O11 (27-feb): 1 pedido de 100, margen 100 − 60 = 40 (40,0 %)
select is(pg_temp.k('s1', 'BOB', 'previous', 'orders')::int || '/' || pg_temp.m(pg_temp.k('s1', 'BOB', 'previous', 'net')), '1/100.00', 'D24: el período anterior (23–29 de febrero) tuvo 1 pedido de 100');
select is(pg_temp.m(pg_temp.k('s1', 'BOB', 'previous', 'margin')) || '/' || pg_temp.k('s1', 'BOB', 'previous', 'margin_pct'), '40.00/40.0', 'D25: con margen 40 (40,0 %)');
select is(pg_temp.g('s1') #> '{currencies,1,previous}', '{}'::jsonb, 'D26: una moneda sin movimiento anterior trae su comparativa vacía');
-- Consolidado a la moneda base (USD 25 con tipo 0,125 USD por BOB = 200 BOB): 6 pedidos, bruto 814,99 + 200, neto 774,99 + 200
select is(pg_temp.g('s1') #>> '{consolidated,currency}', 'BOB', 'D27: el consolidado opcional va en la moneda base');
select is(pg_temp.m((pg_temp.g('s1') #>> '{consolidated,current,gross}')::numeric) || '/' || pg_temp.m((pg_temp.g('s1') #>> '{consolidated,current,net}')::numeric)
          || '/' || (pg_temp.g('s1') #>> '{consolidated,current,orders}'), '1014.99/974.99/6', 'D28: al tipo de cambio de cada pedido: 1014,99 bruto y 974,99 neto de 6 pedidos');
select is((pg_temp.g('s1') #>> '{consolidated,previous,net}')::numeric, 100::numeric, 'D29: y el período anterior consolidado, 100');
-- Lo que NO es venta, aparte: cancelados (O6, O9 por su fecha de creación), reembolsados completos (O7) y pendientes (O8)
select is(pg_temp.g('s1') -> 'other', '{"cancelled": 2, "pending": 1, "refunded_full": 1}'::jsonb, 'D30: cancelados 2, pendientes 1 y reembolsados por completo 1: contados aparte, no en las ventas');

-- Serie por día: 02-mar → O1 + O2 (la de las 23:30 de La Paz es del 2, aunque en UTC ya sea el 3) · 03-mar → O3 (00:15 de La Paz)
select is((select jsonb_array_length(c -> 'series') from jsonb_array_elements(pg_temp.g('s1') -> 'currencies') c where c ->> 'currency' = 'BOB'), 7,
          'D31: la serie diaria trae los 7 días, también los que no vendieron (sin huecos en el gráfico)');
select is(pg_temp.srn('s1', 'BOB', '2020-03-01', 'orders') || '/' || pg_temp.m(pg_temp.srn('s1', 'BOB', '2020-03-01', 'gross')), '0/0.00', 'D32: el 1 de marzo no vendió: cero, no falta');
select is(pg_temp.srn('s1', 'BOB', '2020-03-02', 'orders') || '/' || pg_temp.m(pg_temp.srn('s1', 'BOB', '2020-03-02', 'gross')) || '/' || pg_temp.m(pg_temp.srn('s1', 'BOB', '2020-03-02', 'net')),
          '2/344.99/344.99', 'D33: el día 2 tiene O1 y O2 (la de las 23:30 de La Paz cuenta en SU día, no en el de UTC)');
select is(pg_temp.sr('s1', 'BOB', '2020-03-02', 'margin')::numeric, 164.99::numeric, 'D34: con margen 95 + 69,99');
select is(pg_temp.srn('s1', 'BOB', '2020-03-03', 'orders') || '/' || pg_temp.m(pg_temp.srn('s1', 'BOB', '2020-03-03', 'gross')), '1/200.00', 'D35: el día 3 tiene O3 (00:15 de La Paz)');
select ok(pg_temp.sr('s1', 'BOB', '2020-03-03', 'margin') is null, 'D36: y su margen es desconocido (no 0): el cubo del 3 solo tiene a O3');
select is(pg_temp.srn('s1', 'BOB', '2020-03-05', 'orders') || '/' || pg_temp.m(pg_temp.srn('s1', 'BOB', '2020-03-05', 'gross')) || '/' || pg_temp.m(pg_temp.srn('s1', 'BOB', '2020-03-05', 'net')),
          '2/270.00/230.00', 'D37: el día 5 tiene O4 y O5: 270 bruto, 230 neto (155−30 y 115−10)');
select is(pg_temp.sr('s1', 'BOB', '2020-03-05', 'margin')::numeric, 95::numeric, 'D38: con margen 65 + 30');
select is((select sum((s ->> 'orders')::int) from jsonb_array_elements(pg_temp.g('s1') -> 'currencies') c, jsonb_array_elements(c -> 'series') s
            where c ->> 'currency' = 'BOB'), 5::bigint, 'D39: la serie suma exactamente los pedidos del indicador');
select is((select sum((s ->> 'net')::numeric) from jsonb_array_elements(pg_temp.g('s1') -> 'currencies') c, jsonb_array_elements(c -> 'series') s
            where c ->> 'currency' = 'BOB'), 774.99::numeric, 'D40: y el neto (la serie y las tarjetas cuentan lo mismo)');
select is(pg_temp.srn('s1', 'USD', '2020-03-04', 'orders') || '/' || pg_temp.m(pg_temp.srn('s1', 'USD', '2020-03-04', 'gross')), '1/25.00', 'D41: la serie de USD es la suya: el 4 de marzo, 25');

-- Por semana (lunes a domingo): el 1 de marzo de 2020 es domingo → el primer cubo empieza el lunes 24-feb y no tuvo ventas
select pg_temp.rec('s_w', public.admin_sales_summary('2020-03-01', '2020-03-07', 'week'));
select pg_temp.rec('s_m', public.admin_sales_summary('2020-03-01', '2020-03-07', 'month'));
select is((select jsonb_agg(s ->> 'bucket' order by s ->> 'bucket') from jsonb_array_elements(pg_temp.g('s_w') -> 'currencies') c,
            jsonb_array_elements(c -> 'series') s where c ->> 'currency' = 'BOB'), '["2020-02-24", "2020-03-02"]'::jsonb,
          'D42: por semana, los cubos arrancan en lunes (el primero cae antes del rango)');
select is(pg_temp.srn('s_w', 'BOB', '2020-02-24', 'orders') || '/' || pg_temp.srn('s_w', 'BOB', '2020-03-02', 'orders'), '0/5', 'D43: y solo cuentan lo que cae dentro del rango');
select is(pg_temp.srn('s_m', 'BOB', '2020-03-01', 'orders') || '/' || pg_temp.m(pg_temp.srn('s_m', 'BOB', '2020-03-01', 'net')), '5/774.99', 'D44: por mes, un solo cubo (1 de marzo)');
-- Todo marzo: la incidencia del 20 de marzo (7, la asume la tienda) entra → 12 + 7 = 19; utilidad 259,99 − 19 = 240,99
select pg_temp.rec('s_mes', public.admin_sales_summary('2020-03-01', '2020-03-31'));
select pg_temp.rec('s_vacio', public.admin_sales_summary('2019-01-01', '2019-01-07'));
select is(pg_temp.m(pg_temp.k('s_mes', 'BOB', 'current', 'incident_cost')) || '/' || pg_temp.m(pg_temp.k('s_mes', 'BOB', 'current', 'profit')), '19.00/240.99', 'D45: todo marzo suma la incidencia del día 20 (19) y la utilidad baja a 240,99');
select is(pg_temp.k('s_mes', 'BOB', 'current', 'orders'), 5::numeric, 'D46: y los mismos 5 pedidos (el rango no inventa ventas)');
select is(pg_temp.g('s_vacio') -> 'currencies', '[]'::jsonb, 'D47: una semana sin nada devuelve «sin monedas» (la pantalla muestra su estado vacío), no un error');
select is(pg_temp.g('s_vacio') #>> '{consolidated,current,orders}', '0', 'D48: y el consolidado en cero');

-- ═══ E. Más y menos vendidos (BOB, 1–7 de marzo) ═══════════════════════════════════════════
-- Por línea, descontando lo reembolsado POR LÍNEA (el monto libre no se atribuye a un producto):
--   PA: O1 190 (2) + O3 100 (1) + O5 100 (1) = 390 · 4 uds · 3 pedidos      PB: O1 40 (1) + O4 140 − 35 = 105 (3) = 145 · 4 uds · 2 pedidos
--   PC: 99,99 · 3 uds · 1 pedido      PX: 100 · 2 uds · 1 pedido
set local role authenticated;
select is((select jsonb_agg(product_code order by ord) from (select *, row_number() over () as ord from public.admin_top_products('2020-03-01', '2020-03-07')) x),
          '["S14-01", "S14-02", "S14-04", "S14-03"]'::jsonb, 'E1: por ingresos: PA 390, PB 145, PX 100, PC 99,99');
select is((select units || '/' || round(revenue, 2) || '/' || orders from public.admin_top_products('2020-03-01', '2020-03-07') where product_code = 'S14-01'),
          '4/390.00/3', 'E2: PA vendió 4 unidades por 390 en 3 pedidos');
select is((select units || '/' || round(revenue, 2) || '/' || orders from public.admin_top_products('2020-03-01', '2020-03-07') where product_code = 'S14-02'),
          '4/145.00/2', 'E3: PB 145: el reembolso de 35 de una unidad baja SU ingreso y su unidad');
select is((select jsonb_agg(product_code order by ord) from (select *, row_number() over () as ord from public.admin_top_products('2020-03-01', '2020-03-07', null, 'units')) x),
          '["S14-01", "S14-02", "S14-03", "S14-04"]'::jsonb, 'E4: por unidades: PA y PB empatan en 4 (por nombre), luego PC 3 y PX 2');
select is((select jsonb_agg(product_code order by ord) from (select *, row_number() over () as ord from public.admin_top_products('2020-03-01', '2020-03-07', null, 'units', 'asc', 3)) x),
          '["S14-04", "S14-03", "S14-01"]'::jsonb, 'E5: los MENOS vendidos (y solo los que vendieron algo), con límite 3');
select is((select count(*)::int from public.admin_top_products('2020-03-01', '2020-03-07', null, 'revenue', 'desc', 2)), 2, 'E6: el límite se respeta');
select is((select product_code || '/' || units || '/' || round(revenue, 2) || '/' || currency from public.admin_top_products('2020-03-01', '2020-03-07', 'USD')),
          'S14-02/1/25.00/USD', 'E7: pedida otra moneda, solo cuenta la suya (el USD no se mezcla con BOB)');
select is((select count(*)::int from public.admin_top_products('2019-01-01', '2019-01-07')), 0, 'E8: sin ventas, sin filas');
reset role;

-- ═══ F. Desgloses (BOB, 1–7 de marzo) ══════════════════════════════════════════════════════
--   método de pago: whatsapp 230 + 200 = 430 (6 uds, 2 pedidos) · qr_manual 105 + 100 = 205 (4 uds) · cash_on_delivery 99,99 (3 uds)
--   canal: web O1+O2+O4 = 230 + 99,99 + 105 = 434,99 (9 uds, 3 pedidos) · manual O3 200 · whatsapp O5 100
--   categoría: PA y PB = 390 + 145 = 535 (8 uds; pedidos O1, O3, O4, O5 = 4) · sin categoría PC + PX = 199,99 (5 uds, 2 pedidos)
--   colección: PA 390 (4 uds, 3 pedidos) · sin colección PB + PC + PX = 145 + 99,99 + 100 = 344,99 (9 uds, 4 pedidos)
--   variante: Rojo / M 390 (4) · Azul / M 145 (4) · Único / M 199,99 (5)
set local role authenticated;
select is((select jsonb_agg(key || '=' || round(revenue, 2) || '/' || units || '/' || orders order by ord)
             from (select *, row_number() over () as ord from public.admin_sales_breakdown('2020-03-01', '2020-03-07', 'payment_method')) x),
          '["whatsapp=430.00/6/2", "qr_manual=205.00/4/2", "cash_on_delivery=99.99/3/1"]'::jsonb, 'F1: por método de pago');
select is((select jsonb_agg(key || '=' || round(revenue, 2) || '/' || units || '/' || orders order by ord)
             from (select *, row_number() over () as ord from public.admin_sales_breakdown('2020-03-01', '2020-03-07', 'channel')) x),
          '["web=434.99/9/3", "manual=200.00/3/1", "whatsapp=100.00/1/1"]'::jsonb, 'F2: por canal');
select is((select jsonb_agg(coalesce(label, '∅') || '=' || round(revenue, 2) || '/' || units || '/' || orders order by ord)
             from (select *, row_number() over () as ord from public.admin_sales_breakdown('2020-03-01', '2020-03-07', 'category')) x),
          '["Categoría S14=535.00/8/4", "∅=199.99/5/2"]'::jsonb, 'F3: por categoría (lo que no tiene categoría, aparte)');
select is((select jsonb_agg(coalesce(label, '∅') || '=' || round(revenue, 2) || '/' || units || '/' || orders order by ord)
             from (select *, row_number() over () as ord from public.admin_sales_breakdown('2020-03-01', '2020-03-07', 'collection')) x),
          '["Colección S14=390.00/4/3", "∅=344.99/9/4"]'::jsonb, 'F4: por colección');
select is((select jsonb_agg(label || '=' || round(revenue, 2) || '/' || units order by ord)
             from (select *, row_number() over () as ord from public.admin_sales_breakdown('2020-03-01', '2020-03-07', 'variant')) x),
          '["Rojo / M=390.00/4", "Único / M=199.99/5", "Azul / M=145.00/4"]'::jsonb, 'F5: por variante (color y talla), de mayor a menor ingreso');
select is((select count(*)::int from public.admin_sales_breakdown('2020-03-01', '2020-03-07', 'channel', null, 2)), 2, 'F6: el límite se respeta');
select is((select jsonb_agg(key || '=' || round(revenue, 2)) from public.admin_sales_breakdown('2020-03-01', '2020-03-07', 'payment_method', 'USD')),
          '["whatsapp=25.00"]'::jsonb, 'F7: pedida otra moneda, solo cuenta la suya');
reset role;

-- ═══ G. Mezcla de métodos de pago (por pedido) ═════════════════════════════════════════════
--   BOB: whatsapp O1 + O3 = 2 pedidos, 445 bruto, 445 neto · qr_manual O4 + O5 = 2, 270 bruto, 230 neto · contra entrega O2 = 1, 99,99
--   USD: whatsapp O10 = 1, 25
set local role authenticated;
select is((select jsonb_agg(currency || ':' || payment_method || '=' || orders || '/' || round(gross, 2) || '/' || round(net, 2) order by ord)
             from (select *, row_number() over () as ord from public.admin_payment_mix('2020-03-01', '2020-03-07')) x),
          '["BOB:whatsapp=2/445.00/445.00", "BOB:qr_manual=2/270.00/230.00", "BOB:cash_on_delivery=1/99.99/99.99", "USD:whatsapp=1/25.00/25.00"]'::jsonb,
          'G1: la mezcla de pagos, por moneda y por neto');
select is((select sum(net) from public.admin_payment_mix('2020-03-01', '2020-03-07') where currency = 'BOB'), 774.99::numeric,
          'G2: y suma lo mismo que las ventas netas del resumen (los reportes no se contradicen)');
reset role;

-- ═══ H. Sin rotación, inventario y cobertura ═══════════════════════════════════════════════
-- Con todo lo demás archivado. Sin rotación (60 días): PS y PK nunca vendieron (primero, por nombre) · luego por su última venta,
--   la más vieja primero: PC (02-mar) y PX (03-mar). PA y PB vendieron HOY (O12, O13: no están) y PZ está agotado (no hay qué rotar).
--   → PS, PK, PC, PX
set local role authenticated;
select is((select jsonb_agg(product_code order by ord) from (select *, row_number() over () as ord from public.admin_slow_movers(60, 500)) x),
          '["S14-05", "S14-06", "S14-03", "S14-04"]'::jsonb, 'H1: sin rotación: los que nunca vendieron, luego por su última venta (PA y PB vendieron hoy; PZ no tiene stock)');
select is((select last_sold_at is null and days_since_sale is null from public.admin_slow_movers(60, 500) where product_code = 'S14-05'), true,
          'H2: lo que nunca se vendió no inventa una fecha');
select is((select last_sold_at from public.admin_slow_movers(60, 500) where product_code = 'S14-04'), '2020-03-03 00:15-04'::timestamptz,
          'H3: PX: su última venta fue O3 (3 de marzo, 00:15)');
select is((select count(*)::int from public.admin_slow_movers(60, 2)), 2, 'H4: el límite se respeta');
-- Inventario: variantes 7 · unidades 20 + 100 + 50 + 8 + 5 + 2 + 0 = 185 · valor 20×60 + 100×15 + 50×10 + 5×20 + 2×40 = 3380
--   (PX no tiene costo: no suma ni se asume 0, se cuenta aparte; PZ tampoco, pero sin stock no hay nada que valorar y NO se cuenta) · semáforo: ok PA, PB, PC, PX · bajo PS (5 ≤ 5) · crítico PK (2 ≤ 2) · agotado PZ
reset role;
select pg_temp.rec('inv', public.admin_inventory_summary());
select is(pg_temp.g('inv') ->> 'currency', 'BOB', 'H5: el inventario se valora en la moneda base');
select is((pg_temp.g('inv') ->> 'variants') || '/' || (pg_temp.g('inv') ->> 'units'), '7/185', 'H6: 7 variantes y 185 unidades');
select is((pg_temp.g('inv') ->> 'value')::numeric, 3380::numeric, 'H7: valor 3380');
select is((pg_temp.g('inv') ->> 'variants_without_cost'), '1', 'H8: una variante con stock y sin costo (PX): se avisa, no se inventa un costo');
select is((pg_temp.g('inv') ->> 'ok') || '/' || (pg_temp.g('inv') ->> 'low') || '/' || (pg_temp.g('inv') ->> 'critical') || '/' || (pg_temp.g('inv') ->> 'out'), '4/1/1/1',
          'H9: semáforo 4 bien, 1 bajo, 1 crítico y 1 agotado');
-- Cobertura (10 días): PA vendió 3 hoy → 0,3 por día → 20 / 0,3 = 66,7 días · PB vendió 1 hoy y 1 hace 9 días (el primer día de la ventana) = 2 → 0,2 por día → 100 / 0,2 = 500,0 días
set local role authenticated;
select is((select jsonb_agg(product_name || '=' || units_sold || '/' || daily_rate || '/' || days_of_cover order by ord)
             from (select *, row_number() over () as ord from public.admin_inventory_coverage(10)) x),
          '["Producto S14 01=3/0.3000/66.7", "Producto S14 02=2/0.2000/500.0"]'::jsonb, 'H10: cobertura: PA 66,7 días y PB 500 (la venta de hace 9 días cuenta: es el primer día de la ventana)');
select is((select count(*)::int from public.admin_inventory_coverage(10, 1)), 1, 'H11: el límite se respeta');
select is((select count(*)::int from public.admin_inventory_coverage(10) where product_name in ('Producto S14 03', 'Producto S14 04')), 0,
          'H12: lo que no vendió en la ventana no tiene cobertura calculable (no se divide entre cero)');
reset role;

-- ═══ I. Embudo del 1 al 7 de marzo ═════════════════════════════════════════════════════════
--   carritos 3 (2 con productos) · pedidos creados O1–O10 = 10 · pagados (ventas vigentes de cualquier moneda) O1–O5 y O10 = 6
select pg_temp.rec('fun', public.admin_funnel('2020-03-01', '2020-03-07'));
select is(pg_temp.g('fun'), '{"carts": 3, "paid": 6, "orders": 10, "carts_with_items": 2}'::jsonb, 'I1: el embudo cuenta 3 carritos (2 con productos), 10 pedidos y 6 pagados');

-- ═══ K. Reportes con filas (1–7 de marzo de 2020) ══════════════════════════════════════════
-- Ventas (BOB): O5, O4, O3, O2, O1 (de la más nueva a la más vieja). O4: bruto 155, descuento 20, envío 15, reembolsado 30, neto 125,
--   margen 65, 4 unidades, clienta «Tres». O3: sin costo en una línea → margen desconocido. USD: solo O10.
set local role authenticated;
select is((select jsonb_agg(number order by ord) from (select *, row_number() over () as ord from public.admin_report_sales('2020-03-01', '2020-03-07')) x),
          '["MIC-914005", "MIC-914004", "MIC-914003", "MIC-914002", "MIC-914001"]'::jsonb, 'K1: ventas de la más nueva a la más vieja (O5, O4, O3, O2, O1), sin cancelados ni pendientes');
select is((select total_count from public.admin_report_sales('2020-03-01', '2020-03-07', null, 0, 1)), 5::bigint, 'K2: cada fila trae el total del filtro (5), aunque se pida una sola');
select is((select jsonb_agg(number order by ord) from (select *, row_number() over () as ord from public.admin_report_sales('2020-03-01', '2020-03-07', null, 2, 2)) x),
          '["MIC-914003", "MIC-914002"]'::jsonb, 'K3: la página 2 (desplazamiento 2, de 2 en 2) son O3 y O2');
select is((select units || '/' || round(gross, 2) || '/' || round(discount, 2) || '/' || round(shipping, 2) || '/' || round(refunded, 2) || '/' || round(net, 2) || '/' || round(margin, 2) || '/' || customer || '/' || channel
             from public.admin_report_sales('2020-03-01', '2020-03-07') where number = 'MIC-914004'),
          '4/155.00/20.00/15.00/30.00/125.00/65.00/Clienta Tres/web', 'K4: O4 trae todos sus importes: bruto 155, descuento 20, envío 15, reembolsado 30, neto 125 y margen 65');
select is((select margin from public.admin_report_sales('2020-03-01', '2020-03-07') where number = 'MIC-914003'), null::numeric, 'K5: O3 tiene un producto sin costo: su margen es desconocido, no cero');
select is((select margin from public.admin_report_sales('2020-03-01', '2020-03-07', 'USD')), null::numeric,
          'K6: el pedido en USD tampoco tiene margen (el costo está en la moneda base)');
select is((select number || '/' || currency || '/' || round(net, 2) from public.admin_report_sales('2020-03-01', '2020-03-07', 'USD')), 'MIC-914010/USD/25.00', 'K7: pedida otra moneda, solo trae la suya');

-- Productos (BOB): PA 390 (4 uds, 3 pedidos, costo 4×60 = 240, margen 150 = 38,5 %) · PB 145 (4, 2, costo 15 + 45 = 60, margen 85 = 58,6 %) ·
--   PX 100 (2, 1, sin costo → margen desconocido) · PC 99,99 (3, 1, costo 30, margen 69,99 = 70,0 %)
select is((select jsonb_agg(product_code || '=' || units || '/' || round(revenue, 2) || '/' || orders || '/' || coalesce(round(margin, 2)::text, '∅') || '/' || coalesce(margin_pct::text, '∅') order by ord)
             from (select *, row_number() over () as ord from public.admin_report_products('2020-03-01', '2020-03-07')) x),
          '["S14-01=4/390.00/3/150.00/38.5", "S14-02=4/145.00/2/85.00/58.6", "S14-04=2/100.00/1/∅/∅", "S14-03=3/99.99/1/69.99/70.0"]'::jsonb,
          'K10: productos por ingreso, con su margen (el de PX, sin costo, es desconocido)');
select is((select total_count from public.admin_report_products('2020-03-01', '2020-03-07', null, 0, 1)), 4::bigint, 'K11: 4 productos vendidos');

-- Mayo: PA vendido dos veces, una sin costo registrado y otra con costo 60 → 2 uds, 200 de ingreso, margen SOLO de la línea con costo:
--   100 − 60 = 40 sobre 100 de ingreso con costo = 40,0 % (no 20,0 %, que sería sobre todo el ingreso)
select is((select units || '/' || round(revenue, 2) || '/' || round(margin, 2) || '/' || margin_pct from public.admin_report_products('2020-05-01', '2020-05-31')),
          '2/200.00/40.00/40.0', 'K11b: el margen % de un producto es sobre el ingreso de las líneas CON costo (40,0 %), no sobre todo (20,0 %)');

-- Inventario (todo lo demás está archivado): 7 variantes por nombre de producto. PA: 20 en mano, 0 reservado, 20 disponibles, «ok», costo 60 → 1200.
select is((select jsonb_agg(product_code order by ord) from (select *, row_number() over () as ord from public.admin_report_inventory()) x),
          '["S14-01", "S14-02", "S14-03", "S14-04", "S14-05", "S14-06", "S14-07"]'::jsonb, 'K12: el inventario lista las 7 variantes, ordenadas por producto');
select is((select stock_on_hand || '/' || reserved || '/' || available || '/' || stock_light || '/' || round(cost_base, 2) || '/' || round(stock_value, 2)
             from public.admin_report_inventory() where product_code = 'S14-01'), '20/0/20/ok/60.00/1200.00', 'K13: PA: 20 en mano, 20 disponibles, «ok», costo 60, valor 1200');
select is((select stock_value is null and cost_base is null from public.admin_report_inventory() where product_code = 'S14-04'), true, 'K14: PX no tiene costo: su valor es desconocido, no cero');
select is((select jsonb_agg(stock_light order by ord) from (select *, row_number() over () as ord from public.admin_report_inventory()) x),
          '["ok", "ok", "ok", "ok", "low", "critical", "out"]'::jsonb, 'K15: el semáforo de cada variante (5 = bajo, 2 = crítico, 0 = agotado)');
select is((select count(*)::int from public.admin_report_inventory(5, 3)), 2, 'K16: la última página trae lo que queda (2 de 7 desde la fila 5)');
select is((select total_count from public.admin_report_inventory(0, 1)), 7::bigint, 'K17: y el total sigue siendo 7');

-- Descuentos: 2 aplicados (10 + 20 = 30), 1 reservado, 2 clientas (la revertida no cuenta)
select is((select discount_name || '/' || uses_applied || '/' || uses_reserved || '/' || customers || '/' || round(amount_applied, 2) || '/' || currency
             from public.admin_report_discounts('2020-03-01', '2020-03-07')), 'Descuento S14/2/1/2/30.00/BOB',
          'K18: el descuento: 2 usos aplicados por 30, 1 reservado y 2 clientas; el canje revertido no cuenta');
select is((select count(*)::int from public.admin_report_discounts('2020-04-01', '2020-04-07')), 0, 'K19: un período sin canjes no trae filas');
select is((select count(*)::int from public.admin_report_discounts('2020-03-01', '2020-03-07')), 1, 'K19b: y un descuento cuyo único canje del período fue revertido no aparece (solo el de los 2 aplicados)');

-- Pagos (creados el 1–7 de marzo): O1–O10 = 10 cobros: 8 pagados y 2 pendientes (O8, O9)
select is((select count(*)::int || '/' || (count(*) filter (where status = 'paid'))::int || '/' || (count(*) filter (where status = 'pending'))::int
             from public.admin_report_payments('2020-03-01', '2020-03-07')), '10/8/2', 'K20: 10 cobros: 8 pagados y 2 pendientes');
select is((select order_number || '/' || method || '/' || status || '/' || round(amount, 2) || '/' || currency from public.admin_report_payments('2020-03-01', '2020-03-07')
            where order_number = 'MIC-914001'), 'MIC-914001/whatsapp/paid/245.00/BOB', 'K21: el cobro de O1: 245 por WhatsApp, pagado');
select is((select total_count from public.admin_report_payments('2020-03-01', '2020-03-07', 0, 3) limit 1), 10::bigint, 'K22: el total del filtro viaja con la página');

-- Devoluciones y reembolsos: 4 reembolsos (30, 20 rechazado, 10, 115) y 1 devolución de productos = 5, del más nuevo al más viejo
select is((select jsonb_agg(kind || ':' || status || ':' || coalesce(round(amount, 2)::text, '∅') order by ord)
             from (select *, row_number() over () as ord from public.admin_report_returns('2020-03-01', '2020-03-07')) x),
          '["refund:processed:115.00", "return:open:∅", "refund:requested:10.00", "refund:rejected:20.00", "refund:processed:30.00"]'::jsonb,
          'K23: reembolsos y devoluciones juntos, del más nuevo al más viejo (el rechazado se ve, con su estado)');
select is((select total_count from public.admin_report_returns('2020-03-01', '2020-03-07', 0, 1)), 5::bigint, 'K24: 5 movimientos en el período');

-- Clientas (BOB): u1 compró O1 + O2 + O5 = 245 + 99,99 + 105 = 449,99 (ya había comprado el 27-feb → recurrente) ·
--   u3 compró O3 + O4 = 200 + 125 = 325 (su primera compra de siempre es O3 → nueva)
select is((select jsonb_agg(customer_name || ':' || orders || ':' || round(net, 2) || ':' || segment order by ord)
             from (select *, row_number() over () as ord from public.admin_report_customers('2020-03-01', '2020-03-07')) x),
          '["Clienta Uno S14:3:449.99:recurring", "Clienta Tres S14:2:325.00:new"]'::jsonb, 'K25: u1 es recurrente (449,99) y u3 es nueva (325,00)');
select is((select customer_email from public.admin_report_customers('2020-03-01', '2020-03-07') where customer_name = 'Clienta Tres S14'), 'u03.s14@test.com', 'K26: el reporte trae el correo (datos personales: solo para administradores)');
select is((select first_sale_at from public.admin_report_customers('2020-03-01', '2020-03-07') where customer_name = 'Clienta Uno S14'), '2020-02-27 12:00-04'::timestamptz, 'K27: la primera venta de u1 fue el 27-feb (O11), antes del período');
select is((select count(*)::int from public.admin_report_customers('2020-03-01', '2020-03-07', 'USD')), 1, 'K28: en USD solo compró u1');
select is(public.admin_customers_summary('2020-03-01', '2020-03-07'),
          '{"customers": 2, "new_accounts": 1, "new_customers": 1, "recurring_customers": 1}'::jsonb,
          'K29: 2 clientas, 1 nueva y 1 recurrente; y 1 cuenta de clienta creada en el período (u3; la del administrador, creada el 4 de marzo, no cuenta)');
reset role;
select is((select sum(net) from public.admin_report_sales('2020-03-01', '2020-03-07')), pg_temp.k('s1', 'BOB', 'current', 'net'), 'K8: la suma del reporte es el neto del resumen (no se contradicen)');
select is((select sum(gross) from public.admin_report_sales('2020-03-01', '2020-03-07')), pg_temp.k('s1', 'BOB', 'current', 'gross'), 'K9: …y el bruto');

-- ═══ L. Un reembolso con el envío devuelto (abril de 2020) ═════════════════════════════════
-- O14: PA×2 (200) + envío 15 = 215 · se devuelve 1 unidad (100) y el envío (15) = 115 → neto 215 − 115 = 100 ·
--   ingreso de productos 200 − (115 − 15) = 100 (el envío devuelto NO es ingreso de productos) · costo (2 − 1) × 60 = 60 · margen 40 = 40,0 %
select pg_temp.rec('s_abr', public.admin_sales_summary('2020-04-01', '2020-04-07'));
select is(pg_temp.m(pg_temp.k('s_abr', 'BOB', 'current', 'gross')) || '/' || pg_temp.m(pg_temp.k('s_abr', 'BOB', 'current', 'refunds')) || '/' || pg_temp.m(pg_temp.k('s_abr', 'BOB', 'current', 'net')),
          '215.00/115.00/100.00', 'L1: abril: bruto 215, reembolsado 115 (producto y envío), neto 100');
select is(pg_temp.m(pg_temp.k('s_abr', 'BOB', 'current', 'product_revenue')) || '/' || pg_temp.m(pg_temp.k('s_abr', 'BOB', 'current', 'margin')) || '/' || pg_temp.k('s_abr', 'BOB', 'current', 'margin_pct'),
          '100.00/40.00/40.0', 'L2: el envío devuelto NO baja el ingreso de productos (200 − (115 − 15) = 100): margen 40 (40,0 %)');
select is(pg_temp.m(pg_temp.k('s_abr', 'BOB', 'current', 'shipping')), '15.00', 'L3: el envío cobrado sigue siendo 15 (devolverlo baja lo neto, no lo cobrado)');
select is((select round(margin, 2) from public.admin_report_sales('2020-04-01', '2020-04-07')), 40.00::numeric, 'L4: el reporte de ventas trae el mismo margen (40)');

-- ═══ J. Coherencia con una cuenta INDEPENDIENTE y solo lectura ═════════════════════════════
-- Otra manera de llegar al mismo número: directo de las tablas, sin pasar por la definición de venta de las funciones.
select is((select sum(o.total) from public.orders o where o.currency = 'BOB' and o.status in ('paid', 'preparing', 'shipped', 'delivered', 'completed')
              and o.paid_at >= '2020-03-01 00:00-04' and o.paid_at < '2020-03-08 00:00-04'), pg_temp.k('s1', 'BOB', 'current', 'gross'),
          'J1: el bruto del resumen coincide con la suma directa de pedidos pagados del rango');
select is((select sum(r.amount) from public.refunds r join public.orders o on o.id = r.order_id
            where o.currency = 'BOB' and o.status in ('paid', 'preparing', 'shipped', 'delivered', 'completed') and r.status <> 'rejected'
              and o.paid_at >= '2020-03-01 00:00-04' and o.paid_at < '2020-03-08 00:00-04'), pg_temp.k('s1', 'BOB', 'current', 'refunds'),
          'J2: y los reembolsos, con la suma directa del libro');
select is(pg_temp.k('s1', 'BOB', 'current', 'gross') - pg_temp.k('s1', 'BOB', 'current', 'refunds'), pg_temp.k('s1', 'BOB', 'current', 'net'),
          'J3: neto = bruto − reembolsos');
select is((select sum(i.final_total) from public.order_items i join public.orders o on o.id = i.order_id
            where o.currency = 'BOB' and o.status in ('paid', 'preparing', 'shipped', 'delivered', 'completed')
              and o.paid_at >= '2020-03-01 00:00-04' and o.paid_at < '2020-03-08 00:00-04')
          + (select sum(o.shipping_cost - o.shipping_discount) from public.orders o
              where o.currency = 'BOB' and o.status in ('paid', 'preparing', 'shipped', 'delivered', 'completed')
                and o.paid_at >= '2020-03-01 00:00-04' and o.paid_at < '2020-03-08 00:00-04'),
          pg_temp.k('s1', 'BOB', 'current', 'gross'), 'J4: bruto = Σ líneas + envío cobrado (la identidad que ya garantiza S10)');
select is((select count(*)::int from public.orders) || '|' || (select count(*)::int from public.refunds) || '|' || (select count(*)::int from public.order_items)
          || '|' || (select count(*)::int from public.product_variants) || '|' || (select coalesce(sum(stock_on_hand), 0)::int from public.product_variants),
          (select orders || '|' || refunds || '|' || items || '|' || variants || '|' || stock::int from t_snap),
          'J5: nada de esto escribe: pedidos, reembolsos, líneas, variantes y stock quedan idénticos después de todas las consultas');

select * from finish();
rollback;
