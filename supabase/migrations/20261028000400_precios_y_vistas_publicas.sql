-- Sprint 2 · Precios por moneda/país y vistas públicas (la ÚNICA puerta de lectura para anon).
-- Las vistas pertenecen al propietario (se ejecutan con sus privilegios, saltando la RLS de las tablas base) y
-- llevan el filtro de visibilidad DENTRO: solo productos activos y no archivados, jamás costo ni stock exacto.
-- Rollback (manual, en este orden: la función de búsqueda depende del tipo de fila de public_products):
--   drop function public.public_search_products(text, int), public.public_price_for(uuid, text, text), public.price_for(uuid, text, text);
--   drop view public.public_product_related, public.public_product_collections, public.public_product_categories,
--     public.public_product_images, public.public_product_variants, public.public_product_sizes, public.public_product_colors,
--     public.public_product_detail, public.public_products, public.public_store_settings, public.public_news_banners,
--     public.public_collections, public.public_categories;

-- ── Precio ─────────────────────────────────────────────────────────────────────────────────
-- Orden (maestro §7.1): precio explícito (moneda, país) → explícito (moneda, sin país) → si el producto lo
-- permite, precio BOB × tipo de cambio vigente. Redondeo: mitades alejándose de cero, a los decimales de la
-- moneda. Devuelve NULL (nunca un precio dudoso) si la moneda/país están deshabilitados, no hay precio, o la
-- tasa falta o es <= 0.
create or replace function public.price_for(p_product_id uuid, p_currency text default 'BOB', p_country text default null)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cur record;
  v_amount numeric;
  v_base numeric;
  v_rate numeric;
begin
  select c.decimals, c.enabled into v_cur from public.currencies c where c.code = p_currency;
  if not found or not v_cur.enabled then
    return null;
  end if;
  if p_country is not null and not exists (select 1 from public.countries k where k.code = p_country and k.enabled) then
    return null;
  end if;

  if p_country is not null then
    select pp.amount into v_amount from public.product_prices pp
     where pp.product_id = p_product_id and pp.currency = p_currency and pp.country = p_country;
    if found then return v_amount; end if;
  end if;
  select pp.amount into v_amount from public.product_prices pp
   where pp.product_id = p_product_id and pp.currency = p_currency and pp.country is null;
  if found then return v_amount; end if;

  if p_currency <> 'BOB' and exists (select 1 from public.products p where p.id = p_product_id and p.allow_converted_prices) then
    select pp.amount into v_base from public.product_prices pp
     where pp.product_id = p_product_id and pp.currency = 'BOB' and pp.country is null;
    v_rate := public.current_rate('BOB', p_currency);
    if v_base is not null and v_rate is not null and v_rate > 0 then
      return round(v_base * v_rate, v_cur.decimals);
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.price_for(uuid, text, text) from public, anon, authenticated;
grant execute on function public.price_for(uuid, text, text) to service_role;

-- ── Vistas públicas ────────────────────────────────────────────────────────────────────────
create or replace view public.public_categories as
select c.id, c.parent_id, c.name, c.slug, c.description, c.sort_order
  from public.categories c
 where c.archived_at is null;

create or replace view public.public_collections as
select c.id, c.name, c.slug, c.description, c.starts_at, c.ends_at, c.sort_order
  from public.collections c
 where c.archived_at is null
   and (c.starts_at is null or c.starts_at <= now())
   and (c.ends_at is null or c.ends_at > now());

create or replace view public.public_news_banners as
select b.id, b.message, b.link_url, b.starts_at, b.ends_at
  from public.news_banners b
 where b.archived_at is null and b.is_active
   and (b.starts_at is null or b.starts_at <= now())
   and (b.ends_at is null or b.ends_at > now())
 order by b.starts_at desc nulls last, b.created_at desc;

create or replace view public.public_store_settings as
select s.key, s.value from public.store_settings s where s.is_public;

-- Productos visibles: activo, no archivado, con precio BOB, y (si se agota) solo si el admin eligió "Agotado".
create or replace view public.public_products as
select p.id, p.slug, p.name, p.is_new,
       pr.price_bob,
       (select count(*) from public.product_colors c where c.product_id = p.id and c.archived_at is null)::int as colors_count,
       (st.total_available <= 0) as sold_out,
       img.path as cover_path,
       img.alt as cover_alt,
       p.created_at
  from public.products p
  -- Precio base (BOB, sin país) leído directo: una función restringida como price_for() fallaría para anon, porque
  -- en una vista las funciones corren con los permisos de quien consulta. Otras monedas: public_price_for().
  cross join lateral (
    select pp.amount as price_bob from public.product_prices pp
     where pp.product_id = p.id and pp.currency = 'BOB' and pp.country is null
  ) pr
  cross join lateral (
    select coalesce(sum(a.available), 0)::int as total_available,
           coalesce(sum(a.stock_on_hand), 0)::int as total_on_hand
      from public.product_variants v
      join public.variant_availability a on a.variant_id = v.id
     where v.product_id = p.id and v.archived_at is null
  ) st
  left join lateral (
    select i.path, i.alt
      from public.product_images i
      left join public.product_colors c on c.id = i.color_id
     where i.product_id = p.id and i.archived_at is null and (i.color_id is null or c.archived_at is null)
     order by i.sort_order, i.created_at
     limit 1
  ) img on true
 where p.status = 'active' and p.archived_at is null
   and pr.price_bob is not null
   -- "Ocultar" depende del stock FÍSICO: que un carrito retenga las últimas unidades NO debe hacer desaparecer el producto
   -- (ni su página); en ese caso se muestra como agotado hasta que la retención venza.
   and (p.out_of_stock_behavior = 'sold_out' or st.total_on_hand > 0);

create or replace view public.public_product_detail as
select pp.*, p.model, p.description, p.materials, p.washcare
  from public.public_products pp
  join public.products p on p.id = pp.id;

create or replace view public.public_product_colors as
select c.id, c.product_id, c.name, c.hex, c.sort_order
  from public.product_colors c
 where c.archived_at is null and c.product_id in (select id from public.public_products);

create or replace view public.public_product_sizes as
select s.id, s.product_id, s.label, s.sort_order
  from public.product_sizes s
 where s.archived_at is null and s.product_id in (select id from public.public_products);

-- Estado por variante SIN revelar cantidades exactas: in_stock | low (pocas unidades) | out.
create or replace view public.public_product_variants as
select v.id, v.product_id, v.color_id, v.size_id,
       case when a.available <= 0 then 'out'
            when a.availability_light in ('critical', 'low') then 'low'
            else 'in_stock' end as stock_status
  from public.product_variants v
  join public.variant_availability a on a.variant_id = v.id
  join public.product_colors c on c.id = v.color_id and c.archived_at is null
 where v.archived_at is null
   and (v.size_id is null or exists (select 1 from public.product_sizes s where s.id = v.size_id and s.archived_at is null))
   and v.product_id in (select id from public.public_products);

create or replace view public.public_product_images as
select i.id, i.product_id, i.color_id, i.path, i.alt, i.sort_order
  from public.product_images i
  left join public.product_colors c on c.id = i.color_id
 where i.archived_at is null and (i.color_id is null or c.archived_at is null)
   and i.product_id in (select id from public.public_products);

create or replace view public.public_product_categories as
select pc.product_id, pc.category_id
  from public.product_categories pc
 where pc.category_id in (select id from public.public_categories)
   and pc.product_id in (select id from public.public_products);

create or replace view public.public_product_collections as
select pc.product_id, pc.collection_id, pc.sort_order
  from public.product_collections pc
 where pc.collection_id in (select id from public.public_collections)
   and pc.product_id in (select id from public.public_products);

create or replace view public.public_product_related as
select r.product_id, r.related_id, r.sort_order
  from public.product_related r
 where r.product_id in (select id from public.public_products)
   and r.related_id in (select id from public.public_products);

revoke all on public.public_categories, public.public_collections, public.public_news_banners,
              public.public_store_settings, public.public_products, public.public_product_detail,
              public.public_product_colors, public.public_product_sizes, public.public_product_variants,
              public.public_product_images, public.public_product_categories, public.public_product_collections,
              public.public_product_related from public;
grant select on public.public_categories, public.public_collections, public.public_news_banners,
                public.public_store_settings, public.public_products, public.public_product_detail,
                public.public_product_colors, public.public_product_sizes, public.public_product_variants,
                public.public_product_images, public.public_product_categories, public.public_product_collections,
                public.public_product_related to anon, authenticated;

-- ── RPC públicas ───────────────────────────────────────────────────────────────────────────
-- Precio de un producto VISIBLE en cualquier moneda/país habilitado (NULL si no es visible o no hay precio).
create or replace function public.public_price_for(p_product_id uuid, p_currency text default 'BOB', p_country text default null)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (select 1 from public.public_products pp where pp.id = p_product_id)
              then public.price_for(p_product_id, p_currency, p_country) end
$$;

-- Búsqueda sin acentos ni mayúsculas por nombre, modelo y código; primero código exacto y nombres que
-- empiezan igual, luego por similitud. Mínimo 2 caracteres; los comodines de LIKE del usuario se escapan.
create or replace function public.public_search_products(p_query text, p_limit int default 24)
returns setof public.public_products
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Se recorta a 80 caracteres: la llama anon y una consulta de cientos de KB sería un amplificador de CPU barato.
  v_q text := left(public.f_unaccent(lower(btrim(coalesce(p_query, '')))), 80);
  v_esc text;
begin
  if char_length(v_q) < 2 then
    return;
  end if;
  v_esc := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select pp.*
      from public.public_products pp
      join public.products p on p.id = pp.id
     where public.f_unaccent(lower(p.name)) like '%' || v_esc || '%'
        or public.f_unaccent(lower(coalesce(p.model, ''))) like '%' || v_esc || '%'
        or lower(p.code) like '%' || v_esc || '%'
     order by (lower(p.code) = v_q) desc,
              (public.f_unaccent(lower(p.name)) like v_esc || '%') desc,
              extensions.similarity(public.f_unaccent(lower(p.name)), v_q) desc,
              pp.name
     limit greatest(1, least(coalesce(p_limit, 24), 100));
end;
$$;

revoke all on function public.public_price_for(uuid, text, text), public.public_search_products(text, int) from public;
grant execute on function public.public_price_for(uuid, text, text), public.public_search_products(text, int)
  to anon, authenticated, service_role;
