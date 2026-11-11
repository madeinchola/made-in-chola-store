import type {
  PaymentStage,
  PaymentStatus,
  PaymentView,
  PaymentViewMethod,
  PaymentViewOrder,
  PaymentViewPayment,
  PaymentViewProof,
  ProofStatus,
} from "./types";
import { QR_PROVIDERS } from "./types";

const PAYMENT_STATUSES: readonly string[] = [
  "initiated",
  "pending",
  "paid",
  "failed",
  "cancelled",
  "expired",
  "refunded",
  "disputed",
];
const PROOF_STATUSES: readonly string[] = ["pending", "approved", "rejected"];
/** Estados del pedido en los que el pago ya se dio por bueno. */
const PAID_ORDER_STATUSES: readonly string[] = [
  "paid",
  "preparing",
  "shipped",
  "delivered",
  "completed",
];

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function parseOrder(raw: unknown): PaymentViewOrder | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id);
  const number = str(raw.number);
  const status = str(raw.status);
  const total = num(raw.total);
  const currency = str(raw.currency);
  if (!id || !number || !status || total === null || !currency) return null;
  return { id, number, status, total, currency, paymentExpiresAt: str(raw.payment_expires_at) };
}

function parsePayment(raw: unknown): PaymentViewPayment | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id);
  const status = str(raw.status);
  const provider = str(raw.provider);
  const method = str(raw.method);
  const reference = str(raw.reference);
  const amount = num(raw.amount);
  const currency = str(raw.currency);
  if (!id || !status || !PAYMENT_STATUSES.includes(status) || !provider || !method || !reference)
    return null;
  if (amount === null || !currency) return null;
  return {
    id,
    status: status as PaymentStatus,
    provider,
    method,
    reference,
    amount,
    currency,
    expiresAt: str(raw.expires_at),
    paidAt: str(raw.paid_at),
    underReview: raw.under_review === true,
  };
}

function parseMethod(raw: unknown): PaymentViewMethod | null {
  if (!isObject(raw)) return null;
  const code = str(raw.code);
  const name = str(raw.name);
  if (!code || !name) return null;
  return {
    code,
    name,
    description: str(raw.description),
    accountDetails: str(raw.account_details),
    qrImagePath: str(raw.qr_image_path),
  };
}

function parseProof(raw: unknown): PaymentViewProof | null {
  if (!isObject(raw)) return null;
  const status = str(raw.status);
  const createdAt = str(raw.created_at);
  const mime = str(raw.mime);
  if (!status || !PROOF_STATUSES.includes(status) || !createdAt || !mime) return null;
  return {
    status: status as ProofStatus,
    reason: str(raw.reason),
    createdAt,
    reviewedAt: str(raw.reviewed_at),
    mime,
  };
}

/**
 * Lee la respuesta de `customer_payment_view`. `null` si el pedido no existe o no es de la clienta (el servidor responde igual
 * en los dos casos) o si la respuesta no tiene la forma esperada: la pantalla no inventa datos de pago.
 */
export function parsePaymentView(raw: unknown): PaymentView | null {
  if (!isObject(raw) || raw.outcome !== "ok") return null;
  const serverNow = str(raw.server_now);
  const order = parseOrder(raw.order);
  if (!serverNow || Number.isNaN(Date.parse(serverNow)) || !order) return null;
  return {
    serverNow,
    order,
    payment: raw.payment === null || raw.payment === undefined ? null : parsePayment(raw.payment),
    method: raw.method === null || raw.method === undefined ? null : parseMethod(raw.method),
    proof: raw.proof === null || raw.proof === undefined ? null : parseProof(raw.proof),
    canUpload: raw.can_upload === true,
    canRetry: raw.can_retry === true,
  };
}

/** ¿Es un pedido que se paga con QR? (el servidor solo trae los datos del QR para esos). */
export const isQrPayment = (view: PaymentView): boolean =>
  view.payment !== null && QR_PROVIDERS.includes(view.payment.provider);

/**
 * En qué punto va el pago. El orden importa: primero lo definitivo (pagado), luego los problemas, y al final la espera.
 *  · Un pago que llegó con el pedido ya cancelado («late») no se esconde: se le dice que lo están revisando mientras la
 *    revisión siga abierta, y cuando el administrador la resolvió («late_done») que ya se resolvió.
 *  · Un monto distinto o un duplicado abren una revisión: «en revisión», sin culpar a la clienta.
 */
export function paymentStage(view: PaymentView): PaymentStage {
  const { order, payment, proof } = view;
  if (payment?.status === "disputed") return "disputed";
  if (payment?.status === "refunded") return "refunded";
  if (payment?.status === "paid" && ["cancelled", "refunded"].includes(order.status)) {
    // «Lo estamos revisando» solo mientras HAY una revisión abierta; resuelta, ya no es cierto.
    return payment.underReview ? "late" : "late_done";
  }
  if (PAID_ORDER_STATUSES.includes(order.status) || payment?.status === "paid") return "paid";
  if (order.status === "cancelled" || order.status === "refunded") {
    return payment?.status === "expired" ? "expired" : "cancelled";
  }
  if (!payment) return "cancelled";
  if (payment.status === "failed") return "failed";
  if (payment.status === "expired" || payment.status === "cancelled") return "expired";
  if (payment.underReview) return "in_review";
  if (proof?.status === "pending") return "proof_pending";
  if (proof?.status === "rejected") return "proof_rejected";
  return "awaiting";
}

/**
 * Segundos que quedan, con la hora del SERVIDOR: `offset = serverNow − reloj del aparato cuando llegó la respuesta`, y se aplica
 * a cada lectura del reloj. Un aparato con la hora mal puesta ve la misma cuenta que uno con la hora bien puesta.
 */
export function secondsLeft(
  expiresAt: string | null,
  serverNow: string,
  fetchedAtMs: number,
  nowMs: number,
): number | null {
  if (!expiresAt) return null;
  const expires = Date.parse(expiresAt);
  const server = Date.parse(serverNow);
  if (Number.isNaN(expires) || Number.isNaN(server)) return null;
  const offset = server - fetchedAtMs;
  return Math.max(0, Math.ceil((expires - (nowMs + offset)) / 1000));
}

/** «23:59:41» desde una hora; «59:41» por debajo. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${two(hours)}:${two(minutes)}:${two(seconds)}`
    : `${two(minutes)}:${two(seconds)}`;
}

/** Texto hablado y estable para lectores de pantalla: cambia solo cuando cambia el minuto («23 horas y 59 minutos»). */
export function spokenRemaining(totalSeconds: number): { hours: number; minutes: number } {
  const s = Math.max(0, Math.floor(totalSeconds));
  return { hours: Math.floor(s / 3600), minutes: Math.floor((s % 3600) / 60) };
}
