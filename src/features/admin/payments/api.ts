import { callFunction } from "@/lib/functions";
import { fromDbError } from "@/lib/db-errors";
import { AppError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { t } from "@/i18n";
import { updateVersioned } from "../lib/versioned";
import {
  PAGE_SIZE,
  type MethodRow,
  type OpenReview,
  type PaymentEvent,
  type PaymentFilters,
  type PaymentRow,
  type PendingProof,
  type ProofHistoryRow,
} from "./types";

/**
 * Acceso a datos del panel de Pagos. Solo el administrador lee estas tablas (RLS); las decisiones (aprobar, rechazar, confirmar a
 * mano, resolver) pasan por funciones SQL que exigen ser admin por dentro y dejan rastro en la auditoría. Aquí no se calcula nada.
 */
type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const obj = (v: unknown): Row => (typeof v === "object" && v !== null ? (v as Row) : {});
/** PostgREST devuelve un objeto (relación a uno) o, a veces, una lista de uno: se aceptan las dos formas. */
const one = (v: unknown): Row => (Array.isArray(v) ? obj(v[0]) : obj(v));

const fail = (error: unknown): never => {
  throw fromDbError(error as { message: string; code?: string });
};

// ── Bandeja «Por revisar» ──
export async function listPendingProofs(): Promise<PendingProof[]> {
  const { data, error } = await getSupabase()
    .from("payment_proofs")
    .select(
      "id, payment_id, order_id, file_path, file_hash, mime, size_bytes, duplicate_of, created_at, " +
        "payments(reference, amount, currency), orders(number, contact_name, contact_phone)",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return fail(error);
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const payment = one(r.payments);
    const order = one(r.orders);
    return {
      id: str(r.id),
      paymentId: str(r.payment_id),
      orderId: str(r.order_id),
      filePath: str(r.file_path),
      fileHash: str(r.file_hash),
      mime: str(r.mime),
      sizeBytes: num(r.size_bytes),
      duplicateOf: strOrNull(r.duplicate_of),
      createdAt: str(r.created_at),
      reference: str(payment.reference),
      amount: num(payment.amount),
      currency: str(payment.currency),
      orderNumber: str(order.number),
      contactName: str(order.contact_name),
      contactPhone: str(order.contact_phone),
    };
  });
}

export async function listOpenReviews(): Promise<OpenReview[]> {
  const { data, error } = await getSupabase()
    .from("payment_reviews")
    .select(
      "id, payment_id, reason, detail, opened_at, " +
        "payments(reference, amount, received_amount, currency, status, orders(number, status, contact_name))",
    )
    .eq("status", "open")
    .order("opened_at", { ascending: true })
    .limit(200);
  if (error) return fail(error);
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const payment = one(r.payments);
    const order = one(payment.orders);
    return {
      id: str(r.id),
      paymentId: str(r.payment_id),
      reason: str(r.reason) as OpenReview["reason"],
      detail: obj(r.detail),
      openedAt: str(r.opened_at),
      reference: str(payment.reference),
      amount: num(payment.amount),
      receivedAmount: numOrNull(payment.received_amount),
      currency: str(payment.currency),
      paymentStatus: str(payment.status) as OpenReview["paymentStatus"],
      orderNumber: str(order.number),
      orderStatus: str(order.status),
      contactName: str(order.contact_name),
    };
  });
}

// ── Lista de pagos ──
export async function listPayments(
  filters: PaymentFilters,
): Promise<{ rows: PaymentRow[]; total: number }> {
  let query = getSupabase()
    .from("payments")
    .select(
      "id, order_id, provider, method, status, amount, currency, reference, attempt, created_at, expires_at, paid_at, " +
        "received_amount, external_id, orders(number, status, contact_name)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .order("attempt", { ascending: false });
  if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.provider !== "all") query = query.eq("provider", filters.provider);
  const from = Math.max(0, filters.page) * PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);
  if (error) return fail(error);
  const rows = ((data ?? []) as unknown as Row[]).map((r): PaymentRow => {
    const order = one(r.orders);
    return {
      id: str(r.id),
      orderId: str(r.order_id),
      orderNumber: str(order.number),
      orderStatus: str(order.status),
      contactName: str(order.contact_name),
      provider: str(r.provider),
      method: str(r.method),
      status: str(r.status) as PaymentRow["status"],
      amount: num(r.amount),
      currency: str(r.currency),
      reference: str(r.reference),
      attempt: num(r.attempt),
      createdAt: str(r.created_at),
      expiresAt: strOrNull(r.expires_at),
      paidAt: strOrNull(r.paid_at),
      receivedAmount: numOrNull(r.received_amount),
      externalId: strOrNull(r.external_id),
    };
  });
  return { rows, total: count ?? rows.length };
}

export async function listPaymentEvents(paymentId: string): Promise<PaymentEvent[]> {
  const { data, error } = await getSupabase()
    .from("webhook_events")
    .select("id, provider, event_id, outcome, error, attempts, received_at, signature_valid")
    .eq("payment_id", paymentId)
    .order("received_at", { ascending: false })
    .limit(100);
  if (error) return fail(error);
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: num(r.id),
    provider: str(r.provider),
    eventId: strOrNull(r.event_id),
    outcome: strOrNull(r.outcome),
    error: strOrNull(r.error),
    attempts: num(r.attempts),
    receivedAt: str(r.received_at),
    signatureValid: r.signature_valid === true,
  }));
}

export async function listProofHistory(paymentId: string): Promise<ProofHistoryRow[]> {
  const { data, error } = await getSupabase()
    .from("payment_proofs")
    .select("id, status, reason, created_at, reviewed_at, mime, file_path")
    .eq("payment_id", paymentId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return fail(error);
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: str(r.id),
    status: str(r.status) as ProofHistoryRow["status"],
    reason: strOrNull(r.reason),
    createdAt: str(r.created_at),
    reviewedAt: strOrNull(r.reviewed_at),
    mime: str(r.mime),
    filePath: str(r.file_path),
  }));
}

/** URL firmada y de vida corta del archivo de un comprobante (el bucket es privado: no hay otra forma de verlo). */
export async function signedProofUrl(path: string): Promise<string> {
  const { data, error } = await getSupabase()
    .storage.from("payment-proofs")
    .createSignedUrl(path, 300);
  if (error || !data?.signedUrl)
    throw new AppError("unknown", t("admin.payments.proof.openError"), { cause: error });
  return data.signedUrl;
}

// ── Decisiones (funciones SQL con is_admin() por dentro) ──
export type ReviewOutcome =
  | { outcome: "approved"; payment?: { outcome?: string; review?: string | null } }
  | { outcome: "rejected" }
  | { outcome: "already_reviewed"; status?: string }
  | { outcome: "not_found" };

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
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

export const reviewProof = (
  proofId: string,
  decision: "approve" | "reject",
  reason: string | null,
  receivedAmount: number | null,
) =>
  rpc<ReviewOutcome>("admin_review_proof", {
    p_proof_id: proofId,
    p_decision: decision,
    p_reason: reason,
    p_received_amount: receivedAmount,
  });

export const confirmPaymentManually = (
  paymentId: string,
  receivedAmount: number | null,
  note: string | null,
) =>
  rpc<{ outcome: string; review?: string | null }>("admin_confirm_payment_manual", {
    p_payment_id: paymentId,
    p_received_amount: receivedAmount,
    p_note: note,
  });

export const resolveReview = (reviewId: string, note: string) =>
  rpc<{ outcome: "resolved" | "already_resolved" | "not_found" }>("admin_resolve_review", {
    p_review_id: reviewId,
    p_note: note,
  });

/** «Conciliar ahora»: le pregunta al proveedor por los cobros por vencer (solo administradores). */
export async function reconcileNow(): Promise<{
  checked: number;
  changed: number;
  errors: number;
  unsupported: number;
}> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  const result = await callFunction<{
    ok: boolean;
    checked: number;
    changed: number;
    errors: number;
    unsupported: number;
  }>("payment-reconcile", {}, token ? { token } : {});
  if (!result.ok) throw new AppError("unknown", t("admin.payments.list.reconcileError"));
  return result.data;
}

// ── Métodos de pago ──
const METHOD_COLUMNS =
  "id, country, code, provider, name, description, is_active, sort_order, max_amount, window_minutes, " +
  "blocked_for_blacklisted, account_details, qr_image_path, archived_at, updated_at";

const toMethod = (r: Row): MethodRow => ({
  id: str(r.id),
  country: str(r.country),
  code: str(r.code),
  provider: str(r.provider),
  name: str(r.name),
  description: strOrNull(r.description),
  isActive: r.is_active === true,
  sortOrder: num(r.sort_order),
  maxAmount: numOrNull(r.max_amount),
  windowMinutes: numOrNull(r.window_minutes),
  blockedForBlacklisted: r.blocked_for_blacklisted === true,
  accountDetails: strOrNull(r.account_details),
  qrImagePath: strOrNull(r.qr_image_path),
  archivedAt: strOrNull(r.archived_at),
  updatedAt: str(r.updated_at),
});

export async function listMethods(): Promise<MethodRow[]> {
  const { data, error } = await getSupabase()
    .from("payment_methods")
    .select(METHOD_COLUMNS)
    .order("sort_order")
    .order("code");
  if (error) return fail(error);
  return ((data ?? []) as unknown as Row[]).map(toMethod);
}

export const updateMethod = (id: string, updatedAt: string, patch: object) =>
  updateVersioned("payment_methods", id, updatedAt, patch);

/** Sube la imagen del QR al bucket público y devuelve su ruta (`qr/{uuid}.{ext}`). */
export async function uploadQrImage(
  file: Blob,
  ext: string,
  newId: () => string = () => crypto.randomUUID(),
): Promise<string> {
  const path = `qr/${newId()}.${ext}`;
  const { error } = await getSupabase().storage.from("payment-qr").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error)
    throw new AppError("unknown", t("admin.payments.methods.qrUploadError"), { cause: error });
  return path;
}

export function qrPublicUrl(path: string): string {
  return getSupabase().storage.from("payment-qr").getPublicUrl(path).data.publicUrl;
}
