import { fromDbError } from "@/lib/db-errors";
import { getSupabase } from "@/lib/supabase";
import { dayEndExclusiveIso, dayStartIso, searchFilter } from "./logic";
import {
  PAGE_SIZE,
  type AttentionItem,
  type AttentionKind,
  type BlacklistMatch,
  type BlacklistRow,
  type EditRow,
  type HistoryEntry,
  type IncidentRow,
  type NoteRow,
  type OrderAddress,
  type OrderDetail,
  type OrderFilters,
  type OrderItem,
  type OrderPayment,
  type OrderRow,
  type ProofSummary,
  type RefundRow,
  type ReturnRow,
  type RpcResult,
} from "./types";

/**
 * Acceso a datos del panel de Pedidos. Solo el administrador LEE estas tablas (RLS) y NADIE escribe desde el navegador: cada
 * acción es una función SQL que exige ser admin por dentro, bloquea el pedido, valida y deja rastro en la auditoría. Aquí no se
 * calcula ningún importe: lo que se muestra lo calculó la base (vista previa y aplicación comparten el mismo cálculo).
 */
type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const obj = (v: unknown): Row =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Row) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const one = (v: unknown): Row => (Array.isArray(v) ? obj(v[0]) : obj(v));

const fail = (error: unknown): never => {
  throw fromDbError(error as { message: string; code?: string });
};

async function rpc<T = RpcResult>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  // El cliente tipado no conoce los nombres como texto libre: se llama por el nombre exacto de la función.
  const { data, error } = await (
    getSupabase().rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>
  )(name, args);
  if (error) return fail(error);
  return data as T;
}

// ── Bandeja ──────────────────────────────────────────────────────────────────────────────
const LIST_COLUMNS =
  "id, number, status, channel, contact_name, contact_phone, total, currency, payment_method, payment_provider, created_at, updated_at";

export const toOrderRow = (r: Row): OrderRow => ({
  id: str(r.id),
  number: str(r.number),
  status: str(r.status) as OrderRow["status"],
  channel: str(r.channel) as OrderRow["channel"],
  contactName: str(r.contact_name),
  contactPhone: str(r.contact_phone),
  total: num(r.total),
  currency: str(r.currency),
  paymentMethod: str(r.payment_method),
  paymentProvider: str(r.payment_provider),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

function applyFilters<
  Q extends {
    eq: (c: string, v: string) => Q;
    gte: (c: string, v: string) => Q;
    lt: (c: string, v: string) => Q;
    or: (f: string) => Q;
  },
>(query: Q, filters: OrderFilters): Q {
  let q = query;
  if (filters.status !== "all") q = q.eq("status", filters.status);
  if (filters.method !== "all") q = q.eq("payment_method", filters.method);
  if (filters.channel !== "all") q = q.eq("channel", filters.channel);
  const from = dayStartIso(filters.from);
  if (from) q = q.gte("created_at", from);
  const to = dayEndExclusiveIso(filters.to);
  if (to) q = q.lt("created_at", to);
  const search = searchFilter(filters.search);
  if (search) q = q.or(search);
  return q;
}

export async function listOrders(
  filters: OrderFilters,
  pageSize = PAGE_SIZE,
): Promise<{ rows: OrderRow[]; total: number }> {
  const from = Math.max(0, filters.page) * pageSize;
  const query = applyFilters(
    getSupabase().from("orders").select(LIST_COLUMNS, { count: "exact" }) as never,
    filters,
  ) as unknown as {
    order: (
      c: string,
      o: { ascending: boolean },
    ) => {
      range: (
        a: number,
        b: number,
      ) => PromiseLike<{ data: unknown; error: unknown; count: number | null }>;
    };
  };
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) return fail(error);
  const rows = ((data ?? []) as Row[]).map(toOrderRow);
  return { rows, total: count ?? rows.length };
}

/** Todos los pedidos que cumplen los filtros (hasta un tope) para exportar; no mira la página. */
export async function listOrdersForExport(
  filters: OrderFilters,
  limit = 2000,
): Promise<OrderRow[]> {
  const query = applyFilters(
    getSupabase().from("orders").select(LIST_COLUMNS) as never,
    filters,
  ) as unknown as {
    order: (
      c: string,
      o: { ascending: boolean },
    ) => { limit: (n: number) => PromiseLike<{ data: unknown; error: unknown }> };
  };
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
  if (error) return fail(error);
  return ((data ?? []) as Row[]).map(toOrderRow);
}

export async function statusCounts(): Promise<Record<string, number>> {
  const data = await rpc<Record<string, number>>("admin_orders_status_counts");
  return obj(data) as Record<string, number>;
}

// ── Detalle ──────────────────────────────────────────────────────────────────────────────
const DETAIL_COLUMNS =
  `${LIST_COLUMNS}, profile_id, subtotal, discount_total, shipping_cost, shipping_discount, contact_email, shipping_method, ` +
  "shipping_address, delivery_slot, coupon_code, payment_expires_at, paid_at, cancelled_at, cancel_reason, cancelled_by, " +
  "edit_count, edited_at";

function toAddress(raw: unknown): OrderAddress | null {
  const a = obj(raw);
  if (!a.line1) return null;
  return {
    recipient: str(a.recipient),
    phone: str(a.phone_e164),
    line1: str(a.line1),
    line2: strOrNull(a.line2),
    city: str(a.city),
    department: strOrNull(a.department),
    country: str(a.country),
    reference: strOrNull(a.reference_text),
    lat: numOrNull(a.lat),
    lng: numOrNull(a.lng),
  };
}

export async function getOrder(id: string): Promise<OrderDetail | null> {
  const { data, error } = await getSupabase()
    .from("orders")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return null;
  const r = data as unknown as Row;
  const items = await getSupabase()
    .from("order_items")
    .select(
      "id, line_no, variant_id, product_id, product_name, color_name, size_label, sku, image_path, qty, unit_price, line_total, discount, final_total",
    )
    .eq("order_id", id)
    .order("line_no");
  if (items.error) return fail(items.error);
  const method = obj(r.shipping_method);
  const slot = obj(r.delivery_slot);
  return {
    ...toOrderRow(r),
    profileId: str(r.profile_id),
    subtotal: num(r.subtotal),
    discountTotal: num(r.discount_total),
    shippingCost: num(r.shipping_cost),
    shippingDiscount: num(r.shipping_discount),
    contactEmail: strOrNull(r.contact_email),
    shippingKind: method.kind === "delivery" || method.kind === "pickup" ? method.kind : null,
    shippingName: strOrNull(method.name),
    address: toAddress(r.shipping_address),
    slot: Object.keys(slot).length
      ? {
          date: strOrNull(slot.date),
          start: strOrNull(slot.start_time),
          end: strOrNull(slot.end_time),
        }
      : null,
    couponCode: strOrNull(r.coupon_code),
    paymentExpiresAt: strOrNull(r.payment_expires_at),
    paidAt: strOrNull(r.paid_at),
    cancelledAt: strOrNull(r.cancelled_at),
    cancelReason: strOrNull(r.cancel_reason),
    cancelledBy: strOrNull(r.cancelled_by),
    editCount: num(r.edit_count),
    editedAt: strOrNull(r.edited_at),
    items: ((items.data ?? []) as unknown as Row[]).map((i): OrderItem => ({
      id: str(i.id),
      lineNo: num(i.line_no),
      variantId: str(i.variant_id),
      productId: str(i.product_id),
      name: str(i.product_name),
      colorName: strOrNull(i.color_name),
      sizeLabel: strOrNull(i.size_label),
      sku: strOrNull(i.sku),
      imagePath: strOrNull(i.image_path),
      qty: num(i.qty),
      unitPrice: num(i.unit_price),
      lineTotal: num(i.line_total),
      discount: num(i.discount),
      finalTotal: num(i.final_total),
    })),
  };
}

export async function getHistory(orderId: string): Promise<HistoryEntry[]> {
  const rows = arr(await rpc<unknown>("admin_order_history", { p_order_id: orderId }));
  return rows.map((raw): HistoryEntry => {
    const h = obj(raw);
    return {
      id: num(h.id),
      fromStatus: strOrNull(h.from_status) as HistoryEntry["fromStatus"],
      toStatus: str(h.to_status) as HistoryEntry["toStatus"],
      actorKind: str(h.actor_kind) as HistoryEntry["actorKind"],
      actorName: strOrNull(h.actor_name),
      reason: strOrNull(h.reason),
      createdAt: str(h.created_at),
    };
  });
}

export async function listPayments(orderId: string): Promise<OrderPayment[]> {
  const { data, error } = await getSupabase()
    .from("payments")
    .select(
      "id, provider, method, status, amount, received_amount, currency, reference, attempt, paid_at, collected_at",
    )
    .eq("order_id", orderId)
    .order("attempt", { ascending: false });
  if (error) return fail(error);
  return ((data ?? []) as unknown as Row[]).map((p): OrderPayment => ({
    id: str(p.id),
    provider: str(p.provider),
    method: str(p.method),
    status: str(p.status) as OrderPayment["status"],
    amount: num(p.amount),
    receivedAmount: numOrNull(p.received_amount),
    currency: str(p.currency),
    reference: str(p.reference),
    attempt: num(p.attempt),
    paidAt: strOrNull(p.paid_at),
    collectedAt: strOrNull(p.collected_at),
  }));
}

export async function listProofs(orderId: string): Promise<ProofSummary[]> {
  const { data, error } = await getSupabase()
    .from("payment_proofs")
    .select("id, payment_id, status, reason, created_at, mime, file_path")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });
  if (error) return fail(error);
  return ((data ?? []) as unknown as Row[]).map((p): ProofSummary => ({
    id: str(p.id),
    paymentId: str(p.payment_id),
    status: str(p.status) as ProofSummary["status"],
    reason: strOrNull(p.reason),
    createdAt: str(p.created_at),
    mime: str(p.mime),
    filePath: str(p.file_path),
  }));
}

const toRefund = (r: Row): RefundRow => ({
  id: str(r.id),
  orderId: str(r.order_id),
  kind: str(r.kind) as RefundRow["kind"],
  amount: num(r.amount),
  shippingAmount: num(r.shipping_amount),
  deduction: num(r.deduction),
  currency: str(r.currency),
  reason: str(r.reason),
  status: str(r.status) as RefundRow["status"],
  method: str(r.method),
  destination: strOrNull(r.destination),
  externalRef: strOrNull(r.external_ref),
  returnId: strOrNull(r.return_id),
  createdAt: str(r.created_at),
  processedAt: strOrNull(r.processed_at),
  decisionNote: strOrNull(r.decision_note),
});
const REFUND_COLUMNS =
  "id, order_id, kind, amount, shipping_amount, deduction, currency, reason, status, method, destination, external_ref, return_id, created_at, processed_at, decision_note";

export async function listRefunds(orderId: string): Promise<RefundRow[]> {
  const { data, error } = await getSupabase()
    .from("refunds")
    .select(REFUND_COLUMNS)
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });
  if (error) return fail(error);
  return ((data ?? []) as unknown as Row[]).map(toRefund);
}

/** Reembolsos que esperan que se devuelva el dinero (todos los pedidos), los más antiguos primero. */
export async function listPendingRefunds(): Promise<
  (RefundRow & { orderNumber: string; contactName: string })[]
> {
  const { data, error } = await getSupabase()
    .from("refunds")
    .select(`${REFUND_COLUMNS}, orders(number, contact_name)`)
    .in("status", ["requested", "approved"])
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return fail(error);
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    ...toRefund(r),
    orderNumber: str(one(r.orders).number),
    contactName: str(one(r.orders).contact_name),
  }));
}

export async function listReturns(orderId: string): Promise<ReturnRow[]> {
  const { data, error } = await getSupabase()
    .from("order_returns")
    .select(
      "id, order_id, status, reason, outside_window, override_reason, opened_at, closed_at, close_note, " +
        "order_return_items(id, order_item_id, qty, reason_code, restock, restocked_at)",
    )
    .eq("order_id", orderId)
    .order("opened_at", { ascending: false });
  if (error) return fail(error);
  return ((data ?? []) as unknown as Row[]).map((r): ReturnRow => ({
    id: str(r.id),
    orderId: str(r.order_id),
    status: str(r.status) as ReturnRow["status"],
    reason: str(r.reason),
    outsideWindow: r.outside_window === true,
    overrideReason: strOrNull(r.override_reason),
    openedAt: str(r.opened_at),
    closedAt: strOrNull(r.closed_at),
    closeNote: strOrNull(r.close_note),
    items: arr(r.order_return_items).map((raw) => {
      const i = obj(raw);
      return {
        id: str(i.id),
        orderItemId: str(i.order_item_id),
        qty: num(i.qty),
        reasonCode: str(i.reason_code) as ReturnRow["items"][number]["reasonCode"],
        restock: str(i.restock) as ReturnRow["items"][number]["restock"],
        restockedAt: strOrNull(i.restocked_at),
      };
    }),
  }));
}

const toIncident = (r: Row): IncidentRow => ({
  id: str(r.id),
  orderId: str(r.order_id),
  orderNumber: str(one(r.orders).number),
  contactName: str(one(r.orders).contact_name),
  type: str(r.type) as IncidentRow["type"],
  status: str(r.status) as IncidentRow["status"],
  description: strOrNull(r.description),
  costAssumed: num(r.cost_assumed),
  costBorneBy: str(r.cost_borne_by) as IncidentRow["costBorneBy"],
  resolution: strOrNull(r.resolution),
  openedAt: str(r.opened_at),
  resolvedAt: strOrNull(r.resolved_at),
});
const INCIDENT_COLUMNS =
  "id, order_id, type, status, description, cost_assumed, cost_borne_by, resolution, opened_at, resolved_at, orders(number, contact_name)";

export async function listIncidents(orderId?: string): Promise<IncidentRow[]> {
  let query = getSupabase().from("order_incidents").select(INCIDENT_COLUMNS);
  if (orderId) query = query.eq("order_id", orderId);
  const { data, error } = await query.order("opened_at", { ascending: false }).limit(300);
  if (error) return fail(error);
  return ((data ?? []) as unknown as Row[]).map(toIncident);
}

export async function listNotes(orderId: string): Promise<NoteRow[]> {
  const { data, error } = await getSupabase()
    .from("order_notes")
    .select("id, body, created_at, profiles(full_name)")
    .eq("order_id", orderId)
    .order("id", { ascending: false });
  if (error) return fail(error);
  return ((data ?? []) as unknown as Row[]).map((n): NoteRow => ({
    id: num(n.id),
    body: str(n.body),
    authorName: strOrNull(one(n.profiles).full_name),
    createdAt: str(n.created_at),
  }));
}

export async function listEdits(orderId: string): Promise<EditRow[]> {
  const { data, error } = await getSupabase()
    .from("order_edits")
    .select("id, reason, created_at, before, after, diff, profiles(full_name)")
    .eq("order_id", orderId)
    .order("id", { ascending: false });
  if (error) return fail(error);
  return ((data ?? []) as unknown as Row[]).map((e): EditRow => ({
    id: num(e.id),
    reason: str(e.reason),
    actorName: strOrNull(one(e.profiles).full_name),
    createdAt: str(e.created_at),
    before: obj(e.before),
    after: obj(e.after),
    diff: obj(e.diff),
  }));
}

// ── Lista negra ──────────────────────────────────────────────────────────────────────────
export async function listBlacklist(): Promise<BlacklistRow[]> {
  const { data, error } = await getSupabase()
    .from("blacklist_entries")
    .select(
      "id, kind, profile_id, phone_e164, email, reason, is_active, source_order_id, created_at, lifted_at, lift_reason, " +
        "profile:profiles!profile_id(full_name)",
    )
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return fail(error);
  return ((data ?? []) as unknown as Row[]).map((b): BlacklistRow => ({
    id: str(b.id),
    kind: str(b.kind) as BlacklistRow["kind"],
    profileId: strOrNull(b.profile_id),
    profileName: strOrNull(one(b.profile).full_name),
    phone: strOrNull(b.phone_e164),
    email: strOrNull(b.email),
    reason: str(b.reason),
    isActive: b.is_active === true,
    sourceOrderId: strOrNull(b.source_order_id),
    createdAt: str(b.created_at),
    liftedAt: strOrNull(b.lifted_at),
    liftReason: strOrNull(b.lift_reason),
  }));
}

export async function blacklistMatches(orderId: string): Promise<BlacklistMatch[]> {
  const rows = arr(await rpc<unknown>("admin_blacklist_matches", { p_order_id: orderId }));
  return rows.map((raw): BlacklistMatch => {
    const m = obj(raw);
    return {
      profileId: str(m.profile_id),
      fullName: str(m.full_name),
      blacklisted: m.blacklisted === true,
      reasons: arr(m.reasons) as BlacklistMatch["reasons"],
    };
  });
}

// ── Atención requerida ───────────────────────────────────────────────────────────────────
export async function attentionSummary(): Promise<
  Partial<Record<AttentionKind | "orders", number>>
> {
  return obj(await rpc<unknown>("admin_attention_summary")) as Partial<
    Record<AttentionKind | "orders", number>
  >;
}

export async function attentionOrders(): Promise<AttentionItem[]> {
  const rows = arr(await rpc<unknown>("admin_attention_orders"));
  return rows.map((raw): AttentionItem => {
    const a = obj(raw);
    return {
      kind: str(a.kind) as AttentionKind,
      orderId: str(a.order_id),
      number: str(a.number),
      status: str(a.status) as AttentionItem["status"],
      contactName: str(a.contact_name),
      total: num(a.total),
      currency: str(a.currency),
      createdAt: str(a.created_at),
      since: str(a.since),
      detail: obj(a.detail),
    };
  });
}

// ── Buscadores para el pedido manual ─────────────────────────────────────────────────────
export interface CustomerHit {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
}
export async function searchCustomers(term: string): Promise<CustomerHit[]> {
  const clean = term
    .replace(/[,()"'\\%*:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  if (clean.length < 2) return [];
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("id, full_name, email, phone_e164, is_active")
    .eq("role", "customer")
    .is("anonymized_at", null)
    .or(`full_name.ilike.%${clean}%,email.ilike.%${clean}%,phone_e164.ilike.%${clean}%`)
    .order("full_name")
    .limit(10);
  if (error) return fail(error);
  return ((data ?? []) as unknown as Row[]).map((p) => ({
    id: str(p.id),
    fullName: str(p.full_name),
    email: strOrNull(p.email),
    phone: strOrNull(p.phone_e164),
    isActive: p.is_active === true,
  }));
}

export interface VariantHit {
  id: string;
  productName: string;
  colorName: string | null;
  sizeLabel: string | null;
  sku: string | null;
  stock: number;
}
export async function searchVariants(term: string): Promise<VariantHit[]> {
  const clean = term
    .replace(/[,()"'\\%*:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  if (clean.length < 2) return [];
  const { data, error } = await getSupabase()
    .from("product_variants")
    .select(
      "id, sku, stock_on_hand, products!inner(name, status, archived_at), product_colors(name), product_sizes(label)",
    )
    .is("archived_at", null)
    .eq("products.status", "active")
    .is("products.archived_at", null)
    .ilike("products.name", `%${clean}%`)
    .limit(20);
  if (error) return fail(error);
  return ((data ?? []) as unknown as Row[]).map((v) => ({
    id: str(v.id),
    productName: str(one(v.products).name),
    colorName: strOrNull(one(v.product_colors).name),
    sizeLabel: strOrNull(one(v.product_sizes).label),
    sku: strOrNull(v.sku),
    stock: num(v.stock_on_hand),
  }));
}

// ── Acciones (todas son funciones SQL con is_admin() por dentro) ─────────────────────────
export const transitionOrder = (
  orderId: string,
  to: string,
  reason: string | null,
  expectedFrom: string,
) =>
  rpc("admin_transition_order", {
    p_order_id: orderId,
    p_to: to,
    p_reason: reason,
    p_expected_from: expectedFrom,
  });

export const undoTransition = (orderId: string, expectedStatus: string) =>
  rpc("admin_undo_transition", { p_order_id: orderId, p_expected_status: expectedStatus });

export const addNote = (orderId: string, body: string) =>
  rpc("admin_add_order_note", { p_order_id: orderId, p_body: body });

export interface EditArgs {
  orderId: string;
  expectedUpdatedAt: string | null;
  items: unknown[];
  contact: Record<string, string> | null;
  address: Record<string, unknown> | null;
  shippingCost: number | null;
  extraDiscount: number;
  reason: string;
  dryRun: boolean;
}
export const editOrder = (a: EditArgs) =>
  rpc("admin_edit_order", {
    p_order_id: a.orderId,
    p_expected_updated_at: a.expectedUpdatedAt,
    p_items: a.items,
    p_contact: a.contact,
    p_address: a.address,
    p_shipping_cost: a.shippingCost,
    p_extra_discount: a.extraDiscount,
    p_reason: a.reason,
    p_dry_run: a.dryRun,
  });

export interface RefundArgs {
  orderId: string;
  key: string;
  mode: "all" | "items" | "amount";
  items: { item_id: string; qty: number }[] | null;
  includeShipping: boolean;
  deduction: number;
  amount: number | null;
  reason: string;
  method: string;
  destination: string | null;
  externalRef: string | null;
  returnId: string | null;
  cancel: boolean;
  markProcessed: boolean;
  dryRun: boolean;
}
export const refundOrder = (a: RefundArgs) =>
  rpc("admin_refund_order", {
    p_order_id: a.orderId,
    p_idempotency_key: a.key,
    p_mode: a.mode,
    p_items: a.items,
    p_include_shipping: a.includeShipping,
    p_deduction: a.deduction,
    p_amount: a.amount,
    p_reason: a.reason,
    p_method: a.method,
    p_destination: a.destination,
    p_external_ref: a.externalRef,
    p_return_id: a.returnId,
    p_cancel: a.cancel,
    p_mark_processed: a.markProcessed,
    p_dry_run: a.dryRun,
  });

export const processRefund = (id: string, externalRef: string | null, note: string | null) =>
  rpc("admin_process_refund", { p_refund_id: id, p_external_ref: externalRef, p_note: note });
export const rejectRefund = (id: string, note: string) =>
  rpc("admin_reject_refund", { p_refund_id: id, p_note: note });

export const openReturn = (
  orderId: string,
  items: { item_id: string; qty: number; reason_code: string; restock: string }[],
  reason: string,
  overrideReason: string | null,
) =>
  rpc("admin_return_open", {
    p_order_id: orderId,
    p_items: items,
    p_reason: reason,
    p_override_reason: overrideReason,
  });
export const closeReturn = (id: string, resolutions: { item_id: string; restock: string }[]) =>
  rpc("admin_return_close", { p_return_id: id, p_resolutions: resolutions });
export const rejectReturn = (id: string, note: string) =>
  rpc("admin_return_reject", { p_return_id: id, p_note: note });

export const codCollect = (orderId: string, amount: number | null, note: string | null) =>
  rpc("admin_cod_collect", { p_order_id: orderId, p_amount: amount, p_note: note });
export const codReject = (
  orderId: string,
  cost: number,
  note: string | null,
  blacklist: boolean,
  blacklistReason: string | null,
) =>
  rpc("admin_cod_reject", {
    p_order_id: orderId,
    p_cost: cost,
    p_note: note,
    p_blacklist: blacklist,
    p_blacklist_reason: blacklistReason,
  });

export const openIncident = (
  orderId: string,
  type: string,
  description: string | null,
  cost: number,
  bornBy: string,
) =>
  rpc("admin_incident_open", {
    p_order_id: orderId,
    p_type: type,
    p_description: description,
    p_cost: cost,
    p_borne_by: bornBy,
  });
export const updateIncident = (
  id: string,
  status: "investigating" | "resolved",
  resolution: string | null,
  cost: number | null,
  bornBy: string | null,
) =>
  rpc("admin_incident_update", {
    p_id: id,
    p_status: status,
    p_resolution: resolution,
    p_cost: cost,
    p_borne_by: bornBy,
  });

export const blacklistAdd = (a: {
  kind: "profile" | "phone" | "email";
  profileId: string | null;
  phone: string | null;
  email: string | null;
  reason: string;
  orderId: string | null;
  includeContacts: boolean;
}) =>
  rpc("admin_blacklist_add", {
    p_kind: a.kind,
    p_profile_id: a.profileId,
    p_phone: a.phone,
    p_email: a.email,
    p_reason: a.reason,
    p_order_id: a.orderId,
    p_include_contacts: a.includeContacts,
  });
export const blacklistLift = (id: string, reason: string) =>
  rpc("admin_blacklist_lift", { p_entry_id: id, p_reason: reason });

export interface ManualOrderArgs {
  profileId: string;
  items: { variant_id: string; qty: number; unit_price?: number }[];
  channel: "manual" | "whatsapp";
  paymentMethod: string;
  shippingMethod: string;
  address: Record<string, unknown> | null;
  key: string | null;
  shippingCost: number | null;
  slotId: string | null;
  deliveryDate: string | null;
  discount: number;
  discountReason: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  note: string | null;
  markPaid: boolean;
  dryRun: boolean;
}
export const createManualOrder = (a: ManualOrderArgs) =>
  rpc("admin_create_manual_order", {
    p_profile_id: a.profileId,
    p_items: a.items,
    p_channel: a.channel,
    p_payment_method: a.paymentMethod,
    p_shipping_method: a.shippingMethod,
    p_address: a.address,
    p_idempotency_key: a.key,
    p_shipping_cost: a.shippingCost,
    p_slot_id: a.slotId,
    p_delivery_date: a.deliveryDate,
    p_discount: a.discount,
    p_discount_reason: a.discountReason,
    p_contact_name: a.contactName,
    p_contact_email: a.contactEmail,
    p_contact_phone: a.contactPhone,
    p_note: a.note,
    p_mark_paid: a.markPaid,
    p_dry_run: a.dryRun,
  });

/** Métodos de pago activos (para filtros y para el pedido manual). */
export async function listPaymentMethodsLite(): Promise<
  { code: string; name: string; provider: string }[]
> {
  const { data, error } = await getSupabase()
    .from("payment_methods")
    .select("code, name, provider")
    .eq("is_active", true)
    .is("archived_at", null)
    .order("sort_order");
  if (error) return fail(error);
  return ((data ?? []) as unknown as Row[]).map((m) => ({
    code: str(m.code),
    name: str(m.name),
    provider: str(m.provider),
  }));
}

/** Métodos de envío activos (para el pedido manual). */
export async function listShippingMethodsLite(): Promise<
  { code: string; name: string; kind: string }[]
> {
  const { data, error } = await getSupabase()
    .from("public_shipping_methods")
    .select("code, name, kind")
    .order("sort_order");
  if (error) return fail(error);
  return ((data ?? []) as unknown as Row[]).map((m) => ({
    code: str(m.code),
    name: str(m.name),
    kind: str(m.kind),
  }));
}
