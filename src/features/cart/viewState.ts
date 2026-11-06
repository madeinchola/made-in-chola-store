import type { CartState } from "./cartStore";
import { canCheckout, displayLines, reservationRemainingMs } from "./selectors";

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

/** Qué muestra la cuenta regresiva de la retención. */
export type ReservationView =
  | { kind: "none" }
  | { kind: "counting"; remainingMs: number }
  /** Venció y se está pidiendo (o está por pedirse) reservar de nuevo: estado NEUTRO, sin botón. */
  | { kind: "reserving" }
  /** Venció y reservar de nuevo ya se intentó sin éxito: «Ya no reservamos…» y «Reintentar reserva». */
  | { kind: "expired" };

/**
 * Decide qué se ve, SIN efectos (se calcula en el primer pintado). El problema que resuelve: al llegar a 0 el efecto que
 * pide reservar de nuevo corre DESPUÉS de pintar, y en ese hueco se veía un «Ya no reservamos tus productos» que
 * desaparecía si había stock. Regla: «Ya no reservamos…» solo cuando el servidor dijo `expired` (o, tras vencer el reloj,
 * `held` con hora pasada) Y el nuevo intento ya se hizo Y no está en vuelo. Mientras tanto —también en el primer pintado
 * tras llegar a 0, cuando aún no se ha pedido— es «reservando».
 *
 * `requestedKey`: el vencimiento (`expires_at`) para el que el componente ya pidió `reservationExpired()`.
 */
export function reservationView(
  state: CartState,
  deviceNow: number,
  requestedKey: string | null,
): ReservationView {
  const snapshot = state.snapshot;
  const reservation = snapshot?.reservation;
  if (
    !snapshot ||
    !reservation ||
    reservation.state === "none" ||
    snapshot.reserve_on_add === false
  ) {
    return { kind: "none" };
  }
  const remaining = reservationRemainingMs(state, deviceNow); // null salvo que esté `held`
  const lapsedByClock = remaining === 0;
  const lapsedByServer = reservation.state === "expired";
  if (!lapsedByClock && !lapsedByServer) return { kind: "counting", remainingMs: remaining ?? 0 };
  const requested = requestedKey === (reservation.expires_at ?? "none");
  if (state.reserving || (lapsedByClock && !requested)) return { kind: "reserving" };
  return { kind: "expired" };
}
