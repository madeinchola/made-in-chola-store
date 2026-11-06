/* Utilidades SOLO de pruebas del envío: arman respuestas de `quote_shipping` con valores escritos a mano. */
import type { QuoteResult } from "./types";

const EMPTY_BREAKDOWN = {
  rule: null,
  straightKm: null,
  routeKm: null,
  routeFactor: null,
  tier: null,
  extraKm: null,
  minApplied: false,
  maxApplied: false,
  pickup: false,
};

/** Respuesta del servidor (de PRUEBA): valores armados a mano. */
export function quoteResult(extra: Partial<QuoteResult> = {}): QuoteResult {
  return {
    ok: true,
    cost: 15,
    currency: "BOB",
    method: {
      code: "delivery",
      name: "Entrega a domicilio",
      kind: "delivery",
      description: null,
      etaMinDays: 1,
      etaMaxDays: 2,
    },
    distanceKm: 5,
    breakdown: EMPTY_BREAKDOWN,
    slots: [],
    selected: null,
    pickup: null,
    errors: [],
    ...extra,
  };
}

/** Una respuesta con error (`ok` falso, sin costo). */
export const rejectedQuote = (
  code: QuoteResult["errors"][number]["code"],
  field: QuoteResult["errors"][number]["field"] = "location",
): QuoteResult => quoteResult({ ok: false, cost: null, errors: [{ code, field }] });
