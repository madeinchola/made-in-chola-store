-- Sprint 1 · Operaciones solo-servicio: roles, resolución de login, desactivación.
-- TODAS son SECURITY DEFINER con search_path fijo y EXECUTE únicamente para service_role:
-- jamás se pueden invocar desde el navegador (S-01: el rol admin no se asigna desde el front).
-- Rollback: drop function public.set_user_role(uuid,text), public.promote_admin(text),
--   public.resolve_login_email(text,text), public.deactivate_profile(uuid,boolean);

create or replace function public.set_user_role(p_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
begin
  if p_role not in ('customer', 'admin') then
    raise exception 'Rol inválido: %', p_role using errcode = '22023';
  end if;
  select role into v_current from public.profiles where id = p_id for update;
  if not found then
    raise exception 'Perfil no encontrado' using errcode = 'P0002';
  end if;
  -- Nunca quedarse sin administradores.
  if v_current = 'admin' and p_role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin' and is_active and id <> p_id) = 0 then
    raise exception 'No se puede degradar al último administrador' using errcode = 'P0001';
  end if;
  update public.profiles set role = p_role where id = p_id;
end;
$$;

create or replace function public.promote_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.profiles
   where email = lower(btrim(p_email)) and is_active;
  if v_id is null then
    raise exception 'No existe una cuenta activa con ese email' using errcode = 'P0002';
  end if;
  perform public.set_user_role(v_id, 'admin');
  return v_id;
end;
$$;

-- Devuelve el email de Auth (real o sintético) de una cuenta ACTIVA, o NULL. Solo la usa la Edge
-- Function `login`, que jamás devuelve este valor al navegador (evita enumerar emails por teléfono).
create or replace function public.resolve_login_email(p_kind text, p_value text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.is_active
     and p.anonymized_at is null
     and ((p_kind = 'email' and p.email = p_value) or (p_kind = 'phone' and p.phone_e164 = p_value))
   limit 1;
$$;

-- BR-ACC-07: la cuenta se desactiva (y opcionalmente se anonimiza) pero la fila se conserva
-- para no romper pedidos/contabilidad.
create or replace function public.deactivate_profile(p_id uuid, p_anonymize boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = p_id for update;
  if not found then
    raise exception 'Perfil no encontrado' using errcode = 'P0002';
  end if;
  if v_role = 'admin'
     and (select count(*) from public.profiles where role = 'admin' and is_active and id <> p_id) = 0 then
    raise exception 'No se puede desactivar al último administrador' using errcode = 'P0001';
  end if;

  if p_anonymize then
    update public.profiles
       set is_active = false, full_name = 'Cliente anonimizado',
           email = null, phone_e164 = null, anonymized_at = now()
     where id = p_id;
  else
    update public.profiles set is_active = false where id = p_id;
  end if;
end;
$$;

revoke all on function public.set_user_role(uuid, text), public.promote_admin(text),
  public.resolve_login_email(text, text), public.deactivate_profile(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_user_role(uuid, text), public.promote_admin(text),
  public.resolve_login_email(text, text), public.deactivate_profile(uuid, boolean)
  to service_role;
