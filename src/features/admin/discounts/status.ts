import type { Discount, DiscountStatus, DiscountUsage } from "./types";

/**
 * Estado de un descuento HOY, con las mismas reglas que el motor del servidor (`_discount_evaluate`): se aplica si no está
 * archivado, está activo, no agotó su tope total de usos, ya empezó (`starts_at <= ahora`: el inicio es INCLUSIVO) y no
 * terminó (`ahora < ends_at`: el fin es EXCLUSIVO).
 *
 * Precedencia (la primera que se cumple): archivado, inactivo, agotado, programado, vencido, activo. `usage` es la fila de
 * `discount_usage` de ese descuento; si no hay fila (nadie lo usó, o no se pudo leer) cuenta como 0 usos.
 */
export function discountStatus(
  discount: Pick<Discount, "archived" | "isActive" | "startsAt" | "endsAt" | "usageLimitTotal">,
  usage: Pick<DiscountUsage, "used"> | null | undefined,
  now: Date,
): DiscountStatus {
  if (discount.archived) return "archived";
  if (!discount.isActive) return "inactive";
  if (discount.usageLimitTotal !== null && (usage?.used ?? 0) >= discount.usageLimitTotal) {
    return "exhausted";
  }
  const instant = now.getTime();
  if (discount.startsAt !== null && new Date(discount.startsAt).getTime() > instant) {
    return "scheduled";
  }
  if (discount.endsAt !== null && new Date(discount.endsAt).getTime() <= instant) {
    return "expired";
  }
  return "active";
}

/** Orden del listado: lo que funciona primero y lo archivado al final. */
export const STATUS_ORDER: readonly DiscountStatus[] = [
  "active",
  "scheduled",
  "exhausted",
  "inactive",
  "expired",
  "archived",
];

/**
 * Ordena el listado: por estado (activos primero, archivados al final) y, a igual estado, mayor prioridad primero. Es
 * estable: a igualdad total se conserva el orden recibido (el más nuevo primero, como los entrega la base).
 */
export function sortDiscounts<T extends Pick<Discount, "priority">>(
  items: readonly T[],
  statusOf: (item: T) => DiscountStatus,
): T[] {
  return items
    .map((item, index) => ({ item, index, rank: STATUS_ORDER.indexOf(statusOf(item)) }))
    .sort((a, b) => a.rank - b.rank || b.item.priority - a.item.priority || a.index - b.index)
    .map((entry) => entry.item);
}
