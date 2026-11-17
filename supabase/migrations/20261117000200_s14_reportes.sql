-- Sprint 14 · Fase C — Reportes con filas (para ver, filtrar y exportar).
--
-- Todos son de solo lectura, solo para administradores y paginados (`p_offset`, `p_limit` de 1 a 5000; cada fila trae `total_count` con
-- el total del filtro). Usan la MISMA definición de «venta» que el resumen (`_sales_orders`/`_sales_lines`, migración de métricas), así que
-- un reporte y una tarjeta del resumen nunca se contradicen. Las fechas son días de La Paz; las monedas no se mezclan (una por consulta).
--
-- Rollback (solo lectura; no toca datos):
--   drop function public.admin_report_sales(date, date, text, int, int), public.admin_report_products(date, date, text, int, int),
--     public.admin_report_inventory(int, int), public.admin_report_discounts(date, date, int, int),
--     public.admin_report_payments(date, date, int, int), public.admin_report_returns(date, date, int, int),
--     public.admin_report_customers(date, date, text, int, int), public.admin_customers_summary(date, date),
--     public._report_page(int, int);
--
-- Idempotente: se puede reaplicar.

-- ── 1. Validación común de la página pedida ────────────────────────────────────────────────────────────────────────────────────
create or replace function public._report_page(p_offset int, p_limit int)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'invalid_parameters' using errcode = '22023', hint = 'offset ≥ 0 y límite de 1 a 5000';
  end if;
end;
$$;

-- ── 2. Ventas: un renglón por pedido vendido ───────────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_report_sales(p_from date, p_to date, p_currency text default null,
                                                     p_offset int default 0, p_limit int default 50)
returns table (order_id uuid, number text, sold_at timestamptz, status text, payment_method text, channel text, customer text,
               currency text, units integer, gross numeric, discount numeric, shipping numeric, refunded numeric, net numeric,
               margin numeric, total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b record;
  v_cur text;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  perform public._report_page(p_offset, p_limit);
  select * into b from public._report_bounds(p_from, p_to);
  v_cur := coalesce(p_currency, trim(both '"' from public.setting_text('base_currency', 'BOB')));
  return query
    select s.order_id, o.number, s.sold_at, s.status, s.payment_method, s.channel, o.contact_name, s.currency, s.units, s.total,
           s.discount, s.shipping, s.refunded, s.net, case when s.costed then s.product_revenue - s.product_cost end,
           count(*) over ()
      from public._sales_orders(b.from_ts, b.to_ts) s
      join public.orders o on o.id = s.order_id
     where s.currency = v_cur
     order by s.sold_at desc, o.number
     offset p_offset limit p_limit;
end;
$$;

-- ── 3. Productos: lo vendido por producto, con su margen (solo de las líneas con costo) ──────────────────────────────────────────
create or replace function public.admin_report_products(p_from date, p_to date, p_currency text default null,
                                                        p_offset int default 0, p_limit int default 50)
returns table (product_id uuid, product_name text, product_code text, product_archived boolean, units integer, revenue numeric,
               orders integer, margin numeric, margin_pct numeric, total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b record;
  v_cur text;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  perform public._report_page(p_offset, p_limit);
  select * into b from public._report_bounds(p_from, p_to);
  v_cur := coalesce(p_currency, trim(both '"' from public.setting_text('base_currency', 'BOB')));
  return query
    with g as (
      select l.product_id as pid, max(l.product_name) as pname, sum(l.qty)::int as u, sum(l.revenue) as rev,
             count(distinct l.order_id)::int as n,
             sum(l.revenue - l.cost) filter (where l.cost is not null) as mg,
             sum(l.revenue) filter (where l.cost is not null) as mrev
        from public._sales_lines(b.from_ts, b.to_ts) l
       where l.currency = v_cur
       group by l.product_id
    )
    select g.pid, coalesce(p.name, g.pname), p.code, (p.archived_at is not null), g.u, g.rev, g.n, g.mg,
           case when g.mrev > 0 then round(g.mg / g.mrev * 100, 1) end, count(*) over ()
      from g
      left join public.products p on p.id = g.pid
     order by g.rev desc, g.pname
     offset p_offset limit p_limit;
end;
$$;

-- ── 4. Inventario: una fila por variante (de productos no archivados) ───────────────────────────────────────────────────────────
create or replace function public.admin_report_inventory(p_offset int default 0, p_limit int default 50)
returns table (variant_id uuid, product_id uuid, product_name text, product_code text, product_status text, sku text, color_name text,
               size_label text, stock_on_hand integer, reserved integer, available integer, stock_light text, cost_base numeric,
               stock_value numeric, total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  perform public._report_page(p_offset, p_limit);
  return query
    select v.id, p.id, p.name, p.code, p.status, v.sku, c.name, sz.label, a.stock_on_hand, a.reserved, a.available, a.stock_light,
           p.cost_base, case when p.cost_base is null then null else a.stock_on_hand * p.cost_base end, count(*) over ()
      from public.product_variants v
      join public.products p on p.id = v.product_id
      join public.product_colors c on c.id = v.color_id
      left join public.product_sizes sz on sz.id = v.size_id
      join public.variant_availability a on a.variant_id = v.id
     where v.archived_at is null and p.archived_at is null
     order by p.name, c.name, sz.label, v.id
     offset p_offset limit p_limit;
end;
$$;

-- ── 5. Descuentos y cupones: usos y monto descontado, por descuento y moneda ───────────────────────────────────────────────────
-- `applied` = el descuento ya es parte de un pedido vendido; `reserved` = está en un pedido que todavía no se paga. Los revertidos no cuentan.
create or replace function public.admin_report_discounts(p_from date, p_to date, p_offset int default 0, p_limit int default 50)
returns table (discount_id uuid, discount_name text, kind text, requires_coupon boolean, currency text, uses_applied integer,
               uses_reserved integer, customers integer, amount_applied numeric, total_count bigint)
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
  perform public._report_page(p_offset, p_limit);
  select * into b from public._report_bounds(p_from, p_to);
  return query
    select d.id, d.name, d.kind, d.requires_coupon, r.currency,
           (count(*) filter (where r.status = 'applied'))::int, (count(*) filter (where r.status = 'reserved'))::int,
           (count(distinct r.profile_id) filter (where r.status in ('applied', 'reserved')))::int,
           coalesce(sum(r.amount) filter (where r.status = 'applied'), 0), count(*) over ()
      from public.discount_redemptions r
      join public.discounts d on d.id = r.discount_id
     where r.status in ('applied', 'reserved') and r.created_at >= b.from_ts and r.created_at < b.to_ts
     group by d.id, d.name, d.kind, d.requires_coupon, r.currency
     order by coalesce(sum(r.amount) filter (where r.status = 'applied'), 0) desc, d.name
     offset p_offset limit p_limit;
end;
$$;

-- ── 6. Pagos: una fila por cobro creado en el período (para conciliar) ──────────────────────────────────────────────────────────
create or replace function public.admin_report_payments(p_from date, p_to date, p_offset int default 0, p_limit int default 50)
returns table (payment_id uuid, created_at timestamptz, paid_at timestamptz, order_number text, provider text, method text,
               status text, amount numeric, received_amount numeric, currency text, total_count bigint)
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
  perform public._report_page(p_offset, p_limit);
  select * into b from public._report_bounds(p_from, p_to);
  return query
    select p.id, p.created_at, p.paid_at, o.number, p.provider, p.method, p.status, p.amount, p.received_amount, p.currency,
           count(*) over ()
      from public.payments p
      join public.orders o on o.id = p.order_id
     where p.created_at >= b.from_ts and p.created_at < b.to_ts
     order by p.created_at desc, p.id
     offset p_offset limit p_limit;
end;
$$;

-- ── 7. Devoluciones y reembolsos: el dinero devuelto y las devoluciones de productos, en una lista ───────────────────────────────
create or replace function public.admin_report_returns(p_from date, p_to date, p_offset int default 0, p_limit int default 50)
returns table (kind text, created_at timestamptz, order_number text, status text, amount numeric, shipping_amount numeric,
               deduction numeric, currency text, method text, reason text, total_count bigint)
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
  perform public._report_page(p_offset, p_limit);
  select * into b from public._report_bounds(p_from, p_to);
  return query
    with u as (
      select 'refund'::text as k, r.created_at as at, o.number as num, r.status as st, r.amount as amt, r.shipping_amount as ship,
             r.deduction as ded, r.currency as cur, r.method as mth, r.reason as why
        from public.refunds r
        join public.orders o on o.id = r.order_id
       where r.created_at >= b.from_ts and r.created_at < b.to_ts
      union all
      select 'return'::text, q.opened_at, o.number, q.status, null::numeric, null::numeric, null::numeric, o.currency, null::text, q.reason
        from public.order_returns q
        join public.orders o on o.id = q.order_id
       where q.opened_at >= b.from_ts and q.opened_at < b.to_ts
    )
    select u.k, u.at, u.num, u.st, u.amt, u.ship, u.ded, u.cur, u.mth, u.why, count(*) over ()
      from u
     order by u.at desc, u.num
     offset p_offset limit p_limit;
end;
$$;

-- ── 8. Clientas: quién compró en el período, cuánto, y si es nueva o recurrente ─────────────────────────────────────────────────
-- «Nueva» = su PRIMERA venta de siempre cae dentro del período; «recurrente» = ya había comprado antes.
create or replace function public.admin_report_customers(p_from date, p_to date, p_currency text default null,
                                                         p_offset int default 0, p_limit int default 50)
returns table (profile_id uuid, customer_name text, customer_email text, currency text, orders integer, net numeric,
               first_sale_at timestamptz, segment text, total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b record;
  v_cur text;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  perform public._report_page(p_offset, p_limit);
  select * into b from public._report_bounds(p_from, p_to);
  v_cur := coalesce(p_currency, trim(both '"' from public.setting_text('base_currency', 'BOB')));
  return query
    with s as (
      select o.profile_id as pid, x.net as n
        from public._sales_orders(b.from_ts, b.to_ts) x
        join public.orders o on o.id = x.order_id
       where x.currency = v_cur
    ),
    g as (
      select s.pid, count(*)::int as c, sum(s.n) as total from s group by s.pid
    ),
    f as (
      select o.profile_id as pid, min(coalesce(o.paid_at, o.created_at)) as first_at
        from public.orders o
       where o.status in ('paid', 'preparing', 'shipped', 'delivered', 'completed')
         and o.profile_id in (select pid from g)
       group by o.profile_id
    )
    select g.pid, p.full_name, p.email, v_cur, g.c, g.total, f.first_at,
           case when f.first_at >= b.from_ts then 'new' else 'recurring' end, count(*) over ()
      from g
      join f on f.pid = g.pid
      left join public.profiles p on p.id = g.pid
     order by g.total desc, p.full_name
     offset p_offset limit p_limit;
end;
$$;

-- Resumen para la cabecera del reporte de clientas.
create or replace function public.admin_customers_summary(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b record;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  select * into b from public._report_bounds(p_from, p_to);
  with g as (
    select distinct o.profile_id as pid
      from public._sales_orders(b.from_ts, b.to_ts) x
      join public.orders o on o.id = x.order_id
  ),
  f as (
    select o.profile_id as pid, min(coalesce(o.paid_at, o.created_at)) as first_at
      from public.orders o
     where o.status in ('paid', 'preparing', 'shipped', 'delivered', 'completed') and o.profile_id in (select pid from g)
     group by o.profile_id
  )
  select jsonb_build_object(
           'customers', (select count(*) from g),
           'new_customers', (select count(*) from f where f.first_at >= b.from_ts),
           'recurring_customers', (select count(*) from f where f.first_at < b.from_ts),
           'new_accounts', (select count(*) from public.profiles p where p.created_at >= b.from_ts and p.created_at < b.to_ts
                              and p.role = 'customer'))
    into v_result;
  return v_result;
end;
$$;

-- ── 9. Permisos ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public._report_page(int, int) from public, anon, authenticated, service_role;
revoke all on function
  public.admin_report_sales(date, date, text, int, int), public.admin_report_products(date, date, text, int, int),
  public.admin_report_inventory(int, int), public.admin_report_discounts(date, date, int, int),
  public.admin_report_payments(date, date, int, int), public.admin_report_returns(date, date, int, int),
  public.admin_report_customers(date, date, text, int, int), public.admin_customers_summary(date, date)
  from public, anon, service_role;
grant execute on function
  public.admin_report_sales(date, date, text, int, int), public.admin_report_products(date, date, text, int, int),
  public.admin_report_inventory(int, int), public.admin_report_discounts(date, date, int, int),
  public.admin_report_payments(date, date, int, int), public.admin_report_returns(date, date, int, int),
  public.admin_report_customers(date, date, text, int, int), public.admin_customers_summary(date, date)
  to authenticated;
