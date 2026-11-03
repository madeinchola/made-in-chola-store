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

/** Lo que necesita una fila de «Mis pedidos». El Sprint 10 la llenará desde la base; hoy solo hay datos de ejemplo en tests. */
export interface OrderSummary {
  id: string;
  /** Número con prefijo y sin huecos (BR-ORD-04), p. ej. `MIC-000123`. */
  number: string;
  /** Instante en UTC (ISO 8601). */
  createdAt: string;
  status: OrderStatus;
  total: Money;
}

/** PROVISIONAL: la forma real del detalle (instantánea del pedido, BR-ORD-06) se define en el Sprint 10. */
export interface OrderLine {
  id: string;
  name: string;
  /** Color y talla, p. ej. «Negro · M». */
  variant: string | null;
  quantity: number;
  total: Money;
}

export interface OrderDetail extends OrderSummary {
  items: readonly OrderLine[];
  /** Método y dirección de envío ya listos para mostrar. */
  shipping: { label: string; address: string | null } | null;
  payment: { label: string } | null;
}
