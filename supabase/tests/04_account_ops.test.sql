-- Sprint 1 · promote/demote, resolve_login_email, desactivación/anonimización.
begin;
select plan(29);

-- HERMÉTICO: el test parte de una BD vacía DENTRO de su transacción (se revierte al final con el rollback),
-- así no depende de los usuarios del seed ni de datos de pruebas anteriores, y no los toca.
delete from public.profiles;
alter table public.audit_log disable trigger audit_log_no_change;
delete from public.audit_log;
alter table public.audit_log enable trigger audit_log_no_change;
delete from auth.users;
delete from public.rate_limits;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'ana@test.com',   '{"full_name":"Ana","phone_e164":"+59171111111"}', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'beto@test.com',  '{"full_name":"Beto"}', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-00000000000c', 'admin@test.com', '{"full_name":"Admin"}', 'authenticated', 'authenticated'),
  ('ffffffff-0000-0000-0000-00000000000f', '59172222222@phone.madeinchola.invalid', '{"full_name":"Solo Tel","phone_e164":"+59172222222"}', 'authenticated', 'authenticated');

-- promote_admin
select is(public.promote_admin('  ADMIN@Test.com '), 'cccccccc-0000-0000-0000-00000000000c'::uuid, 'promote_admin normaliza mayúsculas/espacios');
select is((select role from public.profiles where email = 'admin@test.com'), 'admin', '…y asigna el rol');
select throws_ok($$select public.promote_admin('nadie@test.com')$$, 'P0002', null, 'email inexistente → error claro');
select throws_ok($$select public.set_user_role('aaaaaaaa-0000-0000-0000-00000000000a', 'root')$$, '22023', null, 'rol inválido rechazado');
select throws_ok($$select public.set_user_role(gen_random_uuid(), 'admin')$$, 'P0002', null, 'perfil inexistente rechazado');
select throws_ok($$select public.set_user_role('cccccccc-0000-0000-0000-00000000000c', 'customer')$$, 'P0001', null, 'NO se puede degradar al último admin');
select lives_ok($$select public.promote_admin('beto@test.com')$$, 'promover a un segundo admin');
select lives_ok($$select public.set_user_role('cccccccc-0000-0000-0000-00000000000c', 'customer')$$, 'con 2 admins, uno sí puede degradarse');

-- resolve_login_email
select is(public.resolve_login_email('email', 'ana@test.com'), 'ana@test.com', 'resuelve por email');
select is(public.resolve_login_email('phone', '+59171111111'), 'ana@test.com', 'usuario con email Y teléfono: por teléfono resuelve su email real');
select is(public.resolve_login_email('phone', '+59172222222'), '59172222222@phone.madeinchola.invalid', 'solo-teléfono: resuelve al email sintético');
select is(public.resolve_login_email('email', 'nadie@test.com'), null, 'desconocido → NULL');
select is(public.resolve_login_email('phone', '+59179999999'), null, 'teléfono desconocido → NULL');
select is(public.resolve_login_email('email', 'ANA@test.com'), null, 'espera valor ya normalizado (la normalización es del llamador)');
select is(public.resolve_login_email('otro', 'ana@test.com'), null, 'tipo de identificador desconocido → NULL');
select is(public.resolve_login_email('email', '59172222222@phone.madeinchola.invalid'), null, 'el email sintético NO sirve para loguearse como email');

-- desactivación
select lives_ok($$select public.deactivate_profile('aaaaaaaa-0000-0000-0000-00000000000a', false)$$, 'desactivar cuenta');
select is((select is_active from public.profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a'), false, '…queda inactiva');
select is((select email from public.profiles where id = 'aaaaaaaa-0000-0000-0000-00000000000a'), 'ana@test.com', '…sin anonimizar conserva sus datos');
select is(public.resolve_login_email('email', 'ana@test.com'), null, 'cuenta desactivada NO resuelve para login');
select is(public.resolve_login_email('phone', '+59171111111'), null, '…tampoco por teléfono');

-- anonimización (BR-ACC-07)
select lives_ok($$select public.deactivate_profile('ffffffff-0000-0000-0000-00000000000f', true)$$, 'desactivar + anonimizar');
select is((select row(full_name, email, phone_e164)::text from public.profiles where id = 'ffffffff-0000-0000-0000-00000000000f'),
          '("Cliente anonimizado",,)', 'PII eliminada');
select isnt((select anonymized_at from public.profiles where id = 'ffffffff-0000-0000-0000-00000000000f'), null, 'queda marca de anonimización');
select is((select count(*)::int from public.profiles where id = 'ffffffff-0000-0000-0000-00000000000f'), 1, 'la fila se CONSERVA (pedidos/contabilidad)');
select lives_ok(
  $$insert into auth.users (id, email, raw_user_meta_data, aud, role) values ('22222222-0000-0000-0000-000000000002','nuevo@test.com','{"phone_e164":"+59172222222"}','authenticated','authenticated')$$,
  'el teléfono anonimizado queda libre para registrarse de nuevo');

-- último admin
select throws_ok($$select public.deactivate_profile('bbbbbbbb-0000-0000-0000-00000000000b', false)$$, 'P0001', null, 'NO se puede desactivar al último admin');
select throws_ok($$select public.deactivate_profile(gen_random_uuid(), false)$$, 'P0002', null, 'perfil inexistente rechazado');

-- sincronización de email Auth → profile
update auth.users set email = 'Ana.Nueva@Test.com' where id = 'bbbbbbbb-0000-0000-0000-00000000000b';
select is((select email from public.profiles where id = 'bbbbbbbb-0000-0000-0000-00000000000b'), 'ana.nueva@test.com', 'cambio de email en Auth se refleja normalizado en profiles');

select * from finish();
rollback;
