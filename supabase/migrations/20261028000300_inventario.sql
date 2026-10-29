-- Sprint 2 · Inventario: libro mayor de movimientos, reservas atómicas, disponibilidad y semáforo.
-- Reglas: BR-INV-01..06, BR-DAT-02. Modelo de dos capas del maestro §7.2:
--   · retención blanda (owner_type='cart', con TTL) · compromiso firme (owner_type='order', sin TTL; lo usa S10).
-- Todo cambio de stock pasa por funciones; `stock_on_hand` no se puede tocar con UPDATE directo.
-- Las funciones de reserva solo las ejecuta service_role (Edge Functions): el carrito anónimo (S7) las llamará
-- detrás de una función con límites de abuso (D-02), nunca directamente desde el navegador.
--
-- Rollback (manual): drop view public.admin_product_stock, public.admin_stock_overview, public.variant_availability;
--   drop function public.adjust_stock(uuid, int, text, text), public.apply_stock_change(uuid, int, text, text, text, uuid),
--   public.reserve_stock(uuid, int, text, uuid, int), public.release_stock(text, uuid, uuid),
--   public.expire_reservations(), public.purge_stock_reservations(interval), public.stock_status(int, int, int),
--   public.stock_guard(), public.release_reservations_on_archive();
--   drop table public.stock_reservations, public.stock_movements; select cron.unschedule('expire-stock-reservations'); select cron.unschedule('purge-stock-reservations');

create table if not exists public.stock_movements (
  id          bigint generated always as identity primary key,
  variant_id  uuid not null references public.product_variants (id) on delete restrict,
  delta       int not null check (delta <> 0),
  reason      text not null check (reason in ('sale', 'return', 'adjust', 'import', 'cancel')),
  stock_after int not null check (stock_after >= 0),
  ref         text check (char_length(ref) <= 120),
  note        text check (char_length(note) <= 300),
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists stock_movements_variant_idx on public.stock_movements (variant_id, created_at desc);

drop trigger if exists stock_movements_immutable on public.stock_movements;
create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function public.immutable_row();
drop trigger if exists stock_movements_no_truncate on public.stock_movements;
create trigger stock_movements_no_truncate before truncate on public.stock_movements
  for each statement execute function public.immutable_row();

create table if not exists public.stock_reservations (
  id         uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants (id) on delete restrict,
  qty        int not null check (qty > 0),
  owner_type text not null check (owner_type in ('cart', 'order')),
  owner_id   uuid not null,
  expires_at timestamptz,
  status     text not null default 'active' check (status in ('active', 'released', 'expired', 'consumed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Una retención de carrito SIEMPRE vence; solo el compromiso de un pedido puede no tener vencimiento.
  constraint stock_reservations_cart_expires check (owner_type <> 'cart' or expires_at is not null)
);
create unique index if not exists stock_reservations_active_owner_key
  on public.stock_reservations (variant_id, owner_type, owner_id) where status = 'active';
create index if not exists stock_reservations_active_variant_idx
  on public.stock_reservations (variant_id) where status = 'active';
create index if not exists stock_reservations_expiry_idx
  on public.stock_reservations (expires_at) where status = 'active' and expires_at is not null;
-- release_stock(owner_type, owner_id) y las lecturas de "mis reservas" (carrito, S7) filtran por dueño.
create index if not exists stock_reservations_owner_idx
  on public.stock_reservations (owner_type, owner_id) where status = 'active';

-- Solo las funciones (propietario) escriben aquí: ni el admin ni service_role directamente.
select public._apply_admin_rls('stock_movements', null, null);
select public._apply_admin_rls('stock_reservations', null, null);
revoke insert, update on public.stock_movements from service_role;
revoke insert, update on public.stock_reservations from service_role;

-- ── Semáforo ───────────────────────────────────────────────────────────────────────────────
-- Límites inclusivos: disponible <= crítico → critical; <= aviso → low; <= 0 → out.
create or replace function public.stock_status(p_available int, p_low int, p_critical int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_available <= 0 then 'out'
    when p_available <= p_critical then 'critical'
    when p_available <= p_low then 'low'
    else 'ok'
  end
$$;

-- ── Disponibilidad (interna; nadie la lee directo: la usan RPC y vistas públicas/admin) ────
-- available = stock físico − reservas vigentes (activas y no vencidas), nunca negativo. Una reserva vencida
-- deja de contar aunque el cron aún no la haya marcado: la corrección no depende del reloj del cron.
create or replace view public.variant_availability as
select v.id as variant_id,
       v.product_id,
       v.stock_on_hand,
       coalesce(r.reserved, 0)::int as reserved,
       greatest(v.stock_on_hand - coalesce(r.reserved, 0), 0)::int as available,
       t.low_threshold,
       t.critical_threshold,
       -- semáforo del inventario físico (alertas al admin)
       public.stock_status(v.stock_on_hand, t.low_threshold, t.critical_threshold) as stock_light,
       -- semáforo de lo que realmente se puede comprar ahora (estado público)
       public.stock_status(greatest(v.stock_on_hand - coalesce(r.reserved, 0), 0)::int, t.low_threshold, t.critical_threshold) as availability_light
  from public.product_variants v
  -- OJO: dentro de una vista, las funciones se ejecutan con los permisos de QUIEN CONSULTA (no del dueño). Por eso
  -- los umbrales se leen con una subconsulta directa a store_settings (la tabla sí se lee como dueño) y no con
  -- setting_int(), que anon/authenticated no pueden ejecutar.
  cross join lateral (
    select coalesce(v.low_threshold,
                    (select (s.value #>> '{}')::int from public.store_settings s where s.key = 'stock_low_threshold'),
                    5) as low_threshold
  ) lo
  cross join lateral (
    select lo.low_threshold,
           least(coalesce(v.critical_threshold,
                          (select (s.value #>> '{}')::int from public.store_settings s where s.key = 'stock_critical_threshold'),
                          2), lo.low_threshold) as critical_threshold
  ) t
  left join lateral (
    select sum(sr.qty) as reserved
      from public.stock_reservations sr
     where sr.variant_id = v.id and sr.status = 'active' and (sr.expires_at is null or sr.expires_at > now())
  ) r on true;

-- Vistas para el panel (S3): solo el admin ve filas (el filtro `is_admin()` va dentro de la vista).
create or replace view public.admin_stock_overview as
select v.id as variant_id, v.product_id, p.code as product_code, p.name as product_name, p.status as product_status,
       c.name as color_name, sz.label as size_label, v.sku, v.archived_at as variant_archived_at,
       a.stock_on_hand, a.reserved, a.available, a.low_threshold, a.critical_threshold, a.stock_light
  from public.product_variants v
  join public.products p on p.id = v.product_id
  join public.product_colors c on c.id = v.color_id
  left join public.product_sizes sz on sz.id = v.size_id
  join public.variant_availability a on a.variant_id = v.id
 where public.is_admin();

create or replace view public.admin_product_stock as
select p.id as product_id, p.code, p.name, p.status, p.archived_at,
       coalesce(sum(a.stock_on_hand) filter (where v.archived_at is null), 0)::int as total_on_hand,
       coalesce(sum(a.available) filter (where v.archived_at is null), 0)::int as total_available,
       (count(v.id) filter (where v.archived_at is null))::int as variants_count,
       (count(v.id) filter (where v.archived_at is null and a.stock_light = 'out'))::int as variants_out,
       -- el peor semáforo entre las variantes activas (out < critical < low < ok); NULL si no hay variantes
       case min(case a.stock_light when 'out' then 0 when 'critical' then 1 when 'low' then 2 else 3 end)
              filter (where v.archived_at is null)
         when 0 then 'out' when 1 then 'critical' when 2 then 'low' when 3 then 'ok' end as worst_light
  from public.products p
  left join public.product_variants v on v.product_id = p.id
  left join public.variant_availability a on a.variant_id = v.id
 where public.is_admin()
 group by p.id;

revoke all on public.admin_stock_overview, public.admin_product_stock from public, anon;
grant select on public.admin_stock_overview, public.admin_product_stock to authenticated;

-- ── Guarda del libro mayor ─────────────────────────────────────────────────────────────────
-- stock_on_hand solo cambia dentro de apply_stock_change (que marca la transacción), y las variantes
-- nacen con 0: así `sum(stock_movements.delta) = stock_on_hand` es un invariante, no una esperanza.
create or replace function public.stock_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.stock_on_hand <> 0 then
      raise exception 'las variantes nacen con stock 0; el stock inicial se carga con adjust_stock' using errcode = '42501';
    end if;
  elsif new.stock_on_hand is distinct from old.stock_on_hand
        and coalesce(current_setting('app.stock_change', true), '') <> '1' then
    raise exception 'el stock solo se modifica con las funciones de stock (adjust_stock, apply_stock_change)' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists product_variants_stock_guard on public.product_variants;
create trigger product_variants_stock_guard before insert or update of stock_on_hand on public.product_variants
  for each row execute function public.stock_guard();
-- Defensa en profundidad: ni service_role tiene privilegio de columna sobre stock_on_hand (el trigger de arriba lo
-- frenaría igual, pero un privilegio ausente es más fuerte que una regla que alguien podría saltar con set_config).
revoke update on public.product_variants from service_role;
grant update (sku, low_threshold, critical_threshold, archived_at) on public.product_variants to service_role;

-- ── Movimiento de stock (interno) ──────────────────────────────────────────────────────────
create or replace function public.apply_stock_change(
  p_variant_id uuid, p_delta int, p_reason text, p_ref text default null, p_note text default null, p_user uuid default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on_hand int;
  v_new int;
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'el cambio de stock no puede ser 0' using errcode = '22023';
  end if;
  select v.stock_on_hand into v_on_hand from public.product_variants v where v.id = p_variant_id for update;
  if not found then
    raise exception 'variante inexistente' using errcode = 'P0002';
  end if;
  v_new := v_on_hand + p_delta;
  if v_new < 0 then
    raise exception 'stock insuficiente: hay % y se intentó restar %', v_on_hand, -p_delta using errcode = '23514';
  end if;
  perform set_config('app.stock_change', '1', true);
  update public.product_variants set stock_on_hand = v_new where id = p_variant_id;
  perform set_config('app.stock_change', '', true);
  insert into public.stock_movements (variant_id, delta, reason, stock_after, ref, note, created_by)
  values (p_variant_id, p_delta, p_reason, v_new, p_ref, p_note, coalesce(p_user, auth.uid()));
  return v_new;
end;
$$;

-- Ajuste manual del admin. Propuesta del sprint: no se puede bajar el stock por debajo de lo que ya está
-- comprometido en pedidos (reservas firmes), para no dejar al sistema "sobrecomprometido".
create or replace function public.adjust_stock(p_variant_id uuid, p_delta int, p_reason text, p_note text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on_hand int;
  v_committed int;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if p_reason not in ('adjust', 'import', 'return') then
    raise exception 'motivo inválido para un ajuste manual: %', p_reason using errcode = '22023';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception 'el ajuste no puede ser 0' using errcode = '22023';
  end if;
  -- "import" y "return" solo SUMAN; restar es un "adjust". Así los reportes del libro mayor por motivo no mienten.
  if p_reason in ('import', 'return') and p_delta < 0 then
    raise exception 'el motivo "%" solo suma stock: para restar usa "adjust"', p_reason using errcode = '22023';
  end if;
  select v.stock_on_hand into v_on_hand from public.product_variants v where v.id = p_variant_id for update;
  if not found then
    raise exception 'variante inexistente' using errcode = 'P0002';
  end if;
  if v_on_hand + p_delta < 0 then
    raise exception 'stock insuficiente: hay % y se intentó restar %', v_on_hand, -p_delta using errcode = '23514';
  end if;
  if p_delta < 0 then
    select coalesce(sum(r.qty), 0) into v_committed from public.stock_reservations r
     where r.variant_id = p_variant_id and r.status = 'active' and r.owner_type = 'order'
       and (r.expires_at is null or r.expires_at > now());
    if v_on_hand + p_delta < v_committed then
      raise exception 'no puedes dejar el stock en % porque % unidades ya están comprometidas en pedidos',
        v_on_hand + p_delta, v_committed using errcode = 'P0001';
    end if;
  end if;
  return public.apply_stock_change(p_variant_id, p_delta, p_reason, null, p_note, auth.uid());
end;
$$;

-- ── Reservas ───────────────────────────────────────────────────────────────────────────────
-- Fija la reserva EXACTA (variante, tipo, dueño) a `p_qty` (0 = liberar). Idempotente: repetir la llamada no
-- cambia nada salvo renovar el vencimiento. La fila de la variante se bloquea (FOR UPDATE): las llamadas
-- concurrentes sobre una misma variante se serializan, así nunca se reserva más de lo disponible.
-- Devuelve {status: reserved|released|insufficient_stock|variant_unavailable, reserved, available, expires_at}.
create or replace function public.reserve_stock(
  p_variant_id uuid, p_qty int, p_owner_type text, p_owner_id uuid, p_ttl_seconds int default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_var record;
  v_others int;
  v_free int;
  v_own int;
  v_ttl int;
  v_expires timestamptz;
begin
  if p_qty is null or p_qty < 0 or p_qty > 1000 then
    raise exception 'cantidad inválida (0 a 1000)' using errcode = '22023';
  end if;
  if p_owner_type not in ('cart', 'order') or p_owner_id is null then
    raise exception 'dueño de la reserva inválido' using errcode = '22023';
  end if;
  if p_ttl_seconds is not null and (p_ttl_seconds < 1 or p_ttl_seconds > 86400) then
    raise exception 'ttl inválido (1 a 86400 segundos)' using errcode = '22023';
  end if;

  select v.stock_on_hand, v.archived_at as variant_archived, p.archived_at as product_archived, p.status as product_status
    into v_var
    from public.product_variants v
    join public.products p on p.id = v.product_id
   where v.id = p_variant_id
     for update of v;
  if not found or v_var.variant_archived is not null or v_var.product_archived is not null
     or v_var.product_status <> 'active' then
    return jsonb_build_object('status', 'variant_unavailable', 'reserved', 0, 'available', 0);
  end if;

  select coalesce(sum(r.qty) filter (where not (r.owner_type = p_owner_type and r.owner_id = p_owner_id)), 0),
         coalesce(sum(r.qty) filter (where r.owner_type = p_owner_type and r.owner_id = p_owner_id), 0)
    into v_others, v_own
    from public.stock_reservations r
   where r.variant_id = p_variant_id and r.status = 'active' and (r.expires_at is null or r.expires_at > now());
  v_free := greatest(v_var.stock_on_hand - v_others, 0);

  if p_qty = 0 then
    update public.stock_reservations set status = 'released', updated_at = now()
     where variant_id = p_variant_id and owner_type = p_owner_type and owner_id = p_owner_id and status = 'active';
    return jsonb_build_object('status', 'released', 'reserved', 0, 'available', v_free);
  end if;

  if p_qty > v_free then
    -- No se toca la reserva que ya tenía: pedir más de lo que hay no debe quitarle lo que sí tenía.
    return jsonb_build_object('status', 'insufficient_stock', 'reserved', v_own, 'available', v_free);
  end if;

  v_ttl := case when p_owner_type = 'cart'
                then coalesce(p_ttl_seconds, public.setting_int('reservation_ttl_minutes', 10) * 60)
                else p_ttl_seconds end;
  v_expires := case when v_ttl is null then null else now() + make_interval(secs => v_ttl) end;

  insert into public.stock_reservations (variant_id, qty, owner_type, owner_id, expires_at)
  values (p_variant_id, p_qty, p_owner_type, p_owner_id, v_expires)
  on conflict (variant_id, owner_type, owner_id) where status = 'active'
  do update set qty = excluded.qty, expires_at = excluded.expires_at, updated_at = now();

  return jsonb_build_object('status', 'reserved', 'reserved', p_qty, 'available', v_free - p_qty, 'expires_at', v_expires);
end;
$$;

create or replace function public.release_stock(p_owner_type text, p_owner_id uuid, p_variant_id uuid default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  -- Las filas se bloquean en orden de id: dos procesos que liberan/expiran las mismas reservas no se cruzan (deadlock).
  with locked as (
    select r.id from public.stock_reservations r
     where r.owner_type = p_owner_type and r.owner_id = p_owner_id and r.status = 'active'
       and (p_variant_id is null or r.variant_id = p_variant_id)
     order by r.id for update)
  update public.stock_reservations r set status = 'released', updated_at = now()
    from locked where r.id = locked.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.expire_reservations()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  -- skip locked: si otra transacción tiene una fila (p. ej. el cliente la está renovando), el cron la salta y la
  -- toma en el siguiente minuto, en vez de esperar o cruzarse con ella.
  with locked as (
    select r.id from public.stock_reservations r
     where r.status = 'active' and r.expires_at is not null and r.expires_at <= now()
     order by r.id for update skip locked)
  update public.stock_reservations r set status = 'expired', updated_at = now()
    from locked where r.id = locked.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Limpieza: las reservas ya cerradas no se necesitan más allá de unos días (es el único DELETE de la tabla,
-- y lo hace el propietario dentro de esta función; ningún rol de la aplicación puede borrar).
create or replace function public.purge_stock_reservations(p_older_than interval default interval '7 days')
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  delete from public.stock_reservations where status <> 'active' and updated_at < now() - p_older_than;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Archivar una variante (o dejar de publicar/archivar su producto) libera sus retenciones de CARRITO. Los compromisos
-- firmes de PEDIDOS (owner_type='order') NO se liberan aquí: solo al cancelar o expirar el pedido (S10/S12); si no,
-- el stock de un pedido pendiente quedaría libre para venderse dos veces.
create or replace function public.release_reservations_on_archive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'product_variants' then
    if new.archived_at is not null and old.archived_at is null then
      with locked as (
        select r.id from public.stock_reservations r
         where r.variant_id = new.id and r.status = 'active' and r.owner_type = 'cart'
         order by r.id for update)
      update public.stock_reservations r set status = 'released', updated_at = now()
        from locked where r.id = locked.id;
    end if;
  elsif (new.archived_at is not null and old.archived_at is null) or (new.status = 'draft' and old.status = 'active') then
    with locked as (
      select r.id from public.stock_reservations r
        join public.product_variants v on v.id = r.variant_id
       where v.product_id = new.id and r.status = 'active' and r.owner_type = 'cart'
       order by r.id for update)
    update public.stock_reservations r set status = 'released', updated_at = now()
      from locked where r.id = locked.id;
  end if;
  return new;
end;
$$;
drop trigger if exists product_variants_release_reservations on public.product_variants;
create trigger product_variants_release_reservations after update of archived_at on public.product_variants
  for each row execute function public.release_reservations_on_archive();
drop trigger if exists products_release_reservations on public.products;
create trigger products_release_reservations after update of archived_at, status on public.products
  for each row execute function public.release_reservations_on_archive();

-- ── Permisos ───────────────────────────────────────────────────────────────────────────────
revoke all on function public.apply_stock_change(uuid, int, text, text, text, uuid),
                       public.reserve_stock(uuid, int, text, uuid, int),
                       public.release_stock(text, uuid, uuid),
                       public.expire_reservations(),
                       public.purge_stock_reservations(interval),
                       public.adjust_stock(uuid, int, text, text) from public, anon, authenticated;
grant execute on function public.apply_stock_change(uuid, int, text, text, text, uuid),
                          public.reserve_stock(uuid, int, text, uuid, int),
                          public.release_stock(text, uuid, uuid),
                          public.expire_reservations(),
                          public.purge_stock_reservations(interval) to service_role;
-- adjust_stock verifica is_admin() por dentro; el navegador del admin la llama con su sesión.
grant execute on function public.adjust_stock(uuid, int, text, text) to authenticated, service_role;
-- stock_status es PURA (solo compara números) y la usan las vistas, que corren con los permisos de quien consulta.
revoke all on function public.stock_status(int, int, int) from public;
grant execute on function public.stock_status(int, int, int) to anon, authenticated, service_role;

-- ── Trabajos programados (pg_cron) ─────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('expire-stock-reservations', '* * * * *', 'select public.expire_reservations()');
    perform cron.schedule('purge-stock-reservations', '17 3 * * *', 'select public.purge_stock_reservations()');
  else
    raise notice 'pg_cron no está disponible: las reservas vencidas igual dejan de contar (la vista usa expires_at), pero no se marcarán como expired';
  end if;
exception when others then
  raise notice 'no se pudo programar pg_cron: %', sqlerrm;
end $$;
