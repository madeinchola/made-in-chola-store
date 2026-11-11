import { AUTOMATIC_QR_IN_UI } from "@/features/payments/automaticQr";
import { t, type MessageKey } from "@/i18n";
import { parseAmount } from "../lib/amount";
import type { MethodRow, PaymentStatus, ReviewReason } from "./types";

const money = new Intl.NumberFormat("es-BO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
/** «Bs 255,00». Solo formato: el importe lo calculó el servidor. */
export const formatMoney = (amount: number, currency: string): string =>
  `${currency === "BOB" ? "Bs" : currency} ${money.format(amount)}`;

const date = new Intl.DateTimeFormat("es-BO", { dateStyle: "medium", timeStyle: "short" });
export const formatDateTime = (iso: string | null): string => {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? "—" : date.format(ms);
};

export const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

type Tone = "success" | "info" | "warning" | "danger" | "neutral";
const STATUS_TONE: Record<PaymentStatus, Tone> = {
  initiated: "info",
  pending: "info",
  paid: "success",
  failed: "danger",
  cancelled: "neutral",
  expired: "neutral",
  refunded: "warning",
  disputed: "danger",
};
export const statusTone = (status: PaymentStatus): Tone => STATUS_TONE[status];
export const statusLabel = (status: PaymentStatus): string =>
  t(`admin.payments.status.${status}` as MessageKey);

export const reasonLabel = (reason: ReviewReason): string =>
  t(`admin.payments.review.reasons.${reason}` as MessageKey);

/** Una frase para el administrador de qué pasó con esa revisión (con los números del detalle que guardó el servidor). */
export function reviewSummary(
  reason: ReviewReason,
  detail: Record<string, unknown>,
  currency: string,
): string {
  const num = (key: string): number | null => {
    const value = detail[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  if (reason === "amount_mismatch") {
    const expected = num("expected");
    const received = num("received");
    if (expected !== null && received !== null) {
      return t("admin.payments.review.summary.amount_mismatch", {
        expected: formatMoney(expected, currency),
        received: formatMoney(received, currency),
      });
    }
  }
  if (reason === "late") {
    // El pedido se canceló con dinero ya recibido o con un comprobante que nadie revisó (no llegó un aviso tarde).
    if (detail.cause === "cancelled_after_payment")
      return t("admin.payments.review.summary.lateCancelledPaid");
    if (detail.cause === "proof_pending_at_cancel")
      return t("admin.payments.review.summary.lateProofPending");
    const amount = num("amount");
    const status = typeof detail.order_status === "string" ? detail.order_status : "cancelled";
    return t("admin.payments.review.summary.late", {
      amount: amount === null ? "—" : formatMoney(amount, currency),
      status,
    });
  }
  // Sin cifras en el detalle no se inventan: una frase general (nunca un «{expected}» sin llenar).
  return t(
    (reason === "amount_mismatch"
      ? "admin.payments.review.summary.amount_mismatchNoDetail"
      : `admin.payments.review.summary.${reason}`) as MessageKey,
  );
}

/** ¿Se puede confirmar a mano un cobro en este estado? (no uno ya pagado, reembolsado ni disputado) */
export const canConfirmManually = (status: PaymentStatus): boolean =>
  ["initiated", "pending", "failed", "expired", "cancelled"].includes(status);

// ── Formularios ──
export type ReasonProblem = "required" | "too_long";
/** Motivo de un rechazo: obligatorio, hasta 300 caracteres (la base lo exige igual). */
export function validateReason(
  raw: string,
): { ok: true; value: string } | { ok: false; problem: ReasonProblem } {
  const value = raw.trim().replace(/\s+/g, " ");
  if (value === "") return { ok: false, problem: "required" };
  if (value.length > 300) return { ok: false, problem: "too_long" };
  return { ok: true, value };
}
export function validateNote(
  raw: string,
): { ok: true; value: string } | { ok: false; problem: ReasonProblem } {
  const value = raw.trim().replace(/\s+/g, " ");
  if (value === "") return { ok: false, problem: "required" };
  if (value.length > 500) return { ok: false, problem: "too_long" };
  return { ok: true, value };
}

/** El monto que el administrador vio en el comprobante. Vacío = el esperado. Estricto como la base (2 decimales). */
export function validateReceived(
  raw: string,
  decimals = 2,
):
  | { ok: true; value: number | null }
  | { ok: false; problem: "format" | "decimals" | "too_large" | "not_positive" } {
  if (raw.trim() === "") return { ok: true, value: null };
  const parsed = parseAmount(raw, { decimals, allowZero: false });
  if (!parsed.ok) {
    return { ok: false, problem: parsed.problem === "empty" ? "format" : parsed.problem };
  }
  return { ok: true, value: Number(parsed.value) };
}

// ── Métodos de pago ──
export const isQrProvider = (provider: string): boolean =>
  provider === "manual_qr" || provider === "qr_api";

/**
 * Qué muestra la interfaz del cobro QR automático (`qr_api`): nada, mientras `AUTOMATIC_QR_IN_UI` sea falso. El código y la base lo
 * siguen soportando; aquí solo se decide qué se ve (ver `automaticQr.ts`).
 */
export const visibleMethods = (rows: readonly MethodRow[]): MethodRow[] =>
  rows.filter((r) => AUTOMATIC_QR_IN_UI || r.provider !== "qr_api");

/** Los tipos de cobro que ofrece el filtro de la lista de cobros. */
export const providerFilterOptions = (): readonly string[] => [
  "manual_qr",
  ...(AUTOMATIC_QR_IN_UI ? ["qr_api"] : []),
  "whatsapp",
  "cash_on_delivery",
];

/** Nombre con que se muestra un tipo de cobro. Un cobro `qr_api` suelto (no debería existir con la interfaz apagada) se ve como «QR». */
export function providerLabel(provider: string): string {
  switch (provider) {
    case "manual_qr":
      return t("admin.payments.providers.manual_qr");
    case "qr_api":
      return AUTOMATIC_QR_IN_UI
        ? t("admin.payments.providers.qr_api")
        : t("admin.payments.providers.qr");
    case "whatsapp":
      return t("admin.payments.providers.whatsapp");
    case "cash_on_delivery":
      return t("admin.payments.providers.cash_on_delivery");
    default:
      return provider;
  }
}

export interface MethodForm {
  name: string;
  description: string;
  accountDetails: string;
  windowMinutes: string;
  maxAmount: string;
  isActive: boolean;
  blockedForBlacklisted: boolean;
}
export type MethodErrors = Partial<Record<keyof MethodForm | "qr", MessageKey>>;

export function methodFormFrom(method: MethodRow): MethodForm {
  return {
    name: method.name,
    description: method.description ?? "",
    accountDetails: method.accountDetails ?? "",
    windowMinutes: method.windowMinutes === null ? "" : String(method.windowMinutes),
    maxAmount: method.maxAmount === null ? "" : String(method.maxAmount),
    isActive: method.isActive,
    blockedForBlacklisted: method.blockedForBlacklisted,
  };
}

export interface MethodPatch {
  name: string;
  description: string | null;
  account_details: string | null;
  window_minutes: number | null;
  max_amount: number | null;
  is_active: boolean;
  blocked_for_blacklisted: boolean;
}

/**
 * Valida el formulario de un método EXACTAMENTE como lo exige la base (así el error se explica junto al campo y no como un
 * rechazo genérico): nombre 1–80, descripción hasta 300, cuenta hasta 500, ventana 1–1440 minutos (obligatoria en un QR) y un
 * método QR activo necesita la imagen del QR y los datos de la cuenta.
 */
export function validateMethodForm(
  form: MethodForm,
  method: Pick<MethodRow, "provider" | "qrImagePath">,
): { ok: true; patch: MethodPatch } | { ok: false; errors: MethodErrors } {
  const errors: MethodErrors = {};
  const name = form.name.trim().replace(/\s+/g, " ");
  if (name === "") errors.name = "admin.payments.methods.errors.nameRequired";
  else if (name.length > 80) errors.name = "admin.payments.methods.errors.nameTooLong";
  const description = form.description.trim();
  if (description.length > 300)
    errors.description = "admin.payments.methods.errors.descriptionTooLong";
  const account = form.accountDetails.trim();
  if (account.length > 500) errors.accountDetails = "admin.payments.methods.errors.accountTooLong";

  // Solo un método QR tiene ventana de pago. WhatsApp y contra entrega NO vencen (S-05): ponerles una ventana haría que sus pedidos
  // se cancelaran solos, así que el campo ni se muestra y aquí se manda siempre vacío.
  let windowMinutes: number | null = null;
  if (isQrProvider(method.provider)) {
    if (form.windowMinutes.trim() !== "") {
      if (!/^\d{1,4}$/.test(form.windowMinutes.trim()))
        errors.windowMinutes = "admin.payments.methods.errors.windowRange";
      else {
        windowMinutes = Number(form.windowMinutes.trim());
        if (windowMinutes < 1 || windowMinutes > 1440)
          errors.windowMinutes = "admin.payments.methods.errors.windowRange";
      }
    } else {
      errors.windowMinutes = "admin.payments.methods.errors.windowRequired";
    }
  }

  let maxAmount: number | null = null;
  if (form.maxAmount.trim() !== "") {
    const parsed = parseAmount(form.maxAmount, { decimals: 2 });
    if (!parsed.ok) errors.maxAmount = "admin.payments.methods.errors.maxAmount";
    else maxAmount = Number(parsed.value);
  }

  if (isQrProvider(method.provider) && form.isActive) {
    if (!method.qrImagePath) errors.qr = "admin.payments.methods.errors.qrRequired";
    if (account === "") errors.accountDetails = "admin.payments.methods.errors.accountRequired";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    patch: {
      name,
      description: description === "" ? null : description,
      account_details: account === "" ? null : account,
      window_minutes: windowMinutes,
      max_amount: maxAmount,
      is_active: form.isActive,
      blocked_for_blacklisted: form.blockedForBlacklisted,
    },
  };
}

/** Ventana en palabras: 1440 → «24 horas», 90 → «90 minutos». */
export function windowText(minutes: number | null): string {
  if (minutes === null) return t("admin.payments.methods.noWindow");
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return t(
      hours === 1 ? "admin.payments.methods.windowHour" : "admin.payments.methods.windowHours",
      { n: hours },
    );
  }
  return t("admin.payments.methods.windowMinutes", { n: minutes });
}

/** Extensión de un archivo de QR según su tipo real (el servidor de Storage vuelve a limitarlo por tipo). */
export function qrExtension(mime: string): "png" | "jpg" | "webp" | null {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return null;
}
export const QR_MAX_BYTES = 2 * 1024 * 1024;
