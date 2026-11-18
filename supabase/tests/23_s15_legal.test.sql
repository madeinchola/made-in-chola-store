-- Sprint 15 · Fase 1 — Documentos legales versionados y lo que cada persona aceptó: el borrador y las versiones publicadas (que ya no se
-- cambian ni se borran), lo «vigente» y las vigencias futuras, quién puede leer y quién escribir, la aceptación EXACTA de la versión vigente,
-- las cuentas «pendientes» al publicar una versión nueva, la inmutabilidad del registro de consentimientos y la anonimización.
-- Todo ocurre en una transacción que se revierte. HERMÉTICO: parte de cero (vacía versiones y aceptaciones dentro de la transacción).
--
-- Fixture: un administrador (ad) y dos clientas (c1, c2).
begin;
select plan(122);

-- ── Ayudas ──────────────────────────────────────────────────────────────────────────────────
create function pg_temp.u(n int) returns uuid language sql as $$ select ('a3000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create temp table t_r (k text primary key, v jsonb);
create function pg_temp.rec(p_k text, p_v jsonb) returns void language sql as $$ insert into t_r values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.g(p_k text) returns jsonb language sql as $$ select v from t_r where k = p_k $$;
create function pg_temp.as_(p_uid uuid) returns void language sql as
  $$ select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p_uid), true) $$;
create function pg_temp.body(p text) returns text language sql as $$ select 'Texto de prueba de la versión ' || p || ', con más de veinte caracteres.' $$;
create function pg_temp.h(c text) returns text language sql as $$ select repeat(c, 64) $$;

-- Parte de cero (la nube trae lo que dejaron otras corridas).
alter table public.legal_versions disable trigger legal_versions_guard_trg;
delete from public.legal_versions;
alter table public.legal_versions enable trigger legal_versions_guard_trg;
alter table public.legal_acceptances disable trigger legal_acceptances_immutable;
delete from public.legal_acceptances;
alter table public.legal_acceptances enable trigger legal_acceptances_immutable;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  (pg_temp.u(1), 'admin.s15@test.com', '{"full_name":"Admin S15"}', 'authenticated', 'authenticated'),
  (pg_temp.u(2), 'c1.s15@test.com', '{"full_name":"Clienta Uno S15"}', 'authenticated', 'authenticated'),
  (pg_temp.u(3), 'c2.s15@test.com', '{"full_name":"Clienta Dos S15"}', 'authenticated', 'authenticated');
select public.set_user_role(pg_temp.u(1), 'admin');
select pg_temp.as_(pg_temp.u(1));

-- ═══ A. Estructura y permisos ══════════════════════════════════════════════════════════════
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname in ('legal_documents', 'legal_versions', 'legal_acceptances') and c.relrowsecurity), 3,
          'A1: las 3 tablas tienen RLS activa');
select is((select count(*)::int from information_schema.role_table_grants g
            where g.table_schema = 'public' and g.table_name in ('legal_documents', 'legal_versions', 'legal_acceptances')
              and g.grantee in ('anon', 'authenticated', 'service_role')), 0, 'A2: ni anon, ni authenticated, ni service_role tocan las tablas (solo las funciones)');
select is((select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('public_legal_document', 'public_legal_index', 'public_legal_required')
              and has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute')),
          'public_legal_document,public_legal_index,public_legal_required', 'A3: la lectura de lo VIGENTE es pública (anon y authenticated)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('admin_legal_overview', 'admin_legal_get', 'admin_legal_save_draft', 'admin_legal_discard_draft',
              'admin_legal_publish', 'admin_legal_acceptance_stats')
              and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
              and not has_function_privilege('service_role', p.oid, 'execute')), 6, 'A4: las 6 funciones de administración las ejecuta authenticated (y adentro exigen ser admin), no anon ni service_role');
select is((select has_function_privilege('service_role', 'public.record_legal_acceptance(uuid, uuid, text, jsonb, text)', 'execute')
              and not has_function_privilege('authenticated', 'public.record_legal_acceptance(uuid, uuid, text, jsonb, text)', 'execute')
              and not has_function_privilege('anon', 'public.record_legal_acceptance(uuid, uuid, text, jsonb, text)', 'execute')), true,
          'A5: registrar lo aceptado es SOLO del servicio (el registro y el checkout)');
select is((select coalesce(string_agg(p.proname, ','), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_legal_current', '_legal_required_versions', 'legal_versions_guard', 'legal_acceptances_guard', 'profiles_legal_cleanup')
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                   or has_function_privilege('service_role', p.oid, 'execute'))), '', 'A6: las funciones internas no las ejecuta nadie desde la API');
select is((select count(*)::int from public.legal_documents), 5, 'A7: los 5 documentos de arranque');
select is((select string_agg(kind, ',' order by sort_order) from public.legal_documents where requires_acceptance), 'terms,privacy', 'A8: solo términos y privacidad exigen aceptación');
select is((select count(*)::int from public.store_settings where key in ('legal_tax_id', 'legal_address') and is_public), 2, 'A9: el NIT y la dirección legal son ajustes públicos (van en los textos)');

-- ═══ B. Solo administradores ═══════════════════════════════════════════════════════════════
select pg_temp.as_(pg_temp.u(2));
set local role authenticated;
select throws_ok($$select public.admin_legal_overview()$$, '42501', null, 'B1: una clienta no ve el panel de documentos');
select throws_ok($$select public.admin_legal_get('terms')$$, '42501', null, 'B2: ni lee un borrador');
select throws_ok($$select public.admin_legal_save_draft('terms', 'Texto de prueba de más de veinte caracteres.', null)$$, '42501', null, 'B3: ni escribe uno');
select throws_ok($$select public.admin_legal_publish('terms')$$, '42501', null, 'B4: ni publica');
select throws_ok($$select public.admin_legal_discard_draft('terms')$$, '42501', null, 'B5: ni descarta');
select throws_ok($$select public.admin_legal_acceptance_stats()$$, '42501', null, 'B6: ni ve cuántos aceptaron');
select throws_ok($$select public.record_legal_acceptance('a3000000-0000-0000-0000-000000000002', null, 'register', '{}', null)$$, '42501', null, 'B7: ni registra una aceptación a nombre de nadie (solo el servicio)');
select throws_ok($$select * from public.legal_versions$$, '42501', null, 'B8: y las tablas no se leen directo');
reset role;
set local role anon;
select throws_ok($$select public.admin_legal_overview()$$, '42501', null, 'B9: anon tampoco');
select lives_ok($$select public.public_legal_index()$$, 'B10: pero anon SÍ lee lo vigente');
select throws_ok($$select public.my_legal_pending()$$, '42501', null, 'B11: y «lo que me falta aceptar» exige haber entrado');
reset role;
select pg_temp.as_(pg_temp.u(1));

-- ═══ C. Sin nada publicado ═════════════════════════════════════════════════════════════════
select is(public.public_legal_required(), '{}'::jsonb, 'C1: sin versiones publicadas no se exige aceptar nada (no hay nada que aceptar)');
select is((public.public_legal_document('terms') ->> 'version') is null and (public.public_legal_document('terms') ->> 'body') is null, true, 'C2: el documento existe pero sin versión ni texto');
select is(public.public_legal_document('terms') ->> 'title', 'Términos y condiciones', 'C3: con su título');
select is(public.public_legal_document('no-existe'), null::jsonb, 'C4: un documento desconocido no existe');
select is(jsonb_array_length(public.public_legal_index()), 5, 'C5: el índice lista los 5, en orden');
select is(public.public_legal_index() -> 0 ->> 'kind', 'terms', 'C6: el primero son los términos');
select pg_temp.as_(pg_temp.u(2));
select is(public.my_legal_pending(), '{}'::jsonb, 'C7: y a nadie le falta aceptar nada todavía');
select pg_temp.as_(pg_temp.u(1));

-- ═══ D. El borrador ════════════════════════════════════════════════════════════════════════
select pg_temp.rec('d1', public.admin_legal_save_draft('terms', pg_temp.body('1'), 'primera redacción'));
select is(pg_temp.g('d1') ->> 'version' || '/' || (pg_temp.g('d1') ->> 'status'), '1/draft', 'D1: el primer borrador es la versión 1');
select is(public.public_legal_document('terms') ->> 'version', null, 'D2: un borrador NO se ve en la tienda');
select is(public.public_legal_required(), '{}'::jsonb, 'D3: ni se exige');
select pg_temp.rec('d2', public.admin_legal_save_draft('terms', pg_temp.body('1b'), null));
select is(pg_temp.g('d2') ->> 'version' || '/' || (pg_temp.g('d2') ->> 'id' = pg_temp.g('d1') ->> 'id')::text, '1/true', 'D4: guardar de nuevo actualiza EL MISMO borrador (no crea otra versión)');
select is((public.admin_legal_get('terms') ->> 'body'), pg_temp.body('1b'), 'D5: y el borrador trae el último texto');
select is((select count(*)::int from public.legal_versions where kind = 'terms'), 1, 'D6: hay una sola fila');
select throws_ok($$select public.admin_legal_save_draft('terms', 'corto', null)$$, '22023', 'invalid_body', 'D7: un texto de menos de 20 caracteres se rechaza');
select throws_ok($$select public.admin_legal_save_draft('terms', 'Esto lleva una <script>alert(1)</script> etiqueta de HTML', null)$$, '22023', 'html_not_allowed', 'D8: el HTML no se admite (el texto se muestra como texto, nunca como marcado)');
select throws_ok($$select public.admin_legal_save_draft('colores', 'Texto de prueba de más de veinte caracteres.', null)$$, '22023', 'invalid_kind', 'D9: un documento desconocido se rechaza');
select is((public.admin_legal_overview() -> 0 ->> 'has_draft')::boolean, true, 'D10: el panel dice que términos tiene un borrador');
select throws_ok($$select public.admin_legal_publish('privacy')$$, '22023', 'no_draft', 'D11: no se publica lo que no tiene borrador');
select lives_ok($$select public.admin_legal_discard_draft('privacy')$$, 'D12: descartar un borrador que no existe no es un error');
select public.admin_legal_save_draft('shipping', pg_temp.body('envíos'), null);
select public.admin_legal_discard_draft('shipping');
select is((select count(*)::int from public.legal_versions where kind = 'shipping'), 0, 'D13: descartar borra el borrador');

-- ═══ E. Publicar y las versiones ═══════════════════════════════════════════════════════════
select pg_temp.rec('p1', public.admin_legal_publish('terms'));
select is(pg_temp.g('p1') ->> 'version', '1', 'E1: se publica la versión 1');
select is(public.public_legal_document('terms') ->> 'version' || '|' || (public.public_legal_document('terms') ->> 'body'), '1|' || pg_temp.body('1b'), 'E2: y es la que ve la tienda, con su texto');
select is(public.public_legal_required(), '{"terms": 1}'::jsonb, 'E3: desde ahora los términos exigen aceptación (versión 1)');
select is((select effective_at <= now() and published_by = pg_temp.u(1) from public.legal_versions where kind = 'terms' and version = 1), true, 'E4: vigente desde ahora, publicada por SU administrador');
select throws_ok($$update public.legal_versions set body = 'Cambiar un texto ya publicado, con más de veinte caracteres' where kind = 'terms' and version = 1$$, '42501', null, 'E5: una versión publicada NO se cambia');
select throws_ok($$delete from public.legal_versions where kind = 'terms' and version = 1$$, '42501', null, 'E6: ni se borra');
select throws_ok($$update public.legal_versions set version = 9 where kind = 'terms' and version = 1$$, '42501', null, 'E7: ni cambia de número');
select throws_ok($$select public.admin_legal_publish('terms')$$, '22023', 'no_draft', 'E8: publicar otra vez, sin borrador nuevo, no hace nada');
-- La versión 2 exige decir qué cambió
select pg_temp.rec('d3', public.admin_legal_save_draft('terms', pg_temp.body('2'), null));
select is(pg_temp.g('d3') ->> 'version', '2', 'E9: el nuevo borrador es la versión 2');
select throws_ok($$select public.admin_legal_publish('terms')$$, '22023', 'change_note_required', 'E10: publicar una versión nueva exige decir QUÉ cambió (se le muestra a la clienta)');
select is(public.public_legal_document('terms') ->> 'version', '1', 'E11: mientras tanto la vigente sigue siendo la 1');
select pg_temp.rec('p2', public.admin_legal_publish('terms', null, 'Aclaramos los plazos de entrega.'));
select is(public.public_legal_document('terms') ->> 'version', '2', 'E12: con su nota, la 2 es la vigente');
select is((select change_note from public.legal_versions where kind = 'terms' and version = 2), 'Aclaramos los plazos de entrega.', 'E13: y la nota queda guardada');
select is((public.admin_legal_get('terms', 1) ->> 'body'), pg_temp.body('1b'), 'E14: la versión 1 sigue pudiéndose leer tal cual');
select is(public.public_legal_document('terms') ->> 'change_note', 'Aclaramos los plazos de entrega.', 'E14b: la tienda sabe QUÉ cambió en la versión vigente (para decírselo a quien debe aceptar de nuevo)');
select is(public.public_legal_index() -> 0 ->> 'change_note', 'Aclaramos los plazos de entrega.', 'E14c: y el índice también');
-- Una vigencia futura se programa
select public.admin_legal_save_draft('terms', pg_temp.body('3'), 'Nueva política de cambios');
select pg_temp.rec('p3', public.admin_legal_publish('terms', now() + interval '2 days', null));
select is(public.public_legal_document('terms') ->> 'version', '2', 'E15: una versión con vigencia futura NO es la vigente todavía');
select is(public.public_legal_required(), '{"terms": 2}'::jsonb, 'E16: ni se exige todavía');
select is((select status || '/' || (effective_at > now() + interval '47 hours')::text from public.legal_versions where kind = 'terms' and version = 3), 'published/true', 'E17: queda publicada y programada para dentro de 2 días');
select public.admin_legal_save_draft('terms', pg_temp.body('4'), 'x');
select throws_ok($$select public.admin_legal_publish('terms', now() - interval '1 day', 'Cambio de fecha')$$, '22023', 'effective_in_past', 'E18: no se publica con una vigencia en el pasado');
select public.admin_legal_discard_draft('terms');
-- La privacidad (primera versión: sin nota)
select public.admin_legal_save_draft('privacy', pg_temp.body('privacidad'), null);
select public.admin_legal_publish('privacy');
select is(public.public_legal_required(), '{"terms": 2, "privacy": 1}'::jsonb, 'E19: términos (2) y privacidad (1) exigen aceptación');
select public.admin_legal_save_draft('cookies', pg_temp.body('cookies'), null);
select public.admin_legal_publish('cookies');
select is(public.public_legal_required(), '{"terms": 2, "privacy": 1}'::jsonb, 'E20: las cookies se publican pero no exigen aceptación');
select is((select jsonb_array_length(v -> 'versions') from jsonb_array_elements(public.admin_legal_overview()) v where v ->> 'kind' = 'terms'), 3, 'E21: el panel lista las 3 versiones de términos (1, 2 y la programada 3)');

-- ═══ F. Aceptaciones ═══════════════════════════════════════════════════════════════════════
-- Vigentes que exigen aceptación: términos 2 y privacidad 1
select pg_temp.rec('f_ok', jsonb_build_object('terms', 2, 'privacy', 1));
select is((select count(*)::int from public.legal_acceptances), 0, 'F0: aún nadie aceptó nada');
select lives_ok(format($$select public.record_legal_acceptance(%L, null, 'register', %L::jsonb, %L)$$, pg_temp.u(2), pg_temp.g('f_ok'), pg_temp.h('a')), 'F1: registrar la aceptación con las versiones EXACTAS funciona');
select is((select string_agg(kind || ':' || version || ':' || context, ',' order by kind) from public.legal_acceptances where profile_id = pg_temp.u(2)), 'privacy:1:register,terms:2:register',
          'F2: queda una fila por documento, con su versión y su contexto');
select is((select ip_hash from public.legal_acceptances where profile_id = pg_temp.u(2) limit 1), pg_temp.h('a'), 'F3: con la huella de la red (nunca la IP)');
select throws_ok(format($$select public.record_legal_acceptance(%L, null, 'register', '{"terms": 2}', null)$$, pg_temp.u(3)), '22023', 'legal_required', 'F4: si falta uno de los documentos que exigen aceptación, se rechaza');
select throws_ok(format($$select public.record_legal_acceptance(%L, null, 'register', '{"terms": 1, "privacy": 1}', null)$$, pg_temp.u(3)), '22023', 'legal_outdated', 'F5: una versión vieja (la 1 de términos) se rechaza: hay que leer la vigente');
select throws_ok(format($$select public.record_legal_acceptance(%L, null, 'register', '{"terms": 3, "privacy": 1}', null)$$, pg_temp.u(3)), '22023', 'legal_outdated', 'F6: y una versión FUTURA (la 3, todavía no vigente) tampoco');
select throws_ok(format($$select public.record_legal_acceptance(%L, null, 'register', null, null)$$, pg_temp.u(3)), '22023', 'legal_required', 'F7: sin versiones, se rechaza');
select throws_ok(format($$select public.record_legal_acceptance(%L, null, 'registro', %L::jsonb, null)$$, pg_temp.u(3), pg_temp.g('f_ok')), '22023', 'invalid_context', 'F8: un contexto desconocido se rechaza');
select throws_ok(format($$select public.record_legal_acceptance(null, null, 'register', %L::jsonb, null)$$, pg_temp.g('f_ok')), '22023', 'invalid_subject', 'F9: tiene que ser de una cuenta o de un pedido');
select throws_ok(format($$select public.record_legal_acceptance(%L, null, 'register', %L::jsonb, 'no-es-un-hash')$$, pg_temp.u(3), pg_temp.g('f_ok')), '23514', null, 'F10: la huella tiene que ser un SHA-256');
select is((select count(*)::int from public.legal_acceptances where profile_id = pg_temp.u(3)), 0, 'F11: lo rechazado no dejó ni una fila');
select lives_ok(format($$select public.record_legal_acceptance(null, %L, 'checkout', %L::jsonb, %L)$$, 'c3000000-0000-0000-0000-000000000001', pg_temp.g('f_ok'), pg_temp.h('b')), 'F12: en el checkout se registra contra el PEDIDO (aunque no haya cuenta)');
select is((select count(*)::int from public.legal_acceptances where order_id = 'c3000000-0000-0000-0000-000000000001'), 2, 'F13: dos filas, una por documento');
select lives_ok(format($$select public.record_legal_acceptance(%L, null, 'register', %L::jsonb, null)$$, pg_temp.u(3), '{"terms": 2, "privacy": 1, "cookies": 7, "otro": 1}'), 'F14: lo que no exige aceptación (cookies) o no existe se ignora');
select is((select count(*)::int from public.legal_acceptances where profile_id = pg_temp.u(3)), 2, 'F15: y no se registra');
-- «Lo que me falta aceptar»
select pg_temp.as_(pg_temp.u(2));
select is(public.my_legal_pending(), '{}'::jsonb, 'F16: c1 aceptó las vigentes: no le falta nada');
select pg_temp.as_(pg_temp.u(1));
select public.admin_legal_save_draft('privacy', pg_temp.body('privacidad 2'), 'Ahora decimos con quién compartimos los datos');
select public.admin_legal_publish('privacy');
select pg_temp.as_(pg_temp.u(2));
select is(public.my_legal_pending(), '{"privacy": 2}'::jsonb, 'F17: al publicar la privacidad 2, a c1 le falta aceptarla (y solo esa)');
select pg_temp.as_(pg_temp.u(1));
select is(public.public_legal_required(), '{"terms": 2, "privacy": 2}'::jsonb, 'F18: y el registro y el checkout ya piden la 2');
select throws_ok(format($$select public.record_legal_acceptance(%L, null, 'register', %L::jsonb, null)$$, pg_temp.u(3), pg_temp.g('f_ok')), '22023', 'legal_outdated', 'F19: con la versión que se leyó antes (privacidad 1) se rechaza: hay que leer la nueva');
select lives_ok(format($$select public.record_legal_acceptance(%L, null, 'reaccept', '{"terms": 2, "privacy": 2}', %L)$$, pg_temp.u(2), pg_temp.h('c')), 'F20: c1 acepta de nuevo (contexto «reaccept»)');
select pg_temp.as_(pg_temp.u(2));
select is(public.my_legal_pending(), '{}'::jsonb, 'F21: y ya no le falta nada');
select pg_temp.as_(pg_temp.u(1));
select pg_temp.as_(pg_temp.u(3));
select is(public.my_legal_pending(), '{"privacy": 2}'::jsonb, 'F22: a c2 (aceptó la 1) le falta la 2');
select pg_temp.as_(pg_temp.u(1));
select is(public.admin_legal_acceptance_stats() #>> '{0,kind}', 'privacy', 'F23: las estadísticas empiezan por privacidad');
select is((select (s ->> 'accounts')::int from jsonb_array_elements(public.admin_legal_acceptance_stats()) s where s ->> 'kind' = 'privacy' and s ->> 'version' = '1'), 2, 'F24: la privacidad 1 la aceptaron 2 cuentas (c1 y c2)');
select is((select (s ->> 'accounts')::int || '/' || (s ->> 'orders') from jsonb_array_elements(public.admin_legal_acceptance_stats()) s where s ->> 'kind' = 'privacy' and s ->> 'version' = '2'), '1/0', 'F25: y la 2, 1 cuenta (c1)');
select is((select (s ->> 'orders')::int from jsonb_array_elements(public.admin_legal_acceptance_stats()) s where s ->> 'kind' = 'terms' and s ->> 'version' = '2'), 1, 'F26: los términos 2 se aceptaron en 1 pedido');

-- ═══ G. El registro de consentimientos es inmutable ════════════════════════════════════════
select throws_ok($$update public.legal_acceptances set version = 99$$, '42501', null, 'G1: lo aceptado no se cambia');
select throws_ok($$delete from public.legal_acceptances where profile_id = 'a3000000-0000-0000-0000-000000000002'$$, '42501', null, 'G2: ni se borra');
select throws_ok($$truncate public.legal_acceptances$$, '42501', null, 'G3: ni se vacía');
select throws_ok($$update public.legal_acceptances set ip_hash = null where profile_id = 'a3000000-0000-0000-0000-000000000002'$$, '42501', null, 'G4: ni siquiera la huella de red se quita a mano');
-- Anonimizar la cuenta de c1 quita SOLO la huella de red
select is((select count(*)::int from public.legal_acceptances where profile_id = pg_temp.u(2) and ip_hash is not null), 4, 'G5: c1 tiene 4 aceptaciones con huella (2 de registro y 2 al aceptar de nuevo)');
update public.profiles set anonymized_at = now() where id = pg_temp.u(2);
select is((select count(*)::int from public.legal_acceptances where profile_id = pg_temp.u(2) and ip_hash is not null), 0, 'G6: al anonimizar la cuenta, las aceptaciones quedan SIN la huella de red…');
select is((select count(*)::int from public.legal_acceptances where profile_id = pg_temp.u(2)), 4, 'G7: …pero siguen ahí como prueba (versión, fecha, documento)');
select is((select count(*)::int from public.legal_acceptances where profile_id = pg_temp.u(3) and ip_hash is not null), 0, 'G8: (c2 se registró sin huella) y la de los pedidos no se tocó');
select is((select count(*)::int from public.legal_acceptances where order_id is not null and ip_hash is not null), 2, 'G9: las de los pedidos conservan la suya (no son de esa cuenta)');
select throws_ok($$update public.legal_acceptances set ip_hash = null where order_id is not null$$, '42501', null, 'G10: y la bandera de anonimizar no queda abierta para el resto de la transacción');

-- ═══ H. Auditoría ═════════════════════════════════════════════════════════════════════════
select ok((select count(*) from public.audit_log where table_name = 'legal_versions' and action = 'INSERT' and actor_id = pg_temp.u(1)) >= 3, 'H1: crear borradores queda en la auditoría con SU administrador');
select ok((select count(*) from public.audit_log where table_name = 'legal_versions' and action = 'UPDATE' and diff ? 'status' and diff #>> '{status,new}' = 'published' and actor_id = pg_temp.u(1)) >= 3, 'H2: y publicar también');

-- ═══ I. Aceptar de nuevo una PARTE de lo vigente (contexto «reaccept») ════════════════════════
-- Estado: se exige términos 2 y privacidad 2; c2 (u3) ya aceptó los términos 2 y le falta la privacidad 2.
select pg_temp.as_(pg_temp.u(3));
select is(public.my_legal_pending(), '{"privacy": 2}'::jsonb, 'I0: a c2 solo le falta la privacidad 2');
select pg_temp.as_(pg_temp.u(1));
select lives_ok(format($$select public.record_legal_acceptance(%L, null, 'reaccept', '{"privacy": 2}', %L)$$, pg_temp.u(3), pg_temp.h('d')), 'I1: aceptar de nuevo SOLO la privacidad 2 (lo único que le faltaba) funciona');
select is((select string_agg(kind || ':' || version, ',' order by kind) from public.legal_acceptances where profile_id = pg_temp.u(3) and context = 'reaccept'), 'privacy:2', 'I2: y se anota SOLO lo que mandó (no los términos, que no vio en el aviso)');
select pg_temp.as_(pg_temp.u(3));
select is(public.my_legal_pending(), '{}'::jsonb, 'I3: con eso ya no le falta nada');
select pg_temp.as_(pg_temp.u(1));
select throws_ok(format($$select public.record_legal_acceptance(%L, null, 'reaccept', '{"privacy": 1}', null)$$, pg_temp.u(3)), '22023', 'legal_outdated', 'I4: una parte con una versión vieja se rechaza');
select throws_ok(format($$select public.record_legal_acceptance(%L, null, 'reaccept', '{"cookies": 7}', null)$$, pg_temp.u(3)), '22023', 'legal_outdated', 'I5: y un texto que no exige aceptación (cookies) o no existe no vale como aceptado');
select throws_ok(format($$select public.record_legal_acceptance(%L, null, 'reaccept', '{"privacy": "x"}', null)$$, pg_temp.u(3)), '22023', 'legal_outdated', 'I6: ni una versión que no es un número');
select throws_ok(format($$select public.record_legal_acceptance(%L, null, 'reaccept', '{}', null)$$, pg_temp.u(3)), '22023', 'legal_required', 'I7: no mandar nada se rechaza');
select throws_ok(format($$select public.record_legal_acceptance(%L, null, 'register', '{"privacy": 2}', null)$$, pg_temp.u(3)), '22023', 'legal_required', 'I8: en el REGISTRO una parte no basta: se exige todo lo vigente');
select throws_ok(format($$select public.record_legal_acceptance(null, %L, 'checkout', '{"terms": 2}', null)$$, 'c3000000-0000-0000-0000-000000000001'), '22023', 'legal_required', 'I9: ni en el PAGO');

-- ═══ J. Huecos que la mutación encontró ═════════════════════════════════════════════════
-- J1–J3: un borrador no cambia de documento ni de número (lo único que cambia es su texto y su nota)
select pg_temp.as_(pg_temp.u(1));
select public.admin_legal_save_draft('returns', pg_temp.body('devoluciones borrador'), null);
select throws_ok($$update public.legal_versions set version = 99 where kind = 'returns' and status = 'draft'$$, '42501', null, 'J1: el borrador NO cambia de número de versión');
select throws_ok($$update public.legal_versions set kind = 'shipping' where kind = 'returns' and status = 'draft'$$, '42501', null, 'J2: ni de documento');
select lives_ok($$update public.legal_versions set body = 'Otro texto de prueba, con más de veinte caracteres.' where kind = 'returns' and status = 'draft'$$, 'J3: pero su texto sí cambia');
-- J4: guardar: el tope de largo es de 60 000 caracteres
select lives_ok(format($$select public.admin_legal_save_draft('returns', %L, null)$$, repeat('x', 60000)), 'J4: un texto de 60 000 caracteres se guarda');
select throws_ok(format($$select public.admin_legal_save_draft('returns', %L, null)$$, repeat('x', 60001)), '22023', 'invalid_body', 'J5: uno de 60 001 se rechaza');
-- J6: publicar con una vigencia de hace 3 minutos (dentro de la tolerancia): rige DESDE AHORA, no desde antes
select public.admin_legal_save_draft('returns', pg_temp.body('devoluciones v1'), null);
select public.admin_legal_publish('returns', now() - interval '3 minutes', null);
select ok((select effective_at >= now() from public.legal_versions where kind = 'returns' and version = 1), 'J6: una vigencia dentro de la tolerancia de 5 minutos queda como «desde ahora», nunca en el pasado');
-- J7–J8: al anonimizar solo se quita la huella: ninguna otra columna cambia, aunque la bandera esté puesta
alter table public.legal_acceptances disable trigger legal_acceptances_immutable;
insert into public.legal_acceptances (profile_id, context, kind, version, ip_hash) values (pg_temp.u(3), 'register', 'cookies', 1, repeat('f', 64));
alter table public.legal_acceptances enable trigger legal_acceptances_immutable;
select set_config('app.legal_anonymize', '1', true);
select throws_ok($$update public.legal_acceptances set ip_hash = null, version = 9 where profile_id = 'a3000000-0000-0000-0000-000000000003' and kind = 'cookies'$$, '42501', null, 'J7: con la bandera de anonimizar, cambiar OTRA columna junto con la huella se rechaza');
select lives_ok($$update public.legal_acceptances set ip_hash = null where profile_id = 'a3000000-0000-0000-0000-000000000003' and kind = 'cookies'$$, 'J8: y quitar SOLO la huella sí se permite');
select set_config('app.legal_anonymize', '', true);
-- J9: sin sesión no hay «pendientes»
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(public.my_legal_pending(), '{}'::jsonb, 'J9: quien no tiene sesión no tiene nada pendiente (no se le devuelve la lista de lo vigente)');
-- J10–J11: las estadísticas cuentan PERSONAS y PEDIDOS distintos aunque se haya aceptado dos veces la misma versión (registro y luego pago)
select pg_temp.as_(pg_temp.u(1));
alter table public.legal_acceptances disable trigger legal_acceptances_immutable;
insert into public.legal_acceptances (profile_id, order_id, context, kind, version, ip_hash) values
  (pg_temp.u(3), 'c3000000-0000-0000-0000-000000000099', 'checkout', 'cookies', 1, null),
  (pg_temp.u(3), 'c3000000-0000-0000-0000-000000000099', 'checkout', 'cookies', 1, null);
alter table public.legal_acceptances enable trigger legal_acceptances_immutable;
select is((select (s ->> 'accounts') || '/' || (s ->> 'orders') from jsonb_array_elements(public.admin_legal_acceptance_stats()) s where s ->> 'kind' = 'cookies' and s ->> 'version' = '1'),
          '1/1', 'J10: 3 filas de la misma versión (1 de registro y 2 del mismo pedido) cuentan 1 cuenta y 1 pedido');

select * from finish();
rollback;
