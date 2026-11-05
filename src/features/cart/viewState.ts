import type { CartState } from "./cartStore";
import { canCheckout, displayLines } from "./selectors";

/**
 * Variantes que se acaban de agregar y que el servidor aún no ha confirmado: no están en la foto del carrito, así que
 * ninguna línea las muestra todavía. La pantalla pinta una fila «Agregando…» para que no parpadee el estado vacío.
 */
export function pendingAdds(state: CartState): string[] {
  const known = new Set((state.snapshot?.lines ?? []).map((line) => line.variant_id));
  return Object.entries(state.pending)
    .filter(([variantId, qty]) => qty > 0 && !known.has(variantId))
    .map(([variantId]) => variantId);
}

/**
 * La primera lectura de la bolsa NO llegó (sin red o error del servidor): no hay foto y nunca se «cargó». La pantalla no
 * debe decir «tu bolsa está vacía» (quien tiene productos los vería desaparecer) sino que no se pudo cargar.
 */
export function cartLoadFailed(state: CartState): boolean {
  return (
    !state.loaded &&
    state.snapshot === null &&
    (state.sync.state === "offline" || state.sync.state === "error")
  );
}

/** Por qué no se puede pagar (clave de `cart.checkout.reason.*`). */
export type CheckoutBlockReason =
  "loading" | "empty" | "offline" | "pending" | "prices" | "blocking" | "unknown";

/**
 * Null si se puede pagar (`canCheckout`); si no, la razón más útil para decirla en voz alta. Mismo orden en que la
 * persona puede resolverlas: sin conexión → cambios por confirmar → bolsa vacía → precios por aceptar → líneas con
 * problemas.
 */
export function checkoutBlockReason(state: CartState): CheckoutBlockReason | null {
  if (canCheckout(state)) return null;
  if (!state.loaded && !state.snapshot) return "loading";
  if (state.sync.state === "offline") return "offline";
  if (Object.keys(state.pending).length > 0) return "pending";
  const lines = displayLines(state);
  if (lines.length === 0) return "empty";
  const blocking = lines.filter((line) => line.blocking);
  if (blocking.length > 0) {
    return blocking.every((line) => line.price_notice === "expired_raised") ? "prices" : "blocking";
  }
  return "unknown";
}
