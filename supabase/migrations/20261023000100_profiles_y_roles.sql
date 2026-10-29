-- Sprint 1 · Identidad: profiles, roles, helpers de RLS.
-- Rollback (manual, orden inverso):
--   drop trigger if exists on_auth_user_email_changed on auth.users;
--   drop trigger if exists on_auth_user_created on auth.users;
--   drop function if exists public.handle_auth_email_change(), public.handle_new_user(),
--     public.current_app_role(), public.is_admin(), public.set_updated_at();
--   drop table if exists public.profiles;

-- DENY-BY-DEFAULT: Supabase concede por defecto ALL a anon/authenticated sobre todo objeto nuevo en
-- `public`. Se revoca para que cada tabla/función futura deba conceder permisos de forma EXPLÍCITA.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete restrict,
  full_name     text not null,
  email         text,
  phone_e164    text,
  role          text not null default 'customer',
  is_active     boolean not null default true,
  blacklisted   boolean not null default false,
  anonymized_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint profiles_full_name_len  check (char_length(btrim(full_name)) between 1 and 120),
  constraint profiles_role_valid     check (role in ('customer', 'admin')),
  -- El email se guarda ya normalizado (minúsculas, sin espacios); el correo sintético de usuarios
  -- solo-teléfono (dominio .invalid) NUNCA se guarda aquí.
  constraint profiles_email_format   check (
    email is null or (
      email = lower(btrim(email))
      and char_length(email) <= 254
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      and email !~ '\.invalid$'
    )
  ),
  constraint profiles_phone_e164     check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  -- BR-ACC-02: se identifica por email o teléfono. Una cuenta anonimizada (BR-ACC-07) ya no tiene ninguno.
  constraint profiles_identifier     check (email is not null or phone_e164 is not null or anonymized_at is not null)
);

create unique index if not exists profiles_email_key on public.profiles (email) where email is not null;
create unique index if not exists profiles_phone_key on public.profiles (phone_e164) where phone_e164 is not null;
create index if not exists profiles_role_idx on public.profiles (role) where role <> 'customer';

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ── Helpers de autorización ────────────────────────────────────────────────────────────────
-- SECURITY DEFINER + search_path vacío: leen `profiles` sin depender de la RLS del llamador (evita
-- recursión en las propias políticas) y no pueden ser secuestradas con un search_path malicioso.
-- Se reevalúan en CADA consulta: degradar a un admin surte efecto de inmediato, aunque su JWT siga vigente.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role = 'admin' and p.is_active from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.is_active then p.role else null end from public.profiles p where p.id = auth.uid();
$$;

revoke all on function public.is_admin(), public.current_app_role() from public;
grant execute on function public.is_admin(), public.current_app_role() to anon, authenticated, service_role;

-- ── Alta automática de perfil ──────────────────────────────────────────────────────────────
-- El rol SIEMPRE es 'customer': nunca se lee de user_metadata (que el propio usuario puede editar).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta  jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_email text := lower(btrim(coalesce(new.email, '')));
begin
  insert into public.profiles (id, full_name, email, phone_e164)
  values (
    new.id,
    coalesce(nullif(btrim(meta ->> 'full_name'), ''), 'Cliente'),
    case when v_email = '' or v_email like '%.invalid' then null else v_email end,
    nullif(meta ->> 'phone_e164', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Si el email de Auth cambia (p. ej. un usuario solo-teléfono añade correo) el perfil se mantiene
-- sincronizado. Si el nuevo email ya pertenece a otra cuenta, el índice único aborta el cambio completo.
create or replace function public.handle_auth_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(new.email, '')));
begin
  update public.profiles
     set email = case when v_email = '' or v_email like '%.invalid' then null else v_email end
   where id = new.id and anonymized_at is null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_auth_email_change();

-- ── RLS + permisos por columna ─────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
-- Un cliente solo puede editar su nombre. role / is_active / blacklisted / email / teléfono NO son
-- actualizables desde el cliente (permiso por columna: más fuerte que un trigger).
grant update (full_name) on public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = auth.uid() and is_active);

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles for select to authenticated
  using (public.is_admin());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid() and is_active)
  with check (id = auth.uid() and is_active);
-- Sin políticas de INSERT/DELETE: los perfiles los crea el trigger y nunca se borran (BR-DAT-01).
