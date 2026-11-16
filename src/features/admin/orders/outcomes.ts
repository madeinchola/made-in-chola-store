import type { RpcResult } from "./types";

/**
 * El código que explica una respuesta de las funciones de administración: el `outcome` (p. ej. `stale`, `not_editable`) o el
 * primer error con código (p. ej. `reason_required`). Un `rejected` siempre trae su motivo concreto en `errors`, y ese manda.
 */
export function resultCode(result: RpcResult | null | undefined): string {
  if (!result) return "unknown";
  const first = result.errors?.[0]?.code;
  // Un rechazo (`outcome: "rejected"`) trae su motivo concreto en `errors`: ese es el que explica qué pasó.
  if (typeof first === "string" && first && (!result.outcome || result.outcome === "rejected"))
    return first;
  if (typeof result.outcome === "string" && result.outcome) return result.outcome;
  return "unknown";
}

/** ¿Salió bien? `ok: true` (avanzar/deshacer) o un `outcome` de éxito de la lista que cada acción conoce. */
export function succeeded(
  result: RpcResult | null | undefined,
  success: readonly string[],
): boolean {
  if (!result) return false;
  if (result.ok === true) return true;
  return typeof result.outcome === "string" && success.includes(result.outcome);
}

export const TRANSITION_OK = ["transitioned", "undone"] as const;
export const EDIT_OK = ["edited"] as const;
export const REFUND_OK = ["refunded", "requested", "cancelled_no_refund", "existing"] as const;
export const REFUND_ACTION_OK = ["processed", "rejected"] as const;
export const RETURN_OK = ["opened", "closed", "rejected"] as const;
export const COD_OK = ["collected", "rejected_delivery"] as const;
export const INCIDENT_OK = ["opened", "updated", "resolved"] as const;
export const BLACKLIST_OK = ["added", "lifted"] as const;
export const NOTE_OK = ["added"] as const;
export const MANUAL_OK = ["created", "existing"] as const;
