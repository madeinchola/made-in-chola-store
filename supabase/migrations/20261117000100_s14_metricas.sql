-- Sprint 14 · Fase A — Métricas del negocio (dashboard y reportes).
--
-- Qué hace: una DEFINICIÓN ÚNICA de «venta» y las funciones que la usan, todas de solo lectura y solo para administradores:
--   * venta vigente = pedido en paid | preparing | shipped | delivered | completed; su fecha es la de pago (paid_at, o la de creación si
--     faltara) en la zona America/La_Paz. Cancelados y reembolsados por completo NO son ventas (se cuentan aparte).
--   * neto = total − reembolsos no rechazados; margen solo de pedidos con TODAS sus líneas con costo; utilidad = margen − incidencias
--     asumidas por la tienda. Todo por moneda: nunca se suman monedas distintas.
--
-- Rollback (todo es de solo lectura; no toca datos):
--   drop function public.admin_sales_summary(date, date, text), public.admin_top_products(date, date, text, text, text, int),
--     public.admin_sales_breakdown(date, date, text, text, int), public.admin_slow_movers(int, int),
--     public.admin_inventory_summary(), public.admin_inventory_coverage(int, int), public.admin_funnel(date, date),
--     public.admin_payment_mix(date, date), public._sales_orders(timestamptz, timestamptz),
--     public._sales_lines(timestamptz, timestamptz), public._report_bounds(date, date);
--   drop index if exists public.orders_sold_at_idx;
--
-- Idempotente: se puede reaplicar.

-- La versión anterior de esta migración (solo en ensayos) tenía una función intermedia que se evaluaba varias veces por resumen.
drop function if exists public._sales_kpis(timestamptz, timestamptz);

-- ── 1. Índice: las ventas por fecha no recorren todos los pedidos ──────────────────────────────────────────────────────────────
create index if not exists orders_sold_at_idx on public.orders ((coalesce(paid_at, created_at)))
  where status in ('paid', 'preparing', 'shipped', 'delivered', 'completed');

-- ── 2. Límites de un rango de días en La Paz: [desde 00:00, hasta+1 00:00) ─────────────────────────────────────────────────────
create or replace function public._report_bounds(p_from date, p_to date, out from_ts timestamptz, out to_ts timestamptz)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 730 then
    raise exception 'invalid_range' using errcode = '22023', hint = 'desde ≤ hasta y un máximo de 731 días';
  end if;
  from_ts := p_from::timestamp at time zone 'America/La_Paz';
  to_ts := (p_to + 1)::timestamp at time zone 'America/La_Paz';
end;
$$;

-- ── 3. Las ventas, UN renglón por pedido ───────────────────────────────────────────────────────────────────────────────────────
-- product_revenue = Σ final_total de sus líneas − (reembolsos no rechazados − envío devuelto): lo devuelto por productos o por un monto
--   libre baja el ingreso de productos; el envío devuelto no. product_cost = Σ (unidades − unidades reembolsadas) × cost_unit.
-- costed = TODAS las líneas tienen costo registrado Y el pedido es en la moneda base (si falta un costo, el margen del pedido es
--   «desconocido», nunca un 100 % falso; el costo del producto está en la moneda base y aún no hay pedidos en otra moneda con los que
--   comprobar cómo se congela, así que en ellos el margen queda «desconocido» en vez de mezclar monedas).
create or replace function public._sales_orders(p_from_ts timestamptz, p_to_ts timestamptz)
returns table (
  order_id uuid, currency text, rate numeric, sold_at timestamptz, sold_day date, status text, payment_method text, channel text,
  subtotal numeric, discount numeric, shipping numeric, total numeric, refunded numeric, net numeric, units integer,
  product_revenue numeric, product_cost numeric, costed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with o as (
    select x.*, coalesce(x.paid_at, x.created_at) as sold_at
      from public.orders x
     where x.status in ('paid', 'preparing', 'shipped', 'delivered', 'completed')
       and coalesce(x.paid_at, x.created_at) >= p_from_ts
       and coalesce(x.paid_at, x.created_at) < p_to_ts
  ),
  rf as (
    select r.order_id, sum(r.amount) as amount, sum(r.shipping_amount) as shipping
      from public.refunds r
     where r.status <> 'rejected' and r.order_id in (select id from o)
     group by r.order_id
  ),
  rq as (
    select ri.order_item_id, sum(ri.qty) as qty
      from public.refund_items ri
      join public.refunds r on r.id = ri.refund_id
     where r.status <> 'rejected' and r.order_id in (select id from o)
     group by ri.order_item_id
  ),
  li as (
    select i.order_id,
           sum(i.qty) as units,
           sum(i.final_total) as revenue,
           bool_and(i.cost_unit is not null) as costed,
           sum(case when i.cost_unit is null then 0 else (i.qty - coalesce(rq.qty, 0)) * i.cost_unit end) as cost
      from public.order_items i
      join o on o.id = i.order_id
      left join rq on rq.order_item_id = i.id
     group by i.order_id
  )
  select o.id, o.currency, o.exchange_rate, o.sold_at, (o.sold_at at time zone 'America/La_Paz')::date, o.status, o.payment_method,
         o.channel, o.subtotal, o.discount_total, o.shipping_cost - o.shipping_discount, o.total,
         coalesce(rf.amount, 0), o.total - coalesce(rf.amount, 0), coalesce(li.units, 0)::int,
         coalesce(li.revenue, 0) - (coalesce(rf.amount, 0) - coalesce(rf.shipping, 0)), coalesce(li.cost, 0),
         coalesce(li.costed, false) and o.currency = o.base_currency
    from o
    left join rf on rf.order_id = o.id
    left join li on li.order_id = o.id
$$;

-- ── 4. Las ventas, UN renglón por línea (para los rankings) ───────────────────────────────────────────────────────────────────
-- Aquí solo se descuenta lo reembolsado POR LÍNEA (refund_items): un reembolso por monto libre no se atribuye a ningún producto.
create or replace function public._sales_lines(p_from_ts timestamptz, p_to_ts timestamptz)
returns table (
  order_item_id uuid, order_id uuid, currency text, rate numeric, sold_day date, payment_method text, channel text,
  product_id uuid, variant_id uuid, product_name text, color_name text, size_label text, sku text,
  qty integer, revenue numeric, cost numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with o as (
    select x.id, x.currency, x.exchange_rate, x.payment_method, x.channel, coalesce(x.paid_at, x.created_at) as sold_at
      from public.orders x
     where x.status in ('paid', 'preparing', 'shipped', 'delivered', 'completed')
       and coalesce(x.paid_at, x.created_at) >= p_from_ts
       and coalesce(x.paid_at, x.created_at) < p_to_ts
  ),
  rq as (
    select ri.order_item_id, sum(ri.qty) as qty, sum(ri.amount) as amount
      from public.refund_items ri
      join public.refunds r on r.id = ri.refund_id
     where r.status <> 'rejected' and r.order_id in (select id from o)
     group by ri.order_item_id
  )
  select i.id, o.id, o.currency, o.exchange_rate, (o.sold_at at time zone 'America/La_Paz')::date, o.payment_method, o.channel,
         i.product_id, i.variant_id, i.product_name, i.color_name, i.size_label, i.sku,
         (i.qty - coalesce(rq.qty, 0))::int, i.final_total - coalesce(rq.amount, 0),
         case when i.cost_unit is null then null else (i.qty - coalesce(rq.qty, 0)) * i.cost_unit end
    from public.order_items i
    join o on o.id = i.order_id
    left join rq on rq.order_item_id = i.id
$$;

-- ── 5. Resumen de ventas: indicadores, el período anterior y la serie en el tiempo (sin huecos) ───────────────────────────────
-- Las ventas del período y las del anterior se calculan UNA vez cada una (CTE materializada): evaluar la definición de «venta» una vez
-- por indicador, por cubo de la serie y por moneda la multiplicaba por 5 o más (medido: 11 s con 100 000 pedidos).
create or replace function public.admin_sales_summary(p_from date, p_to date, p_granularity text default 'day')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b record;
  pb record;
  v_len int;
  v_prev_from date;
  v_prev_to date;
  v_gran text := coalesce(p_granularity, 'day');
  v_currencies jsonb;
  v_other jsonb;
  v_consolidated jsonb;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if v_gran not in ('day', 'week', 'month') then
    raise exception 'invalid_granularity' using errcode = '22023';
  end if;
  select * into b from public._report_bounds(p_from, p_to);
  v_len := p_to - p_from + 1;
  v_prev_to := p_from - 1;
  v_prev_from := v_prev_to - (v_len - 1);
  select * into pb from public._report_bounds(v_prev_from, v_prev_to);

  with o as materialized (
         select 'cur'::text as per, s.* from public._sales_orders(b.from_ts, b.to_ts) s
         union all
         select 'prv'::text, s.* from public._sales_orders(pb.from_ts, pb.to_ts) s
       ),
       agg as (
         select o.per, o.currency, count(*)::int as orders, sum(o.units)::int as units, sum(o.total) as gross,
                sum(o.discount) as discounts, sum(o.shipping) as shipping, sum(o.refunded) as refunds, sum(o.net) as net,
                sum(o.product_revenue) as product_revenue,
                sum(o.product_revenue) filter (where o.costed) as margin_revenue,
                sum(o.product_revenue - o.product_cost) filter (where o.costed) as margin,
                (count(*) filter (where o.costed))::int as costed_orders
           from o
          group by o.per, o.currency
       ),
       inc as (
         select r.per, x.currency, sum(r.cost_assumed) as cost
           from (select 'cur'::text as per, i.order_id, i.cost_assumed from public.order_incidents i
                  where i.cost_borne_by = 'store' and i.opened_at >= b.from_ts and i.opened_at < b.to_ts
                 union all
                 select 'prv'::text, i.order_id, i.cost_assumed from public.order_incidents i
                  where i.cost_borne_by = 'store' and i.opened_at >= pb.from_ts and i.opened_at < pb.to_ts) r
           join public.orders x on x.id = r.order_id
          group by r.per, x.currency
       ),
       j as (
         select coalesce(a.per, inc.per) as per, coalesce(a.currency, inc.currency) as currency, coalesce(a.orders, 0) as orders,
                coalesce(a.units, 0) as units, coalesce(a.gross, 0) as gross, coalesce(a.discounts, 0) as discounts,
                coalesce(a.shipping, 0) as shipping, coalesce(a.refunds, 0) as refunds, coalesce(a.net, 0) as net,
                coalesce(a.product_revenue, 0) as product_revenue, a.margin_revenue, a.margin,
                coalesce(a.costed_orders, 0) as costed_orders, coalesce(inc.cost, 0) as incident_cost
           from agg a
           full join inc on inc.per = a.per and inc.currency = a.currency
       ),
       kp as (
         select j.per, j.currency, j.orders, j.units, j.gross, j.discounts, j.shipping, j.refunds, j.net,
                case when j.orders > 0 then j.net / j.orders end as avg_ticket,
                j.product_revenue, j.margin_revenue, j.margin,
                case when j.margin_revenue > 0 then round(j.margin / j.margin_revenue * 100, 1) end as margin_pct,
                j.costed_orders,
                case when j.orders > 0 then round(j.costed_orders::numeric / j.orders * 100, 1) end as cost_coverage_pct,
                j.incident_cost,
                case when j.costed_orders > 0 then j.margin - j.incident_cost end as profit
           from j
       ),
       cs as materialized (
         select o.currency, date_trunc(v_gran, o.sold_day::timestamp)::date as bucket, count(*)::int as orders,
                sum(o.total) as gross, sum(o.net) as net,
                sum(o.product_revenue - o.product_cost) filter (where o.costed) as margin
           from o
          where o.per = 'cur'
          group by 1, 2
       ),
       bk as (
         select generate_series(date_trunc(v_gran, p_from::timestamp), date_trunc(v_gran, p_to::timestamp),
                                ('1 ' || v_gran)::interval)::date as bucket
       ),
       cc as (select kp.currency from kp group by kp.currency)
  select coalesce(jsonb_agg(jsonb_build_object(
           'currency', c.currency,
           'current', coalesce((select to_jsonb(kp) - 'currency' - 'per' from kp where kp.per = 'cur' and kp.currency = c.currency),
                               '{"orders":0,"units":0,"gross":0,"discounts":0,"shipping":0,"refunds":0,"net":0,"product_revenue":0,"costed_orders":0,"incident_cost":0}'::jsonb),
           'previous', coalesce((select to_jsonb(kp) - 'currency' - 'per' from kp where kp.per = 'prv' and kp.currency = c.currency), '{}'::jsonb),
           'series', (select jsonb_agg(jsonb_build_object(
                        'bucket', bk.bucket, 'orders', coalesce(cs.orders, 0), 'gross', coalesce(cs.gross, 0),
                        'net', coalesce(cs.net, 0), 'margin', cs.margin) order by bk.bucket)
                        from bk left join cs on cs.bucket = bk.bucket and cs.currency = c.currency)
         ) order by c.currency), '[]'::jsonb),
         -- Consolidado opcional a la moneda base, al tipo de cambio de cada pedido (exchange_rate = unidades de la moneda del pedido por 1 de la base).
         jsonb_build_object(
           'currency', trim(both '"' from public.setting_text('base_currency', 'BOB')),
           'current', jsonb_build_object('orders', (select count(*) from o where o.per = 'cur'),
                                         'gross', coalesce((select sum(o.total / o.rate) from o where o.per = 'cur'), 0),
                                         'net', coalesce((select sum(o.net / o.rate) from o where o.per = 'cur'), 0)),
           'previous', jsonb_build_object('orders', (select count(*) from o where o.per = 'prv'),
                                          'gross', coalesce((select sum(o.total / o.rate) from o where o.per = 'prv'), 0),
                                          'net', coalesce((select sum(o.net / o.rate) from o where o.per = 'prv'), 0)))
    into v_currencies, v_consolidated
    from cc c;

  select jsonb_build_object(
           'cancelled', count(*) filter (where o.status = 'cancelled'),
           'refunded_full', count(*) filter (where o.status = 'refunded'),
           'pending', count(*) filter (where o.status = 'pending_payment'))
    into v_other
    from public.orders o
   where (o.status in ('cancelled', 'pending_payment') and o.created_at >= b.from_ts and o.created_at < b.to_ts)
      or (o.status = 'refunded' and coalesce(o.paid_at, o.created_at) >= b.from_ts and coalesce(o.paid_at, o.created_at) < b.to_ts);

  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'days', v_len, 'timezone', 'America/La_Paz'),
    'previous', jsonb_build_object('from', v_prev_from, 'to', v_prev_to),
    'granularity', v_gran,
    'currencies', v_currencies,
    'consolidated', v_consolidated,
    'other', v_other);
end;
$$;

-- ── 6. Más y menos vendidos ────────────────────────────────────────────────────────────────────────────────────────────────────
-- p_by: units | revenue. p_dir: desc (más vendidos) | asc (menos vendidos, de los que SÍ vendieron; los que no vendieron nada van en
-- admin_slow_movers). p_currency: nunca se mezclan monedas; por omisión, la moneda base de la tienda.
create or replace function public.admin_top_products(p_from date, p_to date, p_currency text default null,
                                                     p_by text default 'revenue', p_dir text default 'desc', p_limit int default 10)
returns table (product_id uuid, product_name text, product_code text, product_archived boolean, units integer, revenue numeric,
               orders integer, currency text)
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
  if p_by not in ('units', 'revenue') or p_dir not in ('asc', 'desc') or p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'invalid_parameters' using errcode = '22023';
  end if;
  select * into b from public._report_bounds(p_from, p_to);
  v_cur := coalesce(p_currency, trim(both '"' from public.setting_text('base_currency', 'BOB')));
  return query
    with g as (
      select l.product_id as pid, max(l.product_name) as pname, sum(l.qty)::int as u, sum(l.revenue) as rev,
             count(distinct l.order_id)::int as n
        from public._sales_lines(b.from_ts, b.to_ts) l
       where l.currency = v_cur
       group by l.product_id
    )
    select g.pid, coalesce(p.name, g.pname), p.code, (p.archived_at is not null), g.u, g.rev, g.n, v_cur
      from g
      left join public.products p on p.id = g.pid
     order by case when p_dir = 'desc' then case p_by when 'units' then g.u::numeric else g.rev end end desc nulls last,
              case when p_dir = 'asc' then case p_by when 'units' then g.u::numeric else g.rev end end asc nulls last,
              g.pname
     limit p_limit;
end;
$$;

-- ── 7. Ventas por categoría, colección, variante, método de pago o canal ──────────────────────────────────────────────────────
-- Una prenda en dos categorías cuenta en las dos (la suma de las categorías puede superar el total de la tienda).
create or replace function public.admin_sales_breakdown(p_from date, p_to date, p_dimension text, p_currency text default null,
                                                        p_limit int default 20)
returns table (key text, label text, units integer, revenue numeric, orders integer, currency text)
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
  if p_dimension not in ('category', 'collection', 'variant', 'payment_method', 'channel') or p_limit is null or p_limit < 1
     or p_limit > 200 then
    raise exception 'invalid_parameters' using errcode = '22023';
  end if;
  select * into b from public._report_bounds(p_from, p_to);
  v_cur := coalesce(p_currency, trim(both '"' from public.setting_text('base_currency', 'BOB')));
  return query
    with l as (select * from public._sales_lines(b.from_ts, b.to_ts) x where x.currency = v_cur),
    r as (
      select case p_dimension
               when 'category' then coalesce(c.id::text, '')
               when 'collection' then coalesce(k.id::text, '')
               when 'variant' then coalesce(l.color_name, '') || ' / ' || coalesce(l.size_label, '')
               when 'payment_method' then l.payment_method
               else l.channel end as k,
             case p_dimension
               when 'category' then c.name
               when 'collection' then k.name
               when 'variant' then trim(both ' /' from coalesce(l.color_name, '') || ' / ' || coalesce(l.size_label, ''))
               when 'payment_method' then l.payment_method
               else l.channel end as lbl,
             l.qty, l.revenue, l.order_id
        from l
        left join public.product_categories pc on p_dimension = 'category' and pc.product_id = l.product_id
        left join public.categories c on c.id = pc.category_id
        left join public.product_collections pk on p_dimension = 'collection' and pk.product_id = l.product_id
        left join public.collections k on k.id = pk.collection_id
    )
    select r.k, max(r.lbl), sum(r.qty)::int, sum(r.revenue), count(distinct r.order_id)::int, v_cur
      from r
     group by r.k
     order by sum(r.revenue) desc, r.k
     limit p_limit;
end;
$$;

-- ── 8. Sin rotación: con stock y sin una sola venta en los últimos N días ──────────────────────────────────────────────────────
create or replace function public.admin_slow_movers(p_days int default 60, p_limit int default 50)
returns table (product_id uuid, product_name text, product_code text, stock_on_hand integer, last_sold_at timestamptz,
               days_since_sale integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 730 or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'invalid_parameters' using errcode = '22023';
  end if;
  return query
    with stock as (
      select v.product_id as pid, sum(v.stock_on_hand)::int as on_hand
        from public.product_variants v
       where v.archived_at is null
       group by v.product_id
      having sum(v.stock_on_hand) > 0
    ),
    sold as (
      select i.product_id as pid, max(coalesce(o.paid_at, o.created_at)) as last_at
        from public.order_items i
        join public.orders o on o.id = i.order_id
       where o.status in ('paid', 'preparing', 'shipped', 'delivered', 'completed')
       group by i.product_id
    )
    select p.id, p.name, p.code, s.on_hand, sd.last_at,
           case when sd.last_at is null then null
                else ((now() at time zone 'America/La_Paz')::date - (sd.last_at at time zone 'America/La_Paz')::date)::int end
      from public.products p
      join stock s on s.pid = p.id
      left join sold sd on sd.pid = p.id
     where p.status = 'active' and p.archived_at is null
       and (sd.last_at is null or sd.last_at < now() - make_interval(days => p_days))
     order by sd.last_at nulls first, p.name
     limit p_limit;
end;
$$;

-- ── 9. Inventario: valor, estados y cobertura ─────────────────────────────────────────────────────────────────────────────────
-- Valor = Σ existencias × costo base del producto (moneda base). Una variante sin costo no suma: se cuenta aparte, nunca se asume 0.
create or replace function public.admin_inventory_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'currency', trim(both '"' from public.setting_text('base_currency', 'BOB')),
           'variants', count(*)::int,
           'units', coalesce(sum(a.stock_on_hand), 0)::int,
           'value', coalesce(sum(a.stock_on_hand * p.cost_base) filter (where p.cost_base is not null), 0),
           'variants_without_cost', (count(*) filter (where p.cost_base is null and a.stock_on_hand > 0))::int,
           'ok', (count(*) filter (where a.stock_light = 'ok'))::int,
           'low', (count(*) filter (where a.stock_light = 'low'))::int,
           'critical', (count(*) filter (where a.stock_light = 'critical'))::int,
           'out', (count(*) filter (where a.stock_light = 'out'))::int)
    into v_result
    from public.product_variants v
    join public.products p on p.id = v.product_id
    join public.variant_availability a on a.variant_id = v.id
   where v.archived_at is null and p.archived_at is null;
  return v_result;
end;
$$;

-- Cobertura estimada: días que alcanza lo que hay a la velocidad de venta de los últimos N días (solo variantes que vendieron).
create or replace function public.admin_inventory_coverage(p_days int default 30, p_limit int default 50)
returns table (variant_id uuid, product_id uuid, product_name text, sku text, color_name text, size_label text,
               stock_on_hand integer, units_sold integer, daily_rate numeric, days_of_cover numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b record;
  v_today date;
begin
  if not public.is_admin() then
    raise exception 'solo administradores' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 365 or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'invalid_parameters' using errcode = '22023';
  end if;
  v_today := (now() at time zone 'America/La_Paz')::date;
  select * into b from public._report_bounds(v_today - (p_days - 1), v_today);
  return query
    with sold as (
      select l.variant_id as vid, sum(l.qty)::int as u
        from public._sales_lines(b.from_ts, b.to_ts) l
       group by l.variant_id
      having sum(l.qty) > 0
    )
    select v.id, p.id, p.name, v.sku, c.name, sz.label, v.stock_on_hand, s.u, round(s.u::numeric / p_days, 4),
           round(v.stock_on_hand / (s.u::numeric / p_days), 1)
      from sold s
      join public.product_variants v on v.id = s.vid
      join public.products p on p.id = v.product_id
      join public.product_colors c on c.id = v.color_id
      left join public.product_sizes sz on sz.id = v.size_id
     where v.archived_at is null and p.archived_at is null
     order by round(v.stock_on_hand / (s.u::numeric / p_days), 1), p.name
     limit p_limit;
end;
$$;

-- ── 10. Embudo simple (conteos del período, no cohortes) ───────────────────────────────────────────────────────────────────────
-- Los carritos viejos se purgan: el embudo solo es confiable para períodos recientes.
create or replace function public.admin_funnel(p_from date, p_to date)
returns jsonb
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
  return jsonb_build_object(
    'carts', (select count(*)::int from public.carts c where c.created_at >= b.from_ts and c.created_at < b.to_ts),
    'carts_with_items', (select count(*)::int from public.carts c
                          where c.created_at >= b.from_ts and c.created_at < b.to_ts
                            and exists (select 1 from public.cart_items i where i.cart_id = c.id)),
    'orders', (select count(*)::int from public.orders o where o.created_at >= b.from_ts and o.created_at < b.to_ts),
    'paid', (select count(*)::int from public._sales_orders(b.from_ts, b.to_ts)));
end;
$$;

-- ── 11. Mezcla de métodos de pago ──────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_payment_mix(p_from date, p_to date)
returns table (currency text, payment_method text, orders integer, gross numeric, net numeric)
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
    select s.currency, s.payment_method, count(*)::int, sum(s.total), sum(s.net)
      from public._sales_orders(b.from_ts, b.to_ts) s
     group by s.currency, s.payment_method
     order by s.currency, sum(s.net) desc, s.payment_method;
end;
$$;

-- ── 12. Permisos ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Las funciones nuevas nacen ejecutables por todos (privilegios por omisión de Supabase): las internas se cierran y las admin_* solo
-- las ejecuta un administrador autenticado (is_admin() adentro, como el resto).
revoke all on function
  public._report_bounds(date, date), public._sales_orders(timestamptz, timestamptz), public._sales_lines(timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function
  public.admin_sales_summary(date, date, text), public.admin_top_products(date, date, text, text, text, int),
  public.admin_sales_breakdown(date, date, text, text, int), public.admin_slow_movers(int, int),
  public.admin_inventory_summary(), public.admin_inventory_coverage(int, int), public.admin_funnel(date, date),
  public.admin_payment_mix(date, date)
  from public, anon, service_role;
grant execute on function
  public.admin_sales_summary(date, date, text), public.admin_top_products(date, date, text, text, text, int),
  public.admin_sales_breakdown(date, date, text, text, int), public.admin_slow_movers(int, int),
  public.admin_inventory_summary(), public.admin_inventory_coverage(int, int), public.admin_funnel(date, date),
  public.admin_payment_mix(date, date)
  to authenticated;
