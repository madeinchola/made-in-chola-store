-- Sprint 1 · Rate limiting atómico (ventana fija) para login, registro, etc.
-- Rollback: select cron.unschedule('rate_limits_cleanup'); drop function public.check_rate_limit(text,int,int),
--   public.reset_rate_limit(text); drop table public.rate_limits;

create table if not exists public.rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  hits         integer not null default 0
);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from public, anon, authenticated;
-- Sin políticas: solo service_role (Edge Functions) accede.

-- Cuenta el intento y dice si está permitido. UN solo upsert: es atómico bajo concurrencia.
-- Los intentos que exceden el máximo también se cuentan (no reinician la ventana).
create or replace function public.check_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns table (allowed boolean, hit_count integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits  integer;
  v_start timestamptz;
begin
  if p_key is null or p_key = '' or p_max < 1 or p_window_seconds < 1 then
    raise exception 'check_rate_limit: parámetros inválidos' using errcode = '22023';
  end if;

  insert into public.rate_limits as rl (key, window_start, hits)
  values (p_key, clock_timestamp(), 1)
  on conflict (key) do update set
    hits = case when rl.window_start <= clock_timestamp() - make_interval(secs => p_window_seconds)
                then 1 else rl.hits + 1 end,
    window_start = case when rl.window_start <= clock_timestamp() - make_interval(secs => p_window_seconds)
                        then clock_timestamp() else rl.window_start end
  returning rl.hits, rl.window_start into v_hits, v_start;

  return query select
    v_hits <= p_max,
    v_hits,
    greatest(0, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - clock_timestamp()))))::integer;
end;
$$;

create or replace function public.reset_rate_limit(p_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.rate_limits where key = p_key;
$$;

revoke all on function public.check_rate_limit(text, integer, integer), public.reset_rate_limit(text)
  from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer), public.reset_rate_limit(text)
  to service_role;

-- Limpieza diaria de ventanas viejas (si pg_cron no existe en el entorno, no rompe la migración).
do $$
begin
  perform cron.schedule(
    'rate_limits_cleanup', '17 3 * * *',
    $job$delete from public.rate_limits where window_start < now() - interval '1 day'$job$);
exception when others then
  raise notice 'pg_cron no disponible; limpieza de rate_limits no programada: %', sqlerrm;
end $$;
