-- Sprint 13 · Notificaciones y alertas: ajustes, plantillas editables, la cola completa (estados, enlaces), el retroceso exponencial, el
-- canal de la clienta según su preferencia, los avisos del pedido (con la espera del «deshacer»), el worker en la base (tomar con
-- SKIP LOCKED, rescatar, descartar lo que ya no vale, cerrar con reintentos hasta «dead»), reenvío y WhatsApp manual, alertas internas,
-- limpieza por cuenta desactivada o anonimizada, preferencias con RLS y consentimiento auditado, y los permisos de todo lo nuevo.
-- Los valores esperados se calcularon A MANO (la cuenta va en el comentario de cada bloque).
-- Todo ocurre en una transacción que se revierte: no deja avisos, pedidos, stock movido ni ajustes cambiados.
--
-- Fixture:  clientas u01..u08 (a7…00NN; correo uNN.s13@test.com; teléfono +59173000NN) · admins ad1 (a8…01) y ad2 (a8…02)
--           u01 correo y teléfono · u02 solo correo · u03 solo teléfono · u04 prefiere WhatsApp · u05..u08 para desactivar/anonimizar
--           producto PA 100,00 (stock 50) · pedido n = c7…00NN con número MIC-9300NN, insertado directo por `pg_temp.mko`
begin;
select no_plan();

-- HERMÉTICO: la nube trae miles de avisos de otras corridas; esta prueba parte de una cola vacía dentro de su transacción.
-- (Sin clave foránea que lo impida: el registro de envíos no estorba a pedidos ni cuentas. `postgres` sí puede borrar; nadie más.)
delete from public.notification_outbox;
update public.store_settings set value = 'true'   where key = 'notify_enabled';
update public.store_settings set value = '8'      where key = 'notify_max_attempts';
update public.store_settings set value = '60'     where key = 'notify_backoff_seconds';
update public.store_settings set value = '"none"' where key = 'notify_email_provider';
update public.store_settings set value = '""'     where key = 'alert_recipients';
update public.store_settings set value = '5'      where key = 'order_undo_window_minutes';

-- ── Ayudas (objetos temporales: viven y mueren con la transacción) ────────────────────────────
create function pg_temp.u(n int) returns uuid language sql as $$ select ('a7000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.ad(n int) returns uuid language sql as $$ select ('a8000000-0000-0000-0000-00000000000' || n::text)::uuid $$;
create function pg_temp.o(n int) returns uuid language sql as $$ select ('c7000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.num(n int) returns text language sql as $$ select 'MIC-9300' || lpad(n::text, 2, '0') $$;
create function pg_temp.as_(p_uid uuid) returns void language sql as
  $$ select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p_uid), true) $$;
create function pg_temp.denied(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'permitido';
exception when others then
  return sqlstate || ':' || sqlerrm;
end $$;
create function pg_temp.ost(n int) returns text language sql as $$ select status from public.orders where id = pg_temp.o(n) $$;
-- Un aviso por su clave, y el id del último aviso de un tipo para un pedido.
create function pg_temp.nid(p_key text) returns bigint language sql as $$ select id from public.notification_outbox where dedupe_key = p_key $$;
create function pg_temp.last_of(p_type text, p_order int) returns bigint language sql as
  $$ select id from public.notification_outbox where type = p_type and order_id = pg_temp.o(p_order) order by id desc limit 1 $$;
create function pg_temp.nst(p_id bigint) returns text language sql as $$ select status from public.notification_outbox where id = p_id $$;
create function pg_temp.nerr(p_id bigint) returns text language sql as $$ select last_error from public.notification_outbox where id = p_id $$;
create function pg_temp.ncount(p_type text, p_order int) returns int language sql as
  $$ select count(*)::int from public.notification_outbox where type = p_type and order_id = pg_temp.o(p_order) $$;
-- Un aviso insertado directo (como lo haría enqueue_notification) con el estado, la hora y los intentos que haga falta.
create function pg_temp.mkn(p_key text, p_type text default 'order_created', p_channel text default 'email', p_recipient text default 'x@test.com',
                            p_status text default 'pending', p_due interval default interval '0', p_attempts int default 0,
                            p_profile int default null, p_order int default null, p_payload jsonb default '{}') returns bigint language sql as $$
  insert into public.notification_outbox (type, channel, recipient, payload, dedupe_key, status, attempts, next_retry_at, profile_id, order_id)
  values (p_type, p_channel, p_recipient, p_payload, p_key, p_status, p_attempts, now() + p_due,
          case when p_profile is null then null else pg_temp.u(p_profile) end, case when p_order is null then null else pg_temp.o(p_order) end)
  returning id $$;

-- Producto activo con una variante
create function pg_temp.mk(p_n int, p_price numeric, p_stock int) returns void language plpgsql as $$
declare
  v_pp text := lpad(p_n::text, 2, '0');
  v_p uuid := ('b7000000-0000-0000-0000-0000000000' || v_pp)::uuid;
  v_c uuid := ('d7000000-0000-0000-0000-0000000000' || v_pp)::uuid;
  v_s uuid := ('e7000000-0000-0000-0000-0000000000' || v_pp)::uuid;
  v_v uuid := ('f7000000-0000-0000-0000-0000000000' || v_pp)::uuid;
begin
  insert into public.products (id, code, slug, name) values (v_p, 'S13-' || v_pp, 's13-' || v_pp, 'Producto S13 ' || v_pp);
  insert into public.product_colors (id, product_id, name) values (v_c, v_p, 'Único');
  insert into public.product_prices (product_id, currency, amount) values (v_p, 'BOB', p_price);
  insert into public.product_sizes (id, product_id, label) values (v_s, v_p, 'M');
  insert into public.product_variants (id, product_id, color_id, size_id) values (v_v, v_p, v_c, v_s);
  perform public.apply_stock_change(v_v, p_stock, 'import', 'carga inicial S13');
  update public.products set status = 'active' where id = v_p;
end $$;

-- Un pedido de una línea (PA × 1 a 100,00) insertado directo, en el estado pedido, con su cobro y su primera fila de historial.
create function pg_temp.mko(p_n int, p_u int, p_status text default 'pending_payment') returns void language plpgsql as $$
begin
  insert into public.orders select * from jsonb_populate_record(null::public.orders, jsonb_build_object(
    'id', pg_temp.o(p_n), 'number', pg_temp.num(p_n), 'profile_id', pg_temp.u(p_u), 'status', p_status,
    'currency', 'BOB', 'base_currency', 'BOB', 'exchange_rate', 1, 'country', 'BO', 'subtotal', 100, 'discount_total', 0,
    'shipping_cost', 0, 'shipping_discount', 0, 'total', 100, 'tax_included', true,
    'contact_name', 'Cliente ' || p_u, 'contact_email', 'u' || lpad(p_u::text, 2, '0') || '.s13@test.com',
    'contact_phone', '+59173' || lpad(p_u::text, 5, '0'),
    'shipping_method', jsonb_build_object('code', 'delivery', 'name', 'A domicilio', 'kind', 'delivery', 'quote', jsonb_build_object('cost', 0)),
    'shipping_address', jsonb_build_object('recipient', 'Cliente ' || p_u, 'phone_e164', '+59173' || lpad(p_u::text, 5, '0'),
                                           'line1', 'Calle ' || p_u, 'city', 'La Paz', 'country', 'BO', 'lat', -16.52, 'lng', -68.15),
    'payment_method', 'whatsapp', 'payment_provider', 'whatsapp', 'discounts', '[]'::jsonb, 'idempotency_key', 'key-s13-' || p_n,
    'channel', 'web', 'edit_count', 0, 'created_at', now(), 'updated_at', now(),
    'paid_at', case when p_status in ('paid', 'preparing', 'shipped', 'delivered', 'completed', 'refunded') then now() end,
    'cancelled_at', case when p_status = 'cancelled' then now() end, 'cancelled_by', case when p_status = 'cancelled' then 'admin' end));
  insert into public.order_items (id, order_id, line_no, variant_id, product_id, product_name, color_name, size_label, qty,
                                  unit_price, line_total, discount, final_total)
  values (('e8000000-0000-0000-' || lpad(p_n::text, 4, '0') || '-000000000001')::uuid, pg_temp.o(p_n), 1,
          'f7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'Producto S13 01', 'Único', 'M', 1, 100, 100, 0, 100);
  insert into public.payments (order_id, provider, method, status, amount, currency, paid_at)
  values (pg_temp.o(p_n), 'whatsapp', 'whatsapp', 'pending', 100, 'BOB', null);
  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_kind, reason)
  values (pg_temp.o(p_n), null, 'pending_payment', pg_temp.u(p_u), 'customer', 'created');
end $$;

-- ── Datos ───────────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data, aud, role)
select pg_temp.u(n), 'u' || lpad(n::text, 2, '0') || '.s13@test.com', jsonb_build_object('full_name', 'Clienta ' || n), 'authenticated', 'authenticated'
  from generate_series(1, 8) n;
update public.profiles set phone_e164 = '+59173' || lpad(right(id::text, 2)::int::text, 5, '0') where id::text like 'a7000000%';
update public.profiles set phone_e164 = null where id = pg_temp.u(2);   -- u02: solo correo
update public.profiles set email = null where id = pg_temp.u(3);        -- u03: solo teléfono
insert into public.notification_preferences (profile_id, preferred_channel) values (pg_temp.u(4), 'whatsapp');
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  (pg_temp.ad(1), 'admin1.s13@test.com', '{"full_name":"Admin Uno S13"}', 'authenticated', 'authenticated'),
  (pg_temp.ad(2), 'admin2.s13@test.com', '{"full_name":"Admin Dos S13"}', 'authenticated', 'authenticated');
select public.set_user_role(pg_temp.ad(1), 'admin');
select public.set_user_role(pg_temp.ad(2), 'admin');
select pg_temp.mk(1, 100.00, 50);

-- Desde aquí, todo lo hace el administrador 1 (la sesión de la transacción).
select pg_temp.as_(pg_temp.ad(1));

-- ═══ A. Ajustes y estructura ═══════════════════════════════════════════════════════════════
select is((select count(*)::int from public.store_settings where key in ('notify_enabled', 'notify_max_attempts', 'notify_backoff_seconds',
            'notify_email_provider', 'notify_from_name', 'notify_from_email', 'notify_reply_to', 'notify_whatsapp_mode', 'alert_recipients')), 9,
          'A1: los 9 ajustes nuevos existen');
select is((select value #>> '{}' from public.store_settings where key = 'notify_email_provider'), 'none', 'A1: el proveedor de correo arranca en «none» (nada se envía sin que el dueño lo active)');
select is((select value #>> '{}' from public.store_settings where key = 'notify_whatsapp_mode'), 'manual', 'A1: WhatsApp arranca en modo manual');
select is((select value #>> '{}' from public.store_settings where key = 'notify_from_email'), '', 'A1: sin remitente hasta confirmar el dominio');
select is(pg_temp.denied($$update public.store_settings set value = '0' where key = 'notify_max_attempts'$$), '22023:el ajuste "notify_max_attempts" está fuera de rango', 'A2: 0 intentos no vale');
select is(pg_temp.denied($$update public.store_settings set value = '21' where key = 'notify_max_attempts'$$), '22023:el ajuste "notify_max_attempts" está fuera de rango', 'A2: 21 intentos tampoco (el tope es 20)');
select lives_ok($$update public.store_settings set value = '20' where key = 'notify_max_attempts'$$, 'A2: 20 sí');
select lives_ok($$update public.store_settings set value = '1' where key = 'notify_max_attempts'$$, 'A2: 1 sí');
select is(pg_temp.denied($$update public.store_settings set value = '4' where key = 'notify_backoff_seconds'$$), '22023:el ajuste "notify_backoff_seconds" está fuera de rango', 'A2: espera de 4 s no vale (mínimo 5)');
select is(pg_temp.denied($$update public.store_settings set value = '3601' where key = 'notify_backoff_seconds'$$), '22023:el ajuste "notify_backoff_seconds" está fuera de rango', 'A2: ni 3601 (máximo 3600)');
select lives_ok($$update public.store_settings set value = '5' where key = 'notify_backoff_seconds'$$, 'A2: 5 sí');
select lives_ok($$update public.store_settings set value = '3600' where key = 'notify_backoff_seconds'$$, 'A2: 3600 sí');
select throws_ok($$update public.store_settings set value = '"smtp"' where key = 'notify_email_provider'$$, '22023', 'notify_email_provider debe ser none, resend o fake', 'A2: proveedor desconocido');
select lives_ok($$update public.store_settings set value = '"resend"' where key = 'notify_email_provider'$$, 'A2: resend sí');
select throws_ok($$update public.store_settings set value = '"api"' where key = 'notify_whatsapp_mode'$$, '22023', 'notify_whatsapp_mode debe ser manual u official', 'A2: modo de WhatsApp desconocido');
select throws_ok($$update public.store_settings set value = '"sin-arroba"' where key = 'notify_from_email'$$, '22023', null, 'A2: remitente que no es un correo');
select throws_ok($$update public.store_settings set value = '"Pedidos@Chola.com"' where key = 'notify_from_email'$$, '22023', null, 'A2: remitente con mayúsculas (se guarda en minúsculas)');
select lives_ok($$update public.store_settings set value = '"pedidos@chola.test"' where key = 'notify_from_email'$$, 'A2: remitente válido');
select throws_ok($$update public.store_settings set value = '"a@b.co\nBcc: x@y.co"' where key = 'notify_reply_to'$$, '22023', null, 'A2: un correo con salto de línea (inyección de cabeceras) no entra');
select throws_ok($$update public.store_settings set value = '"Chola <x>"' where key = 'notify_from_name'$$, '22023', null, 'A2: el nombre del remitente no admite < >');
select lives_ok($$update public.store_settings set value = '"a@b.co, C@D.co"' where key = 'alert_recipients'$$, 'A2: lista de destinatarios de alertas con espacios');
select throws_ok($$update public.store_settings set value = '"a@b.co, mal"' where key = 'alert_recipients'$$, '22023', null, 'A2: una entrada inválida rechaza toda la lista');
select throws_ok($$update public.store_settings set value = '"a1@b.co,a2@b.co,a3@b.co,a4@b.co,a5@b.co,a6@b.co,a7@b.co,a8@b.co,a9@b.co,a10@b.co,a11@b.co"' where key = 'alert_recipients'$$, '22023', 'alert_recipients admite hasta 10 correos', 'A2: 11 correos son demasiados');
select throws_ok($$update public.store_settings set value = '"si"' where key = 'notify_enabled'$$, '22023', null, 'A2: el interruptor es verdadero o falso');
update public.store_settings set value = '8' where key = 'notify_max_attempts';
update public.store_settings set value = '60' where key = 'notify_backoff_seconds';
update public.store_settings set value = '"none"' where key = 'notify_email_provider';
update public.store_settings set value = '""' where key in ('alert_recipients', 'notify_from_email');

-- Estados de la cola
select lives_ok($$insert into public.notification_outbox (type, channel, dedupe_key, status) values ('x', 'email', 'st-sending', 'sending'), ('x', 'email', 'st-dead', 'dead'), ('x', 'email', 'st-canc', 'cancelled'), ('x', 'email', 'st-man', 'manual')$$,
        'A3: la cola admite sending, dead, cancelled y manual');
select throws_ok($$insert into public.notification_outbox (type, channel, dedupe_key, status) values ('x', 'email', 'st-bad', 'enviado')$$, '23514', null, 'A3: un estado inventado no entra');
delete from public.notification_outbox;

-- Plantillas sembradas
select is((select count(*)::int from public.notification_templates), 36, 'A4: 36 plantillas de arranque (13 de correo y 13 de WhatsApp para la clienta, 10 alertas internas)');
select is((select count(*)::int from public.notification_templates where audience = 'customer' and channel = 'email'), 13, 'A4: 13 correos para la clienta');
select is((select count(*)::int from public.notification_templates where audience = 'customer' and channel = 'whatsapp'), 13, 'A4: 13 WhatsApp para la clienta');
select is((select count(*)::int from public.notification_templates where audience = 'admin' and channel = 'email'), 10, 'A4: 10 alertas internas por correo');
select is((select count(*)::int from public.notification_templates where audience = 'admin' and channel = 'whatsapp'), 0, 'A4: las alertas internas no van por WhatsApp');
-- Propiedades que valen aunque la tienda ya haya editado alguna (el estado de los datos no es de esta prueba): de arranque, solo «completado» y
-- «reembolsado» están apagadas (las cubren «entregado» y «devolución procesada»); y nada deja de ser texto de arranque sin quedar quién lo editó.
select is((select count(*)::int from public.notification_templates where is_default and ((not active and key not in ('order_completed', 'order_refunded'))
                                                                                          or (active and key in ('order_completed', 'order_refunded')))), 0,
          'A4: entre los textos de arranque, solo «completado» y «reembolsado» están apagados (los cubren «entregado» y «devolución procesada»)');
select is((select count(*)::int from public.notification_templates where not is_default and updated_by is null), 0, 'A4: ninguna plantilla deja de ser texto de arranque sin quedar quién la editó');
select is((select count(*)::int from public.notification_templates where channel = 'email' and (subject = '' or body = '')), 0, 'A4: todo correo tiene asunto y cuerpo');
select is((select count(*)::int from public.notification_templates where channel = 'whatsapp' and char_length(body) > 1000), 0, 'A4: ningún WhatsApp pasa de 1000 caracteres');
-- Sintaxis de las plantillas
select throws_ok($$update public.notification_templates set body = 'Hola {{' where key = 'order_created' and channel = 'email'$$, '22023', null, 'A5: una llave suelta rompería el mensaje');
select throws_ok($$update public.notification_templates set body = 'Hola {{Nombre}}' where key = 'order_created' and channel = 'email'$$, '22023', null, 'A5: variables en minúsculas');
select throws_ok($$update public.notification_templates set body = 'Hola {{a-b}}' where key = 'order_created' and channel = 'email'$$, '22023', null, 'A5: ni guiones');
select throws_ok($$update public.notification_templates set subject = E'Hola\nBcc: x' where key = 'order_created' and channel = 'email'$$, '22023', 'el asunto no puede tener saltos de línea', 'A5: asunto sin saltos de línea');
select throws_ok($$update public.notification_templates set subject = '' where key = 'order_created' and channel = 'email'$$, '23514', null, 'A5: un correo sin asunto no vale');
select throws_ok($$update public.notification_templates set body = repeat('a', 1001) where key = 'order_created' and channel = 'whatsapp'$$, '23514', null, 'A5: WhatsApp de más de 1000 caracteres no vale');
select lives_ok($$update public.notification_templates set body = 'Hola {{ customer_name }}, {{order_number}}' where key = 'order_created' and channel = 'email'$$, 'A5: variables válidas (con espacios) sí');
select is((select is_default from public.notification_templates where key = 'order_created' and channel = 'email'), false, 'A6: editar el texto la marca como revisada por la tienda');
select is((select updated_by from public.notification_templates where key = 'order_created' and channel = 'email'), pg_temp.ad(1), 'A6: …y queda quién la editó');
update public.notification_templates set active = false where key = 'order_packed' and channel = 'email';
select is((select active from public.notification_templates where key = 'order_packed' and channel = 'email'), false, 'A6: desactivar una plantilla se puede');
update public.notification_templates set active = true where key = 'order_packed' and channel = 'email';
select throws_ok($$insert into public.notification_templates (key, channel, audience, subject, body) values ('order_created', 'email', 'customer', 'x', 'y')$$, '23505', null, 'A7: no hay dos plantillas para la misma clave, canal e idioma');
select ok(exists (select 1 from public.audit_log where table_name = 'notification_templates' and action = 'UPDATE' and actor_id = pg_temp.ad(1)), 'A8: editar una plantilla queda en la auditoría');

-- ═══ B. Retroceso exponencial ══════════════════════════════════════════════════════════════
-- base × 2^(intentos−1), tope 21 600 s. Base 60: 60, 120, 240, 480, 960, 1920, 3840, 7680, 15360, y el 10.º (30 720) se topa en 21 600.
select is((select array_agg(public.notification_backoff_seconds(n, 60) order by n) from generate_series(1, 10) n),
          array[60, 120, 240, 480, 960, 1920, 3840, 7680, 15360, 21600], 'B1: 60 · 120 · 240 · 480 · 960 · 1920 · 3840 · 7680 · 15360 y 21600 (tope)');
select is((select sum(public.notification_backoff_seconds(n, 60))::int from generate_series(1, 7) n), 7620,
          'B2: con 8 intentos las 7 esperas suman 60+120+240+480+960+1920+3840 = 7620 s (127 min): aguanta una caída de más de 2 horas');
select is(public.notification_backoff_seconds(1, 5), 5, 'B3: con base 5, el primer reintento a los 5 s');
select is(public.notification_backoff_seconds(4, 5), 40, 'B3: …y el cuarto a los 40 s (5 × 2³)');
select is(public.notification_backoff_seconds(null, 60), 60, 'B4: sin intentos cuenta como el primero');
select is(public.notification_backoff_seconds(0, 60), 60, 'B4: con 0 intentos también');
select is(public.notification_backoff_seconds(3, null), 240, 'B4: sin base usa 60');
select is(public.notification_backoff_seconds(3, 0), 4, 'B4: una base de 0 se corrige a 1 (1 × 2² = 4), nunca espera 0');
select is((select count(*)::int from generate_series(1, 60) n where public.notification_backoff_seconds(n + 1, 60) < public.notification_backoff_seconds(n, 60)), 0,
          'B5: propiedad: la espera nunca baja de un intento al siguiente');
select is((select max(public.notification_backoff_seconds(n, b))::int from generate_series(1, 200) n cross join (values (1), (60), (3600)) v(b)), 21600,
          'B5: propiedad: jamás pasa de 6 horas, ni con intentos enormes (sin desbordar)');

-- ═══ C. A quién y por qué canal se le avisa ═══════════════════════════════════════════════
select is((select channel || '|' || recipient from public._notify_target(pg_temp.u(1))), 'email|u01.s13@test.com', 'C1: u01 (correo y teléfono, sin preferencia): correo');
select is((select channel || '|' || recipient from public._notify_target(pg_temp.u(2))), 'email|u02.s13@test.com', 'C1: u02 (solo correo): correo');
select is((select channel || '|' || recipient from public._notify_target(pg_temp.u(3))), 'whatsapp|+5917300003', 'C1: u03 (solo teléfono): WhatsApp');
select is((select channel || '|' || recipient from public._notify_target(pg_temp.u(4))), 'whatsapp|+5917300004', 'C1: u04 (prefiere WhatsApp y lo tiene): WhatsApp');
update public.notification_preferences set preferred_channel = 'email' where profile_id = pg_temp.u(4);
select is((select channel from public._notify_target(pg_temp.u(4))), 'email', 'C2: …y si cambia a «correo», correo');
update public.notification_preferences set preferred_channel = 'whatsapp' where profile_id = pg_temp.u(4);
update public.profiles set phone_e164 = null where id = pg_temp.u(4);
select is((select channel || '|' || recipient from public._notify_target(pg_temp.u(4))), 'email|u04.s13@test.com', 'C3: prefiere WhatsApp pero no tiene teléfono: cae al correo (la preferencia elige entre lo que SÍ hay)');
update public.profiles set phone_e164 = '+5917300004' where id = pg_temp.u(4);
insert into public.notification_preferences (profile_id, preferred_channel) values (pg_temp.u(3), 'email');
select is((select channel || '|' || recipient from public._notify_target(pg_temp.u(3))), 'whatsapp|+5917300003', 'C3: prefiere correo pero no tiene: cae a WhatsApp');
delete from public.notification_preferences where profile_id = pg_temp.u(3);
update public.profiles set is_active = false where id = pg_temp.u(5);
select is((select count(*)::int from public._notify_target(pg_temp.u(5))), 0, 'C4: una cuenta desactivada no recibe avisos');
update public.profiles set is_active = true where id = pg_temp.u(5);
select is((select count(*)::int from public._notify_target(gen_random_uuid())), 0, 'C4: una cuenta que no existe tampoco');

-- ═══ D. Los avisos del pedido ══════════════════════════════════════════════════════════════
-- Cada cambio de estado encola UN aviso por clienta, en el canal que le toca. Pedidos: 1 → u01 · 2 → u03 (WhatsApp) · 3 → u04 (WhatsApp).
select pg_temp.mko(1, 1);
select pg_temp.mko(2, 3);
select pg_temp.mko(3, 4);
select is(public.admin_transition_order(pg_temp.o(1), 'paid') ->> 'ok', 'true', 'D1: pedido 1 → pagado');
select is((select count(*)::int from public.notification_outbox where order_id = pg_temp.o(1)), 1, 'D1: se encoló exactamente UN aviso');
select is((select type || '|' || channel || '|' || recipient || '|' || status || '|' || attempts from public.notification_outbox where order_id = pg_temp.o(1)),
          'order_confirmed|email|u01.s13@test.com|pending|0', 'D1: «confirmado», por correo, a la clienta, pendiente');
select is((select dedupe_key from public.notification_outbox where order_id = pg_temp.o(1)), 'order_confirmed:' || pg_temp.o(1)::text || ':c', 'D1: con la clave de siempre (S10): un aviso por tipo y pedido');
select is((select template || '|' || (profile_id = pg_temp.u(1))::text from public.notification_outbox where order_id = pg_temp.o(1)), 'order_confirmed|true', 'D2: la plantilla es el tipo y queda enlazada a la clienta');
select is((select next_retry_at = now() from public.notification_outbox where order_id = pg_temp.o(1)), true, 'D3: «confirmado» sale sin esperar (no es un paso que se pueda deshacer)');
select is((select payload from public.notification_outbox where order_id = pg_temp.o(1)),
          jsonb_build_object('order_id', pg_temp.o(1), 'number', 'MIC-930001', 'status', 'paid', 'total', 100, 'currency', 'BOB'), 'D4: el contenido: número, estado, total y moneda');
select is((select count(*)::int from public.notification_outbox where payload::text ~* '(Cliente|Clienta|u01|s13@test|\+5917300|Calle|La Paz)'), 0, 'D4: sin datos personales en el contenido (el destinatario va en su columna)');
select is(public.admin_transition_order(pg_temp.o(1), 'preparing') ->> 'ok', 'true', 'D5: pedido 1 → preparando');
select is((select type || '|' || status from public.notification_outbox where id = pg_temp.last_of('order_packed', 1)), 'order_packed|pending', 'D5: aviso «empacado» pendiente');
select is((select next_retry_at - now() from public.notification_outbox where id = pg_temp.last_of('order_packed', 1)), interval '5 minutes',
          'D5: pero espera 5 minutos (la ventana del «deshacer»)');
select is(public.admin_transition_order(pg_temp.o(1), 'shipped') ->> 'ok', 'true', 'D6: → enviado');
select is((select next_retry_at - now() from public.notification_outbox where id = pg_temp.last_of('order_shipped', 1)), interval '5 minutes', 'D6: «enviado» también espera la ventana');
select is(public.admin_transition_order(pg_temp.o(1), 'delivered') ->> 'ok', 'true', 'D7: → entregado');
select is((select next_retry_at - now() from public.notification_outbox where id = pg_temp.last_of('order_delivered', 1)), interval '5 minutes', 'D7: «entregado» también');
select is(public.admin_transition_order(pg_temp.o(1), 'completed') ->> 'ok', 'true', 'D8: → completado');
select is((select next_retry_at - now() from public.notification_outbox where id = pg_temp.last_of('order_completed', 1)), interval '5 minutes', 'D8: «completado» también (también se puede deshacer)');
select is((select count(*)::int from public.notification_outbox where order_id = pg_temp.o(1)), 5, 'D9: 5 cambios de estado, 5 avisos (ni más ni menos)');
select is((select count(distinct dedupe_key)::int from public.notification_outbox where order_id = pg_temp.o(1)), 5, 'D9: todos con su clave propia');
update public.store_settings set value = '12' where key = 'order_undo_window_minutes';
select pg_temp.mko(4, 1);
select public.admin_transition_order(pg_temp.o(4), 'paid');
select public.admin_transition_order(pg_temp.o(4), 'preparing');
select is((select next_retry_at - now() from public.notification_outbox where id = pg_temp.last_of('order_packed', 4)), interval '12 minutes', 'D10: la espera sigue el ajuste de la ventana (12 min)');
select is((select next_retry_at = now() from public.notification_outbox where id = pg_temp.last_of('order_confirmed', 4)), true, 'D10: «confirmado» sigue saliendo sin espera');
update public.store_settings set value = '5' where key = 'order_undo_window_minutes';
-- Canal: u03 solo tiene teléfono, u04 prefiere WhatsApp
select public.admin_transition_order(pg_temp.o(2), 'paid');
select is((select channel || '|' || recipient from public.notification_outbox where order_id = pg_temp.o(2)), 'whatsapp|+5917300003', 'D11: u03 (solo teléfono): el aviso va por WhatsApp');
select public.admin_transition_order(pg_temp.o(3), 'paid');
select is((select channel || '|' || recipient from public.notification_outbox where order_id = pg_temp.o(3)), 'whatsapp|+5917300004', 'D11: u04 (prefiere WhatsApp): también');
-- Cancelar
select is(public.admin_transition_order(pg_temp.o(3), 'cancelled', 'sin stock') ->> 'ok', 'true', 'D12: el administrador cancela el pedido 3');
select is((select next_retry_at = now() from public.notification_outbox where id = pg_temp.last_of('order_cancelled', 3)), true, 'D12: el aviso de cancelación sale sin espera');
-- Cuenta desactivada: nada
select pg_temp.mko(5, 5);
update public.profiles set is_active = false where id = pg_temp.u(5);
select public.admin_transition_order(pg_temp.o(5), 'paid');
select is((select count(*)::int from public.notification_outbox where order_id = pg_temp.o(5) and recipient is not null), 0, 'D13: una cuenta desactivada no recibe el aviso del pedido');
update public.profiles set is_active = true where id = pg_temp.u(5);
-- Aviso a los administradores
select public._order_notify(pg_temp.o(1), 'order_new', 'admin');
select is((select channel || '|' || coalesce(recipient, '∅') || '|' || (profile_id is null)::text || '|' || (order_id = pg_temp.o(1))::text from public.notification_outbox where dedupe_key = 'order_new:' || pg_temp.o(1)::text || ':a'),
          'email|∅|true|true', 'D14: la alerta interna va a los administradores (sin destinatario concreto), sin clienta enlazada, con el pedido');
select public._order_notify(pg_temp.o(1), 'order_new', 'admin');
select is((select count(*)::int from public.notification_outbox where type = 'order_new'), 1, 'D15: encolar dos veces el mismo aviso deja UNO (dedupe_key)');
select is((select count(*)::int from public.notification_outbox where type = 'order_confirmed' and order_id = pg_temp.o(1)), 1, 'D15: …también el de estado');

-- ═══ E. Deshacer no deja avisos engañosos ═════════════════════════════════════════════════
select pg_temp.mko(6, 1);
select public.admin_transition_order(pg_temp.o(6), 'paid');
select public.admin_transition_order(pg_temp.o(6), 'preparing');
select is(pg_temp.nst(pg_temp.last_of('order_packed', 6)), 'pending', 'E1: el aviso «empacado» espera su ventana');
select is(public.admin_undo_transition(pg_temp.o(6)) ->> 'outcome', 'undone', 'E2: el administrador deshace el paso a tiempo');
select is(pg_temp.ost(6), 'paid', 'E2: el pedido vuelve a «pagado»');
select is(pg_temp.nst(pg_temp.last_of('order_packed', 6)) || '|' || pg_temp.nerr(pg_temp.last_of('order_packed', 6)), 'cancelled|reverted', 'E3: el aviso «empacado» se cancela: la clienta nunca lo ve');
select ok((select dedupe_key like 'order_packed:' || pg_temp.o(6)::text || ':c:reverted:%' from public.notification_outbox where id = pg_temp.last_of('order_packed', 6)), 'E3: …y su clave queda libre');
select is((select count(*)::int from public.notification_outbox where order_id = pg_temp.o(6) and type in ('order_confirmed')), 1, 'E4: el de «confirmado» (ya salido) no se toca');
select is(public.admin_transition_order(pg_temp.o(6), 'preparing') ->> 'ok', 'true', 'E5: el administrador vuelve a dar el paso');
select is(pg_temp.ncount('order_packed', 6), 2, 'E5: hay dos avisos «empacado»: el cancelado y el nuevo');
select is(pg_temp.nst(pg_temp.last_of('order_packed', 6)), 'pending', 'E5: el nuevo sí se enviará (sin la clave liberada, S10 lo habría tragado y la clienta nunca sabría)');
-- Un aviso que ya salió no se toca al deshacer
select pg_temp.mko(7, 1);
select public.admin_transition_order(pg_temp.o(7), 'paid');
select public.admin_transition_order(pg_temp.o(7), 'preparing');
update public.notification_outbox set status = 'sent', sent_at = now() where id = pg_temp.last_of('order_packed', 7);
select is(public.admin_undo_transition(pg_temp.o(7)) ->> 'outcome', 'undone', 'E6: se deshace el paso');
select is(pg_temp.nst(pg_temp.last_of('order_packed', 7)), 'sent', 'E6: el aviso que ya había salido queda como está (no se reescribe el pasado)');
-- Deshacer un paso solo cancela el aviso de ESE paso
select pg_temp.mko(8, 1);
select public.admin_transition_order(pg_temp.o(8), 'paid');
select public.admin_transition_order(pg_temp.o(8), 'preparing');
select public.admin_transition_order(pg_temp.o(8), 'shipped');
select is(public.admin_undo_transition(pg_temp.o(8)) ->> 'outcome', 'undone', 'E7: se deshace «enviado»');
select is(pg_temp.nst(pg_temp.last_of('order_shipped', 8)), 'cancelled', 'E7: el aviso «enviado» se cancela');
select is(pg_temp.nst(pg_temp.last_of('order_packed', 8)), 'pending', 'E7: el de «empacado» sigue pendiente (ese paso no se deshizo)');
-- Fuera de la ventana: no se puede deshacer y el aviso queda
select pg_temp.mko(9, 1, 'preparing');
insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_kind, created_at)
values (pg_temp.o(9), 'paid', 'preparing', pg_temp.ad(1), 'admin', now() - interval '6 minutes');
select public._order_notify(pg_temp.o(9), 'order_packed', 'customer');
select is(public.admin_undo_transition(pg_temp.o(9)) ->> 'outcome', 'window_expired', 'E8: pasados 5 minutos ya no se deshace');
select is(pg_temp.nst(pg_temp.last_of('order_packed', 9)), 'pending', 'E8: y el aviso sigue su curso');

-- ═══ F. El worker toma su lote ═════════════════════════════════════════════════════════════
-- Se parte de una cola vacía. Hora de referencia T = now() (constante en la transacción).
delete from public.notification_outbox;
create temp table t_n (k text primary key, id bigint);
create function pg_temp.k(p_k text) returns bigint language sql as $$ select id from t_n where k = p_k $$;
create function pg_temp.keep(p_k text, p_id bigint) returns void language sql as $$ insert into t_n values (p_k, p_id) $$;
select pg_temp.keep('a', pg_temp.mkn('f-a', p_due => interval '-3 minutes'));
select pg_temp.keep('b', pg_temp.mkn('f-b', p_due => interval '-2 minutes'));
select pg_temp.keep('c', pg_temp.mkn('f-c', p_due => interval '-1 minute'));
select pg_temp.keep('d', pg_temp.mkn('f-d', p_due => interval '1 hour'));
-- F1: con límite 2 toma los DOS más antiguos (a, b), en ese orden
select is((select array_agg(x.id order by x.next_retry_at, x.id) from public.claim_notifications(2, 'w1') x), array[pg_temp.k('a'), pg_temp.k('b')],
          'F1: con límite 2 toma los dos más antiguos (los que llevan más tiempo esperando)');
select is((select string_agg(status || '|' || attempts || '|' || locked_by, ' ; ' order by id) from public.notification_outbox where id in (pg_temp.k('a'), pg_temp.k('b'))),
          'sending|1|w1 ; sending|1|w1', 'F1: quedan «sending», con 1 intento y a nombre de w1');
select is((select count(*)::int from public.notification_outbox where id in (pg_temp.k('a'), pg_temp.k('b')) and locked_at = now()), 2, 'F1: con la hora en que se tomaron');
select is(pg_temp.nst(pg_temp.k('c')) || '|' || pg_temp.nst(pg_temp.k('d')), 'pending|pending', 'F1: c y d siguen pendientes');
-- F2: otro worker NO vuelve a tomar los ya tomados, ni el que aún no toca
select is((select array_agg(x.id) from public.claim_notifications(10, 'w2') x), array[pg_temp.k('c')], 'F2: el segundo worker toma solo c (a y b ya están tomados; d es de dentro de una hora)');
select is((select count(*)::int from public.claim_notifications(10, 'w3')), 0, 'F2: un tercero no encuentra nada que tomar');
select is((select attempts from public.notification_outbox where id = pg_temp.k('a')), 1, 'F2: los intentos se cuentan al tomar, no más');
-- F3: p_ids limita el lote
select pg_temp.keep('g', pg_temp.mkn('f-g', p_due => interval '-1 minute'));
select pg_temp.keep('h', pg_temp.mkn('f-h', p_due => interval '-1 minute'));
select is((select array_agg(x.id) from public.claim_notifications(10, 'w4', array[pg_temp.k('g')]) x), array[pg_temp.k('g')], 'F3: con p_ids toma solo ese aviso');
select is(pg_temp.nst(pg_temp.k('h')), 'pending', 'F3: el otro (también vencido) espera');
select is((select count(*)::int from public.claim_notifications(10, 'w4', array[]::bigint[])), 0, 'F3: una lista vacía de ids no toma nada');
-- F3b: p_channels = los canales que el worker PUEDE enviar ahora (sin proveedor de correo pide solo WhatsApp)
select pg_temp.keep('ce', pg_temp.mkn('f-ce', p_due => interval '-1 minute'));
select pg_temp.keep('cw', pg_temp.mkn('f-cw', p_channel => 'whatsapp', p_recipient => '+5917300009', p_due => interval '-1 minute'));
select is((select array_agg(x.id) from public.claim_notifications(10, 'w4', array[pg_temp.k('ce'), pg_temp.k('cw')], array['whatsapp']) x), array[pg_temp.k('cw')],
          'F3: con p_channels = [whatsapp] solo toma WhatsApp');
select is(pg_temp.nst(pg_temp.k('ce')) || '|' || (select attempts from public.notification_outbox where id = pg_temp.k('ce')), 'pending|0',
          'F3: …y el correo espera en la cola SIN gastar un intento');
select is((select count(*)::int from public.claim_notifications(10, 'w4', array[pg_temp.k('ce')], array[]::text[])), 0, 'F3: una lista vacía de canales no toma nada');
select is((select array_agg(x.id) from public.claim_notifications(10, 'w4', array[pg_temp.k('ce')], array['email', 'whatsapp']) x), array[pg_temp.k('ce')],
          'F3: con los dos canales sí toma el correo');
-- F4: el interruptor general
update public.store_settings set value = 'false' where key = 'notify_enabled';
select is((select count(*)::int from public.claim_notifications(10, 'w5')), 0, 'F4: con las notificaciones apagadas no se toma nada');
select is(pg_temp.nst(pg_temp.k('h')), 'pending', 'F4: y el aviso espera en la cola, sin perderse');
update public.store_settings set value = 'true' where key = 'notify_enabled';
select is((select array_agg(x.id) from public.claim_notifications(10, 'w5') x), array[pg_temp.k('h')], 'F4: al encenderlas, se toma');
-- F5: parámetros
select throws_ok($$select * from public.claim_notifications(0, 'w')$$, '22023', 'p_limit debe estar entre 1 y 200', 'F5: límite 0');
select throws_ok($$select * from public.claim_notifications(201, 'w')$$, '22023', 'p_limit debe estar entre 1 y 200', 'F5: límite 201');
select throws_ok($$select * from public.claim_notifications(5, '')$$, '22023', 'p_worker inválido', 'F5: worker sin nombre');
select throws_ok($$select * from public.claim_notifications(5, '  ')$$, '22023', 'p_worker inválido', 'F5: worker en blanco');
select throws_ok($$select * from public.claim_notifications(5, repeat('x', 81))$$, '22023', 'p_worker inválido', 'F5: nombre de worker de 81 caracteres');
select lives_ok($$select * from public.claim_notifications(200, repeat('x', 80))$$, 'F5: 200 y 80 caracteres son el máximo permitido');

-- F6: rescate de los «sending» que un worker caído dejó olvidados
select pg_temp.keep('r1', pg_temp.mkn('f-r1', p_status => 'sending', p_attempts => 2));
select pg_temp.keep('r2', pg_temp.mkn('f-r2', p_type => 'order_edited', p_status => 'sending', p_attempts => 8));
select pg_temp.keep('r3', pg_temp.mkn('f-r3', p_status => 'sending', p_attempts => 1));
update public.notification_outbox set locked_at = now() - interval '6 minutes', locked_by = 'muerto' where id in (pg_temp.k('r1'), pg_temp.k('r2'));
update public.notification_outbox set locked_at = now() - interval '1 minute', locked_by = 'vivo' where id = pg_temp.k('r3');
select count(*) from public.claim_notifications(10, 'w6');
select is((select status || '|' || attempts || '|' || last_error || '|' || (next_retry_at - now())::text from public.notification_outbox where id = pg_temp.k('r1')),
          'pending|2|worker_lost|00:00:01', 'F6: el aviso de un worker caído (6 min) vuelve a la cola, sin contar un intento más, para reintentar en 1 s');
select is((select status || '|' || last_error from public.notification_outbox where id = pg_temp.k('r2')), 'dead|worker_lost',
          'F6: si ya había agotado sus intentos (8 de 8) pasa a «dead» en vez de volver');
select is(pg_temp.nst(pg_temp.k('r3')) || '|' || (select locked_by from public.notification_outbox where id = pg_temp.k('r3')), 'sending|vivo',
          'F6: uno que lleva 1 minuto (un worker lento pero vivo) NO se toca');
select is((select type || '|' || coalesce(recipient, '∅') || '|' || (payload ->> 'notification_type') || '|' || (payload ->> 'attempts')
             from public.notification_outbox where dedupe_key = 'notification_dead:' || pg_temp.k('r2')::text),
          'notification_dead|∅|order_edited|8', 'F6: y un aviso que muere alerta a los administradores (con el tipo y los intentos)');

-- F7: se descartan los avisos que ya no valen
-- Pedidos nuevos (20..28) en el estado que importa; los avisos son de la clienta u01 (válida, con su correo vigente)
select pg_temp.mko(20, 1, 'shipped');
select pg_temp.mko(21, 1, 'paid');
select pg_temp.mko(22, 1, 'cancelled');
select pg_temp.mko(23, 1, 'completed');
select pg_temp.mko(24, 1, 'delivered');
select pg_temp.mko(25, 1, 'paid');
select pg_temp.mko(26, 1, 'pending_payment');
select pg_temp.mko(27, 1, 'delivered');
select pg_temp.mko(28, 1, 'paid');
select pg_temp.mko(29, 1, 'refunded');
select pg_temp.keep('s_sup', pg_temp.mkn('s-sup', 'order_packed', p_profile => 1, p_order => 20, p_recipient => 'u01.s13@test.com'));    -- pedido ya enviado
select pg_temp.keep('s_rev', pg_temp.mkn('s-rev', 'order_shipped', p_profile => 1, p_order => 21, p_recipient => 'u01.s13@test.com'));   -- pedido solo pagado
select pg_temp.keep('s_cx1', pg_temp.mkn('s-cx1', 'order_shipped', p_profile => 1, p_order => 22, p_recipient => 'u01.s13@test.com'));   -- pedido cancelado
select pg_temp.keep('s_cx2', pg_temp.mkn('s-cx2', 'order_cancelled', p_profile => 1, p_order => 22, p_recipient => 'u01.s13@test.com')); -- …y su propio aviso
select pg_temp.keep('s_del', pg_temp.mkn('s-del', 'order_delivered', p_profile => 1, p_order => 23, p_recipient => 'u01.s13@test.com')); -- entregado, ya completado
select pg_temp.keep('s_com', pg_temp.mkn('s-com', 'order_completed', p_profile => 1, p_order => 24, p_recipient => 'u01.s13@test.com')); -- completado, aún entregado
select pg_temp.keep('s_rem1', pg_temp.mkn('s-rem1', 'order_pending_reminder', p_recipient => null, p_order => 25, p_channel => 'email'));  -- recordatorio de uno ya pagado
select pg_temp.keep('s_rem2', pg_temp.mkn('s-rem2', 'order_pending_reminder', p_recipient => null, p_order => 26, p_channel => 'email'));  -- recordatorio de uno sin pagar
select pg_temp.keep('s_rsd', pg_temp.mkn('s-rsd', 'order_shipped', p_profile => 1, p_order => 27, p_recipient => 'u01.s13@test.com', p_payload => '{"resend": true}')); -- reenvío pedido por un admin
select pg_temp.keep('s_cre', pg_temp.mkn('s-cre', 'order_created', p_profile => 1, p_order => 28, p_recipient => 'u01.s13@test.com'));
select pg_temp.keep('s_ref', pg_temp.mkn('s-ref', 'order_cancelled', p_profile => 1, p_order => 29, p_recipient => 'u01.s13@test.com'));  -- reembolsado: «cancelado» sigue siendo cierto
select pg_temp.keep('s_un', pg_temp.mkn('s-un', 'order_packed', p_profile => 1, p_order => 29, p_recipient => 'u01.s13@test.com'));      -- reembolsado: «empacado» ya no
select pg_temp.keep('s_gone', pg_temp.mkn('s-gone', 'order_shipped', p_profile => 1, p_recipient => 'u01.s13@test.com', p_payload => jsonb_build_object('order_id', gen_random_uuid())));
create temp table t_claim as select x.id from public.claim_notifications(100, 'w7') x;
select is(pg_temp.nst(pg_temp.k('s_sup')) || '|' || pg_temp.nerr(pg_temp.k('s_sup')), 'cancelled|superseded', 'F7: «empacado» con el pedido ya enviado: lo supera el último paso (pasos rápidos seguidos → un solo aviso)');
select is(pg_temp.nst(pg_temp.k('s_rev')) || '|' || pg_temp.nerr(pg_temp.k('s_rev')), 'cancelled|reverted', 'F7: «enviado» con el pedido que volvió a «pagado»: se deshizo, no se avisa');
select is(pg_temp.nst(pg_temp.k('s_cx1')) || '|' || pg_temp.nerr(pg_temp.k('s_cx1')), 'cancelled|superseded', 'F7: «enviado» de un pedido cancelado: ya no engaña');
select is(pg_temp.nst(pg_temp.k('s_cx2')), 'sending', 'F7: pero el aviso de «cancelado» de ese pedido sí sale');
select is(pg_temp.nst(pg_temp.k('s_del')), 'sending', 'F7: «entregado» con el pedido ya «completado» sale (completado vale como entregado: no son dos pasos distintos)');
select is(pg_temp.nst(pg_temp.k('s_com')), 'sending', 'F7: …y «completado» con el pedido aún «entregado» también');
select is(pg_temp.nst(pg_temp.k('s_rem1')) || '|' || pg_temp.nerr(pg_temp.k('s_rem1')), 'cancelled|order_resolved', 'F7: recordar un pedido que ya se pagó no tiene sentido');
select is(pg_temp.nst(pg_temp.k('s_rem2')), 'sending', 'F7: el de un pedido todavía sin pagar sí sale');
select is(pg_temp.nst(pg_temp.k('s_rsd')), 'sending', 'F7: un reenvío pedido por un administrador sale aunque el pedido ya vaya más adelante');
select is(pg_temp.nst(pg_temp.k('s_cre')), 'sending', 'F7: un aviso de otro tipo («pedido creado») no depende del estado');
select is(pg_temp.nst(pg_temp.k('s_ref')), 'sending', 'F7: «cancelado» de un pedido luego reembolsado sigue siendo verdad');
select is(pg_temp.nst(pg_temp.k('s_un')) || '|' || pg_temp.nerr(pg_temp.k('s_un')), 'cancelled|superseded', 'F7: «empacado» de un pedido reembolsado ya no');
select is(pg_temp.nst(pg_temp.k('s_gone')) || '|' || pg_temp.nerr(pg_temp.k('s_gone')), 'cancelled|order_missing', 'F7: un aviso de estado de un pedido que ya no existe no tiene de qué hablar: se cancela');
select is((select count(*)::int from t_claim where id in (select id from t_n where k like 's\_%' and k not in ('s_sup', 's_rev', 's_cx1', 's_rem1', 's_un', 's_gone'))), 7,
          'F7: el lote devolvió solo los 7 que valían (cx2, del, com, rem2, rsd, cre, ref)');
select is((select count(*)::int from t_claim where id in (pg_temp.k('s_sup'), pg_temp.k('s_rev'), pg_temp.k('s_cx1'), pg_temp.k('s_rem1'), pg_temp.k('s_un'), pg_temp.k('s_gone'))), 0,
          'F7: …y los 6 descartados no están entre los devueltos');

-- F8: cuentas y contacto vigente
-- La cuenta se desactiva ANTES de insertar el aviso: así lo descarta la defensa del worker (la limpieza al desactivar se prueba en K).
update public.profiles set is_active = false where id = pg_temp.u(6);
select pg_temp.keep('t_dead', pg_temp.mkn('t-dead', p_profile => 6, p_recipient => 'u06.s13@test.com'));
select pg_temp.keep('t_mail', pg_temp.mkn('t-mail', p_profile => 2, p_recipient => 'viejo@test.com'));
select pg_temp.keep('t_wa', pg_temp.mkn('t-wa', p_profile => 4, p_recipient => 'u04.s13@test.com'));            -- u04 prefiere WhatsApp
select pg_temp.keep('t_ph', pg_temp.mkn('t-ph', p_profile => 3, p_recipient => 'ya-no@test.com'));              -- u03 solo teléfono
select pg_temp.keep('t_ad', pg_temp.mkn('t-ad', 'order_new', p_recipient => null));                              -- alerta interna
select count(*) from public.claim_notifications(100, 'w8');
select is(pg_temp.nst(pg_temp.k('t_dead')) || '|' || pg_temp.nerr(pg_temp.k('t_dead')), 'cancelled|account_inactive', 'F8: una cuenta desactivada entre encolar y enviar: se cancela');
select is((select channel || '|' || recipient from public.notification_outbox where id = pg_temp.k('t_mail')), 'email|u02.s13@test.com', 'F8: cambió el correo entre encolar y enviar: se envía al VIGENTE, no al viejo');
select is((select channel || '|' || recipient from public.notification_outbox where id = pg_temp.k('t_wa')), 'whatsapp|+5917300004', 'F8: cambió la preferencia a WhatsApp: se envía por WhatsApp');
select is((select channel || '|' || recipient from public.notification_outbox where id = pg_temp.k('t_ph')), 'whatsapp|+5917300003', 'F8: la clienta ya solo tiene teléfono: WhatsApp');
select is((select status || '|' || channel || '|' || coalesce(recipient, '∅') from public.notification_outbox where id = pg_temp.k('t_ad')), 'sending|email|∅', 'F8: la alerta interna (sin clienta) no se toca');
select is((select count(*)::int from public.notification_outbox where status = 'sending' and attempts <> 1 and id in (select id from t_n where k like 't\_%')), 0, 'F8: los intentos se cuentan al tomar (1)');
update public.profiles set is_active = true where id = pg_temp.u(6);

-- ═══ G. El worker cierra cada envío ════════════════════════════════════════════════════════
delete from public.notification_outbox;
create function pg_temp.snd(p_key text, p_attempts int default 1, p_type text default 'order_created') returns bigint language plpgsql as $$
declare v_id bigint;
begin
  v_id := pg_temp.mkn(p_key, p_type, p_status => 'sending', p_attempts => p_attempts);
  update public.notification_outbox set locked_at = now(), locked_by = 'w1' where id = v_id;
  return v_id;
end $$;
-- G1: enviado
select pg_temp.keep('g1', pg_temp.snd('g-1'));
select is(public.complete_notification(pg_temp.k('g1'), 'w1', 'sent', 'resend', 'msg_123', null, null, 'Tu pedido va en camino', 'Hola Ana, tu pedido salió.'), 'sent', 'G1: se cierra como enviado');
select is((select rendered_subject || '|' || rendered_body from public.notification_outbox where id = pg_temp.k('g1')), 'Tu pedido va en camino|Hola Ana, tu pedido salió.',
          'G1: queda escrito lo que se envió (asunto y texto) para el registro del panel');
select is((select status || '|' || provider || '|' || provider_message_id || '|' || (sent_at = now())::text || '|' || coalesce(last_error, '∅') || '|' || coalesce(locked_by, '∅') || '|' || (locked_at is null)::text
             from public.notification_outbox where id = pg_temp.k('g1')), 'sent|resend|msg_123|true|∅|∅|true', 'G1: con proveedor, id del mensaje y hora; sin error ni candado');
-- G2/G3: reintento con retroceso exponencial: espera = 60 × 2^(intentos−1)
select pg_temp.keep('g2', pg_temp.snd('g-2', 1));
select is(public.complete_notification(pg_temp.k('g2'), 'w1', 'retry', 'resend', null, 'timeout'), 'retry', 'G2: un error transitorio vuelve a la cola');
select is((select status || '|' || attempts || '|' || last_error || '|' || (next_retry_at - now())::text || '|' || coalesce(locked_by, '∅') from public.notification_outbox where id = pg_temp.k('g2')),
          'pending|1|timeout|00:01:00|∅', 'G2: tras el 1.er intento espera 60 s (00:01:00), conserva el error y suelta el candado');
select pg_temp.keep('g3b', pg_temp.snd('g-3b', 2));
select pg_temp.keep('g3c', pg_temp.snd('g-3c', 3));
select pg_temp.keep('g3d', pg_temp.snd('g-3d', 7));
select public.complete_notification(pg_temp.k('g3b'), 'w1', 'retry', null, null, 'e');
select public.complete_notification(pg_temp.k('g3c'), 'w1', 'retry', null, null, 'e');
select public.complete_notification(pg_temp.k('g3d'), 'w1', 'retry', null, null, 'e');
select is((select (next_retry_at - now())::text from public.notification_outbox where id = pg_temp.k('g3b')), '00:02:00', 'G3: tras el 2.º intento, 120 s');
select is((select (next_retry_at - now())::text from public.notification_outbox where id = pg_temp.k('g3c')), '00:04:00', 'G3: tras el 3.º, 240 s');
select is((select (next_retry_at - now())::text from public.notification_outbox where id = pg_temp.k('g3d')), '01:04:00', 'G3: tras el 7.º, 3840 s (1 h 4 min)');
-- G4: Retry-After del proveedor (429)
select pg_temp.keep('g4a', pg_temp.snd('g-4a', 1));
select pg_temp.keep('g4b', pg_temp.snd('g-4b', 1));
select pg_temp.keep('g4c', pg_temp.snd('g-4c', 1));
select public.complete_notification(pg_temp.k('g4a'), 'w1', 'retry', null, null, 'rate_limited', 300);
select public.complete_notification(pg_temp.k('g4b'), 'w1', 'retry', null, null, 'rate_limited', 99999);
select public.complete_notification(pg_temp.k('g4c'), 'w1', 'retry', null, null, 'rate_limited', 0);
select is((select (next_retry_at - now())::text from public.notification_outbox where id = pg_temp.k('g4a')), '00:05:00', 'G4: si el proveedor dice «espera 300 s», se espera eso');
select is((select (next_retry_at - now())::text from public.notification_outbox where id = pg_temp.k('g4b')), '06:00:00', 'G4: …con tope de 6 horas');
select is((select (next_retry_at - now())::text from public.notification_outbox where id = pg_temp.k('g4c')), '00:01:00', 'G4: 0 no es una espera: vale el retroceso normal (60 s)');
-- G5: agotados los intentos → «dead» y alerta al administrador (una sola)
select pg_temp.keep('g5', pg_temp.snd('g-5', 8, 'order_shipped'));
select is(public.complete_notification(pg_temp.k('g5'), 'w1', 'retry', 'resend', null, repeat('x', 200)), 'dead', 'G5: con 8 intentos de 8, otro fallo transitorio lo da por perdido');
select is(pg_temp.nst(pg_temp.k('g5')) || '|' || (select attempts from public.notification_outbox where id = pg_temp.k('g5')), 'dead|8', 'G5: queda «dead» con sus 8 intentos');
select is((select type || '|' || channel || '|' || coalesce(recipient, '∅') || '|' || (payload ->> 'notification_type') || '|' || (payload ->> 'attempts') || '|' || char_length(payload ->> 'error')
             from public.notification_outbox where dedupe_key = 'notification_dead:' || pg_temp.k('g5')::text), 'notification_dead|email|∅|order_shipped|8|120',
          'G5: alerta a los administradores con el tipo, los intentos y el error recortado a 120 caracteres');
select pg_temp.keep('g5b', pg_temp.snd('g-5b', 9, 'order_shipped'));
select is(public.complete_notification(pg_temp.k('g5b'), 'w1', 'retry', null, null, 'e'), 'dead', 'G5: con más intentos que el tope también');
select pg_temp.keep('g5c', pg_temp.snd('g-5c', 8, 'notification_dead'));
select pg_temp.keep('g5d', pg_temp.snd('g-5d', 8, 'template_fallback'));
select public.complete_notification(pg_temp.k('g5c'), 'w1', 'retry', null, null, 'e');
select public.complete_notification(pg_temp.k('g5d'), 'w1', 'retry', null, null, 'e');
select is((select count(*)::int from public.notification_outbox where dedupe_key in ('notification_dead:' || pg_temp.k('g5c')::text, 'notification_dead:' || pg_temp.k('g5d')::text)), 0,
          'G5: una alerta interna que muere NO alerta de sí misma (sería un bucle): los administradores ya eran sus destinatarios');
-- G6/G7/G8: errores permanentes, cancelación, WhatsApp manual
select pg_temp.keep('g6', pg_temp.snd('g-6'));
select is(public.complete_notification(pg_temp.k('g6'), 'w1', 'failed', 'resend', null, repeat('e', 400)), 'failed', 'G6: un error permanente (dirección inválida) no se reintenta');
select is((select status || '|' || char_length(last_error) || '|' || provider from public.notification_outbox where id = pg_temp.k('g6')), 'failed|300|resend', 'G6: queda «failed», con el error recortado a 300 y el proveedor');
select pg_temp.keep('g7', pg_temp.snd('g-7'));
select is(public.complete_notification(pg_temp.k('g7'), 'w1', 'cancelled', null, null, 'reserved_test_domain'), 'cancelled', 'G7: el worker puede cancelar (dominio reservado)');
select is(pg_temp.nst(pg_temp.k('g7')) || '|' || pg_temp.nerr(pg_temp.k('g7')), 'cancelled|reserved_test_domain', 'G7: con su motivo');
select pg_temp.keep('g8', pg_temp.snd('g-8'));
select is(public.complete_notification(pg_temp.k('g8'), 'w1', 'manual', null, null, null, null, null, 'Hola Ana, tu pedido salió. https://tienda.test'), 'manual', 'G8: WhatsApp manual: queda esperando a una persona');
select is((select coalesce(rendered_subject, '∅') || '|' || rendered_body from public.notification_outbox where id = pg_temp.k('g8')), '∅|Hola Ana, tu pedido salió. https://tienda.test',
          'G8: con el mensaje ya escrito, para armar el enlace wa.me');
select is((select status || '|' || provider || '|' || coalesce(last_error, '∅') from public.notification_outbox where id = pg_temp.k('g8')), 'manual|whatsapp_manual|∅', 'G8: «manual», con el canal manual como proveedor');
-- G9: solo cierra quien lo tiene
select pg_temp.keep('g9', pg_temp.snd('g-9'));
select is(public.complete_notification(pg_temp.k('g9'), 'otro-worker', 'sent', 'resend', 'x'), 'lost', 'G9: otro worker (cuyo envío ya se rescató) no pisa el resultado');
select is(pg_temp.nst(pg_temp.k('g9')), 'sending', 'G9: …y la fila no cambia');
select is(public.complete_notification(pg_temp.k('g1'), 'w1', 'failed', null, null, 'e'), 'lost', 'G9: tampoco se reabre uno ya enviado');
select is(pg_temp.nst(pg_temp.k('g1')), 'sent', 'G9: sigue «sent»');
select is(public.complete_notification(-1, 'w1', 'sent'), 'not_found', 'G9: un id que no existe');
select throws_ok(format($$select public.complete_notification(%s, 'w1', 'boom')$$, pg_temp.k('g9')), '22023', 'resultado desconocido: boom', 'G9: un resultado desconocido es un error de programación, no se traga');
-- G9b: el texto guardado tiene tope (300 el asunto, 4000 el cuerpo) y solo se guarda al enviar o dejar en manual
select pg_temp.keep('g9b', pg_temp.snd('g-9b'));
select public.complete_notification(pg_temp.k('g9b'), 'w1', 'sent', 'resend', 'm', null, null, repeat('s', 500), repeat('b', 5000));
select is((select char_length(rendered_subject) || '|' || char_length(rendered_body) from public.notification_outbox where id = pg_temp.k('g9b')), '300|4000', 'G9: el asunto se guarda hasta 300 y el cuerpo hasta 4000');
select pg_temp.keep('g9c', pg_temp.snd('g-9c'));
select public.complete_notification(pg_temp.k('g9c'), 'w1', 'retry', 'resend', null, 'e', null, 'no debe guardarse', 'tampoco');
select pg_temp.keep('g9d', pg_temp.snd('g-9d'));
select public.complete_notification(pg_temp.k('g9d'), 'w1', 'failed', 'resend', null, 'e', null, 'no debe guardarse', 'tampoco');
select is((select count(*)::int from public.notification_outbox where id in (pg_temp.k('g9c'), pg_temp.k('g9d')) and (rendered_subject is not null or rendered_body is not null)), 0,
          'G9: un reintento o un fallo no guardan texto (solo lo que de verdad se envió o quedó para enviar a mano)');
-- G10: los topes salen de los ajustes
update public.store_settings set value = '3' where key = 'notify_max_attempts';
select pg_temp.keep('g10a', pg_temp.snd('g-10a', 2));
select pg_temp.keep('g10b', pg_temp.snd('g-10b', 3));
select is(public.complete_notification(pg_temp.k('g10a'), 'w1', 'retry', null, null, 'e'), 'retry', 'G10: con tope 3, el intento 2 aún reintenta');
select is(public.complete_notification(pg_temp.k('g10b'), 'w1', 'retry', null, null, 'e'), 'dead', 'G10: …y el 3 ya no');
update public.store_settings set value = '8' where key = 'notify_max_attempts';
update public.store_settings set value = '120' where key = 'notify_backoff_seconds';
select pg_temp.keep('g11', pg_temp.snd('g-11', 3));
select public.complete_notification(pg_temp.k('g11'), 'w1', 'retry', null, null, 'e');
select is((select (next_retry_at - now())::text from public.notification_outbox where id = pg_temp.k('g11')), '00:08:00', 'G11: con base 120 s, tras el 3.er intento 120 × 2² = 480 s');
update public.store_settings set value = '60' where key = 'notify_backoff_seconds';

-- G12: SIMULACIÓN DE LA CAÍDA DEL PROVEEDOR. Un aviso falla en los 8 intentos: se tomó 8 veces, las esperas fueron 60, 120, … 3840 s,
-- al octavo fallo se dio por perdido y se alertó UNA vez. (Se adelanta la hora de reintento a «ahora» para dar el paso siguiente.)
create temp table t_wait (n int primary key, wait interval, final text);
select pg_temp.keep('life', pg_temp.mkn('g-life', 'order_confirmed'));
do $$
declare
  v_id bigint := (select id from t_n where k = 'life');
  v_res text;
  i int;
begin
  for i in 1..8 loop
    update public.notification_outbox set next_retry_at = now() where id = v_id;
    perform 1 from public.claim_notifications(1, 'wl', array[v_id]);
    v_res := public.complete_notification(v_id, 'wl', 'retry', 'resend', null, 'provider_down');
    insert into t_wait select i, (select next_retry_at - now() from public.notification_outbox where id = v_id), v_res;
  end loop;
end $$;
select is((select string_agg(final, ',' order by n) from t_wait), 'retry,retry,retry,retry,retry,retry,retry,dead', 'G12: siete reintentos y al octavo fallo, «dead»');
select is((select string_agg(wait::text, ' ' order by n) from t_wait where n <= 7), '00:01:00 00:02:00 00:04:00 00:08:00 00:16:00 00:32:00 01:04:00',
          'G12: las esperas fueron 1 · 2 · 4 · 8 · 16 · 32 · 64 minutos (127 en total: aguanta una caída de más de 2 horas)');
select is((select attempts from public.notification_outbox where id = pg_temp.k('life')), 8, 'G12: se intentó exactamente 8 veces');
select is((select count(*)::int from public.notification_outbox where type = 'notification_dead' and (payload ->> 'notification_id')::bigint = pg_temp.k('life')), 1, 'G12: y se avisó UNA sola vez al administrador');
-- …y si el proveedor vuelve antes, el siguiente intento lo entrega sin duplicar
select pg_temp.keep('life2', pg_temp.mkn('g-life2', 'order_confirmed'));
do $$
declare v_id bigint := (select id from t_n where k = 'life2');
begin
  perform 1 from public.claim_notifications(1, 'wl', array[v_id]);
  perform public.complete_notification(v_id, 'wl', 'retry', 'resend', null, 'provider_down');
  update public.notification_outbox set next_retry_at = now() where id = v_id;
  perform 1 from public.claim_notifications(1, 'wl', array[v_id]);
  perform public.complete_notification(v_id, 'wl', 'sent', 'resend', 'msg_ok');
end $$;
select is((select status || '|' || attempts || '|' || provider_message_id from public.notification_outbox where id = pg_temp.k('life2')), 'sent|2|msg_ok', 'G12: si el proveedor vuelve al 2.º intento, se entrega (2 intentos, 1 solo envío)');
select is((select count(*)::int from public.claim_notifications(10, 'wl', array[pg_temp.k('life2')])), 0, 'G12: y ya no se vuelve a tomar (sin duplicados)');

-- ═══ H. Lo que hace el administrador con el registro ════════════════════════════════════════
delete from public.notification_outbox;
select pg_temp.keep('hs', pg_temp.mkn('h-s', 'order_shipped', p_status => 'sent', p_profile => 1, p_order => 1, p_recipient => 'u01.s13@test.com'));
select is((public.admin_notification_resend(pg_temp.k('hs')) ->> 'outcome'), 'queued', 'H1: el administrador reenvía un aviso ya enviado');
select is((select dedupe_key || '|' || status || '|' || attempts || '|' || resent_of || '|' || (created_by = pg_temp.ad(1))::text || '|' || (payload ->> 'resend') || '|' || recipient || '|' || (profile_id = pg_temp.u(1))::text || '|' || (order_id = pg_temp.o(1))::text
             from public.notification_outbox where resent_of = pg_temp.k('hs') order by id limit 1),
          'h-s:r1|pending|0|' || pg_temp.k('hs') || '|true|true|u01.s13@test.com|true|true', 'H1: es una fila NUEVA (clave …:r1, pendiente, con quién la pidió); copia destinatario, clienta y pedido');
select is(pg_temp.nst(pg_temp.k('hs')), 'sent', 'H1: y el original queda como está (el historial no se reescribe)');
select is((public.admin_notification_resend(pg_temp.k('hs')) ->> 'outcome'), 'queued', 'H2: reenviar otra vez');
select is((select string_agg(dedupe_key, ',' order by id) from public.notification_outbox where resent_of = pg_temp.k('hs')), 'h-s:r1,h-s:r2', 'H2: la segunda copia es :r2');
update public.notification_outbox set status = 'failed' where dedupe_key = 'h-s:r1';
select is((public.admin_notification_resend((select id from public.notification_outbox where dedupe_key = 'h-s:r1')) ->> 'outcome'), 'queued', 'H3: reenviar una copia fallida');
select is((select dedupe_key || '|' || resent_of from public.notification_outbox where id = (select max(id) from public.notification_outbox)), 'h-s:r3|' || pg_temp.k('hs'),
          'H3: cuelga del aviso original (…:r3), no de la copia: un solo hilo de reenvíos');
select is((public.admin_notification_resend((select id from public.notification_outbox where dedupe_key = 'h-s:r2')) ->> 'outcome'), 'in_progress', 'H4: reenviar uno que aún está pendiente no duplica');
select is((select count(*)::int from public.notification_outbox where resent_of = pg_temp.k('hs')), 3, 'H4: siguen siendo 3 copias');
update public.notification_outbox set status = 'sending' where dedupe_key = 'h-s:r2';
select is((public.admin_notification_resend((select id from public.notification_outbox where dedupe_key = 'h-s:r2')) ->> 'outcome'), 'in_progress', 'H4: ni uno que se está enviando ahora');
select is((public.admin_notification_resend(-5) ->> 'outcome'), 'not_found', 'H5: un aviso que no existe');
-- WhatsApp manual
select pg_temp.keep('hm', pg_temp.mkn('h-m', 'order_shipped', 'whatsapp', '+5917300003', 'manual', p_profile => 3));
select is((public.admin_notification_mark_sent(pg_temp.k('hm')) ->> 'outcome'), 'sent', 'H6: el administrador marca como enviado el WhatsApp que mandó a mano');
select is((select status || '|' || provider || '|' || (sent_by = pg_temp.ad(1))::text || '|' || (sent_at = now())::text from public.notification_outbox where id = pg_temp.k('hm')),
          'sent|whatsapp_manual|true|true', 'H6: queda constancia de quién y cuándo');
select is((public.admin_notification_mark_sent(pg_temp.k('hm')) ->> 'outcome') || '|' || (public.admin_notification_mark_sent(pg_temp.k('hm')) ->> 'status'), 'not_manual|sent', 'H6: no se marca dos veces');
select pg_temp.keep('hp', pg_temp.mkn('h-p', 'order_shipped'));
select is((public.admin_notification_mark_sent(pg_temp.k('hp')) ->> 'outcome'), 'not_manual', 'H6: un correo pendiente no se marca como «enviado a mano»');
select is((public.admin_notification_mark_sent(-5) ->> 'outcome'), 'not_found', 'H6: id inexistente');
-- Descartar
select is((public.admin_notification_cancel(pg_temp.k('hp')) ->> 'outcome'), 'cancelled', 'H7: descartar un aviso pendiente');
select is((select status || '|' || last_error || '|' || (sent_by = pg_temp.ad(1))::text from public.notification_outbox where id = pg_temp.k('hp')), 'cancelled|cancelled_by_admin|true', 'H7: con quién lo descartó');
select pg_temp.keep('hm2', pg_temp.mkn('h-m2', 'order_shipped', 'whatsapp', '+5917300003', 'manual'));
select is((public.admin_notification_cancel(pg_temp.k('hm2')) ->> 'outcome'), 'cancelled', 'H7: también uno de WhatsApp por enviar');
select is((public.admin_notification_cancel(pg_temp.k('hs')) ->> 'outcome') || '|' || (public.admin_notification_cancel(pg_temp.k('hs')) ->> 'status'), 'not_cancellable|sent', 'H7: uno ya enviado no se descarta');
select is((public.admin_notification_cancel(-5) ->> 'outcome'), 'not_found', 'H7: id inexistente');
-- Totales (cola vacía + filas conocidas)
delete from public.notification_outbox;
select pg_temp.mkn('c-1'); select pg_temp.mkn('c-2');
select pg_temp.mkn('c-3', p_status => 'sent'); select pg_temp.mkn('c-4', p_status => 'dead'); select pg_temp.mkn('c-5', p_status => 'manual');
select is(public.admin_notification_counts(), '{"pending": 2, "sent": 1, "dead": 1, "manual": 1}'::jsonb, 'H8: los totales por estado (2 pendientes, 1 enviado, 1 perdido, 1 manual)');
-- Salud del envío
select is((public.admin_notification_health() ->> 'enabled') || '|' || (public.admin_notification_health() ->> 'email_provider') || '|' || (public.admin_notification_health() ->> 'from_email_set')
          || '|' || (public.admin_notification_health() ->> 'whatsapp_mode'), 'true|none|false|manual', 'H9: salud: encendido, proveedor «none», sin remitente, WhatsApp manual');
select is((public.admin_notification_health() ->> 'due')::int, 2, 'H9: 2 avisos vencidos esperando');
select is(jsonb_typeof(public.admin_notification_health() -> 'worker_configured'), 'boolean', 'H9: dice si el worker está configurado (sin revelar secretos)');
select is((public.admin_notification_health() ->> 'oldest_due_minutes')::int, 0, 'H9: el más viejo lleva menos de un minuto');
update public.notification_outbox set next_retry_at = now() - interval '95 minutes' where dedupe_key = 'c-1';
select is((public.admin_notification_health() ->> 'oldest_due_minutes')::int, 95, 'H9: un aviso vencido hace 95 minutos se informa como 95');
delete from public.notification_outbox where status = 'pending';
select is(public.admin_notification_health() -> 'oldest_due_minutes', 'null'::jsonb, 'H9: sin vencidos, nulo');
select ok((public.admin_notification_health() ->> 'recipients')::int >= 2, 'H9: cuenta los destinatarios de alertas (al menos los 2 administradores de la prueba)');
select is(public.admin_notification_health() -> 'last_sent_at', 'null'::jsonb, 'H9: y que nada se envió de verdad (los de WhatsApp manual no cuentan)');
select pg_temp.as_(pg_temp.u(1));
select is(pg_temp.denied($$select public.admin_notification_resend(1)$$), '42501:solo administradores', 'H10: la clienta no reenvía');
select is(pg_temp.denied($$select public.admin_notification_mark_sent(1)$$), '42501:solo administradores', 'H10: ni marca enviados');
select is(pg_temp.denied($$select public.admin_notification_cancel(1)$$), '42501:solo administradores', 'H10: ni descarta');
select is(pg_temp.denied($$select public.admin_notification_counts()$$), '42501:solo administradores', 'H10: ni ve los totales');
select is(pg_temp.denied($$select public.admin_notification_health()$$), '42501:solo administradores', 'H10: ni la salud del envío');
select pg_temp.as_(pg_temp.ad(1));

-- ═══ I. Quién recibe las alertas internas ═════════════════════════════════════════════════
select ok(public.alert_recipients() @> array['admin1.s13@test.com', 'admin2.s13@test.com'], 'I1: sin configurar, todos los administradores activos');
select ok(not (public.alert_recipients() && array['u01.s13@test.com', 'u02.s13@test.com']), 'I1: …y ninguna clienta');
update public.store_settings set value = '"b@x.co, A@X.co, a@x.co,  "' where key = 'alert_recipients';
select is(public.alert_recipients(), array['a@x.co', 'b@x.co'], 'I2: la lista configurada manda: en minúsculas, sin repetidos ni vacíos, ordenada');
update public.store_settings set value = '""' where key = 'alert_recipients';
update public.profiles set is_active = false where id = pg_temp.ad(2);
select ok(public.alert_recipients() @> array['admin1.s13@test.com'] and not (public.alert_recipients() @> array['admin2.s13@test.com']), 'I3: un administrador desactivado deja de recibirlas');
update public.profiles set is_active = true where id = pg_temp.ad(2);

-- ═══ J. Alerta por avisos de pago con firma inválida ═════════════════════════════════════
delete from public.notification_outbox;
insert into public.webhook_events (provider, event_id, signature_valid, payload) values ('qr_api', 'j-evt-1', false, '{}');
select is((select count(*)::int from public.notification_outbox where type = 'webhook_signature_invalid'), 1, 'J1: un aviso con firma inválida alerta a los administradores');
select is((select dedupe_key || '|' || coalesce(recipient, '∅') || '|' || (payload ->> 'provider') from public.notification_outbox where type = 'webhook_signature_invalid'),
          'webhook_signature_invalid:qr_api:' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24') || '|∅|qr_api', 'J1: una por proveedor y por hora');
insert into public.webhook_events (provider, event_id, signature_valid, payload) values ('qr_api', 'j-evt-2', false, '{}'), ('qr_api', 'j-evt-3', false, '{}');
select is((select count(*)::int from public.notification_outbox where type = 'webhook_signature_invalid'), 1, 'J2: si insisten en la misma hora, NO hay más alertas (sin ruido)');
insert into public.webhook_events (provider, event_id, signature_valid, payload) values ('otro', 'j-evt-4', true, '{}');
select is((select count(*)::int from public.notification_outbox where type = 'webhook_signature_invalid'), 1, 'J3: un aviso con firma válida no alerta');
insert into public.webhook_events (provider, event_id, signature_valid, payload) values ('otro', 'j-evt-5', false, '{}');
select is((select count(*)::int from public.notification_outbox where type = 'webhook_signature_invalid'), 2, 'J4: otro proveedor sí tiene su propia alerta');

-- ═══ K. Cuenta desactivada o anonimizada ═════════════════════════════════════════════════
delete from public.notification_outbox;
select pg_temp.keep('k1', pg_temp.mkn('k-pen', p_profile => 7, p_recipient => 'u07.s13@test.com'));
select pg_temp.keep('k2', pg_temp.mkn('k-man', 'order_shipped', 'whatsapp', '+5917300007', 'manual', p_profile => 7));
select pg_temp.keep('k3', pg_temp.mkn('k-sent', p_status => 'sent', p_profile => 7, p_recipient => 'u07.s13@test.com'));
select pg_temp.keep('k4', pg_temp.mkn('k-snd', p_status => 'sending', p_profile => 7, p_recipient => 'u07.s13@test.com'));
select pg_temp.keep('k5', pg_temp.mkn('k-adm', 'order_new', p_recipient => null));
select pg_temp.keep('k6', pg_temp.mkn('k-other', p_profile => 8, p_recipient => 'u08.s13@test.com'));
update public.profiles set is_active = false where id = pg_temp.u(7);
select is((select string_agg(status || '|' || coalesce(last_error, '∅'), ' ; ' order by id) from public.notification_outbox where profile_id = pg_temp.u(7)),
          'cancelled|account_inactive ; cancelled|account_inactive ; sent|∅ ; sending|∅', 'K1: al desactivar la cuenta, lo pendiente y lo manual se cancelan; lo enviado y lo que está en vuelo no se tocan');
select is(pg_temp.nst(pg_temp.k('k6')) || '|' || pg_temp.nst(pg_temp.k('k5')), 'pending|pending', 'K1: nadie más se ve afectado');
update public.profiles set is_active = true where id = pg_temp.u(7);
select is(pg_temp.nst(pg_temp.k('k1')), 'cancelled', 'K2: reactivar la cuenta no resucita lo cancelado');
select pg_temp.keep('k7', pg_temp.mkn('k-pen2', p_profile => 7, p_recipient => 'u07.s13@test.com'));
update public.profiles set anonymized_at = now() where id = pg_temp.u(7);
select is((select count(*)::int from public.notification_outbox where profile_id = pg_temp.u(7) and recipient = '[anonimizado]'), 5, 'K3: al anonimizar, el destinatario se borra de TODO el registro de esa cuenta (5 filas)');
select is(pg_temp.nst(pg_temp.k('k7')), 'cancelled', 'K3: y lo que quedaba pendiente se cancela');
select is((select count(*)::int from public.notification_outbox where profile_id = pg_temp.u(7) and recipient like '%u07%'), 0, 'K3: ninguna fila conserva su correo');
select is(pg_temp.nst(pg_temp.k('k3')), 'sent', 'K3: lo enviado sigue siendo un registro de lo que pasó (solo se borra el destinatario)');
select is((select recipient from public.notification_outbox where id = pg_temp.k('k6')), 'u08.s13@test.com', 'K3: el destinatario de otra cuenta, intacto');
select is((select count(*)::int from public.notification_outbox where recipient is null and profile_id is null), 1, 'K3: la alerta interna sigue sin destinatario concreto (no se confunde con una anonimizada)');
update public.profiles set anonymized_at = null where id = pg_temp.u(7);

-- ═══ L. Preferencias de la clienta (RLS) y consentimiento auditado (BR-LEG-01) ══════════════════
-- u04 ya tiene su fila (prefiere WhatsApp). u01 crea la suya; nadie ve ni toca la de otra.
select pg_temp.as_(pg_temp.u(1));
set local role authenticated;
select lives_ok($$insert into public.notification_preferences (profile_id, preferred_channel, marketing_email) values ('a7000000-0000-0000-0000-000000000001', 'email', true)$$,
        'L1: la clienta crea sus preferencias');
select is((select marketing_email::text || '|' || (marketing_consent_at is not null)::text from public.notification_preferences where profile_id = 'a7000000-0000-0000-0000-000000000001'),
          'true|true', 'L2: al aceptar marketing queda la fecha del consentimiento');
select throws_ok($$insert into public.notification_preferences (profile_id) values ('a7000000-0000-0000-0000-000000000002')$$, '42501', null, 'L3: no crea las de otra clienta');
select is((select count(*)::int from public.notification_preferences), 1, 'L4: solo ve la suya (la de u04 existe pero no es suya)');
update public.notification_preferences set marketing_email = false, marketing_whatsapp = false where profile_id = 'a7000000-0000-0000-0000-000000000001';
select is((select (marketing_consent_at is null)::text from public.notification_preferences), 'true', 'L5: al retirar todo el marketing, el consentimiento se borra');
update public.notification_preferences set marketing_whatsapp = true where profile_id = 'a7000000-0000-0000-0000-000000000001';
select is((select marketing_whatsapp::text || '|' || (marketing_consent_at is not null)::text from public.notification_preferences), 'true|true', 'L6: aceptar WhatsApp de marketing vuelve a fechar el consentimiento');
select throws_ok($$update public.notification_preferences set preferred_channel = 'sms'$$, '23514', null, 'L7: un canal inventado no entra');
select throws_ok($$update public.notification_preferences set profile_id = 'a7000000-0000-0000-0000-000000000002'$$, '42501', null, 'L8: no se puede mudar la fila a otra clienta');
select throws_ok($$update public.notification_preferences set marketing_consent_at = now() - interval '5 years'$$, '42501', null, 'L9: la fecha del consentimiento no se escribe a mano');
update public.notification_preferences set preferred_channel = 'email' where profile_id = 'a7000000-0000-0000-0000-000000000004';
select throws_ok($$delete from public.notification_preferences$$, '42501', null, 'L11: ni borra');
reset role;
select is((select preferred_channel from public.notification_preferences where profile_id = 'a7000000-0000-0000-0000-000000000004'), 'whatsapp',
          'L10: la preferencia de otra clienta NO cambió (RLS: su fila ni se ve, el UPDATE tocó 0 filas)');
select pg_temp.as_(pg_temp.u(2));
set local role authenticated;
select is((select count(*)::int from public.notification_preferences), 0, 'L12: otra clienta no ve las preferencias de u01 ni de u04');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.notification_preferences$$, '42501', null, 'L13: anon no lee preferencias');
reset role;
select pg_temp.as_(pg_temp.ad(1));
set local role authenticated;
select ok((select count(*) from public.notification_preferences) >= 2, 'L14: el administrador sí las lee');
update public.notification_preferences set marketing_email = true where profile_id = 'a7000000-0000-0000-0000-000000000004';
reset role;
select is((select marketing_email from public.notification_preferences where profile_id = 'a7000000-0000-0000-0000-000000000004'), false, 'L15: …pero NO las cambia por la clienta (su consentimiento sigue apagado)');
-- Auditoría: quién consintió, qué y cuándo
select ok((select count(*) from public.audit_log where table_name = 'notification_preferences' and record_id = 'a7000000-0000-0000-0000-000000000001') >= 3,
          'L16: crear, retirar y volver a aceptar quedan en la auditoría de u01 (3 como mínimo)');
select ok(exists (select 1 from public.audit_log where table_name = 'notification_preferences' and record_id = 'a7000000-0000-0000-0000-000000000001'
                     and action = 'UPDATE' and actor_id = pg_temp.u(1) and diff -> 'marketing_email' = '{"old": true, "new": false}'::jsonb),
          'L16: con quién (la propia clienta) y qué cambió (marketing por correo: de sí a no)');

-- ═══ M. Permisos ═══════════════════════════════════════════════════════════════════════════
delete from public.notification_outbox;
select pg_temp.mkn('m-1', p_profile => 1, p_recipient => 'u01.s13@test.com');
select is((select count(*)::int from unnest(array['public.claim_notifications(int, text, bigint[], text[])', 'public.complete_notification(bigint, text, text, text, text, text, int, text, text)',
                                                  'public.alert_recipients()', 'public.setting_text(text, text)']) f
            where has_function_privilege('service_role', f::regprocedure, 'execute') and not has_function_privilege('anon', f::regprocedure, 'execute')
              and not has_function_privilege('authenticated', f::regprocedure, 'execute')), 4,
          'M1: tomar y cerrar envíos, leer los destinatarios de alertas y los textos de ajustes: solo service_role');
select is((select coalesce(string_agg(f, ', ' order by f), '') from unnest(array['public._notify_target(uuid)',
            'public._enqueue_notification_ex(text, text, text, jsonb, text, uuid, uuid, timestamptz)', 'public._order_notify(uuid, text, text, text, jsonb)',
            'public._notification_status_rank(text)', 'public._notification_stale_reason(public.notification_outbox)',
            'public._notification_settle(bigint, text, text, text, text, int, text, text)', 'public.notify_worker_kick()', 'public.notification_backoff_seconds(int, int)',
            'public.notification_template_validate()', 'public.notification_preferences_guard()', 'public.notification_outbox_link()',
            'public.store_settings_validate_s13()', 'public.webhook_events_alert()', 'public.profiles_notification_cleanup()']) f
            where has_function_privilege('anon', f::regprocedure, 'execute') or has_function_privilege('authenticated', f::regprocedure, 'execute')
               or has_function_privilege('service_role', f::regprocedure, 'execute')), '',
          'M2: las 14 funciones internas no las ejecuta anon, authenticated ni service_role');
select is((select count(*)::int from unnest(array['public.admin_notification_resend(bigint)', 'public.admin_notification_mark_sent(bigint)', 'public.admin_notification_cancel(bigint)',
                                                  'public.admin_notification_counts()', 'public.admin_notification_health()']) f
            where has_function_privilege('authenticated', f::regprocedure, 'execute') and not has_function_privilege('anon', f::regprocedure, 'execute')
              and not has_function_privilege('service_role', f::regprocedure, 'execute')), 5,
          'M3: las 5 funciones del administrador las ejecuta authenticated (y adentro exigen ser admin), no anon ni service_role');
-- La cola: nadie del navegador la lee ni la escribe, salvo el administrador que la LEE
select pg_temp.as_(pg_temp.u(1));
set local role authenticated;
select is((select count(*)::int from public.notification_outbox), 0, 'M4: la clienta no ve ni sus propios avisos (la cola es interna)');
select throws_ok($$insert into public.notification_outbox (type, channel, dedupe_key) values ('x', 'email', 'm-ins')$$, '42501', null, 'M4: ni escribe');
select throws_ok($$update public.notification_outbox set status = 'sent'$$, '42501', null, 'M4: ni cambia estados');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.notification_outbox$$, '42501', null, 'M5: anon no lee la cola');
reset role;
select pg_temp.as_(pg_temp.ad(1));
set local role authenticated;
select ok((select count(*) from public.notification_outbox) >= 1, 'M6: el administrador lee la cola');
select throws_ok($$insert into public.notification_outbox (type, channel, dedupe_key) values ('x', 'email', 'm-adm')$$, '42501', null, 'M6: …pero no escribe directo (solo por las funciones)');
select throws_ok($$update public.notification_outbox set status = 'sent'$$, '42501', null, 'M6: ni cambia estados');
select throws_ok($$delete from public.notification_outbox$$, '42501', null, 'M6: ni borra');
reset role;
set local role service_role;
select lives_ok($$update public.notification_outbox set last_error = 'x' where dedupe_key = 'm-1'$$, 'M7: service_role (el worker) sí actualiza');
select throws_ok($$delete from public.notification_outbox$$, '42501', null, 'M7: pero nadie borra: queda el rastro');
reset role;
-- Privilegios EXACTOS del worker (service_role): las tablas nuevas nacen con INSERT/UPDATE por los privilegios por omisión de Supabase y se
-- cierran a propósito; el worker solo LEE plantillas y no toca las preferencias de nadie.
select is((select bool_or(has_table_privilege('service_role', 'public.notification_templates', priv)) from unnest(array['insert', 'update', 'delete', 'truncate']) priv), false,
          'M8: service_role NO tiene INSERT, UPDATE, DELETE ni TRUNCATE sobre las plantillas (solo las lee)');
select is((select bool_or(has_table_privilege('service_role', 'public.notification_preferences', priv)) from unnest(array['insert', 'update', 'delete', 'truncate']) priv), false,
          'M8: ni sobre las preferencias de la clienta');
select is(has_table_privilege('service_role', 'public.notification_templates', 'select'), true, 'M8: pero sí las lee (el worker las necesita)');
-- Las plantillas: solo el administrador
select pg_temp.as_(pg_temp.u(1));
set local role authenticated;
select is((select count(*)::int from public.notification_templates), 0, 'M8: la clienta no ve las plantillas');
update public.notification_templates set body = 'hackeado';
reset role;
select is((select count(*)::int from public.notification_templates where body = 'hackeado'), 0, 'M8: ni las edita (RLS: el UPDATE tocó 0 filas)');
set local role anon;
select throws_ok($$select count(*) from public.notification_templates$$, '42501', null, 'M8: anon tampoco las lee');
reset role;
select pg_temp.as_(pg_temp.ad(1));
set local role authenticated;
select ok((select count(*) from public.notification_templates) = 36, 'M9: el administrador ve las 36');
select lives_ok($$update public.notification_templates set body = 'Hola {{customer_name}}' where key = 'order_delivered' and channel = 'whatsapp'$$, 'M9: y edita');
select throws_ok($$update public.notification_templates set key = 'otra' where key = 'order_delivered' and channel = 'whatsapp'$$, '42501', null, 'M9: pero no cambia su clave (solo asunto, cuerpo, botón y si está activa)');
select throws_ok($$delete from public.notification_templates$$, '42501', null, 'M9: ni las borra (se desactivan)');
reset role;
set local role service_role;
select lives_ok($$select count(*) from public.notification_templates$$, 'M10: service_role (el worker) las lee');
select throws_ok($$update public.notification_templates set body = 'x'$$, '42501', null, 'M10: pero no las escribe');
reset role;
-- Los ajustes de notificación (incluida la lista de correos de las alertas) no son públicos
select pg_temp.as_(pg_temp.u(1));
set local role authenticated;
select is((select count(*)::int from public.store_settings where key like 'notify\_%' or key = 'alert_recipients'), 0, 'M11: la clienta no lee los ajustes de notificación (ni los correos de las alertas)');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.store_settings$$, '42501', null, 'M11: anon tampoco (ni siquiera tiene acceso a la tabla de ajustes)');
reset role;
select pg_temp.as_(pg_temp.ad(1));

-- ═══ N. El cron y el aviso al worker ═══════════════════════════════════════════════════════
select is((select count(*)::int from cron.job where jobname = 'notify-worker' and schedule = '* * * * *' and command like '%notify_worker_kick%'), 1, 'N1: el cron «notify-worker» corre cada minuto');
delete from public.notification_outbox;
select is(public.notify_worker_kick(), 'idle', 'N2: sin nada que enviar no llama al worker');
select pg_temp.mkn('n-due');
update public.store_settings set value = 'false' where key = 'notify_enabled';
select is(public.notify_worker_kick(), 'disabled', 'N3: con las notificaciones apagadas, tampoco');
update public.store_settings set value = 'true' where key = 'notify_enabled';
select pg_temp.mkn('n-later', p_due => interval '1 hour');
delete from public.notification_outbox where dedupe_key = 'n-due';
select is(public.notify_worker_kick(), 'idle', 'N4: un aviso que aún no toca no despierta al worker');
select pg_temp.mkn('n-due2');
-- Sin los secretos del Vault no llama a nadie (si el dueño ya los puso, no se invoca para no disparar una llamada real desde la prueba)
select is(case when (select count(*) from vault.decrypted_secrets where name in ('notify_worker_url', 'notify_worker_key')) < 2 then public.notify_worker_kick() else 'not_configured' end,
          'not_configured', 'N5: con un aviso vencido pero sin la URL y la clave del worker en el Vault, no hace nada (y el panel lo avisa)');

-- ═══ O. El encolado de S3 sigue como antes ═══════════════════════════════════════════════════
delete from public.notification_outbox;
select is(public.enqueue_notification('probe_type', 'email', 'p@test.com', '{"a": 1}', 'o-1') is not null, true, 'O1: enqueue_notification (S3) encola');
select is(public.enqueue_notification('probe_type', 'email', 'p@test.com', '{"a": 2}', 'o-1'), null::bigint, 'O1: repetir la clave devuelve NULL y no duplica');
select is((select template || '|' || status || '|' || attempts || '|' || (order_id is null)::text || '|' || (profile_id is null)::text from public.notification_outbox where dedupe_key = 'o-1'),
          'probe_type|pending|0|true|true', 'O2: la plantilla es el tipo; sin pedido ni clienta enlazados si no hay con qué');
select is((select payload from public.notification_outbox where dedupe_key = 'o-1'), '{"a": 1}'::jsonb, 'O2: el segundo intento no pisó el contenido');
select public.enqueue_notification('probe_order', 'email', 'p@test.com', jsonb_build_object('order_id', pg_temp.o(1)), 'o-2');
select is((select (order_id = pg_temp.o(1))::text || '|' || (profile_id = pg_temp.u(1))::text from public.notification_outbox where dedupe_key = 'o-2'), 'true|true',
          'O3: si el contenido trae un pedido, se enlaza al pedido y a su clienta');
select public.enqueue_notification('probe_order', 'email', null, jsonb_build_object('order_id', pg_temp.o(1)), 'o-3');
select is((select (order_id = pg_temp.o(1))::text || '|' || (profile_id is null)::text from public.notification_outbox where dedupe_key = 'o-3'), 'true|true',
          'O3: …pero una alerta interna (sin destinatario) no se enlaza a la clienta');
select public.enqueue_notification('probe_order', 'email', 'p@test.com', '{"order_id": "no-es-un-uuid"}', 'o-4');
select is((select (order_id is null)::text from public.notification_outbox where dedupe_key = 'o-4'), 'true', 'O4: un order_id que no es un uuid no rompe el encolado');

select * from finish();
rollback;
