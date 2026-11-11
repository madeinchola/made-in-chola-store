-- Sprint 11 · Pagos: cobros con referencia y vencimiento, aviso de pago idempotente (S-06), comprobantes, revisión del admin,
-- reintentos, vencimiento y recordatorios, vista de la clienta, Storage de comprobantes y permisos.
-- Los valores esperados se calcularon A MANO (la cuenta va en el comentario de cada bloque).
-- Todo ocurre en una transacción que se revierte: no deja pedidos, cobros ni archivos.
--
-- Fixture:  clientas u01..u40 (a1…00NN; el correo es uNN.s11@test.com) · admin ad1…0d
--           pedido n = c1…00NN, número MIC-9100NN (el cobro tendrá esa misma referencia), método «qr_manual» (24 h), total a mano
begin;
select plan(311);

-- ── Ayudas (viven y mueren con la transacción) ────────────────────────────────────────────────
create function pg_temp.u(n int) returns uuid language sql as $$ select ('a1000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.o(n int) returns uuid language sql as $$ select ('c1000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.ref(n int) returns text language sql as $$ select 'MIC-9100' || lpad(n::text, 2, '0') $$;
-- el cobro más reciente del pedido n
create function pg_temp.pid(n int) returns uuid language sql as
  $$ select id from public.payments where order_id = pg_temp.o(n) order by attempt desc limit 1 $$;
create function pg_temp.pst(n int) returns text language sql as $$ select status from public.payments where id = pg_temp.pid(n) $$;
create function pg_temp.ost(n int) returns text language sql as $$ select status from public.orders where id = pg_temp.o(n) $$;
-- archivo k: ruta de la clienta n y huella sha256 (distinta por archivo)
create function pg_temp.fid(k int) returns text language sql as $$ select 'f0000000-0000-0000-0000-0000000000' || lpad(k::text, 2, '0') $$;
create function pg_temp.pp(n int, k int, ext text default 'jpg') returns text language sql as
  $$ select pg_temp.u(n)::text || '/' || pg_temp.o(n)::text || '/' || pg_temp.fid(k) || '.' || ext $$;
create function pg_temp.h(k int) returns text language sql as $$ select encode(sha256(convert_to('archivo-' || k, 'utf8')), 'hex') $$;
create function pg_temp.cnt(p_key text) returns int language sql as
  $$ select count(*)::int from public.notification_outbox where dedupe_key = p_key $$;
-- Pedido pendiente de la clienta n con un cobro abierto (la referencia y el vencimiento los pone el trigger de payments).
create function pg_temp.po(p_n int, p_total numeric, p_exp interval default interval '24 hours',
                           p_provider text default 'manual_qr', p_method text default 'qr_manual') returns void language plpgsql as $$
begin
  insert into public.orders select * from jsonb_populate_record(null::public.orders, jsonb_build_object(
    'id', pg_temp.o(p_n), 'number', pg_temp.ref(p_n), 'profile_id', pg_temp.u(p_n), 'status', 'pending_payment',
    'currency', 'BOB', 'base_currency', 'BOB', 'exchange_rate', 1, 'country', 'BO', 'subtotal', p_total, 'discount_total', 0,
    'shipping_cost', 0, 'shipping_discount', 0, 'total', p_total, 'tax_included', true, 'contact_name', 'X',
    'contact_phone', '+59171234567', 'shipping_method', '{}'::jsonb, 'payment_method', p_method, 'payment_provider', p_provider,
    'payment_expires_at', case when p_exp is null then null else now() + p_exp end, 'discounts', '[]'::jsonb,
    'idempotency_key', 'key-s11-' || p_n, 'created_at', now(), 'updated_at', now()));
  insert into public.payments (order_id, provider, method, status, amount, currency)
  values (pg_temp.o(p_n), p_provider, p_method, 'pending', p_total, 'BOB');
end $$;
-- Aviso de pago DEL PROVEEDOR del cobro del pedido n (un aviso solo toca cobros de su proveedor; sin cobro, «qr_api»).
create function pg_temp.ev(p_n int, p_event text, p_type text, p_amount numeric, p_currency text default 'BOB') returns jsonb
language sql as $$ select public.payment_apply_event(
  coalesce((select p.provider from public.payments p where p.reference = pg_temp.ref(p_n)), 'qr_api'),
  p_event, p_type, pg_temp.ref(p_n), p_amount, p_currency, 'ext-' || p_event) $$;
-- Registra un comprobante de la clienta n (archivo k).
create function pg_temp.reg(p_n int, p_k int, p_ext text default 'jpg') returns jsonb language sql as
  $$ select public.payment_proof_register(pg_temp.u(p_n), pg_temp.pid(p_n), pg_temp.pp(p_n, p_k, p_ext), pg_temp.h(p_k),
       case p_ext when 'pdf' then 'application/pdf' else 'image/jpeg' end, 1000 + p_k) $$;
create temp table t_r (k text primary key, v jsonb);
create function pg_temp.rec(p_k text, p_v jsonb) returns void language sql as
  $$ insert into t_r values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.q(p_k text, p_path text) returns text language sql as
  $$ select v #>> string_to_array(p_path, '.') from t_r where k = p_k $$;
-- El administrador revisa un comprobante (con su sesión real, como lo hace el panel).
create function pg_temp.review(p_proof uuid, p_decision text, p_reason text default null, p_amount numeric default null) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"ad100000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
  set local role authenticated;
  v := public.admin_review_proof(p_proof, p_decision, p_reason, p_amount);
  reset role;
  return v;
end $$;

-- Ejecuta como la clienta p_user (con su sesión real) y devuelve lo que ve de su pedido. Los argumentos se calculan ANTES de
-- cambiar de rol (el esquema temporal no es accesible para `authenticated`).
create function pg_temp.view_as(p_user int, p_order int) returns jsonb language plpgsql as $$
declare
  v jsonb;
  v_claims text := format('{"sub":"%s","role":"authenticated"}', pg_temp.u(p_user));
  v_oid uuid := pg_temp.o(p_order);
begin
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;
  v := public.customer_payment_view(v_oid);
  reset role;
  return v;
end $$;

-- ── Datos ───────────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data, aud, role)
select pg_temp.u(n), 'u' || lpad(n::text, 2, '0') || '.s11@test.com', jsonb_build_object('full_name', 'Clienta ' || n), 'authenticated', 'authenticated'
  from generate_series(1, 40) n;
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('ad100000-0000-0000-0000-00000000000d', 'admin.s11@test.com', '{"full_name":"Admin S11"}', 'authenticated', 'authenticated');
select public.set_user_role('ad100000-0000-0000-0000-00000000000d', 'admin');

-- El QR de ejemplo, con su imagen y sus datos (un método QR activo los exige).
update public.payment_methods
   set qr_image_path = 'qr/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.png', account_details = 'Banco Ejemplo · cuenta 123-456 · Chola SRL',
       is_active = true
 where country = 'BO' and code = 'qr_manual';
update public.store_settings set value = '5' where key = 'payment_proofs_max';
update public.store_settings set value = '6' where key = 'payment_reminder_hours';

-- ═══ A. Estructura y restricciones ══════════════════════════════════════════════════════════
select is((select count(*)::int from public.payment_methods where country = 'BO' and code in ('qr_manual', 'qr_auto')
            and provider in ('manual_qr', 'qr_api') and window_minutes = 1440), 2, 'A1: los dos métodos QR de ejemplo existen con ventana de 24 h (1440 min)');
select is((select value #>> '{}' from public.store_settings where key = 'payment_proofs_max'), '5', 'A2: ajuste payment_proofs_max');
select throws_ok($$update public.store_settings set value = '0' where key = 'payment_proofs_max'$$, '22023', null, 'A3: 0 comprobantes por cobro está fuera de rango');
select throws_ok($$update public.store_settings set value = '21' where key = 'payment_proofs_max'$$, '22023', null, 'A3: 21 comprobantes por cobro está fuera de rango');
select throws_ok($$update public.store_settings set value = '721' where key = 'payment_reminder_hours'$$, '22023', null, 'A4: 721 horas de recordatorio está fuera de rango');
select lives_ok($$update public.store_settings set value = '0' where key = 'payment_reminder_hours'$$, 'A4: 0 horas = sin recordatorio es válido');
update public.store_settings set value = '6' where key = 'payment_reminder_hours';

-- Un método QR activo necesita su imagen, sus datos y una ventana
select throws_ok($$update public.payment_methods set qr_image_path = null where country = 'BO' and code = 'qr_manual'$$, '23514', null, 'A5: un QR activo sin imagen se rechaza');
select throws_ok($$update public.payment_methods set account_details = null where country = 'BO' and code = 'qr_manual'$$, '23514', null, 'A5: un QR activo sin datos de la cuenta se rechaza');
select throws_ok($$update public.payment_methods set window_minutes = null where country = 'BO' and code = 'qr_manual'$$, '23514', null, 'A5: un QR sin ventana de pago se rechaza');
select throws_ok($$update public.payment_methods set qr_image_path = 'cualquier-cosa.png' where country = 'BO' and code = 'qr_manual'$$, '23514', null, 'A5: la imagen debe tener la ruta del bucket (qr/uuid.ext)');
select throws_ok($$insert into public.payment_methods (country, code, provider, name, is_active, window_minutes) values ('BO', 'stripe_falso', 'stripe', 'Stripe', false, 60)$$, '23514', null, 'A6: un proveedor que no está implementado se rechaza');
select lives_ok($$update public.payment_methods set is_active = false where country = 'BO' and code = 'qr_auto'$$, 'A7: un QR apagado puede no tener imagen todavía');
select is(public.storage_path_ok('payment-qr', 'qr/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.png'), true, 'A8: ruta válida del QR');
select is(public.storage_path_ok('payment-qr', 'qr/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.svg'), false, 'A8: un QR en svg se rechaza');
select is(public.storage_path_ok('payment-qr', 'home/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.png'), false, 'A8: ruta de otro bucket rechazada');
select is(public.storage_path_ok('product-images', 'products/b2000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.jpg'), true, 'A8: las demás rutas de S2 siguen igual');

-- Cobros: referencia, vencimiento e intentos
select pg_temp.po(1, 100.00);
select is((select reference from public.payments where order_id = pg_temp.o(1)), 'MIC-910001', 'A9: el primer cobro usa el número del pedido como referencia');
select is((select attempt from public.payments where order_id = pg_temp.o(1)), 1::smallint, 'A9: …es el intento 1');
select is((select p.expires_at = o.payment_expires_at from public.payments p join public.orders o on o.id = p.order_id where o.id = pg_temp.o(1)), true, 'A10: el cobro vence cuando vence el pedido');
select is((select p.expires_at - now() from public.payments p where p.order_id = pg_temp.o(1)), interval '24 hours', 'A10: 24 horas desde ahora (misma transacción)');
select throws_ok($$insert into public.payments (order_id, provider, method, status, amount, currency) values ('c1000000-0000-0000-0000-000000000001', 'manual_qr', 'qr_manual', 'pending', 100, 'BOB')$$, '23505', null, 'A11: dos cobros abiertos para el mismo pedido no caben');
update public.payments set status = 'expired' where id = pg_temp.pid(1);
select lives_ok($$insert into public.payments (order_id, provider, method, status, amount, currency) values ('c1000000-0000-0000-0000-000000000001', 'manual_qr', 'qr_manual', 'pending', 100, 'BOB')$$, 'A12: cerrado el anterior, cabe uno nuevo');
select is((select reference from public.payments where order_id = pg_temp.o(1) and attempt = 2), 'MIC-910001-2', 'A12: el reintento suma «-2» a la referencia');
select throws_ok($$update public.payments set reference = 'abc' where order_id = 'c1000000-0000-0000-0000-000000000001' and attempt = 2$$, '23514', null, 'A13: la referencia tiene un formato fijo');
select throws_ok($$update public.payments set status = 'zzz' where order_id = 'c1000000-0000-0000-0000-000000000001' and attempt = 2$$, '23514', null, 'A14: un estado de cobro desconocido se rechaza');
select lives_ok($$update public.payments set status = 'disputed' where order_id = 'c1000000-0000-0000-0000-000000000001' and attempt = 2$$, 'A14: «disputed» es un estado válido');
update public.payments set status = 'expired' where id = pg_temp.pid(1);

-- ═══ B. Aviso de pago (payment_apply_event) ═════════════════════════════════════════════════
-- B1: exacto. Pedido 2 = 150,00. El aviso llega con 150,00 → el cobro y el pedido quedan pagados, UNA vez.
select pg_temp.po(2, 150.00);
select pg_temp.rec('b1', pg_temp.ev(2, 'evt-b1', 'paid', 150.00));
select is(pg_temp.q('b1', 'outcome'), 'applied', 'B1: el pago exacto se aplica');
select is(pg_temp.ost(2), 'paid', 'B1: el pedido queda pagado');
select is(pg_temp.pst(2), 'paid', 'B1: el cobro queda pagado');
select is((select received_amount from public.payments where id = pg_temp.pid(2)), 150.00, 'B1: se guarda lo recibido');
select is((select paid_at is not null from public.payments where id = pg_temp.pid(2)), true, 'B1: y cuándo');
select is((select external_id from public.payments where id = pg_temp.pid(2)), 'ext-evt-b1', 'B1: y el identificador del proveedor');
select is((select actor_kind from public.order_status_history where order_id = pg_temp.o(2) and to_status = 'paid'), 'system', 'B1: el sistema confirma (no hay un admin delante)');
select is(pg_temp.cnt('order_confirmed:' || pg_temp.o(2)::text || ':c'), 1, 'B1: se avisa a la clienta que su pedido está confirmado');
-- B2: el mismo aviso otra vez no hace nada
select is(pg_temp.ev(2, 'evt-b1', 'paid', 150.00) ->> 'outcome', 'duplicate', 'B2: el mismo aviso otra vez es «duplicate»');
select is((select count(*)::int from public.order_status_history where order_id = pg_temp.o(2) and to_status = 'paid'), 1, 'B2: el pedido pasó a «paid» UNA sola vez');
select is((select attempts from public.webhook_events where provider = 'manual_qr' and event_id = 'evt-b1'), 2, 'B2: el reintento queda contado');
select is((select count(*)::int from public.payment_reviews where payment_id = pg_temp.pid(2)), 0, 'B2: y no abre ninguna revisión');
-- B3: otro aviso DISTINTO para el mismo cobro ya pagado = la clienta pagó dos veces
select is(pg_temp.ev(2, 'evt-b3', 'paid', 150.00) ->> 'outcome', 'review', 'B3: un segundo pago del mismo cobro va a revisión');
select is((select reason from public.payment_reviews where payment_id = pg_temp.pid(2) and status = 'open'), 'duplicate', 'B3: motivo «duplicate»');
select is(pg_temp.ost(2), 'paid', 'B3: el pedido sigue pagado (una vez)');
select is((select external_id from public.payments where id = pg_temp.pid(2)), 'ext-evt-b1', 'B3: el segundo aviso NO pisa los datos del primer pago (su identificador del proveedor queda)');
select is(pg_temp.cnt('payment_review_needed:' || (select id::text from public.payment_reviews where payment_id = pg_temp.pid(2))), 1, 'B3: se alerta al administrador');
-- B4: monto distinto. Pedido 3 = 150,00: llegan 140,00 (menos) y luego 160,00 (más): sigue pendiente y se alerta; luego llega el exacto.
select pg_temp.po(3, 150.00);
select is(pg_temp.ev(3, 'evt-b4a', 'paid', 140.00) ->> 'outcome', 'review', 'B4: 140,00 de 150,00 va a revisión');
select is(pg_temp.ost(3), 'pending_payment', 'B4: el pedido sigue pendiente de pago');
select is((select received_amount from public.payments where id = pg_temp.pid(3)), 140.00, 'B4: se guarda lo que llegó');
select is((select reason from public.payment_reviews where payment_id = pg_temp.pid(3) and status = 'open'), 'amount_mismatch', 'B4: motivo «amount_mismatch»');
select is((select detail ->> 'expected' from public.payment_reviews where payment_id = pg_temp.pid(3) and status = 'open')::numeric, 150.00, 'B4: el detalle dice cuánto se esperaba');
select is(pg_temp.ev(3, 'evt-b4b', 'paid', 160.00) ->> 'outcome', 'review', 'B4: 160,00 de 150,00 (de más) también va a revisión');
select is((select count(*)::int from public.payment_reviews where payment_id = pg_temp.pid(3) and status = 'open'), 1, 'B4: la misma revisión abierta se actualiza, no se duplica');
select is(pg_temp.ost(3), 'pending_payment', 'B4: sigue pendiente');
select is(pg_temp.ev(3, 'evt-b4c', 'paid', 150.00) ->> 'outcome', 'applied', 'B4: llega el monto exacto: se aplica');
select is(pg_temp.ost(3), 'paid', 'B4: el pedido queda pagado');
select is((select status from public.payment_reviews where payment_id = pg_temp.pid(3) and reason = 'amount_mismatch'), 'resolved', 'B4: la revisión del monto distinto se cierra sola al llegar el exacto');
select is((select resolved_by from public.payment_reviews where payment_id = pg_temp.pid(3) and reason = 'amount_mismatch'), null::uuid, 'B4: y la cerró el sistema (no hay un administrador detrás)');
-- B5: ruido de decimales (la moneda tiene 2): 80,004 de 80,00 se redondea a 80,00; 80,006 no
select pg_temp.po(4, 80.00);
select is(pg_temp.ev(4, 'evt-b5a', 'paid', 80.006) ->> 'outcome', 'review', 'B5: 80,006 se redondea a 80,01 y NO coincide con 80,00');
select is(pg_temp.ev(4, 'evt-b5b', 'paid', 80.004) ->> 'outcome', 'applied', 'B5: 80,004 se redondea a 80,00 y SÍ coincide');
-- B6: moneda distinta con el monto exacto
select pg_temp.po(5, 60.00);
select is(pg_temp.ev(5, 'evt-b6', 'paid', 60.00, 'USD') ->> 'outcome', 'review', 'B6: 60,00 en USD de un cobro en BOB va a revisión');
select is(pg_temp.ost(5), 'pending_payment', 'B6: el pedido sigue pendiente');
-- B7: tardío. Pedido 6 = 90,00 cancelado por la clienta; el dinero llega después.
select pg_temp.po(6, 90.00);
select public.transition_order_status(pg_temp.o(6), 'cancelled', pg_temp.u(6), 'customer', 'ya no lo quiero');
select is(pg_temp.pst(6), 'cancelled', 'B7: al cancelar, el cobro abierto se cancela');
select is(pg_temp.ev(6, 'evt-b7', 'paid', 90.00) ->> 'outcome', 'review', 'B7: un pago que llega con el pedido cancelado va a revisión');
select is(pg_temp.pst(6), 'paid', 'B7: el dinero llegó: el cobro queda «paid» (no se pierde)');
select is(pg_temp.ost(6), 'cancelled', 'B7: el pedido sigue cancelado');
select is((select reason from public.payment_reviews where payment_id = pg_temp.pid(6)), 'late', 'B7: motivo «late»');
-- B8: referencia desconocida
select is(pg_temp.ev(99, 'evt-b8', 'paid', 10.00) ->> 'outcome', 'unknown_reference', 'B8: una referencia que no existe se registra y se alerta');
select is((select outcome from public.webhook_events where provider = 'qr_api' and event_id = 'evt-b8'), 'unknown_reference', 'B8: el evento queda en el registro');
select is(pg_temp.cnt('payment_unknown_reference:' || (select id::text from public.webhook_events where provider = 'qr_api' and event_id = 'evt-b8')), 1, 'B8: y se avisa al administrador');
-- B9: fallido. Pedido 7 = 70,00: falla el cobro; el pedido sigue pendiente y se puede reintentar.
select pg_temp.po(7, 70.00);
select is(pg_temp.ev(7, 'evt-b9', 'failed', null) ->> 'outcome', 'applied', 'B9: un cobro fallido se aplica');
select is(pg_temp.pst(7), 'failed', 'B9: el cobro queda «failed»');
select is(pg_temp.ost(7), 'pending_payment', 'B9: el pedido sigue pendiente (stock retenido)');
select is(pg_temp.cnt('payment_failed:' || pg_temp.o(7)::text || ':' || pg_temp.pid(7)::text || ':c'), 1, 'B9: se avisa a la clienta');
select is(pg_temp.ev(7, 'evt-b9b', 'failed', null) ->> 'outcome', 'ignored', 'B9: otro «failed» sobre un cobro ya fallido se ignora');
-- B10: contracargo. Pedido 8 = 55,00 pendiente → disputado: se marca, se alerta y no se puede reintentar.
select pg_temp.po(8, 55.00);
select is(pg_temp.ev(8, 'evt-b10', 'disputed', 55.00) ->> 'outcome', 'review', 'B10: un contracargo va a revisión');
select is(pg_temp.pst(8), 'disputed', 'B10: el cobro queda «disputed»');
select is((select reason from public.payment_reviews where payment_id = pg_temp.pid(8)), 'disputed', 'B10: motivo «disputed»');
select is(pg_temp.ev(8, 'evt-b10b', 'paid', 55.00) ->> 'outcome', 'ignored', 'B10: un «paid» sobre un cobro disputado se ignora');
select is(public.payment_retry(pg_temp.u(8), pg_temp.o(8)) ->> 'outcome', 'payment_blocked', 'B10: con un contracargo no se puede reintentar');
-- B11: reembolso del proveedor. Pedido 9 = 45,00 pagado → «refunded»
select pg_temp.po(9, 45.00);
select pg_temp.ev(9, 'evt-b11a', 'paid', 45.00);
select is(pg_temp.ev(9, 'evt-b11b', 'refunded', 45.00) ->> 'outcome', 'review', 'B11: el reembolso del proveedor se registra y se revisa');
select is(pg_temp.pst(9), 'refunded', 'B11: el cobro queda «refunded»');
select is(pg_temp.ost(9), 'paid', 'B11: el estado del pedido lo decide S12, no el aviso');
-- B12: entradas inválidas
select throws_ok($$select public.payment_apply_event('qr_api', 'e', 'cualquier-cosa', 'MIC-910001', 1, 'BOB')$$, '22023', null, 'B12: un tipo de aviso desconocido es una entrada inválida');
select throws_ok($$select public.payment_apply_event('qr_api', 'e', 'paid', null, 1, 'BOB')$$, '22023', null, 'B12: sin referencia');
select throws_ok($$select public.payment_apply_event('qr_api', 'e', 'paid', 'MIC-910001', -1, 'BOB')$$, '22023', null, 'B12: monto negativo');
select throws_ok($$select public.payment_apply_event('QR API', 'e', 'paid', 'MIC-910001', 1, 'BOB')$$, '22023', null, 'B12: proveedor con formato inválido');
select throws_ok($$select public.payment_apply_event('qr_api', '', 'paid', 'MIC-910001', 1, 'BOB')$$, '22023', null, 'B12: evento sin identificador');
select throws_ok($$select public.payment_apply_event('qr_api', 'e', 'paid', 'MIC-910001', 1, 'bob')$$, '22023', null, 'B12: moneda en minúsculas');
-- B13: eventos con firma inválida (los registra la Edge Function): quedan guardados y no cuentan para la idempotencia
select public.payment_log_invalid_event('qr_api', 'firma inválida', '{"motivo":"x"}');
select public.payment_log_invalid_event('qr_api', 'firma inválida', '{"motivo":"x"}');
select is((select count(*)::int from public.webhook_events where provider = 'qr_api' and not signature_valid and received_at = now()), 2, 'B13: dos avisos con firma inválida quedan registrados (no se deduplican)');
select is((select outcome from public.webhook_events where not signature_valid and received_at = now() limit 1), 'rejected', 'B13: con el resultado «rejected»');
select lives_ok($$select public.payment_log_invalid_event('PROVEEDOR MALO', 'x', '{}')$$, 'B13: un proveedor con formato inválido no rompe ni se guarda');
select is((select count(*)::int from public.webhook_events where provider = 'PROVEEDOR MALO'), 0, 'B13: …no se guarda');

-- ═══ C. Comprobantes ════════════════════════════════════════════════════════════════════════
-- Pedido 10 = 200,00 (clienta 10): sube el archivo 1.
select pg_temp.po(10, 200.00);
select pg_temp.rec('c1', pg_temp.reg(10, 1));
select is(pg_temp.q('c1', 'outcome'), 'registered', 'C1: el comprobante se registra');
select is((select status from public.payment_proofs where id = (pg_temp.q('c1', 'proof_id'))::uuid), 'pending', 'C1: queda pendiente de revisión');
select is(pg_temp.cnt('payment_proof_received:' || pg_temp.q('c1', 'proof_id')), 1, 'C1: se avisa al administrador');
select is(pg_temp.reg(10, 1) ->> 'outcome', 'existing', 'C2: la misma ruta otra vez (reintento) devuelve el mismo comprobante');
select is((pg_temp.reg(10, 1) ->> 'proof_id'), pg_temp.q('c1', 'proof_id'), 'C2: …el MISMO');
select is(public.payment_proof_register(pg_temp.u(10), pg_temp.pid(10), pg_temp.pp(10, 2), pg_temp.h(1), 'image/jpeg', 1001) ->> 'outcome', 'existing', 'C3: la misma imagen en otra ruta (doble toque) devuelve el mismo comprobante');
select is(pg_temp.reg(10, 3) ->> 'outcome', 'proof_pending', 'C4: otro archivo mientras uno espera revisión: «proof_pending»');
select is((select count(*)::int from public.payment_proofs where payment_id = pg_temp.pid(10)), 1, 'C4: no se guardó el segundo');
-- IDOR: otra clienta no puede registrar un comprobante en ese cobro
select pg_temp.po(11, 200.00);
select is(public.payment_proof_register(pg_temp.u(11), pg_temp.pid(10), pg_temp.pp(11, 4), pg_temp.h(4), 'image/jpeg', 1004) ->> 'outcome', 'not_found', 'C5: la clienta 11 no puede registrar en el cobro de la 10 (es «no existe»)');
select is(public.payment_proof_register(pg_temp.u(10), pg_temp.pid(10), pg_temp.pp(11, 5), pg_temp.h(5), 'image/jpeg', 1005) ->> 'outcome', 'not_found', 'C5: ni con una ruta que no es de su carpeta de pedido');
select is(public.payment_proof_register(pg_temp.u(10), gen_random_uuid(), pg_temp.pp(10, 6), pg_temp.h(6), 'image/jpeg', 1006) ->> 'outcome', 'not_found', 'C5: ni un cobro que no existe');
-- entradas inválidas
select throws_ok($$select public.payment_proof_register('a1000000-0000-0000-0000-00000000000a'::uuid, null, 'x', 'abc', 'image/jpeg', 10)$$, '22023', null, 'C6: sin cobro y con huella corta');
select throws_ok(format($$select public.payment_proof_register(%L, %L, %L, %L, 'image/svg+xml', 10)$$, pg_temp.u(10), pg_temp.pid(10), pg_temp.pp(10, 7), pg_temp.h(7)), '22023', null, 'C6: un svg no es un comprobante');
select throws_ok(format($$select public.payment_proof_register(%L, %L, %L, %L, 'image/jpeg', 0)$$, pg_temp.u(10), pg_temp.pid(10), pg_temp.pp(10, 8), pg_temp.h(8)), '22023', null, 'C6: un archivo vacío');
select throws_ok(format($$select public.payment_proof_register(%L, %L, %L, %L, 'image/jpeg', 6000000)$$, pg_temp.u(10), pg_temp.pid(10), pg_temp.pp(10, 9), pg_temp.h(9)), '22023', null, 'C6: un archivo de más de 5 MiB');
-- el admin rechaza (con motivo) y la clienta puede subir otro
select throws_ok($$select pg_temp.review((select id from public.payment_proofs where payment_id = pg_temp.pid(10)), 'reject', null)$$, '22023', null, 'C7: rechazar exige un motivo');
select is(pg_temp.review((pg_temp.q('c1', 'proof_id'))::uuid, 'reject', 'No se ve el monto') ->> 'outcome', 'rejected', 'C7: el admin rechaza con motivo');
select is((select reason from public.payment_proofs where id = (pg_temp.q('c1', 'proof_id'))::uuid), 'No se ve el monto', 'C7: el motivo queda guardado');
select is((select reviewed_by from public.payment_proofs where id = (pg_temp.q('c1', 'proof_id'))::uuid), 'ad100000-0000-0000-0000-00000000000d'::uuid, 'C7: y quién lo rechazó');
select is(pg_temp.cnt('payment_proof_rejected:' || pg_temp.o(10)::text || ':' || pg_temp.q('c1', 'proof_id') || ':c'), 1, 'C7: se avisa a la clienta con el motivo');
select is(pg_temp.pst(10), 'pending', 'C7: el cobro sigue abierto (la ventana no se perdió)');
select is(pg_temp.reg(10, 10) ->> 'outcome', 'registered', 'C8: tras el rechazo puede subir otro comprobante');
-- tope de comprobantes por cobro (payment_proofs_max = 2 para esta prueba)
update public.store_settings set value = '2' where key = 'payment_proofs_max';
select pg_temp.review((select id from public.payment_proofs where payment_id = pg_temp.pid(10) and status = 'pending'), 'reject', 'Ilegible');
select is(pg_temp.reg(10, 11) ->> 'outcome', 'too_many_proofs', 'C9: con 2 comprobantes ya subidos no cabe un tercero');
update public.store_settings set value = '5' where key = 'payment_proofs_max';
-- aprobar. Pedido 12 = 200,00: el admin aprueba y el pedido queda pagado UNA vez
select pg_temp.po(12, 200.00);
select pg_temp.rec('c10', pg_temp.reg(12, 12));
select is(pg_temp.review((pg_temp.q('c10', 'proof_id'))::uuid, 'approve') ->> 'outcome', 'approved', 'C10: el admin aprueba');
select is(pg_temp.ost(12), 'paid', 'C10: el pedido queda pagado');
select is(pg_temp.pst(12), 'paid', 'C10: el cobro queda pagado');
select is((select actor_kind from public.order_status_history where order_id = pg_temp.o(12) and to_status = 'paid'), 'admin', 'C10: lo confirmó un administrador');
select is((select actor_id from public.order_status_history where order_id = pg_temp.o(12) and to_status = 'paid'), 'ad100000-0000-0000-0000-00000000000d'::uuid, 'C10: y se sabe CUÁL');
select is((select received_amount from public.payment_proofs where id = (pg_temp.q('c10', 'proof_id'))::uuid), 200.00, 'C10: sin monto escrito se toma el del pedido');
select is(pg_temp.review((pg_temp.q('c10', 'proof_id'))::uuid, 'approve') ->> 'outcome', 'already_reviewed', 'C11: aprobar de nuevo (otro admin a la vez) no hace nada: gana la primera decisión');
select is(pg_temp.review((pg_temp.q('c10', 'proof_id'))::uuid, 'reject', 'tarde') ->> 'outcome', 'already_reviewed', 'C11: ni rechazar después de aprobar');
select is((select count(*)::int from public.order_status_history where order_id = pg_temp.o(12) and to_status = 'paid'), 1, 'C11: «paid» una sola vez');
-- aprobar con otro monto. Pedido 13 = 90,00: el admin ve 80,00
select pg_temp.po(13, 90.00);
select pg_temp.rec('c12', pg_temp.reg(13, 13));
select is(pg_temp.review((pg_temp.q('c12', 'proof_id'))::uuid, 'approve', null, 80.00) #>> '{payment,outcome}', 'review', 'C12: aprobar con 80,00 de 90,00 abre una revisión');
select is(pg_temp.ost(13), 'pending_payment', 'C12: el pedido sigue pendiente');
select is((select reason from public.payment_reviews where payment_id = pg_temp.pid(13)), 'amount_mismatch', 'C12: motivo «amount_mismatch»');
-- el mismo archivo para dos pedidos distintos (comprobante reutilizado)
select pg_temp.po(14, 50.00);
select pg_temp.po(15, 50.00);
select pg_temp.rec('c13a', public.payment_proof_register(pg_temp.u(14), pg_temp.pid(14), pg_temp.pp(14, 14), pg_temp.h(99), 'image/png', 2000));
select pg_temp.rec('c13b', public.payment_proof_register(pg_temp.u(15), pg_temp.pid(15), pg_temp.pp(15, 15), pg_temp.h(99), 'image/png', 2000));
select is((select duplicate_of from public.payment_proofs where id = (pg_temp.q('c13b', 'proof_id'))::uuid), (pg_temp.q('c13a', 'proof_id'))::uuid, 'C13: el mismo archivo en otro pedido queda marcado como reutilizado');
select is((select duplicate_of from public.payment_proofs where id = (pg_temp.q('c13a', 'proof_id'))::uuid), null, 'C13: el primero no');
-- cobro cerrado: vencido, o pedido cancelado
select pg_temp.po(16, 30.00, interval '-1 minute');
select is(pg_temp.reg(16, 16) ->> 'outcome', 'payment_closed', 'C14: con la ventana vencida no se acepta un comprobante');
select pg_temp.po(17, 30.00);
select public.transition_order_status(pg_temp.o(17), 'cancelled', pg_temp.u(17), 'customer', null);
select is(pg_temp.reg(17, 17) ->> 'outcome', 'payment_closed', 'C14: con el pedido cancelado tampoco');
-- cancelar el pedido cierra el comprobante pendiente. Pedido 18.
select pg_temp.po(18, 30.00);
select pg_temp.rec('c15', pg_temp.reg(18, 18));
select public.transition_order_status(pg_temp.o(18), 'cancelled', pg_temp.u(18), 'customer', 'me equivoqué');
select is((select status from public.payment_proofs where id = (pg_temp.q('c15', 'proof_id'))::uuid), 'rejected', 'C15: al cancelar el pedido, el comprobante pendiente se cierra');
select is((select reason from public.payment_proofs where id = (pg_temp.q('c15', 'proof_id'))::uuid), 'El pedido se canceló', 'C15: con su motivo');
-- confirmación manual (sin comprobante ni aviso). Pedido 19 = 75,00
select pg_temp.po(19, 75.00);
create function pg_temp.confirm(p_payment uuid, p_note text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"ad100000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
  set local role authenticated;
  v := public.admin_confirm_payment_manual(p_payment, null, p_note);
  reset role;
  return v;
end $$;
select is(pg_temp.confirm(pg_temp.pid(19), 'visto en el banco') ->> 'outcome', 'applied', 'C16: el admin confirma un pago a mano');
select is(pg_temp.confirm(pg_temp.pid(19), 'otra vez') ->> 'outcome', 'already_paid', 'C16: confirmarlo otra vez dice «ya estaba pagado» y no hace nada');
select is(pg_temp.ost(19), 'paid', 'C16: el pedido queda pagado');

-- ═══ D. Vencimiento y recordatorios ═════════════════════════════════════════════════════════
select pg_temp.po(20, 25.00, interval '-1 minute');
select ok(public.expire_pending_payments() >= 1, 'D1: el vencimiento cancela al menos el pedido vencido');
select is(pg_temp.ost(20), 'cancelled', 'D1: el pedido vencido se cancela');
select is(pg_temp.pst(20), 'expired', 'D1: y su cobro queda «expired» (no «cancelled»)');
select is((select cancel_reason from public.orders where id = pg_temp.o(20)), 'expired', 'D1: con el motivo «expired»');
select is((select actor_kind from public.order_status_history where order_id = pg_temp.o(20) and to_status = 'cancelled'), 'system', 'D1: lo hizo el sistema');
select is(public.expire_pending_payments(), 0, 'D2: una segunda corrida no encuentra nada que vencer');
-- un comprobante pendiente de revisión evita el vencimiento: el pedido 14 tiene uno
update public.orders set payment_expires_at = now() - interval '5 minutes' where id = pg_temp.o(14);
update public.payments set expires_at = now() - interval '5 minutes' where id = pg_temp.pid(14);
select public.expire_unconfirmed_orders();
select is(pg_temp.ost(14), 'pending_payment', 'D3: con un comprobante esperando revisión el pedido NO se cancela solo');
select pg_temp.review((pg_temp.q('c13a', 'proof_id'))::uuid, 'reject', 'No corresponde');
select public.expire_unconfirmed_orders();
select is(pg_temp.ost(14), 'cancelled', 'D3: resuelto el comprobante (rechazado), el vencimiento sí actúa');
-- recordatorios (payment_reminder_hours = 6). Pedido 21 vence en 3 h (se recuerda); pedido 22, en 10 h (todavía no).
select pg_temp.po(21, 40.00, interval '3 hours');
select pg_temp.po(22, 40.00, interval '10 hours');
select ok(public.remind_expiring_payments() >= 1, 'D4: el recordatorio avisa al menos del cobro que vence en 3 h');
select is((select reminder_sent_at is not null from public.payments where id = pg_temp.pid(21)), true, 'D4: el cobro que vence en 3 h queda recordado');
select is((select reminder_sent_at is null from public.payments where id = pg_temp.pid(22)), true, 'D4: el que vence en 10 h todavía no');
select is(pg_temp.cnt('payment_expiring:' || pg_temp.o(21)::text || ':' || pg_temp.pid(21)::text || ':c'), 1, 'D4: se avisa a la clienta una vez');
select is(public.remind_expiring_payments(), 0, 'D5: una segunda corrida no encuentra a nadie más que recordar (no re-procesa el cobro ya recordado)');
select is(pg_temp.cnt('payment_expiring:' || pg_temp.o(21)::text || ':' || pg_temp.pid(21)::text || ':c'), 1, 'D5: una segunda corrida no vuelve a avisar');
update public.store_settings set value = '0' where key = 'payment_reminder_hours';
select is(public.remind_expiring_payments(), 0, 'D6: con 0 horas no hay recordatorios');
update public.store_settings set value = '6' where key = 'payment_reminder_hours';

-- ═══ E. Lo que la clienta ve (customer_payment_view) ════════════════════════════════════════
select pg_temp.rec('e21', pg_temp.view_as(21, 21));
select is(pg_temp.q('e21', 'outcome'), 'ok', 'E1: la dueña ve su pedido');
select is(pg_temp.q('e21', 'order.number'), 'MIC-910021', 'E1: con su número');
select is(pg_temp.q('e21', 'payment.reference'), 'MIC-910021', 'E1: y la referencia con la que debe pagar');
select is((pg_temp.q('e21', 'payment.amount'))::numeric, 40.00, 'E1: el monto exacto');
select is(pg_temp.q('e21', 'method.qr_image_path'), 'qr/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.png', 'E1: el QR de la tienda');
select is(pg_temp.q('e21', 'method.account_details'), 'Banco Ejemplo · cuenta 123-456 · Chola SRL', 'E1: y a quién pagar');
select is(pg_temp.q('e21', 'can_upload'), 'true', 'E1: puede subir un comprobante');
select is(pg_temp.q('e21', 'can_retry'), 'false', 'E1: no necesita reintentar (el cobro está abierto)');
select ok(abs(extract(epoch from ((pg_temp.q('e21', 'server_now'))::timestamptz - now()))) < 5, 'E2: trae la hora del SERVIDOR para la cuenta regresiva');
select is((pg_temp.view_as(22, 21)) ->> 'outcome', 'not_found', 'E3: otra clienta recibe «no existe»');
select is((select (pg_temp.view_as(21, 99)) ->> 'outcome'), 'not_found', 'E3: un pedido que no existe, lo mismo');
-- lo que NO se filtra: claves exactas de cada objeto
select pg_temp.rec('e10', pg_temp.view_as(10, 10));
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((select v -> 'proof' from t_r where k = 'e10')) k),
          'created_at,mime,reason,reviewed_at,status', 'E4: del comprobante solo estado, motivo, fechas y tipo (ni huella, ni ruta, ni quién lo revisó)');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((select v -> 'payment' from t_r where k = 'e21')) k),
          'amount,currency,expires_at,id,method,paid_at,provider,reference,status,under_review', 'E4: del cobro, sin datos internos');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((select v -> 'method' from t_r where k = 'e21')) k),
          'account_details,code,description,name,qr_image_path', 'E4: del método, solo lo que la clienta necesita para pagar');
select is(pg_temp.q('e10', 'proof.status'), 'rejected', 'E5: ve que su último comprobante fue rechazado');
select is(pg_temp.q('e10', 'proof.reason'), 'Ilegible', 'E5: y el motivo');
select is(pg_temp.q('e10', 'can_upload'), 'true', 'E5: y puede subir otro');
select is(pg_temp.q('e10', 'payment.under_review'), 'false', 'E5: el cobro no está en revisión');
select is(pg_temp.view_as(2, 2) #>> '{payment,under_review}', 'true', 'E6: un cobro con una revisión abierta se muestra «en revisión»');
-- comprobante pendiente: no se puede subir otro
select pg_temp.rec('e18', pg_temp.view_as(14, 14));
select is(pg_temp.q('e18', 'order.status'), 'cancelled', 'E7: el pedido 14 se canceló (D3)');
select pg_temp.po(23, 10.00, null, 'whatsapp', 'whatsapp');
select is(pg_temp.view_as(23, 23) -> 'method', 'null'::jsonb, 'E8: un pedido de WhatsApp no trae datos de QR');
select is(pg_temp.view_as(23, 23) ->> 'can_upload', 'false', 'E8: ni se puede subir comprobante');
select is(pg_temp.view_as(7, 7) ->> 'can_retry', 'true', 'E9: tras un cobro fallido, el pedido sigue pendiente y puede reintentar');

-- ═══ F. Reintentar el pago (payment_retry) ══════════════════════════════════════════════════
select is(public.payment_retry(pg_temp.u(8), pg_temp.o(7)) ->> 'outcome', 'not_found', 'F1: otra clienta no puede reintentar un pedido ajeno');
select is(public.payment_retry(pg_temp.u(6), pg_temp.o(6)) ->> 'outcome', 'order_closed', 'F2: un pedido cancelado no se revive (se vuelve a pedir)');
select is(public.payment_retry(pg_temp.u(23), pg_temp.o(23)) ->> 'outcome', 'not_retryable', 'F3: WhatsApp no tiene cobro que reintentar');
select pg_temp.rec('f4', public.payment_retry(pg_temp.u(7), pg_temp.o(7)));
select is(pg_temp.q('f4', 'outcome'), 'retried', 'F4: un cobro fallido se reintenta');
select is((select reference from public.payments where order_id = pg_temp.o(7) and attempt = 2), 'MIC-910007-2', 'F4: con su referencia nueva');
select is(pg_temp.pst(7), 'pending', 'F4: el cobro nuevo está abierto');
select is((select payment_expires_at - now() from public.orders where id = pg_temp.o(7)), interval '24 hours', 'F4: el pedido recibe una ventana nueva de 24 h');
select is((select expires_at - now() from public.payments where id = pg_temp.pid(7)), interval '24 hours', 'F4: y el cobro también');
select is((select status from public.payments where order_id = pg_temp.o(7) and attempt = 1), 'failed', 'F4: el intento fallido queda como historia');
select is(public.payment_retry(pg_temp.u(7), pg_temp.o(7)) ->> 'outcome', 'payment_open', 'F5: con un cobro abierto no se abre otro');
-- tope de 5 intentos por pedido
update public.payments set status = 'failed' where id = pg_temp.pid(7);
select is(public.payment_retry(pg_temp.u(7), pg_temp.o(7)) ->> 'outcome', 'retried', 'F6: intento 3');
update public.payments set status = 'failed' where id = pg_temp.pid(7);
select is(public.payment_retry(pg_temp.u(7), pg_temp.o(7)) ->> 'outcome', 'retried', 'F6: intento 4');
update public.payments set status = 'failed' where id = pg_temp.pid(7);
select is(public.payment_retry(pg_temp.u(7), pg_temp.o(7)) ->> 'outcome', 'retried', 'F6: intento 5');
update public.payments set status = 'failed' where id = pg_temp.pid(7);
select is(public.payment_retry(pg_temp.u(7), pg_temp.o(7)) ->> 'outcome', 'too_many_attempts', 'F6: el sexto no cabe');
select is((select count(*)::int from public.payments where order_id = pg_temp.o(7)), 5, 'F6: 5 intentos en total');

-- ═══ G. Quién ve y quién ejecuta qué ════════════════════════════════════════════════════════
select is((select count(*)::int from public.payments where order_id in (pg_temp.o(10), pg_temp.o(11))), 2, 'G0: (como dueño de la base) hay cobros de las clientas 10 y 11');
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.payments where order_id in ('c1000000-0000-0000-0000-000000000010', 'c1000000-0000-0000-0000-000000000011')), 1, 'G1: la clienta 10 ve SU cobro y no el de la 11');
select is((select count(*)::int from public.payment_proofs), 0, 'G2: la clienta NO lee comprobantes (ni los suyos: se entera por customer_payment_view)');
select is((select count(*)::int from public.payment_reviews), 0, 'G2: ni revisiones');
select is((select count(*)::int from public.webhook_events), 0, 'G2: ni los avisos de pago recibidos');
select throws_ok($$insert into public.payments (order_id, provider, method, status, amount, currency) values ('c1000000-0000-0000-0000-000000000010', 'manual_qr', 'qr_manual', 'paid', 1, 'BOB')$$, '42501', null, 'G3: la clienta no crea cobros');
select throws_ok($$update public.payments set status = 'paid' where order_id = 'c1000000-0000-0000-0000-000000000010'$$, '42501', null, 'G3: ni marca un cobro como pagado');
select throws_ok($$insert into public.payment_proofs (payment_id, order_id, profile_id, file_path, file_hash, mime, size_bytes) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'x', 'x', 'image/jpeg', 1)$$, '42501', null, 'G3: ni inserta comprobantes a mano (pasan por la Edge Function)');
update public.payment_methods set is_active = false;   -- la RLS no le deja ninguna fila: no falla, no cambia nada
select throws_ok($$select public.admin_review_proof(gen_random_uuid(), 'approve')$$, '42501', null, 'G4: una clienta no aprueba comprobantes');
select throws_ok($$select public.admin_confirm_payment_manual(gen_random_uuid())$$, '42501', null, 'G4: ni confirma pagos a mano');
select throws_ok($$select public.admin_resolve_review(gen_random_uuid(), 'x')$$, '42501', null, 'G4: ni resuelve revisiones');
select throws_ok($$select public.payment_apply_event('qr_api', 'x', 'paid', 'MIC-910001', 1, 'BOB')$$, '42501', null, 'G5: ni envía avisos de pago (es del servidor)');
select throws_ok($$select public.payment_retry('a1000000-0000-0000-0000-000000000010', 'c1000000-0000-0000-0000-000000000010')$$, '42501', null, 'G5: ni reintenta por su cuenta (pasa por la Edge Function)');
reset role;
select is((select is_active from public.payment_methods where country = 'BO' and code = 'qr_manual'), true, 'G3: ni cambia los métodos de pago (la RLS no le deja ninguna fila)');
select set_config('request.jwt.claims', '{"sub":"ad100000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
set local role authenticated;
select ok((select count(*) from public.payment_proofs) >= 5, 'G6: el administrador lee los comprobantes');
select ok((select count(*) from public.payment_reviews) >= 5, 'G6: las revisiones');
select ok((select count(*) from public.webhook_events) >= 10, 'G6: y los avisos recibidos');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.payments$$, '42501', null, 'G7: sin sesión no se ve ningún cobro');
select throws_ok($$select count(*) from public.payment_proofs$$, '42501', null, 'G7: ni comprobantes');
select throws_ok($$select public.customer_payment_view(gen_random_uuid())$$, '42501', null, 'G7: ni la vista de pago');
reset role;
-- La matriz de EXECUTE: el servidor, el navegador y nadie
select is((select string_agg(f, ',' order by f) from unnest(array[
    'payment_apply_event(text,text,text,text,numeric,text,text,jsonb,uuid)', 'payment_log_invalid_event(text,text,jsonb)',
    'payment_proof_register(uuid,uuid,text,text,text,integer)', 'payment_retry(uuid,uuid)',
    'transition_order_status(uuid,text,uuid,text,text)']) f
   where has_function_privilege('service_role', 'public.' || f, 'execute')), 'payment_apply_event(text,text,text,text,numeric,text,text,jsonb,uuid),payment_log_invalid_event(text,text,jsonb),payment_proof_register(uuid,uuid,text,text,text,integer),payment_retry(uuid,uuid),transition_order_status(uuid,text,uuid,text,text)',
  'G8: el servidor ejecuta los cinco caminos de pago');
select is((select count(*)::int from unnest(array[
    'payment_apply_event(text,text,text,text,numeric,text,text,jsonb,uuid)', 'payment_log_invalid_event(text,text,jsonb)',
    'payment_proof_register(uuid,uuid,text,text,text,integer)', 'payment_retry(uuid,uuid)',
    'admin_review_proof(uuid,text,text,numeric)', 'admin_confirm_payment_manual(uuid,numeric,text)', 'admin_resolve_review(uuid,text)',
    'customer_payment_view(uuid)', 'expire_pending_payments()', 'remind_expiring_payments()', 'expire_unconfirmed_orders()',
    '_payment_alert(text,jsonb,text)', '_payment_open_review(uuid,text,jsonb)', 'payments_before_insert()', 'payment_proof_path_ok(text)',
    '_order_notify(uuid,text,text,text,jsonb)']) f where has_function_privilege('anon', 'public.' || f, 'execute')), 0,
  'G9: anon no ejecuta nada de pagos');
select is((select string_agg(f, ',' order by f) from unnest(array[
    'payment_apply_event(text,text,text,text,numeric,text,text,jsonb,uuid)', 'payment_log_invalid_event(text,text,jsonb)',
    'payment_proof_register(uuid,uuid,text,text,text,integer)', 'payment_retry(uuid,uuid)',
    'admin_review_proof(uuid,text,text,numeric)', 'admin_confirm_payment_manual(uuid,numeric,text)', 'admin_resolve_review(uuid,text)',
    'customer_payment_view(uuid)', 'expire_pending_payments()', 'remind_expiring_payments()', 'expire_unconfirmed_orders()',
    '_payment_alert(text,jsonb,text)', '_payment_open_review(uuid,text,jsonb)', 'payments_before_insert()', 'payment_proof_path_ok(text)',
    '_order_notify(uuid,text,text,text,jsonb)']) f where has_function_privilege('authenticated', 'public.' || f, 'execute')),
  'admin_confirm_payment_manual(uuid,numeric,text),admin_resolve_review(uuid,text),admin_review_proof(uuid,text,text,numeric),customer_payment_view(uuid),payment_proof_path_ok(text)',
  'G10: el navegador solo ejecuta lo que se autoriza por dentro (admin o dueña)');
select is((select count(*)::int from unnest(array[
    'admin_review_proof(uuid,text,text,numeric)', 'admin_confirm_payment_manual(uuid,numeric,text)', 'admin_resolve_review(uuid,text)',
    'customer_payment_view(uuid)', 'expire_pending_payments()', 'remind_expiring_payments()', 'expire_unconfirmed_orders()',
    '_payment_alert(text,jsonb,text)', '_payment_open_review(uuid,text,jsonb)', 'payments_before_insert()', 'payment_proof_path_ok(text)',
    '_order_notify(uuid,text,text,text,jsonb)']) f where has_function_privilege('service_role', 'public.' || f, 'execute')), 0,
  'G11: el servidor no ejecuta las del administrador, las internas ni las de pg_cron');
-- Resolver una revisión: nota obligatoria, una sola vez
create function pg_temp.resolve(p_review uuid, p_note text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"ad100000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
  set local role authenticated;
  v := public.admin_resolve_review(p_review, p_note);
  reset role;
  return v;
end $$;
select throws_ok($$select pg_temp.resolve((select id from public.payment_reviews where payment_id = pg_temp.pid(2) and status = 'open'), '  ')$$, '22023', null, 'G12: resolver una revisión exige una nota');
select is(pg_temp.resolve((select id from public.payment_reviews where payment_id = pg_temp.pid(2) and status = 'open'), 'Se devolvió el excedente') ->> 'outcome', 'resolved', 'G12: el admin resuelve una revisión con su nota');
select is((select status from public.payment_reviews where payment_id = pg_temp.pid(2) and reason = 'duplicate'), 'resolved', 'G12: queda resuelta');
select is((select resolved_by from public.payment_reviews where payment_id = pg_temp.pid(2) and reason = 'duplicate'), 'ad100000-0000-0000-0000-00000000000d'::uuid, 'G12: y quién la resolvió');
select is(pg_temp.resolve((select id from public.payment_reviews where payment_id = pg_temp.pid(2) and reason = 'duplicate'), 'otra vez') ->> 'outcome', 'already_resolved', 'G12: resolverla de nuevo no hace nada');
select is(pg_temp.resolve(gen_random_uuid(), 'x') ->> 'outcome', 'not_found', 'G12: una revisión que no existe');

-- ═══ H. Storage de comprobantes y del QR ════════════════════════════════════════════════════
select is((select public from storage.buckets where id = 'payment-proofs'), false, 'H1: el bucket de comprobantes es PRIVADO');
select is((select file_size_limit from storage.buckets where id = 'payment-proofs'), 5242880::bigint, 'H1: tope de 5 MiB');
select is((select allowed_mime_types from storage.buckets where id = 'payment-proofs'), array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], 'H1: solo jpeg, png, webp y pdf (nada de svg)');
select is((select public from storage.buckets where id = 'payment-qr'), true, 'H1: el bucket del QR de la tienda es público (es la imagen que ve cualquiera que paga)');
update public.store_settings set value = '2' where key = 'payment_proofs_max';   -- tope de archivos por pedido = 2 × 2 = 4
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
set local role authenticated;
select is(public.payment_proof_path_ok('a1000000-0000-0000-0000-000000000010/c1000000-0000-0000-0000-000000000010/f0000000-0000-0000-0000-000000000030.jpg'), true, 'H2: su carpeta, su pedido pendiente y un cobro QR abierto: ruta válida');
select is(public.payment_proof_path_ok('a1000000-0000-0000-0000-000000000011/c1000000-0000-0000-0000-000000000010/f0000000-0000-0000-0000-000000000030.jpg'), false, 'H2: la carpeta de OTRA clienta no');
select is(public.payment_proof_path_ok('a1000000-0000-0000-0000-000000000010/c1000000-0000-0000-0000-000000000011/f0000000-0000-0000-0000-000000000030.jpg'), false, 'H2: un pedido que no es suyo tampoco');
select is(public.payment_proof_path_ok('a1000000-0000-0000-0000-000000000010/c1000000-0000-0000-0000-000000000010/f0000000-0000-0000-0000-000000000030.svg'), false, 'H2: un svg no');
select is(public.payment_proof_path_ok('a1000000-0000-0000-0000-000000000010/c1000000-0000-0000-0000-000000000010/f0000000-0000-0000-0000-000000000030.exe'), false, 'H2: ni un ejecutable');
select is(public.payment_proof_path_ok('a1000000-0000-0000-0000-000000000010/c1000000-0000-0000-0000-000000000010/../f0000000-0000-0000-0000-000000000030.jpg'), false, 'H2: ni recorrer directorios');
select is(public.payment_proof_path_ok('a1000000-0000-0000-0000-000000000010/c1000000-0000-0000-0000-000000000010/f0000000-0000-0000-0000-000000000030.JPG'), false, 'H2: ni extensión en mayúsculas (convención)');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('payment-proofs', 'a1000000-0000-0000-0000-000000000010/c1000000-0000-0000-0000-000000000010/f0000000-0000-0000-0000-000000000031.jpg')$$, 'H3: sube su comprobante 1');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('payment-proofs', 'a1000000-0000-0000-0000-000000000010/c1000000-0000-0000-0000-000000000010/f0000000-0000-0000-0000-000000000032.png')$$, 'H3: sube el 2');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('payment-proofs', 'a1000000-0000-0000-0000-000000000010/c1000000-0000-0000-0000-000000000010/f0000000-0000-0000-0000-000000000033.webp')$$, 'H3: el 3');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('payment-proofs', 'a1000000-0000-0000-0000-000000000010/c1000000-0000-0000-0000-000000000010/f0000000-0000-0000-0000-000000000034.pdf')$$, 'H3: el 4');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('payment-proofs', 'a1000000-0000-0000-0000-000000000010/c1000000-0000-0000-0000-000000000010/f0000000-0000-0000-0000-000000000035.jpg')$$, '42501', null, 'H4: el 5.º supera el tope de archivos por pedido (2 × payment_proofs_max)');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('payment-proofs', 'a1000000-0000-0000-0000-000000000011/c1000000-0000-0000-0000-000000000011/f0000000-0000-0000-0000-000000000036.jpg')$$, '42501', null, 'H5: no sube a la carpeta de otra clienta');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('payment-proofs', 'a1000000-0000-0000-0000-000000000010/c1000000-0000-0000-0000-000000000011/f0000000-0000-0000-0000-000000000037.jpg')$$, '42501', null, 'H5: ni para un pedido que no es suyo');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('payment-proofs', 'a1000000-0000-0000-0000-000000000010/c1000000-0000-0000-0000-000000000010/f0000000-0000-0000-0000-000000000038.svg')$$, '42501', null, 'H5: ni un svg');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('payment-qr', 'qr/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2.png')$$, '42501', null, 'H6: la clienta no sube el QR de la tienda');
select is((select count(*)::int from storage.objects where bucket_id = 'payment-proofs'), 4, 'H7: ve sus 4 comprobantes');
update storage.objects set name = name || 'x' where bucket_id = 'payment-proofs';   -- sin política de update: no cambia nada
reset role;
select is((select count(*)::int from storage.objects where bucket_id = 'payment-proofs' and name like '%x'), 0, 'H8: no puede cambiar nada de lo ya subido (sin política de update)');
-- otra clienta no ve esos archivos
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'payment-proofs'), 0, 'H9: otra clienta NO ve los comprobantes ajenos (nunca son públicos)');
reset role;
select set_config('request.jwt.claims', '{"sub":"ad100000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
set local role authenticated;
select ok((select count(*) from storage.objects where bucket_id = 'payment-proofs') >= 4, 'H10: el administrador sí los ve');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('payment-qr', 'qr/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2.png')$$, 'H11: el administrador sube el QR con una ruta válida');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('payment-qr', 'cualquier-cosa.png')$$, '42501', null, 'H11: pero no fuera de la convención');
reset role;
update public.store_settings set value = '5' where key = 'payment_proofs_max';
-- el pedido cancelado ya no recibe archivos
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000017","role":"authenticated"}', true);
set local role authenticated;
select is(public.payment_proof_path_ok('a1000000-0000-0000-0000-000000000017/c1000000-0000-0000-0000-000000000017/f0000000-0000-0000-0000-000000000039.jpg'), false, 'H12: un pedido cancelado ya no recibe comprobantes');
reset role;

-- ═══ I. Auditoría ═══════════════════════════════════════════════════════════════════════════
select ok((select count(*) from public.audit_log where table_name = 'payment_proofs' and action = 'UPDATE'
            and actor_id = 'ad100000-0000-0000-0000-00000000000d' and occurred_at = now()) >= 4,
          'I1: cada decisión del administrador sobre un comprobante queda auditada con SU identidad');
select ok((select count(*) from public.audit_log where table_name = 'payment_reviews' and action = 'INSERT' and occurred_at = now()) >= 5, 'I2: abrir una revisión queda auditado');
select is((select actor_id from public.audit_log where table_name = 'payment_reviews' and action = 'UPDATE' and occurred_at = now()
              and diff::text like '%resolved%' and actor_id is not null limit 1),
          'ad100000-0000-0000-0000-00000000000d'::uuid, 'I3: y resolverla, con quién la resolvió');
select ok((select count(*) from public.audit_log where table_name = 'payments' and action = 'UPDATE' and occurred_at = now()) >= 5, 'I4: los cambios de estado de un cobro quedan auditados');

-- ═══ J. Máquina de estados y guarda del pedido ══════════════════════════════════════════════
create temp table t_st as select unnest(array['pending_payment', 'paid', 'preparing', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded']) as s;
select is((select string_agg(a.s || '>' || b.s, ', ' order by a.s || '>' || b.s collate "C") from t_st a, t_st b where public._order_transition_ok(a.s, b.s, 'system')),
  'pending_payment>cancelled, pending_payment>paid', 'J1: el sistema vence pedidos sin pagar y confirma los que se pagan; nada más');
select pg_temp.po(24, 10.00);
select public.transition_order_status(pg_temp.o(24), 'paid', 'ad100000-0000-0000-0000-00000000000d', 'admin', null);
select is(pg_temp.pst(24), 'paid', 'J2: confirmar un pedido (WhatsApp, a mano) marca su cobro pagado');
select is((select paid_at is not null from public.payments where id = pg_temp.pid(24)), true, 'J2: con su fecha');
select lives_ok($$update public.orders set payment_expires_at = now() + interval '1 day' where id = 'c1000000-0000-0000-0000-000000000024'$$, 'J3: la ventana de pago puede cambiar (reintentos)');
select throws_ok($$update public.orders set total = 1 where id = 'c1000000-0000-0000-0000-000000000024'$$, '42501', null, 'J3: pero el total sigue siendo una instantánea');

-- ═══ K. Autorrevisión: reintento + pago del intento viejo, comprobante que retiene sin fin, método apagado ═══
-- K1: el intento 1 falló, la clienta reintentó (intento 2) y el banco avisa ahora el pago del intento 1. Pedido 25 = 60,00.
select pg_temp.po(25, 60.00);
select pg_temp.ev(25, 'evt-k1a', 'failed', null);
select is(public.payment_retry(pg_temp.u(25), pg_temp.o(25)) ->> 'outcome', 'retried', 'K1: reintenta (intento 2)');
select is(pg_temp.ev(25, 'evt-k1b', 'paid', 60.00) ->> 'outcome', 'applied', 'K1: el aviso del intento 1 con el monto exacto se aplica');
select is(pg_temp.ost(25), 'paid', 'K1: el pedido queda pagado');
select is((select status from public.payments where order_id = pg_temp.o(25) and attempt = 1), 'paid', 'K1: el intento que RECIBIÓ el dinero queda pagado');
select is((select status from public.payments where order_id = pg_temp.o(25) and attempt = 2), 'cancelled', 'K1: el intento 2 (que no recibió nada) se cierra como cancelado, NO como pagado');
select is((select count(*)::int from public.payments where order_id = pg_temp.o(25) and status = 'paid'), 1, 'K1: un solo cobro pagado por pedido');

-- K2: un comprobante pendiente retiene el pedido pasado el vencimiento, pero NO para siempre (3 días).
select pg_temp.po(26, 30.00);
select pg_temp.rec('k2a', pg_temp.reg(26, 40));
select pg_temp.po(27, 30.00);
select pg_temp.rec('k2b', pg_temp.reg(27, 41));
update public.orders set payment_expires_at = now() - interval '4 days' where id = pg_temp.o(26);
update public.orders set payment_expires_at = now() - interval '2 days' where id = pg_temp.o(27);
select public.expire_unconfirmed_orders();
select is(pg_temp.ost(26), 'cancelled', 'K2: con el comprobante pendiente, a los 4 días del vencimiento el pedido SÍ se cancela (no acapara el stock sin fin)');
select is(pg_temp.ost(27), 'pending_payment', 'K2: a los 2 días, con el comprobante pendiente, sigue esperando la revisión');
select is((select status from public.payment_proofs where id = (pg_temp.q('k2a', 'proof_id'))::uuid), 'rejected', 'K2: el comprobante del pedido cancelado se cierra');
select is((select detail ->> 'cause' from public.payment_reviews where payment_id = pg_temp.pid(26) and reason = 'late' and status = 'open'), 'proof_pending_at_cancel', 'K2: …y deja una revisión abierta: la clienta pudo haber pagado y nadie miró su comprobante');

-- K3: un método que el dueño apagó no se puede reintentar. Pedido 28 = 20,00 con el cobro fallido.
select pg_temp.po(28, 20.00);
select pg_temp.ev(28, 'evt-k3a', 'failed', null);
select is(pg_temp.view_as(28, 28) ->> 'can_retry', 'true', 'K3: con el método encendido puede reintentar');
update public.payment_methods set is_active = false where country = 'BO' and code = 'qr_manual';
select is(pg_temp.view_as(28, 28) ->> 'can_retry', 'false', 'K3: apagado el método, la vista ya no ofrece reintentar');
select is(public.payment_retry(pg_temp.u(28), pg_temp.o(28)) ->> 'outcome', 'not_retryable', 'K3: …y reintentar se rechaza');
select is(pg_temp.view_as(28, 28) #>> '{method,qr_image_path}', 'qr/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.png', 'K3: pero quien ya tiene un pedido sigue viendo el QR para pagarlo');
update public.payment_methods set is_active = true where country = 'BO' and code = 'qr_manual';
select is(public.payment_retry(pg_temp.u(28), pg_temp.o(28)) ->> 'outcome', 'retried', 'K3: vuelto a encender, reintenta');

-- ═══ L. Correcciones de la revisión independiente ═══════════════════════════════════════════
create function pg_temp.confirm_amt(p_payment uuid, p_note text, p_amount numeric) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"ad100000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
  set local role authenticated;
  v := public.admin_confirm_payment_manual(p_payment, p_amount, p_note);
  reset role;
  return v;
end $$;

-- L1: una decisión NULL ya no aprueba (con NULL, `not in` daba NULL y la validación se saltaba: caía en «aprobar»). Pedido 29 = 40,00.
select pg_temp.po(29, 40.00);
select pg_temp.rec('l1', pg_temp.reg(29, 50));
select throws_ok(format($$select pg_temp.review(%L::uuid, null)$$, pg_temp.q('l1', 'proof_id')), '22023', null, 'L1: una decisión NULL se rechaza (antes aprobaba el comprobante)');
select is((select status from public.payment_proofs where id = (pg_temp.q('l1', 'proof_id'))::uuid), 'pending', 'L1: el comprobante sigue pendiente');
select is(pg_temp.ost(29), 'pending_payment', 'L1: y el pedido sigue sin pagar');

-- L2: el admin escribe un monto equivocado (79,50 de 80,00) y luego lo corrige: la corrección SÍ se procesa. Pedido 30 = 80,00.
select pg_temp.po(30, 80.00);
select is(pg_temp.confirm_amt(pg_temp.pid(30), 'por error', 79.50) ->> 'outcome', 'review', 'L2: un monto mal escrito va a revisión (el pedido no se paga)');
select is(pg_temp.confirm_amt(pg_temp.pid(30), 'por error', 79.50) ->> 'outcome', 'duplicate', 'L2: repetir EXACTAMENTE lo mismo es una sola confirmación (doble clic)');
select is(pg_temp.confirm_amt(pg_temp.pid(30), 'ya lo vi bien', 80.00) ->> 'outcome', 'applied', 'L2: corregir el monto SÍ se procesa y confirma el pago (antes quedaba «duplicado» y el pedido vencía con el dinero recibido)');
select is(pg_temp.ost(30), 'paid', 'L2: el pedido queda pagado');
select is(pg_temp.confirm_amt(pg_temp.pid(30), 'otra vez', 80.00) ->> 'outcome', 'already_paid', 'L2: confirmar un cobro ya pagado dice «ya pagado»');
select is((select status from public.payment_reviews where payment_id = pg_temp.pid(30) and reason = 'amount_mismatch'), 'resolved', 'L2: y la revisión del monto equivocado se cerró sola');

-- L3: un aviso del proveedor solo toca cobros de SU proveedor. Pedidos 31 y 32 = 25,00 (cobros «manual_qr»).
select pg_temp.po(31, 25.00);
select pg_temp.po(32, 25.00);
select is(public.payment_apply_event('qr_api', 'evt-l3a', 'paid', pg_temp.ref(31), 25.00, 'BOB') ->> 'outcome', 'unknown_reference', 'L3: un aviso de «qr_api» sobre un cobro «manual_qr» se trata como referencia desconocida');
select is(pg_temp.ost(31), 'pending_payment', 'L3: y el pedido NO se paga (aunque la referencia correlativa se adivine)');
select is(public.payment_apply_event('manual_qr', 'evt-l3b', 'paid', pg_temp.ref(31), 25.00, 'BOB') ->> 'outcome', 'applied', 'L3: con el proveedor del cobro, sí se aplica');
select is(pg_temp.ost(31), 'paid', 'L3: el pedido queda pagado');
select is(public.payment_apply_event('qr_api', 'evt-l3c', 'paid', pg_temp.ref(32), 25.00, 'BOB', null, '{}'::jsonb, 'ad100000-0000-0000-0000-00000000000d') ->> 'outcome', 'applied', 'L3: un administrador detrás sí confirma (la regla es solo para avisos sin persona)');

-- L4: un comprobante sin revisar se cierra cuando el pedido se paga por otra vía (no queda para un falso «pago duplicado»). Pedido 33 = 45,00.
select pg_temp.po(33, 45.00);
select pg_temp.rec('l4', pg_temp.reg(33, 51));
select is(pg_temp.confirm(pg_temp.pid(33), 'lo vi en el banco') ->> 'outcome', 'applied', 'L4: el admin confirma el pago a mano con un comprobante todavía sin revisar');
select is((select status from public.payment_proofs where id = (pg_temp.q('l4', 'proof_id'))::uuid), 'approved', 'L4: el comprobante pendiente se cierra como aprobado');
select is((select reason from public.payment_proofs where id = (pg_temp.q('l4', 'proof_id'))::uuid), 'Pago confirmado por otra vía', 'L4: con la razón a la vista');
select is(pg_temp.review((pg_temp.q('l4', 'proof_id'))::uuid, 'approve') ->> 'outcome', 'already_reviewed', 'L4: aprobarlo después no hace nada (y no abre un «pago duplicado»)');
select is((select count(*)::int from public.payment_reviews where payment_id = pg_temp.pid(33)), 0, 'L4: ninguna revisión sobre ese cobro');
-- …y si aun así un comprobante pendiente llegara a un cobro ya pagado (carrera simulada), aprobarlo no abre un «pago duplicado»
update public.payment_proofs set status = 'pending', reviewed_at = null, reason = null where id = (pg_temp.q('l4', 'proof_id'))::uuid;
select is(pg_temp.review((pg_temp.q('l4', 'proof_id'))::uuid, 'approve') -> 'payment' ->> 'outcome', 'already_paid', 'L4: aprobar un comprobante de un cobro que ya estaba pagado lo dice (no es un segundo pago)');
select is((select count(*)::int from public.payment_reviews where payment_id = pg_temp.pid(33)), 0, 'L4: y tampoco abre una revisión de «pago duplicado»');

-- L5: cancelar no hace desaparecer el dinero. Pedido 34 (QR pagado y luego cancelado), 35 (WhatsApp pagado y luego cancelado).
select pg_temp.po(34, 50.00);
select pg_temp.ev(34, 'evt-l5a', 'paid', 50.00);
select is(public.transition_order_status(pg_temp.o(34), 'cancelled', null, 'admin', 'La clienta se arrepintió') ->> 'ok', 'true', 'L5: se cancela un pedido QR ya pagado');
select is((select detail ->> 'cause' from public.payment_reviews where payment_id = pg_temp.pid(34) and reason = 'late' and status = 'open'), 'cancelled_after_payment', 'L5: queda una revisión abierta: hay dinero recibido que devolver o reasignar');
select is(pg_temp.pst(34), 'paid', 'L5: y el cobro sigue «pagado» (el dinero llegó)');
select pg_temp.po(35, 20.00, interval '24 hours', 'whatsapp', 'whatsapp');
select public.transition_order_status(pg_temp.o(35), 'paid', null, 'admin');
select is(public.transition_order_status(pg_temp.o(35), 'cancelled', null, 'admin', 'Sin stock') ->> 'ok', 'true', 'L5: se cancela un pedido de WhatsApp confirmado');
select is((select count(*)::int from public.payment_reviews where payment_id = pg_temp.pid(35)), 0, 'L5: sin QR no hay revisión de pagos (su reembolso es de la operación, S12)');

-- L6: la clienta ve el comprobante del cobro VIGENTE, no el de un intento anterior. Pedido 36 = 15,00.
select pg_temp.po(36, 15.00);
select pg_temp.rec('l6', pg_temp.reg(36, 52));
select pg_temp.review((pg_temp.q('l6', 'proof_id'))::uuid, 'reject', 'Ilegible');
select pg_temp.ev(36, 'evt-l6a', 'failed', null);
select is(public.payment_retry(pg_temp.u(36), pg_temp.o(36)) ->> 'outcome', 'retried', 'L6: reintenta (cobro 2)');
select is(pg_temp.view_as(36, 36) ->> 'proof', null, 'L6: el comprobante rechazado del cobro 1 NO se muestra en el cobro 2');

-- ═══ M. Huecos que dejó la mutación (cada bloque mata un cambio que antes pasaba sin que ninguna prueba lo notara) ═══════════
-- M1: un aviso «paid» SIN monto no puede confirmar nada (con NULL la comparación daba NULL y caía en «pagado»). Pedido 37 = 33,00.
select pg_temp.po(37, 33.00);
select is(pg_temp.ev(37, 'evt-m1', 'paid', null) ->> 'outcome', 'review', 'M1: un aviso de pago sin monto va a revisión (no confirma el pedido)');
select is(pg_temp.pst(37), 'pending', 'M1: y el cobro sigue abierto');

-- M2: la IDOR del comprobante se comprueba por el DUEÑO del pedido, no solo por la ruta: la clienta 11 con SU carpeta y el pedido 10.
select is(public.payment_proof_register(pg_temp.u(11), pg_temp.pid(10), pg_temp.u(11)::text || '/' || pg_temp.o(10)::text || '/' || pg_temp.fid(54) || '.jpg', pg_temp.h(54), 'image/jpeg', 1054) ->> 'outcome',
          'not_found', 'M2: ni con su propia carpeta y el pedido de otra: el cobro es de otra clienta');

-- M3: un cobro FALLIDO no recibe comprobantes aunque el pedido siga pendiente. Pedido 38 = 20,00.
select pg_temp.po(38, 20.00);
select pg_temp.ev(38, 'evt-m3', 'failed', null);
select is(pg_temp.reg(38, 55) ->> 'outcome', 'payment_closed', 'M3: un cobro fallido no recibe comprobantes (aunque el pedido siga pendiente)');

-- M4: el reintento renueva la ventana del PEDIDO. Pedido 39 = 20,00 con 2 h de ventana: al reintentar vuelve a tener 24 h.
-- (En la misma transacción now() no cambia: sin partir de una ventana distinta de 24 h, «no renovar» daría el mismo resultado.)
select pg_temp.po(39, 20.00, interval '2 hours');
select pg_temp.ev(39, 'evt-m4', 'failed', null);
select is(public.payment_retry(pg_temp.u(39), pg_temp.o(39)) ->> 'outcome', 'retried', 'M4: reintenta un cobro de un pedido al que le quedaban 2 h');
select is((select payment_expires_at - now() from public.orders where id = pg_temp.o(39)), interval '24 hours', 'M4: el PEDIDO recibe una ventana nueva de 24 h (no conserva las 2 h que le quedaban)');
select is((select expires_at - now() from public.payments where id = pg_temp.pid(39)), interval '24 hours', 'M4: y el cobro nuevo también');

-- M5: con un comprobante esperando revisión, la clienta NO puede subir otro y ve su estado. Pedido 40 = 18,00.
select pg_temp.po(40, 18.00);
select pg_temp.rec('m5', pg_temp.reg(40, 56));
select is(pg_temp.view_as(40, 40) ->> 'can_upload', 'false', 'M5: con un comprobante pendiente la vista no deja subir otro');
select is(pg_temp.view_as(40, 40) #>> '{proof,status}', 'pending', 'M5: y le muestra que está en revisión');

-- M6: los avisos al administrador llevan su TIPO (con el que el worker elige la plantilla), no solo su clave de deduplicación.
select is((select type from public.notification_outbox where dedupe_key = 'payment_proof_received:' || pg_temp.q('c1', 'proof_id')), 'payment_proof_received', 'M6: el aviso de comprobante nuevo tiene su tipo');
select is((select type from public.notification_outbox where dedupe_key = 'payment_review_needed:' || (select id::text from public.payment_reviews where payment_id = pg_temp.pid(2) and reason = 'duplicate')), 'payment_review_needed', 'M6: el de revisión pendiente también');
select is((select type from public.notification_outbox where dedupe_key = 'payment_unknown_reference:' || (select id::text from public.webhook_events where provider = 'qr_api' and event_id = 'evt-b8')), 'payment_unknown_reference', 'M6: y el de referencia desconocida');

-- M7: la tabla también se protege con su CHECK (no solo la función que la llena): un comprobante rechazado sin motivo no cabe.
select throws_ok(format($$update public.payment_proofs set status = 'rejected', reason = null, reviewed_at = now() where id = %L$$, pg_temp.q('m5', 'proof_id')), '23514', 'new row for relation "payment_proofs" violates check constraint "payment_proofs_reject_reason"', 'M7: un comprobante rechazado sin motivo se rechaza también en la tabla (por SU restricción, con la fecha de revisión ya puesta)');

-- M8: el servidor NO escribe estas tablas directo (solo por las funciones que se auditan y bloquean en orden).
select is((select count(*)::int from unnest(array['payments', 'payment_proofs', 'payment_reviews', 'webhook_events']) t
            where has_table_privilege('service_role', 'public.' || t, 'insert') or has_table_privilege('service_role', 'public.' || t, 'update')), 0,
          'M8: service_role no inserta ni actualiza cobros, comprobantes, revisiones ni avisos a mano');

-- M9: la política de subida mira también el ESTADO DEL PEDIDO, no solo el del cobro: un cobro «abierto» sobre un pedido cancelado
-- (estado imposible por las funciones; se fuerza a mano) tampoco recibe archivos. Pedido 17 (cancelado en C14).
update public.payments set status = 'pending' where id = pg_temp.pid(17);
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000017","role":"authenticated"}', true);
set local role authenticated;
select is(public.payment_proof_path_ok('a1000000-0000-0000-0000-000000000017/c1000000-0000-0000-0000-000000000017/f0000000-0000-0000-0000-000000000057.jpg'), false, 'M9: un cobro abierto sobre un pedido cancelado tampoco recibe archivos');
reset role;
update public.payments set status = 'cancelled' where id = pg_temp.pid(17);

select * from finish();
rollback;
