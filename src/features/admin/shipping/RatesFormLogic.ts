import { BASE_CURRENCY } from "@/lib/currencies";
import { fromLaPazInputValue, toLaPazInputValue } from "@/lib/datetime";
import { btrimSpaces, charLength } from "../config/pgText";
import {
  draftFromParams,
  emptyDraft,
  MAX_COST,
  parseNumber,
  validateDistanceDraft,
  type DistanceDraft,
  type DistanceDraftErrors,
  type NumberProblem,
} from "./tierLogic";
import type { RateKind, RateParams, RateRule, RateUpdateInput } from "./types";

/** Límites de la base (`shipping_rate_rules`): nombre 1–80, prioridad 0–100000, montos de pedido `numeric(14,4)`. */
export const MAX_RATE_NAME = 80;
export const DEFAULT_PRIORITY = 100;
export const MIN_PRIORITY = 0;
export const MAX_PRIORITY = 100000;
export const MAX_ORDER_AMOUNT = 9_999_999_999.99;

export interface RateFormValues {
  name: string;
  kind: RateKind;
  draft: DistanceDraft;
  flatCost: string;
  /** "" = cualquier zona cubierta. */
  zoneId: string;
  minOrder: string;
  maxOrder: string;
  /** Valor de `datetime-local` en hora de La Paz ("" = sin fecha). */
  validFrom: string;
  validUntil: string;
  priority: string;
  isActive: boolean;
}

const numberText = (n: number | null): string => (n === null ? "" : String(n));

/** Valores iniciales: los de la regla al editar, o los por defecto al crear. */
export function initialRateValues(rule: RateRule | null): RateFormValues {
  const params = rule?.params ?? null;
  return {
    name: rule?.name ?? "",
    kind: rule?.kind ?? "distance",
    // Una regla con parámetros ilegibles (`params === null`) arranca vacía: hay que volver a ingresarlos.
    draft: params?.kind === "distance" ? draftFromParams(params) : emptyDraft(),
    flatCost: params?.kind === "flat" ? String(params.cost) : "",
    zoneId: rule?.zoneId ?? "",
    minOrder: numberText(rule?.minOrderAmount ?? null),
    maxOrder: numberText(rule?.maxOrderAmount ?? null),
    validFrom: toLaPazInputValue(rule?.validFrom),
    validUntil: toLaPazInputValue(rule?.validUntil),
    priority: rule ? String(rule.priority) : String(DEFAULT_PRIORITY),
    isActive: rule?.isActive ?? true,
  };
}

export type AmountProblem = "number" | "negative" | "too_big" | "decimals";
export type PriorityProblem = "required" | "number" | "integer" | "range";

export interface RateErrors {
  name?: "required" | "too_long";
  /** Costo de la tarifa fija. */
  flatCost?: NumberProblem;
  /** Los problemas del editor de tramos (solo cuando la tarifa es por distancia). */
  distance?: DistanceDraftErrors;
  minOrder?: AmountProblem;
  maxOrder?: AmountProblem;
  orderRange?: "min_gt_max";
  validFrom?: "invalid";
  validUntil?: "invalid" | "before_from";
  priority?: PriorityProblem;
}
export type RateValidation =
  { ok: true; payload: RateUpdateInput } | { ok: false; errors: RateErrors };

/** Monto opcional del pedido: vacío = sin límite; si no, un número de 0 a menos de 10 000 000 000. */
function parseOptionalAmount(
  text: string,
): { ok: true; value: number | null } | { ok: false; problem: AmountProblem } {
  if (text.trim() === "") return { ok: true, value: null };
  const n = parseNumber(text);
  if (n === null) return { ok: false, problem: "number" };
  if (n < 0) return { ok: false, problem: "negative" };
  if (n > MAX_ORDER_AMOUNT) return { ok: false, problem: "too_big" };
  // Un monto es dinero: 2 decimales como máximo. La base guarda `numeric(14,4)` y REDONDEARÍA en silencio «99,99999» a 100,
  // con lo que el límite inclusivo de la regla se movería sin que nadie lo notara.
  if (Math.round(n * 100) / 100 !== n) return { ok: false, problem: "decimals" };
  return { ok: true, value: n };
}

/** Costo de la tarifa fija: número de 0 a menos de 1 000 000 (0 = envío gratis). */
export function parseFlatCost(
  text: string,
): { ok: true; value: number } | { ok: false; problem: NumberProblem } {
  if (text.trim() === "") return { ok: false, problem: "required" };
  const n = parseNumber(text);
  if (n === null) return { ok: false, problem: "number" };
  if (n < 0) return { ok: false, problem: "negative" };
  if (n > MAX_COST) return { ok: false, problem: "too_big" };
  return { ok: true, value: n };
}

/** Prioridad: entero de 0 a 100000. */
export function parsePriority(
  text: string,
): { ok: true; value: number } | { ok: false; problem: PriorityProblem } {
  if (text.trim() === "") return { ok: false, problem: "required" };
  const n = parseNumber(text);
  if (n === null) return { ok: false, problem: "number" };
  if (!Number.isInteger(n)) return { ok: false, problem: "integer" };
  if (n < MIN_PRIORITY || n > MAX_PRIORITY) return { ok: false, problem: "range" };
  return { ok: true, value: n };
}

/** Fecha opcional de `datetime-local` → instante ISO; null si está vacía; "invalid" si no se puede leer. */
function parseInstant(text: string): { ok: true; value: string | null } | { ok: false } {
  try {
    return { ok: true, value: fromLaPazInputValue(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Valida el formulario y, si todo está bien, arma lo que se envía (la forma exacta de `RateUpdateInput`; al crear se le
 * suman el método y la moneda). Una tarifa por distancia solo se envía si el editor de tramos da `params`.
 */
export function validateRate(values: RateFormValues): RateValidation {
  const errors: RateErrors = {};

  const name = btrimSpaces(values.name);
  if (name === "") errors.name = "required";
  else if (charLength(name) > MAX_RATE_NAME) errors.name = "too_long";

  let params: RateParams | null = null;
  if (values.kind === "flat") {
    const cost = parseFlatCost(values.flatCost);
    if (cost.ok) params = { kind: "flat", cost: cost.value };
    else errors.flatCost = cost.problem;
  } else {
    const distance = validateDistanceDraft(values.draft);
    if (distance.params) params = distance.params;
    else errors.distance = distance.errors;
  }

  const min = parseOptionalAmount(values.minOrder);
  const max = parseOptionalAmount(values.maxOrder);
  if (!min.ok) errors.minOrder = min.problem;
  if (!max.ok) errors.maxOrder = max.problem;
  if (min.ok && max.ok && min.value !== null && max.value !== null && min.value > max.value) {
    errors.orderRange = "min_gt_max";
  }

  const from = parseInstant(values.validFrom);
  const until = parseInstant(values.validUntil);
  if (!from.ok) errors.validFrom = "invalid";
  if (!until.ok) errors.validUntil = "invalid";
  if (
    from.ok &&
    until.ok &&
    from.value !== null &&
    until.value !== null &&
    new Date(until.value).getTime() <= new Date(from.value).getTime()
  ) {
    errors.validUntil = "before_from";
  }

  const priority = parsePriority(values.priority);
  if (!priority.ok) errors.priority = priority.problem;

  if (
    Object.keys(errors).length > 0 ||
    !params ||
    !min.ok ||
    !max.ok ||
    !from.ok ||
    !until.ok ||
    !priority.ok
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    payload: {
      zoneId: values.zoneId === "" ? null : values.zoneId,
      name,
      params,
      minOrderAmount: min.value,
      maxOrderAmount: max.value,
      priority: priority.value,
      isActive: values.isActive,
      validFrom: from.value,
      validUntil: until.value,
    },
  };
}

/** Monedas que se ofrecen al crear una regla: las habilitadas; si no hay datos, solo la base. */
export function currencyChoices(enabled: readonly string[] | undefined): string[] {
  const codes = (enabled ?? []).filter((code, i, all) => all.indexOf(code) === i);
  return codes.length > 0 ? codes : [BASE_CURRENCY];
}

/** La moneda con que se abre el formulario al crear: la base (BOB) si está entre las ofrecidas; si no, la primera. */
export const defaultCurrency = (choices: readonly string[]): string =>
  choices.includes(BASE_CURRENCY) ? BASE_CURRENCY : (choices[0] ?? BASE_CURRENCY);
