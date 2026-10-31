-- Sprint 2 · Inventario: libro mayor, guarda del stock, ajuste del admin, reservas (idempotencia, topes,
-- vencimiento, liberación), semáforo y vistas de disponibilidad. Valores esperados calculados a mano.
begin;
select plan(149);

alter table public.stock_movements disable trigger user;
alter table public.exchange_rates disable trigger user;
alter table public.product_slug_history disable trigger user;
truncate public.products, public.categories, public.collections, public.news_banners, public.home_sections,
         public.exchange_rates restart identity cascade;
alter table public.stock_movements enable trigger user;
alter table public.exchange_rates enable trigger user;
alter table public.product_slug_history enable trigger user;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('c0000000-0000-0000-0000-0000000000c1', 'cliente.s2@test.com', '{"full_name":"Cliente S2"}', 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-0000000000a1', 'admin.s2@test.com',   '{"full_name":"Admin S2"}',   'authenticated', 'authenticated');
select public.set_user_role('a0000000-0000-0000-0000-0000000000a1', 'admin');

-- ── Fixture ────────────────────────────────────────────────────────────────────────────────
-- L = libro mayor y ajustes · A = semáforo y vistas de admin · R = reservas · D = borrador · E = archivado
insert into public.products (id, code, slug, name) values
  ('b1000000-0000-0000-0000-00000000000a', 'L-1', 'l-1', 'Producto L'),
  ('b1000000-0000-0000-0000-00000000000b', 'A-1', 'a-1', 'Producto A'),
  ('b1000000-0000-0000-0000-00000000000c', 'R-1', 'r-1', 'Producto R'),
  ('b1000000-0000-0000-0000-00000000000d', 'D-1', 'd-1', 'Producto D (borrador)'),
  ('b1000000-0000-0000-0000-00000000000e', 'E-1', 'e-1', 'Producto E (archivado)');
insert into public.product_colors (id, product_id, name) values
  ('d3000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-00000000000a', 'Único'),
  ('d3000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-00000000000b', 'Blanco'),
  ('d3000000-0000-0000-0000-00000000000f', 'b1000000-0000-0000-0000-00000000000b', 'Negro'),
  ('d3000000-0000-0000-0000-00000000000c', 'b1000000-0000-0000-0000-00000000000c', 'Único'),
  ('d3000000-0000-0000-0000-00000000000d', 'b1000000-0000-0000-0000-00000000000d', 'Único'),
  ('d3000000-0000-0000-0000-00000000000e', 'b1000000-0000-0000-0000-00000000000e', 'Único');
insert into public.product_sizes (id, product_id, label) values
  ('e3000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-00000000000b', 'XS'),
  ('e3000000-0000-0000-0000-00000000000c', 'b1000000-0000-0000-0000-00000000000b', 'S');
insert into public.product_variants (id, product_id, color_id, size_id) values
  ('f3000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-00000000000a', 'd3000000-0000-0000-0000-00000000000a', null),                                    -- vL
  ('f3000000-0000-0000-0000-0000000000b1', 'b1000000-0000-0000-0000-00000000000b', 'd3000000-0000-0000-0000-00000000000b', 'e3000000-0000-0000-0000-00000000000b'), -- vA1 Blanco XS
  ('f3000000-0000-0000-0000-0000000000b2', 'b1000000-0000-0000-0000-00000000000b', 'd3000000-0000-0000-0000-00000000000b', 'e3000000-0000-0000-0000-00000000000c'), -- vA2 Blanco S
  ('f3000000-0000-0000-0000-0000000000b3', 'b1000000-0000-0000-0000-00000000000b', 'd3000000-0000-0000-0000-00000000000f', null),                                    -- vA3 Negro
  ('f3000000-0000-0000-0000-0000000000c1', 'b1000000-0000-0000-0000-00000000000c', 'd3000000-0000-0000-0000-00000000000c', null),                                    -- vR
  ('f3000000-0000-0000-0000-0000000000d1', 'b1000000-0000-0000-0000-00000000000d', 'd3000000-0000-0000-0000-00000000000d', null),                                    -- vD
  ('f3000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-00000000000e', 'd3000000-0000-0000-0000-00000000000e', null);                                    -- vE
insert into public.product_variants (id, product_id, color_id, size_id, archived_at) values
  ('f3000000-0000-0000-0000-0000000000b4', 'b1000000-0000-0000-0000-00000000000b', 'd3000000-0000-0000-0000-00000000000f', 'e3000000-0000-0000-0000-00000000000b', now()), -- vA4 archivada
  ('f3000000-0000-0000-0000-0000000000c2', 'b1000000-0000-0000-0000-00000000000c', 'd3000000-0000-0000-0000-00000000000c', null, now());                              -- vRa archivada de R
insert into public.product_colors (id, product_id, name) values ('d3000000-0000-0000-0000-000000000010', 'b1000000-0000-0000-0000-00000000000c', 'Otro');
insert into public.product_variants (id, product_id, color_id) values ('f3000000-0000-0000-0000-0000000000c3', 'b1000000-0000-0000-0000-00000000000c', 'd3000000-0000-0000-0000-000000000010'); -- vR2 (activa, sin stock)
insert into public.product_prices (product_id, currency, amount) select id, 'BOB', 100 from public.products;
update public.products set status = 'active' where code in ('L-1', 'A-1', 'R-1', 'E-1');
update public.products set archived_at = now() where code = 'E-1';
-- stock inicial SIEMPRE por el libro mayor
select public.apply_stock_change('f3000000-0000-0000-0000-0000000000b1', 10, 'import', 'carga inicial');
select public.apply_stock_change('f3000000-0000-0000-0000-0000000000b3', 3, 'import', 'carga inicial');
select public.apply_stock_change('f3000000-0000-0000-0000-0000000000b4', 7, 'import', 'carga inicial');
select public.apply_stock_change('f3000000-0000-0000-0000-0000000000c1', 5, 'import', 'carga inicial');
select public.apply_stock_change('f3000000-0000-0000-0000-0000000000c2', 2, 'import', 'carga inicial');
select public.apply_stock_change('f3000000-0000-0000-0000-0000000000d1', 2, 'import', 'carga inicial');
select public.apply_stock_change('f3000000-0000-0000-0000-0000000000e1', 2, 'import', 'carga inicial');

-- ── Libro mayor (variante vL) ──────────────────────────────────────────────────────────────
select is(public.apply_stock_change('f3000000-0000-0000-0000-0000000000a1', 10, 'import', 'carga'), 10, 'apply_stock_change devuelve el stock resultante');
select is(public.apply_stock_change('f3000000-0000-0000-0000-0000000000a1', 5, 'adjust'), 15, '10 + 5 = 15');
select is(public.apply_stock_change('f3000000-0000-0000-0000-0000000000a1', -3, 'sale', 'PED-1'), 12, '15 − 3 = 12');
select is((select stock_on_hand from public.product_variants where id = 'f3000000-0000-0000-0000-0000000000a1'), 12, 'stock_on_hand = 12');
select is((select count(*)::int from public.stock_movements where variant_id = 'f3000000-0000-0000-0000-0000000000a1'), 3, 'quedaron 3 movimientos');
select is((select sum(delta)::int from public.stock_movements where variant_id = 'f3000000-0000-0000-0000-0000000000a1'), 12, 'invariante: suma de deltas = stock_on_hand');
select is((select string_agg(stock_after::text, ',' order by id) from public.stock_movements where variant_id = 'f3000000-0000-0000-0000-0000000000a1'), '10,15,12', 'stock_after refleja cada paso');
select is((select ref from public.stock_movements where variant_id = 'f3000000-0000-0000-0000-0000000000a1' and reason = 'sale'), 'PED-1', 'la referencia del movimiento se guarda');
select throws_ok($$select public.apply_stock_change('f3000000-0000-0000-0000-0000000000a1', 0, 'adjust')$$, '22023', null, 'cambio 0 rechazado');
select throws_ok($$select public.apply_stock_change('f3000000-0000-0000-0000-0000000000a1', null, 'adjust')$$, '22023', null, 'cambio NULL rechazado');
select throws_ok($$select public.apply_stock_change('f3000000-0000-0000-0000-0000000000a1', -100, 'adjust')$$, '23514', null, 'restar más de lo que hay rechazado (stock nunca negativo)');
select throws_ok($$select public.apply_stock_change('f3000000-0000-0000-0000-0000000000a1', 1, 'regalo')$$, '23514', null, 'motivo fuera del catálogo rechazado');
select throws_ok($$select public.apply_stock_change(gen_random_uuid(), 1, 'import')$$, 'P0002', null, 'variante inexistente rechazada');
select is((select stock_on_hand from public.product_variants where id = 'f3000000-0000-0000-0000-0000000000a1'), 12, 'los rechazos no dejaron cambios a medias (sigue en 12)');
select is((select count(*)::int from public.stock_movements where variant_id = 'f3000000-0000-0000-0000-0000000000a1'), 3, '…ni movimientos huérfanos (siguen 3)');
select throws_ok($$update public.product_variants set stock_on_hand = 99 where id = 'f3000000-0000-0000-0000-0000000000a1'$$, '42501', null, 'UPDATE directo de stock rechazado incluso para el propietario');
select throws_ok($$insert into public.product_variants (product_id, color_id, stock_on_hand) values ('b1000000-0000-0000-0000-00000000000a', 'd3000000-0000-0000-0000-00000000000a', 5)$$, '42501', null, 'una variante no puede nacer con stock (debe pasar por el libro mayor)');
select throws_ok($$update public.stock_movements set delta = 99 where variant_id = 'f3000000-0000-0000-0000-0000000000a1'$$, '42501', null, 'el libro mayor no se modifica');
select throws_ok($$delete from public.stock_movements$$, '42501', null, 'el libro mayor no se borra');
select throws_ok($$truncate public.stock_movements$$, '42501', null, 'el libro mayor no se trunca');
set local role service_role;
select throws_ok($$insert into public.stock_movements (variant_id, delta, reason, stock_after) values ('f3000000-0000-0000-0000-0000000000a1', 1, 'adjust', 13)$$, '42501', null, 'service_role NO puede forjar movimientos');
select throws_ok($$update public.product_variants set stock_on_hand = 1 where id = 'f3000000-0000-0000-0000-0000000000a1'$$, '42501', null, 'service_role NO puede tocar stock_on_hand directamente');
reset role;

-- ── adjust_stock (admin) ───────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select throws_ok($$select public.adjust_stock('f3000000-0000-0000-0000-0000000000a1', 5, 'adjust')$$, '42501', null, 'un cliente NO ajusta stock');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select public.adjust_stock('f3000000-0000-0000-0000-0000000000a1', 5, 'adjust')$$, '42501', null, 'anon NO puede ni ejecutar adjust_stock');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is(public.adjust_stock('f3000000-0000-0000-0000-0000000000a1', 20, 'import', 'carga masiva'), 32, 'admin: 12 + 20 = 32');
select is(public.adjust_stock('f3000000-0000-0000-0000-0000000000a1', -5, 'adjust', 'merma'), 27, 'admin: 32 − 5 = 27');
select throws_ok($$select public.adjust_stock('f3000000-0000-0000-0000-0000000000a1', 1, 'sale')$$, '22023', null, 'el admin no puede registrar "sale" a mano');
select throws_ok($$select public.adjust_stock('f3000000-0000-0000-0000-0000000000a1', 1, 'regalo')$$, '22023', null, 'motivo desconocido rechazado');
select throws_ok($$select public.adjust_stock('f3000000-0000-0000-0000-0000000000a1', 0, 'adjust')$$, '22023', null, 'ajuste 0 rechazado');
select throws_ok($$select public.adjust_stock('f3000000-0000-0000-0000-0000000000a1', -1, 'import')$$, '22023', null, '"import" no puede restar stock');
select throws_ok($$select public.adjust_stock('f3000000-0000-0000-0000-0000000000a1', -1, 'return')$$, '22023', null, '"return" no puede restar stock');
select throws_ok($$select public.adjust_stock('f3000000-0000-0000-0000-0000000000a1', null, 'adjust')$$, '22023', null, 'ajuste NULL rechazado');
select throws_ok($$select public.adjust_stock('f3000000-0000-0000-0000-0000000000a1', -100, 'adjust')$$, '23514', null, 'el admin no puede dejar stock negativo');
select throws_ok($$select public.adjust_stock(gen_random_uuid(), 1, 'adjust')$$, 'P0002', null, 'variante inexistente rechazada');
reset role;
select is((select created_by from public.stock_movements where note = 'merma'), 'a0000000-0000-0000-0000-0000000000a1'::uuid, 'el movimiento guarda QUIÉN hizo el ajuste');
select is((select stock_after from public.stock_movements where note = 'merma'), 27, '…y el stock resultante');

-- Regla de lo comprometido: un pedido (reserva firme) de 25 sobre un stock de 27
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000a1', 25, 'order', '09000000-0000-0000-0000-000000000009') ->> 'status', 'reserved', 'pedido compromete 25 unidades firmes');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select throws_ok($$select public.adjust_stock('f3000000-0000-0000-0000-0000000000a1', -3, 'adjust')$$, 'P0001', null, 'bajar a 24 con 25 comprometidas está BLOQUEADO');
select is(public.adjust_stock('f3000000-0000-0000-0000-0000000000a1', -2, 'adjust'), 25, 'bajar a exactamente 25 (= comprometido) se permite');
select throws_ok($$select public.adjust_stock('f3000000-0000-0000-0000-0000000000a1', -1, 'adjust')$$, 'P0001', null, 'bajar a 24 desde 25 sigue bloqueado');
select is(public.adjust_stock('f3000000-0000-0000-0000-0000000000a1', 1, 'return'), 26, 'subir stock siempre se permite (devolución)');
reset role;
select is(public.release_stock('order', '09000000-0000-0000-0000-000000000009'), 1, 'liberar el pedido devuelve 1 reserva liberada');
-- Una retención de CARRITO es blanda: no bloquea el ajuste, y available nunca es negativo
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000a1', 20, 'cart', '0c000000-0000-0000-0000-00000000000c') ->> 'status', 'reserved', 'carrito retiene 20 de 26');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is(public.adjust_stock('f3000000-0000-0000-0000-0000000000a1', -11, 'adjust'), 15, 'el admin SÍ puede bajar a 15 aunque un carrito retenga 20 (retención blanda)');
reset role;
select is((select available from public.variant_availability where variant_id = 'f3000000-0000-0000-0000-0000000000a1'), 0, 'available = máx(15 − 20, 0) = 0: nunca negativo');
select is((select reserved from public.variant_availability where variant_id = 'f3000000-0000-0000-0000-0000000000a1'), 20, '…y reserved sigue siendo 20');
select is(public.release_stock('cart', '0c000000-0000-0000-0000-00000000000c'), 1, 'se libera el carrito');

-- ── Reservas (variante vR, stock 5) ────────────────────────────────────────────────────────
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 2, 'cart', '01000000-0000-0000-0000-000000000001') - 'expires_at',
  '{"status":"reserved","reserved":2,"available":3}'::jsonb, 'O1 reserva 2 de 5 → quedan 3');
select is((select expires_at from public.stock_reservations where owner_id = '01000000-0000-0000-0000-000000000001' and status = 'active'),
  now() + interval '10 minutes', 'la retención del carrito vence a los 10 min (ajuste reservation_ttl_minutes)');
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 2, 'cart', '01000000-0000-0000-0000-000000000001') - 'expires_at',
  '{"status":"reserved","reserved":2,"available":3}'::jsonb, 'IDEMPOTENTE: repetir la misma reserva no cambia nada');
select is((select count(*)::int from public.stock_reservations where owner_id = '01000000-0000-0000-0000-000000000001' and status = 'active'), 1, '…y sigue habiendo UNA sola fila activa');
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 4, 'cart', '01000000-0000-0000-0000-000000000001') - 'expires_at',
  '{"status":"reserved","reserved":4,"available":1}'::jsonb, 'O1 sube su reserva a 4 → queda 1');
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 2, 'cart', '02000000-0000-0000-0000-000000000002'),
  '{"status":"insufficient_stock","reserved":0,"available":1}'::jsonb, 'O2 pide 2 pero solo queda 1 → insufficient_stock, sin reservar nada');
select is((select count(*)::int from public.stock_reservations where owner_id = '02000000-0000-0000-0000-000000000002'), 0, '…y no dejó ninguna fila');
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 1, 'cart', '02000000-0000-0000-0000-000000000002') - 'expires_at',
  '{"status":"reserved","reserved":1,"available":0}'::jsonb, 'O2 reserva la última unidad');
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 5, 'cart', '01000000-0000-0000-0000-000000000001'),
  '{"status":"insufficient_stock","reserved":4,"available":4}'::jsonb, 'O1 pide subir a 5 pero solo puede tener 4 (5 − 1 de O2): rechazado');
select is((select qty from public.stock_reservations where owner_id = '01000000-0000-0000-0000-000000000001' and status = 'active'), 4, '…y conserva los 4 que ya tenía (pedir de más no le quita lo que sí tenía)');
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 1, 'cart', '01000000-0000-0000-0000-000000000001') - 'expires_at',
  '{"status":"reserved","reserved":1,"available":3}'::jsonb, 'O1 baja su reserva a 1 → quedan 3 para otros');
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 0, 'cart', '01000000-0000-0000-0000-000000000001'),
  '{"status":"released","reserved":0,"available":4}'::jsonb, 'qty 0 libera la reserva de O1');
select is((select status from public.stock_reservations where owner_id = '01000000-0000-0000-0000-000000000001'), 'released', '…y la fila queda "released"');
select is(public.release_stock('cart', '02000000-0000-0000-0000-000000000002'), 1, 'release_stock libera la de O2 (1 fila)');
select is(public.release_stock('cart', '02000000-0000-0000-0000-000000000002'), 0, 'liberar dos veces es inocuo (0 filas)');

-- Vencimiento: una reserva vencida deja de contar AUNQUE el cron aún no haya corrido
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 2, 'cart', '03000000-0000-0000-0000-000000000003', 60) - 'expires_at',
  '{"status":"reserved","reserved":2,"available":3}'::jsonb, 'O3 reserva 2 con TTL de 60 s');
select is((select expires_at from public.stock_reservations where owner_id = '03000000-0000-0000-0000-000000000003'), now() + interval '60 seconds', 'el TTL explícito manda sobre el ajuste');
update public.stock_reservations set expires_at = now() - interval '1 second' where owner_id = '03000000-0000-0000-0000-000000000003';
select is((select reserved from public.variant_availability where variant_id = 'f3000000-0000-0000-0000-0000000000c1'), 0, 'una reserva vencida no cuenta (aunque su status aún sea active)');
select is((select available from public.variant_availability where variant_id = 'f3000000-0000-0000-0000-0000000000c1'), 5, '…y las 5 unidades vuelven a estar disponibles');
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 5, 'cart', '04000000-0000-0000-0000-000000000004') - 'expires_at',
  '{"status":"reserved","reserved":5,"available":0}'::jsonb, 'otro cliente puede reservar las 5 aunque la fila vencida siga "active"');
select is(public.expire_reservations(), 1, 'expire_reservations marca 1 reserva vencida');
select is(public.expire_reservations(), 0, '…y es idempotente (0 la segunda vez)');
select is((select status from public.stock_reservations where owner_id = '03000000-0000-0000-0000-000000000003'), 'expired', 'la de O3 quedó "expired"');
select is((select count(*)::int from public.stock_reservations where status = 'active' and variant_id = 'f3000000-0000-0000-0000-0000000000c1'), 1, '…y la vigente de O4 sigue activa');
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 1, 'cart', '03000000-0000-0000-0000-000000000003'),
  '{"status":"insufficient_stock","reserved":0,"available":0}'::jsonb, 'O3 vuelve a pedir pero O4 tiene todo: insufficient_stock');
select is(public.release_stock('cart', '04000000-0000-0000-0000-000000000004'), 1, 'se libera la de O4');
-- Reactivar a un dueño cuya reserva venció pero el cron aún no la marcó
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 1, 'cart', '05000000-0000-0000-0000-000000000005') ->> 'status', 'reserved', 'O5 reserva 1');
update public.stock_reservations set expires_at = now() - interval '1 second' where owner_id = '05000000-0000-0000-0000-000000000005';
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 2, 'cart', '05000000-0000-0000-0000-000000000005') ->> 'status', 'reserved', 'O5 reserva de nuevo (la vencida se reutiliza, sin chocar con el índice único)');
select is((select qty from public.stock_reservations where owner_id = '05000000-0000-0000-0000-000000000005' and status = 'active'), 2, '…con la cantidad nueva');
select is((select count(*)::int from public.stock_reservations where owner_id = '05000000-0000-0000-0000-000000000005' and status = 'active'), 1, '…y una sola fila activa');
select is(public.release_stock('cart', '05000000-0000-0000-0000-000000000005'), 1, 'se libera la de O5');
-- TTL y argumentos
select is((select (public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 1, 'cart', '06000000-0000-0000-0000-000000000006', 30) ->> 'expires_at')::timestamptz), now() + interval '30 seconds', 'p_ttl_seconds = 30 → vence en 30 s');
select throws_ok($$select public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 1, 'cart', gen_random_uuid(), 0)$$, '22023', null, 'ttl 0 rechazado');
select throws_ok($$select public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 1, 'cart', gen_random_uuid(), 86401)$$, '22023', null, 'ttl > 24 h rechazado');
select throws_ok($$select public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', -1, 'cart', gen_random_uuid())$$, '22023', null, 'cantidad negativa rechazada');
select throws_ok($$select public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 1001, 'cart', gen_random_uuid())$$, '22023', null, 'cantidad > 1000 rechazada');
select throws_ok($$select public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 1, 'wishlist', gen_random_uuid())$$, '22023', null, 'tipo de dueño desconocido rechazado');
select throws_ok($$select public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 1, 'cart', null)$$, '22023', null, 'dueño NULL rechazado');
-- Compromiso firme de pedido: no vence
select is((public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 2, 'order', '07000000-0000-0000-0000-000000000007') ->> 'expires_at'), null, 'una reserva de pedido NO tiene vencimiento');
select is((select expires_at from public.stock_reservations where owner_id = '07000000-0000-0000-0000-000000000007'), null, '…tampoco en la tabla');
select is(public.release_stock('order', '07000000-0000-0000-0000-000000000007', 'f3000000-0000-0000-0000-0000000000c1'), 1, 'release_stock con variante concreta');
select is(public.release_stock('cart', '06000000-0000-0000-0000-000000000006'), 1, 'se libera la de O6');
-- No disponible
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000c2', 1, 'cart', gen_random_uuid()), '{"status":"variant_unavailable","reserved":0,"available":0}'::jsonb, 'variante archivada → variant_unavailable');
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000d1', 1, 'cart', gen_random_uuid()), '{"status":"variant_unavailable","reserved":0,"available":0}'::jsonb, 'producto en borrador → variant_unavailable');
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000e1', 1, 'cart', gen_random_uuid()), '{"status":"variant_unavailable","reserved":0,"available":0}'::jsonb, 'producto archivado → variant_unavailable');
select is(public.reserve_stock(gen_random_uuid(), 1, 'cart', gen_random_uuid()), '{"status":"variant_unavailable","reserved":0,"available":0}'::jsonb, 'variante inexistente → variant_unavailable (no es un error)');
-- Archivar libera
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 1, 'order', '0b000000-0000-0000-0000-00000000000b') ->> 'status', 'reserved', 'un PEDIDO compromete 1 unidad firme de R');
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 1, 'cart', '08000000-0000-0000-0000-000000000008') ->> 'status', 'reserved', 'O8 reserva');
update public.product_variants set archived_at = now() where id = 'f3000000-0000-0000-0000-0000000000c1';
select is((select status from public.stock_reservations where owner_id = '08000000-0000-0000-0000-000000000008'), 'released', 'archivar la variante libera las retenciones de CARRITO');
select is((select status from public.stock_reservations where owner_id = '0b000000-0000-0000-0000-00000000000b'), 'active', 'archivar la variante NO libera el compromiso firme de un PEDIDO (si no, ese stock se vendería dos veces)');
update public.product_variants set archived_at = null where id = 'f3000000-0000-0000-0000-0000000000c1';
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 1, 'cart', '08000000-0000-0000-0000-00000000000a') ->> 'status', 'reserved', 'otra reserva');
update public.products set status = 'draft' where code = 'R-1';
select is((select status from public.stock_reservations where owner_id = '08000000-0000-0000-0000-00000000000a'), 'released', 'despublicar el producto (borrador) libera las reservas');
update public.products set status = 'active' where code = 'R-1';
select is(public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 1, 'cart', '08000000-0000-0000-0000-00000000000b') ->> 'status', 'reserved', 'otra reserva más');
update public.products set archived_at = now() where code = 'R-1';
select is((select status from public.stock_reservations where owner_id = '08000000-0000-0000-0000-00000000000b'), 'released', 'archivar el producto libera las retenciones de carrito');
select is((select status from public.stock_reservations where owner_id = '0b000000-0000-0000-0000-00000000000b'), 'active', 'ni despublicar ni archivar el producto liberan el compromiso firme del pedido');
update public.products set archived_at = null where code = 'R-1';
select is(public.release_stock('order', '0b000000-0000-0000-0000-00000000000b'), 1, 'el compromiso del pedido solo se libera al cancelarlo/expirarlo (release_stock explícito)');
-- Restricciones directas de la tabla
select throws_ok($$insert into public.stock_reservations (variant_id, qty, owner_type, owner_id) values ('f3000000-0000-0000-0000-0000000000c1', 1, 'cart', gen_random_uuid())$$, '23514', null, 'una reserva de carrito SIN vencimiento es imposible');
select throws_ok($$insert into public.stock_reservations (variant_id, qty, owner_type, owner_id, expires_at) values ('f3000000-0000-0000-0000-0000000000c1', 0, 'cart', gen_random_uuid(), now() + interval '1 minute')$$, '23514', null, 'cantidad 0 rechazada');
insert into public.stock_reservations (variant_id, qty, owner_type, owner_id, expires_at) values ('f3000000-0000-0000-0000-0000000000c1', 1, 'cart', '0d000000-0000-0000-0000-00000000000d', now() + interval '1 minute');
select throws_ok($$insert into public.stock_reservations (variant_id, qty, owner_type, owner_id, expires_at) values ('f3000000-0000-0000-0000-0000000000c1', 1, 'cart', '0d000000-0000-0000-0000-00000000000d', now() + interval '1 minute')$$, '23505', null, 'dos reservas ACTIVAS del mismo dueño y variante son imposibles');
select is(public.release_stock('cart', '0d000000-0000-0000-0000-00000000000d'), 1, 'limpieza');
-- Permisos por rol
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select throws_ok($$select public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 1, 'cart', gen_random_uuid())$$, '42501', null, 'ni el admin llama reserve_stock desde el navegador');
select throws_ok($$select public.release_stock('cart', gen_random_uuid())$$, '42501', null, 'release_stock no es ejecutable desde el navegador');
select throws_ok($$select public.apply_stock_change('f3000000-0000-0000-0000-0000000000c1', 1, 'import')$$, '42501', null, 'apply_stock_change no es ejecutable desde el navegador');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 1, 'cart', gen_random_uuid())$$, '42501', null, 'anon NO reserva stock directamente');
reset role;
set local role service_role;
select lives_ok($$select public.reserve_stock('f3000000-0000-0000-0000-0000000000c1', 1, 'cart', '0e000000-0000-0000-0000-00000000000e')$$, 'service_role SÍ puede reservar (lo hará la Edge Function del carrito)');
select lives_ok($$select public.release_stock('cart', '0e000000-0000-0000-0000-00000000000e')$$, 'service_role SÍ puede liberar');
reset role;
-- Limpieza de reservas cerradas: solo las de más de 7 días
update public.stock_reservations set updated_at = now() - interval '8 days' where owner_id = '01000000-0000-0000-0000-000000000001';
select is(public.purge_stock_reservations(), 1, 'purge borra SOLO la reserva cerrada de hace 8 días');
select is((select count(*)::int from public.stock_reservations where owner_id = '01000000-0000-0000-0000-000000000001'), 0, '…y desapareció');
select is((select count(*)::int from public.stock_reservations where status <> 'active'), (select count(*)::int from public.stock_reservations where status <> 'active' and updated_at >= now() - interval '7 days'), '…las recientes no se tocaron');

-- ── Semáforo ───────────────────────────────────────────────────────────────────────────────
select is(public.stock_status(0, 5, 2), 'out', 'semáforo: 0 = out');
select is(public.stock_status(-1, 5, 2), 'out', 'semáforo: negativo = out');
select is(public.stock_status(1, 5, 2), 'critical', 'semáforo: 1 (<= 2) = critical');
select is(public.stock_status(2, 5, 2), 'critical', 'semáforo: 2 (= umbral crítico, inclusivo) = critical');
select is(public.stock_status(3, 5, 2), 'low', 'semáforo: 3 = low');
select is(public.stock_status(5, 5, 2), 'low', 'semáforo: 5 (= umbral de aviso, inclusivo) = low');
select is(public.stock_status(6, 5, 2), 'ok', 'semáforo: 6 = ok');
select is((select stock_light from public.variant_availability where variant_id = 'f3000000-0000-0000-0000-0000000000b1'), 'ok', 'vA1 (10) con umbrales globales 5/2 = ok');
select is((select stock_light from public.variant_availability where variant_id = 'f3000000-0000-0000-0000-0000000000b3'), 'low', 'vA3 (3) = low');
select is((select stock_light from public.variant_availability where variant_id = 'f3000000-0000-0000-0000-0000000000b2'), 'out', 'vA2 (0) = out');
update public.product_variants set low_threshold = 10, critical_threshold = 4 where id = 'f3000000-0000-0000-0000-0000000000b1';
select is((select stock_light from public.variant_availability where variant_id = 'f3000000-0000-0000-0000-0000000000b1'), 'low', 'override por variante: 10 con aviso 10 = low');
update public.product_variants set low_threshold = null, critical_threshold = null where id = 'f3000000-0000-0000-0000-0000000000b1';
update public.product_variants set low_threshold = 1 where id = 'f3000000-0000-0000-0000-0000000000b3';
select is((select stock_light from public.variant_availability where variant_id = 'f3000000-0000-0000-0000-0000000000b3'), 'ok', 'override solo del aviso (1): el crítico efectivo baja a 1; stock 3 = ok');
select is((select critical_threshold from public.variant_availability where variant_id = 'f3000000-0000-0000-0000-0000000000b3'), 1, '…el crítico efectivo nunca supera al aviso (min(2, 1) = 1)');
select public.apply_stock_change('f3000000-0000-0000-0000-0000000000b3', -2, 'sale');
select is((select stock_light from public.variant_availability where variant_id = 'f3000000-0000-0000-0000-0000000000b3'), 'critical', 'con stock 1 y aviso 1 = critical');
select public.apply_stock_change('f3000000-0000-0000-0000-0000000000b3', 2, 'cancel');
update public.product_variants set low_threshold = null where id = 'f3000000-0000-0000-0000-0000000000b3';
-- Semáforo físico vs. de compra: 9 de 10 retenidas
select public.reserve_stock('f3000000-0000-0000-0000-0000000000b1', 9, 'cart', '0f000000-0000-0000-0000-00000000000f');
select is((select stock_light from public.variant_availability where variant_id = 'f3000000-0000-0000-0000-0000000000b1'), 'ok', 'inventario FÍSICO (10) sigue en ok…');
select is((select availability_light from public.variant_availability where variant_id = 'f3000000-0000-0000-0000-0000000000b1'), 'critical', '…pero lo COMPRABLE (1) ya es critical');
select public.release_stock('cart', '0f000000-0000-0000-0000-00000000000f');

-- ── Vistas: nadie lee la interna; el admin ve las suyas ────────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select * from public.variant_availability$$, '42501', null, 'anon NO lee variant_availability');
select throws_ok($$select * from public.admin_stock_overview$$, '42501', null, 'anon NO lee admin_stock_overview');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select throws_ok($$select * from public.variant_availability$$, '42501', null, 'cliente NO lee variant_availability');
select is((select count(*)::int from public.admin_stock_overview), 0, 'cliente ve 0 filas en admin_stock_overview');
select is((select count(*)::int from public.admin_product_stock), 0, 'cliente ve 0 filas en admin_product_stock');
select is((select count(*)::int from public.stock_movements), 0, 'el cliente ve 0 filas del libro mayor (RLS)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.admin_stock_overview where product_code = 'A-1'), 4, 'admin ve las 4 variantes de A (una archivada)');
select is((select count(*)::int from public.admin_stock_overview where product_code = 'A-1' and variant_archived_at is null), 3, '…3 activas');
select is((select total_on_hand from public.admin_product_stock where code = 'A-1'), 13, 'A: total en mano = 10 + 0 + 3 = 13 (la archivada con 7 no cuenta)');
select is((select variants_count from public.admin_product_stock where code = 'A-1'), 3, 'A: 3 variantes activas');
select is((select variants_out from public.admin_product_stock where code = 'A-1'), 1, 'A: 1 variante agotada');
select is((select worst_light from public.admin_product_stock where code = 'A-1'), 'out', 'A: el peor semáforo es out');
select is((select count(*)::int from public.stock_movements where variant_id = 'f3000000-0000-0000-0000-0000000000b1'), 1, 'el admin SÍ lee el libro mayor (1 movimiento de vA1)');
reset role;

-- ── Índices ────────────────────────────────────────────────────────────────────────────────
select is((select count(*)::int from pg_indexes where schemaname = 'public' and indexname = 'stock_reservations_owner_idx'), 1,
          'existe el índice por dueño de la reserva (release_stock y "mis reservas" del carrito)');

-- ── Trabajos programados ───────────────────────────────────────────────────────────────────
select is((select count(*)::int from cron.job where jobname = 'expire-stock-reservations' and schedule = '* * * * *'
             and command = 'select public.expire_reservations()'), 1, 'pg_cron: expire_reservations() está programada cada minuto');
select is((select count(*)::int from cron.job where jobname = 'purge-stock-reservations' and command = 'select public.purge_stock_reservations()'), 1,
          'pg_cron: la limpieza diaria de reservas cerradas está programada');

-- ── Invariante global del libro mayor ──────────────────────────────────────────────────────
select is((select count(*)::int from public.product_variants v
            where v.stock_on_hand <> coalesce((select sum(m.delta) from public.stock_movements m where m.variant_id = v.id), 0)), 0,
          'INVARIANTE: en TODAS las variantes, suma de movimientos = stock_on_hand');

select * from finish();
rollback;
