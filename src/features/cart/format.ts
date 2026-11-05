import { storeRoutes } from "@/components/layout/storeRoutes";
import { colorSlug } from "@/features/storefront/product/variantSelection";
import { formatMoney, fromDecimal } from "@/lib/money";
import type { CartLimits, CartLine } from "./types";

/**
 * Da formato a un importe que YA calculó el servidor (decimal en unidades mayores: `560` o `560.5`). Aquí no se suma,
 * no se redondea ni se convierte nada: solo se escribe «Bs 560,50». Si el valor no es un número válido o la moneda es
 * desconocida, devuelve el valor tal cual antes que romper la pantalla.
 */
export function formatCartMoney(value: number, currency: string): string {
  try {
    return formatMoney(fromDecimal(value, currency));
  } catch {
    return `${currency} ${String(value)}`;
  }
}

/** `mm:ss` de una cuenta regresiva. Redondea hacia ARRIBA: «00:00» solo cuando de verdad ya no queda nada. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Tope del stepper de una línea: lo menor entre el máximo por producto y lo que hay disponible. Nunca negativo. */
export function maxQtyFor(line: Pick<CartLine, "available">, limits: CartLimits): number {
  return Math.max(0, Math.min(limits.max_qty_per_variant, line.available));
}

/** ¿Qué limita la cantidad? `stock` si hay menos unidades que el máximo por producto; si no, el máximo por producto. */
export function limitReason(
  line: Pick<CartLine, "available">,
  limits: CartLimits,
): "stock" | "variant" {
  return line.available < limits.max_qty_per_variant ? "stock" : "variant";
}

/** Enlace a la ficha de la variante: su color va en `?color=` (la ficha lo valida; un valor desconocido se ignora). */
export function productHref(line: Pick<CartLine, "slug" | "color_name">): string {
  const path = storeRoutes.product(line.slug);
  const color = line.color_name ? colorSlug(line.color_name) : "";
  return color === "" ? path : `${path}?color=${color}`;
}
