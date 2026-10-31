-- Sprint 3 · Outbox de notificaciones (mínima), alertas de stock, historial de slugs y duplicar producto.
-- Crea: public.notification_outbox, public.enqueue_notification(), public.stock_movements_alert() (+ trigger),
--       public.product_slug_history, public.products_log_slug_change() (+ trigger), vista public.public_product_slug_redirects,
--       public.admin_duplicate_product(uuid, text, text), vista public.admin_product_list, public.admin_set_stock(uuid, int, int, text, text).
-- Rollback (manual, orden inverso):
--   drop function public.admin_set_stock(uuid, int, int, text, text);
--   drop view public.admin_product_list;
--   drop function public.admin_duplicate_product(uuid, text, text);
--   drop view public.public_product_slug_redirects;
--   drop trigger products_log_slug_change_trg on public.products; drop function public.products_log_slug_change();
--   drop table public.product_slug_history;
--   drop trigger stock_movements_alert_trg on public.stock_movements; drop function public.stock_movements_alert();
--   drop function public.enqueue_notification(text, text, text, jsonb, text); drop table public.notification_outbox;

-- ── Outbox de notificaciones (maestro §7.7) ────────────────────────────────────────────────
-- S3 la crea con lo mínimo para encolar alertas de stock; S13 la completa (plantillas, estados sending/dead, sent_at, error).
-- Deny-by-default: solo el admin la lee; el navegador no escribe nada. Escribe `enqueue_notification` (service_role y triggers).
create table if not exists public.notification_outbox (
  id            bigint generated always as identity primary key,
  type          text not null check (type ~ '^[a-z][a-z0-9_]{0,59}$'),
  channel       text not null check (channel in ('email', 'whatsapp')),
  -- NULL = los administradores (el destinatario concreto lo resuelve el worker de S13).
  recipient     text check (char_length(recipient) <= 320),
  payload       jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  status        text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts      int not null default 0 check (attempts >= 0),
  next_retry_at timestamptz not null default now(),
  dedupe_key    text not null check (char_length(dedupe_key) between 1 and 200),
  created_at    timestamptz not null default now(),
  constraint notification_outbox_dedupe_key unique (dedupe_key)
);
create index if not exists notification_outbox_pending_idx
  on public.notification_outbox (next_retry_at) where status = 'pending';
create index if not exists notification_outbox_type_idx on public.notification_outbox (type, created_at desc);

select public._apply_admin_rls('notification_outbox', null, null);
-- El worker de S13 (service_role) leerá y marcará envíos; nunca borra (queda el rastro).
grant select, insert, update on public.notification_outbox to service_role;

-- Encola una notificación. Idempotente por `dedupe_key`: devuelve el id, o NULL si ya existía.
create or replace function public.enqueue_notification(
  p_type text, p_channel text, p_recipient text, p_payload jsonb, p_dedupe_key text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  insert into public.notification_outbox (type, channel, recipient, payload, dedupe_key)
  values (p_type, p_channel, p_recipient, coalesce(p_payload, '{}'), p_dedupe_key)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.enqueue_notification(text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.enqueue_notification(text, text, text, jsonb, text) to service_role;

-- ── Alerta de stock (BR-INV-05) ────────────────────────────────────────────────────────────
-- Toda variación de stock físico pasa por stock_movements (libro mayor inmutable): ahí se detecta el CRUCE de un umbral.
-- Solo alerta al EMPEORAR (ok→bajo, bajo→crítico, →agotado) y solo de variantes activas de productos publicados; por eso no se
-- repite cada minuto: una nueva alerta exige que el stock suba de umbral y vuelva a cruzarlo. Mientras haya una alerta
-- pendiente del mismo nivel para esa variante no se encola otra.
create or replace function public.stock_movements_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_info record;
  v_low int;
  v_critical int;
  v_before text;
  v_after text;
begin
  select pv.id as variant_id, pv.sku, pv.low_threshold, pv.critical_threshold,
         p.id as product_id, p.code, p.name, c.name as color, s.label as size
    into v_info
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    join public.product_colors c on c.id = pv.color_id
    left join public.product_sizes s on s.id = pv.size_id
   where pv.id = new.variant_id
     and pv.archived_at is null and p.archived_at is null and p.status = 'active';
  if not found then return null; end if;

  v_low := coalesce(v_info.low_threshold, public.setting_int('stock_low_threshold', 5));
  v_critical := least(coalesce(v_info.critical_threshold, public.setting_int('stock_critical_threshold', 2)), v_low);
  v_before := public.stock_status(new.stock_after - new.delta, v_low, v_critical);
  v_after := public.stock_status(new.stock_after, v_low, v_critical);

  if v_after <> 'ok'
     and (case v_after when 'out' then 0 when 'critical' then 1 else 2 end)
       < (case v_before when 'out' then 0 when 'critical' then 1 when 'low' then 2 else 3 end)
     and not exists (select 1 from public.notification_outbox o
                      where o.type = 'stock_alert' and o.status = 'pending'
                        and o.payload ->> 'variant_id' = v_info.variant_id::text and o.payload ->> 'light' = v_after)
  then
    perform public.enqueue_notification(
      'stock_alert', 'email', null,
      jsonb_build_object('variant_id', v_info.variant_id, 'product_id', v_info.product_id, 'product_code', v_info.code,
                         'product_name', v_info.name, 'color', v_info.color, 'size', v_info.size, 'sku', v_info.sku,
                         'stock', new.stock_after, 'light', v_after, 'low_threshold', v_low, 'critical_threshold', v_critical),
      'stock_alert:' || v_info.variant_id || ':' || v_after || ':' || new.id);
  end if;
  return null;
end;
$$;
revoke all on function public.stock_movements_alert() from public, anon, authenticated;
drop trigger if exists stock_movements_alert_trg on public.stock_movements;
create trigger stock_movements_alert_trg after insert on public.stock_movements
  for each row execute function public.stock_movements_alert();

-- ── Historial de slugs (redirecciones, S5) ─────────────────────────────────────────────────
-- Al renombrar un producto el slug anterior sigue funcionando (redirige al actual): URLs compartidas e indexadas no se rompen.
create table if not exists public.product_slug_history (
  id         bigint generated always as identity primary key,
  product_id uuid not null references public.products (id) on delete restrict,
  slug       text not null,
  changed_at timestamptz not null default now(),
  changed_by uuid default auth.uid(),
  -- ¿Era público ese slug? (el producto estaba publicado y no archivado cuando se cambió). Solo los públicos redirigen: los
  -- nombres de trabajo de un borrador NO deben poder leerse desde fuera al publicarlo.
  was_public boolean not null default false
);
alter table public.product_slug_history add column if not exists was_public boolean not null default false;
create index if not exists product_slug_history_slug_idx on public.product_slug_history (slug, changed_at desc);
create index if not exists product_slug_history_product_idx on public.product_slug_history (product_id);

select public._apply_admin_rls('product_slug_history', null, null);
drop trigger if exists product_slug_history_immutable on public.product_slug_history;
create trigger product_slug_history_immutable before update or delete on public.product_slug_history
  for each row execute function public.immutable_row();
drop trigger if exists product_slug_history_no_truncate on public.product_slug_history;
create trigger product_slug_history_no_truncate before truncate on public.product_slug_history
  for each statement execute function public.immutable_row();

create or replace function public.products_log_slug_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.product_slug_history (product_id, slug, was_public)
  values (old.id, old.slug, old.status = 'active' and old.archived_at is null);
  return null;
end;
$$;
revoke all on function public.products_log_slug_change() from public, anon, authenticated;
drop trigger if exists products_log_slug_change_trg on public.products;
create trigger products_log_slug_change_trg after update of slug on public.products
  for each row when (old.slug is distinct from new.slug)
  execute function public.products_log_slug_change();

-- Lectura pública SOLO por esta vista: slug antiguo → slug actual de un producto visible. Si el slug antiguo vuelve a ser
-- vigente en algún producto, prevalece el vigente (no hay redirección). Si lo tuvieron varios, gana el cambio más reciente.
-- Solo redirigen los slugs que eran PÚBLICOS al cambiarlos (`was_public`): un borrador renombrado no filtra sus nombres internos.
create or replace view public.public_product_slug_redirects as
select distinct on (h.slug) h.slug as old_slug, p.slug as current_slug
  from public.product_slug_history h
  join public.public_products p on p.id = h.product_id
 where h.was_public
   and not exists (select 1 from public.products x where x.slug = h.slug)
 order by h.slug, h.changed_at desc, h.id desc;
revoke all on public.public_product_slug_redirects from public, anon, authenticated;
grant select on public.public_product_slug_redirects to anon, authenticated;

-- ── Duplicar producto ──────────────────────────────────────────────────────────────────────
-- Clona estructura (datos, colores, tallas, variantes SIN stock, precios, categorías, colecciones, relacionados). No copia
-- imágenes ni stock. El duplicado nace en BORRADOR. Una sola transacción: o queda completo o no queda nada.
create or replace function public.admin_duplicate_product(p_product_id uuid, p_new_code text, p_new_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src public.products%rowtype;
  v_code text := btrim(p_new_code);
  v_name text := btrim(p_new_name);
  v_new uuid;
  v_base text;
  v_slug text;
  v_n int := 1;
  v_cmap jsonb := '{}';
  v_smap jsonb := '{}';
  r record;
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'solo administradores' using errcode = '42501'; end if;
  select * into v_src from public.products where id = p_product_id;
  if not found then raise exception 'producto inexistente' using errcode = 'P0002'; end if;

  if v_code is null or v_code !~ '^[A-Za-z0-9._-]{1,40}$' then
    raise exception 'el código solo admite letras, números, punto, guion y guion bajo (máximo 40)' using errcode = '23514';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 160 then
    raise exception 'el nombre debe tener entre 1 y 160 caracteres' using errcode = '23514';
  end if;
  if exists (select 1 from public.products where lower(code) = lower(v_code)) then
    raise exception 'ya existe un producto con el código %', v_code using errcode = '23505';
  end if;

  v_base := public.slugify(v_name);
  if v_base = '' then v_base := public.slugify(v_code); end if;
  if v_base = '' then raise exception 'no se pudo generar una dirección (slug) con ese nombre' using errcode = '23514'; end if;
  v_base := regexp_replace(left(v_base, 74), '-+$', '');
  v_slug := v_base;
  while exists (select 1 from public.products where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  insert into public.products (code, slug, name, model, description, materials, washcare, cost_base,
                               out_of_stock_behavior, status, is_new, allow_converted_prices)
  values (v_code, v_slug, v_name, v_src.model, v_src.description, v_src.materials, v_src.washcare, v_src.cost_base,
          v_src.out_of_stock_behavior, 'draft', v_src.is_new, v_src.allow_converted_prices)
  returning id into v_new;

  for r in select * from public.product_colors where product_id = p_product_id and archived_at is null
            order by sort_order, created_at loop
    insert into public.product_colors (product_id, name, hex, sort_order) values (v_new, r.name, r.hex, r.sort_order)
    returning id into v_id;
    v_cmap := v_cmap || jsonb_build_object(r.id::text, v_id::text);
  end loop;
  for r in select * from public.product_sizes where product_id = p_product_id and archived_at is null
            order by sort_order, created_at loop
    insert into public.product_sizes (product_id, label, sort_order) values (v_new, r.label, r.sort_order)
    returning id into v_id;
    v_smap := v_smap || jsonb_build_object(r.id::text, v_id::text);
  end loop;

  -- Variantes activas cuyo color (y talla, si la tienen) también se copiaron; el stock arranca en 0.
  for r in select * from public.product_variants
            where product_id = p_product_id and archived_at is null
              and v_cmap ? color_id::text and (size_id is null or v_smap ? size_id::text) loop
    insert into public.product_variants (product_id, color_id, size_id, low_threshold, critical_threshold)
    values (v_new, (v_cmap ->> r.color_id::text)::uuid,
            case when r.size_id is null then null else (v_smap ->> r.size_id::text)::uuid end,
            r.low_threshold, r.critical_threshold);
  end loop;

  insert into public.product_prices (product_id, currency, country, amount)
  select v_new, currency, country, amount from public.product_prices where product_id = p_product_id;
  insert into public.product_categories (product_id, category_id)
  select v_new, pc.category_id from public.product_categories pc
    join public.categories c on c.id = pc.category_id and c.archived_at is null
   where pc.product_id = p_product_id;
  insert into public.product_collections (product_id, collection_id, sort_order)
  select v_new, pc.collection_id, pc.sort_order from public.product_collections pc
    join public.collections c on c.id = pc.collection_id and c.archived_at is null
   where pc.product_id = p_product_id;
  insert into public.product_related (product_id, related_id, sort_order)
  select v_new, related_id, sort_order from public.product_related where product_id = p_product_id;

  return v_new;
end;
$$;
revoke all on function public.admin_duplicate_product(uuid, text, text) from public, anon;
grant execute on function public.admin_duplicate_product(uuid, text, text) to authenticated;

-- ── Listado del panel ──────────────────────────────────────────────────────────────────────
-- Una sola consulta con todo lo que muestra el listado: filtros, orden, paginación y conteo exacto en el servidor (un filtro
-- hecho en el navegador se rompería con más de 1000 productos por el límite de filas de la API). Solo el admin ve filas
-- (el filtro is_admin() va dentro de la vista, como en admin_stock_overview). `display_state` aplica las MISMAS reglas que
-- public_products ("Ocultar" depende del stock FÍSICO; "agotado" de lo disponible) para que panel y tienda no discrepen.
create or replace view public.admin_product_list as
select p.id, p.code, p.slug, p.name, p.status, p.archived_at, p.is_new, p.out_of_stock_behavior,
       p.created_at, p.updated_at,
       pr.amount as price_bob,
       img.path as cover_path,
       coalesce(cat.ids, '{}'::uuid[]) as category_ids,
       coalesce(col.ids, '{}'::uuid[]) as collection_ids,
       s.total_on_hand, s.total_available, s.variants_count, s.variants_out, s.worst_light,
       case
         when p.archived_at is not null then 'archived'
         when p.status = 'draft' then 'draft'
         when p.out_of_stock_behavior = 'hide' and s.total_on_hand <= 0 then 'hidden'
         when s.total_available <= 0 then 'soldout'
         else 'active'
       end as display_state
  from public.products p
  join public.admin_product_stock s on s.product_id = p.id
  left join public.product_prices pr on pr.product_id = p.id and pr.currency = 'BOB' and pr.country is null
  left join lateral (
    select i.path
      from public.product_images i
      left join public.product_colors c on c.id = i.color_id
     where i.product_id = p.id and i.archived_at is null and (i.color_id is null or c.archived_at is null)
     order by i.sort_order, i.created_at
     limit 1
  ) img on true
  left join lateral (select array_agg(pc.category_id) as ids from public.product_categories pc where pc.product_id = p.id) cat on true
  left join lateral (select array_agg(pc.collection_id) as ids from public.product_collections pc where pc.product_id = p.id) col on true
 where public.is_admin();
revoke all on public.admin_product_list from public, anon;
grant select on public.admin_product_list to authenticated;

-- ── Fijar el stock a un valor EXACTO, comprobando lo que se vio ────────────────────────────
-- El panel muestra "nuevo stock = N". Enviar un delta calculado contra lo que se leyó al abrir la pantalla era frágil: si una
-- venta o un compañero cambiaba el stock entre tanto, el resultado final no era N y nadie se enteraba. Esta función bloquea
-- la variante, compara con el stock que la persona VIO (`p_expected`) y, si cambió, rechaza diciendo cuánto hay ahora.
-- Si coincide, delega en adjust_stock (mismas reglas: motivos, no bajar de lo comprometido) y deja el movimiento en el libro.
create or replace function public.admin_set_stock(
  p_variant_id uuid, p_expected int, p_new int, p_reason text, p_note text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_current int;
begin
  if not public.is_admin() then raise exception 'solo administradores' using errcode = '42501'; end if;
  if p_expected is null or p_new is null or p_expected < 0 or p_new < 0 then
    raise exception 'las cantidades deben ser enteros de 0 o más' using errcode = '22023';
  end if;
  select v.stock_on_hand into v_current from public.product_variants v where v.id = p_variant_id for update;
  if not found then raise exception 'variante inexistente' using errcode = 'P0002'; end if;
  if v_current <> p_expected then
    raise exception 'el stock cambió mientras editabas: ahora hay % unidades y esperabas %', v_current, p_expected
      using errcode = 'P0001';
  end if;
  if p_new = p_expected then return v_current; end if;
  return public.adjust_stock(p_variant_id, p_new - p_expected, p_reason, p_note);
end;
$$;
revoke all on function public.admin_set_stock(uuid, int, int, text, text) from public, anon;
grant execute on function public.admin_set_stock(uuid, int, int, text, text) to authenticated;
