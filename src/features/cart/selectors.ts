import type { CartState } from "./cartStore";
import type { CartLine } from "./types";

/** Una línea tal como la ve la persona: con su cantidad pendiente ya aplicada (el servidor confirma después). */
export interface DisplayLine extends CartLine {
  /** Cantidad que se muestra (la pendiente si la hay, si no la del servidor). */
  shownQty: number;
  /** Hay un cambio en camino: los importes de la línea pueden cambiar cuando el servidor responda. */
  syncing: boolean;
}

/** Líneas visibles: las pendientes de quitar (cantidad 0) ya no se muestran; las demás llevan su cantidad pendiente. */
export function displayLines(state: CartState): DisplayLine[] {
  const lines = state.snapshot?.lines ?? [];
  const out: DisplayLine[] = [];
  for (const line of lines) {
    const pending = state.pending[line.variant_id];
    const shownQty = pending ?? line.qty;
    if (shownQty <= 0) continue;
    out.push({ ...line, shownQty, syncing: pending !== undefined });
  }
  return out;
}

/**
 * Número de la bolsa en la cabecera: lo del servidor con lo pendiente aplicado, y las altas pendientes de productos que
 * aún no están en la foto (se sumó algo nuevo y el servidor no ha respondido). Siempre un entero ≥ 0.
 */
export function displayCount(state: CartState): number {
  const known = new Set<string>();
  let total = 0;
  for (const line of state.snapshot?.lines ?? []) {
    known.add(line.variant_id);
    total += Math.max(0, state.pending[line.variant_id] ?? line.qty);
  }
  for (const [variantId, qty] of Object.entries(state.pending)) {
    if (!known.has(variantId)) total += Math.max(0, qty);
  }
  return total;
}

/** Líneas que impiden pagar (agotadas, sin stock suficiente, no disponibles o con subida de precio sin aceptar). */
export function blockingLines(state: CartState): DisplayLine[] {
  return displayLines(state).filter((line) => line.blocking);
}

/**
 * ¿Se puede ir a pagar? Lo decide el servidor (`can_checkout`), pero NUNCA mientras haya cambios sin confirmar: un
 * clic en «Pagar» con una cantidad todavía en camino podría cobrar otra cosa de la que se ve.
 */
export function canCheckout(state: CartState): boolean {
  return (
    state.snapshot?.can_checkout === true &&
    Object.keys(state.pending).length === 0 &&
    state.sync.state !== "offline"
  );
}

/** Milisegundos que faltan para que venza la retención, según la hora del SERVIDOR (no la del dispositivo). */
export function reservationRemainingMs(state: CartState, deviceNow: number): number | null {
  const expires = state.snapshot?.reservation.expires_at;
  if (!expires || state.snapshot?.reservation.state !== "held") return null;
  const target = Date.parse(expires);
  if (!Number.isFinite(target)) return null;
  return Math.max(0, target - (deviceNow + state.clockOffsetMs));
}
