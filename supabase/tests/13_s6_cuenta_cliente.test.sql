-- Sprint 6 · Cuenta del cliente: direcciones, datos fiscales, preferencias, cambio de teléfono, anonimización y RLS.
-- Valores esperados calculados a mano (ver el comentario de cada bloque). Nada se borra (BR-ACC-07).
begin;
select plan(165);

-- HERMÉTICO: parte de una BD vacía dentro de su transacción (se revierte al final).
delete from public.carts;
delete from public.addresses;
delete from public.tax_profiles;
delete from public.profiles;
alter table public.audit_log disable trigger audit_log_no_change;
delete from public.audit_log;
alter table public.audit_log enable trigger audit_log_no_change;
delete from auth.users;
delete from public.rate_limits;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'ana@test.com',   '{"full_name":"Ana Pérez","phone_e164":"+59171111111"}', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'beto@test.com',  '{"full_name":"Beto Rojas"}',                           'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-00000000000c', 'admin@test.com', '{"full_name":"Admin Uno"}',                            'authenticated', 'authenticated'),
  -- Solo teléfono (email sintético): su único identificador es el teléfono.
  ('eeeeeeee-0000-0000-0000-00000000000e', '59172222222@phone.madeinchola.invalid', '{"full_name":"Eli Solo Tel","phone_e164":"+59172222222"}', 'authenticated', 'authenticated');
select public.set_user_role('cccccccc-0000-0000-0000-00000000000c', 'admin');
-- Eventos de GoTrue (guardan email y nombre): los de Ana deben desaparecer al anonimizarla; los de Beto, no.
insert into auth.audit_log_entries (instance_id, id, payload, created_at) values
  ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-0000-0000-00000000000a',
   '{"action":"login","actor_id":"aaaaaaaa-0000-0000-0000-00000000000a","actor_name":"Ana Pérez","actor_username":"ana@test.com"}', now()),
  ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-0000-0000-0000000000a2',
   '{"action":"user_signedup","actor_username":"service_role","traits":{"user_email":"ana@test.com","user_id":"aaaaaaaa-0000-0000-0000-00000000000a"}}', now()),
  ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-0000-0000-00000000000b',
   '{"action":"login","actor_id":"bbbbbbbb-0000-0000-0000-00000000000b","actor_name":"Beto Rojas","actor_username":"beto@test.com"}', now());

-- ═══ A. Ana: direcciones (por defecto, archivado, restricciones) ═══════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select lives_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', '  Casa  ', 'Ana Pérez', '+59171111111', 'Calle 1 #23', 'La Paz')$$,
  'Ana crea su primera dirección');
select is((select label from public.addresses where label = 'Casa'), 'Casa', 'los espacios sobrantes del texto se recortan');
select is((select is_default from public.addresses where label = 'Casa'), true, 'la PRIMERA dirección activa queda como predeterminada sola');
select lives_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'Trabajo', 'Ana Pérez', '+59171111111', 'Av. Arce 100', 'La Paz')$$,
  'segunda dirección');
select is((select is_default from public.addresses where label = 'Trabajo'), false, 'la segunda NO es predeterminada');
select lives_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city, is_default)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'Oficina', 'Ana Pérez', '+59171111111', 'Plaza Murillo 1', 'La Paz', true)$$,
  'tercera, marcada predeterminada al crearla');
select is((select label from public.addresses where is_default), 'Oficina', 'ahora la predeterminada es «Oficina»…');
select is((select count(*)::int from public.addresses where is_default and archived_at is null), 1, '…y es UNA sola (la anterior se desmarcó)');
update public.addresses set is_default = true where label = 'Trabajo';
select is((select label from public.addresses where is_default), 'Trabajo', 'marcar «Trabajo» como predeterminada mueve la marca');
select is((select count(*)::int from public.addresses where is_default), 1, 'sigue habiendo una sola');

-- Archivar la predeterminada: deja de serlo y otra activa (la más reciente) toma su lugar.
update public.addresses set archived_at = now() where label = 'Trabajo';
select is((select is_default from public.addresses where label = 'Trabajo'), false, 'una dirección archivada nunca es predeterminada');
select is((select count(*)::int from public.addresses where is_default and archived_at is null), 1, 'al archivar la predeterminada, otra activa pasa a serlo');
select isnt((select label from public.addresses where is_default), 'Trabajo', '…y no es la archivada');

-- Archivar TODAS: ninguna activa, ninguna predeterminada; restaurar una la deja predeterminada.
update public.addresses set archived_at = now() where archived_at is null;
select is((select count(*)::int from public.addresses where archived_at is null), 0, 'archivar la única (o todas) es posible: no queda ninguna activa');
select is((select count(*)::int from public.addresses where is_default), 0, '…ni predeterminada');
update public.addresses set archived_at = null where label = 'Casa';
select is((select is_default from public.addresses where label = 'Casa'), true, 'restaurar la primera activa la deja predeterminada');
update public.addresses set archived_at = null where label = 'Oficina';
select is((select is_default from public.addresses where label = 'Oficina'), false, 'restaurar otra con una predeterminada vigente NO le quita la marca a la primera');

-- Restricciones de datos
select throws_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city, lat)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'X', 'Ana', '+59171111111', 'L', 'C', -16.5)$$,
  '23514', null, 'el pin es todo o nada: latitud sin longitud se rechaza');
select throws_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city, lat, lng)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'X', 'Ana', '+59171111111', 'L', 'C', 91, 0)$$,
  '23514', null, 'latitud 91 fuera de rango');
select throws_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city, lat, lng)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'X', 'Ana', '+59171111111', 'L', 'C', 0, 181)$$,
  '23514', null, 'longitud 181 fuera de rango');
select lives_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city, lat, lng, reference_text, line2)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'Con pin', 'Ana', '+59171111111', 'L', 'C', -16.500000, -68.150000, '  portón verde  ', '   ')$$,
  'un pin válido (La Paz) se guarda');
select is((select lat from public.addresses where label = 'Con pin'), -16.5::numeric, 'la latitud guardada es la enviada');
select is((select lng from public.addresses where label = 'Con pin'), -68.15::numeric, 'la longitud guardada es la enviada');
select is((select reference_text from public.addresses where label = 'Con pin'), 'portón verde', 'la referencia se recorta');
select is((select line2 from public.addresses where label = 'Con pin'), null, 'un opcional en blanco queda NULL');
select throws_ok($$insert into public.addresses (profile_id, label, recipient, line1, city)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'X', 'Ana', 'L', 'C')$$,
  '23514', null, 'una dirección activa necesita teléfono');
select throws_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'X', 'Ana', '71234567', 'L', 'C')$$,
  '23514', null, 'el teléfono debe ser E.164');
select throws_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city, for_shipping, for_billing)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'X', 'Ana', '+59171111111', 'L', 'C', false, false)$$,
  '23514', null, 'debe servir para envío o para facturación');
select throws_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', '   ', 'Ana', '+59171111111', 'L', 'C')$$,
  '23514', null, 'la etiqueta en blanco se rechaza');
select throws_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city, reference_text)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'X', 'Ana', '+59171111111', 'L', 'C', repeat('r', 301))$$,
  '23514', null, 'referencia de más de 300 caracteres');
select throws_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city, country)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'X', 'Ana', '+59171111111', 'L', 'C', 'AR')$$,
  '22023', null, 'un país no habilitado para entregas se rechaza');
select throws_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city, country)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'X', 'Ana', '+59171111111', 'L', 'C', 'XX')$$,
  '22023', null, 'un país que no existe también');

-- Permisos por columna y nada de borrados
select throws_ok($$update public.addresses set profile_id = 'bbbbbbbb-0000-0000-0000-00000000000b' where label = 'Casa'$$,
  '42501', null, 'no se puede entregar una dirección a otro cliente (profile_id no es actualizable)');
select throws_ok($$update public.addresses set created_at = now() where label = 'Casa'$$, '42501', null, 'created_at no es actualizable');
select throws_ok($$delete from public.addresses where label = 'Casa'$$, '42501', null, 'nadie borra direcciones (se archivan)');
select throws_ok($$truncate public.addresses$$, '42501', null, 'tampoco TRUNCATE');

-- Tope: 20 activas. Ya hay 3 (Casa, Oficina, Con pin): 17 más llegan a 20 y la 21.ª se rechaza.
select lives_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city)
  select 'aaaaaaaa-0000-0000-0000-00000000000a', 'Extra ' || i, 'Ana', '+59171111111', 'Calle ' || i, 'La Paz'
    from generate_series(1, 17) i$$, '17 direcciones más: 20 activas');
select is((select count(*)::int from public.addresses where archived_at is null), 20, 'hay exactamente 20 activas');
select throws_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'Una más', 'Ana', '+59171111111', 'L', 'C')$$,
  '23514', null, 'la 21.ª activa se rechaza (tope de 20)');
select throws_ok($$update public.addresses set archived_at = null where label = 'Trabajo'$$,
  '23514', null, 'restaurar una archivada con el tope lleno también se rechaza');
update public.addresses set archived_at = now() where label = 'Extra 17';
select lives_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'Cabe de nuevo', 'Ana', '+59171111111', 'L', 'C')$$,
  'archivar libera un lugar: las archivadas no cuentan para el tope');
select is((select count(*)::int from public.addresses where is_default and archived_at is null), 1, 'tras todo esto sigue habiendo UNA sola predeterminada');
reset role;

-- ═══ B. Beto: nunca ve ni toca lo de Ana (IDOR) ═══════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is((select count(*)::int from public.addresses), 0, 'Beto no ve ninguna dirección de Ana');
select is((select count(*)::int from public.addresses where label = 'Casa'), 0, '…ni consultando por su etiqueta');
select lives_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city)
  values ('bbbbbbbb-0000-0000-0000-00000000000b', 'Casa de Beto', 'Beto Rojas', '+59173333333', 'Av. Busch 5', 'Santa Cruz')$$,
  'Beto crea la suya');
select is((select count(*)::int from public.addresses), 1, 'Beto ve solo la suya');
select throws_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'Intruso', 'Beto', '+59173333333', 'L', 'C')$$,
  '42501', null, 'IDOR: Beto no puede crear una dirección a nombre de Ana (RLS)');
update public.addresses set label = 'Hackeada' where label = 'Casa';
update public.addresses set is_default = true where label = 'Oficina';
select throws_ok($$delete from public.addresses$$, '42501', null, 'Beto tampoco borra');
reset role;
select is((select count(*)::int from public.addresses where label = 'Hackeada'), 0, 'IDOR: el UPDATE de Beto sobre filas de Ana afectó 0 filas');
select is((select count(*)::int from public.addresses where profile_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and is_default and label = 'Oficina'), 0,
  'IDOR: tampoco pudo cambiar su predeterminada');

-- ═══ C. Admin: solo lectura ═══════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
-- Ana: 22 filas (20 activas + «Trabajo» y «Extra 17» archivadas) + 1 de Beto = 23.
select is((select count(*)::int from public.addresses), 23, 'el admin ve TODAS las direcciones (22 de Ana + 1 de Beto)');
update public.addresses set label = 'Admin edita' where label = 'Casa';
select throws_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city)
  values ('bbbbbbbb-0000-0000-0000-00000000000b', 'Del admin', 'Admin', '+59174444444', 'L', 'C')$$,
  '42501', null, 'el admin no crea direcciones a nombre de un cliente (la RLS solo deja insertar al dueño)');
reset role;
select is((select count(*)::int from public.addresses where label = 'Admin edita'), 0, 'el admin no puede editar direcciones de clientes (solo lectura)');

-- ═══ D. anon: sin acceso ══════════════════════════════════════════════════════════════════
set local role anon;
select throws_ok($$select * from public.addresses$$, '42501', null, 'anon no lee direcciones');
select throws_ok($$select * from public.tax_profiles$$, '42501', null, 'anon no lee datos fiscales');
reset role;

-- ═══ E. Cuenta desactivada: no ve ni crea nada ═════════════════════════════════════════════
update public.profiles set is_active = false where id = 'bbbbbbbb-0000-0000-0000-00000000000b';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is((select count(*)::int from public.addresses), 0, 'una cuenta desactivada ya no ve sus direcciones');
select throws_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city)
  values ('bbbbbbbb-0000-0000-0000-00000000000b', 'Nueva', 'Beto', '+59173333333', 'L', 'C')$$,
  '42501', null, '…ni puede crear nuevas');
reset role;
update public.profiles set is_active = true where id = 'bbbbbbbb-0000-0000-0000-00000000000b';

-- ═══ F. Datos fiscales ═══════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select lives_ok($$insert into public.tax_profiles (profile_id, doc_type, doc_number, legal_name)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'ci', '1234567', 'Ana Pérez')$$, 'Ana crea su CI');
select is((select is_default from public.tax_profiles where doc_type = 'ci'), true, 'el primero queda predeterminado');
select lives_ok($$insert into public.tax_profiles (profile_id, doc_type, doc_number, legal_name)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'nit', '1020304050', 'Ana Pérez SRL')$$, 'y un NIT');
select is((select is_default from public.tax_profiles where doc_type = 'nit'), false, 'el segundo no es predeterminado');
update public.tax_profiles set is_default = true where doc_type = 'nit';
select is((select doc_type from public.tax_profiles where is_default), 'nit', 'marcar el NIT mueve la predeterminada');
select is((select count(*)::int from public.tax_profiles where is_default), 1, '…y es una sola');
select lives_ok($$insert into public.tax_profiles (profile_id, doc_type, doc_number, legal_name)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'pas', ' ab12345 ', '  Ana P.  ')$$, 'pasaporte con espacios y minúsculas');
select is((select doc_number from public.tax_profiles where doc_type = 'pas'), 'AB12345', 'el documento se recorta y pasa a mayúsculas');
select is((select legal_name from public.tax_profiles where doc_type = 'pas'), 'Ana P.', 'la razón social se recorta');
select throws_ok($$insert into public.tax_profiles (profile_id, doc_type, doc_number, legal_name)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'ci', '1234567', 'Otra')$$,
  '23505', null, 'el mismo documento no se repite entre los activos de un cliente');
select lives_ok($$insert into public.tax_profiles (profile_id, doc_type, doc_number, legal_name)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'nit', '1234567', 'Mismo número, otro tipo')$$,
  'el mismo número con otro TIPO sí es otro documento');
select throws_ok($$insert into public.tax_profiles (profile_id, doc_type, doc_number, legal_name)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'ci', '<script>', 'X')$$, '23514', null, 'el documento rechaza símbolos (<script>)');
select throws_ok($$insert into public.tax_profiles (profile_id, doc_type, doc_number, legal_name)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'ci', '   ', 'X')$$, '23514', null, 'el documento en blanco se rechaza');
select throws_ok($$insert into public.tax_profiles (profile_id, doc_type, doc_number, legal_name)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'dni', '12345', 'X')$$, '23514', null, 'el tipo de documento debe ser del catálogo');
select throws_ok($$insert into public.tax_profiles (profile_id, doc_type, doc_number, legal_name)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'ci', '7654321', repeat('n', 161))$$, '23514', null, 'razón social de más de 160 caracteres');
-- Archivar y volver a registrar el mismo documento
update public.tax_profiles set archived_at = now() where doc_type = 'ci';
select lives_ok($$insert into public.tax_profiles (profile_id, doc_type, doc_number, legal_name)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'ci', '1234567', 'Ana Pérez (otra vez)')$$,
  'un documento archivado puede registrarse de nuevo (la unicidad es entre activos)');
select throws_ok($$delete from public.tax_profiles$$, '42501', null, 'los datos fiscales tampoco se borran');
-- Tope: 10 activos. Activos ahora: nit 1020304050, pas, nit 1234567, ci 1234567 (nuevo) = 4 → 6 más = 10.
select lives_ok($$insert into public.tax_profiles (profile_id, doc_type, doc_number, legal_name)
  select 'aaaaaaaa-0000-0000-0000-00000000000a', 'otro', 'DOC' || i, 'Ana ' || i from generate_series(1, 6) i$$, '6 más: 10 activos');
select throws_ok($$insert into public.tax_profiles (profile_id, doc_type, doc_number, legal_name)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'otro', 'DOC99', 'X')$$, '23514', null, 'el 11.º activo se rechaza (tope de 10)');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is((select count(*)::int from public.tax_profiles), 0, 'Beto no ve los datos fiscales de Ana');
select lives_ok($$insert into public.tax_profiles (profile_id, doc_type, doc_number, legal_name)
  values ('bbbbbbbb-0000-0000-0000-00000000000b', 'ci', '1234567', 'Beto Rojas')$$, 'el mismo CI en OTRO cliente SÍ se permite');
select throws_ok($$insert into public.tax_profiles (profile_id, doc_type, doc_number, legal_name)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'ci', '9999999', 'Intruso')$$, '42501', null, 'IDOR: no crea datos fiscales a nombre de Ana');
update public.tax_profiles set legal_name = 'Hackeado' where doc_type = 'nit';
reset role;
select is((select count(*)::int from public.tax_profiles where legal_name = 'Hackeado'), 0, 'IDOR: el UPDATE de Beto sobre datos fiscales de Ana afectó 0 filas');

-- ═══ G. Preferencias del perfil ═══════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select lives_ok($$update public.profiles set preferred_locale = 'es', preferred_currency = 'BOB' where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$,
  'Ana fija idioma y moneda preferidos');
select is((select preferred_currency from public.profiles), 'BOB', 'la moneda preferida quedó guardada');
select throws_ok($$update public.profiles set preferred_currency = 'USD' where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$,
  '22023', null, 'una moneda no habilitada se rechaza');
select throws_ok($$update public.profiles set preferred_locale = 'Español' where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$,
  '23514', null, 'el idioma debe ser un código de 2 letras en minúscula');
select lives_ok($$update public.profiles set preferred_currency = null where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$, 'volver a «la de la tienda» (NULL)');
select throws_ok($$update public.profiles set role = 'admin' where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$, '42501', null,
  'seguimos sin poder auto-promovernos (las columnas nuevas no abrieron nada más)');
reset role;

-- ═══ H. Cambio de contacto (solo service_role) ══════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok($$select public.change_profile_contact('aaaaaaaa-0000-0000-0000-00000000000a', 'ana@test.com', '+59175555555')$$, '42501', null,
  'un cliente NO puede cambiar su contacto llamando a la función (pasa por la Edge Function con contraseña)');
reset role;
-- La Edge Function llama con el JWT del service_role (sin `sub`): aquí se deja el contexto igual para que la prueba no
-- herede los claims de la clienta de los bloques anteriores y el actor de la auditoría solo pueda venir de la función.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select lives_ok($$select public.change_profile_contact('aaaaaaaa-0000-0000-0000-00000000000a', 'ana@test.com', '+59175555555')$$, 'service_role cambia el teléfono');
reset role;
select is((select phone_e164 from public.profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a'), '+59175555555', 'el teléfono nuevo quedó guardado');
select is((select email from public.profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a'), 'ana@test.com', '…y el email no cambió');
select is((select count(*)::int from public.audit_log where table_name = 'profiles' and actor_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and diff ? 'phone_e164'), 1,
  'la auditoría registra el cambio de teléfono con la CLIENTE como actora (no «service_role» anónimo)');
select is((select diff -> 'phone_e164' from public.audit_log where table_name = 'profiles' and action = 'UPDATE' and diff ? 'phone_e164'), '{"changed": true}'::jsonb,
  '…sin guardar el teléfono en la auditoría (PII redactada)');
set local role service_role;
select lives_ok($$select public.change_profile_contact('aaaaaaaa-0000-0000-0000-00000000000a', '  ANA.NUEVA@Test.com ', '+59175555555')$$, 'y el email: se normaliza a minúsculas sin espacios');
reset role;
select is((select email from public.profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a'), 'ana.nueva@test.com', 'el email quedó normalizado');
select is((select count(*)::int from public.audit_log where table_name = 'profiles' and actor_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and diff ? 'email'), 1,
  'el cambio de email también se audita con la clienta como actora');
set local role service_role;
select throws_ok($$select public.change_profile_contact('bbbbbbbb-0000-0000-0000-00000000000b', 'beto@test.com', '+59175555555')$$, '23505', null, 'un teléfono que ya usa otra cuenta se rechaza');
select throws_ok($$select public.change_profile_contact('bbbbbbbb-0000-0000-0000-00000000000b', 'ana.nueva@test.com', null)$$, '23505', null, 'un email que ya usa otra cuenta se rechaza');
select throws_ok($$select public.change_profile_contact('bbbbbbbb-0000-0000-0000-00000000000b', 'beto@test.com', '123')$$, '23514', null, 'teléfono con formato inválido rechazado');
select throws_ok($$select public.change_profile_contact('bbbbbbbb-0000-0000-0000-00000000000b', 'no-es-un-email', null)$$, '23514', null, 'email con formato inválido rechazado');
select throws_ok($$select public.change_profile_contact('bbbbbbbb-0000-0000-0000-00000000000b', 'sintetico@phone.madeinchola.invalid', null)$$, '23514', null,
  'el dominio reservado de los correos sintéticos no se puede reclamar');
select throws_ok($$select public.change_profile_contact('eeeeeeee-0000-0000-0000-00000000000e', null, null)$$, '23514', null,
  'una cuenta no puede quedarse sin ningún identificador (ni email ni teléfono)');
select throws_ok($$select public.change_profile_contact('99999999-0000-0000-0000-000000000009', 'x@test.com', null)$$, 'P0002', null, 'perfil inexistente');
select lives_ok($$select public.change_profile_contact('aaaaaaaa-0000-0000-0000-00000000000a', 'ana.nueva@test.com', null)$$, 'quitar el teléfono es posible si queda el email');
reset role;
select is((select phone_e164 from public.profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a'), null, 'el teléfono quedó vacío');

-- ═══ I. Auditoría de direcciones y datos fiscales ═══════════════════════════════════════════
-- (Se busca por `record_id`, no por la etiqueta: la etiqueta también queda redactada.)
select is((select diff ->> 'recipient' from public.audit_log where table_name = 'addresses' and action = 'INSERT'
            and record_id = (select id::text from public.addresses where profile_id = 'aaaaaaaa-0000-0000-0000-00000000000a' order by created_at limit 1)), '[redacted]',
  'al crear una dirección el destinatario queda REDACTADO en la auditoría');
select is((select diff ->> 'line1' from public.audit_log where table_name = 'addresses' and action = 'INSERT'
            and record_id = (select id::text from public.addresses where profile_id = 'aaaaaaaa-0000-0000-0000-00000000000a' order by created_at limit 1)), '[redacted]',
  '…y la línea de dirección también');
select is((select diff ->> 'label' from public.audit_log where table_name = 'addresses' and action = 'INSERT'
            and record_id = (select id::text from public.addresses where profile_id = 'aaaaaaaa-0000-0000-0000-00000000000a' order by created_at limit 1)), '[redacted]',
  '…y la etiqueta (texto libre: «Casa de María Quispe»)');
select is((select diff ->> 'city' from public.audit_log where table_name = 'addresses' and action = 'INSERT'
            and record_id = (select id::text from public.addresses where profile_id = 'aaaaaaaa-0000-0000-0000-00000000000a' order by created_at limit 1)), '[redacted]',
  '…y la ciudad');
select is((select diff ->> 'country' from public.audit_log where table_name = 'addresses' and action = 'INSERT'
            and record_id = (select id::text from public.addresses where profile_id = 'aaaaaaaa-0000-0000-0000-00000000000a' order by created_at limit 1)), 'BO',
  'solo lo que no identifica (el país) queda legible');
select is((select count(*)::int from public.audit_log a
            where a.table_name = 'addresses'
              and exists (select 1 from jsonb_each(a.diff) d
                           where d.key in ('label', 'recipient', 'phone_e164', 'line1', 'line2', 'city', 'department', 'reference_text', 'lat', 'lng')
                             and d.value not in ('"[redacted]"'::jsonb, '{"changed": true}'::jsonb))), 0,
  'ninguna fila de auditoría de direcciones deja un dato personal en claro (ni en altas ni en cambios)');
select is((select diff -> 'doc_number' from public.audit_log where table_name = 'tax_profiles' and action = 'UPDATE' and diff ? 'is_default' and not diff ? 'doc_number' limit 1), null,
  'las actualizaciones que no tocan el documento no lo mencionan');
select ok(exists (select 1 from public.audit_log where table_name = 'tax_profiles' and action = 'INSERT' and diff ->> 'doc_number' = '[redacted]'),
  'el documento fiscal queda redactado en la auditoría');
update public.tax_profiles set doc_number = '7777777'
 where profile_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and doc_type = 'nit' and doc_number = '1020304050';
select is((select diff -> 'doc_number' from public.audit_log
            where table_name = 'tax_profiles' and action = 'UPDATE' and diff ? 'doc_number'
              and record_id = (select id::text from public.tax_profiles where profile_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and doc_number = '7777777')),
  '{"changed": true}'::jsonb, 'el CAMBIO del documento también se audita sin el número (solo «changed»)');

-- ═══ J. Red de seguridad: el índice único impide dos predeterminadas aunque falle la guardia ═══
alter table public.addresses disable trigger addresses_b_default_guard;
insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city, is_default)
  values ('cccccccc-0000-0000-0000-00000000000c', 'Admin 1', 'Admin', '+59177777777', 'L', 'C', true);
select throws_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city, is_default)
  values ('cccccccc-0000-0000-0000-00000000000c', 'Admin 2', 'Admin', '+59177777777', 'L', 'C', true)$$,
  '23505', null, 'sin la guardia, el índice parcial único rechaza una segunda predeterminada activa');
alter table public.addresses enable trigger addresses_b_default_guard;
select throws_ok($$update public.addresses set profile_id = 'bbbbbbbb-0000-0000-0000-00000000000b' where label = 'Admin 1'$$, '42501', null,
  'el dueño de una dirección tampoco se cambia como superusuario: la guardia lo impide');

-- ═══ K. Promoción al archivar: orden determinista (la más reciente por fecha de creación) ═══
insert into public.addresses (id, profile_id, label, recipient, phone_e164, line1, city, is_default, created_at) values
  ('a6000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-00000000000e', 'Vieja',   'Eli', '+59172222222', 'L', 'C', true,  '2026-01-01'),
  ('a6000000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-00000000000e', 'Media',   'Eli', '+59172222222', 'L', 'C', false, '2026-02-01'),
  ('a6000000-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-00000000000e', 'Reciente','Eli', '+59172222222', 'L', 'C', false, '2026-03-01');
update public.addresses set archived_at = now() where label = 'Vieja';
select is((select label from public.addresses where profile_id = 'eeeeeeee-0000-0000-0000-00000000000e' and is_default), 'Reciente',
  'al archivar la predeterminada pasa a serlo la MÁS RECIENTE de las activas (no la media)');

-- ═══ L. Desactivar y anonimizar ═══════════════════════════════════════════════════════════
-- Contexto como en producción: la Edge Function llama con el JWT del service_role (sin `sub`). Sin esto, el `sub` que
-- dejó `change_profile_contact` (set_config de transacción) haría que esta prueba corriera «como Ana».
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(auth.uid(), null, 'el contexto de este bloque no tiene usuario (como la llamada real del service_role)');
-- Sin anonimizar: se conserva todo (solo deja de verse por la RLS).
set local role service_role;
select lives_ok($$select public.deactivate_profile('bbbbbbbb-0000-0000-0000-00000000000b', false)$$, 'desactivar sin anonimizar');
reset role;
select is((select recipient from public.addresses where label = 'Casa de Beto'), 'Beto Rojas', 'sin anonimizar la dirección se conserva tal cual');
select is((select legal_name from public.tax_profiles where profile_id = 'bbbbbbbb-0000-0000-0000-00000000000b'), 'Beto Rojas', '…y los datos fiscales también');
-- Anonimizando (Ana): ni un dato personal queda; los registros se conservan (archivados).
set local role service_role;
select lives_ok($$select public.deactivate_profile('aaaaaaaa-0000-0000-0000-00000000000a', true)$$, 'desactivar y ANONIMIZAR a Ana');
reset role;
select is((select count(*)::int from public.addresses where profile_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and recipient <> 'Anonimizado'), 0, 'ninguna dirección conserva el destinatario');
select is((select count(*)::int from public.addresses where profile_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
                and (phone_e164 is not null or lat is not null or lng is not null or line2 is not null or reference_text is not null or line1 <> '—' or city <> '—')), 0,
  'teléfono, pin, referencia y calle quedaron limpios');
select is((select count(*)::int from public.addresses where profile_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and (archived_at is null or is_default)), 0,
  'todas quedaron archivadas y sin predeterminada');
select is((select count(*)::int from public.addresses where profile_id = 'aaaaaaaa-0000-0000-0000-00000000000a'), 22,
  'NADA se borró: las 22 direcciones de Ana siguen ahí (20 activas + «Trabajo» y «Extra 17» archivadas)');
select is((select count(*)::int from public.tax_profiles where profile_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and (legal_name <> 'Anonimizado' or doc_number <> '000' or archived_at is null)), 0,
  'los datos fiscales de Ana quedaron anonimizados y archivados');
select is((select count(*)::int from public.tax_profiles where profile_id = 'aaaaaaaa-0000-0000-0000-00000000000a'), 11, 'y siguen todos (11 registros: 10 activos + el CI archivado)');
select is((select preferred_currency from public.profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a'), null, 'la moneda preferida también se limpia');
select is((select count(*)::int from public.addresses where profile_id = 'bbbbbbbb-0000-0000-0000-00000000000b' and recipient = 'Anonimizado'), 0, 'anonimizar a Ana no tocó a Beto');
select is((select count(*)::int from public.addresses where profile_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and (label <> 'Anonimizada' or city <> '—' or department is not null)), 0,
  'la etiqueta, la ciudad y el departamento (texto libre) también quedaron anónimos');
select is((select count(*)::int from public.addresses where profile_id = 'bbbbbbbb-0000-0000-0000-00000000000b' and label = 'Casa de Beto'), 1, '…y sin anonimizar (Beto) la etiqueta se conserva');
select ok(not (select raw_user_meta_data ? 'full_name' or raw_user_meta_data ? 'phone_e164' from auth.users where id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
  'GoTrue ya no guarda el nombre ni el teléfono de Ana (raw_user_meta_data)');
select ok((select raw_user_meta_data ? 'full_name' from auth.users where id = 'bbbbbbbb-0000-0000-0000-00000000000b'),
  '…pero los de Beto (desactivado sin anonimizar) siguen');
select is((select count(*)::int from auth.audit_log_entries where payload ->> 'actor_id' = 'aaaaaaaa-0000-0000-0000-00000000000a'
                                                              or payload #>> '{traits,user_id}' = 'aaaaaaaa-0000-0000-0000-00000000000a'), 0,
  'los eventos de GoTrue de Ana (que guardan su email y su nombre) se borraron, tanto los suyos como los que la nombran');
select is((select count(*)::int from auth.audit_log_entries where payload ->> 'actor_id' = 'bbbbbbbb-0000-0000-0000-00000000000b'), 1, '…y los de Beto no');
select is((select count(*)::int from public.audit_log where table_name = 'addresses'
            and exists (select 1 from jsonb_each(diff) d where d.key in ('label', 'city', 'department', 'recipient', 'line1', 'reference_text')
                          and d.value not in ('"[redacted]"'::jsonb, '{"changed": true}'::jsonb))), 0,
  'tras anonimizar, la auditoría de direcciones tampoco guarda ningún valor anterior en claro (ni «La Paz» → «—»)');

-- ═══ M. Ajuste de la tienda: rigor del NIT/CI ════════════════════════════════════════════
select is((select value #>> '{}' from public.store_settings where key = 'tax_id_validation'), 'strict', 'por defecto el rigor es «strict»');
select is((select is_public from public.store_settings where key = 'tax_id_validation'), true, 'el ajuste es público (el formulario lo necesita)');
select lives_ok($$update public.store_settings set value = '"lenient"' where key = 'tax_id_validation'$$, 'se puede pasar a «lenient»');
select throws_ok($$update public.store_settings set value = '"raro"' where key = 'tax_id_validation'$$, '22023', null, 'cualquier otro valor se rechaza');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select value #>> '{}' from public.public_store_settings where key = 'tax_id_validation'), 'lenient', 'anon lo lee por la vista pública');
reset role;

-- ═══ N. Vistas públicas de países y monedas habilitados ══════════════════════════════════════
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select string_agg(code, ',' order by code) from public.public_countries), 'BO', 'anon ve solo los países HABILITADOS (hoy solo Bolivia)');
select is((select string_agg(code, ',' order by code) from public.public_currencies), 'BOB', 'y solo las monedas habilitadas (BOB)');
reset role;
select is((select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'public_countries'),
  'code,currency_code,name', 'public_countries no expone «enabled» ni fechas');
select is((select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'public_currencies'),
  'code,decimals,name,symbol', 'public_currencies no expone «enabled» ni fechas');

-- ═══ O. Candado por SENTENCIA (evita interbloqueos entre peticiones simultáneas del mismo cliente) ═══
select is((select count(*)::int from pg_trigger t where t.tgname in ('addresses_0_lock', 'tax_profiles_0_lock')
            and not t.tgisinternal and (t.tgtype & 1) = 0 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4), 2,
  'addresses y tax_profiles tienen un disparador BEFORE por SENTENCIA (no por fila) para INSERT… (candado de asesoría)');
select is((select count(*)::int from pg_trigger t where t.tgname in ('addresses_0_lock', 'tax_profiles_0_lock')
            and not t.tgisinternal and (t.tgtype & 16) = 16), 2, '…y para UPDATE');
select is((select prosrc ~ 'pg_advisory_xact_lock' from pg_proc where proname = 'account_statement_lock' and pronamespace = 'public'::regnamespace), true,
  'el disparador toma un candado de asesoría que se suelta al terminar la transacción');
select is((select prosrc ~ 'pg_advisory' from pg_proc where proname = 'account_default_guard' and pronamespace = 'public'::regnamespace), false,
  'y la guardia por FILA ya NO toma candados (llegaban tarde y provocaban interbloqueos)');

-- ═══ P. Arreglos de la revisión independiente ══════════════════════════════════════════════
-- P1. La predeterminada no se «quita» a mano: dejaría al cliente sin ninguna aunque tenga otras activas.
select is((select count(*)::int from public.addresses where profile_id = 'eeeeeeee-0000-0000-0000-00000000000e' and archived_at is null), 2,
  'Eli tiene 2 direcciones activas (Media y Reciente; Vieja está archivada)');
update public.addresses set is_default = false where profile_id = 'eeeeeeee-0000-0000-0000-00000000000e' and is_default and archived_at is null;
select is((select label from public.addresses where profile_id = 'eeeeeeee-0000-0000-0000-00000000000e' and is_default and archived_at is null), 'Reciente',
  'poner is_default = false a la única predeterminada no la quita (sigue siendo «Reciente»)');
update public.addresses set is_default = true where id = 'a6000000-0000-0000-0000-000000000002';
select is((select label from public.addresses where profile_id = 'eeeeeeee-0000-0000-0000-00000000000e' and is_default and archived_at is null), 'Media',
  'cambiarla marcando OTRA sigue funcionando (la guardia no se confunde con su propio desmarcado)');
select is((select count(*)::int from public.addresses where profile_id = 'eeeeeeee-0000-0000-0000-00000000000e' and is_default and archived_at is null), 1, '…y queda una sola');
insert into public.tax_profiles (profile_id, doc_type, doc_number, legal_name) values ('eeeeeeee-0000-0000-0000-00000000000e', 'ci', '1234567', 'Eli');
update public.tax_profiles set is_default = false where profile_id = 'eeeeeeee-0000-0000-0000-00000000000e';
select is((select count(*)::int from public.tax_profiles where profile_id = 'eeeeeeee-0000-0000-0000-00000000000e' and is_default), 1,
  'lo mismo en datos fiscales: el único predeterminado no se puede quitar a mano');

-- P2. Una cuenta desactivada no recibe datos nuevos (aunque la RLS se evalúe con la «foto» vieja).
set local role service_role;
select throws_ok($$insert into public.addresses (profile_id, label, recipient, phone_e164, line1, city)
  values ('bbbbbbbb-0000-0000-0000-00000000000b', 'Tarde', 'Beto', '+59173333333', 'L', 'C')$$, '42501', null,
  'no se crea una dirección para una cuenta desactivada (comprobado dentro del disparador, con foto nueva)');
select throws_ok($$insert into public.tax_profiles (profile_id, doc_type, doc_number, legal_name)
  values ('bbbbbbbb-0000-0000-0000-00000000000b', 'ci', '3333333', 'Tarde')$$, '42501', null, '…ni datos fiscales');
reset role;
-- (anonimizar sigue pudiendo actualizar las filas de una cuenta ya desactivada: el chequeo solo es al crear o restaurar)
select is((select count(*)::int from public.addresses where profile_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and recipient = 'Anonimizado'), 22,
  'la anonimización de una cuenta que se desactiva en la misma sentencia sí actualiza sus filas (22 de Ana)');

-- P3. Orden de bloqueos de deactivate_profile: primero los candados del cliente y DESPUÉS la fila del perfil.
select ok((select position('pg_advisory_xact_lock' in prosrc) < position('for update' in prosrc)
             from pg_proc where proname = 'deactivate_profile' and pronamespace = 'public'::regnamespace),
  'deactivate_profile toma los candados ANTES de bloquear la fila del perfil (mismo orden que el cliente: sin ciclo)');

-- P4. Cambio de contacto «comparar y cambiar»: solo se aplica si el perfil sigue como lo leyó la función llamadora.
set local role service_role;
select throws_ok($$select public.change_profile_contact('cccccccc-0000-0000-0000-00000000000c', 'otro@test.com', null,
  '{"email": "no-es-el-actual@test.com", "phone": null}'::jsonb)$$, '40001', null, 'si el perfil cambió desde la lectura, el cambio se rechaza (40001) en vez de pisar al otro');
select throws_ok($$select public.change_profile_contact('cccccccc-0000-0000-0000-00000000000c', 'otro@test.com', null,
  '{"email": "admin@test.com", "phone": "+59170000000"}'::jsonb)$$, '40001', null, 'se compara TAMBIÉN el teléfono: el email coincide pero el teléfono leído no es el actual → 40001');
select throws_ok($$select public.change_profile_contact('cccccccc-0000-0000-0000-00000000000c', 'otro@test.com', null,
  '{"email": null, "phone": null}'::jsonb)$$, '40001', null, 'y el email: el teléfono coincide pero el email leído no es el actual → 40001');
select lives_ok($$select public.change_profile_contact('cccccccc-0000-0000-0000-00000000000c', 'otro@test.com', null,
  '{"email": "admin@test.com", "phone": null}'::jsonb)$$, 'si sigue como se leyó, se aplica');
select throws_ok($$select public.change_profile_contact('cccccccc-0000-0000-0000-00000000000c', 'admin@test.com', null,
  '{"email": "admin@test.com", "phone": null}'::jsonb)$$, '40001', null, 'deshacer con el valor VIEJO como esperado falla si el perfil ya cambió (no se deshace lo que no es suyo)');
select lives_ok($$select public.change_profile_contact('cccccccc-0000-0000-0000-00000000000c', 'admin@test.com', null,
  '{"email": "otro@test.com", "phone": null}'::jsonb)$$, 'deshacer con el valor NUEVO como esperado sí funciona');
select throws_ok($$select public.change_profile_contact('99999999-0000-0000-0000-000000000009', 'x@test.com', null,
  '{"email": null, "phone": null}'::jsonb)$$, 'P0002', null, 'un perfil inexistente sigue dando P0002 (no 40001)');
reset role;

select * from finish();
rollback;
