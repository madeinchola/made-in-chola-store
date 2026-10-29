-- Sprint 0 · Extensiones base + función de humo.
-- Convención: YYYYMMDD_nombre.sql · idempotente · rollback documentado al final.
-- Zona horaria: la BD trabaja en UTC; la conversión a America/La_Paz ocurre solo al mostrar.

create schema if not exists extensions;

create extension if not exists pgcrypto  with schema extensions;
create extension if not exists pg_trgm   with schema extensions;
create extension if not exists unaccent  with schema extensions;
-- pg_cron solo existe en el esquema que Supabase indica; se habilita sin romper si el entorno no lo ofrece.
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron no disponible en este entorno: %', sqlerrm;
end $$;

alter database postgres set timezone to 'UTC';

-- Función de humo: confirma que la BD responde y está en UTC. Sin datos sensibles.
create or replace function public.healthcheck()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'ok', true,
    'timezone', current_setting('TimeZone'),
    'server_time_utc', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
$$;

revoke all on function public.healthcheck() from public;
grant execute on function public.healthcheck() to anon, authenticated;

-- ROLLBACK (manual):
--   drop function if exists public.healthcheck();
--   alter database postgres reset timezone;
--   (las extensiones se dejan: otras migraciones pueden depender de ellas)
