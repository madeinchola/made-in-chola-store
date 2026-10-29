-- Sprint 1 · BR-ADM-03: registro de auditoría inmutable + trigger genérico reutilizable.
-- Rollback: drop trigger audit_profiles on public.profiles; drop function public.audit_changes(),
--   public.audit_log_immutable(); drop table public.audit_log;

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid,
  actor_role  text not null,
  table_name  text not null,
  record_id   text,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  diff        jsonb not null
);
create index if not exists audit_log_record_idx on public.audit_log (table_name, record_id, occurred_at desc);
create index if not exists audit_log_time_idx on public.audit_log (occurred_at desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from public, anon, authenticated;
grant select on public.audit_log to authenticated;

drop policy if exists audit_log_select_admin on public.audit_log;
create policy audit_log_select_admin on public.audit_log for select to authenticated
  using (public.is_admin());

-- Libro mayor: nadie (ni siquiera service_role) modifica ni borra filas.
create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log es inmutable' using errcode = '42501';
end;
$$;

drop trigger if exists audit_log_no_change on public.audit_log;
create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();
drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();

-- Trigger genérico. Uso:
--   create trigger audit_xxx after insert or update or delete on public.xxx
--     for each row execute function public.audit_changes('columna_pii_1', 'columna_pii_2');
-- Los argumentos son columnas con datos personales: se registra QUE cambiaron, nunca su valor
-- (el log es inmutable, así que la anonimización BR-ACC-07 no sería posible si guardara PII).
create or replace function public.audit_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redact text[] := coalesce(tg_argv, '{}'::text[]);
  v_old    jsonb;
  v_new    jsonb;
  v_diff   jsonb := '{}'::jsonb;
  v_key    text;
  v_row    jsonb;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_row := v_new;
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key <> 'updated_at' then
        v_diff := v_diff || jsonb_build_object(
          v_key, case when v_key = any (v_redact) then '"[redacted]"'::jsonb else v_new -> v_key end);
      end if;
    end loop;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_row := v_new;
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key <> 'updated_at' and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_diff := v_diff || jsonb_build_object(
          v_key,
          case when v_key = any (v_redact)
               then jsonb_build_object('changed', true)
               else jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key) end);
      end if;
    end loop;
    if v_diff = '{}'::jsonb then
      return new;  -- solo cambió updated_at: no es un cambio relevante
    end if;
  else
    v_old := to_jsonb(old);
    v_row := v_old;
    for v_key in select jsonb_object_keys(v_old) loop
      v_diff := v_diff || jsonb_build_object(
        v_key, case when v_key = any (v_redact) then '"[redacted]"'::jsonb else v_old -> v_key end);
    end loop;
  end if;

  insert into public.audit_log (actor_id, actor_role, table_name, record_id, action, diff)
  values (
    auth.uid(),
    coalesce(auth.jwt() ->> 'role', current_user),
    tg_table_name,
    v_row ->> 'id',
    tg_op,
    v_diff
  );
  return coalesce(new, old);
end;
$$;

revoke all on function public.audit_changes() from public, anon, authenticated;

drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles after insert or update or delete on public.profiles
  for each row execute function public.audit_changes('full_name', 'email', 'phone_e164');
