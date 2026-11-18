-- Sprint 15 · Fase D — Analítica y atribución.
--
-- Qué hace:
--   * Dos ajustes PÚBLICOS para conectar la analítica sin desplegar nada: el ID del Pixel de Meta y el ID de medición de GA4. Vacíos
--     (como nacen) la tienda NO carga ninguna herramienta de terceros ni muestra el aviso de cookies. El token de la API de
--     conversiones de Meta NO es un ajuste: es un secreto de la función `meta-capi` (variable de entorno).
--   * `order_attribution`: de dónde llegó cada pedido (utm_*, tipo de clic, página de entrada y sitio de procedencia). Una fila por
--     pedido, escrita UNA vez por su dueña y solo si aceptó las cookies de analítica; ni el cliente ni el administrador leen ni
--     escriben la tabla directo: solo las funciones. NO guarda el identificador del clic (fbclid/gclid), solo de qué tipo era.
--   * `admin_attribution_summary`: ventas por origen con LA MISMA definición de «venta» de S14 (`_sales_orders`).
--
-- Rollback:
--   drop function public.record_order_attribution(text, jsonb), public.admin_attribution_summary(date, date), public.store_settings_validate_s15();
--   drop table public.order_attribution;
--   drop trigger store_settings_validate_s15_trg on public.store_settings;
--   delete from public.store_settings where key in ('analytics_meta_pixel_id', 'analytics_ga4_id');
--
-- Idempotente: se puede reaplicar.

-- ── 1. Ajustes ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.store_settings (key, value, value_type, is_public, description) values
  ('analytics_meta_pixel_id', '""', 'text', true, 'ID del Pixel de Meta (vacío = sin Meta; solo se carga con el consentimiento de marketing)'),
  ('analytics_ga4_id', '""', 'text', true, 'ID de medición de Google Analytics 4, p. ej. G-XXXXXXXXXX (vacío = sin GA4; solo con el consentimiento de analítica)')
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
  for each row when (new.key in ('analytics_meta_pixel_id', 'analytics_ga4_id'))
  execute function public.store_settings_validate_s15();

-- ── 2. De dónde llegó cada pedido ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.order_attribution (
  order_id      uuid primary key references public.orders (id) on delete cascade,
  utm_source    text check (utm_source is null or char_length(utm_source) between 1 and 100),
  utm_medium    text check (utm_medium is null or char_length(utm_medium) between 1 and 100),
  utm_campaign  text check (utm_campaign is null or char_length(utm_campaign) between 1 and 100),
  utm_content   text check (utm_content is null or char_length(utm_content) between 1 and 100),
  utm_term      text check (utm_term is null or char_length(utm_term) between 1 and 100),
  click_id_kind text check (click_id_kind is null or click_id_kind in ('fbclid', 'gclid')),
  landing_path  text check (landing_path is null or (landing_path ~ '^/' and char_length(landing_path) <= 200)),
  referrer_host text check (referrer_host is null or (referrer_host ~ '^[a-z0-9.-]+$' and char_length(referrer_host) <= 100)),
  recorded_at   timestamptz not null default now()
);
-- El origen es un DATO DEL PEDIDO (no tiene sentido sin él): si el pedido desaparece (en producción nunca se borra; las suites de prueba sí
-- limpian la tabla de pedidos), su origen se va con él en vez de impedirlo. Idempotente: converge aunque la tabla ya existiera con «restrict».
alter table public.order_attribution drop constraint if exists order_attribution_order_id_fkey;
alter table public.order_attribution add constraint order_attribution_order_id_fkey
  foreign key (order_id) references public.orders (id) on delete cascade;
alter table public.order_attribution enable row level security;
revoke all on public.order_attribution from public, anon, authenticated, service_role;

-- Limpia un texto de la URL: sin controles ni espacios de más, en minúsculas (para agrupar «Facebook» y «facebook»), máximo 100.
create or replace function public._attr_text(p_value jsonb, p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(lower(btrim(regexp_replace(case when jsonb_typeof(p_value -> p_key) = 'string' then p_value ->> p_key else '' end,
                                                  '[[:cntrl:]]', '', 'g'))), 100), '')
$$;

-- La dueña del pedido anota su origen, UNA vez y solo en las primeras 24 horas del pedido. Lo que llega del navegador se limpia y se acota:
-- es un dato de marketing, no una prueba de nada.
create or replace function public.record_order_attribution(p_number text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_path text;
  v_host text;
  v_click text;
begin
  if auth.uid() is null then
    raise exception 'login_required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'invalid_data' using errcode = '22023';
  end if;
  select * into v_order from public.orders o where o.number = p_number and o.profile_id = auth.uid();
  if not found then
    raise exception 'order_not_found' using errcode = '22023';
  end if;
  if v_order.created_at < now() - interval '1 day' then
    raise exception 'order_too_old' using errcode = '22023';
  end if;
  v_path := public._attr_text(p_data, 'landing_path');
  if v_path is not null and (v_path !~ '^/' or char_length(v_path) > 200) then
    v_path := null;
  end if;
  v_host := public._attr_text(p_data, 'referrer_host');
  if v_host is not null and v_host !~ '^[a-z0-9.-]+$' then
    v_host := null;
  end if;
  v_click := public._attr_text(p_data, 'click_id_kind');
  if v_click is not null and v_click not in ('fbclid', 'gclid') then
    v_click := null;
  end if;
  insert into public.order_attribution (order_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_id_kind, landing_path, referrer_host)
  values (v_order.id, public._attr_text(p_data, 'utm_source'), public._attr_text(p_data, 'utm_medium'), public._attr_text(p_data, 'utm_campaign'),
          public._attr_text(p_data, 'utm_content'), public._attr_text(p_data, 'utm_term'), v_click, v_path, v_host)
  on conflict (order_id) do nothing;
end;
$$;

-- ── 3. Ventas por origen (la misma definición de «venta» que el resto de las cifras) ─────────────────────────────────────────────
-- Un renglón por moneda y origen (fuente, medio, campaña). Los pedidos sin origen (no aceptó las cookies de analítica, o llegó directo)
-- van con los tres textos nulos: la pantalla los llama «Directo o sin datos». Nunca se suman monedas distintas.
create or replace function public.admin_attribution_summary(p_from date, p_to date)
returns table (currency text, utm_source text, utm_medium text, utm_campaign text, orders integer, gross numeric, net numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b record;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  select * into b from public._report_bounds(p_from, p_to);
  return query
    select s.currency, a.utm_source, a.utm_medium, a.utm_campaign, count(*)::int, sum(s.total), sum(s.net)
      from public._sales_orders(b.from_ts, b.to_ts) s
      left join public.order_attribution a on a.order_id = s.order_id
     group by s.currency, a.utm_source, a.utm_medium, a.utm_campaign
     order by s.currency, sum(s.net) desc, a.utm_source nulls last, a.utm_medium nulls last, a.utm_campaign nulls last;
end;
$$;

-- ── 4. Permisos ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.store_settings_validate_s15(), public._attr_text(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.record_order_attribution(text, jsonb) from public, anon, service_role;
grant execute on function public.record_order_attribution(text, jsonb) to authenticated;
revoke all on function public.admin_attribution_summary(date, date) from public, anon, service_role;
grant execute on function public.admin_attribution_summary(date, date) to authenticated;
