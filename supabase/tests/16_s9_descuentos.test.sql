-- Sprint 9 · Descuentos y cupones: utilidades puras, restricciones, motor (los 8 tipos y sus bordes), usos atómicos, carrito
-- (cupón, desglose por línea, fusión) y permisos/RLS.
-- Los valores esperados se calcularon A MANO (la cuenta va en el comentario de cada bloque), nunca copiados de la función.
-- Importes en BOB (2 decimales). Todo ocurre en una transacción que se revierte: no deja datos.
--
-- Fixture:  productos P1..P6 b9000000-…-00000000000N · categoría C1 = {P1, P2} · colección K1 = {P2, P3}
--           clientas ana (a9…0a, miembro del grupo «Mayoristas») y bia (a9…0b) · admin ad9…0d
--           T0 = 2026-12-01 10:00 UTC (las vigencias se prueban con un «ahora» fijo, no con el reloj)
begin;
select plan(520);

-- HERMÉTICO: la nube puede traer descuentos de ejemplo; esta prueba parte de cero dentro de su transacción.
-- (`audit_log` es inmutable y persiste: las pruebas de auditoría buscan los ids de ESTA prueba, no cuentan filas.)
delete from public.discount_redemptions;
delete from public.coupons;
delete from public.discount_targets;
delete from public.discounts;
delete from public.customer_group_members;
delete from public.customer_groups;
delete from public.carts;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('a9000000-0000-0000-0000-00000000000a', 'ana.s9@test.com',   '{"full_name":"Ana S9"}',   'authenticated', 'authenticated'),
  ('a9000000-0000-0000-0000-00000000000b', 'bia.s9@test.com',   '{"full_name":"Bia S9"}',   'authenticated', 'authenticated'),
  ('ad900000-0000-0000-0000-00000000000d', 'admin.s9@test.com', '{"full_name":"Admin S9"}', 'authenticated', 'authenticated');
select public.set_user_role('ad900000-0000-0000-0000-00000000000d', 'admin');

insert into public.products (id, code, slug, name)
select ('b9000000-0000-0000-0000-00000000000' || i)::uuid, 'S9-' || i, 's9-' || i, 'Producto S9 ' || i from generate_series(1, 6) i;
insert into public.categories (id, name, slug) values ('c9000000-0000-0000-0000-000000000001', 'Categoría S9', 'cat-s9');
insert into public.collections (id, name, slug) values ('d9000000-0000-0000-0000-000000000001', 'Colección S9', 'col-s9');
insert into public.product_categories (product_id, category_id) values
  ('b9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001'),
  ('b9000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000001');
insert into public.product_collections (product_id, collection_id) values
  ('b9000000-0000-0000-0000-000000000002', 'd9000000-0000-0000-0000-000000000001'),
  ('b9000000-0000-0000-0000-000000000003', 'd9000000-0000-0000-0000-000000000001');
insert into public.customer_groups (id, name) values ('e9000000-0000-0000-0000-000000000001', 'Mayoristas');
insert into public.customer_group_members (group_id, profile_id)
values ('e9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-00000000000a');

-- ── Ayudas (objetos temporales: viven y mueren con la transacción) ────────────────────────────
create function pg_temp.p(n int) returns uuid language sql as $$ select ('b9000000-0000-0000-0000-00000000000' || n)::uuid $$;
create function pg_temp.ln(p_idx int, p_prod int, p_unit numeric, p_qty int) returns jsonb language sql as
  $$ select jsonb_build_object('idx', p_idx, 'variant_id', gen_random_uuid(), 'product_id', pg_temp.p(p_prod),
                               'unit_price', p_unit, 'qty', p_qty, 'line_total', p_unit * p_qty) $$;
create function pg_temp.ev(p_lines jsonb, p_coupon text default null, p_profile uuid default null, p_ship numeric default null,
                           p_now timestamptz default now(), p_cur text default 'BOB') returns jsonb language sql as
  $$ select public._discount_evaluate(p_profile, p_cur, p_lines, p_coupon, p_ship, p_now) $$;
create function pg_temp.tot(j jsonb) returns numeric language sql as $$ select (j #>> '{totals,total}')::numeric $$;
create function pg_temp.dis(j jsonb) returns numeric language sql as $$ select (j #>> '{totals,discount}')::numeric $$;
create function pg_temp.ld(j jsonb, n int) returns numeric language sql as $$ select (j #>> array['lines', (n - 1)::text, 'discount'])::numeric $$;
create function pg_temp.reason(j jsonb) returns text language sql as $$ select j #>> '{coupon,reason}' $$;
create function pg_temp.cst(j jsonb) returns text language sql as $$ select j #>> '{coupon,status}' $$;
create function pg_temp.wipe() returns void language plpgsql as $$
begin
  delete from public.discount_redemptions; delete from public.coupons; delete from public.discount_targets; delete from public.discounts;
end $$;
-- Crea un descuento: `p` lleva name, kind, params y lo que se quiera cambiar de los valores por omisión.
create function pg_temp.dc(p jsonb) returns uuid language plpgsql as $$
declare
  r public.discounts;
  v uuid;
begin
  r := jsonb_populate_record(null::public.discounts, p);
  insert into public.discounts (id, name, kind, params, scope, currency, min_order_amount, customer_group_id, requires_coupon,
    stackable_with_automatic, exclude_sale_items, usage_limit_total, usage_limit_per_customer, priority, starts_at, ends_at, is_active)
  values (coalesce(r.id, gen_random_uuid()), coalesce(r.name, 'D'), r.kind, r.params, coalesce(r.scope, 'order'),
    coalesce(r.currency, 'BOB'), r.min_order_amount, r.customer_group_id, coalesce(r.requires_coupon, false),
    coalesce(r.stackable_with_automatic, false), coalesce(r.exclude_sale_items, false), r.usage_limit_total,
    r.usage_limit_per_customer, coalesce(r.priority, 100), r.starts_at, r.ends_at, coalesce(r.is_active, true))
  returning id into v;
  return v;
end $$;
create function pg_temp.cp(p_discount uuid, p_code text, p_extra jsonb default '{}') returns uuid language plpgsql as $$
declare
  r public.coupons;
  v uuid;
begin
  r := jsonb_populate_record(null::public.coupons, p_extra);
  insert into public.coupons (discount_id, code, is_active, starts_at, ends_at, usage_limit)
  values (p_discount, p_code, coalesce(r.is_active, true), r.starts_at, r.ends_at, r.usage_limit) returning id into v;
  return v;
end $$;
create function pg_temp.tg(p_discount uuid, p_kind text, p_id uuid) returns void language plpgsql as $$
begin
  insert into public.discount_targets (discount_id, product_id, category_id, collection_id)
  values (p_discount, case when p_kind = 'product' then p_id end, case when p_kind = 'category' then p_id end,
          case when p_kind = 'collection' then p_id end);
end $$;
-- Un cupón de porcentaje (de todo el pedido) listo para usar con el código dado.
create function pg_temp.pc(p_code text, p_pct numeric, p_extra jsonb default '{}') returns uuid language plpgsql as $$
declare v uuid;
begin
  v := pg_temp.dc(jsonb_build_object('name', 'Cupón ' || p_code, 'kind', 'percent', 'params', jsonb_build_object('percent', p_pct),
                                     'requires_coupon', true) || p_extra);
  perform pg_temp.cp(v, p_code);
  return v;
end $$;

-- Líneas de uso común.  L12: P1 100 × 2 = 200,00 y P2 50 × 1 = 50,00 → subtotal 250,00
create temp table _l (k text primary key, j jsonb);
insert into _l values
  ('L12', jsonb_build_array(pg_temp.ln(1, 1, 100, 2), pg_temp.ln(2, 2, 50, 1)));
create function pg_temp.l(k text) returns jsonb language sql as $$ select j from _l where _l.k = $1 $$;

-- ═══ A. Utilidades puras ═══════════════════════════════════════════════════════════════════
-- Normalización de códigos: sin espacios, guiones ni guiones bajos; mayúsculas; O→0, I→1, L→1.
select is(public._coupon_norm('verano-10'), 'VERAN010', 'norm: «verano-10» → VERAN010 (la O se lee como 0)');
select is(public._coupon_norm('  VERANO 10 '), 'VERAN010', 'norm: espacios y mayúsculas');
select is(public._coupon_norm('veran0 1o'), 'VERAN010', 'norm: un 0 y una o confundibles dan el MISMO código');
select is(public._coupon_norm('Verano_10'), 'VERAN010', 'norm: guion bajo');
select is(public._coupon_norm('bienvenida'), 'B1ENVEN1DA', 'norm: I→1');
select is(public._coupon_norm('lll'), '111', 'norm: L→1');
select is(public._coupon_norm(null), null, 'norm: null → null');
select is(public._coupon_norm('   '), '', 'norm: solo espacios → vacío');

-- Reparto del mayor resto (100 en tres pesos iguales: 33 + 33 + 33 y sobra 1 → a la primera línea)
select is(public._discount_distribute(100, array[100, 100, 100]::bigint[]), array[34, 33, 33]::bigint[], 'reparto: 100 entre 3 pesos iguales = 34, 33, 33 (suma exacta)');
select is(public._discount_distribute(100, array[1, 1, 1]::bigint[]), array[1, 1, 1]::bigint[], 'reparto: los pesos son también el TOPE de cada línea (100 sobre pesos 1, 1, 1 → 1, 1, 1)');
select is(public._discount_distribute(10, array[3, 3, 4]::bigint[]), array[3, 3, 4]::bigint[], 'reparto: cuando el monto iguala los pesos, cada uno recibe el suyo');
select is(public._discount_distribute(5, array[10, 0, 10]::bigint[]), array[3, 0, 2]::bigint[], 'reparto: una línea de peso 0 no recibe nada; el resto va a la primera con resto');
select is(public._discount_distribute(1000, array[10, 20]::bigint[]), array[10, 20]::bigint[], 'reparto: un monto mayor que los pesos se limita a los pesos');
select is(public._discount_distribute(7, array[10, 10, 10, 10]::bigint[]), array[2, 2, 2, 1]::bigint[], 'reparto: 7 entre 4 pesos iguales = 2, 2, 2, 1');
select is(public._discount_distribute(0, array[5, 5]::bigint[]), array[0, 0]::bigint[], 'reparto: monto 0 → nada');
select is(public._discount_distribute(null, array[5, 5]::bigint[]), array[0, 0]::bigint[], 'reparto: monto nulo → nada');
select is(public._discount_distribute(50, array[0, 0]::bigint[]), array[0, 0]::bigint[], 'reparto: pesos en 0 → nada (sin dividir por cero)');
select is(public._discount_distribute(50, '{}'::bigint[]), '{}'::bigint[], 'reparto: sin líneas → vacío');
select is((select sum(x) from unnest(public._discount_distribute(1234567, array[333000, 777000, 1000, 4999000, 12000]::bigint[])) x)::bigint, 1234567::bigint,
          'reparto: la suma es EXACTA con pesos irregulares');

-- Validación de los parámetros de cada tipo
select is(public._discount_params_valid('percent', '{"percent": 10}'), true, 'params: percent válido');
select is(public._discount_params_valid('percent', '{"percent": 100}'), true, 'params: percent 100 (todo gratis) es válido');
select is(public._discount_params_valid('percent', '{"percent": 0}'), false, 'params: percent 0 no tiene sentido');
select is(public._discount_params_valid('percent', '{"percent": 100.01}'), false, 'params: percent > 100 inválido');
select is(public._discount_params_valid('percent', '{"percent": 10, "extra": 1}'), false, 'params: claves de más inválidas');
select is(public._discount_params_valid('percent', '{"percent": "10"}'), false, 'params: el porcentaje debe ser número, no texto');
select is(public._discount_params_valid('percent', '{"percent": 10, "max_amount": 50}'), true, 'params: percent con tope de monto');
select is(public._discount_params_valid('percent', '{"percent": 10, "max_amount": 0}'), false, 'params: tope de monto 0 inválido');
select is(public._discount_params_valid('fixed', '{"amount": 20}'), true, 'params: fixed válido');
select is(public._discount_params_valid('fixed', '{"amount": -1}'), false, 'params: fixed negativo inválido');
select is(public._discount_params_valid('fixed', '{"percent": 20}'), false, 'params: fixed sin amount inválido');
select is(public._discount_params_valid('free_shipping', '{}'), true, 'params: envío gratis sin parámetros');
select is(public._discount_params_valid('free_shipping', '{"x": 1}'), false, 'params: envío gratis no lleva parámetros');
select is(public._discount_params_valid('bogo', '{"take": 2, "pay": 1}'), true, 'params: 2×1 válido');
select is(public._discount_params_valid('bogo', '{"take": 3, "pay": 2}'), true, 'params: 3×2 válido');
select is(public._discount_params_valid('bogo', '{"take": 2, "pay": 2}'), false, 'params: pagar igual a llevar no regala nada');
select is(public._discount_params_valid('bogo', '{"take": 2, "pay": 0}'), false, 'params: pagar 0 (todo gratis) no se admite');
select is(public._discount_params_valid('bogo', '{"take": 1, "pay": 1}'), false, 'params: llevar 1 inválido');
select is(public._discount_params_valid('bogo', '{"take": 2.5, "pay": 1}'), false, 'params: cantidades enteras');
select is(public._discount_params_valid('volume', '{"tiers": [{"min_qty": 3, "percent": 5}, {"min_qty": 6, "percent": 10}]}'), true, 'params: volumen válido');
select is(public._discount_params_valid('volume', '{"tiers": [{"min_qty": 6, "percent": 5}, {"min_qty": 3, "percent": 10}]}'), false, 'params: tramos desordenados inválidos');
select is(public._discount_params_valid('volume', '{"tiers": [{"min_qty": 3, "percent": 5}, {"min_qty": 3, "percent": 10}]}'), false, 'params: dos tramos con la misma cantidad inválidos');
select is(public._discount_params_valid('volume', '{"tiers": []}'), false, 'params: volumen sin tramos inválido');
select is(public._discount_params_valid('volume', '{"tiers": [{"min_qty": 1, "percent": 5}]}'), false, 'params: un tramo desde 1 unidad no es «volumen»');
select is(public._discount_params_valid('nuevo_tipo', '{}'), false, 'params: un tipo desconocido es inválido');
select is(public._discount_params_valid('percent', null), false, 'params: nulos nunca lanzan, dan false');

-- Reducciones puras (unidad menor: 10000 = Bs 100,00; escala 100)
select is(public._discount_reductions('percent', '{"percent": 10}', array[true, true], array[0, 0]::bigint[], array[1, 1], array[10000, 5000]::bigint[], 100),
          array[1000, 500]::bigint[], 'reducciones: 10 % de 100,00 y de 50,00 = 10,00 y 5,00');
select is(public._discount_reductions('percent', '{"percent": 10}', array[true, false], array[0, 0]::bigint[], array[1, 1], array[10000, 5000]::bigint[], 100),
          array[1000, 0]::bigint[], 'reducciones: una línea NO elegible no baja');
select is(public._discount_reductions('percent', '{"percent": 33.333}', array[true], array[0]::bigint[], array[1], array[10000]::bigint[], 100),
          array[3333]::bigint[], 'reducciones: 33,333 % de 100,00 = 33,333 → se redondea a 33,33');
select is(public._discount_reductions('percent', '{"percent": 50}', array[true], array[0]::bigint[], array[1], array[5]::bigint[], 100),
          array[3]::bigint[], 'reducciones: 50 % de 0,05 = 0,025 → medio centavo se redondea hacia arriba (0,03)');
select is(public._discount_reductions('percent', '{"percent": 50, "max_amount": 20}', array[true, true], array[0, 0]::bigint[], array[1, 1], array[3000, 3000]::bigint[], 100),
          array[1000, 1000]::bigint[], 'reducciones: 50 % de 60,00 = 30,00 pero el tope es 20,00 → se reparte 10,00 y 10,00');
select is(public._discount_reductions('percent', '{"percent": 100}', array[true], array[0]::bigint[], array[1], array[4200]::bigint[], 100),
          array[4200]::bigint[], 'reducciones: 100 % baja exactamente el importe (nunca más)');
select is(public._discount_reductions('fixed', '{"amount": 15}', array[true, true], array[0, 0]::bigint[], array[1, 1], array[1000, 3000]::bigint[], 100),
          array[375, 1125]::bigint[], 'reducciones: 15,00 fijos entre 10,00 y 30,00 = 3,75 y 11,25 (proporcional)');
select is(public._discount_reductions('fixed', '{"amount": 100}', array[true, true], array[0, 0]::bigint[], array[1, 1], array[1000, 3000]::bigint[], 100),
          array[1000, 3000]::bigint[], 'reducciones: un fijo mayor que lo elegible baja todo (queda en 0), nunca negativo');
select is(public._discount_reductions('bogo', '{"take": 2, "pay": 1}', array[true, true], array[10000, 3000]::bigint[], array[1, 1], array[10000, 3000]::bigint[], 100),
          array[0, 3000]::bigint[], 'N×M: 2×1 con 100,00 y 30,00 → se regala el más barato (30,00)');
select is(public._discount_reductions('bogo', '{"take": 2, "pay": 1}', array[true], array[10000]::bigint[], array[3], array[30000]::bigint[], 100),
          array[10000]::bigint[], 'N×M: 2×1 con 3 unidades iguales → 1 grupo → 1 gratis');
select is(public._discount_reductions('bogo', '{"take": 2, "pay": 1}', array[true], array[10000]::bigint[], array[4], array[40000]::bigint[], 100),
          array[20000]::bigint[], 'N×M: 2×1 con 4 unidades → 2 grupos → 2 gratis');
select is(public._discount_reductions('bogo', '{"take": 2, "pay": 1}', array[true], array[10000]::bigint[], array[1], array[10000]::bigint[], 100),
          array[0]::bigint[], 'N×M: 1 sola unidad no completa un grupo → nada gratis');
select is(public._discount_reductions('bogo', '{"take": 3, "pay": 2}', array[true, true, true, true], array[10000, 8000, 6000, 4000]::bigint[], array[1, 1, 1, 1],
          array[10000, 8000, 6000, 4000]::bigint[], 100), array[0, 0, 6000, 0]::bigint[], 'N×M: 3×2 con 100, 80, 60, 40 → 1 grupo (100, 80, 60) → se regala el 60');
select is(public._discount_reductions('bogo', '{"take": 2, "pay": 1}', array[true, false], array[10000, 3000]::bigint[], array[1, 1], array[10000, 3000]::bigint[], 100),
          array[0, 0]::bigint[], 'N×M: una línea no elegible no entra en los grupos');
select is(public._discount_reductions('volume', '{"tiers": [{"min_qty": 3, "percent": 5}, {"min_qty": 6, "percent": 10}]}', array[true], array[1000]::bigint[], array[2], array[2000]::bigint[], 100),
          array[0]::bigint[], 'volumen: 2 unidades (< 3) → sin descuento');
select is(public._discount_reductions('volume', '{"tiers": [{"min_qty": 3, "percent": 5}, {"min_qty": 6, "percent": 10}]}', array[true], array[1000]::bigint[], array[3], array[3000]::bigint[], 100),
          array[150]::bigint[], 'volumen: justo 3 unidades (borde inclusivo) → 5 % de 30,00 = 1,50');
select is(public._discount_reductions('volume', '{"tiers": [{"min_qty": 3, "percent": 5}, {"min_qty": 6, "percent": 10}]}', array[true], array[1000]::bigint[], array[5], array[5000]::bigint[], 100),
          array[250]::bigint[], 'volumen: 5 unidades → sigue el tramo de 3 (5 %) = 2,50');
select is(public._discount_reductions('volume', '{"tiers": [{"min_qty": 3, "percent": 5}, {"min_qty": 6, "percent": 10}]}', array[true], array[1000]::bigint[], array[6], array[6000]::bigint[], 100),
          array[600]::bigint[], 'volumen: justo 6 unidades → tramo de 10 % = 6,00');
select is(public._discount_reductions('volume', '{"tiers": [{"min_qty": 3, "percent": 5}]}', array[true, true], array[1000, 1000]::bigint[], array[2, 1], array[2000, 1000]::bigint[], 100),
          array[100, 50]::bigint[], 'volumen: la cantidad se cuenta entre TODAS las líneas elegibles (2 + 1 = 3 → 5 % en cada línea)');
select is(public._discount_reductions('free_shipping', '{}', array[true], array[1000]::bigint[], array[1], array[1000]::bigint[], 100),
          array[0]::bigint[], 'reducciones: el envío gratis no baja ninguna línea');

-- ═══ B. Restricciones de las tablas ═════════════════════════════════════════════════════════
select throws_ok($$select pg_temp.dc('{"kind":"percent","params":{"percent":0},"requires_coupon":true}')$$, '23514', null, 'tabla: un porcentaje de 0 no se guarda');
select throws_ok($$select pg_temp.dc('{"kind":"percent","params":{"percent":101},"requires_coupon":true}')$$, '23514', null, 'tabla: un porcentaje de 101 no se guarda');
select throws_ok($$select pg_temp.dc('{"kind":"fixed","params":{"amount":0},"requires_coupon":true}')$$, '23514', null, 'tabla: un monto fijo de 0 no se guarda');
select throws_ok($$select pg_temp.dc('{"kind":"percent","params":{"percent":10},"requires_coupon":false}')$$, '23514', null, 'tabla: el cupón de % SIEMPRE pide código');
select throws_ok($$select pg_temp.dc('{"kind":"fixed","params":{"amount":5},"requires_coupon":false}')$$, '23514', null, 'tabla: el cupón de monto fijo SIEMPRE pide código');
select throws_ok($$select pg_temp.dc('{"kind":"bogo","params":{"take":2,"pay":1},"scope":"category","requires_coupon":true}')$$, '23514', null, 'tabla: N×M es siempre automático');
select throws_ok($$select pg_temp.dc('{"kind":"bogo","params":{"take":2,"pay":1},"scope":"order"}')$$, '23514', null, 'tabla: N×M exige producto, categoría o colección (no «todo el pedido»)');
select throws_ok($$select pg_temp.dc('{"kind":"flash","params":{"percent":10}}')$$, '23514', null, 'tabla: la oferta flash exige inicio y fin');
select throws_ok($$select pg_temp.dc('{"kind":"flash","params":{"percent":10},"starts_at":"2026-12-01T10:00:00Z","ends_at":"2026-12-01T10:00:00Z"}')$$, '23514', null, 'tabla: el fin debe ser posterior al inicio');
select throws_ok($$select pg_temp.dc('{"kind":"group_price","params":{"percent":10}}')$$, '23514', null, 'tabla: el precio por tipo de cliente exige un grupo');
select throws_ok($$select pg_temp.dc('{"kind":"percent","params":{"percent":10},"requires_coupon":true,"customer_group_id":"e9000000-0000-0000-0000-000000000001"}')$$, '23514', null, 'tabla: solo el precio de grupo lleva grupo');
select throws_ok($$select pg_temp.dc('{"kind":"free_shipping","params":{},"scope":"product"}')$$, '23514', null, 'tabla: el envío gratis es de todo el pedido');
select throws_ok($$select pg_temp.dc('{"kind":"volume","params":{"tiers":[{"min_qty":6,"percent":5},{"min_qty":3,"percent":9}]}}')$$, '23514', null, 'tabla: tramos de volumen desordenados no se guardan');
select throws_ok($$select pg_temp.dc('{"kind":"percent","params":{"percent":10},"requires_coupon":true,"usage_limit_total":0}')$$, '23514', null, 'tabla: un tope de usos de 0 no se guarda');
select throws_ok($$select pg_temp.dc('{"kind":"percent","params":{"percent":10},"requires_coupon":true,"priority":-1}')$$, '23514', null, 'tabla: prioridad fuera de rango');
select throws_ok($$select pg_temp.dc('{"kind":"percent","params":{"percent":10},"requires_coupon":true,"currency":"XXX"}')$$, '23503', null, 'tabla: la moneda debe existir');
select lives_ok($$select pg_temp.dc('{"name":"Válido","kind":"percent","params":{"percent":10},"requires_coupon":true}')$$, 'tabla: un porcentaje de 10 con código se guarda');

-- objetivos
select throws_ok($$select pg_temp.tg((select id from public.discounts limit 1), 'product', pg_temp.p(1))$$, '23514', null, 'objetivos: un descuento «de todo el pedido» no lleva objetivos');
select pg_temp.wipe();
select pg_temp.dc('{"id":"11000000-0000-0000-0000-000000000001","name":"De producto","kind":"percent","params":{"percent":10},"requires_coupon":true,"scope":"product"}');
select throws_ok($$select pg_temp.tg('11000000-0000-0000-0000-000000000001', 'category', 'c9000000-0000-0000-0000-000000000001')$$, '23514', null, 'objetivos: una categoría no sirve en un descuento de alcance «producto»');
select lives_ok($$select pg_temp.tg('11000000-0000-0000-0000-000000000001', 'product', pg_temp.p(1))$$, 'objetivos: el producto sí');
select throws_ok($$select pg_temp.tg('11000000-0000-0000-0000-000000000001', 'product', pg_temp.p(1))$$, '23505', null, 'objetivos: el mismo producto dos veces no se guarda');
select throws_ok($$insert into public.discount_targets (discount_id, product_id, category_id) values ('11000000-0000-0000-0000-000000000001', pg_temp.p(2), 'c9000000-0000-0000-0000-000000000001')$$, '23514', null, 'objetivos: exactamente UNO de producto, categoría o colección');

-- cupones
select throws_ok($$select pg_temp.cp('11000000-0000-0000-0000-000000000001', 'AB')$$, '23514', null, 'cupón: código demasiado corto');
-- «A--», «AB-C» y «1-0» pasan la forma de arriba pero normalizan a 1, 3 y 2 caracteres: se adivinan en decenas de intentos
select throws_ok($$select pg_temp.cp('11000000-0000-0000-0000-000000000001', 'A--')$$, '23514', null, 'cupón: «A--» normaliza a 1 carácter y no se guarda');
select throws_ok($$select pg_temp.cp('11000000-0000-0000-0000-000000000001', 'AB-C')$$, '23514', null, 'cupón: «AB-C» normaliza a «ABC» (3 caracteres) y no se guarda');
select throws_ok($$select pg_temp.cp('11000000-0000-0000-0000-000000000001', '1-0')$$, '23514', null, 'cupón: «1-0» normaliza a «10» (2 caracteres) y no se guarda');
select lives_ok($$select pg_temp.cp('11000000-0000-0000-0000-000000000001', 'AB-CD')$$, 'cupón: «AB-CD» normaliza a «ABCD» (4 caracteres, el mínimo) y sí se guarda');
delete from public.coupons where code = 'AB-CD';
select throws_ok($$select pg_temp.cp('11000000-0000-0000-0000-000000000001', 'CON ESPACIO')$$, '23514', null, 'cupón: el código no lleva espacios');
select throws_ok($$select pg_temp.cp('11000000-0000-0000-0000-000000000001', 'Ñandú10')$$, '23514', null, 'cupón: solo letras sin tilde, números y guion');
select lives_ok($$select pg_temp.cp('11000000-0000-0000-0000-000000000001', 'Verano-10')$$, 'cupón: «Verano-10» se guarda');
select throws_ok($$select pg_temp.cp('11000000-0000-0000-0000-000000000001', 'VERANO10')$$, '23505', null, 'cupón: «VERANO10» es el MISMO código normalizado que «Verano-10»');
select throws_ok($$select pg_temp.cp('11000000-0000-0000-0000-000000000001', 'VERAN0-1O')$$, '23505', null, 'cupón: tampoco se puede duplicar con 0/O y 1/O confundibles');
select throws_ok($$select pg_temp.cp('11000000-0000-0000-0000-000000000001', 'VENTANA01', '{"starts_at":"2026-12-01T10:00:00Z","ends_at":"2026-12-01T10:00:00Z"}')$$, '23514', null, 'cupón: el fin de su vigencia debe ser posterior al inicio');
select throws_ok($$select pg_temp.cp('11000000-0000-0000-0000-000000000001', 'VENTANA02', '{"starts_at":"2026-12-02T10:00:00Z","ends_at":"2026-12-01T10:00:00Z"}')$$, '23514', null, 'cupón: ni un fin anterior al inicio');
select lives_ok($$select pg_temp.cp('11000000-0000-0000-0000-000000000001', 'VENTANA03', '{"starts_at":"2026-12-01T10:00:00Z","ends_at":"2026-12-01T10:00:01Z"}')$$, 'cupón: un segundo de vigencia ya es una ventana válida');
select is((select code_normalized from public.coupons where code = 'Verano-10'), 'VERAN010', 'cupón: queda guardada la forma normalizada');
select pg_temp.dc('{"id":"11000000-0000-0000-0000-000000000002","name":"Automático","kind":"flash","params":{"percent":10},"starts_at":"2026-12-01T10:00:00Z","ends_at":"2026-12-02T10:00:00Z"}');
select throws_ok($$select pg_temp.cp('11000000-0000-0000-0000-000000000002', 'NOCODIGO')$$, '23514', null, 'cupón: un descuento automático (no pide código) no puede tener cupones');
select pg_temp.wipe();

-- ═══ C. El motor ════════════════════════════════════════════════════════════════════════════
-- ── C1. Cupón de porcentaje ──
-- L12 = 200,00 + 50,00. 10 %: 20,00 + 5,00 = 25,00 → total 225,00.
select pg_temp.pc('SAVE10', 10);
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), 'save-10')), 25.00, 'porcentaje: 10 % de 250,00 = 25,00 (el código se normaliza)');
select is(pg_temp.tot(pg_temp.ev(pg_temp.l('L12'), 'save-10')), 225.00, 'porcentaje: total 225,00');
select is(pg_temp.ld(pg_temp.ev(pg_temp.l('L12'), 'SAVE10'), 1), 20.00, 'porcentaje: línea 1 baja 20,00');
select is(pg_temp.ld(pg_temp.ev(pg_temp.l('L12'), 'SAVE10'), 2), 5.00, 'porcentaje: línea 2 baja 5,00');
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), 'SAVE10')), 'applied', 'porcentaje: el cupón queda «applied»');
select is(pg_temp.ev(pg_temp.l('L12'), 'SAVE10') #>> '{coupon,code}', 'SAVE10', 'porcentaje: devuelve el código canónico');
select is(jsonb_array_length(pg_temp.ev(pg_temp.l('L12'), 'SAVE10') -> 'applied'), 1, 'porcentaje: una sola entrada en «applied»');
select is(pg_temp.ev(pg_temp.l('L12'), 'SAVE10') #>> '{applied,0,automatic}', 'false', 'porcentaje: no es automático');
select is(jsonb_array_length(pg_temp.ev(pg_temp.l('L12'), 'SAVE10') -> 'rejected'), 0, 'porcentaje: nada rechazado');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'))), 0.00, 'sin cupón escrito: un cupón NO se aplica solo');
select is(pg_temp.tot(pg_temp.ev(pg_temp.l('L12'))), 250.00, 'sin cupón: el total es el subtotal');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), '')), 0.00, 'código vacío = sin cupón');
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), '   ')), 'none', 'solo espacios = sin cupón (no es un rechazo)');
-- Redondeo POR LÍNEA, suma exacta: 33,33 + 33,33 + 33,34 al 10 %: 3,333 → 3,33 · 3,333 → 3,33 · 3,334 → 3,33 = 9,99 (no 10,00)
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 33.33, 1), pg_temp.ln(2, 2, 33.33, 1), pg_temp.ln(3, 3, 33.34, 1)), 'SAVE10')), 9.99,
          'redondeo: por línea y suma exacta (9,99; no 10,00 sobre el total)');
select is(pg_temp.tot(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 33.33, 1), pg_temp.ln(2, 2, 33.33, 1), pg_temp.ln(3, 3, 33.34, 1)), 'SAVE10')), 90.01,
          'redondeo: total 90,01');
-- 100 %
select pg_temp.pc('GRATIS100', 100);
select is(pg_temp.tot(pg_temp.ev(pg_temp.l('L12'), 'GRATIS100')), 0.00, '100 %: el total es 0,00');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), 'GRATIS100')), 250.00, '100 %: el descuento es exactamente el subtotal (nunca más)');
-- Con tope de monto: 50 % de 250,00 = 125,00 pero el tope es 20,00
select pg_temp.dc('{"name":"Tope","kind":"percent","params":{"percent":50,"max_amount":20},"requires_coupon":true,"id":"12000000-0000-0000-0000-000000000001"}');
select pg_temp.cp('12000000-0000-0000-0000-000000000001', 'TOPE20');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), 'TOPE20')), 20.00, 'porcentaje con tope: no pasa de 20,00');

-- ── C2. Cupón de monto fijo ──
select pg_temp.dc('{"name":"Fijo 20","kind":"fixed","params":{"amount":20},"requires_coupon":true,"id":"12000000-0000-0000-0000-000000000002"}');
select pg_temp.cp('12000000-0000-0000-0000-000000000002', 'FIJO20');
-- 20,00 entre 200,00 y 50,00 en proporción: 16,00 y 4,00 → total 230,00
select is(pg_temp.ld(pg_temp.ev(pg_temp.l('L12'), 'FIJO20'), 1), 16.00, 'fijo: línea 1 baja 16,00 (proporcional)');
select is(pg_temp.ld(pg_temp.ev(pg_temp.l('L12'), 'FIJO20'), 2), 4.00, 'fijo: línea 2 baja 4,00');
select is(pg_temp.tot(pg_temp.ev(pg_temp.l('L12'), 'FIJO20')), 230.00, 'fijo: total 230,00');
select pg_temp.dc('{"name":"Fijo enorme","kind":"fixed","params":{"amount":1000},"requires_coupon":true,"id":"12000000-0000-0000-0000-000000000003"}');
select pg_temp.cp('12000000-0000-0000-0000-000000000003', 'FIJO1000');
select is(pg_temp.tot(pg_temp.ev(pg_temp.l('L12'), 'FIJO1000')), 0.00, 'fijo > subtotal: el total queda en 0,00 (nunca negativo)');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), 'FIJO1000')), 250.00, 'fijo > subtotal: el descuento se limita al subtotal');
-- 10,00 fijos entre tres líneas de 10,00: 3,333… → 3,34 + 3,33 + 3,33 = 10,00 EXACTO
select pg_temp.dc('{"name":"Fijo 10","kind":"fixed","params":{"amount":10},"requires_coupon":true,"id":"12000000-0000-0000-0000-000000000004"}');
select pg_temp.cp('12000000-0000-0000-0000-000000000004', 'FIJO10');
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 10, 1), pg_temp.ln(2, 2, 10, 1), pg_temp.ln(3, 3, 10, 1)), 'FIJO10')), 10.00,
          'fijo: el reparto entre líneas suma EXACTAMENTE 10,00');
select is(pg_temp.ld(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 10, 1), pg_temp.ln(2, 2, 10, 1), pg_temp.ln(3, 3, 10, 1)), 'FIJO10'), 1), 3.34,
          'fijo: el centavo que sobra va a la primera línea (3,34 + 3,33 + 3,33)');

-- ── C3. Alcance: producto, categoría y colección ──
select pg_temp.dc('{"name":"Solo P2","kind":"fixed","params":{"amount":20},"requires_coupon":true,"scope":"product","id":"12000000-0000-0000-0000-000000000005"}');
select pg_temp.tg('12000000-0000-0000-0000-000000000005', 'product', pg_temp.p(2));
select pg_temp.cp('12000000-0000-0000-0000-000000000005', 'SOLOP2');
select is(pg_temp.ld(pg_temp.ev(pg_temp.l('L12'), 'SOLOP2'), 2), 20.00, 'producto: el fijo de 20,00 baja SOLO la línea de P2');
select is(pg_temp.ld(pg_temp.ev(pg_temp.l('L12'), 'SOLOP2'), 1), 0.00, 'producto: la línea de P1 no baja');
select pg_temp.dc('{"name":"Categoría C1","kind":"percent","params":{"percent":10},"requires_coupon":true,"scope":"category","id":"12000000-0000-0000-0000-000000000006"}');
select pg_temp.tg('12000000-0000-0000-0000-000000000006', 'category', 'c9000000-0000-0000-0000-000000000001');
select pg_temp.cp('12000000-0000-0000-0000-000000000006', 'CAT10');
-- P1 (100,00) está en C1; P3 (80,00) no → 10 % de 100,00 = 10,00
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1), pg_temp.ln(2, 3, 80, 1)), 'CAT10')), 10.00, 'categoría: solo baja la línea cuyo producto está en la categoría');
select pg_temp.dc('{"name":"Colección K1","kind":"percent","params":{"percent":10},"requires_coupon":true,"scope":"collection","id":"12000000-0000-0000-0000-000000000007"}');
select pg_temp.tg('12000000-0000-0000-0000-000000000007', 'collection', 'd9000000-0000-0000-0000-000000000001');
select pg_temp.cp('12000000-0000-0000-0000-000000000007', 'COL10');
-- P3 (80,00) está en K1; P1 no → 8,00
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1), pg_temp.ln(2, 3, 80, 1)), 'COL10')), 8.00, 'colección: solo baja la línea cuyo producto está en la colección');
select is(pg_temp.reason(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 5, 100, 1)), 'COL10')), 'not_applicable', 'alcance: sin productos elegibles → «no aplica a tus productos»');
select is(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 5, 100, 1)), 'col-10') #>> '{coupon,code}', 'COL10', 'alcance: «not_applicable» muestra el código canónico, no lo escrito');
select is(pg_temp.cst(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 5, 100, 1)), 'COL10')), 'rejected', 'alcance: y el cupón queda rechazado');
-- una colección archivada deja de contar (P3 sí está en K1, pero K1 ya no existe para el público)
update public.collections set archived_at = now() where id = 'd9000000-0000-0000-0000-000000000001';
select is(pg_temp.reason(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 3, 80, 1)), 'COL10')), 'not_applicable', 'colección ARCHIVADA: ya no alcanza a sus productos');
update public.collections set archived_at = null where id = 'd9000000-0000-0000-0000-000000000001';
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 3, 80, 1)), 'COL10')), 8.00, 'colección restaurada: vuelve a alcanzar (10 % de 80,00 = 8,00)');
-- una categoría archivada deja de contar
update public.categories set archived_at = now() where id = 'c9000000-0000-0000-0000-000000000001';
select is(pg_temp.reason(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1)), 'CAT10')), 'not_applicable', 'categoría ARCHIVADA: ya no alcanza a sus productos');
update public.categories set archived_at = null where id = 'c9000000-0000-0000-0000-000000000001';
-- un objetivo archivado deja de contar
update public.discount_targets set archived_at = now() where discount_id = '12000000-0000-0000-0000-000000000005';
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'SOLOP2')), 'not_applicable', 'objetivo archivado: ya no cuenta');

-- ── C4. Monto mínimo ──
select pg_temp.pc('MIN300', 10, '{"min_order_amount": 300}');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'MIN300')), 'min_not_reached', 'mínimo: con 250,00 no llega a 300,00');
select is(pg_temp.ev(pg_temp.l('L12'), 'min-300') #>> '{coupon,code}', 'MIN300', 'mínimo: «min_not_reached» muestra el código canónico, no lo escrito');
select is(pg_temp.ev(pg_temp.l('L12'), 'min-300') #>> '{rejected,0,code}', 'MIN300', 'mínimo: …y la lista de rechazados también');
select is((pg_temp.ev(pg_temp.l('L12'), 'MIN300') #>> '{coupon,missing}')::numeric, 50.00, 'mínimo: avisa que faltan 50,00');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), 'MIN300')), 0.00, 'mínimo: sin llegar, no baja nada');
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 3)), 'MIN300')), 30.00, 'mínimo: con 300,00 EXACTOS aplica (borde inclusivo)');
select is((pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 299.99, 1)), 'MIN300') #>> '{coupon,missing}')::numeric, 0.01, 'mínimo: con 299,99 falta 0,01');

-- ── C5. Envío gratis sobre un monto (automático) ──
select pg_temp.wipe();
select pg_temp.dc('{"name":"Envío gratis 200","kind":"free_shipping","params":{},"min_order_amount":200,"id":"13000000-0000-0000-0000-000000000001"}');
select is(pg_temp.ev(pg_temp.l('L12')) ->> 'free_shipping', 'true', 'envío gratis: con 250,00 (≥ 200,00) hay envío gratis');
select is((pg_temp.ev(pg_temp.l('L12'), null, null, 15) #>> '{totals,shipping_discount}')::numeric, 15.00, 'envío gratis: con envío de 15,00 se descuenta 15,00');
select is((pg_temp.ev(pg_temp.l('L12'), null, null, 15) #>> '{totals,grand_total}')::numeric, 250.00, 'envío gratis: total con envío = 250,00 + 15,00 − 15,00');
select is(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 199.99, 1))) ->> 'free_shipping', 'false', 'envío gratis: con 199,99 no');
select is((pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 199.99, 1)), null, null, 15) #>> '{totals,grand_total}')::numeric, 214.99, 'envío gratis: sin llegar se paga el envío (199,99 + 15,00)');
select is(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 200, 1))) ->> 'free_shipping', 'true', 'envío gratis: con 200,00 EXACTOS sí (borde inclusivo)');
-- El umbral se evalúa DESPUÉS de los descuentos: 210,00 con un cupón de 10 % queda en 189,00 → ya no hay envío gratis.
select pg_temp.pc('SAVE10', 10);
select is(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 210, 1)), 'SAVE10') ->> 'free_shipping', 'false', 'envío gratis: el umbral va DESPUÉS del descuento (210,00 − 10 % = 189,00 < 200,00)');
select is(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 250, 1)), 'SAVE10') ->> 'free_shipping', 'true', 'envío gratis: 250,00 − 10 % = 225,00 ≥ 200,00 → sí');
select is(jsonb_array_length(pg_temp.ev(pg_temp.l('L12')) -> 'applied'), 1, 'envío gratis: aparece en «applied»');
select is(pg_temp.ev(pg_temp.l('L12')) #>> '{applied,0,free_shipping}', 'true', '…marcado como envío gratis');

-- ── C6. Envío gratis con cupón ──
select pg_temp.dc('{"name":"Cupón envío","kind":"free_shipping","params":{},"min_order_amount":100,"requires_coupon":true,"id":"13000000-0000-0000-0000-000000000002"}');
select pg_temp.cp('13000000-0000-0000-0000-000000000002', 'ENVIO');
-- Automático (mínimo 200,00) y cupón (mínimo 100,00):
--   150,00 → el automático aún no aplica; el cupón sí (150,00 ≥ 100,00) · 250,00 → ya hay envío gratis: el cupón NO se gasta · 90,00 → faltan 10,00
select is(pg_temp.cst(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 150, 1)), 'ENVIO')), 'applied', 'cupón de envío: con 150,00 el cupón da el envío gratis');
select is((pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 150, 1)), 'ENVIO', null, 15) #>> '{totals,shipping_discount}')::numeric, 15.00, 'cupón de envío: descuenta los 15,00 del envío');
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 150, 1)), 'ENVIO')), 0.00, 'cupón de envío: no baja ninguna línea');
select is(pg_temp.reason(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 250, 1)), 'ENVIO')), 'not_combinable', 'cupón de envío: con envío gratis ya automático, el cupón NO se gasta');
select is(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 250, 1)), 'envio') #>> '{coupon,code}', 'ENVIO', 'cupón de envío: «no combinable» muestra el código canónico, no lo escrito');
select is(pg_temp.reason(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 90, 1)), 'ENVIO')), 'min_not_reached', 'cupón de envío: con 90,00 no llega al mínimo');
select is((pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 90, 1)), 'ENVIO') #>> '{coupon,missing}')::numeric, 10.00, 'cupón de envío: faltan 10,00');

-- ── C7. N×M (2×1 y 3×2) ──
select pg_temp.wipe();
select pg_temp.dc('{"name":"2x1 en C1","kind":"bogo","params":{"take":2,"pay":1},"scope":"category","id":"14000000-0000-0000-0000-000000000001"}');
select pg_temp.tg('14000000-0000-0000-0000-000000000001', 'category', 'c9000000-0000-0000-0000-000000000001');
-- P1 100,00 + P2 60,00 → se regala el más barato (60,00)
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1), pg_temp.ln(2, 2, 60, 1)))), 60.00, '2×1: con 100,00 y 60,00 se regala el más barato');
select is(pg_temp.ld(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1), pg_temp.ln(2, 2, 60, 1))), 2), 60.00, '2×1: la línea regalada es la barata');
select is(pg_temp.tot(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1), pg_temp.ln(2, 2, 60, 1)))), 100.00, '2×1: total 100,00');
select is(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1), pg_temp.ln(2, 2, 60, 1))) #>> '{applied,0,automatic}', 'true', '2×1: es automático (sin código)');
-- cantidad impar: 3 × 100,00 → 1 grupo → 1 gratis (100,00); 4 × → 2 gratis
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 3)))), 100.00, '2×1: 3 unidades iguales → solo 1 gratis (cantidad impar)');
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 4)))), 200.00, '2×1: 4 unidades → 2 gratis');
-- una sola unidad elegible + una no elegible → no completa grupo
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1), pg_temp.ln(2, 3, 50, 1)))), 0.00, '2×1: la unidad de un producto fuera de la categoría no completa el grupo');
-- mismo producto, otra variante (otra línea) y precios distintos: 100,00 · 60,00 · 40,00 → grupo (100, 60) → se regala 60,00; el 40,00 queda sin pareja
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1), pg_temp.ln(2, 2, 60, 1), pg_temp.ln(3, 2, 40, 1)))), 60.00, '2×1: con tres líneas y precios distintos se regala el más barato DEL GRUPO (60,00), no el más barato de todos');
-- 3×2 sobre el producto P1 solo (sin el 2×1 de arriba): 100 · 80 · 60 · 40 en cuatro líneas → grupo (100, 80, 60) → 60,00
select pg_temp.wipe();
select pg_temp.dc('{"name":"3x2 en P1","kind":"bogo","params":{"take":3,"pay":2},"scope":"product","priority":300,"id":"14000000-0000-0000-0000-000000000002"}');
select pg_temp.tg('14000000-0000-0000-0000-000000000002', 'product', pg_temp.p(1));
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1), pg_temp.ln(2, 1, 80, 1), pg_temp.ln(3, 1, 60, 1), pg_temp.ln(4, 1, 40, 1)))), 60.00,
          '3×2 con 100, 80, 60, 40 → un grupo de 3 → se regala el de 60,00; el 40,00 no completa otro grupo');
select pg_temp.wipe();

-- ── C8. Volumen ──
select pg_temp.dc('{"name":"Volumen","kind":"volume","params":{"tiers":[{"min_qty":3,"percent":5},{"min_qty":6,"percent":10}]},"id":"15000000-0000-0000-0000-000000000001"}');
-- L12 tiene 2 + 1 = 3 unidades → tramo de 5 %: 10,00 + 2,50 = 12,50 → total 237,50
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'))), 12.50, 'volumen: 3 unidades (borde del tramo) → 5 % de 250,00 = 12,50');
select is(pg_temp.tot(pg_temp.ev(pg_temp.l('L12'))), 237.50, 'volumen: total 237,50');
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 2)))), 0.00, 'volumen: 2 unidades no llegan al primer tramo');
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 6)))), 60.00, 'volumen: 6 unidades (borde del 2.º tramo) → 10 % de 600,00 = 60,00');
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 5)))), 25.00, 'volumen: 5 unidades siguen en el tramo de 5 % = 25,00');

-- Un entero escrito «2.0» es válido para el CHECK y jsonb conserva la escala: el motor NO debe castear el texto '2.0' a int
-- (lanzaba 22P02 y rompía la lectura de TODOS los carritos mientras el descuento estuviera activo).
select pg_temp.wipe();
select pg_temp.dc('{"id":"15000000-0000-0000-0000-000000000002","name":"Volumen 2.0","kind":"volume","params":{"tiers":[{"min_qty":2.0,"percent":10.0}]}}');
select is((select params #>> '{tiers,0,min_qty}' from public.discounts where id = '15000000-0000-0000-0000-000000000002'), '2.0', 'enteros «2.0»: jsonb conserva la escala (la prueba ejerce el caso peligroso)');
-- L12 tiene 3 unidades ≥ 2 → 10 % de 250,00 = 25,00
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'))), 25.00, 'volumen con «2.0»: 3 unidades ≥ 2 → 10 % de 250,00 = 25,00 (no lanza)');
select pg_temp.wipe();
select pg_temp.dc('{"id":"15000000-0000-0000-0000-000000000003","name":"Bogo 2.0","kind":"bogo","params":{"take":2.0,"pay":1.0},"scope":"product"}');
select pg_temp.tg('15000000-0000-0000-0000-000000000003', 'product', pg_temp.p(1));
select is((select params ->> 'take' from public.discounts where id = '15000000-0000-0000-0000-000000000003'), '2.0', 'enteros «2.0»: el 2×1 también conserva la escala');
-- P1 100,00 × 2 con 2×1 → se regala una unidad = 100,00 (P2 no es objetivo)
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'))), 100.00, 'N×M con «2.0» y «1.0»: regala 100,00 (no lanza)');
select pg_temp.wipe();

-- ── C9. Precio por tipo de cliente ──
select pg_temp.wipe();
select pg_temp.dc('{"name":"Mayoristas 15 %","kind":"group_price","params":{"percent":15},"customer_group_id":"e9000000-0000-0000-0000-000000000001","id":"16000000-0000-0000-0000-000000000001"}');
-- 15 % de 200,00 = 30,00 y de 50,00 = 7,50 → 37,50
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, 'a9000000-0000-0000-0000-00000000000a')), 37.50, 'grupo: una clienta DEL grupo paga 15 % menos (37,50)');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, 'a9000000-0000-0000-0000-00000000000b')), 0.00, 'grupo: una clienta que NO es del grupo no tiene descuento');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'))), 0.00, 'grupo: un invitado (sin cuenta) no tiene descuento');
-- si la clienta sale del grupo en pleno carrito, deja de aplicar
update public.customer_group_members set archived_at = now() where profile_id = 'a9000000-0000-0000-0000-00000000000a';
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, 'a9000000-0000-0000-0000-00000000000a')), 0.00, 'grupo: si la sacan del grupo, el precio especial deja de aplicar');
update public.customer_group_members set archived_at = null where profile_id = 'a9000000-0000-0000-0000-00000000000a';
update public.customer_groups set archived_at = now() where id = 'e9000000-0000-0000-0000-000000000001';
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, 'a9000000-0000-0000-0000-00000000000a')), 0.00, 'grupo: un grupo ARCHIVADO no da descuento');
update public.customer_groups set archived_at = null where id = 'e9000000-0000-0000-0000-000000000001';

-- ── C10. Oferta flash: vigencia exacta ──
select pg_temp.wipe();
select pg_temp.dc('{"name":"Flash 20 %","kind":"flash","params":{"percent":20},"starts_at":"2026-12-01T10:00:00Z","ends_at":"2026-12-01T12:00:00Z","id":"17000000-0000-0000-0000-000000000001"}');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, null, null, timestamptz '2026-12-01 10:00:00+00')), 50.00, 'flash: justo al inicio (borde inclusivo) aplica 20 % de 250,00 = 50,00');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, null, null, timestamptz '2026-12-01 09:59:59+00')), 0.00, 'flash: un segundo ANTES del inicio no aplica');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, null, null, timestamptz '2026-12-01 11:59:59+00')), 50.00, 'flash: un segundo antes del fin aplica');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, null, null, timestamptz '2026-12-01 12:00:00+00')), 0.00, 'flash: justo al fin (exclusivo) ya no aplica');
-- la vigencia es un instante absoluto: 10:00 UTC = 06:00 en La Paz (UTC−4)
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, null, null, timestamptz '2026-12-01 06:00:00-04')), 50.00, 'flash: la hora se interpreta con zona horaria (06:00 en La Paz = 10:00 UTC)');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, null, null, timestamptz '2026-12-01 05:59:59-04')), 0.00, 'flash: 05:59:59 en La Paz es antes del inicio');

-- ── C11. Primera compra ──
select pg_temp.wipe();
select pg_temp.dc('{"name":"Primera compra 10 %","kind":"first_purchase","params":{"percent":10},"id":"18000000-0000-0000-0000-000000000001"}');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, 'a9000000-0000-0000-0000-00000000000a')), 25.00, 'primera compra: una clienta sin pedidos tiene 10 % (25,00)');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'))), 0.00, 'primera compra: un invitado no se puede verificar → no aplica solo');
-- cuando existan pedidos (S10 redefine la función): con un pedido previo ya no aplica
create or replace function public._customer_order_count(p_profile_id uuid) returns int language sql stable security definer set search_path = '' as $$ select 1 $$;
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, 'a9000000-0000-0000-0000-00000000000a')), 0.00, 'primera compra: con un pedido no cancelado previo ya no aplica');
create or replace function public._customer_order_count(p_profile_id uuid) returns int language sql stable security definer set search_path = '' as $$ select 0 $$;

-- ── C12. Dos ofertas automáticas sobre la misma línea: gana la mejor, nunca se suman ──
select pg_temp.wipe();
select pg_temp.dc('{"name":"Flash 10 %","kind":"flash","params":{"percent":10},"starts_at":"2026-12-01T10:00:00Z","ends_at":"2026-12-01T12:00:00Z"}');
select pg_temp.dc('{"name":"Volumen","kind":"volume","params":{"tiers":[{"min_qty":3,"percent":5}]}}');
-- L12 (3 unidades): flash 10 % = 20,00 + 5,00; volumen 5 % = 10,00 + 2,50 → por línea gana el flash → 25,00 (NO 37,50)
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, null, null, timestamptz '2026-12-01 11:00:00+00')), 25.00, 'ofertas: entre flash 10 % y volumen 5 % gana la mejor por línea (25,00), sin sumar');
select is(jsonb_array_length(pg_temp.ev(pg_temp.l('L12'), null, null, null, timestamptz '2026-12-01 11:00:00+00') #> '{lines,0,offers}'), 1, 'ofertas: la línea muestra UNA sola oferta');
select is(pg_temp.ev(pg_temp.l('L12'), null, null, null, timestamptz '2026-12-01 11:00:00+00') #>> '{lines,0,offers,0,name}', 'Flash 10 %', 'ofertas: y es la ganadora');
-- fuera de la vigencia del flash solo queda el volumen: 12,50
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, null, null, timestamptz '2026-12-02 11:00:00+00')), 12.50, 'ofertas: vencido el flash queda el volumen (12,50)');
-- empate exacto: gana la de mayor prioridad
select pg_temp.wipe();
select pg_temp.dc('{"name":"Flash baja","kind":"flash","params":{"percent":10},"starts_at":"2026-12-01T10:00:00Z","ends_at":"2026-12-01T12:00:00Z","priority":100}');
select pg_temp.dc('{"name":"Flash alta","kind":"flash","params":{"percent":10},"starts_at":"2026-12-01T10:00:00Z","ends_at":"2026-12-01T12:00:00Z","priority":200}');
select is(pg_temp.ev(pg_temp.l('L12'), null, null, null, timestamptz '2026-12-01 11:00:00+00') #>> '{lines,0,offers,0,name}', 'Flash alta', 'ofertas: con el mismo descuento gana la de mayor prioridad');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, null, null, timestamptz '2026-12-01 11:00:00+00')), 25.00, 'ofertas: y el descuento no se duplica (25,00)');

-- ── C13. Cupón + ofertas automáticas (acumulable o la mejor de las dos) ──
select pg_temp.wipe();
select pg_temp.dc('{"name":"Flash 10 %","kind":"flash","params":{"percent":10},"starts_at":"2026-12-01T10:00:00Z","ends_at":"2026-12-01T12:00:00Z"}');
-- ahora = 11:00: el flash baja 20,00 + 5,00 = 25,00 (ofertas: l1 18000, l2 4500)
-- ACUMULABLE (stackable) 10 %: sobre lo ya rebajado → 18,00 + 4,50 = 22,50 → descuento total 47,50 → total 202,50
select pg_temp.pc('ACUM10', 10, '{"stackable_with_automatic": true}');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), 'ACUM10', null, null, timestamptz '2026-12-01 11:00:00+00')), 47.50, 'cupón acumulable: 25,00 de la oferta + 10 % de lo ya rebajado (22,50) = 47,50');
select is(pg_temp.tot(pg_temp.ev(pg_temp.l('L12'), 'ACUM10', null, null, timestamptz '2026-12-01 11:00:00+00')), 202.50, 'cupón acumulable: total 202,50');
select is(jsonb_array_length(pg_temp.ev(pg_temp.l('L12'), 'ACUM10', null, null, timestamptz '2026-12-01 11:00:00+00') #> '{lines,0,offers}'), 2, 'cupón acumulable: la línea muestra las DOS (oferta y cupón)');
select is(jsonb_array_length(pg_temp.ev(pg_temp.l('L12'), 'ACUM10', null, null, timestamptz '2026-12-01 11:00:00+00') -> 'applied'), 2, 'cupón acumulable: «applied» trae oferta y cupón');
-- NO acumulable 10 %: cupón 25,00 contra oferta 25,00 → empate → ganan las ofertas y el cupón NO gasta su uso
select pg_temp.pc('SOLO10', 10);
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'SOLO10', null, null, timestamptz '2026-12-01 11:00:00+00')), 'not_combinable', 'cupón no acumulable: con empate gana la oferta y el cupón se rechaza «no combinable»');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), 'SOLO10', null, null, timestamptz '2026-12-01 11:00:00+00')), 25.00, 'cupón no acumulable: queda la oferta (25,00)');
select is(pg_temp.ev(pg_temp.l('L12'), 'SOLO10', null, null, timestamptz '2026-12-01 11:00:00+00') #>> '{applied,0,automatic}', 'true', 'cupón no acumulable: lo aplicado es la oferta automática');
-- NO acumulable 20 %: cupón 50,00 > oferta 25,00 → gana el cupón y la oferta se descarta (no se suman)
select pg_temp.pc('SOLO20', 20);
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), 'SOLO20', null, null, timestamptz '2026-12-01 11:00:00+00')), 50.00, 'cupón no acumulable mejor: 20 % de 250,00 = 50,00 (la oferta se descarta, no se suma)');
select is(jsonb_array_length(pg_temp.ev(pg_temp.l('L12'), 'SOLO20', null, null, timestamptz '2026-12-01 11:00:00+00') -> 'applied'), 1, 'cupón no acumulable mejor: solo el cupón en «applied»');
select is(jsonb_array_length(pg_temp.ev(pg_temp.l('L12'), 'SOLO20', null, null, timestamptz '2026-12-01 11:00:00+00') #> '{lines,0,offers}'), 1, 'cupón no acumulable mejor: la línea muestra una sola oferta');
-- sin oferta vigente (13:00) el cupón no acumulable simplemente aplica
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), 'SOLO10', null, null, timestamptz '2026-12-01 13:00:00+00')), 25.00, 'sin oferta vigente, el cupón no acumulable aplica normal (25,00)');
-- Productos ya rebajados: el cupón acumulable con exclude_sale_items NO toca las líneas con oferta
select pg_temp.wipe();
select pg_temp.dc('{"name":"Flash P1","kind":"bogo","params":{"take":2,"pay":1},"scope":"product","id":"19000000-0000-0000-0000-000000000001"}');
select pg_temp.tg('19000000-0000-0000-0000-000000000001', 'product', pg_temp.p(1));
select pg_temp.pc('NOSALE', 10, '{"stackable_with_automatic": true, "exclude_sale_items": true}');
-- P1 100,00 × 2 (2×1: se regala 100,00 → línea 1 queda con oferta) y P2 50,00 × 1: el cupón solo toca P2 → 5,00
select is(pg_temp.ld(pg_temp.ev(pg_temp.l('L12'), 'NOSALE'), 1), 100.00, 'sin rebajados: la línea con oferta solo tiene la oferta (100,00)');
select is(pg_temp.ld(pg_temp.ev(pg_temp.l('L12'), 'NOSALE'), 2), 5.00, 'sin rebajados: el cupón del 10 % toca solo la línea sin oferta (5,00)');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), 'NOSALE')), 105.00, 'sin rebajados: descuento total 105,00');
select pg_temp.wipe();

-- «No aplicar a productos ya rebajados» con un cupón que NO se acumula: el cupón y la oferta tocan líneas DISTINTAS, así que
-- no compiten: la oferta de la línea excluida NO se descarta (quitársela sería tocarla).
-- P1 100,00 × 1 con flash del 10 % (10,00) y P2 200,00 × 1 sin oferta. Cupón del 20 % solo sobre P2 = 40,00.
select pg_temp.dc('{"id":"19000000-0000-0000-0000-000000000002","name":"Flash P1","kind":"flash","params":{"percent":10},"scope":"product","starts_at":"2026-12-01T10:00:00Z","ends_at":"2026-12-01T12:00:00Z"}');
select pg_temp.tg('19000000-0000-0000-0000-000000000002', 'product', pg_temp.p(1));
select pg_temp.pc('NOSALE2', 20, '{"exclude_sale_items": true}');
select is(pg_temp.cst(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1), pg_temp.ln(2, 2, 200, 1)), 'NOSALE2', null, null, timestamptz '2026-12-01 11:00:00+00')), 'applied', 'sin rebajados (no acumulable): el cupón aplica');
select is(pg_temp.ld(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1), pg_temp.ln(2, 2, 200, 1)), 'NOSALE2', null, null, timestamptz '2026-12-01 11:00:00+00'), 1), 10.00, 'sin rebajados (no acumulable): la línea con oferta CONSERVA su oferta (10,00; antes se descartaba)');
select is(pg_temp.ld(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1), pg_temp.ln(2, 2, 200, 1)), 'NOSALE2', null, null, timestamptz '2026-12-01 11:00:00+00'), 2), 40.00, 'sin rebajados (no acumulable): el cupón baja la otra línea (20 % de 200,00 = 40,00)');
select is(pg_temp.tot(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1), pg_temp.ln(2, 2, 200, 1)), 'NOSALE2', null, null, timestamptz '2026-12-01 11:00:00+00')), 250.00, 'sin rebajados (no acumulable): total 300,00 − 10,00 − 40,00 = 250,00');
select is(jsonb_array_length(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1), pg_temp.ln(2, 2, 200, 1)), 'NOSALE2', null, null, timestamptz '2026-12-01 11:00:00+00') -> 'applied'), 2, 'sin rebajados (no acumulable): «applied» trae la oferta y el cupón');
-- un cupón pequeño (3 % de 200,00 = 6,00, menos que la oferta de 10,00) ANTES se rechazaba «no combinable»: ahora aplica
select pg_temp.pc('NOSALE3', 3, '{"exclude_sale_items": true}');
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1), pg_temp.ln(2, 2, 200, 1)), 'NOSALE3', null, null, timestamptz '2026-12-01 11:00:00+00')), 16.00, 'sin rebajados (no acumulable): un cupón menor que la oferta también aplica (10,00 + 6,00 = 16,00)');
-- si TODAS las líneas tienen oferta, el cupón no tiene a qué aplicar y la oferta se queda
select is(pg_temp.reason(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1)), 'NOSALE2', null, null, timestamptz '2026-12-01 11:00:00+00')), 'not_applicable', 'sin rebajados: si todas las líneas ya tienen oferta, el cupón no aplica a nada');
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1)), 'NOSALE2', null, null, timestamptz '2026-12-01 11:00:00+00')), 10.00, 'sin rebajados: …y la oferta se conserva (10,00)');
-- el mínimo se mide sobre lo que paga la clienta DESPUÉS de las ofertas que se conservan: 300,00 − 10,00 = 290,00 < 295,00
select pg_temp.pc('NOSALE4', 20, '{"exclude_sale_items": true, "min_order_amount": 295}');
select is(pg_temp.reason(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1), pg_temp.ln(2, 2, 200, 1)), 'NOSALE4', null, null, timestamptz '2026-12-01 11:00:00+00')), 'min_not_reached', 'sin rebajados (no acumulable): el mínimo (295,00) se mide sobre 290,00, lo que queda tras la oferta');
select is((pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 1), pg_temp.ln(2, 2, 200, 1)), 'NOSALE4', null, null, timestamptz '2026-12-01 11:00:00+00') #>> '{coupon,missing}')::numeric, 5.00, 'sin rebajados (no acumulable): faltan 5,00 para el mínimo');
select pg_temp.wipe();

-- ── C14. Estados del cupón: respuestas y vigencias ──
select pg_temp.dc('{"id":"1a000000-0000-0000-0000-000000000001","name":"Real","kind":"percent","params":{"percent":10},"requires_coupon":true}');
select pg_temp.cp('1a000000-0000-0000-0000-000000000001', 'VERANO10');
-- normalización de lo que escribe la persona
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), 'verano10')), 'applied', 'código: en minúsculas');
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), 'VERANO-10')), 'applied', 'código: con guion');
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), ' Verano 10 ')), 'applied', 'código: con espacios y mayúsculas mezcladas');
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), 'veran0 1o')), 'applied', 'código: con 0/O confundidos');
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), 'VERANO_10')), 'applied', 'código: con guion bajo');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'VERANO11')), 'invalid_code', 'código: uno que no existe → «invalid_code»');
select is(pg_temp.ev(pg_temp.l('L12'), 'verano10') #>> '{coupon,code}', 'VERANO10', 'código: el cupón aplicado devuelve el código canónico');
-- Respuesta UNIFORME para todo lo que no existe o no se puede usar (no se pueden enumerar cupones): idéntica en cada caso
select pg_temp.dc('{"id":"1a000000-0000-0000-0000-000000000002","name":"D apagado","kind":"percent","params":{"percent":10},"requires_coupon":true,"is_active":false}');
select pg_temp.cp('1a000000-0000-0000-0000-000000000002', 'APAGADO1');
select pg_temp.dc('{"id":"1a000000-0000-0000-0000-000000000003","name":"D futuro","kind":"percent","params":{"percent":10},"requires_coupon":true,"starts_at":"2099-01-01T00:00:00Z"}');
select pg_temp.cp('1a000000-0000-0000-0000-000000000003', 'FUTURO01');
select pg_temp.cp('1a000000-0000-0000-0000-000000000001', 'CUPAPAGADO', '{"is_active": false}');
select pg_temp.cp('1a000000-0000-0000-0000-000000000001', 'CUPFUTURO', '{"starts_at":"2099-01-01T00:00:00Z"}');
select pg_temp.cp('1a000000-0000-0000-0000-000000000001', 'CUPARCHIV');
update public.coupons set archived_at = now() where code = 'CUPARCHIV';
select pg_temp.dc('{"id":"1a000000-0000-0000-0000-000000000008","name":"D futuro con cupón vigente","kind":"percent","params":{"percent":10},"requires_coupon":true,"starts_at":"2099-01-01T00:00:00Z"}');
select pg_temp.cp('1a000000-0000-0000-0000-000000000008', 'AMBASFUT1', '{"starts_at":"2020-01-01T00:00:00Z"}');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'AMBASFUT1')), 'invalid_code', 'uniforme: si el cupón ya empezó pero el DESCUENTO aún no, sigue siendo invalid_code');
select pg_temp.dc('{"id":"1a000000-0000-0000-0000-000000000004","name":"D archivado","kind":"percent","params":{"percent":10},"requires_coupon":true}');
select pg_temp.cp('1a000000-0000-0000-0000-000000000004', 'DARCHIV01');
update public.discounts set archived_at = now() where id = '1a000000-0000-0000-0000-000000000004';
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'APAGADO1')), 'invalid_code', 'uniforme: descuento apagado → invalid_code');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'FUTURO01')), 'invalid_code', 'uniforme: descuento que aún no empieza → invalid_code (no se revelan cupones futuros)');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'CUPAPAGADO')), 'invalid_code', 'uniforme: cupón apagado → invalid_code');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'CUPFUTURO')), 'invalid_code', 'uniforme: cupón que aún no empieza → invalid_code');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'CUPARCHIV')), 'invalid_code', 'uniforme: cupón archivado → invalid_code');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'DARCHIV01')), 'invalid_code', 'uniforme: descuento archivado → invalid_code');
select is(count(distinct (pg_temp.ev(pg_temp.l('L12'), c) -> 'coupon') - 'code')::int, 1,
          'uniforme: la respuesta es IDÉNTICA (salvo el texto escrito) para inexistente, apagado, futuro y archivado')
  from unnest(array['NOEXISTE1', 'APAGADO1', 'FUTURO01', 'CUPAPAGADO', 'CUPFUTURO', 'CUPARCHIV', 'DARCHIV01']) c;
select is(pg_temp.ev(pg_temp.l('L12'), 'cuparchiv') #>> '{coupon,code}', 'cuparchiv', 'uniforme: se devuelve lo que la persona escribió, no el código guardado (no se delata por la mayúscula)');
select is(pg_temp.ev(pg_temp.l('L12'), 'noexiste1') #>> '{coupon,code}', 'noexiste1', 'uniforme: igual para uno inexistente');
-- vencido y moneda
select pg_temp.dc('{"id":"1a000000-0000-0000-0000-000000000005","name":"D vencido","kind":"percent","params":{"percent":10},"requires_coupon":true,"starts_at":"2026-01-01T00:00:00Z","ends_at":"2026-06-01T00:00:00Z"}');
select pg_temp.cp('1a000000-0000-0000-0000-000000000005', 'VENCIDO01');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'VENCIDO01')), 'expired', 'vigencia: un descuento vencido → «expired»');
select pg_temp.cp('1a000000-0000-0000-0000-000000000001', 'CUPVENCIDO', '{"starts_at":"2026-01-01T00:00:00Z","ends_at":"2026-06-01T00:00:00Z"}');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'CUPVENCIDO')), 'expired', 'vigencia: un cupón con su propia vigencia vencida → «expired»');
-- el instante exacto del fin: ends_at es EXCLUSIVO
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), 'VENCIDO01', null, null, timestamptz '2026-05-31 23:59:59+00')), 'applied', 'vigencia: un segundo antes del fin aplica');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'VENCIDO01', null, null, timestamptz '2026-06-01 00:00:00+00')), 'expired', 'vigencia: justo al fin ya venció');
-- La vigencia se evalúa en horario de La Paz: fin 2026-06-01 00:00 en La Paz = 04:00 UTC
select pg_temp.dc('{"id":"1a000000-0000-0000-0000-000000000006","name":"D La Paz","kind":"percent","params":{"percent":10},"requires_coupon":true,"ends_at":"2026-06-01T00:00:00-04:00"}');
select pg_temp.cp('1a000000-0000-0000-0000-000000000006', 'LAPAZ001');
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), 'LAPAZ001', null, null, timestamptz '2026-06-01 03:59:59+00')), 'applied', 'zona horaria: 23:59:59 del 31 de mayo en La Paz aún vale');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'LAPAZ001', null, null, timestamptz '2026-06-01 04:00:00+00')), 'expired', 'zona horaria: a las 00:00 de La Paz (04:00 UTC) ya venció');
select pg_temp.dc('{"id":"1a000000-0000-0000-0000-000000000007","name":"D USD","kind":"percent","params":{"percent":10},"requires_coupon":true,"currency":"USD"}');
select pg_temp.cp('1a000000-0000-0000-0000-000000000007', 'DOLARES1');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'DOLARES1')), 'wrong_currency', 'moneda: un cupón en otra moneda no aplica a un carrito en BOB');
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), 'DOLARES1', null, null, now(), 'USD')), 'applied', 'moneda: en un carrito de su moneda sí');

-- Un descuento que deja de PEDIR código: sus cupones dejan de servir (ya no hay nada que activar con un código)
select pg_temp.wipe();
select pg_temp.dc('{"id":"1a100000-0000-0000-0000-000000000001","name":"Era con código","kind":"first_purchase","params":{"percent":10},"requires_coupon":true}');
select pg_temp.cp('1a100000-0000-0000-0000-000000000001', 'FPCODIGO1');
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), 'FPCODIGO1', 'a9000000-0000-0000-0000-00000000000a')), 'applied', 'pasa a automático: antes, con código aplica');
update public.discounts set requires_coupon = false where id = '1a100000-0000-0000-0000-000000000001';
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'FPCODIGO1', 'a9000000-0000-0000-0000-00000000000a')), 'invalid_code', 'pasa a automático: su código ya no sirve (invalid_code)');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, 'a9000000-0000-0000-0000-00000000000a')), 25.00, 'pasa a automático: y ahora lo recibe sola (10 % de 250,00)');
-- La vigencia PROPIA del cupón: el fin es exclusivo (un segundo antes vale; justo al fin ya no)
select pg_temp.wipe();
select pg_temp.dc('{"id":"1a100000-0000-0000-0000-000000000002","name":"Cupón con fin propio","kind":"percent","params":{"percent":10},"requires_coupon":true}');
select pg_temp.cp('1a100000-0000-0000-0000-000000000002', 'FINPROPIO1', '{"ends_at":"2026-06-01T00:00:00Z"}');
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), 'FINPROPIO1', null, null, timestamptz '2026-05-31 23:59:59+00')), 'applied', 'fin propio del cupón: un segundo antes aplica');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'FINPROPIO1', null, null, timestamptz '2026-06-01 00:00:00+00')), 'expired', 'fin propio del cupón: justo al fin ya venció (exclusivo)');
-- Cupón de envío gratis: el umbral va DESPUÉS de las ofertas automáticas (210,00 − 10 % de la oferta = 189,00 < 200,00)
select pg_temp.wipe();
select pg_temp.dc('{"name":"Flash 10 %","kind":"flash","params":{"percent":10},"starts_at":"2026-12-01T10:00:00Z","ends_at":"2026-12-01T12:00:00Z"}');
select pg_temp.dc('{"id":"1a100000-0000-0000-0000-000000000003","name":"Cupón envío 200","kind":"free_shipping","params":{},"min_order_amount":200,"requires_coupon":true}');
select pg_temp.cp('1a100000-0000-0000-0000-000000000003', 'ENVIO200');
select is(pg_temp.reason(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 210, 1)), 'ENVIO200', null, null, timestamptz '2026-12-01 11:00:00+00')), 'min_not_reached', 'cupón de envío: 210,00 − 10 % de la oferta = 189,00 < 200,00 → no llega');
select is((pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 210, 1)), 'ENVIO200', null, null, timestamptz '2026-12-01 11:00:00+00') #>> '{coupon,missing}')::numeric, 11.00, 'cupón de envío: faltan 11,00');
select is(pg_temp.cst(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 250, 1)), 'ENVIO200', null, null, timestamptz '2026-12-01 11:00:00+00')), 'applied', 'cupón de envío: 250,00 − 10 % = 225,00 ≥ 200,00 → aplica');
select is(pg_temp.cst(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 210, 1)), 'ENVIO200', null, null, timestamptz '2026-12-02 11:00:00+00')), 'applied', 'cupón de envío: fuera de la oferta, 210,00 ≥ 200,00 → aplica');
select pg_temp.wipe();

-- ── C15. Límites de uso (total, por cupón y por cliente) ──
select pg_temp.wipe();
select pg_temp.dc('{"id":"1b000000-0000-0000-0000-000000000001","name":"Tope 2","kind":"percent","params":{"percent":10},"requires_coupon":true,"usage_limit_total":2}');
select pg_temp.cp('1b000000-0000-0000-0000-000000000001', 'TOPE2');
create function pg_temp.red(p_discount uuid, p_coupon uuid, p_profile uuid, p_status text default 'reserved') returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.discount_redemptions (discount_id, coupon_id, profile_id, owner_type, owner_id, amount, currency, status)
  values (p_discount, p_coupon, p_profile, 'order', v, 10, 'BOB', p_status);
  return v;
end $$;
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), 'TOPE2')), 'applied', 'tope total: con 0 de 2 usos aplica');
select pg_temp.red('1b000000-0000-0000-0000-000000000001', (select id from public.coupons where code = 'TOPE2'), null, 'reserved');
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), 'TOPE2')), 'applied', 'tope total: con 1 de 2 usos aplica');
select pg_temp.red('1b000000-0000-0000-0000-000000000001', (select id from public.coupons where code = 'TOPE2'), null, 'applied');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'TOPE2')), 'sold_out', 'tope total: con 2 de 2 usos (uno reservado y uno aplicado) → «sold_out»');
update public.discount_redemptions set status = 'reverted' where status = 'reserved';
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), 'TOPE2')), 'applied', 'tope total: un uso devuelto (reverted) libera el cupo');
-- por cliente
select pg_temp.wipe();
select pg_temp.dc('{"id":"1b000000-0000-0000-0000-000000000002","name":"Uno por cliente","kind":"percent","params":{"percent":10},"requires_coupon":true,"usage_limit_per_customer":1}');
select pg_temp.cp('1b000000-0000-0000-0000-000000000002', 'UNICO1');
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), 'UNICO1', 'a9000000-0000-0000-0000-00000000000a')), 'applied', 'por cliente: la primera vez aplica');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'UNICO1')), 'login_required', 'por cliente: un invitado debe iniciar sesión (no se puede contar sus usos)');
select pg_temp.red('1b000000-0000-0000-0000-000000000002', (select id from public.coupons where code = 'UNICO1'), 'a9000000-0000-0000-0000-00000000000a', 'applied');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'UNICO1', 'a9000000-0000-0000-0000-00000000000a')), 'already_used', 'por cliente: «ya usaste este cupón»');
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), 'UNICO1', 'a9000000-0000-0000-0000-00000000000b')), 'applied', 'por cliente: otra clienta sí puede');
update public.discount_redemptions set status = 'reverted';
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), 'UNICO1', 'a9000000-0000-0000-0000-00000000000a')), 'applied', 'por cliente: si cancela el pedido recupera el uso');
-- por código (lote de un solo uso)
select pg_temp.wipe();
select pg_temp.dc('{"id":"1b000000-0000-0000-0000-000000000003","name":"Lote","kind":"percent","params":{"percent":10},"requires_coupon":true}');
select pg_temp.cp('1b000000-0000-0000-0000-000000000003', 'LOTE0001', '{"usage_limit": 1}');
select pg_temp.cp('1b000000-0000-0000-0000-000000000003', 'LOTE0002', '{"usage_limit": 1}');
select pg_temp.red('1b000000-0000-0000-0000-000000000003', (select id from public.coupons where code = 'LOTE0001'), 'a9000000-0000-0000-0000-00000000000a', 'applied');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'LOTE0001', 'a9000000-0000-0000-0000-00000000000b')), 'sold_out', 'código de un solo uso: usado el primero, ese código queda agotado');
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), 'LOTE0002', 'a9000000-0000-0000-0000-00000000000b')), 'applied', 'código de un solo uso: los demás códigos del lote siguen sirviendo');
-- un descuento AUTOMÁTICO con tope también se agota
select pg_temp.wipe();
select pg_temp.dc('{"id":"1b000000-0000-0000-0000-000000000004","name":"Flash 1 uso","kind":"flash","params":{"percent":20},"starts_at":"2026-12-01T10:00:00Z","ends_at":"2026-12-01T12:00:00Z","usage_limit_total":1}');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, null, null, timestamptz '2026-12-01 11:00:00+00')), 50.00, 'automático con tope: con 0 de 1 usos aplica');
select pg_temp.red('1b000000-0000-0000-0000-000000000004', null, 'a9000000-0000-0000-0000-00000000000b', 'reserved');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, null, null, timestamptz '2026-12-01 11:00:00+00')), 0.00, 'automático con tope: agotado deja de aplicar');

-- Automático con tope POR CLIENTA: un invitado no se puede contar, así que no aplica; una clienta sin usos sí; con su uso, ya no.
select pg_temp.wipe();
select pg_temp.dc('{"id":"1b000000-0000-0000-0000-000000000005","name":"Flash 1 por clienta","kind":"flash","params":{"percent":20},"starts_at":"2026-01-01T00:00:00Z","ends_at":"2099-01-01T00:00:00Z","usage_limit_per_customer":1}');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'))), 0.00, 'automático con tope por clienta: un invitado (sin cuenta) NO lo recibe');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, 'a9000000-0000-0000-0000-00000000000a')), 50.00, 'automático con tope por clienta: una clienta sin usos recibe 20 % de 250,00 = 50,00');
select pg_temp.red('1b000000-0000-0000-0000-000000000005', null, 'a9000000-0000-0000-0000-00000000000a', 'applied');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, 'a9000000-0000-0000-0000-00000000000a')), 0.00, 'automático con tope por clienta: con su uso ya no');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'), null, 'a9000000-0000-0000-0000-00000000000b')), 50.00, 'automático con tope por clienta: otra clienta sí');
-- Automático con MÍNIMO: borde inclusivo
select pg_temp.wipe();
select pg_temp.dc('{"name":"Volumen desde 300","kind":"flash","params":{"percent":10},"min_order_amount":300,"starts_at":"2026-01-01T00:00:00Z","ends_at":"2099-01-01T00:00:00Z"}');
select is(pg_temp.dis(pg_temp.ev(pg_temp.l('L12'))), 0.00, 'automático con mínimo: 250,00 no llega a 300,00');
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 299.99, 1)))), 0.00, 'automático con mínimo: 299,99 tampoco');
select is(pg_temp.dis(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 3)))), 30.00, 'automático con mínimo: 300,00 EXACTOS sí (borde inclusivo): 10 % = 30,00');

-- ── C16. Productos sin rebajar con la bolsa vacía y entradas raras ──
select pg_temp.wipe();
select pg_temp.pc('SAVE10', 10);
select is(pg_temp.tot(pg_temp.ev('[]'::jsonb, 'SAVE10')), 0.00, 'bolsa vacía: total 0');
select is(pg_temp.reason(pg_temp.ev('[]'::jsonb, 'SAVE10')), 'not_applicable', 'bolsa vacía: un cupón no aplica a nada');
-- sin líneas cobrables, un código que NO existe (o no está vigente) sigue siendo inválido: no «no aplica» (no se guarda basura)
select is(pg_temp.reason(pg_temp.ev('[]'::jsonb, 'NOEXISTE')), 'invalid_code', 'bolsa vacía: un código inexistente es «invalid_code», no «not_applicable»');
select is(pg_temp.reason(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 0)), 'NOEXISTE')), 'invalid_code', 'sin líneas cobrables: un código inexistente es «invalid_code»');
select pg_temp.cp(pg_temp.dc('{"name":"Apagado","kind":"percent","params":{"percent":10},"requires_coupon":true}'), 'APAGADO1', '{"is_active": false}');
select is(pg_temp.reason(pg_temp.ev('[]'::jsonb, 'APAGADO1')), 'invalid_code', 'bolsa vacía: un código apagado es «invalid_code» (igual que uno inexistente)');
select is(pg_temp.reason(pg_temp.ev('[]'::jsonb, 'apagado-1')), 'invalid_code', 'bolsa vacía: …escrito de otra forma, la misma respuesta');
select pg_temp.cp(pg_temp.dc('{"name":"Futuro","kind":"percent","params":{"percent":10},"requires_coupon":true,"starts_at":"2099-01-01T00:00:00Z"}'), 'FUTURO01');
select is(pg_temp.reason(pg_temp.ev('[]'::jsonb, 'FUTURO01')), 'invalid_code', 'bolsa vacía: un código cuyo DESCUENTO aún no empieza es «invalid_code»');
select pg_temp.cp(pg_temp.dc('{"name":"Cupón futuro","kind":"percent","params":{"percent":10},"requires_coupon":true}'), 'FUTURO02', '{"starts_at":"2099-01-01T00:00:00Z"}');
select is(pg_temp.reason(pg_temp.ev('[]'::jsonb, 'FUTURO02')), 'invalid_code', 'bolsa vacía: un código que aún no empieza (inicio propio) es «invalid_code»');
select pg_temp.cp(pg_temp.dc('{"name":"Vigente","kind":"percent","params":{"percent":10},"requires_coupon":true}'), 'VIGENTE1');
select is(pg_temp.reason(pg_temp.ev('[]'::jsonb, 'VIGENTE1')), 'not_applicable', 'bolsa vacía: un código que SÍ existe y está vigente es «not_applicable» (podrá aplicar cuando haya líneas)');
select is(pg_temp.ev('[]'::jsonb, 'vigente-1') #>> '{coupon,code}', 'VIGENTE1', 'bolsa vacía: «not_applicable» muestra el código canónico, no lo escrito');
select is(pg_temp.ev('[]'::jsonb, 'vigente-1') #>> '{rejected,0,code}', 'VIGENTE1', 'bolsa vacía: …y la lista de rechazados también');
-- …y también un cupón archivado, uno cuyo descuento está apagado o archivado, o que dejó de pedir código
select pg_temp.cp(pg_temp.dc('{"name":"Cupón archivado","kind":"percent","params":{"percent":10},"requires_coupon":true}'), 'ARCHIV01');
update public.coupons set archived_at = now() where code = 'ARCHIV01';
select is(pg_temp.reason(pg_temp.ev('[]'::jsonb, 'ARCHIV01')), 'invalid_code', 'bolsa vacía: un cupón archivado es «invalid_code»');
select pg_temp.pc('DESAPAG1', 10, '{"is_active": false}');
select is(pg_temp.reason(pg_temp.ev('[]'::jsonb, 'DESAPAG1')), 'invalid_code', 'bolsa vacía: un cupón cuyo descuento está apagado es «invalid_code»');
select pg_temp.pc('DESARCH1', 10);
update public.discounts set archived_at = now() where name = 'Cupón DESARCH1';
select is(pg_temp.reason(pg_temp.ev('[]'::jsonb, 'DESARCH1')), 'invalid_code', 'bolsa vacía: un cupón cuyo descuento está archivado es «invalid_code»');
select pg_temp.cp(pg_temp.dc('{"name":"Primera con código","kind":"first_purchase","params":{"percent":10},"requires_coupon":true}'), 'SINCODIGO1');
update public.discounts set requires_coupon = false where name = 'Primera con código';
select is(pg_temp.reason(pg_temp.ev('[]'::jsonb, 'SINCODIGO1')), 'invalid_code', 'bolsa vacía: un cupón de un descuento que dejó de pedir código es «invalid_code»');
select is(pg_temp.tot(pg_temp.ev(null, null)), 0.00, 'líneas nulas: no lanza, total 0');
select is(pg_temp.tot(pg_temp.ev(jsonb_build_array(pg_temp.ln(1, 1, 100, 0)), 'SAVE10')), 0.00, 'una línea con cantidad 0 se ignora');
select is(pg_temp.tot(pg_temp.ev(pg_temp.l('L12'), repeat('x', 500))), 250.00, 'un código larguísimo no rompe nada y no baja nada');
select is(length(pg_temp.ev(pg_temp.l('L12'), repeat('x', 500)) #>> '{coupon,code}'), 40, 'un código larguísimo se recorta a 40 caracteres en la respuesta');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), 'SAVE10; drop table x')), 'invalid_code', 'un código con SQL no es nada especial: «invalid_code»');
select is(pg_temp.reason(pg_temp.ev(pg_temp.l('L12'), E'SAVE10\n')), null, 'un salto de línea al final se ignora (se normaliza)');
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), E'SAVE10\n')), 'applied', '…y el cupón aplica');

-- ═══ D. Usos atómicos: reservar, confirmar y devolver ═══════════════════════════════════════
select pg_temp.wipe();
select pg_temp.dc('{"id":"1c000000-0000-0000-0000-000000000001","name":"Cupón A","kind":"percent","params":{"percent":10},"requires_coupon":true,"usage_limit_total":2,"usage_limit_per_customer":1}');
select pg_temp.cp('1c000000-0000-0000-0000-000000000001', 'USOSA001');
select pg_temp.dc('{"id":"1c000000-0000-0000-0000-000000000002","name":"Cupón B","kind":"percent","params":{"percent":10},"requires_coupon":true}');
select pg_temp.cp('1c000000-0000-0000-0000-000000000002', 'USOSB001');
select pg_temp.dc('{"id":"1c000000-0000-0000-0000-000000000003","name":"Auto con tope","kind":"flash","params":{"percent":10},"starts_at":"2026-01-01T00:00:00Z","ends_at":"2099-01-01T00:00:00Z","usage_limit_total":1}');
create function pg_temp.ap(p_discount uuid, p_coupon text default null, p_amount numeric default 10) returns jsonb language sql as $$
  select jsonb_build_object('discount_id', p_discount, 'coupon_id', (select id from public.coupons where code = p_coupon), 'amount', p_amount) $$;
select is(public.discount_reserve('order', '10000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000a',
          jsonb_build_array(pg_temp.ap('1c000000-0000-0000-0000-000000000001', 'USOSA001', 12.5))) ->> 'status', 'reserved', 'reservar: el primer pedido reserva el cupón');
select is((select amount from public.discount_redemptions where owner_id = '10000000-0000-0000-0000-00000000000a'), 12.5000, 'reservar: guarda el monto');
select is((select status from public.discount_redemptions where owner_id = '10000000-0000-0000-0000-00000000000a'), 'reserved', 'reservar: queda «reserved»');
select is((select currency from public.discount_redemptions where owner_id = '10000000-0000-0000-0000-00000000000a'), 'BOB', 'reservar: guarda la moneda del descuento');
-- idempotente: el mismo pedido otra vez no duplica ni gasta otro uso
select is(public.discount_reserve('order', '10000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000a',
          jsonb_build_array(pg_temp.ap('1c000000-0000-0000-0000-000000000001', 'USOSA001', 12.5))) ->> 'ok', 'true', 'reservar: repetir el mismo pedido es idempotente');
select is((select count(*)::int from public.discount_redemptions where owner_id = '10000000-0000-0000-0000-00000000000a'), 1, 'reservar: …y no duplica filas');
-- la MISMA clienta, otro pedido: ya usó su único cupón
select is(public.discount_reserve('order', '10000000-0000-0000-0000-00000000000b', 'a9000000-0000-0000-0000-00000000000a',
          jsonb_build_array(pg_temp.ap('1c000000-0000-0000-0000-000000000001', 'USOSA001'))) #>> '{failed,0,reason}', 'already_used', 'reservar: la misma clienta en otro pedido (o dispositivo) → «already_used»');
-- otra clienta usa el 2.º y último
select is(public.discount_reserve('order', '10000000-0000-0000-0000-00000000000c', 'a9000000-0000-0000-0000-00000000000b',
          jsonb_build_array(pg_temp.ap('1c000000-0000-0000-0000-000000000001', 'USOSA001'))) ->> 'ok', 'true', 'reservar: otra clienta usa el 2.º uso');
-- el 3.º ya no entra, venga de quien venga
select is(public.discount_reserve('order', '10000000-0000-0000-0000-00000000000d', null,
          jsonb_build_array(pg_temp.ap('1c000000-0000-0000-0000-000000000001', 'USOSA001'))) #>> '{failed,0,reason}', 'login_required', 'reservar: un descuento con tope por cliente exige cuenta');
update public.discounts set usage_limit_per_customer = null where id = '1c000000-0000-0000-0000-000000000001';
select is(public.discount_reserve('order', '10000000-0000-0000-0000-00000000000d', null,
          jsonb_build_array(pg_temp.ap('1c000000-0000-0000-0000-000000000001', 'USOSA001'))) #>> '{failed,0,reason}', 'sold_out', 'reservar: pasado el tope total → «sold_out»');
select is((select count(*)::int from public.discount_redemptions where status = 'reserved'), 2, 'reservar: nunca hay más usos que el tope (2)');
-- TODO O NADA: si uno de los descuentos falla, no se reserva NINGUNO (un cupón válido + un automático ya agotado)
select pg_temp.dc('{"id":"1c000000-0000-0000-0000-000000000004","name":"Auto agotado","kind":"flash","params":{"percent":10},"starts_at":"2026-01-01T00:00:00Z","ends_at":"2099-01-01T00:00:00Z","usage_limit_total":1}');
select pg_temp.red('1c000000-0000-0000-0000-000000000004', null, 'a9000000-0000-0000-0000-00000000000a', 'applied');
select is(public.discount_reserve('order', '10000000-0000-0000-0000-00000000000e', 'a9000000-0000-0000-0000-00000000000b',
          jsonb_build_array(pg_temp.ap('1c000000-0000-0000-0000-000000000002', 'USOSB001'), pg_temp.ap('1c000000-0000-0000-0000-000000000004'))) ->> 'ok', 'false',
          'todo o nada: si falla uno (el automático agotado), la reserva entera se rechaza');
select is((select count(*)::int from public.discount_redemptions where owner_id = '10000000-0000-0000-0000-00000000000e'), 0, 'todo o nada: y NO queda reservado ni el cupón válido');
-- UN solo cupón por pedido
select is(public.discount_reserve('order', '10000000-0000-0000-0000-00000000000f', 'a9000000-0000-0000-0000-00000000000a',
          jsonb_build_array(pg_temp.ap('1c000000-0000-0000-0000-000000000002', 'USOSB001'), pg_temp.ap('1c000000-0000-0000-0000-000000000001', 'USOSA001'))) #>> '{failed,0,reason}',
          'one_coupon_per_order', 'un cupón por pedido: dos cupones en una reserva se rechazan');
select is(public.discount_reserve('order', '10000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000a',
          jsonb_build_array(pg_temp.ap('1c000000-0000-0000-0000-000000000002', 'USOSB001'))) #>> '{failed,0,reason}',
          'one_coupon_per_order', 'un cupón por pedido: un pedido que ya reservó un cupón no puede sumar otro');
-- un descuento automático con tope entra sin cupón
select is(public.discount_reserve('order', '10000000-0000-0000-0000-000000000010', 'a9000000-0000-0000-0000-00000000000b',
          jsonb_build_array(pg_temp.ap('1c000000-0000-0000-0000-000000000003'))) ->> 'ok', 'true', 'automático con tope: se reserva sin cupón');
select is(public.discount_reserve('order', '10000000-0000-0000-0000-000000000011', 'a9000000-0000-0000-0000-00000000000b',
          jsonb_build_array(pg_temp.ap('1c000000-0000-0000-0000-000000000003'))) #>> '{failed,0,reason}', 'sold_out', 'automático con tope: el siguiente ya no entra');
-- entradas inválidas
select is(public.discount_reserve('envio', '10000000-0000-0000-0000-000000000012', null, '[]'::jsonb) ->> 'status', 'invalid', 'reservar: un tipo de dueño desconocido es «invalid»');
select is(public.discount_reserve(null, '10000000-0000-0000-0000-000000000012', null, '[]'::jsonb) ->> 'status', 'invalid', 'reservar: dueño nulo → «invalid»');
select is(public.discount_reserve('order', null, null, '[]'::jsonb) ->> 'status', 'invalid', 'reservar: id de dueño nulo → «invalid»');
select is(public.discount_reserve('order', '10000000-0000-0000-0000-000000000012', null, '{"x":1}'::jsonb) ->> 'status', 'invalid', 'reservar: «applied» que no es lista → «invalid»');
select is(public.discount_reserve('order', '10000000-0000-0000-0000-000000000012', null, null) ->> 'status', 'invalid', 'reservar: «applied» nulo → «invalid»');
select is(public.discount_reserve('order', '10000000-0000-0000-0000-000000000012', null, '[]'::jsonb) ->> 'ok', 'true', 'reservar: una lista vacía es válida (pedido sin descuentos)');
select is(public.discount_reserve('order', '10000000-0000-0000-0000-000000000013', null,
          jsonb_build_array(jsonb_build_object('discount_id', gen_random_uuid(), 'amount', 1))) #>> '{failed,0,reason}', 'invalid_code', 'reservar: un descuento que no existe → «invalid_code»');
-- vigencia: se revalida al reservar (un cupón que venció mientras completaba el checkout)
update public.discounts set ends_at = now() - interval '1 second', starts_at = now() - interval '1 day' where id = '1c000000-0000-0000-0000-000000000002';
select is(public.discount_reserve('order', '10000000-0000-0000-0000-000000000014', 'a9000000-0000-0000-0000-00000000000a',
          jsonb_build_array(pg_temp.ap('1c000000-0000-0000-0000-000000000002', 'USOSB001'))) #>> '{failed,0,reason}', 'expired', 'reservar: un cupón que venció mientras compraba → «expired»');
update public.discounts set ends_at = null, starts_at = null, is_active = false where id = '1c000000-0000-0000-0000-000000000002';
select is(public.discount_reserve('order', '10000000-0000-0000-0000-000000000014', 'a9000000-0000-0000-0000-00000000000a',
          jsonb_build_array(pg_temp.ap('1c000000-0000-0000-0000-000000000002', 'USOSB001'))) #>> '{failed,0,reason}', 'invalid_code', 'reservar: un descuento apagado entre tanto → «invalid_code»');
update public.discounts set is_active = true where id = '1c000000-0000-0000-0000-000000000002';
-- confirmar y devolver
select is(public.discount_commit('order', '10000000-0000-0000-0000-00000000000a'), 1, 'confirmar: pasa a «applied» lo reservado del pedido');
select is((select status from public.discount_redemptions where owner_id = '10000000-0000-0000-0000-00000000000a'), 'applied', 'confirmar: queda «applied»');
select is(public.discount_commit('order', '10000000-0000-0000-0000-00000000000a'), 0, 'confirmar: repetir no cambia nada');
select is(public.discount_release('order', '10000000-0000-0000-0000-00000000000a'), 1, 'devolver: un pedido cancelado devuelve su uso');
select is((select status from public.discount_redemptions where owner_id = '10000000-0000-0000-0000-00000000000a'), 'reverted', 'devolver: queda «reverted»');
select is(public.discount_release('order', '10000000-0000-0000-0000-00000000000a'), 0, 'devolver: repetir no cambia nada');
select is(public.discount_reserve('order', '10000000-0000-0000-0000-000000000015', 'a9000000-0000-0000-0000-00000000000a',
          jsonb_build_array(pg_temp.ap('1c000000-0000-0000-0000-000000000001', 'USOSA001'))) ->> 'ok', 'true', 'devolver: el uso devuelto queda libre para otro pedido');
select is(public.discount_commit('order', '10000000-0000-0000-0000-0000000000ff'), 0, 'confirmar: un pedido sin reservas no cambia nada');

-- Las redes de seguridad de la base (índices únicos): detrás de las comprobaciones de la función, la base también lo impide
select lives_ok($$insert into public.discount_redemptions (discount_id, coupon_id, owner_type, owner_id, amount, currency)
                  values ('1c000000-0000-0000-0000-000000000001', (select id from public.coupons where code = 'USOSA001'), 'order', '10000000-0000-0000-0000-0000000000f1', 1, 'BOB')$$,
          'índices: una redención directa (como dueño de la tabla) se guarda');
select throws_ok($$insert into public.discount_redemptions (discount_id, coupon_id, owner_type, owner_id, amount, currency)
                    values ('1c000000-0000-0000-0000-000000000001', (select id from public.coupons where code = 'USOSA001'), 'order', '10000000-0000-0000-0000-0000000000f1', 1, 'BOB')$$,
          '23505', null, 'índices: el MISMO descuento no se redime dos veces en un pedido');
select throws_ok($$insert into public.discount_redemptions (discount_id, coupon_id, owner_type, owner_id, amount, currency)
                    values ('1c000000-0000-0000-0000-000000000002', (select id from public.coupons where code = 'USOSB001'), 'order', '10000000-0000-0000-0000-0000000000f1', 1, 'BOB')$$,
          '23505', null, 'índices: dos CUPONES distintos en un pedido tampoco (BR-PRC-03)');
select lives_ok($$insert into public.discount_redemptions (discount_id, owner_type, owner_id, amount, currency, status)
                   values ('1c000000-0000-0000-0000-000000000002', 'order', '10000000-0000-0000-0000-0000000000f1', 1, 'BOB', 'reverted')$$,
          'índices: una redención DEVUELTA no cuenta (el mismo pedido puede volver a usar ese descuento)');
-- un descuento AUTOMÁTICO (sin cupón): aquí solo el índice «un uso activo por descuento y pedido» protege
select lives_ok($$insert into public.discount_redemptions (discount_id, owner_type, owner_id, amount, currency)
                   values ('1c000000-0000-0000-0000-000000000003', 'order', '10000000-0000-0000-0000-0000000000f2', 1, 'BOB')$$,
          'índices: una redención automática (sin cupón) se guarda');
select throws_ok($$insert into public.discount_redemptions (discount_id, owner_type, owner_id, amount, currency)
                    values ('1c000000-0000-0000-0000-000000000003', 'order', '10000000-0000-0000-0000-0000000000f2', 1, 'BOB')$$,
          '23505', null, 'índices: un descuento automático tampoco se redime dos veces en el mismo pedido');
select is(has_table_privilege('authenticated', 'public.discount_redemptions', 'insert') or has_table_privilege('authenticated', 'public.discount_redemptions', 'update')
          or has_table_privilege('authenticated', 'public.discount_redemptions', 'delete'), false,
          'permisos: authenticated no tiene INSERT, UPDATE ni DELETE sobre las redenciones (solo lee, y solo el admin por RLS)');
select is(has_table_privilege('service_role', 'public.discount_redemptions', 'insert') or has_table_privilege('service_role', 'public.discount_redemptions', 'update'), false,
          'permisos: ni service_role escribe directo en las redenciones (solo las funciones)');
select is(has_table_privilege('anon', 'public.coupons', 'select') or has_table_privilege('anon', 'public.discounts', 'select'), false, 'permisos: anon no lee cupones ni descuentos');
select is(has_column_privilege('authenticated', 'public.discounts', 'kind', 'update') or has_column_privilege('authenticated', 'public.discounts', 'scope', 'update')
          or has_column_privilege('authenticated', 'public.coupons', 'code', 'update'), false, 'permisos: ni el tipo, el alcance ni el código de un cupón se pueden editar');

-- ═══ E. Propiedades (fuzz determinista) ═════════════════════════════════════════════════════
-- Un conjunto variado de descuentos y 400 carritos pseudoaleatorios (semilla fija). Para CUALQUIER combinación:
--   0 ≤ total ≤ subtotal · descuento = Σ descuentos de línea · cada línea 0 ≤ final ≤ base · a lo sumo UN cupón aplicado ·
--   a lo sumo una oferta automática y un cupón por línea · el envío con descuento nunca es negativo · el resultado es el
--   MISMO al evaluar dos veces y al invertir el orden de las líneas.
select pg_temp.wipe();
select pg_temp.dc('{"name":"2x1 C1","kind":"bogo","params":{"take":2,"pay":1},"scope":"category","id":"1d000000-0000-0000-0000-000000000001"}');
select pg_temp.tg('1d000000-0000-0000-0000-000000000001', 'category', 'c9000000-0000-0000-0000-000000000001');
select pg_temp.dc('{"name":"Volumen","kind":"volume","params":{"tiers":[{"min_qty":3,"percent":7.5},{"min_qty":6,"percent":12}]}}');
select pg_temp.dc('{"name":"Flash","kind":"flash","params":{"percent":15,"max_amount":30},"starts_at":"2026-01-01T00:00:00Z","ends_at":"2099-01-01T00:00:00Z"}');
select pg_temp.dc('{"name":"Mayoristas","kind":"group_price","params":{"percent":9},"customer_group_id":"e9000000-0000-0000-0000-000000000001"}');
select pg_temp.dc('{"name":"Primera compra","kind":"first_purchase","params":{"percent":10}}');
select pg_temp.dc('{"name":"Envío gratis","kind":"free_shipping","params":{},"min_order_amount":150}');
select pg_temp.pc('FZ-PCT', 13.5);
select pg_temp.pc('FZ-STACK', 8, '{"stackable_with_automatic": true, "exclude_sale_items": true}');
select pg_temp.pc('FZ-ESTACK', 8, '{"stackable_with_automatic": true}');
select pg_temp.pc('FZ-MIN', 20, '{"min_order_amount": 120}');
select pg_temp.dc('{"id":"1d000000-0000-0000-0000-000000000009","name":"Fijo","kind":"fixed","params":{"amount":37.77},"requires_coupon":true,"stackable_with_automatic":true}');
select pg_temp.cp('1d000000-0000-0000-0000-000000000009', 'FZ-FIX');
select pg_temp.dc('{"id":"1d000000-0000-0000-0000-00000000000a","name":"Cupón envío","kind":"free_shipping","params":{},"requires_coupon":true,"min_order_amount":50}');
select pg_temp.cp('1d000000-0000-0000-0000-00000000000a', 'FZ-SHIP');
create temp table _fz (violations int, with_discount int, with_coupon int, cases int);
create function pg_temp.fuzz(p_cases int) returns void language plpgsql as $$
declare
  v_codes text[] := array['FZ-PCT', 'FZ-STACK', 'FZ-ESTACK', 'FZ-MIN', 'FZ-FIX', 'FZ-SHIP', 'NOEXISTE', null, null];
  v_profiles uuid[] := array['a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', null]::uuid[];
  n int; i int; k int;
  v_lines jsonb; v_rev jsonb; v_code text; v_prof uuid; v_ship numeric; v_ev jsonb; v_ev2 jsonb; v_evr jsonb;
  v_viol int := 0; v_disc int := 0; v_cpn int := 0;
  v_sum numeric; v_l jsonb; v_cn int; v_an int;
begin
  perform setseed(0.424242);
  for k in 1..p_cases loop
    n := 1 + floor(random() * 5)::int;
    v_lines := '[]'::jsonb; v_rev := '[]'::jsonb;
    for i in 1..n loop
      v_lines := v_lines || jsonb_build_array(pg_temp.ln(i, 1 + floor(random() * 6)::int, round((1 + random() * 299)::numeric, 2), floor(random() * 7)::int));
    end loop;
    for i in reverse n..1 loop
      v_rev := v_rev || jsonb_build_array(jsonb_set(v_lines -> (i - 1), '{idx}', to_jsonb(n - i + 1)));
    end loop;
    v_code := v_codes[1 + floor(random() * array_length(v_codes, 1))::int];
    v_prof := v_profiles[1 + floor(random() * 3)::int];
    v_ship := case when random() < 0.5 then round((random() * 60)::numeric, 2) end;
    v_ev := pg_temp.ev(v_lines, v_code, v_prof, v_ship);
    v_ev2 := pg_temp.ev(v_lines, v_code, v_prof, v_ship);
    v_evr := pg_temp.ev(v_rev, v_code, v_prof, v_ship);
    if v_ev <> v_ev2 then v_viol := v_viol + 1; end if;
    if (v_ev #>> '{totals,total}')::numeric < 0 then v_viol := v_viol + 1; end if;
    if (v_ev #>> '{totals,discount}')::numeric > (v_ev #>> '{totals,subtotal}')::numeric then v_viol := v_viol + 1; end if;
    if (v_ev #>> '{totals,subtotal}')::numeric - (v_ev #>> '{totals,discount}')::numeric <> (v_ev #>> '{totals,total}')::numeric then v_viol := v_viol + 1; end if;
    if (v_ev #>> '{totals,discount}')::numeric <> (v_evr #>> '{totals,discount}')::numeric then v_viol := v_viol + 1; end if;
    if (v_ev #>> '{totals,total}')::numeric <> (v_evr #>> '{totals,total}')::numeric then v_viol := v_viol + 1; end if;
    v_sum := 0;
    for v_l in select value from jsonb_array_elements(v_ev -> 'lines') loop
      v_sum := v_sum + (v_l ->> 'discount')::numeric;
      if (v_l ->> 'final_total')::numeric < 0 or (v_l ->> 'discount')::numeric > (v_l ->> 'base_total')::numeric
         or (v_l ->> 'base_total')::numeric - (v_l ->> 'discount')::numeric <> (v_l ->> 'final_total')::numeric then
        v_viol := v_viol + 1;
      end if;
      select count(*) filter (where (o ->> 'coupon')::boolean), count(*) filter (where not (o ->> 'coupon')::boolean)
        into v_cn, v_an from jsonb_array_elements(v_l -> 'offers') o;
      if v_cn > 1 or v_an > 1 then v_viol := v_viol + 1; end if;
    end loop;
    if v_sum <> (v_ev #>> '{totals,discount}')::numeric then v_viol := v_viol + 1; end if;
    if (select count(*) from jsonb_array_elements(v_ev -> 'applied') a where a ->> 'coupon_id' is not null) > 1 then v_viol := v_viol + 1; end if;
    if v_ship is not null then
      if (v_ev #>> '{totals,grand_total}')::numeric < 0 or (v_ev #>> '{totals,shipping_discount}')::numeric > v_ship
         or (v_ev #>> '{totals,grand_total}')::numeric <>
            (v_ev #>> '{totals,total}')::numeric + v_ship - (v_ev #>> '{totals,shipping_discount}')::numeric then
        v_viol := v_viol + 1;
      end if;
    end if;
    if (v_ev #>> '{totals,discount}')::numeric > 0 then v_disc := v_disc + 1; end if;
    if v_ev #>> '{coupon,status}' = 'applied' then v_cpn := v_cpn + 1; end if;
  end loop;
  insert into _fz values (v_viol, v_disc, v_cpn, p_cases);
end $$;
select pg_temp.fuzz(400);
select is((select violations from _fz), 0, 'propiedades: en 400 carritos al azar no se rompe NINGUNA invariante (total ≥ 0, suma exacta, una oferta por línea, un cupón, determinista, igual al invertir el orden)');
select cmp_ok((select with_discount from _fz), '>=', 200, 'propiedades: el fuzz de verdad ejerce descuentos (al menos 200 de 400 casos con descuento)');
select cmp_ok((select with_coupon from _fz), '>=', 60, 'propiedades: …y cupones aplicados (al menos 60)');

-- ═══ F. Carrito: cupón, desglose por línea y fusión ═════════════════════════════════════════
-- Productos con precio y stock reales (por el libro mayor, como exige S2): PA 100,00 [stock 50] · PB 40,00 [stock 50]
select pg_temp.wipe();
create function pg_temp.mk(p_pp text, p_price numeric) returns void language plpgsql as $$
declare
  v_p uuid := ('ba000000-0000-0000-0000-0000000000' || p_pp)::uuid;
  v_c uuid := ('da000000-0000-0000-0000-0000000000' || p_pp)::uuid;
  v_s uuid := ('ea000000-0000-0000-0000-0000000000' || p_pp)::uuid;
  v_v uuid := ('fa000000-0000-0000-0000-0000000000' || p_pp)::uuid;
begin
  insert into public.products (id, code, slug, name) values (v_p, 'S9C-' || p_pp, 's9c-' || p_pp, 'Producto carrito ' || p_pp);
  insert into public.product_colors (id, product_id, name) values (v_c, v_p, 'Único');
  insert into public.product_prices (product_id, currency, amount) values (v_p, 'BOB', p_price);
  insert into public.product_sizes (id, product_id, label) values (v_s, v_p, 'M');
  insert into public.product_variants (id, product_id, color_id, size_id) values (v_v, v_p, v_c, v_s);
  perform public.apply_stock_change(v_v, 50, 'import', 'carga inicial S9');
  update public.products set status = 'active' where id = v_p;
end $$;
select pg_temp.mk('01', 100.00);
select pg_temp.mk('02', 40.00);
create function pg_temp.va(n int) returns uuid language sql as $$ select ('fa000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.ct(j jsonb, path text[]) returns text language sql as $$ select j #>> path $$;
select pg_temp.pc('CARRITO10', 10);
select pg_temp.pc('MINCARR', 10, '{"min_order_amount": 500}');
select pg_temp.pc('OTRO20', 20);

-- La foto del carrito de un invitado SIN cupón: nada cambia respecto de S7
select public.cart_set_item(null, repeat('91', 32), pg_temp.va(1), 2);
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,totals,subtotal}')::numeric, 200.00, 'carrito: subtotal 200,00 (2 × 100,00)');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,totals,discount}'), null, 'carrito: sin descuento el campo es null (sin fila en la bolsa)');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,totals,total}')::numeric, 200.00, 'carrito: total = subtotal');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,lines,0,discount}')::numeric, 0.00, 'carrito: la línea trae «discount» 0');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,lines,0,final_total}')::numeric, 200.00, 'carrito: y «final_total» = line_total');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,discounts,coupon,status}'), 'none', 'carrito: sin cupón, el estado es «none»');
select is(jsonb_array_length(public.cart_get(null, repeat('91', 32)) #> '{cart,discounts,applied}'), 0, 'carrito: nada aplicado');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,discounts,free_shipping}'), 'false', 'carrito: sin envío gratis');

-- poner un cupón
select is(public.cart_set_coupon(null, repeat('91', 32), 'carrito-10') ->> 'outcome', 'coupon_set', 'cupón del carrito: «carrito-10» se acepta');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,totals,discount}')::numeric, 20.00, 'cupón del carrito: 10 % de 200,00 = 20,00');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,totals,total}')::numeric, 180.00, 'cupón del carrito: total 180,00');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,lines,0,discount}')::numeric, 20.00, 'cupón del carrito: la línea baja 20,00');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,lines,0,final_total}')::numeric, 180.00, 'cupón del carrito: la línea queda en 180,00');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,lines,0,line_total}')::numeric, 200.00, 'cupón del carrito: «line_total» sigue siendo el precio original (200,00)');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,discounts,coupon,status}'), 'applied', 'cupón del carrito: «applied»');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,discounts,coupon,code}'), 'CARRITO10', 'cupón del carrito: muestra el código canónico');
select is((select coupon_code from public.carts where token_hash = repeat('91', 32)), 'CARR1T010', 'cupón del carrito: se guarda NORMALIZADO');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,lines,0,discount_offers,0,name}'), 'Cupón CARRITO10', 'cupón del carrito: la línea nombra el descuento');
-- idempotente y UN solo cupón
select is(public.cart_set_coupon(null, repeat('91', 32), 'CARRITO10') ->> 'outcome', 'coupon_set', 'un cupón: repetir el mismo es idempotente');
select is(public.cart_set_coupon(null, repeat('91', 32), 'OTRO20') ->> 'outcome', 'coupon_rejected', 'un cupón: poner OTRO distinto se rechaza');
select is(public.cart_set_coupon(null, repeat('91', 32), 'OTRO20') ->> 'reason', 'coupon_already_applied', 'un cupón: con el motivo «ya hay un cupón»');
select is((select coupon_code from public.carts where token_hash = repeat('91', 32)), 'CARR1T010', 'un cupón: el primero se conserva');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,totals,discount}')::numeric, 20.00, 'un cupón: y el descuento sigue siendo el del primero');
-- quitar y cambiar
select is(public.cart_remove_coupon(null, repeat('91', 32)) ->> 'outcome', 'coupon_removed', 'quitar: se quita el cupón');
select is((select coupon_code from public.carts where token_hash = repeat('91', 32)), null, 'quitar: la columna queda vacía');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,totals,discount}'), null, 'quitar: el descuento desaparece');
select is(public.cart_set_coupon(null, repeat('91', 32), 'OTRO20') ->> 'outcome', 'coupon_set', 'cambiar: tras quitar, el otro cupón se acepta');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,totals,discount}')::numeric, 40.00, 'cambiar: 20 % de 200,00 = 40,00');
select is(public.cart_remove_coupon(null, repeat('91', 32)) ->> 'outcome', 'coupon_removed', 'quitar otra vez');
select is(public.cart_remove_coupon(null, repeat('91', 32)) ->> 'outcome', 'coupon_removed', 'quitar sin cupón es inofensivo (idempotente)');
-- códigos que NO se guardan
select is(public.cart_set_coupon(null, repeat('91', 32), 'NOEXISTE') ->> 'reason', 'invalid_code', 'inválido: un código inexistente → invalid_code');
select is(public.cart_set_coupon(null, repeat('91', 32), 'NOEXISTE') ->> 'outcome', 'coupon_rejected', 'inválido: el resultado es «coupon_rejected»');
select is((select coupon_code from public.carts where token_hash = repeat('91', 32)), null, 'inválido: NO se guarda');
select is(public.cart_set_coupon(null, repeat('91', 32), '   ') ->> 'reason', 'invalid_code', 'inválido: un código en blanco → invalid_code');
select is(public.cart_set_coupon(null, repeat('91', 32), repeat('A', 50)) ->> 'reason', 'invalid_code', 'inválido: un código larguísimo → invalid_code (sin error)');
-- un cupón válido que HOY no baja nada por una causa que puede cambiar SÍ se guarda: mínimo no alcanzado
select is(public.cart_set_coupon(null, repeat('91', 32), 'MINCARR') ->> 'outcome', 'coupon_set', 'mínimo: el cupón se guarda aunque aún no llegue');
select is(public.cart_set_coupon(null, repeat('91', 32), 'MINCARR') ->> 'reason', 'min_not_reached', 'mínimo: con el motivo');
select is((public.cart_set_coupon(null, repeat('91', 32), 'MINCARR') ->> 'missing')::numeric, 300.00, 'mínimo: faltan 300,00');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,discounts,coupon,status}'), 'rejected', 'mínimo: mientras no llegue figura «rejected»');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,totals,discount}'), null, 'mínimo: y no baja nada');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,discounts,coupon,code}'), 'MINCARR', 'mínimo: guardado con aviso, la foto muestra el código canónico (no el normalizado «M1NCARR»)');
select is(public.cart_set_coupon(null, repeat('91', 32), 'mincarr') #>> '{cart,discounts,coupon,code}', 'MINCARR', 'mínimo: y la respuesta de «poner cupón» también muestra el canónico aunque se escriba en minúsculas');
-- al subir la cantidad hasta el mínimo (5 × 100,00 = 500,00 EXACTOS) se aplica solo
select is(pg_temp.ct(public.cart_set_item(null, repeat('91', 32), pg_temp.va(1), 5), '{cart,totals,discount}')::numeric, 50.00, 'mínimo: con 500,00 exactos el cupón guardado se aplica solo (10 % = 50,00)');
select is(pg_temp.ct(public.cart_set_item(null, repeat('91', 32), pg_temp.va(1), 4), '{cart,totals,discount}'), null, 'mínimo: si baja a 400,00 el cupón deja de aplicar (con aviso) pero sigue guardado');
select is((select coupon_code from public.carts where token_hash = repeat('91', 32)), 'M1NCARR', 'mínimo: sigue guardado');
select is(public.cart_remove_coupon(null, repeat('91', 32)) ->> 'outcome', 'coupon_removed', 'mínimo: se puede quitar');
-- un cupón que se apaga después: se avisa y queda guardado hasta que lo quiten
select public.cart_set_coupon(null, repeat('91', 32), 'CARRITO10');
update public.coupons set is_active = false where code = 'CARRITO10';
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,discounts,coupon,status}'), 'rejected', 'apagado después: la foto lo marca «rejected»');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,discounts,coupon,reason}'), 'invalid_code', 'apagado después: con el motivo');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,totals,discount}'), null, 'apagado después: ya no baja nada');
update public.coupons set is_active = true where code = 'CARRITO10';
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,totals,discount}')::numeric, 40.00, 'reactivado: vuelve a aplicar solo (10 % de 400,00 = 40,00)');
select public.cart_remove_coupon(null, repeat('91', 32));
-- sin carrito
select is(public.cart_set_coupon(null, repeat('77', 32), 'CARRITO10') ->> 'outcome', 'no_cart', 'sin carrito: un token que no existe → «no_cart»');
select is(public.cart_remove_coupon(null, repeat('77', 32)) ->> 'outcome', 'no_cart', 'sin carrito: quitar tampoco inventa uno');
select is((select count(*)::int from public.carts where token_hash = repeat('77', 32)), 0, 'sin carrito: y no se crea ninguno');
-- el cupón de un usuario con tope por cliente: el invitado debe iniciar sesión, la clienta con cuenta sí puede
select pg_temp.dc('{"id":"1e000000-0000-0000-0000-000000000001","name":"Una vez","kind":"percent","params":{"percent":10},"requires_coupon":true,"usage_limit_per_customer":1}');
select pg_temp.cp('1e000000-0000-0000-0000-000000000001', 'UNAVEZ01');
select is(public.cart_set_coupon(null, repeat('91', 32), 'UNAVEZ01') ->> 'reason', 'login_required', 'tope por cliente: un invitado debe iniciar sesión');
select is((select coupon_code from public.carts where token_hash = repeat('91', 32)), null, 'tope por cliente: y no se guarda para el invitado');
select public.cart_set_item('a9000000-0000-0000-0000-00000000000a', null, pg_temp.va(1), 2);
select is(public.cart_set_coupon('a9000000-0000-0000-0000-00000000000a', null, 'UNAVEZ01') ->> 'outcome', 'coupon_set', 'tope por cliente: una clienta con cuenta lo pone');
select is(pg_temp.ct(public.cart_get('a9000000-0000-0000-0000-00000000000a', null), '{cart,totals,discount}')::numeric, 20.00, 'tope por cliente: y baja 20,00');
-- ya usó su único cupón (otro pedido): se avisa «ya usaste este cupón»
select pg_temp.red('1e000000-0000-0000-0000-000000000001', (select id from public.coupons where code = 'UNAVEZ01'), 'a9000000-0000-0000-0000-00000000000a', 'applied');
select is(pg_temp.ct(public.cart_get('a9000000-0000-0000-0000-00000000000a', null), '{cart,discounts,coupon,reason}'), 'already_used', 'tope por cliente: «ya usaste este cupón»');
select public.cart_remove_coupon('a9000000-0000-0000-0000-00000000000a', null);
update public.discount_redemptions set status = 'reverted';

-- ofertas automáticas en el carrito del usuario: precio de grupo (15 %) a una clienta del grupo
select pg_temp.dc('{"id":"1e000000-0000-0000-0000-000000000002","name":"Mayoristas 15","kind":"group_price","params":{"percent":15},"customer_group_id":"e9000000-0000-0000-0000-000000000001"}');
select is(pg_temp.ct(public.cart_get('a9000000-0000-0000-0000-00000000000a', null), '{cart,totals,discount}')::numeric, 30.00, 'automático: la clienta del grupo ve 15 % de 200,00 = 30,00 sin escribir ningún código');
select is(pg_temp.ct(public.cart_get('a9000000-0000-0000-0000-00000000000a', null), '{cart,lines,0,discount_offers,0,name}'), 'Mayoristas 15', 'automático: la línea nombra la oferta');
select is(pg_temp.ct(public.cart_get('a9000000-0000-0000-0000-00000000000a', null), '{cart,discounts,applied,0,automatic}'), 'true', 'automático: figura como automática');
select is(pg_temp.ct(public.cart_get(null, repeat('91', 32)), '{cart,totals,discount}'), null, 'automático: el invitado (sin cuenta) no la ve');
-- el cupón se suma sobre la oferta solo si es acumulable (por omisión NO): con 10 % no acumulable (20,00 < 30,00) gana la oferta
select is(public.cart_set_coupon('a9000000-0000-0000-0000-00000000000a', null, 'CARRITO10') ->> 'reason', 'not_combinable', 'combinación: un cupón peor que la oferta → «no combinable» (se guarda y se avisa)');
select is(pg_temp.ct(public.cart_get('a9000000-0000-0000-0000-00000000000a', null), '{cart,totals,discount}')::numeric, 30.00, 'combinación: queda la oferta (30,00)');
select is(pg_temp.ct(public.cart_get('a9000000-0000-0000-0000-00000000000a', null), '{cart,discounts,coupon,code}'), 'CARRITO10', 'combinación: «no combinable» guardado muestra el código canónico (no el normalizado «CARR1T010»)');
select public.cart_remove_coupon('a9000000-0000-0000-0000-00000000000a', null);
delete from public.discounts where id = '1e000000-0000-0000-0000-000000000002';

-- fusión invitado → usuario: el cupón del invitado pasa al usuario si este no tenía uno
select pg_temp.wipe();
select pg_temp.pc('CARRITO10', 10);
select pg_temp.pc('OTRO20', 20);
select public.cart_set_item(null, repeat('92', 32), pg_temp.va(2), 3);
select public.cart_set_coupon(null, repeat('92', 32), 'OTRO20');
select public.cart_remove_coupon('a9000000-0000-0000-0000-00000000000a', null);
select is(pg_temp.ct(public.merge_guest_cart('a9000000-0000-0000-0000-00000000000a', repeat('92', 32)), '{token_state}'), 'merged', 'fusión: el carrito del invitado se fusiona');
select is((select coupon_code from public.carts where profile_id = 'a9000000-0000-0000-0000-00000000000a' and status = 'active'), '0TR020', 'fusión: el cupón del invitado pasa a la usuaria que no tenía (guardado normalizado)');
-- subtotal usuaria: 2 × 100,00 + 3 × 40,00 = 320,00 → 20 % = 64,00
select is(pg_temp.ct(public.cart_get('a9000000-0000-0000-0000-00000000000a', null), '{cart,totals,discount}')::numeric, 64.00, 'fusión: el cupón aplica sobre el carrito fusionado (20 % de 320,00 = 64,00)');
select public.cart_set_item(null, repeat('93', 32), pg_temp.va(2), 1);
select public.cart_set_coupon(null, repeat('93', 32), 'CARRITO10');
select public.merge_guest_cart('a9000000-0000-0000-0000-00000000000a', repeat('93', 32));
select is((select coupon_code from public.carts where profile_id = 'a9000000-0000-0000-0000-00000000000a' and status = 'active'), '0TR020', 'fusión: si la usuaria YA tenía un cupón, conserva el suyo');
select public.cart_remove_coupon('a9000000-0000-0000-0000-00000000000a', null);

-- apply_discounts (contrato para el checkout de S10)
select public.cart_set_coupon('a9000000-0000-0000-0000-00000000000a', null, 'CARRITO10');
create temp table _c as select id from public.carts where profile_id = 'a9000000-0000-0000-0000-00000000000a' and status = 'active';
-- tras las dos fusiones: 2 × 100,00 + 4 × 40,00 = 360,00 · 10 % = 36,00
select is((public.apply_discounts((select id from _c)) #>> '{totals,discount}')::numeric, 36.00, 'apply_discounts: usa el cupón guardado del carrito');
select is((public.apply_discounts((select id from _c), 'OTRO20') #>> '{totals,discount}')::numeric, 72.00, 'apply_discounts: o el código que se le pase (20 % de 360,00 = 72,00)');
select is((public.apply_discounts((select id from _c), '') #>> '{totals,discount}')::numeric, 0.00, 'apply_discounts: «» = sin cupón');
select is((public.apply_discounts((select id from _c), null, 15) #>> '{totals,grand_total}')::numeric, 339.00, 'apply_discounts: con envío 15,00: 360,00 − 36,00 + 15,00 = 339,00');
select is(public.apply_discounts(gen_random_uuid()), null, 'apply_discounts: un carrito que no existe → null');
select is(public.apply_discounts((select id from _c)) -> 'lines' -> 0 ->> 'idx', '1', 'apply_discounts: las líneas conservan su posición (idx)');
select public.cart_remove_coupon('a9000000-0000-0000-0000-00000000000a', null);
-- una línea que no se cobra (no hay stock) no cuenta para el descuento
select pg_temp.mk('03', 100.00);
update public.store_settings set value = 'false'::jsonb where key = 'reserve_on_add_to_cart';     -- sin retención: el stock puede bajar luego
select public.cart_set_item(null, repeat('94', 32), pg_temp.va(3), 2);
select public.cart_set_coupon(null, repeat('94', 32), 'CARRITO10');
select is(pg_temp.ct(public.cart_get(null, repeat('94', 32)), '{cart,totals,discount}')::numeric, 20.00, 'línea normal: 10 % de 200,00 = 20,00');
select public.apply_stock_change(pg_temp.va(3), -50, 'sale', 'agotar para la prueba');
select is(pg_temp.ct(public.cart_get(null, repeat('94', 32)), '{cart,lines,0,status}'), 'out_of_stock', 'línea agotada: el estado es out_of_stock');
select is(pg_temp.ct(public.cart_get(null, repeat('94', 32)), '{cart,totals,discount}'), null, 'línea agotada: no se cobra, así que NO genera descuento');
select is(pg_temp.ct(public.cart_get(null, repeat('94', 32)), '{cart,totals,total}')::numeric, 0.00, 'línea agotada: total 0,00 (nunca negativo)');
select is(pg_temp.ct(public.cart_get(null, repeat('94', 32)), '{cart,lines,0,discount}')::numeric, 0.00, 'línea agotada: sin descuento de línea');
-- con todo agotado, un código que NO existe se rechaza como inválido y NO queda guardado (antes «no aplica» lo guardaba y bloqueaba otros)
select public.cart_remove_coupon(null, repeat('94', 32));
select is(public.cart_set_coupon(null, repeat('94', 32), 'NOEXISTE9') ->> 'outcome', 'coupon_rejected', 'todo agotado: un código inexistente se rechaza');
select is(public.cart_set_coupon(null, repeat('94', 32), 'NOEXISTE9') ->> 'reason', 'invalid_code', 'todo agotado: con el motivo «invalid_code»');
select is((select coupon_code from public.carts where token_hash = repeat('94', 32)), null, 'todo agotado: y NO se guarda en el carrito');
select public.cart_set_coupon(null, repeat('94', 32), 'CARRITO10');
select is((select coupon_code from public.carts where token_hash = repeat('94', 32)), 'CARR1T010', 'todo agotado: un cupón que SÍ existe se guarda (podrá aplicar cuando vuelva el stock)');
update public.store_settings set value = 'true'::jsonb where key = 'reserve_on_add_to_cart';

-- ═══ G. Permisos, RLS y auditoría ═══════════════════════════════════════════════════════════
select pg_temp.wipe();
select pg_temp.dc('{"id":"1f000000-0000-0000-0000-000000000001","name":"Para RLS","kind":"percent","params":{"percent":10},"requires_coupon":true}');
select pg_temp.cp('1f000000-0000-0000-0000-000000000001', 'RLS00001');
select pg_temp.dc('{"id":"1f000000-0000-0000-0000-000000000002","name":"Sin cupón","kind":"free_shipping","params":{}}');
select pg_temp.red('1f000000-0000-0000-0000-000000000001', (select id from public.coupons where code = 'RLS00001'), 'a9000000-0000-0000-0000-00000000000a', 'applied');
-- funciones: nadie del navegador ejecuta nada de esto
select is(has_function_privilege('anon', 'public.cart_set_coupon(uuid,text,text)', 'execute'), false, 'permisos: anon NO ejecuta cart_set_coupon');
select is(has_function_privilege('authenticated', 'public.cart_set_coupon(uuid,text,text)', 'execute'), false, 'permisos: un cliente NO ejecuta cart_set_coupon (solo la función `cart`)');
select is(has_function_privilege('service_role', 'public.cart_set_coupon(uuid,text,text)', 'execute'), true, 'permisos: service_role SÍ');
select is(has_function_privilege('authenticated', 'public.cart_remove_coupon(uuid,text)', 'execute'), false, 'permisos: un cliente NO ejecuta cart_remove_coupon');
select is(has_function_privilege('authenticated', 'public.apply_discounts(uuid,text,numeric,timestamptz)', 'execute'), false, 'permisos: un cliente NO ejecuta apply_discounts (no puede probar códigos)');
select is(has_function_privilege('anon', 'public.apply_discounts(uuid,text,numeric,timestamptz)', 'execute'), false, 'permisos: anon NO ejecuta apply_discounts');
select is(has_function_privilege('service_role', 'public.apply_discounts(uuid,text,numeric,timestamptz)', 'execute'), true, 'permisos: service_role SÍ ejecuta apply_discounts');
select is(has_function_privilege('authenticated', 'public.discount_reserve(text,uuid,uuid,jsonb)', 'execute'), false, 'permisos: un cliente NO reserva usos');
select is(has_function_privilege('anon', 'public.discount_release(text,uuid)', 'execute'), false, 'permisos: anon NO devuelve usos');
select is(has_function_privilege('authenticated', 'public.discount_commit(text,uuid)', 'execute'), false, 'permisos: un cliente NO confirma usos');
select is(has_function_privilege('service_role', 'public.discount_reserve(text,uuid,uuid,jsonb)', 'execute'), true, 'permisos: el servidor SÍ reserva');
select is(has_function_privilege('anon', 'public._discount_evaluate(uuid,text,jsonb,text,numeric,timestamptz)', 'execute')
          or has_function_privilege('authenticated', 'public._discount_evaluate(uuid,text,jsonb,text,numeric,timestamptz)', 'execute')
          or has_function_privilege('service_role', 'public._discount_evaluate(uuid,text,jsonb,text,numeric,timestamptz)', 'execute'), false,
          'permisos: el motor interno no lo ejecuta nadie fuera (ni service_role: así nadie fija «ahora»)');
select is(has_function_privilege('anon', 'public._customer_order_count(uuid)', 'execute') or has_function_privilege('authenticated', 'public._customer_order_count(uuid)', 'execute'), false, 'permisos: el conteo de pedidos no es público');
select is(has_function_privilege('anon', 'public.admin_generate_coupon_codes(uuid,int,text,int,int)', 'execute'), false, 'permisos: anon NO genera códigos');
select is(has_function_privilege('authenticated', 'public.admin_generate_coupon_codes(uuid,int,text,int,int)', 'execute'), true, 'permisos: authenticated lo ejecuta (y adentro se exige ser admin)');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname in ('discounts', 'coupons', 'discount_targets', 'discount_redemptions', 'customer_groups',
                  'customer_group_members') and c.relrowsecurity), 6, 'permisos: las 6 tablas tienen RLS activada');
select is(has_table_privilege('anon', 'public.discount_usage', 'select'), false, 'permisos: anon no lee el resumen de usos');
-- anon
set local role anon;
select throws_ok($$select * from public.discounts$$, '42501', null, 'RLS: anon no lee los descuentos');
select throws_ok($$select * from public.coupons$$, '42501', null, 'RLS: anon no lee los cupones (no se pueden listar códigos)');
select throws_ok($$select * from public.discount_redemptions$$, '42501', null, 'RLS: anon no lee las redenciones');
select throws_ok($$select * from public.customer_groups$$, '42501', null, 'RLS: anon no lee los grupos');
select throws_ok($$select * from public.discount_usage$$, '42501', null, 'RLS: anon no lee el resumen de usos');
reset role;
-- cliente (no admin)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((select count(*)::int from public.discounts), 0, 'RLS: un cliente ve 0 descuentos');
select is((select count(*)::int from public.coupons), 0, 'RLS: un cliente ve 0 cupones');
select is((select count(*)::int from public.discount_redemptions), 0, 'RLS: un cliente no ve ni sus propias redenciones');
select is((select count(*)::int from public.customer_group_members), 0, 'RLS: un cliente no ve la pertenencia a grupos');
select is((select count(*)::int from public.discount_usage), 0, 'RLS: el resumen de usos (vista con los permisos de quien consulta) no muestra nada a un cliente');
select throws_ok($$insert into public.discounts (name, kind, params, requires_coupon) values ('X', 'percent', '{"percent":99}', true)$$, '42501', null, 'RLS: un cliente no crea descuentos');
select throws_ok($$insert into public.coupons (discount_id, code) values ('1f000000-0000-0000-0000-000000000001', 'HACKEO99')$$, '42501', null, 'RLS: un cliente no crea cupones');
select lives_ok($$update public.discounts set is_active = false$$, 'RLS: un cliente que intenta apagar descuentos no ve ninguna fila (no falla, pero no cambia nada)');
select throws_ok($$select public.admin_generate_coupon_codes('1f000000-0000-0000-0000-000000000001', 5)$$, '42501', null, 'RLS: un cliente no genera códigos (la función exige ser admin)');
select throws_ok($$select public.cart_set_coupon(null, null, 'X')$$, '42501', null, 'RLS: un cliente no ejecuta cart_set_coupon directo');
reset role;
select is((select count(*)::int from public.discounts where not is_active), 0, 'RLS: …y ningún descuento quedó apagado por ese intento');
-- admin
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ad900000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select is((select count(*)::int from public.discounts), 2, 'RLS: el admin ve los descuentos');
select is((select count(*)::int from public.coupons), 1, 'RLS: el admin ve los cupones');
select is((select count(*)::int from public.discount_redemptions), 1, 'RLS: el admin ve las redenciones');
select is((select used from public.discount_usage where discount_id = '1f000000-0000-0000-0000-000000000001'), 1, 'RLS: el admin ve el uso de cada descuento');
select lives_ok($$insert into public.discounts (name, kind, params, requires_coupon, scope, currency, min_order_amount, usage_limit_total, priority)
                  values ('Creado por el admin', 'percent', '{"percent":15}', true, 'order', 'BOB', 100, 50, 150)$$, 'admin: crea un descuento');
select lives_ok($$update public.discounts set name = 'Renombrado', is_active = false, usage_limit_total = 60 where name = 'Creado por el admin'$$, 'admin: edita nombre, estado y tope');
select lives_ok($$update public.discounts set params = '{"percent":20}' where name = 'Renombrado'$$, 'admin: edita los parámetros');
select throws_ok($$update public.discounts set params = '{"percent":200}' where name = 'Renombrado'$$, '23514', null, 'admin: parámetros inválidos se rechazan');
select throws_ok($$update public.discounts set kind = 'fixed' where name = 'Renombrado'$$, '42501', null, 'admin: el TIPO no se cambia (sin permiso de columna)');
select throws_ok($$update public.discounts set scope = 'product' where name = 'Renombrado'$$, '42501', null, 'admin: el ALCANCE no se cambia');
select throws_ok($$update public.discounts set currency = 'USD' where name = 'Renombrado'$$, '42501', null, 'admin: la MONEDA no se cambia');
select lives_ok($$update public.discounts set archived_at = now() where name = 'Renombrado'$$, 'admin: archiva');
select throws_ok($$delete from public.discounts where name = 'Renombrado'$$, '42501', null, 'admin: nadie borra descuentos (se archivan)');
select lives_ok($$insert into public.coupons (discount_id, code, usage_limit) values ('1f000000-0000-0000-0000-000000000001', 'Manual-01', 1)$$, 'admin: crea un cupón manual');
select throws_ok($$update public.coupons set code = 'OTRO-CODIGO' where code = 'Manual-01'$$, '42501', null, 'admin: el código de un cupón NO se edita');
select lives_ok($$update public.coupons set is_active = false, usage_limit = 5 where code = 'Manual-01'$$, 'admin: apaga un cupón y cambia su tope');
select throws_ok($$delete from public.coupons where code = 'Manual-01'$$, '42501', null, 'admin: nadie borra cupones');
select throws_ok($$insert into public.coupons (discount_id, code) values ('1f000000-0000-0000-0000-000000000002', 'SINPEDIR1')$$, '23514', null, 'admin: un descuento automático no puede tener cupones');
select throws_ok($$insert into public.discount_redemptions (discount_id, owner_type, owner_id, amount, currency) values ('1f000000-0000-0000-0000-000000000001', 'order', gen_random_uuid(), 1, 'BOB')$$, '42501', null, 'admin: ni el admin crea redenciones a mano (solo las funciones)');
select throws_ok($$update public.discount_redemptions set status = 'reverted'$$, '42501', null, 'admin: ni cambia su estado');
select lives_ok($$insert into public.customer_groups (name) values ('Amigas')$$, 'admin: crea un grupo');
select throws_ok($$insert into public.customer_groups (name) values ('amigas')$$, '23505', null, 'admin: el nombre de un grupo no se repite (sin mayúsculas)');
select lives_ok($$insert into public.customer_group_members (group_id, profile_id) values ((select id from public.customer_groups where name = 'Amigas'), 'a9000000-0000-0000-0000-00000000000b')$$, 'admin: agrega una clienta al grupo');
select throws_ok($$insert into public.customer_group_members (group_id, profile_id) values ((select id from public.customer_groups where name = 'Amigas'), 'a9000000-0000-0000-0000-00000000000b')$$, '23505', null, 'admin: la misma clienta dos veces no entra');
select lives_ok($$update public.customer_group_members set archived_at = now() where group_id = (select id from public.customer_groups where name = 'Amigas')$$, 'admin: la saca del grupo (se archiva)');
select lives_ok($$insert into public.customer_group_members (group_id, profile_id) values ((select id from public.customer_groups where name = 'Amigas'), 'a9000000-0000-0000-0000-00000000000b')$$, 'admin: y puede volver a entrar');
select throws_ok($$delete from public.customer_group_members$$, '42501', null, 'admin: nadie borra pertenencias');
reset role;
-- auditoría (cuenta DIFERENCIAS: la nube ya trae filas)
-- el registro dice QUIÉN (el admin, por su sesión) y QUÉ cambió
select is((select actor_id::text from public.audit_log where table_name = 'discounts' and action = 'INSERT' and record_id = (select id::text from public.discounts where name = 'Renombrado')),
          'ad900000-0000-0000-0000-00000000000d', 'auditoría: el alta del descuento quedó con el admin como autor');
select is((select diff -> 'name' #>> '{}' from public.audit_log where table_name = 'discounts' and action = 'INSERT' and record_id = (select id::text from public.discounts where name = 'Renombrado')),
          'Creado por el admin', 'auditoría: el alta guarda los valores');
select is((select diff #>> '{name,old}' from public.audit_log where table_name = 'discounts' and action = 'UPDATE' and record_id = (select id::text from public.discounts where name = 'Renombrado')
             and diff ? 'name'), 'Creado por el admin', 'auditoría: el cambio de nombre guarda el valor ANTERIOR');
select is((select diff #>> '{name,new}' from public.audit_log where table_name = 'discounts' and action = 'UPDATE' and record_id = (select id::text from public.discounts where name = 'Renombrado')
             and diff ? 'name'), 'Renombrado', 'auditoría: …y el NUEVO');
select is((select diff #>> '{is_active,new}' from public.audit_log where table_name = 'discounts' and action = 'UPDATE' and record_id = (select id::text from public.discounts where name = 'Renombrado')
             and diff ? 'is_active'), 'false', 'auditoría: apagar un descuento queda registrado');
select ok(exists (select 1 from public.audit_log where table_name = 'discounts' and action = 'UPDATE' and record_id = (select id::text from public.discounts where name = 'Renombrado') and diff ? 'archived_at'),
          'auditoría: archivar queda registrado');
select ok(exists (select 1 from public.audit_log where table_name = 'coupons' and action = 'INSERT' and record_id = (select id::text from public.coupons where code = 'Manual-01')
                   and actor_id = 'ad900000-0000-0000-0000-00000000000d'), 'auditoría: el cupón creado por el admin también');
select ok(exists (select 1 from public.audit_log where table_name = 'customer_group_members' and action = 'INSERT'
                   and actor_id = 'ad900000-0000-0000-0000-00000000000d'), 'auditoría: y la pertenencia a grupos');
select ok(exists (select 1 from public.audit_log where table_name = 'customer_groups' and action = 'INSERT' and record_id = (select id::text from public.customer_groups where name = 'Amigas')),
          'auditoría: y los grupos');

-- ═══ H. Generar códigos aleatorios ══════════════════════════════════════════════════════════
select pg_temp.dc('{"id":"1f000000-0000-0000-0000-000000000004","name":"Lote de códigos","kind":"percent","params":{"percent":10},"requires_coupon":true}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ad900000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
create temp table _gen as select unnest(public.admin_generate_coupon_codes('1f000000-0000-0000-0000-000000000004', 20)) as code;
grant select on _gen to authenticated;
select is((select count(*)::int from _gen), 20, 'códigos: genera los 20 pedidos');
select is((select count(distinct code)::int from _gen), 20, 'códigos: todos distintos');
select is((select count(distinct public._coupon_norm(code))::int from _gen), 20, 'códigos: y distintos también ya normalizados');
select is((select count(*)::int from _gen where code ~ '^[2-9A-HJKMNP-Z]{8}$'), 20, 'códigos: 8 caracteres de un alfabeto SIN 0, O, 1, I, L (no se confunden)');
select is((select count(*)::int from public.coupons where discount_id = '1f000000-0000-0000-0000-000000000004'), 20, 'códigos: quedan guardados como cupones del descuento');
select is((select count(*)::int from public.coupons where discount_id = '1f000000-0000-0000-0000-000000000004' and usage_limit is null), 20, 'códigos: sin tope propio por omisión');
select is(cardinality(public.admin_generate_coupon_codes('1f000000-0000-0000-0000-000000000004', 3, 'vip', 10, 1)), 3, 'códigos: con prefijo, largo 10 y un solo uso');
select is((select count(*)::int from public.coupons where discount_id = '1f000000-0000-0000-0000-000000000004' and code ~ '^VIP-[2-9A-HJKMNP-Z]{10}$' and usage_limit = 1), 3, 'códigos: llevan el prefijo en mayúsculas y su tope de un uso');
select throws_ok($$select public.admin_generate_coupon_codes('1f000000-0000-0000-0000-000000000004', 0)$$, '22023', null, 'códigos: pedir 0 es inválido');
select throws_ok($$select public.admin_generate_coupon_codes('1f000000-0000-0000-0000-000000000004', 501)$$, '22023', null, 'códigos: más de 500 por lote es inválido');
select throws_ok($$select public.admin_generate_coupon_codes('1f000000-0000-0000-0000-000000000004', 5, null, 5)$$, '22023', null, 'códigos: menos de 6 caracteres es inválido (muy fáciles de adivinar)');
select throws_ok($$select public.admin_generate_coupon_codes('1f000000-0000-0000-0000-000000000004', 5, 'a b')$$, '22023', null, 'códigos: un prefijo con espacios es inválido');
select throws_ok($$select public.admin_generate_coupon_codes('1f000000-0000-0000-0000-000000000004', 5, 'ABCDEFGHIJ')$$, '22023', null, 'códigos: un prefijo de más de 8 caracteres es inválido');
select is((select length(c) from unnest(public.admin_generate_coupon_codes('1f000000-0000-0000-0000-000000000004', 1, 'ABCDEFGH', 20)) c), 29, 'códigos: el máximo (prefijo de 8 + guion + 20 caracteres) mide 29 y cabe en el límite de 32');
select throws_ok($$select public.admin_generate_coupon_codes('1f000000-0000-0000-0000-000000000002', 5)$$, 'P0002', null, 'códigos: un descuento que no pide código no genera');
select throws_ok($$select public.admin_generate_coupon_codes(gen_random_uuid(), 5)$$, 'P0002', null, 'códigos: un descuento que no existe no genera');
select throws_ok($$select public.admin_generate_coupon_codes('1f000000-0000-0000-0000-000000000004', 5, null, 8, 0)$$, '22023', null, 'códigos: un tope de uso de 0 es inválido');
reset role;
-- un código generado SIRVE como cupón (de punta a punta)
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), (select min(code) from _gen))), 'applied', 'códigos: un código generado funciona como cupón');
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), lower((select min(code) from _gen)))), 'applied', 'códigos: y también escrito en minúsculas');
select is(pg_temp.cst(pg_temp.ev(pg_temp.l('L12'), regexp_replace((select min(code) from _gen), '(.)', '\1 ', 'g'))), 'applied', 'códigos: o con espacios intercalados');

select * from finish();
rollback;
