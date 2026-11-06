import type { RateParams, RateTier } from "./types";

/**
 * Lógica pura del editor de tramos de distancia. Refleja las reglas de la base (`_ship_params_valid`): la base es quien manda
 * y rechaza lo inválido, pero aquí se explica CADA problema junto al campo antes de enviar.
 */
export const MAX_TIERS = 20;
export const MAX_KM = 20000;
/** Los costos son menores que 1 000 000 (la base lo exige). */
export const MAX_COST = 999_999.9999;

export interface TierDraft {
  upTo: string;
  cost: string;
}
export interface DistanceDraft {
  tiers: TierDraft[];
  extraPerKm: string;
  minCost: string;
  maxCost: string;
}

export type NumberProblem = "required" | "number" | "negative" | "zero" | "too_big";
export type TierProblem = NumberProblem | "order";
export interface TierRowErrors {
  upTo?: TierProblem;
  cost?: NumberProblem;
}
export interface DistanceDraftErrors {
  /** Un objeto por fila (en el mismo orden), `{}` si la fila está bien. */
  rows: TierRowErrors[];
  /** Problema de la lista entera: ningún tramo o demasiados. */
  list?: "no_tiers" | "too_many";
  extraPerKm?: NumberProblem;
  minCost?: NumberProblem;
  maxCost?: NumberProblem;
  /** El mínimo es mayor que el máximo. */
  range?: "min_gt_max";
}
export interface DistanceValidation {
  /** null mientras haya algún problema. */
  params: Extract<RateParams, { kind: "distance" }> | null;
  errors: DistanceDraftErrors;
}

/**
 * Número como lo escribe una persona en español: «3», «3,5», «3.5», con espacios alrededor. Rechaza vacío, letras, notación
 * científica («1e3»), varios separadores («3,5,2»), el signo «+» y números infinitos. Un «-» inicial SÍ se lee (para decir luego
 * que es negativo, no que no es un número).
 */
export function parseNumber(text: string): number | null {
  const t = text.trim();
  if (!/^-?\d+([.,]\d+)?$|^-?[.,]\d+$/.test(t)) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function numberProblem(
  text: string,
  opts: { allowZero: boolean; max: number },
): NumberProblem | null {
  if (text.trim() === "") return "required";
  const n = parseNumber(text);
  if (n === null) return "number";
  if (n < 0) return "negative";
  if (n === 0 && !opts.allowZero) return "zero";
  if (n > opts.max) return "too_big";
  return null;
}

/** Valida el borrador y, si todo está bien, devuelve los parámetros listos para guardar. */
export function validateDistanceDraft(draft: DistanceDraft): DistanceValidation {
  const errors: DistanceDraftErrors = { rows: [] };
  let valid = true;

  if (draft.tiers.length === 0) {
    errors.list = "no_tiers";
    valid = false;
  } else if (draft.tiers.length > MAX_TIERS) {
    errors.list = "too_many";
    valid = false;
  }

  const tiers: RateTier[] = [];
  let previous = 0;
  for (const row of draft.tiers) {
    const rowErrors: TierRowErrors = {};
    const up = numberProblem(row.upTo, { allowZero: false, max: MAX_KM });
    if (up) rowErrors.upTo = up;
    const cost = numberProblem(row.cost, { allowZero: true, max: MAX_COST });
    if (cost) rowErrors.cost = cost;
    if (!up) {
      const upTo = parseNumber(row.upTo) as number;
      // Cada «hasta» debe ser MAYOR que el anterior (igual tampoco vale: sería un tramo vacío).
      if (upTo <= previous) rowErrors.upTo = "order";
      else previous = upTo;
    }
    if (rowErrors.upTo || rowErrors.cost) valid = false;
    else
      tiers.push({
        upToKm: parseNumber(row.upTo) as number,
        cost: parseNumber(row.cost) as number,
      });
    errors.rows.push(rowErrors);
  }

  const optional = (text: string, key: "extraPerKm" | "minCost" | "maxCost"): number | null => {
    if (text.trim() === "") return null;
    const problem = numberProblem(text, { allowZero: true, max: MAX_COST });
    if (problem) {
      errors[key] = problem;
      valid = false;
      return null;
    }
    return parseNumber(text);
  };
  const extra = optional(draft.extraPerKm, "extraPerKm");
  const min = optional(draft.minCost, "minCost");
  const max = optional(draft.maxCost, "maxCost");
  if (min !== null && max !== null && min > max) {
    errors.range = "min_gt_max";
    valid = false;
  }

  if (!valid) return { params: null, errors };
  return {
    params: { kind: "distance", tiers, extraPerKm: extra, minCost: min, maxCost: max },
    errors,
  };
}

const text = (n: number | null): string => (n === null ? "" : String(n));

/** Borrador (textos) a partir de los parámetros guardados. */
export function draftFromParams(params: Extract<RateParams, { kind: "distance" }>): DistanceDraft {
  return {
    tiers: params.tiers.map((t) => ({ upTo: String(t.upToKm), cost: String(t.cost) })),
    extraPerKm: text(params.extraPerKm),
    minCost: text(params.minCost),
    maxCost: text(params.maxCost),
  };
}

export const emptyDraft = (): DistanceDraft => ({
  tiers: [{ upTo: "", cost: "" }],
  extraPerKm: "",
  minCost: "",
  maxCost: "",
});

export interface TierSpan {
  /** Desde (exclusivo salvo el primero, que arranca en 0). */
  fromKm: number;
  /** Hasta (INCLUSIVO). */
  toKm: number;
  cost: number;
}

/** Los tramos como intervalos legibles: 0–3, 3–6, 6–10 (cada uno incluye su extremo superior). */
export function tierSpans(tiers: readonly RateTier[]): TierSpan[] {
  let from = 0;
  return tiers.map((t) => {
    const span = { fromKm: from, toKm: t.upToKm, cost: t.cost };
    from = t.upToKm;
    return span;
  });
}
