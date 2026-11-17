import type { OrderDetail } from "../../orders/types";

export type PrintDoc = "label" | "dispatch" | "packing";
export type PrintFormat = "a4" | "letter" | "label";

export const PRINT_DOCS: readonly PrintDoc[] = ["label", "dispatch", "packing"];
export const PRINT_FORMATS: readonly PrintFormat[] = ["a4", "letter", "label"];
/** Cuántos pedidos caben en una impresión (el enlace lleva los números en la dirección y cada pedido se lee de la base). */
export const MAX_PRINT_ORDERS = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Los pedidos de la dirección (`?ids=a,b,c`): solo identificadores válidos, sin repetir y hasta el tope. */
export function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const id = part.trim().toLowerCase();
    if (UUID.test(id)) seen.add(id);
  }
  return [...seen].slice(0, MAX_PRINT_ORDERS);
}

export const isPrintDoc = (v: string | null): v is PrintDoc =>
  v !== null && (PRINT_DOCS as readonly string[]).includes(v);
export const isPrintFormat = (v: string | null): v is PrintFormat =>
  v !== null && (PRINT_FORMATS as readonly string[]).includes(v);

/**
 * El tamaño de página de la impresión. La etiqueta es de 10 × 15 cm (la medida más común de las impresoras de etiquetas térmicas);
 * la guía de despacho va a lo ancho porque es una tabla de varias columnas.
 */
export function pageCss(format: PrintFormat, doc: PrintDoc): string {
  const margin = format === "label" ? "4mm" : "12mm";
  const size =
    format === "label"
      ? "100mm 150mm"
      : `${format === "a4" ? "A4" : "letter"}${doc === "dispatch" ? " landscape" : ""}`;
  return `@page { size: ${size}; margin: ${margin}; }`;
}

/** El tamaño de letra de la etiqueta según cuánto texto lleva la dirección: una dirección larga se achica antes que salirse de la hoja. */
export function labelFontPt(addressLength: number, format: PrintFormat): number {
  const base = format === "label" ? 12 : 16;
  if (addressLength > 260) return base - 4;
  if (addressLength > 160) return base - 2;
  return base;
}

/** La dirección en líneas (sin vacíos). */
export function addressLines(order: OrderDetail): string[] {
  const a = order.address;
  if (!a) return [];
  return [
    a.line1,
    a.line2 ?? "",
    [a.city, a.department ?? ""].filter((x) => x !== "").join(", "),
    a.reference ? `Ref.: ${a.reference}` : "",
  ].filter((line) => line.trim() !== "");
}

/** La franja de entrega en una frase («2026-11-20, 10:00–12:00»), o vacío si no hay. */
export function slotText(order: OrderDetail): string {
  const s = order.slot;
  if (!s || !s.date) return "";
  const hours = s.start ? ` ${s.start.slice(0, 5)}${s.end ? `–${s.end.slice(0, 5)}` : ""}` : "";
  return `${s.date}${hours ? `,${hours}` : ""}`;
}

/** Lo que el repartidor tiene que cobrar al entregar (solo contra entrega y mientras no se haya entregado). */
export function amountToCollect(order: OrderDetail): number | null {
  if (order.paymentMethod !== "cash_on_delivery") return null;
  if (
    order.status === "delivered" ||
    order.status === "completed" ||
    order.status === "cancelled" ||
    order.status === "refunded"
  )
    return null;
  return order.total;
}

/** El orden de la ruta: por día y hora de la franja (lo que no tiene franja, al final) y luego por número de pedido. */
export function sortForDispatch(orders: readonly OrderDetail[]): OrderDetail[] {
  const key = (o: OrderDetail) => `${o.slot?.date ?? "9999-99-99"} ${o.slot?.start ?? "99:99"}`;
  return [...orders].sort(
    (a, b) => key(a).localeCompare(key(b)) || a.number.localeCompare(b.number),
  );
}

export const unitsOf = (order: OrderDetail): number =>
  order.items.reduce((sum, i) => sum + i.qty, 0);

/** Un pedido de recojo no se envía: no lleva etiqueta de envío. */
export const needsShippingLabel = (order: OrderDetail): boolean => order.shippingKind !== "pickup";
