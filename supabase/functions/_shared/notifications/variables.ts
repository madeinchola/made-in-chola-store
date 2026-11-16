import type { OutboxRow, RowContext, SiteContext } from "./types.ts";

/**
 * Variables que se pueden usar en las plantillas (S13). El payload de la cola NO lleva datos personales (solo número, estado y total
 * del pedido); aquí se completan con lo que se consulta al enviar (nombre de la clienta, moneda, vencimiento del cobro).
 */

export interface VariableInfo {
  name: string;
  description: string;
  audience: "customer" | "admin" | "both";
}

export const VARIABLE_CATALOG: readonly VariableInfo[] = [
  { name: "store_name", description: "Nombre de la tienda", audience: "both" },
  {
    name: "customer_name",
    description: "Primer nombre de la clienta (vacío si no hay)",
    audience: "customer",
  },
  { name: "order_number", description: "Número del pedido, p. ej. MIC-000123", audience: "both" },
  { name: "order_total", description: "Total del pedido, p. ej. Bs 250,00", audience: "both" },
  {
    name: "order_url",
    description: "Enlace al pedido en la cuenta de la clienta (pide iniciar sesión)",
    audience: "customer",
  },
  {
    name: "payment_deadline",
    description: "Fecha y hora límite para pagar (hora de La Paz)",
    audience: "customer",
  },
  { name: "refund_amount", description: "Monto devuelto", audience: "customer" },
  {
    name: "reason",
    description: "Motivo escrito por la tienda (comprobante rechazado) o causa de la revisión",
    audience: "both",
  },
  { name: "admin_url", description: "Enlace al panel de administración", audience: "admin" },
  { name: "provider", description: "Proveedor de pagos", audience: "admin" },
  { name: "reference", description: "Referencia de pago recibida", audience: "admin" },
  { name: "product_name", description: "Nombre del producto (alerta de stock)", audience: "admin" },
  { name: "product_code", description: "Código del producto", audience: "admin" },
  { name: "variant", description: "Color y talla de la variante", audience: "admin" },
  { name: "stock", description: "Unidades que quedan", audience: "admin" },
  { name: "threshold", description: "Umbral de stock que se cruzó", audience: "admin" },
  {
    name: "light_label",
    description: "Nivel de stock: bajo, crítico o agotado",
    audience: "admin",
  },
  {
    name: "notification_type",
    description: "Tipo del aviso que no se pudo entregar",
    audience: "admin",
  },
  { name: "channel", description: "Canal del aviso (correo o WhatsApp)", audience: "admin" },
  { name: "error", description: "Último error al enviar", audience: "admin" },
  { name: "template_key", description: "Clave de la plantilla dañada", audience: "admin" },
] as const;

const REVIEW_REASONS: Record<string, string> = {
  late: "el pago llegó cuando el pedido ya estaba cancelado o vencido",
  duplicate: "pago duplicado",
  amount_mismatch: "el monto no coincide con el del pedido",
  amount: "el monto no coincide con el del pedido",
  disputed: "el cobro está en disputa",
  proof: "comprobante por revisar",
};

const LIGHT_LABELS: Record<string, string> = { low: "bajo", critical: "crítico", out: "agotado" };
const CHANNEL_LABELS: Record<string, string> = { email: "correo", whatsapp: "WhatsApp" };

const text = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

/** Primer nombre, sin dejar que un nombre larguísimo (o con basura) rompa el saludo. */
export function firstName(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  return Array.from(first).slice(0, 40).join("");
}

/** «Bs 1.234,50»: coma decimal y punto de miles, como en la tienda. Solo para MOSTRAR: el dinero nunca se calcula aquí. */
export function formatAmount(
  amount: unknown,
  currency: { symbol: string; decimals: number } | null | undefined,
  code?: unknown,
): string {
  if (amount === null || amount === undefined || amount === "") return "";
  const value = Number(amount);
  if (!Number.isFinite(value)) return "";
  const decimals = currency?.decimals ?? 2;
  const symbol = currency?.symbol ?? text(code);
  const [integer = "0", fraction] = Math.abs(value).toFixed(decimals).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${value < 0 ? "-" : ""}${symbol} ${grouped}${fraction ? `,${fraction}` : ""}`.trim();
}

/** Fecha y hora en La Paz (UTC−4, sin horario de verano): «15 nov 2026, 14:30». */
export function formatDateLaPaz(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("es-BO", {
    timeZone: "America/La_Paz",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")} ${get("month").replace(/\.$/, "")} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

/** Enlace del panel que corresponde a cada alerta interna. */
function adminPath(row: OutboxRow): string {
  if (row.type.startsWith("payment_") || row.type === "webhook_signature_invalid")
    return "/admin/pagos";
  if (row.type === "stock_alert") return "/admin/productos";
  if (row.type === "notification_dead" || row.type === "template_fallback")
    return "/admin/notificaciones";
  if (row.order_id) return `/admin/pedidos/${row.order_id}`;
  return "/admin";
}

export function buildVariables(
  row: OutboxRow,
  site: SiteContext,
  ctx: RowContext,
): Record<string, string> {
  const payload = row.payload;
  const base: Record<string, string> = {
    store_name: site.storeName,
    order_number: text(payload.number),
    order_total: formatAmount(payload.total, ctx.currency, payload.currency),
  };
  if (row.recipient !== null) {
    return {
      ...base,
      customer_name: firstName(ctx.customerName),
      order_url: row.order_id ? `${site.siteUrl}/cuenta/pedidos/${row.order_id}` : site.siteUrl,
      payment_deadline: formatDateLaPaz(ctx.paymentExpiresAt),
      refund_amount: formatAmount(payload.amount, ctx.currency, payload.currency),
      reason: text(payload.reason),
    };
  }
  const light = text(payload.light);
  const reason = text(payload.reason);
  return {
    ...base,
    admin_url: `${site.siteUrl}${adminPath(row)}`,
    reason: REVIEW_REASONS[reason] ?? reason,
    provider: text(payload.provider),
    reference: text(payload.reference),
    product_name: text(payload.product_name),
    product_code: text(payload.product_code),
    variant: [payload.color, payload.size].map(text).filter(Boolean).join(" / "),
    stock: text(payload.stock),
    threshold: text(light === "low" ? payload.low_threshold : payload.critical_threshold),
    light_label: LIGHT_LABELS[light] ?? light,
    notification_type: text(payload.notification_type),
    channel: CHANNEL_LABELS[text(payload.channel)] ?? text(payload.channel),
    error: text(payload.error),
    template_key: text(payload.template_key),
  };
}

/** Valores de ejemplo para la vista previa del panel (y el envío de prueba): se parecen a un caso real. */
export function sampleVariables(
  audience: "customer" | "admin",
  site: SiteContext,
): Record<string, string> {
  const common = {
    store_name: site.storeName,
    order_number: "MIC-000123",
    order_total: "Bs 250,00",
  };
  if (audience === "customer") {
    return {
      ...common,
      customer_name: "Ana",
      order_url: `${site.siteUrl}/cuenta/pedidos/00000000-0000-0000-0000-000000000000`,
      payment_deadline: "16 nov 2026, 10:00",
      refund_amount: "Bs 120,00",
      reason: "El monto del comprobante no coincide con el del pedido",
    };
  }
  return {
    ...common,
    admin_url: `${site.siteUrl}/admin`,
    reason: "el monto no coincide con el del pedido",
    provider: "qr_api",
    reference: "MIC-000123",
    product_name: "Chaqueta Japandi",
    product_code: "CHA-001",
    variant: "Arena / M",
    stock: "2",
    threshold: "2",
    light_label: "crítico",
    notification_type: "order_shipped",
    channel: "correo",
    error: "provider_down",
    template_key: "order_shipped",
  };
}
