import { createContext, useContext } from "react";
import type { CartState, CartStore } from "./cartStore";
import type { DisplayLine } from "./selectors";

export interface CartContextValue {
  store: CartStore;
  state: CartState;
  /** Líneas visibles, con las cantidades pendientes ya aplicadas. */
  lines: DisplayLine[];
  /** Número de la bolsa (entero ≥ 0). */
  count: number;
  /** Líneas que impiden pagar. */
  blocking: DisplayLine[];
  canCheckout: boolean;
  /** Mini-carrito (cajón) abierto o cerrado. */
  open: boolean;
  setOpen(open: boolean): void;
}

export const CartContext = createContext<CartContextValue | null>(null);

/** El carrito de la sesión actual. Lanza si falta `CartProvider`: es un error de montaje, no un caso a tolerar. */
export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart debe usarse dentro de <CartProvider>");
  return value;
}

/** Como `useCart`, pero devuelve null fuera del proveedor (cabecera en pruebas o en la guía de componentes). */
export function useOptionalCart(): CartContextValue | null {
  return useContext(CartContext);
}
