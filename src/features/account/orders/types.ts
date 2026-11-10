import type { Money } from "@/lib/money";

/** Estados del pedido (BR-ORD-01). Las transiciones las gobierna el servidor (S10); aquí solo se muestran. */
export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "preparing",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
  "refunded",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Lo que necesita una fila de «Mis pedidos» (S10: se lee de la base; la RLS deja ver solo los propios). */
export interface OrderSummary {
  id: string;
  /** Número con prefijo y sin huecos (BR-ORD-04), p. ej. `MIC-000123`. */
  number: string;
  /** Instante en UTC (ISO 8601). */
  createdAt: string;
  status: OrderStatus;
  total: Money;
}

/** Una línea del pedido: instantánea (nombre, variante y precio) congelada al comprar (BR-ORD-06). */
export interface OrderLine {
  id: string;
  name: string;
  /** Color y talla, p. ej. «Negro · M». */
  variant: string | null;
  quantity: number;
  total: Money;
  /** Precio por unidad al comprar (antes de descuentos). */
  unitPrice?: Money;
}

/** Un paso del seguimiento: a qué estado pasó el pedido y cuándo (instante UTC, ISO 8601). */
export interface OrderTimelineEntry {
  status: string;
  at: string;
}

export interface OrderDetail extends OrderSummary {
  items: readonly OrderLine[];
  /** Método y dirección de envío ya listos para mostrar. */
  shipping: { label: string; address: string | null; schedule?: string | null } | null;
  payment: { label: string } | null;
  /** Desglose (S10). Opcionales: los pedidos de ejemplo de las pruebas antiguas no los traen. */
  subtotal?: Money;
  discount?: Money;
  shippingCost?: Money;
  couponCode?: string | null;
  contactName?: string;
  /** Seguimiento por estados, del más antiguo al más reciente. */
  timeline?: readonly OrderTimelineEntry[];
  /** La clienta aún puede cancelarlo (BR-ORD-02: hasta antes de «preparing»). */
  canCancel?: boolean;
}

/** Hasta qué estado la clienta puede cancelar por su cuenta (BR-ORD-02). */
export const CUSTOMER_CANCELABLE: readonly OrderStatus[] = ["pending_payment", "paid"];
