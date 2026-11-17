import { fromDbError } from "@/lib/db-errors";
import { getSupabase } from "@/lib/supabase";
import type { ReportId, ReportPageArgs, ReportPageResult, ReportRow } from "./reportTypes";

/**
 * Los reportes con filas. Cada uno es una función SQL de solo lectura, solo para administradores, que pagina en el servidor y trae el
 * total del filtro en cada fila (`total_count`). Aquí se normalizan los tipos (PostgREST puede entregar un `numeric` como texto).
 */
type Raw = Record<string, unknown>;
const txt = (v: unknown): string | null => (typeof v === "string" ? v : null);
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const n0 = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

async function rpcRaw(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await (
    getSupabase().rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>
  )(name, args);
  if (error) throw fromDbError(error as { message: string; code?: string });
  return data;
}

/** Una función que devuelve filas. */
async function rpc(name: string, args: Record<string, unknown>): Promise<Raw[]> {
  return ((await rpcRaw(name, args)) ?? []) as Raw[];
}

const total = (rows: Raw[]): number => (rows[0] ? n0(rows[0].total_count) : 0);

type Mapper = (r: Raw) => ReportRow;

const MAPPERS: Record<
  ReportId,
  { fn: string; args: (a: ReportPageArgs) => Record<string, unknown>; map: Mapper }
> = {
  ventas: {
    fn: "admin_report_sales",
    args: (a) => ({
      p_from: a.from,
      p_to: a.to,
      p_currency: a.currency,
      p_offset: a.offset,
      p_limit: a.limit,
    }),
    map: (r) => ({
      id: txt(r.order_id),
      number: txt(r.number),
      soldAt: txt(r.sold_at),
      status: txt(r.status),
      payment: txt(r.payment_method),
      channel: txt(r.channel),
      customer: txt(r.customer),
      currency: txt(r.currency),
      units: n0(r.units),
      gross: n0(r.gross),
      discount: n0(r.discount),
      shipping: n0(r.shipping),
      refunded: n0(r.refunded),
      net: n0(r.net),
      margin: n(r.margin),
    }),
  },
  productos: {
    fn: "admin_report_products",
    args: (a) => ({
      p_from: a.from,
      p_to: a.to,
      p_currency: a.currency,
      p_offset: a.offset,
      p_limit: a.limit,
    }),
    map: (r) => ({
      id: txt(r.product_id),
      product: txt(r.product_name),
      code: txt(r.product_code),
      units: n0(r.units),
      orders: n0(r.orders),
      revenue: n0(r.revenue),
      margin: n(r.margin),
      marginPct: n(r.margin_pct),
    }),
  },
  inventario: {
    fn: "admin_report_inventory",
    args: (a) => ({ p_offset: a.offset, p_limit: a.limit }),
    map: (r) => ({
      id: txt(r.variant_id),
      product: txt(r.product_name),
      code: txt(r.product_code),
      sku: txt(r.sku),
      color: txt(r.color_name),
      size: txt(r.size_label),
      productStatus: txt(r.product_status),
      onHand: n0(r.stock_on_hand),
      reserved: n0(r.reserved),
      available: n0(r.available),
      light: txt(r.stock_light),
      cost: n(r.cost_base),
      value: n(r.stock_value),
    }),
  },
  descuentos: {
    fn: "admin_report_discounts",
    args: (a) => ({ p_from: a.from, p_to: a.to, p_offset: a.offset, p_limit: a.limit }),
    map: (r) => ({
      id: `${txt(r.discount_id)}:${txt(r.currency)}`,
      discountName: txt(r.discount_name),
      kind: txt(r.kind),
      coupon: r.requires_coupon === true,
      currency: txt(r.currency),
      usesApplied: n0(r.uses_applied),
      usesReserved: n0(r.uses_reserved),
      customers: n0(r.customers),
      amountApplied: n0(r.amount_applied),
    }),
  },
  pagos: {
    fn: "admin_report_payments",
    args: (a) => ({ p_from: a.from, p_to: a.to, p_offset: a.offset, p_limit: a.limit }),
    map: (r) => ({
      id: txt(r.payment_id),
      createdAt: txt(r.created_at),
      orderNumber: txt(r.order_number),
      provider: txt(r.provider),
      method: txt(r.method),
      status: txt(r.status),
      currency: txt(r.currency),
      amount: n0(r.amount),
      received: n(r.received_amount),
      paidAt: txt(r.paid_at),
    }),
  },
  devoluciones: {
    fn: "admin_report_returns",
    args: (a) => ({ p_from: a.from, p_to: a.to, p_offset: a.offset, p_limit: a.limit }),
    map: (r) => ({
      kind: txt(r.kind),
      createdAt: txt(r.created_at),
      orderNumber: txt(r.order_number),
      status: txt(r.status),
      currency: txt(r.currency),
      amount: n(r.amount),
      shippingAmount: n(r.shipping_amount),
      deduction: n(r.deduction),
      method: txt(r.method),
      reason: txt(r.reason),
    }),
  },
  clientas: {
    fn: "admin_report_customers",
    args: (a) => ({
      p_from: a.from,
      p_to: a.to,
      p_currency: a.currency,
      p_offset: a.offset,
      p_limit: a.limit,
    }),
    map: (r) => ({
      id: txt(r.profile_id),
      name: txt(r.customer_name),
      email: txt(r.customer_email),
      currency: txt(r.currency),
      orders: n0(r.orders),
      net: n0(r.net),
      firstSale: txt(r.first_sale_at),
      segment: txt(r.segment),
    }),
  },
};

export async function fetchReportPage(
  id: ReportId,
  args: ReportPageArgs,
): Promise<ReportPageResult> {
  const def = MAPPERS[id];
  const rows = await rpc(def.fn, def.args(args));
  const result: ReportPageResult = { rows: rows.map(def.map), total: total(rows) };
  if (id === "clientas") {
    // admin_customers_summary devuelve un jsonb: PostgREST lo entrega como objeto (no como una lista de filas).
    const s = await rpcRaw("admin_customers_summary", { p_from: args.from, p_to: args.to });
    const o = (typeof s === "object" && s !== null && !Array.isArray(s) ? s : {}) as Raw;
    result.summary = {
      customers: n0(o.customers),
      new_customers: n0(o.new_customers),
      recurring_customers: n0(o.recurring_customers),
      new_accounts: n0(o.new_accounts),
    };
  }
  return result;
}
