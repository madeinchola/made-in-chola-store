import { fromDbError } from "@/lib/db-errors";
import { getSupabase } from "@/lib/supabase";
import type {
  BreakdownDimension,
  BreakdownRow,
  CoverageRow,
  DateRange,
  Funnel,
  Granularity,
  InventorySummary,
  PaymentMixRow,
  SalesSummary,
  SlowMover,
  TopProduct,
} from "./types";

/**
 * Acceso a las métricas (S14). Todo es de SOLO LECTURA y lo calcula la base: funciones SQL que exigen ser administrador por dentro y
 * que comparten una única definición de «venta». Aquí solo se piden y se normalizan los números (PostgREST entrega los `numeric`
 * como números o como texto según su tamaño).
 */
type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    getSupabase().rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>
  )(name, args);
  if (error) throw fromDbError(error as { message: string; code?: string });
  return data as T;
}

const KPI_NUMBERS = [
  "orders",
  "units",
  "gross",
  "discounts",
  "shipping",
  "refunds",
  "net",
  "product_revenue",
  "costed_orders",
  "incident_cost",
] as const;
const KPI_NULLABLE = [
  "avg_ticket",
  "margin_revenue",
  "margin",
  "margin_pct",
  "cost_coverage_pct",
  "profit",
] as const;

/** Un bloque de indicadores: los importes siempre son números; lo que puede ser desconocido sigue siendo `null`. */
function mapKpis(raw: unknown): Record<string, number | null> {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Row;
  const out: Record<string, number | null> = {};
  for (const k of KPI_NUMBERS) out[k] = num(r[k]);
  for (const k of KPI_NULLABLE) out[k] = numOrNull(r[k]);
  return out;
}

/** El período anterior de una moneda sin movimiento llega vacío: se queda vacío (la pantalla muestra «—»). */
function mapPrevious(raw: unknown): Record<string, number | null> {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Row;
  return Object.keys(r).length === 0 ? {} : mapKpis(r);
}

function mapBlock(raw: unknown): { orders: number; gross: number; net: number } {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Row;
  return { orders: num(r.orders), gross: num(r.gross), net: num(r.net) };
}

export async function fetchSalesSummary(
  range: DateRange,
  granularity: Granularity,
): Promise<SalesSummary> {
  const raw = (await rpc<Row>("admin_sales_summary", {
    p_from: range.from,
    p_to: range.to,
    p_granularity: granularity,
  })) as Row;
  const rangeRaw = (raw.range ?? {}) as Row;
  const prevRaw = (raw.previous ?? {}) as Row;
  const cons = (raw.consolidated ?? {}) as Row;
  const other = (raw.other ?? {}) as Row;
  return {
    range: {
      from: str(rangeRaw.from),
      to: str(rangeRaw.to),
      days: num(rangeRaw.days),
      timezone: str(rangeRaw.timezone),
    },
    previous: { from: str(prevRaw.from), to: str(prevRaw.to) },
    granularity: (str(raw.granularity) || granularity) as Granularity,
    currencies: ((raw.currencies ?? []) as Row[]).map((c) => ({
      currency: str(c.currency),
      current: mapKpis(c.current) as unknown as SalesSummary["currencies"][number]["current"],
      previous: mapPrevious(c.previous) as SalesSummary["currencies"][number]["previous"],
      series: ((c.series ?? []) as Row[]).map((s) => ({
        bucket: str(s.bucket),
        orders: num(s.orders),
        gross: num(s.gross),
        net: num(s.net),
        margin: numOrNull(s.margin),
      })),
    })),
    consolidated: {
      currency: str(cons.currency),
      current: mapBlock(cons.current),
      previous: mapBlock(cons.previous),
    },
    other: {
      cancelled: num(other.cancelled),
      refunded_full: num(other.refunded_full),
      pending: num(other.pending),
    },
  };
}

export async function fetchTopProducts(
  range: DateRange,
  currency: string | null,
  by: "units" | "revenue",
  dir: "asc" | "desc",
  limit: number,
): Promise<TopProduct[]> {
  const rows = await rpc<Row[]>("admin_top_products", {
    p_from: range.from,
    p_to: range.to,
    p_currency: currency,
    p_by: by,
    p_dir: dir,
    p_limit: limit,
  });
  return (rows ?? []).map((r) => ({
    productId: str(r.product_id),
    name: str(r.product_name),
    code: strOrNull(r.product_code),
    archived: r.product_archived === true,
    units: num(r.units),
    revenue: num(r.revenue),
    orders: num(r.orders),
    currency: str(r.currency),
  }));
}

export async function fetchBreakdown(
  range: DateRange,
  dimension: BreakdownDimension,
  currency: string | null,
  limit: number,
): Promise<BreakdownRow[]> {
  const rows = await rpc<Row[]>("admin_sales_breakdown", {
    p_from: range.from,
    p_to: range.to,
    p_dimension: dimension,
    p_currency: currency,
    p_limit: limit,
  });
  return (rows ?? []).map((r) => ({
    key: str(r.key),
    label: strOrNull(r.label),
    units: num(r.units),
    revenue: num(r.revenue),
    orders: num(r.orders),
    currency: str(r.currency),
  }));
}

export async function fetchPaymentMix(range: DateRange): Promise<PaymentMixRow[]> {
  const rows = await rpc<Row[]>("admin_payment_mix", { p_from: range.from, p_to: range.to });
  return (rows ?? []).map((r) => ({
    currency: str(r.currency),
    paymentMethod: str(r.payment_method),
    orders: num(r.orders),
    gross: num(r.gross),
    net: num(r.net),
  }));
}

export async function fetchFunnel(range: DateRange): Promise<Funnel> {
  const r = (await rpc<Row>("admin_funnel", { p_from: range.from, p_to: range.to })) as Row;
  return {
    carts: num(r.carts),
    carts_with_items: num(r.carts_with_items),
    orders: num(r.orders),
    paid: num(r.paid),
  };
}

export async function fetchInventorySummary(): Promise<InventorySummary> {
  const r = (await rpc<Row>("admin_inventory_summary", {})) as Row;
  return {
    currency: str(r.currency),
    variants: num(r.variants),
    units: num(r.units),
    value: num(r.value),
    variants_without_cost: num(r.variants_without_cost),
    ok: num(r.ok),
    low: num(r.low),
    critical: num(r.critical),
    out: num(r.out),
  };
}

export async function fetchSlowMovers(days: number, limit: number): Promise<SlowMover[]> {
  const rows = await rpc<Row[]>("admin_slow_movers", { p_days: days, p_limit: limit });
  return (rows ?? []).map((r) => ({
    productId: str(r.product_id),
    name: str(r.product_name),
    code: strOrNull(r.product_code),
    stockOnHand: num(r.stock_on_hand),
    lastSoldAt: strOrNull(r.last_sold_at),
    daysSinceSale: numOrNull(r.days_since_sale),
  }));
}

export async function fetchCoverage(days: number, limit: number): Promise<CoverageRow[]> {
  const rows = await rpc<Row[]>("admin_inventory_coverage", { p_days: days, p_limit: limit });
  return (rows ?? []).map((r) => ({
    variantId: str(r.variant_id),
    productId: str(r.product_id),
    productName: str(r.product_name),
    sku: strOrNull(r.sku),
    colorName: strOrNull(r.color_name),
    sizeLabel: strOrNull(r.size_label),
    stockOnHand: num(r.stock_on_hand),
    unitsSold: num(r.units_sold),
    dailyRate: num(r.daily_rate),
    daysOfCover: num(r.days_of_cover),
  }));
}
