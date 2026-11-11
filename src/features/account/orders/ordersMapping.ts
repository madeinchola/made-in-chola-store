import { formatSlotDate, formatSlotRange } from "@/features/shipping/slotDates";
import { t, type MessageKey } from "@/i18n";
import { fromDecimal } from "@/lib/money";
import type { OrderRow } from "./ordersApi";
import {
  CUSTOMER_CANCELABLE,
  type OrderDetail,
  type OrderLine,
  type OrderStatus,
  type OrderSummary,
  type OrderTimelineEntry,
} from "./types";

/** Un importe que ya calculó el servidor, en la moneda del pedido. */
const amount = (value: number | string, currency: string) => fromDecimal(value, currency);

export function toSummary(
  row: Pick<OrderRow, "id" | "number" | "status" | "currency" | "total" | "created_at">,
): OrderSummary {
  return {
    id: row.id,
    number: row.number,
    createdAt: row.created_at,
    status: row.status as OrderStatus,
    total: amount(row.total, row.currency),
  };
}

/** «Negro · M»: color y talla que existan. */
export const variantLabel = (color: string | null, size: string | null): string | null =>
  [color, size].filter(Boolean).join(" · ") || null;

const PAYMENT_LABELS: Record<string, MessageKey> = {
  whatsapp: "acct.orders.paymentMethod.whatsapp",
  cash_on_delivery: "acct.orders.paymentMethod.cash_on_delivery",
  qr_manual: "acct.orders.paymentMethod.qr_manual",
  qr_auto: "acct.orders.paymentMethod.qr_auto",
};

/** Los métodos que NO se pagan con QR (se confirman por WhatsApp o al recibir). Cualquier otro lleva la pantalla de pago. */
const OFFLINE_METHODS: readonly string[] = ["whatsapp", "cash_on_delivery"];
export const isQrMethod = (code: string): boolean => !OFFLINE_METHODS.includes(code);

/** El nombre del método de pago para mostrar; un método que no se conoce se muestra con su código (no se inventa uno). */
export function paymentLabel(code: string): string {
  const key = PAYMENT_LABELS[code];
  return key ? t(key) : code;
}

function addressLabel(address: OrderRow["shipping_address"]): string | null {
  if (!address) return null;
  const parts = [address.line1, address.line2, address.city, address.department].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function scheduleLabel(slot: OrderRow["delivery_slot"]): string | null {
  if (!slot?.date) return null;
  const date = formatSlotDate(slot.date);
  return slot.start && slot.end
    ? t("acct.orders.detail.scheduled", { date, range: formatSlotRange(slot.start, slot.end) })
    : date;
}

export function toTimeline(row: Pick<OrderRow, "order_status_history">): OrderTimelineEntry[] {
  return [...(row.order_status_history ?? [])]
    .sort((a, b) => a.id - b.id)
    .map((entry) => ({ status: entry.to_status, at: entry.created_at }));
}

export function toDetail(row: OrderRow): OrderDetail {
  const items: OrderLine[] = [...(row.order_items ?? [])]
    .sort((a, b) => a.line_no - b.line_no)
    .map((item) => ({
      id: item.id,
      name: item.product_name,
      variant: variantLabel(item.color_name, item.size_label),
      quantity: item.qty,
      total: amount(item.final_total, row.currency),
      unitPrice: amount(item.unit_price, row.currency),
    }));
  const method = row.shipping_method;
  return {
    ...toSummary(row),
    items,
    shipping: method?.name
      ? {
          label: method.name,
          address: addressLabel(row.shipping_address),
          schedule: scheduleLabel(row.delivery_slot),
        }
      : null,
    payment: { label: paymentLabel(row.payment_method), method: row.payment_method },
    subtotal: amount(row.subtotal, row.currency),
    discount: amount(row.discount_total, row.currency),
    // Lo que cuesta de verdad el envío: el costo menos el descuento de envío (envío gratis = 0).
    shippingCost: amount(
      Math.round((row.shipping_cost - row.shipping_discount) * 10000) / 10000,
      row.currency,
    ),
    couponCode: row.coupon_code,
    contactName: row.contact_name,
    timeline: toTimeline(row),
    canCancel: (CUSTOMER_CANCELABLE as readonly string[]).includes(row.status),
  };
}
