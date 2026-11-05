import { useOptionalCart } from "@/features/cart/cart-context";

/**
 * Cantidad de productos en la bolsa (con lo pendiente ya aplicado). Fuera de `CartProvider` (pruebas de la cabecera,
 * guía de componentes) es 0.
 */
export function useCartCount(): number {
  return useOptionalCart()?.count ?? 0;
}
