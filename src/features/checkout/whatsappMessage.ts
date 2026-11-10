import type { OrderRow } from "@/features/account/orders/ordersApi";
import { formatCartMoney } from "@/features/cart/format";
import { formatSlotDate, formatSlotRange } from "@/features/shipping/slotDates";
import { t } from "@/i18n";
import type { OrderItemSnapshot, OrderSnapshot } from "./types";

/** Lo que el mensaje necesita del pedido: nunca el teléfono, el correo ni los datos fiscales. */
export type WhatsAppOrder = Pick<
  OrderSnapshot,
  | "number"
  | "currency"
  | "subtotal"
  | "discount_total"
  | "shipping_cost"
  | "shipping_discount"
  | "total"
  | "contact_name"
  | "shipping_method"
  | "shipping_address"
  | "delivery_slot"
> & {
  items: Pick<
    OrderItemSnapshot,
    "product_name" | "color_name" | "size_label" | "qty" | "final_total"
  >[];
};

/**
 * Mensaje de WhatsApp del pedido (BR-CHK-02). Solo lleva lo NECESARIO para que la tienda lo reconozca y lo prepare: número,
 * productos, importes, entrega y a nombre de quién. NO lleva el teléfono (WhatsApp ya muestra de quién llega), ni el correo,
 * ni los datos fiscales.
 *
 * `wa.me` recibe el texto en la URL y los navegadores y aplicaciones cortan las URL muy largas: el enlace NUNCA pasa de
 * `WHATSAPP_URL_MAX` caracteres. Si el pedido es grande se recortan los productos («…y 12 más»); si aun así no cabe se manda
 * la versión mínima (número y total).
 */
export const WHATSAPP_URL_MAX = 1800;

const NAME_MAX = 80;
const ADDRESS_MAX = 140;

/**
 * Quita saltos de línea y caracteres de control del texto de una persona y lo acorta (cabe en una sola línea del mensaje).
 * Corta por PUNTOS DE CÓDIGO, no por unidades UTF-16: partir un emoji por la mitad deja un sustituto suelto y
 * `encodeURIComponent` lanzaría `URIError` (la pantalla de confirmación caería justo después de crear el pedido). Un sustituto
 * suelto que ya viniera en el texto también se vuelve un espacio.
 */
export function cleanLine(value: string | null | undefined, max: number): string {
  const flat = Array.from(value ?? "", (char) => {
    const code = char.charCodeAt(0);
    const loneSurrogate = char.length === 1 && code >= 0xd800 && code <= 0xdfff;
    // controles ASCII, DEL, los separadores de línea/párrafo de Unicode y sustitutos sueltos: todo se vuelve un espacio
    return code < 32 || code === 127 || code === 0x2028 || code === 0x2029 || loneSurrogate
      ? " "
      : char;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  const points = Array.from(flat);
  return points.length > max
    ? `${points
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`
    : flat;
}

/** «+59167528677» → «59167528677» (lo que pide `wa.me`). null si no es un número internacional plausible. */
export function whatsappDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^0-9]/g, "");
  return /^[1-9][0-9]{7,14}$/.test(digits) ? digits : null;
}

function addressLine(order: WhatsAppOrder): string {
  const a = order.shipping_address;
  if (!a) return "";
  const parts = [a.line1, a.line2, a.city]
    .map((p) => cleanLine(p ?? "", ADDRESS_MAX))
    .filter(Boolean);
  return cleanLine(parts.join(", "), ADDRESS_MAX);
}

function itemLine(item: WhatsAppOrder["items"][number], currency: string): string {
  const variant = [item.color_name, item.size_label].filter(Boolean).join(" · ");
  return t("checkout.whatsapp.item", {
    qty: item.qty,
    name: cleanLine(item.product_name, NAME_MAX),
    variant: variant ? t("checkout.whatsapp.variant", { variant: cleanLine(variant, 40) }) : "",
    total: formatCartMoney(item.final_total, currency),
  });
}

function build(order: WhatsAppOrder, itemCount: number): string {
  const currency = order.currency;
  const lines: string[] = [
    t("checkout.whatsapp.intro", { number: order.number }),
    "",
    t("checkout.whatsapp.items"),
  ];
  for (const item of order.items.slice(0, itemCount)) lines.push(itemLine(item, currency));
  const hidden = order.items.length - itemCount;
  if (hidden > 0) lines.push(t("checkout.whatsapp.more", { n: hidden }));
  lines.push("");
  lines.push(
    t("checkout.whatsapp.subtotal", { amount: formatCartMoney(order.subtotal, currency) }),
  );
  if (order.discount_total > 0) {
    lines.push(
      t("checkout.whatsapp.discount", { amount: formatCartMoney(order.discount_total, currency) }),
    );
  }
  const shippingNet = order.shipping_cost - order.shipping_discount;
  if (order.shipping_method.kind === "delivery") {
    lines.push(
      shippingNet > 0
        ? t("checkout.whatsapp.shipping", { amount: formatCartMoney(shippingNet, currency) })
        : t("checkout.whatsapp.shippingFree"),
    );
  }
  lines.push(t("checkout.whatsapp.total", { amount: formatCartMoney(order.total, currency) }));
  lines.push("");
  if (order.shipping_method.kind === "pickup") {
    lines.push(t("checkout.whatsapp.deliveryPickup"));
  } else {
    const address = addressLine(order);
    if (address) lines.push(t("checkout.whatsapp.deliveryHome", { address }));
  }
  const slot = order.delivery_slot;
  if (slot?.date) {
    lines.push(
      t("checkout.whatsapp.schedule", {
        date: formatSlotDate(slot.date),
        range: slot.start && slot.end ? formatSlotRange(slot.start, slot.end) : "",
      }).replace(/,\s*$/, ""),
    );
  }
  lines.push(t("checkout.whatsapp.name", { name: cleanLine(order.contact_name, NAME_MAX) }));
  return lines.join("\n");
}

const MINIMAL = (order: WhatsAppOrder) =>
  t("checkout.whatsapp.short", {
    number: order.number,
    amount: formatCartMoney(order.total, order.currency),
  });

function urlFor(digits: string, text: string): string {
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** El texto del mensaje que cabe en un enlace de `WHATSAPP_URL_MAX` (con el prefijo de `wa.me` incluido). */
export function buildWhatsAppMessage(
  order: WhatsAppOrder,
  maxUrl: number = WHATSAPP_URL_MAX,
): string {
  const room = maxUrl - "https://wa.me/".length - 16 - "?text=".length; // 15 dígitos como máximo + margen
  for (let count = order.items.length; count >= 1; count--) {
    const text = build(order, count);
    if (encodeURIComponent(text).length <= room) return text;
  }
  const minimal = MINIMAL(order);
  return encodeURIComponent(minimal).length <= room ? minimal : cleanLine(minimal, 200);
}

/**
 * El enlace `wa.me` listo para abrir, o null si la tienda no tiene un número de WhatsApp válido. Nunca pasa de `maxUrl`.
 */
export function buildWhatsAppUrl(
  phone: string | null | undefined,
  order: WhatsAppOrder,
  maxUrl: number = WHATSAPP_URL_MAX,
): string | null {
  const digits = whatsappDigits(phone);
  if (!digits) return null;
  return urlFor(digits, buildWhatsAppMessage(order, maxUrl));
}

/** Arma lo que el mensaje necesita a partir de la fila leída de «Mis pedidos» (la RLS ya garantiza que es de la clienta). */
export function whatsappOrderFromRow(row: OrderRow): WhatsAppOrder {
  const method = row.shipping_method;
  return {
    number: row.number,
    currency: row.currency,
    subtotal: row.subtotal,
    discount_total: row.discount_total,
    shipping_cost: row.shipping_cost,
    shipping_discount: row.shipping_discount,
    total: row.total,
    contact_name: row.contact_name,
    shipping_method: {
      code: method?.code ?? "",
      name: method?.name ?? "",
      kind: method?.kind === "pickup" ? "pickup" : "delivery",
    },
    shipping_address: row.shipping_address
      ? {
          line1: row.shipping_address.line1,
          line2: row.shipping_address.line2 ?? null,
          city: row.shipping_address.city,
        }
      : null,
    delivery_slot: row.delivery_slot?.date
      ? {
          date: row.delivery_slot.date,
          slot_id: null,
          start: row.delivery_slot.start ?? null,
          end: row.delivery_slot.end ?? null,
        }
      : null,
    items: [...(row.order_items ?? [])]
      .sort((a, b) => a.line_no - b.line_no)
      .map((item) => ({
        product_name: item.product_name,
        color_name: item.color_name,
        size_label: item.size_label,
        qty: item.qty,
        final_total: item.final_total,
      })),
  };
}
