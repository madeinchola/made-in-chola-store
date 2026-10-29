-- Sprint 1 · profiles: alta automática, restricciones y matriz RLS (anon / cliente A / cliente B / admin).
begin;
select plan(46);

-- HERMÉTICO: el test parte de una BD vacía DENTRO de su transacción (se revierte al final con el rollback),
-- así no depende de los usuarios del seed ni de datos de pruebas anteriores, y no los toca.
delete from public.profiles;
alter table public.audit_log disable trigger audit_log_no_change;
delete from public.audit_log;
alter table public.audit_log enable trigger audit_log_no_change;
delete from auth.users;
delete from public.rate_limits;

-- ── Datos de prueba (como postgres) ────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'ana@test.com',   '{"full_name":"Ana","phone_e164":"+59171111111"}', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'beto@test.com',  '{"full_name":"Beto"}',                           'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-00000000000c', 'admin@test.com', '{"full_name":"Admin Uno"}',                      'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-00000000000d', 'admin2@test.com','{"full_name":"Admin Dos"}',                      'authenticated', 'authenticated'),
  -- Intento de auto-asignarse admin vía user_metadata (que el usuario controla):
  ('eeeeeeee-0000-0000-0000-00000000000e', 'evil@test.com',  '{"full_name":"Evil","role":"admin"}',            'authenticated', 'authenticated'),
  -- Usuario solo-teléfono: Auth recibe un email sintético (.invalid) que NO debe quedar en profiles.
  ('ffffffff-0000-0000-0000-00000000000f', '59172222222@phone.madeinchola.invalid', '{"full_name":"Solo Tel","phone_e164":"+59172222222"}', 'authenticated', 'authenticated');

select public.set_user_role('cccccccc-0000-0000-0000-00000000000c', 'admin');
select public.set_user_role('dddddddd-0000-0000-0000-00000000000d', 'admin');

-- ── Alta automática ────────────────────────────────────────────────────────────────────────
select is((select count(*)::int from public.profiles), 6, 'el trigger creó un perfil por cada usuario de Auth');
select is((select role from public.profiles where email = 'ana@test.com'), 'customer', 'rol por defecto = customer');
select is((select role from public.profiles where email = 'evil@test.com'), 'customer', 'user_metadata.role=admin se IGNORA (no hay auto-promoción)');
select is((select phone_e164 from public.profiles where email = 'ana@test.com'), '+59171111111', 'el teléfono de metadata se copia al perfil');
select is((select email from public.profiles where id = 'ffffffff-0000-0000-0000-00000000000f'), null, 'el email sintético .invalid no se guarda en profiles');
select is((select phone_e164 from public.profiles where id = 'ffffffff-0000-0000-0000-00000000000f'), '+59172222222', 'usuario solo-teléfono conserva su teléfono');

-- ── Restricciones ──────────────────────────────────────────────────────────────────────────
select throws_ok(
  $$insert into auth.users (id, aud, role) values ('11111111-0000-0000-0000-000000000001','authenticated','authenticated')$$,
  '23514', null, 'sin email ni teléfono no se crea cuenta (CHECK de identificador)');
select throws_ok(
  $$insert into auth.users (id, email, raw_user_meta_data, aud, role) values ('11111111-0000-0000-0000-000000000002','otro@test.com','{"phone_e164":"+59171111111"}','authenticated','authenticated')$$,
  '23505', null, 'teléfono duplicado rechazado');
select throws_ok(
  $$insert into auth.users (id, email, aud, role) values ('11111111-0000-0000-0000-000000000003','ANA@Test.com','authenticated','authenticated')$$,
  '23505', null, 'email duplicado con distinto case rechazado');
select throws_ok(
  $$insert into auth.users (id, email, raw_user_meta_data, aud, role) values ('11111111-0000-0000-0000-000000000004','x1@test.com','{"phone_e164":"71111111"}','authenticated','authenticated')$$,
  '23514', null, 'teléfono sin formato E.164 rechazado');
select throws_ok(
  $$insert into auth.users (id, email, raw_user_meta_data, aud, role) values ('11111111-0000-0000-0000-000000000005','x2@test.com','{"phone_e164":"+0123456789"}','authenticated','authenticated')$$,
  '23514', null, 'E.164 que empieza en 0 rechazado');
select throws_ok(
  $$update public.profiles set role = 'superadmin' where email = 'ana@test.com'$$,
  '23514', null, 'rol fuera del catálogo rechazado');
select throws_ok(
  $$update public.profiles set full_name = '   ' where email = 'ana@test.com'$$,
  '23514', null, 'nombre vacío rechazado');

-- ── Helpers de autorización ────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is(public.is_admin(), false, 'is_admin() = false para un cliente');
select is(public.current_app_role(), 'customer', 'current_app_role() = customer');
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is(public.is_admin(), true, 'is_admin() = true para un admin');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(public.is_admin(), false, 'is_admin() = false para anon');
select is(public.current_app_role(), null, 'current_app_role() = null para anon');
reset role;

-- ── MATRIZ RLS ─────────────────────────────────────────────────────────────────────────────
-- anon: sin acceso alguno
set local role anon;
select throws_ok($$select * from public.profiles$$, '42501', null, 'anon NO puede leer profiles');
select throws_ok($$update public.profiles set full_name = 'x'$$, '42501', null, 'anon NO puede actualizar profiles');
select throws_ok($$insert into public.profiles (id, full_name, email) values (gen_random_uuid(), 'x', 'x@x.com')$$, '42501', null, 'anon NO puede insertar profiles');
reset role;

-- cliente A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((select count(*)::int from public.profiles), 1, 'cliente A ve solo 1 perfil (el suyo)');
select is((select email from public.profiles), 'ana@test.com', '…y es el suyo');
select is((select count(*)::int from public.profiles where id = 'bbbbbbbb-0000-0000-0000-00000000000b'), 0, 'cliente A NO ve el perfil de B');
select lives_ok($$update public.profiles set full_name = 'Ana María' where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$, 'cliente A puede editar su nombre');
select is((select full_name from public.profiles), 'Ana María', '…y el cambio quedó guardado');
update public.profiles set full_name = 'Hackeado' where id = 'bbbbbbbb-0000-0000-0000-00000000000b';
select is((select count(*)::int from public.profiles where full_name = 'Hackeado'), 0, 'cliente A no puede editar a B (0 filas afectadas)');
-- escalada de privilegios
select throws_ok($$update public.profiles set role = 'admin' where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$, '42501', null, 'ESCALADA: update role=admin sobre sí mismo → denegado');
select throws_ok($$update public.profiles set is_active = true where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$, '42501', null, 'cliente no puede tocar is_active');
select throws_ok($$update public.profiles set blacklisted = false where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$, '42501', null, 'cliente no puede tocar blacklisted');
select throws_ok($$update public.profiles set email = 'otro@x.com' where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$, '42501', null, 'cliente no puede cambiar email directo en profiles');
select throws_ok($$update public.profiles set id = gen_random_uuid() where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$, '42501', null, 'cliente no puede cambiar id');
select throws_ok($$delete from public.profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$, '42501', null, 'cliente no puede borrar (nada se borra)');
select throws_ok($$insert into public.profiles (id, full_name, email) values (gen_random_uuid(), 'x', 'x@x.com')$$, '42501', null, 'cliente no puede insertar perfiles');
select throws_ok($$select public.set_user_role('aaaaaaaa-0000-0000-0000-00000000000a', 'admin')$$, '42501', null, 'cliente NO puede ejecutar set_user_role');
select throws_ok($$select public.promote_admin('ana@test.com')$$, '42501', null, 'cliente NO puede ejecutar promote_admin');
reset role;

-- admin
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is((select count(*)::int from public.profiles), 6, 'admin ve todos los perfiles');
update public.profiles set full_name = 'Admin cambia a Beto' where id = 'bbbbbbbb-0000-0000-0000-00000000000b';
select is((select count(*)::int from public.profiles where full_name = 'Admin cambia a Beto'), 0, 'admin no edita perfiles ajenos por esta vía (se hará por RPC auditada)');
select throws_ok($$update public.profiles set role = 'admin' where id = 'bbbbbbbb-0000-0000-0000-00000000000b'$$, '42501', null, 'admin tampoco asigna roles desde el cliente');
reset role;

-- ── Degradar a un admin con sesión abierta: efecto inmediato ────────────────────────────────
select public.set_user_role('dddddddd-0000-0000-0000-00000000000d', 'customer');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select is(public.is_admin(), false, 'admin degradado pierde permisos YA (mismo JWT, se reevalúa en servidor)');
select is((select count(*)::int from public.profiles), 1, '…y deja de ver perfiles ajenos');
reset role;

-- ── Admin DESACTIVADO con sesión abierta: no conserva poderes de admin ──────────────────────
update public.profiles set is_active = false where id = 'cccccccc-0000-0000-0000-00000000000c';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is(public.is_admin(), false, 'admin desactivado deja de ser admin al instante');
select is(public.current_app_role(), null, '…y su rol efectivo es null');
select is((select count(*)::int from public.profiles), 0, '…y ya no ve ni su perfil ni el de otros');
reset role;
update public.profiles set is_active = true where id = 'cccccccc-0000-0000-0000-00000000000c';

-- ── Cuenta desactivada con sesión abierta ───────────────────────────────────────────────────
update public.profiles set is_active = false where email = 'beto@test.com';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is((select count(*)::int from public.profiles), 0, 'cuenta desactivada: su sesión ya no lee ni su propio perfil');
select is(public.current_app_role(), null, '…y current_app_role() = null');
reset role;

select * from finish();
rollback;
