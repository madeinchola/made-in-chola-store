-- Sprint 2 · Storage de imágenes/videos y contenido del HOME editable por los admins.
-- Buckets públicos de LECTURA; escritura solo admin y solo en rutas con la convención correcta:
--   product-images  products/{product_id}/{uuid}.{jpg|jpeg|png|webp|avif}   (5 MiB)
--   site-media      home/{uuid}.{jpg|jpeg|png|webp|avif}                      (8 MiB)  imágenes del home
--   site-videos     home/{uuid}.{mp4|webm}                                    (50 MiB) videos del home
-- Rollback (manual): drop view public.public_home_section_items, public.public_home_sections;
--   drop table public.home_section_items, public.home_sections; drop function public.home_media_ok(text, text), public.storage_path_ok(text, text);
--   drop policy site_assets_admin_select|insert|update|delete on storage.objects; los buckets se vacían y borran desde
--   el panel o la API de Storage (Supabase bloquea el DELETE directo sobre storage.buckets/objects).

-- ── Validadores de ruta (puros) ────────────────────────────────────────────────────────────
create or replace function public.storage_path_ok(p_bucket text, p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_bucket
    when 'product-images' then p_name ~ '^products/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|avif)$'
    when 'site-media'     then p_name ~ '^home/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|avif)$'
    when 'site-videos'    then p_name ~ '^home/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|webm)$'
    else false
  end
$$;

-- Coherencia tipo de medio ↔ ruta (el medio de una sección del home).
create or replace function public.home_media_ok(p_kind text, p_path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'none'  then p_path is null
    when 'image' then p_path is not null and public.storage_path_ok('site-media', p_path)
    when 'video' then p_path is not null and public.storage_path_ok('site-videos', p_path)
    else false
  end
$$;
revoke all on function public.storage_path_ok(text, text), public.home_media_ok(text, text) from public;
grant execute on function public.storage_path_ok(text, text), public.home_media_ok(text, text)
  to anon, authenticated, service_role;

-- ── Buckets ────────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('product-images', 'product-images', true, 5242880,  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
  ('site-media',     'site-media',     true, 8388608,  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
  ('site-videos',    'site-videos',    true, 52428800, array['video/mp4', 'video/webm'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lectura pública: los buckets son públicos (URL directa). Escritura: solo admin y solo rutas válidas.
drop policy if exists site_assets_admin_select on storage.objects;
create policy site_assets_admin_select on storage.objects for select to authenticated
  using (bucket_id in ('product-images', 'site-media', 'site-videos') and public.is_admin());

drop policy if exists site_assets_admin_insert on storage.objects;
create policy site_assets_admin_insert on storage.objects for insert to authenticated
  with check (public.is_admin() and public.storage_path_ok(bucket_id, name));

drop policy if exists site_assets_admin_update on storage.objects;
create policy site_assets_admin_update on storage.objects for update to authenticated
  using (public.is_admin() and bucket_id in ('product-images', 'site-media', 'site-videos'))
  with check (public.is_admin() and public.storage_path_ok(bucket_id, name));

drop policy if exists site_assets_admin_delete on storage.objects;
create policy site_assets_admin_delete on storage.objects for delete to authenticated
  using (public.is_admin() and bucket_id in ('product-images', 'site-media', 'site-videos'));

-- ── Contenido del home (secciones editables) ───────────────────────────────────────────────
-- Una sección es un bloque del home (hero, fila de productos, colección destacada, "sobre nosotros",
-- banner, frase, mosaico de categorías). El admin las crea, ordena, activa y archiva desde el panel (S3).
create table if not exists public.home_sections (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null check (kind in
                         ('hero', 'product_row', 'collection_feature', 'about', 'banner', 'tagline', 'category_tiles')),
  sort_order           int not null default 0,
  is_active            boolean not null default true,
  title                text check (char_length(title) <= 120),
  body                 text check (char_length(body) <= 1500),
  cta_label            text check (char_length(cta_label) between 1 and 40),
  cta_url              text check (public.is_safe_link(cta_url)),
  media_kind           text not null default 'none' check (media_kind in ('none', 'image', 'video')),
  media_path           text,
  media_alt            text check (char_length(media_alt) <= 200),
  -- De dónde salen los productos de la sección (solo product_row y collection_feature).
  source_type          text not null default 'none' check (source_type in ('none', 'latest', 'category', 'collection', 'manual')),
  source_category_id   uuid references public.categories (id) on delete restrict,
  source_collection_id uuid references public.collections (id) on delete restrict,
  item_limit           int not null default 4 check (item_limit between 1 and 24),
  archived_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint home_sections_cta_pair check ((cta_label is null) = (cta_url is null)),
  constraint home_sections_media check (public.home_media_ok(media_kind, media_path)),
  constraint home_sections_source_ids check (
    (source_type = 'category') = (source_category_id is not null)
    and (source_type = 'collection') = (source_collection_id is not null)),
  constraint home_sections_source_kind check (
    (kind = 'product_row' and source_type in ('latest', 'category', 'collection', 'manual'))
    or (kind = 'collection_feature' and source_type = 'collection')
    or (kind not in ('product_row', 'collection_feature') and source_type = 'none'))
);
create index if not exists home_sections_order_idx on public.home_sections (sort_order, created_at) where archived_at is null;

-- Elementos de una sección: mosaicos de categorías, imagen + video de "sobre nosotros", productos elegidos a mano.
create table if not exists public.home_section_items (
  id            uuid primary key default gen_random_uuid(),
  section_id    uuid not null references public.home_sections (id) on delete restrict,
  sort_order    int not null default 0,
  label         text check (char_length(label) <= 80),
  link_url      text check (public.is_safe_link(link_url)),
  media_kind    text not null default 'none' check (media_kind in ('none', 'image', 'video')),
  media_path    text,
  media_alt     text check (char_length(media_alt) <= 200),
  product_id    uuid references public.products (id) on delete restrict,
  category_id   uuid references public.categories (id) on delete restrict,
  collection_id uuid references public.collections (id) on delete restrict,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint home_section_items_media check (public.home_media_ok(media_kind, media_path)),
  constraint home_section_items_one_ref check (num_nonnulls(product_id, category_id, collection_id) <= 1)
);
create index if not exists home_section_items_section_idx on public.home_section_items (section_id, sort_order);

do $$
declare t text;
begin
  foreach t in array array['home_sections', 'home_section_items']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_set_updated_at', t);
    execute format('drop trigger if exists %I on public.%I', 'audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I
                      for each row execute function public.audit_changes()', 'audit_' || t, t);
  end loop;
end $$;

select public._apply_admin_rls('home_sections',
  array['kind', 'sort_order', 'is_active', 'title', 'body', 'cta_label', 'cta_url', 'media_kind', 'media_path',
        'media_alt', 'source_type', 'source_category_id', 'source_collection_id', 'item_limit'],
  -- `kind` no se cambia: otro tipo de bloque = otra sección (evita estados incoherentes de source_*).
  array['sort_order', 'is_active', 'title', 'body', 'cta_label', 'cta_url', 'media_kind', 'media_path',
        'media_alt', 'source_type', 'source_category_id', 'source_collection_id', 'item_limit', 'archived_at']);
select public._apply_admin_rls('home_section_items',
  array['section_id', 'sort_order', 'label', 'link_url', 'media_kind', 'media_path', 'media_alt',
        'product_id', 'category_id', 'collection_id'],
  array['sort_order', 'label', 'link_url', 'media_kind', 'media_path', 'media_alt',
        'product_id', 'category_id', 'collection_id', 'archived_at']);

create or replace view public.public_home_sections as
select s.id, s.kind, s.sort_order, s.title, s.body, s.cta_label, s.cta_url,
       s.media_kind, s.media_path, s.media_alt,
       s.source_type,
       -- Las referencias a categorías/colecciones que ya no son públicas (archivadas, vencidas) se anulan: la vista no
       -- debe revelar ids de entidades privadas.
       case when s.source_category_id in (select c.id from public.public_categories c) then s.source_category_id end as source_category_id,
       case when s.source_collection_id in (select c.id from public.public_collections c) then s.source_collection_id end as source_collection_id,
       s.item_limit
  from public.home_sections s
 where s.is_active and s.archived_at is null
 order by s.sort_order, s.created_at;

create or replace view public.public_home_section_items as
select i.id, i.section_id, i.sort_order, i.label, i.link_url,
       i.media_kind, i.media_path, i.media_alt,
       case when i.product_id in (select p.id from public.public_products p) then i.product_id end as product_id,
       case when i.category_id in (select c.id from public.public_categories c) then i.category_id end as category_id,
       case when i.collection_id in (select c.id from public.public_collections c) then i.collection_id end as collection_id
  from public.home_section_items i
  join public.home_sections s on s.id = i.section_id
 where i.archived_at is null and s.is_active and s.archived_at is null
 order by i.section_id, i.sort_order, i.created_at;

revoke all on public.public_home_sections, public.public_home_section_items from public;
grant select on public.public_home_sections, public.public_home_section_items to anon, authenticated;
