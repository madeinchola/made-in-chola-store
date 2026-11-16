import { t, type MessageKey } from "@/i18n";
import { parseAmount } from "../lib/amount";
import { formatDateTime, formatMoney } from "../payments/logic";
import type { OrderRow, OrderStatus, PaymentStatus, RefundStatus } from "./types";

export { formatDateTime, formatMoney };

type Tone = "success" | "info" | "warning" | "danger" | "neutral";

const STATUS_TONE: Record<OrderStatus, Tone> = {
  pending_payment: "warning",
  paid: "info",
  preparing: "info",
  shipped: "info",
  delivered: "success",
  completed: "success",
  cancelled: "neutral",
  refunded: "neutral",
};
export const statusTone = (status: OrderStatus): Tone => STATUS_TONE[status];
export const statusLabel = (status: OrderStatus): string =>
  t(`admin.orders.status.${status}` as MessageKey);

export const paymentStatusLabel = (status: PaymentStatus): string =>
  t(`admin.payments.status.${status}` as MessageKey);
export const refundStatusLabel = (status: RefundStatus): string =>
  t(`admin.orders.refund.status.${status}` as MessageKey);

/**
 * Lo que la pantalla OFRECE según el estado (una pista de interfaz). Quien decide es la base: si otro administrador movió el
 * pedido mientras tanto, la función responde `stale` o `invalid_transition` y la pantalla lo cuenta.
 * Espejo de `_order_transition_ok` (admin) en la migración de S12.
 */
const FORWARD: Partial<Record<OrderStatus, OrderStatus>> = {
  pending_payment: "paid",
  paid: "preparing",
  preparing: "shipped",
  shipped: "delivered",
  delivered: "completed",
};
export const nextStatus = (status: OrderStatus): OrderStatus | null => FORWARD[status] ?? null;

/** Texto del botón de «avanzar con un clic» (lo que hará, no el estado al que llega). */
export const advanceLabelKey = (status: OrderStatus): MessageKey | null => {
  const next = nextStatus(status);
  return next ? (`admin.orders.advance.${status}` as MessageKey) : null;
};

export const canCancel = (status: OrderStatus): boolean =>
  ["pending_payment", "paid", "preparing", "shipped"].includes(status);
export const canEdit = (status: OrderStatus): boolean =>
  ["pending_payment", "paid", "preparing"].includes(status);
/** Entregado o completado: se devuelve con una devolución / reembolso (no se cancela). */
export const canReturn = (status: OrderStatus): boolean =>
  ["delivered", "completed"].includes(status);
export const canRefund = (status: OrderStatus): boolean =>
  ["paid", "preparing", "shipped", "delivered", "completed", "cancelled"].includes(status);

/** Los pasos del flujo normal que se pueden deshacer (los que no mueven stock, cupones ni dinero). */
export const canUndo = (status: OrderStatus): boolean =>
  ["preparing", "shipped", "delivered", "completed"].includes(status);

// ── Bandeja ──────────────────────────────────────────────────────────────────────────────
/**
 * Valor de `.or(...)` de PostgREST para buscar por número, nombre o teléfono. Los caracteres que PostgREST lee como sintaxis
 * (coma, paréntesis, comillas, `%`, `*`, barra) se quitan: una búsqueda nunca puede abrir otro filtro.
 */
export function searchFilter(term: string): string | null {
  const clean = term
    .normalize("NFC")
    .replace(/[,()"'\\%*:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  if (clean === "") return null;
  return `number.ilike.%${clean}%,contact_name.ilike.%${clean}%,contact_phone.ilike.%${clean}%`;
}

/** Bolivia no tiene horario de verano: UTC−4 todo el año. `to` es EXCLUSIVO (el día siguiente a las 00:00). */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export function dayStartIso(day: string): string | null {
  return DAY.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00-04:00`))
    ? `${day}T00:00:00-04:00`
    : null;
}
export function dayEndExclusiveIso(day: string): string | null {
  if (!DAY.test(day)) return null;
  const ms = Date.parse(`${day}T00:00:00-04:00`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + 24 * 60 * 60 * 1000).toISOString();
}

// ── Exportar ─────────────────────────────────────────────────────────────────────────────
/** Una celda segura para Excel: sin que un valor que empieza con = + - @ se ejecute como fórmula, y con las comillas escapadas. */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export function ordersToCsv(rows: readonly OrderRow[]): string {
  const header = [
    t("admin.orders.csv.number"),
    t("admin.orders.csv.date"),
    t("admin.orders.csv.status"),
    t("admin.orders.csv.client"),
    t("admin.orders.csv.phone"),
    t("admin.orders.csv.method"),
    t("admin.orders.csv.channel"),
    t("admin.orders.csv.total"),
    t("admin.orders.csv.currency"),
  ];
  const lines = rows.map((r) =>
    [
      r.number,
      r.createdAt,
      statusLabel(r.status),
      r.contactName,
      r.contactPhone,
      r.paymentMethod,
      t(`admin.orders.channel.${r.channel}` as MessageKey),
      r.total.toFixed(2),
      r.currency,
    ]
      .map(csvCell)
      .join(";"),
  );
  // BOM para que Excel lea las tildes; «;» porque en español la coma es el separador decimal.
  return `\uFEFF${[header.map(csvCell).join(";"), ...lines].join("\r\n")}\r\n`;
}

// ── Formularios ──────────────────────────────────────────────────────────────────────────
export type TextProblem = "required" | "too_long";
export function validateText(
  raw: string,
  max: number,
): { ok: true; value: string } | { ok: false; problem: TextProblem } {
  const value = raw.trim().replace(/\s+/g, " ");
  if (value === "") return { ok: false, problem: "required" };
  if (value.length > max) return { ok: false, problem: "too_long" };
  return { ok: true, value };
}

export type MoneyProblem = "format" | "decimals" | "too_large" | "not_positive";
/** Vacío = «no cambia» (null). Un importe estricto como la base: 2 decimales, sin separador de miles. */
export function parseOptionalMoney(
  raw: string,
  allowZero = false,
): { ok: true; value: number | null } | { ok: false; problem: MoneyProblem } {
  if (raw.trim() === "") return { ok: true, value: null };
  const parsed = parseAmount(raw, { decimals: 2, allowZero });
  if (!parsed.ok)
    return { ok: false, problem: parsed.problem === "empty" ? "format" : parsed.problem };
  return { ok: true, value: Number(parsed.value) };
}

/** Teléfono boliviano o internacional: se acepta con o sin «+», espacios y guiones; se devuelve E.164 o null. */
export function normalizePhone(raw: string, defaultCountryCode = "591"): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  const withPlus = digits.startsWith("+")
    ? digits
    : /^[67]\d{7}$/.test(digits)
      ? `+${defaultCountryCode}${digits}`
      : `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(withPlus) ? withPlus : null;
}

/** Llave de idempotencia de una acción de la pantalla: una por intento de la persona, no por clic. */
export const newKey = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;

/** Un código de error de la base → su texto (los desconocidos no se inventan: mensaje general). */
export function errorText(code: string | undefined): string {
  const key = `admin.orders.errors.${code ?? "unknown"}` as MessageKey;
  const text = t(key);
  return text === key ? t("admin.orders.errors.unknown") : text;
}
