-- Sprint 1 · audit_log: trigger genérico, redacción de PII, inmutabilidad y acceso.
begin;
select plan(22);

-- HERMÉTICO: el test parte de una BD vacía DENTRO de su transacción (se revierte al final con el rollback),
-- así no depende de los usuarios del seed ni de datos de pruebas anteriores, y no los toca.
delete from public.profiles;
alter table public.audit_log disable trigger audit_log_no_change;
delete from public.audit_log;
alter table public.audit_log enable trigger audit_log_no_change;
delete from auth.users;
delete from public.rate_limits;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'ana@test.com',   '{"full_name":"Ana Secreta"}', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-00000000000c', 'admin@test.com', '{"full_name":"Admin"}',       'authenticated', 'authenticated');
select public.set_user_role('cccccccc-0000-0000-0000-00000000000c', 'admin');
delete from public.audit_log where false; -- (no-op: confirma que DELETE sin filas no revienta)

-- Tabla de ejemplo con el trigger genérico y una columna sensible
create table public.audit_demo (id uuid primary key default gen_random_uuid(), name text, secret text, updated_at timestamptz default now());
create trigger audit_demo after insert or update or delete on public.audit_demo
  for each row execute function public.audit_changes('secret');

insert into public.audit_demo (id, name, secret) values ('99999999-0000-0000-0000-000000000001', 'uno', 'TOKEN-SUPER-SECRETO');
select is((select count(*)::int from public.audit_log where table_name = 'audit_demo' and action = 'INSERT'), 1, 'INSERT genera una fila de auditoría');
select is((select diff ->> 'name' from public.audit_log where table_name = 'audit_demo' and action = 'INSERT'), 'uno', 'el INSERT registra los valores');
select is((select record_id from public.audit_log where table_name = 'audit_demo' and action = 'INSERT'), '99999999-0000-0000-0000-000000000001', 'registra el id del registro');

update public.audit_demo set name = 'dos' where id = '99999999-0000-0000-0000-000000000001';
select is((select diff from public.audit_log where table_name = 'audit_demo' and action = 'UPDATE'),
          '{"name": {"old": "uno", "new": "dos"}}'::jsonb, 'UPDATE registra SOLO las columnas que cambiaron, con old/new');

update public.audit_demo set name = name where id = '99999999-0000-0000-0000-000000000001';
select is((select count(*)::int from public.audit_log where table_name = 'audit_demo' and action = 'UPDATE'), 1, 'un UPDATE sin cambios reales NO genera ruido');

update public.audit_demo set secret = 'OTRO-SECRETO-NUEVO' where id = '99999999-0000-0000-0000-000000000001';
select is((select diff from public.audit_log where table_name = 'audit_demo' and action = 'UPDATE' order by id desc limit 1),
          '{"secret": {"changed": true}}'::jsonb, 'columna sensible: se registra que cambió, no su valor');

delete from public.audit_demo where id = '99999999-0000-0000-0000-000000000001';
select is((select count(*)::int from public.audit_log where table_name = 'audit_demo' and action = 'DELETE'), 1, 'DELETE genera fila');
select is((select diff ->> 'name' from public.audit_log where table_name = 'audit_demo' and action = 'DELETE'), 'dos', 'DELETE conserva el valor anterior');
select is((select count(*)::int from public.audit_log where diff::text like '%SECRETO%'), 0, 'NINGÚN secreto aparece en todo el log (insert/update/delete)');

-- Perfiles auditados con PII redactada
update public.profiles set role = 'customer' where false;
select is((select diff -> 'role' from public.audit_log where table_name = 'profiles' and action = 'UPDATE' and record_id = 'cccccccc-0000-0000-0000-00000000000c'),
          '{"old": "customer", "new": "admin"}'::jsonb, 'cambio de rol queda auditado con old/new');
select is((select actor_role from public.audit_log where table_name = 'profiles' and action = 'UPDATE' and record_id = 'cccccccc-0000-0000-0000-00000000000c'),
          'postgres', 'actor_role registra quién lo hizo cuando no hay JWT');
select is((select count(*)::int from public.audit_log where table_name = 'profiles' and action = 'INSERT'), 2, 'el alta de cada perfil queda auditada');
select is((select count(*)::int from public.audit_log where table_name = 'profiles' and (diff::text like '%ana@test.com%' or diff::text like '%Ana Secreta%')), 0,
          'email y nombre del cliente NO se guardan en el log (inmutable ⇒ no podríamos anonimizarlo)');

-- Un cliente edita su nombre: queda la huella con su actor_id
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
update public.profiles set full_name = 'Ana Nueva' where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
reset role;
select is((select actor_id::text from public.audit_log where table_name = 'profiles' and action = 'UPDATE' and diff ? 'full_name'), 'aaaaaaaa-0000-0000-0000-00000000000a', 'actor_id = el cliente que cambió su nombre');
select is((select diff -> 'full_name' from public.audit_log where table_name = 'profiles' and action = 'UPDATE' and diff ? 'full_name'), '{"changed": true}'::jsonb, 'su nombre no se copia al log');

-- Inmutabilidad (incluso para el dueño de la tabla)
select throws_ok($$update public.audit_log set action = 'DELETE'$$, '42501', 'audit_log es inmutable', 'UPDATE sobre audit_log bloqueado');
select throws_ok($$delete from public.audit_log$$, '42501', 'audit_log es inmutable', 'DELETE sobre audit_log bloqueado');
select throws_ok($$truncate public.audit_log$$, '42501', 'audit_log es inmutable', 'TRUNCATE sobre audit_log bloqueado');

-- Acceso por rol
set local role anon;
select throws_ok($$select * from public.audit_log$$, '42501', null, 'anon NO lee audit_log');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((select count(*)::int from public.audit_log), 0, 'cliente ve 0 filas de audit_log (RLS)');
select throws_ok($$insert into public.audit_log (actor_role, table_name, action, diff) values ('x','x','INSERT','{}')$$, '42501', null, 'cliente NO puede escribir audit_log');
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select ok((select count(*)::int from public.audit_log) > 0, 'admin SÍ lee audit_log');
reset role;

select * from finish();
rollback;
