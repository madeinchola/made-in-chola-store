-- Sprint 6 · Cuenta del cliente: preferencias del perfil, libreta de direcciones y datos fiscales.
-- Reglas: BR-ACC-04 (varias direcciones; envío y facturación pueden diferir), BR-ACC-06 (datos fiscales opcionales),
-- BR-ACC-07 (nada se borra: se archiva), S-08 (dirección con pin: lat/lng).
--
-- Rollback (manual, orden inverso):
--   drop trigger store_settings_validate_s6_trg on public.store_settings;
--   delete from public.store_settings where key = 'tax_id_validation';
--   drop function public.store_settings_validate_s6(), public.change_profile_contact(uuid, text, text, jsonb);
--   (restaurar public.deactivate_profile con la definición de 20261023000400_operaciones_de_cuenta.sql)
--   drop view public.public_countries, public.public_currencies;
--   drop table public.tax_profiles, public.addresses cascade;
--   drop function public.account_statement_lock(), public.account_default_guard(), public.account_promote_default(),
--     public.addresses_validate(),
--     public.tax_profiles_validate();
--   alter table public.profiles drop column preferred_currency, drop column preferred_locale;
--   revoke update (preferred_locale, preferred_currency) on public.profiles from authenticated;

-- ── 1. Preferencias del perfil (idioma y moneda preferidos) ────────────────────────────────
alter table public.profiles
  add column if not exists preferred_locale   text not null default 'es',
  add column if not exists preferred_currency text references public.currencies (code);

alter table public.profiles drop constraint if exists profiles_preferred_locale_valid;
alter table public.profiles add constraint profiles_preferred_locale_valid check (preferred_locale ~ '^[a-z]{2}$');

-- La moneda preferida debe estar habilitada (o ser NULL = la de la tienda).
create or replace function public.profiles_validate_preferences()
returns trigger
language plpgsql
security definer  -- lee `currencies`, cuya RLS solo deja leer al admin
set search_path = ''
as $$
begin
  if new.preferred_currency is not null
     and (tg_op = 'INSERT' or new.preferred_currency is distinct from old.preferred_currency)
     and not exists (select 1 from public.currencies c where c.code = new.preferred_currency and c.enabled) then
    raise exception 'La moneda preferida no está habilitada' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_validate_preferences_trg on public.profiles;
create trigger profiles_validate_preferences_trg before insert or update of preferred_currency on public.profiles
  for each row execute function public.profiles_validate_preferences();

-- El cliente ya podía editar su nombre; ahora también sus preferencias (permiso por columna).
grant update (preferred_locale, preferred_currency) on public.profiles to authenticated;

-- ── 2. Guardia compartida: «una sola predeterminada», tope de activas y archivado ──────────
-- Se usa en addresses y tax_profiles (mismas reglas).
--
-- CONCURRENCIA. Dos peticiones del MISMO cliente (doble clic, dos pestañas, dos dispositivos) pueden chocar: marcar
-- dos direcciones como predeterminadas a la vez, o archivar la predeterminada mientras se marca otra. Para que el
-- resultado sea siempre «una sola, la última» y NUNCA un error ni un interbloqueo, cada sentencia toma, ANTES de
-- tocar ninguna fila, un candado de asesoría por (tabla, cliente) que se suelta al terminar la transacción. (Un
-- candado tomado DENTRO del disparador por fila llegaba tarde —la fila ya estaba bloqueada— y dos sentencias se
-- esperaban entre sí: interbloqueo, error 500; lo encontró la prueba de integración con concurrencia real.)
-- El índice parcial único sigue siendo la red de seguridad final.
create or replace function public.account_statement_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- `auth.uid()` es el cliente que escribe (la RLS le impide escribir filas ajenas). Las escrituras del sistema
  -- (service_role, sin uid) comparten una clave aparte; `deactivate_profile` toma la clave del cliente que anonimiza.
  perform pg_advisory_xact_lock(hashtextextended(tg_table_name || ':' || coalesce(auth.uid()::text, ''), 0));
  return null;
end;
$$;

create or replace function public.account_default_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cap    int := tg_argv[0]::int;
  v_active int;
begin
  if tg_op = 'UPDATE' and new.profile_id <> old.profile_id then
    raise exception 'No se puede cambiar el dueño de un registro' using errcode = '42501';
  end if;

  -- Un registro archivado nunca es el predeterminado.
  if new.archived_at is not null then
    new.is_default := false;
    return new;
  end if;

  -- La predeterminada no se «quita» a mano (dejaría al cliente sin ninguna aunque tenga otras activas): se cambia
  -- marcando OTRA. Esta guardia se llama a sí misma al desmarcar la anterior (profundidad 2): ahí sí se permite.
  if tg_op = 'UPDATE' and pg_trigger_depth() = 1 and old.is_default and not new.is_default then
    new.is_default := true;
  end if;

  -- Solo al CREAR o RESTAURAR (no en las actualizaciones anidadas de abajo).
  if tg_op = 'INSERT' or old.archived_at is not null then
    execute format('select count(*) from public.%I where profile_id = $1 and archived_at is null and id <> $2', tg_table_name)
      into v_active using new.profile_id, new.id;
    if v_active >= v_cap then
      raise exception 'Alcanzaste el máximo de % registros activos; archiva alguno para agregar otro', v_cap
        using errcode = '23514';
    end if;
    if v_active = 0 then
      new.is_default := true;  -- el primero queda como predeterminado
    end if;
  end if;

  if new.is_default then
    execute format('update public.%I set is_default = false where profile_id = $1 and is_default and archived_at is null and id <> $2', tg_table_name)
      using new.profile_id, new.id;
  end if;
  return new;
end;
$$;

-- Al archivar el predeterminado, el más reciente de los que quedan pasa a serlo (si lo hay).
create or replace function public.account_promote_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_default and old.archived_at is null and new.archived_at is not null then
    execute format(
      'update public.%I set is_default = true where id = (select id from public.%I where profile_id = $1 and archived_at is null order by created_at desc, id desc limit 1)',
      tg_table_name, tg_table_name)
      using new.profile_id;
  end if;
  return null;
end;
$$;

-- ── 2b. Vistas públicas: países de entrega y monedas habilitadas ───────────────────────────
-- El formulario de direcciones y las preferencias del perfil necesitan SABER qué países y monedas están habilitados;
-- las tablas solo las lee el admin (RLS), así que se exponen estas vistas (solo lo habilitado, solo columnas públicas).
create or replace view public.public_countries as
select c.code, c.name, c.currency_code
  from public.countries c
 where c.enabled;

create or replace view public.public_currencies as
select c.code, c.name, c.symbol, c.decimals
  from public.currencies c
 where c.enabled;

revoke all on public.public_countries, public.public_currencies from public, anon, authenticated;
grant select on public.public_countries, public.public_currencies to anon, authenticated;

-- ── 3. Libreta de direcciones ──────────────────────────────────────────────────────────────
create table if not exists public.addresses (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles (id) on delete restrict,
  label          text not null,
  recipient      text not null,
  phone_e164     text,
  line1          text not null,
  line2          text,
  city           text not null,
  department     text,
  country        text not null default 'BO' references public.countries (code),
  reference_text text,
  lat            numeric(9, 6),
  lng            numeric(9, 6),
  is_default     boolean not null default false,
  for_shipping   boolean not null default true,
  for_billing    boolean not null default false,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint addresses_label_len     check (char_length(label) between 1 and 40),
  constraint addresses_recipient_len check (char_length(recipient) between 1 and 120),
  constraint addresses_line1_len     check (char_length(line1) between 1 and 200),
  constraint addresses_line2_len     check (line2 is null or char_length(line2) between 1 and 200),
  constraint addresses_city_len      check (char_length(city) between 1 and 80),
  constraint addresses_department_len check (department is null or char_length(department) between 1 and 80),
  constraint addresses_reference_len check (reference_text is null or char_length(reference_text) between 1 and 300),
  constraint addresses_phone_format  check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  -- Una dirección activa necesita teléfono de contacto; al anonimizar (archivada) se borra.
  constraint addresses_phone_required check (archived_at is not null or phone_e164 is not null),
  -- El pin es todo o nada y dentro del planeta.
  constraint addresses_coords_pair   check ((lat is null) = (lng is null)),
  constraint addresses_lat_range     check (lat is null or lat between -90 and 90),
  constraint addresses_lng_range     check (lng is null or lng between -180 and 180),
  constraint addresses_purpose       check (for_shipping or for_billing)
);

create index if not exists addresses_profile_idx on public.addresses (profile_id, created_at desc);
-- BR-ACC-04: una sola predeterminada ACTIVA por cliente.
create unique index if not exists addresses_one_default_idx on public.addresses (profile_id)
  where is_default and archived_at is null;

-- Limpieza y reglas que no caben en un CHECK: espacios, opcionales vacíos → NULL, país habilitado.
create or replace function public.addresses_validate()
returns trigger
language plpgsql
security definer  -- lee `countries`, cuya RLS solo deja leer al admin
set search_path = ''
as $$
begin
  new.label          := btrim(new.label);
  new.recipient      := btrim(new.recipient);
  new.line1          := btrim(new.line1);
  new.line2          := nullif(btrim(coalesce(new.line2, '')), '');
  new.city           := btrim(new.city);
  new.department     := nullif(btrim(coalesce(new.department, '')), '');
  new.reference_text := nullif(btrim(coalesce(new.reference_text, '')), '');
  new.phone_e164     := nullif(btrim(coalesce(new.phone_e164, '')), '');

  if new.archived_at is null
     and (tg_op = 'INSERT' or new.country is distinct from old.country or old.archived_at is not null)
     and not exists (select 1 from public.countries c where c.code = new.country and c.enabled) then
    raise exception 'Ese país no está disponible para entregas' using errcode = '22023';
  end if;
  -- Una cuenta desactivada no recibe datos nuevos. La RLS ya lo exige, pero evalúa con la «foto» del inicio de la
  -- sentencia: un INSERT que esperaba el candado mientras la cuenta se desactivaba la vería aún activa; aquí se vuelve a mirar.
  if new.archived_at is null and (tg_op = 'INSERT' or old.archived_at is not null)
     and not exists (select 1 from public.profiles p where p.id = new.profile_id and p.is_active) then
    raise exception 'La cuenta no está activa' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists addresses_0_lock on public.addresses;
create trigger addresses_0_lock before insert or update on public.addresses
  for each statement execute function public.account_statement_lock();
drop trigger if exists addresses_a_validate on public.addresses;
create trigger addresses_a_validate before insert or update on public.addresses
  for each row execute function public.addresses_validate();
drop trigger if exists addresses_b_default_guard on public.addresses;
create trigger addresses_b_default_guard before insert or update on public.addresses
  for each row execute function public.account_default_guard(20);
drop trigger if exists addresses_set_updated_at on public.addresses;
create trigger addresses_set_updated_at before update on public.addresses
  for each row execute function public.set_updated_at();
drop trigger if exists addresses_c_promote_default on public.addresses;
create trigger addresses_c_promote_default after update of archived_at on public.addresses
  for each row execute function public.account_promote_default();
-- Auditoría (BR-ADM-03): todo dato personal se redacta; queda quién cambió qué y cuándo.
drop trigger if exists audit_addresses on public.addresses;
create trigger audit_addresses after insert or update or delete on public.addresses
  for each row execute function public.audit_changes('label', 'recipient', 'phone_e164', 'line1', 'line2', 'city', 'department', 'reference_text', 'lat', 'lng');

-- ── 4. Datos fiscales ──────────────────────────────────────────────────────────────────────
create table if not exists public.tax_profiles (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete restrict,
  doc_type    text not null,
  doc_number  text not null,
  legal_name  text not null,
  is_default  boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- ci: cédula de identidad · nit · ce: carnet de extranjería · pas: pasaporte · otro
  constraint tax_profiles_doc_type    check (doc_type in ('ci', 'nit', 'ce', 'pas', 'otro')),
  -- Cordura de formato (letras, números y separadores). El formato exacto por tipo (NIT/CI de Bolivia) lo valida la
  -- aplicación y su rigor es un ajuste de la tienda (`tax_id_validation`): aquí solo se evita basura y texto enorme.
  constraint tax_profiles_doc_number  check (doc_number ~ '^[A-Za-z0-9][A-Za-z0-9 ./-]{1,23}$'),
  constraint tax_profiles_legal_name  check (char_length(legal_name) between 1 and 160)
);

create index if not exists tax_profiles_profile_idx on public.tax_profiles (profile_id, created_at desc);
create unique index if not exists tax_profiles_one_default_idx on public.tax_profiles (profile_id)
  where is_default and archived_at is null;
-- El mismo documento no se repite entre los activos de UN cliente (entre clientes distintos sí se permite).
create unique index if not exists tax_profiles_no_dup_idx on public.tax_profiles (profile_id, doc_type, upper(doc_number))
  where archived_at is null;

create or replace function public.tax_profiles_validate()
returns trigger
language plpgsql
security definer  -- lee `profiles` sin depender de la RLS del llamador
set search_path = ''
as $$
begin
  new.doc_number := upper(btrim(new.doc_number));
  new.legal_name := btrim(new.legal_name);
  if new.archived_at is null and (tg_op = 'INSERT' or old.archived_at is not null)
     and not exists (select 1 from public.profiles p where p.id = new.profile_id and p.is_active) then
    raise exception 'La cuenta no está activa' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists tax_profiles_0_lock on public.tax_profiles;
create trigger tax_profiles_0_lock before insert or update on public.tax_profiles
  for each statement execute function public.account_statement_lock();
drop trigger if exists tax_profiles_a_validate on public.tax_profiles;
create trigger tax_profiles_a_validate before insert or update on public.tax_profiles
  for each row execute function public.tax_profiles_validate();
drop trigger if exists tax_profiles_b_default_guard on public.tax_profiles;
create trigger tax_profiles_b_default_guard before insert or update on public.tax_profiles
  for each row execute function public.account_default_guard(10);
drop trigger if exists tax_profiles_set_updated_at on public.tax_profiles;
create trigger tax_profiles_set_updated_at before update on public.tax_profiles
  for each row execute function public.set_updated_at();
drop trigger if exists tax_profiles_c_promote_default on public.tax_profiles;
create trigger tax_profiles_c_promote_default after update of archived_at on public.tax_profiles
  for each row execute function public.account_promote_default();
drop trigger if exists audit_tax_profiles on public.tax_profiles;
create trigger audit_tax_profiles after insert or update or delete on public.tax_profiles
  for each row execute function public.audit_changes('doc_number', 'legal_name');

-- ── 5. RLS y permisos por columna ──────────────────────────────────────────────────────────
-- Cada cliente solo ve y edita lo SUYO; el admin solo lee (para atender pedidos); nadie borra (BR-ACC-07).
-- `current_app_role()` es NULL si la cuenta está desactivada: una cuenta desactivada ya no ve ni edita nada.
alter table public.addresses enable row level security;
alter table public.tax_profiles enable row level security;
revoke all on public.addresses, public.tax_profiles from public, anon, authenticated;
-- Ni siquiera el service_role borra: la «eliminación» es archivar o anonimizar (BR-ACC-07).
revoke delete, truncate on public.addresses, public.tax_profiles from service_role;

grant select on public.addresses, public.tax_profiles to authenticated;
grant insert (profile_id, label, recipient, phone_e164, line1, line2, city, department, country, reference_text,
              lat, lng, is_default, for_shipping, for_billing)
  on public.addresses to authenticated;
grant update (label, recipient, phone_e164, line1, line2, city, department, country, reference_text,
              lat, lng, is_default, for_shipping, for_billing, archived_at)
  on public.addresses to authenticated;
grant insert (profile_id, doc_type, doc_number, legal_name, is_default) on public.tax_profiles to authenticated;
grant update (doc_type, doc_number, legal_name, is_default, archived_at) on public.tax_profiles to authenticated;

do $$
declare t text;
begin
  foreach t in array array['addresses', 'tax_profiles']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('create policy %I on public.%I for select to authenticated using (profile_id = auth.uid() and public.current_app_role() is not null)', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_admin', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())', t || '_select_admin', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (profile_id = auth.uid() and public.current_app_role() is not null)', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (profile_id = auth.uid() and public.current_app_role() is not null) with check (profile_id = auth.uid() and public.current_app_role() is not null)', t || '_update_own', t);
  end loop;
end $$;
-- Sin políticas ni permisos de DELETE: nada se borra.

-- ── 6. Cambio de contacto (solo desde la Edge Function `update-contact`, que ya verificó la contraseña) ──
-- Fija email y teléfono a los valores FINALES (NULL = quitar). Pone al cliente como «actor» de la auditoría (la función
-- corre con service_role y no tiene `sub` propio) y se apoya en los índices únicos de profiles: un valor ya usado por otra
-- cuenta aborta con 23505 y un perfil sin ningún identificador con 23514.
--
-- `p_expect` (opcional, `{"email": …, "phone": …}`) es el valor que la función llamadora LEYÓ: el cambio solo se aplica si
-- el perfil sigue así (comparar-y-cambiar). Si otro cambio se coló entre la lectura y la escritura (dos pestañas, dos
-- dispositivos) aborta con 40001 en vez de pisarlo; la llamadora también lo usa para deshacer SOLO su propio cambio.
create or replace function public.change_profile_contact(
  p_id uuid, p_email text, p_phone text, p_expect jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claim.sub', p_id::text, true);
  update public.profiles
     set email      = nullif(lower(btrim(coalesce(p_email, ''))), ''),
         phone_e164 = nullif(btrim(coalesce(p_phone, '')), '')
   where id = p_id and is_active and anonymized_at is null
     and (p_expect is null
          or (email is not distinct from (p_expect ->> 'email')
              and phone_e164 is not distinct from (p_expect ->> 'phone')));
  if not found then
    if exists (select 1 from public.profiles where id = p_id and is_active and anonymized_at is null) then
      raise exception 'Otro cambio de contacto ocurrió a la vez' using errcode = '40001';
    end if;
    raise exception 'Perfil no encontrado' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.change_profile_contact(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.change_profile_contact(uuid, text, text, jsonb) to service_role;

-- ── 7. Desactivar con anonimización: también se limpian direcciones y datos fiscales ───────
-- (Sin anonimizar, se conservan intactos pero ya no son visibles: la RLS exige cuenta activa.)
create or replace function public.deactivate_profile(p_id uuid, p_anonymize boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  -- Mismas claves que usa el cliente al escribir sus direcciones y datos fiscales (ver account_statement_lock) y en el
  -- MISMO orden que él: primero el candado y luego la fila del perfil. Al revés, un INSERT del cliente (candado → FK
  -- sobre el perfil) y esta función (fila del perfil → candado) formaban un ciclo: interbloqueo, error 500.
  perform pg_advisory_xact_lock(hashtextextended('addresses:' || p_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('tax_profiles:' || p_id::text, 0));

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
           email = null, phone_e164 = null, anonymized_at = now(),
           preferred_currency = null
     where id = p_id;
    -- Los pedidos (S10) guardan su propia copia de la dirección: aquí se borra todo dato personal (también la etiqueta
    -- y la ciudad, que son texto libre: «Casa de María Quispe»).
    update public.addresses
       set label = 'Anonimizada', recipient = 'Anonimizado', phone_e164 = null, line1 = '—', line2 = null, city = '—',
           department = null, reference_text = null, lat = null, lng = null,
           archived_at = coalesce(archived_at, now())
     where profile_id = p_id;
    update public.tax_profiles
       set legal_name = 'Anonimizado', doc_number = '000', archived_at = coalesce(archived_at, now())
     where profile_id = p_id;

    -- GoTrue guarda por su cuenta el nombre y el teléfono en `raw_user_meta_data` y el email y el nombre en su registro
    -- de eventos (`auth.audit_log_entries`). Se limpian también (la Edge Function además lo hace por la API). Si el
    -- rol no tuviera permiso sobre el esquema `auth` (otro entorno), la anonimización de NUESTROS datos sigue adelante.
    begin
      update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'full_name' - 'phone_e164' - 'name'
       where id = p_id;
      delete from auth.audit_log_entries
       where payload ->> 'actor_id' = p_id::text or payload #>> '{traits,user_id}' = p_id::text;
    exception when insufficient_privilege or undefined_table or undefined_column then
      raise warning 'deactivate_profile: no se pudo limpiar el esquema auth (%)', sqlerrm;
    end;
  else
    update public.profiles set is_active = false where id = p_id;
  end if;
end;
$$;

-- ── 8. Ajuste de la tienda: rigor de la validación de NIT/CI ──────────────────────────────
-- `strict` exige el formato de cada tipo (CI/NIT de Bolivia); `lenient` acepta cualquier documento alfanumérico
-- razonable (para no bloquear una venta por un formato que cambie). Lo edita el admin en Ajustes.
insert into public.store_settings (key, value, value_type, is_public, description) values
  ('tax_id_validation', '"strict"', 'text', true,
   'Rigor al validar NIT/CI de los datos fiscales: strict (formato de cada tipo) o lenient (cualquier documento alfanumérico)')
on conflict (key) do nothing;

create or replace function public.store_settings_validate_s6()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.key = 'tax_id_validation' and (new.value #>> '{}') not in ('strict', 'lenient') then
    raise exception 'tax_id_validation debe ser strict o lenient' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists store_settings_validate_s6_trg on public.store_settings;
create trigger store_settings_validate_s6_trg before insert or update on public.store_settings
  for each row when (new.key = 'tax_id_validation') execute function public.store_settings_validate_s6();
