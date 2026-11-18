-- Sprint 15 · Fase 1 — Documentos legales versionados y el registro de lo que cada persona aceptó.
--
-- Cómo funciona (y por qué así):
--   * Cinco documentos (términos, privacidad, cookies, envíos, devoluciones). Cada uno tiene VERSIONES: un borrador editable y versiones
--     publicadas que ya NO se pueden cambiar ni borrar (lo que alguien aceptó tiene que poder leerse tal cual, siempre).
--   * «Vigente» = la versión publicada más nueva cuya fecha de vigencia ya llegó. Publicar con una fecha futura la programa.
--   * Términos y privacidad exigen ACEPTACIÓN. Mientras no haya una versión publicada de uno de ellos, no se exige (nada que aceptar);
--     desde que se publica, el registro y el checkout deben mandar EXACTAMENTE la versión vigente (si cambió mientras la persona leía, se
--     le pide que la lea de nuevo). Cada aceptación guarda versión, fecha y huella de la IP (nunca la IP).
--   * Al publicar una versión nueva de un documento que exige aceptación, las cuentas existentes quedan «pendientes» y se les pide aceptar.
--   * Nadie lee ni escribe estas tablas directo (ni el administrador): solo las funciones, que se autorizan por dentro.
--
-- Rollback:
--   drop function public.public_legal_document(text), public.public_legal_index(), public.public_legal_required(),
--     public.my_legal_pending(), public.record_legal_acceptance(uuid, uuid, text, jsonb, text), public.admin_legal_overview(),
--     public.admin_legal_get(text, int), public.admin_legal_save_draft(text, text, text), public.admin_legal_publish(text, timestamptz, text),
--     public.admin_legal_discard_draft(text), public.admin_legal_acceptance_stats(), public._legal_current(text), public._legal_required_versions(),
--     public.legal_versions_guard(), public.legal_acceptances_guard(), public.profiles_legal_cleanup();
--   drop table public.legal_acceptances, public.legal_versions, public.legal_documents;
--   delete from public.store_settings where key in ('legal_tax_id', 'legal_address');
--
-- Idempotente: se puede reaplicar.

-- ── 1. Datos del negocio para los textos (el dueño los define: PENDIENTES_ADMIN §E) ─────────────────────────────────────────────
-- La razón social es `business_name` y el correo y teléfono de contacto ya existen: aquí solo faltan el NIT y la dirección legal.
insert into public.store_settings (key, value, value_type, is_public, description) values
  ('legal_tax_id', '""', 'text', true, 'NIT del negocio (textos legales)'),
  ('legal_address', '""', 'text', true, 'Dirección legal del negocio (textos legales)')
on conflict (key) do nothing;

-- ── 2. Documentos y versiones ──────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.legal_documents (
  kind                text primary key check (kind in ('terms', 'privacy', 'cookies', 'shipping', 'returns')),
  title               text not null check (char_length(btrim(title)) between 1 and 120),
  requires_acceptance boolean not null,
  sort_order          integer not null default 0
);
insert into public.legal_documents (kind, title, requires_acceptance, sort_order) values
  ('terms', 'Términos y condiciones', true, 1),
  ('privacy', 'Política de privacidad', true, 2),
  ('cookies', 'Política de cookies', false, 3),
  ('shipping', 'Envíos', false, 4),
  ('returns', 'Devoluciones y cambios', false, 5)
on conflict (kind) do nothing;

create table if not exists public.legal_versions (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null references public.legal_documents (kind) on delete restrict,
  version      integer not null check (version >= 1),
  body         text not null check (char_length(btrim(body)) between 20 and 60000),
  status       text not null default 'draft' check (status in ('draft', 'published')),
  change_note  text check (change_note is null or char_length(btrim(change_note)) between 1 and 300),
  effective_at timestamptz,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  published_by uuid,
  published_at timestamptz,
  updated_at   timestamptz not null default now(),
  constraint legal_versions_kind_version_key unique (kind, version),
  constraint legal_versions_published_dates check ((status = 'published') = (effective_at is not null and published_at is not null))
);
-- Una sola versión borrador por documento.
create unique index if not exists legal_versions_one_draft on public.legal_versions (kind) where status = 'draft';
create index if not exists legal_versions_current_idx on public.legal_versions (kind, version desc) where status = 'published';

-- Lo publicado no cambia ni se borra; el borrador sí cambia, y al publicarse pasa a ser inmutable.
create or replace function public.legal_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception 'una versión publicada no se borra' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status = 'published' then
    raise exception 'una versión publicada no se cambia: crea una nueva' using errcode = '42501';
  end if;
  if new.kind is distinct from old.kind or new.version is distinct from old.version then
    raise exception 'el documento y el número de versión no cambian' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists legal_versions_guard_trg on public.legal_versions;
create trigger legal_versions_guard_trg before update or delete on public.legal_versions
  for each row execute function public.legal_versions_guard();
drop trigger if exists legal_versions_set_updated_at on public.legal_versions;
create trigger legal_versions_set_updated_at before update on public.legal_versions
  for each row execute function public.set_updated_at();
drop trigger if exists audit_legal_versions on public.legal_versions;
create trigger audit_legal_versions after insert or update on public.legal_versions
  for each row execute function public.audit_changes();

alter table public.legal_documents enable row level security;
alter table public.legal_versions enable row level security;
revoke all on public.legal_documents, public.legal_versions from public, anon, authenticated, service_role;

-- ── 3. Lo que cada persona aceptó (inmutable) ─────────────────────────────────────────────────────────────────────────────────
-- Sin claves foráneas (como la cola de avisos): un registro de consentimiento sobrevive a la cuenta y al pedido y no debe impedir borrarlos.
create table if not exists public.legal_acceptances (
  id          bigint generated always as identity primary key,
  profile_id  uuid,
  order_id    uuid,
  context     text not null check (context in ('register', 'checkout', 'reaccept')),
  kind        text not null check (kind in ('terms', 'privacy', 'cookies', 'shipping', 'returns')),
  version     integer not null check (version >= 1),
  accepted_at timestamptz not null default now(),
  ip_hash     text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  constraint legal_acceptances_who check (profile_id is not null or order_id is not null)
);
create index if not exists legal_acceptances_profile_idx on public.legal_acceptances (profile_id, kind, version desc) where profile_id is not null;
create index if not exists legal_acceptances_order_idx on public.legal_acceptances (order_id) where order_id is not null;

create or replace function public.legal_acceptances_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Lo único que se permite: quitar la huella de red al anonimizar una cuenta (BR-ACC-07), con la bandera que solo esa función enciende.
  if tg_op = 'UPDATE' and current_setting('app.legal_anonymize', true) = '1' and new.ip_hash is null
     and (to_jsonb(new) - 'ip_hash') = (to_jsonb(old) - 'ip_hash') then
    return new;
  end if;
  raise exception 'el registro de consentimientos no se modifica' using errcode = '42501';
end;
$$;
drop trigger if exists legal_acceptances_immutable on public.legal_acceptances;
create trigger legal_acceptances_immutable before update or delete on public.legal_acceptances
  for each row execute function public.legal_acceptances_guard();
drop trigger if exists legal_acceptances_no_truncate on public.legal_acceptances;
create trigger legal_acceptances_no_truncate before truncate on public.legal_acceptances
  for each statement execute function public.legal_acceptances_guard();

-- Al anonimizar una cuenta lo aceptado se queda como prueba, pero sin la huella de red.
create or replace function public.profiles_legal_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.anonymized_at is not null and old.anonymized_at is null then
    perform set_config('app.legal_anonymize', '1', true);
    update public.legal_acceptances set ip_hash = null where profile_id = new.id and ip_hash is not null;
    perform set_config('app.legal_anonymize', '', true);
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_legal_cleanup_trg on public.profiles;
create trigger profiles_legal_cleanup_trg after update of anonymized_at on public.profiles
  for each row execute function public.profiles_legal_cleanup();

alter table public.legal_acceptances enable row level security;
revoke all on public.legal_acceptances from public, anon, authenticated, service_role;

-- ── 4. Qué está vigente ────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public._legal_current(p_kind text)
returns public.legal_versions
language sql
stable
security definer
set search_path = ''
as $$
  select v.* from public.legal_versions v
   where v.kind = p_kind and v.status = 'published' and v.effective_at <= now()
   order by v.version desc
   limit 1
$$;

-- Las versiones vigentes de los documentos que exigen aceptación: {"terms": 3, "privacy": 2}. Sin versión publicada, el documento no se exige.
create or replace function public._legal_required_versions()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(d.kind, c.version), '{}'::jsonb)
    from public.legal_documents d
    cross join lateral public._legal_current(d.kind) c
   where d.requires_acceptance and c.id is not null
$$;

-- ── 5. Lectura pública ─────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.public_legal_document(p_kind text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('kind', d.kind, 'title', d.title, 'requires_acceptance', d.requires_acceptance,
                            'version', c.version, 'effective_at', c.effective_at, 'change_note', c.change_note, 'body', c.body)
    from public.legal_documents d
    left join lateral public._legal_current(d.kind) c on true
   where d.kind = p_kind
$$;

create or replace function public.public_legal_index()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', d.kind, 'title', d.title, 'requires_acceptance', d.requires_acceptance,
                                               'version', c.version, 'effective_at', c.effective_at, 'change_note', c.change_note)
                                      order by d.sort_order), '[]'::jsonb)
    from public.legal_documents d
    left join lateral public._legal_current(d.kind) c on true
$$;

create or replace function public.public_legal_required()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public._legal_required_versions()
$$;

-- Lo que la clienta que entró todavía no aceptó en su versión vigente: {"terms": 3}.
create or replace function public.my_legal_pending()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(r.key, (r.value #>> '{}')::int), '{}'::jsonb)
    from jsonb_each(public._legal_required_versions()) r
   where auth.uid() is not null
     and not exists (select 1 from public.legal_acceptances a
                      where a.profile_id = auth.uid() and a.kind = r.key and a.version >= (r.value #>> '{}')::int)
$$;

-- ── 6. Registrar lo aceptado (solo el servicio: el registro y el checkout) ─────────────────────────────────────────────────────
-- p_versions debe traer EXACTAMENTE la versión vigente de cada documento que exige aceptación. Si falta alguno o cambió, se rechaza.
create or replace function public.record_legal_acceptance(p_profile uuid, p_order uuid, p_context text, p_versions jsonb, p_ip_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_required jsonb := public._legal_required_versions();
  d record;
begin
  if p_context not in ('register', 'checkout', 'reaccept') then
    raise exception 'invalid_context' using errcode = '22023';
  end if;
  if p_profile is null and p_order is null then
    raise exception 'invalid_subject' using errcode = '22023';
  end if;
  if v_required = '{}'::jsonb then
    return;
  end if;
  if jsonb_typeof(p_versions) is distinct from 'object' then
    raise exception 'legal_required' using errcode = '22023', hint = v_required::text;
  end if;
  if p_context = 'reaccept' then
    -- Aceptar de nuevo: basta con lo que la persona vio en el aviso (si solo cambiaron los términos no se le vuelve a pedir la
    -- privacidad), pero cada versión tiene que ser EXACTAMENTE la vigente de un texto que se exige, y se anota solo lo que mandó.
    if not exists (select 1 from jsonb_each(p_versions)) then
      raise exception 'legal_required' using errcode = '22023', hint = v_required::text;
    end if;
    for d in select e.key as k, e.value as v from jsonb_each(p_versions) e loop
      if not (v_required ? d.k) or (v_required ->> d.k) is distinct from (d.v #>> '{}') then
        raise exception 'legal_outdated' using errcode = '22023', hint = v_required::text;
      end if;
    end loop;
    insert into public.legal_acceptances (profile_id, order_id, context, kind, version, ip_hash)
    select p_profile, p_order, p_context, e.key, (e.value #>> '{}')::int, p_ip_hash from jsonb_each(p_versions) e;
    return;
  end if;
  -- Registro y pago: TODO lo que se exige, en su versión vigente.
  for d in select e.key as k, e.value as v from jsonb_each(v_required) e loop
    if not (p_versions ? d.k) then
      raise exception 'legal_required' using errcode = '22023', hint = v_required::text;
    end if;
    if (p_versions ->> d.k) is distinct from (d.v #>> '{}') then
      raise exception 'legal_outdated' using errcode = '22023', hint = v_required::text;
    end if;
  end loop;
  insert into public.legal_acceptances (profile_id, order_id, context, kind, version, ip_hash)
  select p_profile, p_order, p_context, e.key, (e.value #>> '{}')::int, p_ip_hash from jsonb_each(v_required) e;
end;
$$;

-- ── 7. Administración ──────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_legal_overview()
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
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'kind', d.kind, 'title', d.title, 'requires_acceptance', d.requires_acceptance,
             'current_version', c.version, 'current_effective_at', c.effective_at,
             'has_draft', exists (select 1 from public.legal_versions x where x.kind = d.kind and x.status = 'draft'),
             'versions', coalesce((select jsonb_agg(jsonb_build_object('version', v.version, 'status', v.status, 'effective_at', v.effective_at,
                                                                       'published_at', v.published_at, 'change_note', v.change_note)
                                                    order by v.version desc)
                                     from public.legal_versions v where v.kind = d.kind), '[]'::jsonb))
             order by d.sort_order)
      from public.legal_documents d
      left join lateral public._legal_current(d.kind) c on true), '[]'::jsonb);
end;
$$;

create or replace function public.admin_legal_get(p_kind text, p_version int default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.legal_versions;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if p_version is null then
    select * into v from public.legal_versions x where x.kind = p_kind and x.status = 'draft';
    if not found then
      select * into v from public.legal_versions x where x.kind = p_kind order by x.version desc limit 1;
    end if;
  else
    select * into v from public.legal_versions x where x.kind = p_kind and x.version = p_version;
  end if;
  if not found then
    return null;
  end if;
  return jsonb_build_object('id', v.id, 'kind', v.kind, 'version', v.version, 'status', v.status, 'body', v.body,
                            'change_note', v.change_note, 'effective_at', v.effective_at, 'published_at', v.published_at,
                            'updated_at', v.updated_at);
end;
$$;

-- Crea el borrador (la versión siguiente) o actualiza el que ya hay. Partir de lo vigente es cosa de la pantalla: aquí solo se guarda lo que llega.
create or replace function public.admin_legal_save_draft(p_kind text, p_body text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.legal_versions;
  v_next int;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if not exists (select 1 from public.legal_documents d where d.kind = p_kind) then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if p_body is null or char_length(btrim(p_body)) < 20 or char_length(p_body) > 60000 then
    raise exception 'invalid_body' using errcode = '22023', hint = 'entre 20 y 60 000 caracteres';
  end if;
  if p_body ~ '<[a-zA-Z/!]' then
    raise exception 'html_not_allowed' using errcode = '22023', hint = 'el texto no admite etiquetas HTML';
  end if;
  select * into v from public.legal_versions x where x.kind = p_kind and x.status = 'draft' for update;
  if found then
    update public.legal_versions set body = p_body, change_note = nullif(btrim(coalesce(p_note, '')), ''), created_by = coalesce(created_by, auth.uid())
     where id = v.id returning * into v;
  else
    select coalesce(max(x.version), 0) + 1 into v_next from public.legal_versions x where x.kind = p_kind;
    insert into public.legal_versions (kind, version, body, change_note, created_by)
    values (p_kind, v_next, p_body, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
    returning * into v;
  end if;
  return jsonb_build_object('id', v.id, 'kind', v.kind, 'version', v.version, 'status', v.status);
end;
$$;

create or replace function public.admin_legal_discard_draft(p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  delete from public.legal_versions where kind = p_kind and status = 'draft';
end;
$$;

-- Publica el borrador. p_effective_at nulo = ahora. Con una versión anterior publicada se exige decir QUÉ cambió (se le muestra a la clienta
-- al pedirle que acepte de nuevo). No se publica con una vigencia en el pasado (se confundiría con lo ya aceptado).
create or replace function public.admin_legal_publish(p_kind text, p_effective_at timestamptz default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.legal_versions;
  v_when timestamptz := coalesce(p_effective_at, now());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  select * into v from public.legal_versions x where x.kind = p_kind and x.status = 'draft' for update;
  if not found then
    raise exception 'no_draft' using errcode = '22023';
  end if;
  if v_when < now() - interval '5 minutes' then
    raise exception 'effective_in_past' using errcode = '22023';
  end if;
  v_note := coalesce(v_note, v.change_note);
  if v.version > 1 and v_note is null then
    raise exception 'change_note_required' using errcode = '22023', hint = 'di qué cambió respecto de la versión anterior';
  end if;
  update public.legal_versions
     set status = 'published', effective_at = greatest(v_when, now()), published_at = now(), published_by = auth.uid(),
         change_note = v_note
   where id = v.id returning * into v;
  return jsonb_build_object('kind', v.kind, 'version', v.version, 'effective_at', v.effective_at);
end;
$$;

-- Cuántas personas aceptaron cada versión (para saber cuánto falta tras publicar una nueva).
create or replace function public.admin_legal_acceptance_stats()
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
  return coalesce((select jsonb_agg(jsonb_build_object('kind', s.kind, 'version', s.version, 'accounts', s.accounts, 'orders', s.orders)
                                    order by s.kind, s.version desc)
                     from (select a.kind, a.version, count(distinct a.profile_id)::int as accounts, count(distinct a.order_id)::int as orders
                             from public.legal_acceptances a group by a.kind, a.version) s), '[]'::jsonb);
end;
$$;

-- ── 8. Permisos ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function
  public._legal_current(text), public._legal_required_versions(), public.legal_versions_guard(), public.legal_acceptances_guard(),
  public.profiles_legal_cleanup()
  from public, anon, authenticated, service_role;
-- La lectura pública es de los textos VIGENTES (lo que cualquiera ve en la tienda): nada de borradores ni de versiones futuras.
revoke all on function public.public_legal_document(text), public.public_legal_index(), public.public_legal_required() from public;
grant execute on function public.public_legal_document(text), public.public_legal_index(), public.public_legal_required() to anon, authenticated;
revoke all on function public.my_legal_pending() from public, anon;
grant execute on function public.my_legal_pending() to authenticated;
-- Registrar lo aceptado: solo el servicio (el registro y el checkout lo llaman con su clave).
revoke all on function public.record_legal_acceptance(uuid, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_legal_acceptance(uuid, uuid, text, jsonb, text) to service_role;
revoke all on function
  public.admin_legal_overview(), public.admin_legal_get(text, int), public.admin_legal_save_draft(text, text, text),
  public.admin_legal_discard_draft(text), public.admin_legal_publish(text, timestamptz, text), public.admin_legal_acceptance_stats()
  from public, anon, service_role;
grant execute on function
  public.admin_legal_overview(), public.admin_legal_get(text, int), public.admin_legal_save_draft(text, text, text),
  public.admin_legal_discard_draft(text), public.admin_legal_publish(text, timestamptz, text), public.admin_legal_acceptance_stats()
  to authenticated;
