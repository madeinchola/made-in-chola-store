-- Sprint 15 · Fase E — Canal de reclamos.
--
-- Qué hace:
--   * `complaints`: cada reclamo con su número (REC-000123), quién reclama (nombre y correo o teléfono; si tiene cuenta, también ella),
--     el tipo, el detalle, el estado (nuevo → en revisión → respondido → cerrado), la respuesta y el PLAZO de respuesta
--     (`complaints_response_days`, 10 días por omisión: lo confirma el abogado). Nadie lee ni escribe la tabla directo: solo las funciones.
--   * `submit_complaint`: solo la ejecuta el servicio (la función `complaint` valida, limita la frecuencia y descarta lo que llena un robot).
--     Tiene un cortafuegos propio: si entran más de 100 reclamos en una hora se rechazan (alguien está inundando el canal).
--   * `admin_complaints`, `admin_complaint_update`, `admin_complaints_summary`: la bandeja del administrador.
--   * Al registrarse un reclamo se encola UNA alerta por correo a los administradores (S13: plantilla `complaint_new`, editable). El
--     reclamante NO recibe un correo automático: el formulario es público y escribir al correo que cualquiera teclea sería un «relevo».
--
-- Rollback:
--   drop function public.submit_complaint(jsonb, uuid, text), public.admin_complaints(text, int, int),
--     public.admin_complaint_update(uuid, text, text), public.admin_complaints_summary();
--   drop table public.complaints; drop sequence public.complaints_number_seq;
--   delete from public.notification_templates where key = 'complaint_new';
--   delete from public.store_settings where key = 'complaints_response_days';
--   (y volver a crear `store_settings_validate_s15()` de la migración 20261118000200 sin la clave nueva)
--
-- Idempotente: se puede reaplicar.

-- ── 1. Plazo de respuesta ─────────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.store_settings (key, value, value_type, is_public, description) values
  ('complaints_response_days', '10', 'int', true, 'Días para responder un reclamo (se muestra en el formulario; confirmar el plazo con el abogado)')
on conflict (key) do nothing;

create or replace function public.store_settings_validate_s15()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_text text := new.value #>> '{}';
begin
  if new.key = 'complaints_response_days' then
    if jsonb_typeof(new.value) <> 'number' or v_text !~ '^[0-9]{1,3}$' or v_text::int < 1 or v_text::int > 60 then
      raise exception 'complaints_response_days debe ser un número entero entre 1 y 60' using errcode = '22023';
    end if;
    return new;
  end if;
  if jsonb_typeof(new.value) <> 'string' then
    raise exception 'el ajuste "%" debe ser un texto', new.key using errcode = '22023';
  end if;
  if new.key = 'analytics_meta_pixel_id' and v_text <> '' and v_text !~ '^[0-9]{8,20}$' then
    raise exception 'el ID del Pixel de Meta son solo números (de 8 a 20 dígitos) o queda vacío' using errcode = '22023';
  end if;
  if new.key = 'analytics_ga4_id' and v_text <> '' and v_text !~ '^G-[A-Z0-9]{6,14}$' then
    raise exception 'el ID de medición de GA4 empieza con G- (p. ej. G-ABC123DEF4) o queda vacío' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists store_settings_validate_s15_trg on public.store_settings;
create trigger store_settings_validate_s15_trg before insert or update on public.store_settings
  for each row when (new.key in ('analytics_meta_pixel_id', 'analytics_ga4_id', 'complaints_response_days'))
  execute function public.store_settings_validate_s15();

-- ── 2. Los reclamos ───────────────────────────────────────────────────────────────────────────────────────────────────────────
create sequence if not exists public.complaints_number_seq;

create table if not exists public.complaints (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique default ('REC-' || lpad(nextval('public.complaints_number_seq')::text, 6, '0'))
                  check (number ~ '^REC-[0-9]{6,}$'),
  profile_id    uuid references public.profiles (id) on delete set null,
  contact_name  text not null check (char_length(btrim(contact_name)) between 1 and 120),
  contact_email text check (contact_email is null or (contact_email = lower(btrim(contact_email)) and char_length(contact_email) <= 254
                  and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  contact_phone text check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  order_number  text check (order_number is null or order_number ~ '^[A-Z]{2,5}-[0-9]{6,}$'),
  kind          text not null check (kind in ('product', 'delivery', 'payment', 'service', 'other')),
  detail        text not null check (char_length(btrim(detail)) between 20 and 2000),
  status        text not null default 'new' check (status in ('new', 'in_review', 'answered', 'closed')),
  response      text check (response is null or char_length(btrim(response)) between 1 and 2000),
  due_at        timestamptz not null,
  answered_at   timestamptz,
  handled_by    uuid,
  ip_hash       text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint complaints_contact_required check (contact_email is not null or contact_phone is not null),
  constraint complaints_answered_has_response check (status <> 'answered' or response is not null)
);
create index if not exists complaints_status_idx on public.complaints (status, due_at);
create index if not exists complaints_created_idx on public.complaints (created_at desc);
alter table public.complaints enable row level security;
revoke all on public.complaints from public, anon, authenticated, service_role;
revoke all on sequence public.complaints_number_seq from public, anon, authenticated, service_role;

drop trigger if exists complaints_set_updated_at on public.complaints;
create trigger complaints_set_updated_at before update on public.complaints
  for each row execute function public.set_updated_at();
-- La auditoría guarda QUE cambió el contacto, el detalle y la respuesta, no su valor (datos personales).
drop trigger if exists audit_complaints on public.complaints;
create trigger audit_complaints after insert or update on public.complaints
  for each row execute function public.audit_changes('contact_name', 'contact_email', 'contact_phone', 'detail', 'response', 'ip_hash');

-- Aviso interno (S13). Se pisa lo que el administrador haya editado: nunca (on conflict do nothing).
insert into public.notification_templates (key, channel, audience, subject, body, cta_label, active) values
  ('complaint_new', 'email', 'admin', 'Nuevo reclamo {{complaint_number}}',
   E'Se registró el reclamo {{complaint_number}} (tipo: {{complaint_kind}}).\n\nRespóndelo dentro del plazo en Reclamos: ahí están los datos de contacto y el detalle.', 'Abrir en el panel', true)
on conflict (key, channel, locale) do nothing;

-- ── 3. Registrar un reclamo (solo el servicio) ────────────────────────────────────────────────────────────────────────────────
create or replace function public._complaint_text(p_value jsonb, p_key text, p_keep_newlines boolean default false)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(case when jsonb_typeof(p_value -> p_key) = 'string' then p_value ->> p_key else '' end,
                                     case when p_keep_newlines then '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' else '[[:cntrl:]]' end, '', 'g')), '')
$$;

create or replace function public.submit_complaint(p_data jsonb, p_profile uuid, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.complaints;
  v_email text;
  v_phone text;
begin
  if jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'invalid_data' using errcode = '22023';
  end if;
  -- Cortafuegos: más de 100 reclamos en una hora no son personas.
  if (select count(*) from public.complaints c where c.created_at > now() - interval '1 hour') >= 100 then
    raise exception 'too_many' using errcode = '22023';
  end if;
  v_email := lower(public._complaint_text(p_data, 'contact_email'));
  v_phone := public._complaint_text(p_data, 'contact_phone');
  insert into public.complaints (profile_id, contact_name, contact_email, contact_phone, order_number, kind, detail, due_at, ip_hash)
  values (p_profile, public._complaint_text(p_data, 'contact_name'), v_email, v_phone,
          upper(public._complaint_text(p_data, 'order_number')), public._complaint_text(p_data, 'kind'),
          public._complaint_text(p_data, 'detail', true),
          now() + make_interval(days => public.setting_int('complaints_response_days', 10)), p_ip_hash)
  returning * into v;
  -- La alerta a los administradores nunca puede impedir que el reclamo quede registrado.
  begin
    perform public._enqueue_notification_ex('complaint_new', 'email', null,
                                            jsonb_build_object('complaint_number', v.number, 'kind', v.kind),
                                            'complaint_new:' || v.id::text, null, null, null);
  exception when others then
    raise warning 'no se pudo encolar la alerta del reclamo %: %', v.number, sqlerrm;
  end;
  return jsonb_build_object('id', v.id, 'number', v.number, 'due_at', v.due_at);
end;
$$;

-- ── 4. La bandeja del administrador ───────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_complaints(p_status text default null, p_offset int default 0, p_limit int default 50)
returns table (id uuid, number text, created_at timestamptz, kind text, status text, contact_name text, contact_email text, contact_phone text,
               order_number text, detail text, response text, due_at timestamptz, answered_at timestamptz, overdue boolean,
               has_account boolean, total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if p_offset < 0 or p_limit < 1 or p_limit > 200 then
    raise exception 'invalid_page' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('new', 'in_review', 'answered', 'closed', 'open') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  return query
    select c.id, c.number, c.created_at, c.kind, c.status, c.contact_name, c.contact_email, c.contact_phone, c.order_number, c.detail,
           c.response, c.due_at, c.answered_at, (c.status in ('new', 'in_review') and c.due_at < now()), (c.profile_id is not null),
           count(*) over ()
      from public.complaints c
     where p_status is null
        or (p_status = 'open' and c.status in ('new', 'in_review'))
        or c.status = p_status
     -- Lo pendiente primero y lo más urgente arriba; lo ya resuelto, lo más reciente arriba.
     order by (c.status in ('answered', 'closed')), case when c.status in ('new', 'in_review') then c.due_at end asc,
              c.created_at desc, c.id
     offset p_offset limit p_limit;
end;
$$;

create or replace function public.admin_complaint_update(p_id uuid, p_status text, p_response text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.complaints;
  v_response text := nullif(btrim(coalesce(p_response, '')), '');
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if p_status not in ('new', 'in_review', 'answered', 'closed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if v_response is not null and char_length(v_response) > 2000 then
    raise exception 'response_too_long' using errcode = '22023';
  end if;
  select * into v from public.complaints c where c.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_status = 'answered' and coalesce(v_response, v.response) is null then
    raise exception 'response_required' using errcode = '22023';
  end if;
  update public.complaints
     set status = p_status,
         response = coalesce(v_response, response),
         answered_at = case when p_status in ('answered', 'closed') then coalesce(answered_at, now()) else null end,
         handled_by = auth.uid()
   where id = p_id;
end;
$$;

create or replace function public.admin_complaints_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'new', (select count(*) from public.complaints c where c.status = 'new'),
    'in_review', (select count(*) from public.complaints c where c.status = 'in_review'),
    'overdue', (select count(*) from public.complaints c where c.status in ('new', 'in_review') and c.due_at < now()),
    'total', (select count(*) from public.complaints));
end;
$$;

-- ── 5. Permisos ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public._complaint_text(jsonb, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.submit_complaint(jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_complaint(jsonb, uuid, text) to service_role;
revoke all on function public.admin_complaints(text, int, int), public.admin_complaint_update(uuid, text, text), public.admin_complaints_summary()
  from public, anon, service_role;
grant execute on function public.admin_complaints(text, int, int), public.admin_complaint_update(uuid, text, text), public.admin_complaints_summary()
  to authenticated;
