-- Sprint 15 · Fase E — Canal de reclamos: el plazo de respuesta (ajuste), la tabla que nadie toca directo, `submit_complaint` (solo el
-- servicio; limpia y acota lo que llega; el cortafuegos de 100 por hora; la alerta al administrador que nunca impide registrar),
-- la bandeja del administrador (orden, filtros, urgencia), `admin_complaint_update` (la respuesta es obligatoria para «respondido») y la
-- auditoría SIN datos personales. Todo ocurre en una transacción que se revierte. HERMÉTICO: parte de cero dentro de la transacción.
--
-- Fixture: un administrador (u1) y dos clientas (u2, u3).
begin;
select plan(80);

create function pg_temp.u(n int) returns uuid language sql as $$ select ('a5000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.as_(p_uid uuid) returns void language sql as
  $$ select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p_uid), true) $$;
create function pg_temp.anon_() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"anon"}', true) $$;
create function pg_temp.h(c text) returns text language sql as $$ select repeat(c, 64) $$;
create function pg_temp.data(p_over jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('contact_name', 'Ana Pérez', 'contact_email', 'ana@example.com', 'kind', 'product',
                            'detail', 'La prenda llegó con una costura abierta y no es lo que pedí.') || p_over $$;
create temp table t_r (k text primary key, v jsonb);
create function pg_temp.g(p_k text) returns jsonb language sql as $$ select v from t_r where k = p_k $$;

delete from public.complaints;
delete from public.notification_outbox where type = 'complaint_new';
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  (pg_temp.u(1), 'admin.s15r@test.com', '{"full_name":"Admin S15R"}', 'authenticated', 'authenticated'),
  (pg_temp.u(2), 'c1.s15r@test.com', '{"full_name":"Clienta Uno S15R"}', 'authenticated', 'authenticated'),
  (pg_temp.u(3), 'c2.s15r@test.com', '{"full_name":"Clienta Dos S15R"}', 'authenticated', 'authenticated');
select public.set_user_role(pg_temp.u(1), 'admin');
select pg_temp.as_(pg_temp.u(1));

-- ═══ A. Estructura y permisos ═════════════════════════════════════════════════════════════
select is((select c.relrowsecurity from pg_class c where c.oid = 'public.complaints'::regclass), true, 'A1: complaints tiene RLS activa');
select is((select count(*)::int from information_schema.role_table_grants g
            where g.table_schema = 'public' and g.table_name = 'complaints' and g.grantee in ('anon', 'authenticated', 'service_role')), 0,
          'A2: ni anon, ni authenticated, ni service_role tocan la tabla (solo las funciones)');
select is((select count(*)::int from information_schema.role_usage_grants g where g.object_name = 'complaints_number_seq'
            and g.grantee in ('anon', 'authenticated', 'service_role')), 0, 'A3: ni la secuencia del número');
select is((select has_function_privilege('service_role', 'public.submit_complaint(jsonb, uuid, text)', 'execute')
              and not has_function_privilege('anon', 'public.submit_complaint(jsonb, uuid, text)', 'execute')
              and not has_function_privilege('authenticated', 'public.submit_complaint(jsonb, uuid, text)', 'execute')), true,
          'A4: registrar un reclamo lo ejecuta SOLO el servicio (la función `complaint` valida y limita antes)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('admin_complaints', 'admin_complaint_update', 'admin_complaints_summary')
              and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
              and not has_function_privilege('service_role', p.oid, 'execute')), 3, 'A5: las 3 de la bandeja las ejecuta authenticated (y adentro exigen ser admin)');
select is((select has_function_privilege('authenticated', 'public._complaint_text(jsonb, text, boolean)', 'execute')
              or has_function_privilege('service_role', 'public._complaint_text(jsonb, text, boolean)', 'execute')), false, 'A6: la función de limpieza es interna');

-- ═══ B. El plazo de respuesta ═════════════════════════════════════════════════════════════
select is((select value #>> '{}' || '/' || is_public::text from public.store_settings where key = 'complaints_response_days'), '10/true', 'B1: nace en 10 días y es público (el formulario lo muestra)');
select lives_ok($$update public.store_settings set value = '1' where key = 'complaints_response_days'$$, 'B2: 1 día se acepta');
select lives_ok($$update public.store_settings set value = '60' where key = 'complaints_response_days'$$, 'B3: y 60');
select throws_ok($$update public.store_settings set value = '0' where key = 'complaints_response_days'$$, '22023', null, 'B4: 0 se rechaza');
select throws_ok($$update public.store_settings set value = '61' where key = 'complaints_response_days'$$, '22023', null, 'B5: 61 también');
select throws_ok($$update public.store_settings set value = '"10"' where key = 'complaints_response_days'$$, '22023', null, 'B6: un texto no es un número');
select throws_ok($$update public.store_settings set value = '5.5' where key = 'complaints_response_days'$$, '22023', null, 'B7: ni un decimal');
select lives_ok($$update public.store_settings set value = '10' where key = 'complaints_response_days'$$, 'B8: se deja en 10');

-- ═══ C. submit_complaint ══════════════════════════════════════════════════════════════════
select pg_temp.anon_();
select pg_temp.as_(pg_temp.u(1));
select pg_temp.anon_();
select pg_temp.as_(pg_temp.u(1));
insert into t_r select 'c1', public.submit_complaint(pg_temp.data(), null, pg_temp.h('a'));
select matches((select v ->> 'number' from t_r where k = 'c1'), '^REC-[0-9]{6,}$', 'C3: el reclamo lleva su número REC-000123');
select is((select status || '|' || kind || '|' || coalesce(profile_id::text, '-') || '|' || ip_hash from public.complaints where id = (pg_temp.g('c1') ->> 'id')::uuid),
          'new|product|-|' || pg_temp.h('a'), 'C4: nace «nuevo», sin cuenta (anónimo), con la huella de la red (nunca la IP)');
select ok((select due_at between now() + interval '9 days 23 hours' and now() + interval '10 days 1 hour' from public.complaints where id = (pg_temp.g('c1') ->> 'id')::uuid), 'C5: el plazo es de 10 días');
select is((select (pg_temp.g('c1') ->> 'due_at')::timestamptz = due_at from public.complaints where id = (pg_temp.g('c1') ->> 'id')::uuid), true, 'C6: y la respuesta devuelve el mismo plazo');
insert into t_r select 'c2', public.submit_complaint(pg_temp.data('{"contact_name":" Luis \u0007Mamani ","contact_email":"  LUIS@Example.COM ","order_number":" mic-000123 ","detail":"Línea uno del reclamo.\nLínea dos del reclamo.\u0001\u0008"}'), pg_temp.u(2), null);
select is((select contact_name || '|' || contact_email || '|' || order_number || '|' || profile_id::text from public.complaints where id = (pg_temp.g('c2') ->> 'id')::uuid),
          'Luis Mamani|luis@example.com|MIC-000123|' || pg_temp.u(2)::text, 'C7: se limpia (sin controles ni espacios), el correo en minúsculas, el pedido en mayúsculas, y guarda la cuenta si la hay');
select is((select detail from public.complaints where id = (pg_temp.g('c2') ->> 'id')::uuid), E'Línea uno del reclamo.\nLínea dos del reclamo.', 'C8: el detalle conserva los saltos de línea pero no los caracteres de control');
select is((select (v ->> 'number')::text from t_r where k = 'c2'), (select 'REC-' || lpad((substring(pg_temp.g('c1') ->> 'number' from 5)::int + 1)::text, 6, '0')), 'C9: los números son correlativos');
select lives_ok(format($$select public.submit_complaint(%L::jsonb, null, null)$$, pg_temp.data('{"contact_email":null,"contact_phone":"+59171234567"}')), 'C10: basta el teléfono (sin correo)');
select throws_ok(format($$select public.submit_complaint(%L::jsonb, null, null)$$, pg_temp.data('{"contact_email":null}')), '23514', null, 'C11: sin correo NI teléfono no hay cómo responder: se rechaza');
select throws_ok(format($$select public.submit_complaint(%L::jsonb, null, null)$$, pg_temp.data('{"kind":"queja"}')), '23514', null, 'C12: un tipo que no existe se rechaza');
select throws_ok(format($$select public.submit_complaint(%L::jsonb, null, null)$$, pg_temp.data('{"detail":"muy corto"}')), '23514', null, 'C13: un detalle de menos de 20 caracteres se rechaza');
select throws_ok(format($$select public.submit_complaint(%L::jsonb, null, null)$$, pg_temp.data(jsonb_build_object('detail', repeat('x', 2001)))), '23514', null, 'C14: y uno de más de 2000');
select throws_ok(format($$select public.submit_complaint(%L::jsonb, null, null)$$, pg_temp.data('{"contact_email":"no-es-correo"}')), '23514', null, 'C15: un correo inválido');
select throws_ok(format($$select public.submit_complaint(%L::jsonb, null, null)$$, pg_temp.data('{"contact_email":null,"contact_phone":"71234567"}')), '23514', null, 'C16: un teléfono sin código de país');
select throws_ok(format($$select public.submit_complaint(%L::jsonb, null, null)$$, pg_temp.data('{"order_number":"pedido uno"}')), '23514', null, 'C17: un número de pedido con formato raro');
select throws_ok(format($$select public.submit_complaint(%L::jsonb, null, null)$$, pg_temp.data('{"contact_name":5}')), '23502', null, 'C18: un nombre que no es texto se trata como vacío (obligatorio)');
select throws_ok($$select public.submit_complaint('[1]'::jsonb, null, null)$$, '22023', 'invalid_data', 'C19: los datos tienen que ser un objeto');
select throws_ok(format($$select public.submit_complaint(%L::jsonb, null, 'no-es-hash')$$, pg_temp.data()), '23514', null, 'C20: la huella tiene que ser un SHA-256');

-- La alerta al administrador (S13)
select is((select count(*)::int from public.notification_outbox o where o.type = 'complaint_new' and o.dedupe_key = 'complaint_new:' || (pg_temp.g('c1') ->> 'id')), 1, 'C21: cada reclamo encola UNA alerta para los administradores');
select is((select o.channel || '|' || coalesce(o.recipient, '-') || '|' || (o.payload ->> 'complaint_number') || '|' || (o.payload ->> 'kind')
             from public.notification_outbox o where o.dedupe_key = 'complaint_new:' || (pg_temp.g('c1') ->> 'id')),
          'email|-|' || (pg_temp.g('c1') ->> 'number') || '|product', 'C22: por correo, sin destinatario fijo (los administradores), con el número y el tipo');
select is((select (o.payload::text ~* '(ana@example|costura|Pérez)') from public.notification_outbox o where o.dedupe_key = 'complaint_new:' || (pg_temp.g('c1') ->> 'id')), false, 'C23: la alerta NO lleva datos personales ni el detalle');
select is((select count(*)::int from public.notification_outbox o where o.type like 'complaint%' and o.profile_id is not null), 0, 'C24: y a quien reclama NO se le escribe automáticamente (el formulario es público: sería un relevo)');
select is((select count(*)::int from public.notification_templates where key = 'complaint_new' and audience = 'admin' and channel = 'email' and active), 1, 'C25: la plantilla de la alerta existe, activa y editable');

-- El plazo sale del AJUSTE (no es un 10 fijo)
update public.store_settings set value = '3' where key = 'complaints_response_days';
insert into t_r select 'c4', public.submit_complaint(pg_temp.data('{"contact_name":"Plazo corto"}'), null, null);
update public.store_settings set value = '10' where key = 'complaints_response_days';
select ok((select due_at between now() + interval '2 days 23 hours' and now() + interval '3 days 1 hour' from public.complaints where id = (pg_temp.g('c4') ->> 'id')::uuid),
          'C29: con el ajuste en 3 días, el plazo del reclamo es de 3 días');

-- Caracteres de control: se quitan TODOS salvo el tabulador y el salto de línea del detalle
insert into t_r select 'c5', public.submit_complaint(pg_temp.data(jsonb_build_object('contact_name', E'Con\u000bVT\u001fUS\u007fDEL',
  'detail', E'Detalle con VT\u000b, FF\u000c, SO\u000e, US\u001f y DEL\u007f; y un tab\tconservado.\nLínea dos.')), null, null);
select is((select detail from public.complaints where id = (pg_temp.g('c5') ->> 'id')::uuid), E'Detalle con VT, FF, SO, US y DEL; y un tab\tconservado.\nLínea dos.',
          'C30: del detalle se quitan VT, FF, SO, US y DEL (también los de 0x0B a 0x1F y 0x7F) y se conservan el tabulador y los saltos de línea');
select is((select contact_name from public.complaints where id = (pg_temp.g('c5') ->> 'id')::uuid), 'ConVTUSDEL', 'C31: del nombre se quitan TODOS los caracteres de control');

-- Un fallo al encolar NO impide registrar el reclamo
create function pg_temp.boom() returns trigger language plpgsql as $$ begin raise exception 'cola caída'; end; $$;
create trigger t_boom before insert on public.notification_outbox for each row when (new.type = 'complaint_new') execute function pg_temp.boom();
insert into t_r select 'c3', public.submit_complaint(pg_temp.data('{"contact_name":"Sin cola"}'), null, null);
select is((select count(*)::int from public.complaints where contact_name = 'Sin cola'), 1, 'C26: si la cola de avisos falla, el reclamo igual queda registrado');
drop trigger t_boom on public.notification_outbox;

-- Cortafuegos: 100 por hora
insert into public.complaints (contact_name, contact_email, kind, detail, due_at, created_at)
  select 'Robot ' || i, 'r' || i || '@example.com', 'other', 'Un reclamo de relleno de más de veinte caracteres.', now() + interval '10 days', now() - interval '2 hours'
    from generate_series(1, 150) i;
select lives_ok(format($$select public.submit_complaint(%L::jsonb, null, null)$$, pg_temp.data()), 'C27: 150 reclamos de hace 2 horas NO cuentan para el cortafuegos');
insert into public.complaints (contact_name, contact_email, kind, detail, due_at)
  select 'Inundación ' || i, 'i' || i || '@example.com', 'other', 'Un reclamo de relleno de más de veinte caracteres.', now() + interval '10 days'
    from generate_series(1, 100) i;
select throws_ok(format($$select public.submit_complaint(%L::jsonb, null, null)$$, pg_temp.data()), '22023', 'too_many', 'C28: con 100 en la última hora se rechaza (alguien inunda el canal)');
delete from public.complaints where contact_name like 'Inundación %' or contact_name like 'Robot %';

-- ═══ D. La bandeja del administrador ══════════════════════════════════════════════════════
select pg_temp.as_(pg_temp.u(2));
select throws_ok($$select * from public.admin_complaints()$$, '42501', 'solo administradores', 'D1: una clienta no ve los reclamos');
select pg_temp.anon_();
select throws_ok($$select * from public.admin_complaints()$$, '42501', 'solo administradores', 'D2: ni sin sesión');
select pg_temp.as_(pg_temp.u(1));
select throws_ok($$select * from public.admin_complaints(null, -1, 10)$$, '22023', 'invalid_page', 'D3: una página negativa se rechaza');
select throws_ok($$select * from public.admin_complaints(null, 0, 201)$$, '22023', 'invalid_page', 'D4: y una de más de 200');
select throws_ok($$select * from public.admin_complaints('cualquiera', 0, 10)$$, '22023', 'invalid_status', 'D5: un estado que no existe');
-- Fixture de orden: A (nuevo, vence en 1 día), B (en revisión, vence en 5), C (nuevo, VENCIDO hace 1 día), D (respondido), E (cerrado)
delete from public.complaints;
insert into public.complaints (id, contact_name, contact_email, kind, detail, status, response, due_at, answered_at, created_at, profile_id) values
  ('c5000000-0000-0000-0000-00000000000a', 'A', 'a@example.com', 'product', 'Detalle de A con más de veinte caracteres.', 'new', null, now() + interval '1 day', null, now() - interval '9 days', null),
  ('c5000000-0000-0000-0000-00000000000b', 'B', 'b@example.com', 'delivery', 'Detalle de B con más de veinte caracteres.', 'in_review', null, now() + interval '5 days', null, now() - interval '5 days', pg_temp.u(2)),
  ('c5000000-0000-0000-0000-00000000000c', 'C', 'c@example.com', 'payment', 'Detalle de C con más de veinte caracteres.', 'new', null, now() - interval '1 day', null, now() - interval '11 days', null),
  ('c5000000-0000-0000-0000-00000000000d', 'D', 'd@example.com', 'service', 'Detalle de D con más de veinte caracteres.', 'answered', 'Ya lo resolvimos.', now() + interval '3 days', now() - interval '1 day', now() - interval '7 days', null),
  ('c5000000-0000-0000-0000-00000000000e', 'E', 'e@example.com', 'other', 'Detalle de E con más de veinte caracteres.', 'closed', null, now() - interval '20 days', now() - interval '15 days', now() - interval '30 days', null);
select is((select string_agg(contact_name, ',' order by ord) from (select contact_name, row_number() over () ord from public.admin_complaints()) x), 'C,A,B,D,E',
          'D6: primero lo pendiente por urgencia (C vencido, A en 1 día, B en 5) y después lo resuelto, lo más reciente arriba (D, E)');
select is((select string_agg(contact_name || ':' || overdue::text, ',' order by contact_name) from public.admin_complaints()), 'A:false,B:false,C:true,D:false,E:false', 'D7: solo C está vencido');
select is((select string_agg(contact_name || ':' || has_account::text, ',' order by contact_name) from public.admin_complaints() where contact_name in ('A', 'B')), 'A:false,B:true', 'D8: se ve cuáles vienen de una cuenta');
select is((select count(*)::int from public.admin_complaints('open')), 3, 'D9: el filtro «abiertos» trae nuevos y en revisión');
select is((select string_agg(contact_name, ',' order by contact_name) from public.admin_complaints('new')), 'A,C', 'D10: «nuevo»');
select is((select string_agg(contact_name, ',') from public.admin_complaints('answered')), 'D', 'D11: «respondido»');
select is((select count(*)::int from public.admin_complaints('closed')), 1, 'D12: «cerrado»');
select is((select total_count from public.admin_complaints(null, 0, 2) limit 1), 5::bigint, 'D13: el total es el de todos aunque la página sea de 2');
select is((select count(*)::int from public.admin_complaints(null, 3, 10)), 2, 'D14: la segunda página trae los que faltan');

-- ═══ E. admin_complaint_update ════════════════════════════════════════════════════════════
select pg_temp.as_(pg_temp.u(2));
select throws_ok($$select public.admin_complaint_update('c5000000-0000-0000-0000-00000000000a', 'closed', null)$$, '42501', 'solo administradores', 'E1: una clienta no cambia un reclamo');
select pg_temp.as_(pg_temp.u(1));
select throws_ok($$select public.admin_complaint_update('c5000000-0000-0000-0000-00000000000a', 'resuelto', null)$$, '22023', 'invalid_status', 'E2: un estado que no existe');
select throws_ok($$select public.admin_complaint_update('c5000000-0000-0000-0000-0000000000ff', 'closed', null)$$, 'P0002', 'not_found', 'E3: un reclamo que no existe');
select throws_ok($$select public.admin_complaint_update('c5000000-0000-0000-0000-00000000000a', 'answered', null)$$, '22023', 'response_required', 'E4: no se puede marcar «respondido» sin escribir qué se respondió');
select throws_ok($$select public.admin_complaint_update('c5000000-0000-0000-0000-00000000000a', 'answered', '   ')$$, '22023', 'response_required', 'E5: ni con una respuesta en blanco');
select throws_ok(format($$select public.admin_complaint_update('c5000000-0000-0000-0000-00000000000a', 'answered', %L)$$, repeat('x', 2001)), '22023', 'response_too_long', 'E6: ni con más de 2000 caracteres');
select lives_ok($$select public.admin_complaint_update('c5000000-0000-0000-0000-00000000000a', 'in_review', null)$$, 'E7: pasar a «en revisión» no pide respuesta');
select is((select status || '|' || coalesce(handled_by::text, '-') || '|' || (answered_at is null)::text from public.complaints where id = 'c5000000-0000-0000-0000-00000000000a'), 'in_review|' || pg_temp.u(1)::text || '|true', 'E8: queda anotado QUIÉN lo atendió');
select lives_ok($$select public.admin_complaint_update('c5000000-0000-0000-0000-00000000000a', 'answered', '  Le enviamos otra prenda.  ')$$, 'E9: responder guarda el texto');
select is((select status || '|' || response || '|' || (answered_at is not null)::text from public.complaints where id = 'c5000000-0000-0000-0000-00000000000a'), 'answered|Le enviamos otra prenda.|true', 'E10: sin espacios de más y con la fecha de respuesta');
-- (la transacción tiene UNA sola hora: para ver si se conserva la fecha de respuesta se la ponemos de hace 5 días)
update public.complaints set answered_at = now() - interval '5 days' where id = 'c5000000-0000-0000-0000-00000000000a';
select lives_ok($$select public.admin_complaint_update('c5000000-0000-0000-0000-00000000000a', 'closed', null)$$, 'E11: cerrar sin tocar la respuesta la conserva');
select ok((select answered_at < now() - interval '4 days' from public.complaints where id = 'c5000000-0000-0000-0000-00000000000a'), 'E11b: y cerrar un reclamo ya respondido NO cambia la fecha en que se respondió');
select is((select response from public.complaints where id = 'c5000000-0000-0000-0000-00000000000a'), 'Le enviamos otra prenda.', 'E12: la respuesta sigue ahí');
select lives_ok($$select public.admin_complaint_update('c5000000-0000-0000-0000-00000000000a', 'in_review', null)$$, 'E13: se puede REABRIR');
select is((select answered_at is null from public.complaints where id = 'c5000000-0000-0000-0000-00000000000a'), true, 'E14: reabrir limpia la fecha de respuesta');
select throws_ok($$update public.complaints set status = 'answered', response = null where id = 'c5000000-0000-0000-0000-00000000000a'$$, '23514', null, 'E15: ni a mano se puede «responder» sin respuesta (restricción de la tabla)');

-- ═══ F. Resumen ═══════════════════════════════════════════════════════════════════════════
select is(public.admin_complaints_summary(), '{"new": 1, "in_review": 2, "overdue": 1, "total": 5}'::jsonb, 'F1: nuevos 1 (C), en revisión 2 (A y B), vencidos 1 (C) y 5 en total');
select pg_temp.as_(pg_temp.u(3));
select throws_ok($$select public.admin_complaints_summary()$$, '42501', 'solo administradores', 'F2: el resumen es solo del administrador');
select pg_temp.as_(pg_temp.u(1));

-- ═══ G. Auditoría sin datos personales ════════════════════════════════════════════════════
select ok((select count(*) from public.audit_log where table_name = 'complaints' and action = 'INSERT' and actor_id = pg_temp.u(1)) >= 5, 'G1: registrar queda en la auditoría');
select is((select diff -> 'contact_email' #>> '{}' from public.audit_log where table_name = 'complaints' and action = 'INSERT'
            and record_id = 'c5000000-0000-0000-0000-00000000000a'::text), '[redacted]', 'G2: el correo NO se guarda en la auditoría');
select is((select (diff::text ~* '(a@example|Detalle de A)') from public.audit_log where table_name = 'complaints' and action = 'INSERT'
            and record_id = 'c5000000-0000-0000-0000-00000000000a'::text), false, 'G3: ni el detalle ni el nombre');
select is((select diff -> 'response' ->> 'changed' from public.audit_log where table_name = 'complaints' and action = 'UPDATE'
            and record_id = 'c5000000-0000-0000-0000-00000000000a'::text and diff ? 'response' order by id limit 1), 'true', 'G4: al responder se anota QUE cambió la respuesta, no su texto');
select is((select diff #>> '{status,new}' from public.audit_log where table_name = 'complaints' and action = 'UPDATE'
            and record_id = 'c5000000-0000-0000-0000-00000000000a'::text and diff #>> '{status,new}' = 'in_review' order by id limit 1), 'in_review', 'G5: los cambios de estado sí se ven (antes y después)');

select * from finish();
rollback;
