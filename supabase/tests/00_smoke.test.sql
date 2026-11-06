-- pgTAP · se ejecuta contra la base de la nube con psql (necesita la extensión pgtap y SUPABASE_DB_URL).
begin;
select plan(7);

select has_extension('pgcrypto', 'pgcrypto habilitada');
select has_extension('pg_trgm', 'pg_trgm habilitada');
select has_extension('unaccent', 'unaccent habilitada');
select has_function('public', 'healthcheck', 'existe public.healthcheck()');

select is((public.healthcheck() ->> 'ok')::boolean, true, 'healthcheck responde ok');
select is(public.healthcheck() ->> 'timezone', 'UTC', 'la sesión está en UTC');

-- anon puede ejecutarlo y no puede nada más por esta vía (deny-by-default).
select ok(
  has_function_privilege('anon', 'public.healthcheck()', 'execute'),
  'anon puede ejecutar healthcheck'
);

select * from finish();
rollback;
