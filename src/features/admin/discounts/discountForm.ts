import { t, type MessageKey } from "@/i18n";
import { fromLaPazInputValue, toLaPazInputValue } from "@/lib/datetime";
import { btrimSpaces, charLength } from "../config/pgText";
import {
  DEFAULT_PRIORITY,
  MAX_ORDER_AMOUNT,
  MAX_PRIORITY,
  MIN_PRIORITY,
} from "../shipping/RatesFormLogic";
import { parseNumber } from "../shipping/tierLogic";
import type { Describable } from "./describe";
import type {
  Discount,
  DiscountInput,
  DiscountKind,
  DiscountParams,
  DiscountScope,
  DiscountUpdateInput,
} from "./types";

/**
 * Lógica pura del asistente de Descuentos: del texto que escribe la persona a `DiscountInput`, con cada problema explicado
 * junto a su campo. Refleja las restricciones de la tabla `discounts` y de `_discount_params_valid` (la base es quien manda y
 * rechaza lo inválido, pero aquí se avisa antes de enviar, y NUNCA se redondea en silencio: la base guarda `numeric(14,4)`).
 */

// ── Límites de la base ──────────────────────────────────────────────────────────────────────
export const MAX_NAME = 80;
export const MAX_TIERS = 10;
export const TAKE_MIN = 2;
export const TAKE_MAX = 20;
export const MAX_TIER_QTY = 10_000;
/** El monto fijo y el tope deben ser menores que 1.000.000.000 (con 2 decimales: 999.999.999,99). */
export const MAX_AMOUNT = 999_999_999.99;
export const MAX_LIMIT = 2_147_483_647;

// ── Reglas por tipo ─────────────────────────────────────────────────────────────────────────
export const PERCENT_KINDS = ["percent", "flash", "group_price", "first_purchase"] as const;
export type PercentKind = (typeof PERCENT_KINDS)[number];
export const isPercentKind = (kind: DiscountKind): kind is PercentKind =>
  (PERCENT_KINDS as readonly string[]).includes(kind);

/** ¿Pide código? «always»: siempre (porcentaje y monto fijo); «never»: nunca (2×1, volumen, grupo y flash); «choice»: a elección. */
export type CouponMode = "always" | "never" | "choice";
export function couponMode(kind: DiscountKind): CouponMode {
  switch (kind) {
    case "percent":
    case "fixed":
      return "always";
    case "bogo":
    case "volume":
    case "group_price":
    case "flash":
      return "never";
    case "free_shipping":
    case "first_purchase":
      return "choice";
  }
}

/** Alcances que admite cada tipo: el envío gratis solo vale para todo el pedido y el 2×1 necesita productos, categorías o colecciones. */
export function allowedScopes(kind: DiscountKind): readonly DiscountScope[] {
  if (kind === "free_shipping") return ["order"];
  if (kind === "bogo") return ["product", "category", "collection"];
  return ["order", "product", "category", "collection"];
}

/** ¿Tienen sentido «se suma a las ofertas» y «no aplicar a rebajados»? Solo en un cupón que descuenta producto. */
export const flagsApply = (kind: DiscountKind, requiresCoupon: boolean): boolean =>
  requiresCoupon && kind !== "free_shipping";

// ── Valores del formulario ──────────────────────────────────────────────────────────────────
/** Un producto, categoría o colección elegidos (`label` es lo que se muestra). */
export interface PickedTarget {
  id: string;
  label: string;
}
export interface TierDraft {
  minQty: string;
  percent: string;
}
export interface DiscountFormValues {
  name: string;
  kind: DiscountKind;
  scope: DiscountScope;
  currency: string;
  /** Solo cuenta en el envío gratis y la primera compra; los demás tipos lo deciden solos. */
  requiresCoupon: boolean;
  percent: string;
  maxAmount: string;
  amount: string;
  take: string;
  pay: string;
  tiers: TierDraft[];
  /** "" = ninguno. */
  customerGroupId: string;
  targets: PickedTarget[];
  minOrder: string;
  /** Valor de `datetime-local` en hora de La Paz ("" = sin fecha). */
  startsAt: string;
  endsAt: string;
  usageLimitTotal: string;
  usageLimitPerCustomer: string;
  priority: string;
  stackable: boolean;
  excludeSale: boolean;
  isActive: boolean;
}

export const emptyTier = (): TierDraft => ({ minQty: "", percent: "" });

const numberText = (n: number | null): string => (n === null ? "" : String(n).replace(".", ","));

/** Valores por defecto al empezar un descuento de este tipo. */
export function initialValues(kind: DiscountKind, currency: string): DiscountFormValues {
  return {
    name: "",
    kind,
    scope: kind === "bogo" ? "product" : "order",
    currency,
    requiresCoupon: couponMode(kind) === "always",
    percent: "",
    maxAmount: "",
    amount: "",
    take: kind === "bogo" ? "2" : "",
    pay: kind === "bogo" ? "1" : "",
    tiers: [emptyTier()],
    customerGroupId: "",
    targets: [],
    minOrder: "",
    startsAt: "",
    endsAt: "",
    usageLimitTotal: "",
    // «Primera compra» sin tope por clienta se podría usar dos veces con pedidos simultáneos: arranca en 1 (se puede cambiar).
    usageLimitPerCustomer: kind === "first_purchase" ? "1" : "",
    priority: String(DEFAULT_PRIORITY),
    stackable: false,
    excludeSale: false,
    isActive: true,
  };
}

/** Cambia de tipo en el asistente: se conserva el nombre y la moneda; todo lo demás vuelve a sus valores de ese tipo. */
export function changeKind(values: DiscountFormValues, kind: DiscountKind): DiscountFormValues {
  if (values.kind === kind) return values;
  return { ...initialValues(kind, values.currency), name: values.name };
}

/** Valores para editar: los del descuento y los objetivos ya elegidos. Parámetros ilegibles: los campos del tipo arrancan vacíos. */
export function valuesFromDiscount(
  discount: Discount,
  targets: readonly PickedTarget[],
): DiscountFormValues {
  const base = initialValues(discount.kind, discount.currency);
  const p = discount.params;
  const params: Partial<DiscountFormValues> = {};
  if (p !== null) {
    if (p.kind === "fixed") params.amount = numberText(p.amount);
    else if (p.kind === "bogo") {
      params.take = String(p.take);
      params.pay = String(p.pay);
    } else if (p.kind === "volume") {
      params.tiers =
        p.tiers.length > 0
          ? p.tiers.map((tier) => ({
              minQty: String(tier.minQty),
              percent: numberText(tier.percent),
            }))
          : [emptyTier()];
    } else if (p.kind !== "free_shipping") {
      params.percent = numberText(p.percent);
      params.maxAmount = numberText(p.maxAmount);
    }
  } else if (discount.kind === "bogo") {
    // un 2×1 ilegible no arranca con el 2×1 de siempre: hay que volver a ingresarlo
    params.take = "";
    params.pay = "";
  }
  return {
    ...base,
    ...params,
    name: discount.name,
    scope: discount.scope,
    requiresCoupon: discount.requiresCoupon,
    customerGroupId: discount.customerGroupId ?? "",
    targets: [...targets],
    minOrder: numberText(discount.minOrderAmount),
    startsAt: toLaPazInputValue(discount.startsAt),
    endsAt: toLaPazInputValue(discount.endsAt),
    usageLimitTotal: numberText(discount.usageLimitTotal),
    usageLimitPerCustomer: numberText(discount.usageLimitPerCustomer),
    priority: String(discount.priority),
    stackable: discount.stackableWithAutomatic,
    excludeSale: discount.excludeSaleItems,
    isActive: discount.isActive,
  };
}

// ── Lectura de números ──────────────────────────────────────────────────────────────────────
type Read =
  { ok: true; value: number } | { ok: false; problem: "required" | "number" | "decimals" };

/** Decimales que ESCRIBIÓ la persona (no los del valor: «1.500» tiene 3 aunque valga 1,5, y no se adivina si quiso decir mil quinientos). */
const writtenDecimals = (text: string): number => /[.,](\d+)\s*$/.exec(text)?.[1]?.length ?? 0;

/** Número con hasta 2 decimales (porcentajes y dinero). Vacío es «required»: quien lo admite vacío lo mira antes. */
function readDecimal(text: string): Read {
  if (text.trim() === "") return { ok: false, problem: "required" };
  const n = parseNumber(text);
  if (n === null) return { ok: false, problem: "number" };
  if (writtenDecimals(text) > 2) return { ok: false, problem: "decimals" };
  return { ok: true, value: n };
}

type ReadWhole =
  { ok: true; value: number } | { ok: false; problem: "required" | "number" | "integer" };
function readWhole(text: string): ReadWhole {
  if (text.trim() === "") return { ok: false, problem: "required" };
  const n = parseNumber(text);
  if (n === null) return { ok: false, problem: "number" };
  if (!Number.isInteger(n)) return { ok: false, problem: "integer" };
  return { ok: true, value: n };
}

export type PercentProblem = "required" | "number" | "decimals" | "range";
/** Porcentaje: mayor que 0 y hasta 100, con hasta 2 decimales. */
export function parsePercent(
  text: string,
): { ok: true; value: number } | { ok: false; problem: PercentProblem } {
  const read = readDecimal(text);
  if (!read.ok) return read;
  if (read.value <= 0 || read.value > 100) return { ok: false, problem: "range" };
  return read;
}

export type AmountProblem = "required" | "number" | "decimals" | "range";
/** Monto positivo (monto fijo y tope): mayor que 0 y menor que 1.000.000.000, con hasta 2 decimales. */
export function parseAmount(
  text: string,
): { ok: true; value: number } | { ok: false; problem: AmountProblem } {
  const read = readDecimal(text);
  if (!read.ok) return read;
  if (read.value <= 0 || read.value > MAX_AMOUNT) return { ok: false, problem: "range" };
  return read;
}

/** Opcional: vacío es «sin valor» (null). */
function readOptional<P extends string>(
  text: string,
  parse: (text: string) => { ok: true; value: number } | { ok: false; problem: P },
): { ok: true; value: number | null } | { ok: false; problem: Exclude<P, "required"> } {
  if (text.trim() === "") return { ok: true, value: null };
  const result = parse(text);
  if (result.ok) return result;
  return { ok: false, problem: result.problem as Exclude<P, "required"> };
}

/** Mínimo de compra: 0 o más y hasta 9.999.999.999,99, con hasta 2 decimales. */
function parseMinOrder(
  text: string,
):
  | { ok: true; value: number }
  | { ok: false; problem: "required" | "number" | "decimals" | "range" } {
  const read = readDecimal(text);
  if (!read.ok) return read;
  if (read.value < 0 || read.value > MAX_ORDER_AMOUNT) return { ok: false, problem: "range" };
  return read;
}

/** Tope de usos: entero de 1 a 2.147.483.647. */
function parseLimit(
  text: string,
):
  | { ok: true; value: number }
  | { ok: false; problem: "required" | "number" | "integer" | "range" } {
  const read = readWhole(text);
  if (!read.ok) return read;
  if (read.value < 1 || read.value > MAX_LIMIT) return { ok: false, problem: "range" };
  return read;
}

/** Prioridad: entero de 0 a 100000. */
function parsePriorityValue(
  text: string,
):
  | { ok: true; value: number }
  | { ok: false; problem: "required" | "number" | "integer" | "range" } {
  const read = readWhole(text);
  if (!read.ok) return read;
  if (read.value < MIN_PRIORITY || read.value > MAX_PRIORITY)
    return { ok: false, problem: "range" };
  return read;
}

/** Fecha opcional de `datetime-local` (hora de La Paz) → instante ISO; null si está vacía; undefined si no se puede leer. */
function readInstant(text: string): string | null | undefined {
  try {
    return fromLaPazInputValue(text);
  } catch {
    return undefined;
  }
}

// ── Validación ──────────────────────────────────────────────────────────────────────────────
/** Cada campo con los problemas que puede tener (de aquí salen el tipo de los errores y los textos). */
export const FIELD_PROBLEMS = {
  name: ["required", "too_long"],
  percent: ["required", "number", "decimals", "range"],
  maxAmount: ["number", "decimals", "range"],
  amount: ["required", "number", "decimals", "range"],
  take: ["required", "number", "integer", "range"],
  pay: ["required", "number", "integer", "range", "not_below_take"],
  tierQty: ["required", "number", "integer", "range", "order"],
  tiers: ["none", "too_many"],
  group: ["required"],
  /** El problema es el alcance: dice qué falta elegir. */
  targets: ["product", "category", "collection"],
  scope: ["bogo_order", "shipping_scope"],
  minOrder: ["number", "decimals", "range"],
  startsAt: ["invalid", "required"],
  endsAt: ["invalid", "required", "before_start"],
  usageLimitTotal: ["number", "integer", "range"],
  usageLimitPerCustomer: ["number", "integer", "range"],
  priority: ["required", "number", "integer", "range"],
} as const;
type Problems = typeof FIELD_PROBLEMS;
export type FieldProblem<F extends keyof Problems> = Problems[F][number];

export interface TierRowErrors {
  minQty?: FieldProblem<"tierQty">;
  percent?: FieldProblem<"percent">;
}
export interface DiscountErrors {
  name?: FieldProblem<"name">;
  percent?: FieldProblem<"percent">;
  maxAmount?: FieldProblem<"maxAmount">;
  amount?: FieldProblem<"amount">;
  take?: FieldProblem<"take">;
  pay?: FieldProblem<"pay">;
  tiers?: {
    list?: FieldProblem<"tiers">;
    /** Un objeto por fila (en el mismo orden), `{}` si la fila está bien. */
    rows: TierRowErrors[];
  };
  group?: FieldProblem<"group">;
  targets?: FieldProblem<"targets">;
  scope?: FieldProblem<"scope">;
  minOrder?: FieldProblem<"minOrder">;
  startsAt?: FieldProblem<"startsAt">;
  endsAt?: FieldProblem<"endsAt">;
  usageLimitTotal?: FieldProblem<"usageLimitTotal">;
  usageLimitPerCustomer?: FieldProblem<"usageLimitPerCustomer">;
  priority?: FieldProblem<"priority">;
}

export type DiscountValidation =
  | {
      ok: true;
      /** Lo que se envía al crear. */
      payload: DiscountInput;
      /** Ids de los productos, categorías o colecciones elegidos (sin repetir). */
      targetIds: string[];
    }
  | { ok: false; errors: DiscountErrors };

interface TiersResult {
  tiers: { minQty: number; percent: number }[];
  errors: NonNullable<DiscountErrors["tiers"]>;
  valid: boolean;
}
/** 1 a 10 tramos, cantidad mínima entera ≥ 2 ESTRICTAMENTE creciente y porcentaje (0, 100]. */
function readTiers(drafts: readonly TierDraft[]): TiersResult {
  const errors: NonNullable<DiscountErrors["tiers"]> = { rows: [] };
  let valid = true;
  if (drafts.length === 0) {
    errors.list = "none";
    valid = false;
  } else if (drafts.length > MAX_TIERS) {
    errors.list = "too_many";
    valid = false;
  }
  const tiers: { minQty: number; percent: number }[] = [];
  let previous = 0;
  for (const row of drafts) {
    const rowErrors: TierRowErrors = {};
    const qty = readWhole(row.minQty);
    let minQty: number | null = null;
    if (!qty.ok) rowErrors.minQty = qty.problem;
    else if (qty.value < 2 || qty.value > MAX_TIER_QTY) rowErrors.minQty = "range";
    else if (qty.value <= previous) rowErrors.minQty = "order";
    else {
      minQty = qty.value;
      previous = qty.value;
    }
    const pct = parsePercent(row.percent);
    if (!pct.ok) rowErrors.percent = pct.problem;
    if (rowErrors.minQty || rowErrors.percent) valid = false;
    else if (minQty !== null && pct.ok) tiers.push({ minQty, percent: pct.value });
    errors.rows.push(rowErrors);
  }
  return { tiers, errors, valid };
}

/**
 * Valida el formulario y, si todo está bien, arma lo que se envía. Solo se manda lo que tiene sentido para el tipo: el grupo
 * únicamente en el precio por tipo de cliente, y «se suma» / «no rebajados» únicamente en un cupón que descuenta producto.
 */
export function validateDiscount(values: DiscountFormValues): DiscountValidation {
  const errors: DiscountErrors = {};
  const { kind } = values;

  const name = btrimSpaces(values.name);
  if (name === "") errors.name = "required";
  else if (charLength(name) > MAX_NAME) errors.name = "too_long";

  // Parámetros del tipo
  let params: DiscountParams | null = null;
  if (isPercentKind(kind)) {
    const percent = parsePercent(values.percent);
    const cap = readOptional(values.maxAmount, parseAmount);
    if (!percent.ok) errors.percent = percent.problem;
    if (!cap.ok) errors.maxAmount = cap.problem;
    if (percent.ok && cap.ok) {
      params = { kind, percent: percent.value, maxAmount: cap.value };
    }
  } else if (kind === "fixed") {
    const amount = parseAmount(values.amount);
    if (amount.ok) params = { kind, amount: amount.value };
    else errors.amount = amount.problem;
  } else if (kind === "free_shipping") {
    params = { kind };
  } else if (kind === "bogo") {
    const take = readWhole(values.take);
    const pay = readWhole(values.pay);
    let takeValue: number | null = null;
    if (!take.ok) errors.take = take.problem;
    else if (take.value < TAKE_MIN || take.value > TAKE_MAX) errors.take = "range";
    else takeValue = take.value;
    if (!pay.ok) errors.pay = pay.problem;
    else if (pay.value < 1) errors.pay = "range";
    else if (takeValue !== null && pay.value >= takeValue) errors.pay = "not_below_take";
    if (takeValue !== null && pay.ok && !errors.pay)
      params = { kind, take: takeValue, pay: pay.value };
  } else {
    const result = readTiers(values.tiers);
    if (result.valid) params = { kind, tiers: result.tiers };
    else errors.tiers = result.errors;
  }

  // Alcance y objetivos
  if (!allowedScopes(kind).includes(values.scope)) {
    errors.scope = kind === "bogo" ? "bogo_order" : "shipping_scope";
  }
  const targetIds = [...new Set(values.scope === "order" ? [] : values.targets.map((x) => x.id))];
  if (values.scope !== "order" && targetIds.length === 0 && !errors.scope) {
    errors.targets = values.scope;
  }

  // Grupo de clientes
  let customerGroupId: string | null = null;
  if (kind === "group_price") {
    if (values.customerGroupId === "") errors.group = "required";
    else customerGroupId = values.customerGroupId;
  }

  // Mínimo de compra
  const min = readOptional(values.minOrder, parseMinOrder);
  if (!min.ok) errors.minOrder = min.problem;

  // Vigencia (la oferta flash exige inicio y fin)
  const starts = readInstant(values.startsAt);
  const ends = readInstant(values.endsAt);
  if (starts === undefined) errors.startsAt = "invalid";
  else if (kind === "flash" && starts === null) errors.startsAt = "required";
  if (ends === undefined) errors.endsAt = "invalid";
  else if (kind === "flash" && ends === null) errors.endsAt = "required";
  if (
    typeof starts === "string" &&
    typeof ends === "string" &&
    new Date(ends).getTime() <= new Date(starts).getTime()
  ) {
    errors.endsAt = "before_start";
  }

  // Límites de uso y prioridad
  const total = readOptional(values.usageLimitTotal, parseLimit);
  const perCustomer = readOptional(values.usageLimitPerCustomer, parseLimit);
  if (!total.ok) errors.usageLimitTotal = total.problem;
  if (!perCustomer.ok) errors.usageLimitPerCustomer = perCustomer.problem;
  const priority = parsePriorityValue(values.priority);
  if (!priority.ok) errors.priority = priority.problem;

  if (
    Object.keys(errors).length > 0 ||
    params === null ||
    !min.ok ||
    !total.ok ||
    !perCustomer.ok ||
    !priority.ok ||
    starts === undefined ||
    ends === undefined
  ) {
    return { ok: false, errors };
  }

  const mode = couponMode(kind);
  const requiresCoupon =
    mode === "always" ? true : mode === "never" ? false : values.requiresCoupon;
  const flags = flagsApply(kind, requiresCoupon);
  return {
    ok: true,
    targetIds,
    payload: {
      name,
      kind,
      params,
      scope: values.scope,
      currency: values.currency,
      minOrderAmount: min.value,
      customerGroupId,
      requiresCoupon,
      stackableWithAutomatic: flags ? values.stackable : false,
      excludeSaleItems: flags ? values.excludeSale : false,
      usageLimitTotal: total.value,
      usageLimitPerCustomer: perCustomer.value,
      priority: priority.value,
      startsAt: starts,
      endsAt: ends,
      isActive: values.isActive,
    },
  };
}

/** Lo que se envía al EDITAR: el tipo, el alcance y la moneda no se cambian. */
export function toUpdateInput(input: DiscountInput): DiscountUpdateInput {
  const { kind: _kind, scope: _scope, currency: _currency, ...rest } = input;
  return rest;
}

// ── Vista previa ────────────────────────────────────────────────────────────────────────────
/**
 * El descuento tal como quedaría, aunque el formulario esté a medio llenar: lo opcional que no se puede leer se ignora (la
 * validación lo explicará al guardar) y, si falta algo del tipo (el porcentaje, el monto…), no hay vista previa (null).
 * En los tramos de volumen cuentan los que ya están completos.
 */
export function previewDescribable(values: DiscountFormValues): Describable | null {
  const { kind } = values;
  let params: DiscountParams | null = null;
  if (isPercentKind(kind)) {
    const percent = parsePercent(values.percent);
    const cap = readOptional(values.maxAmount, parseAmount);
    if (percent.ok) params = { kind, percent: percent.value, maxAmount: cap.ok ? cap.value : null };
  } else if (kind === "fixed") {
    const amount = parseAmount(values.amount);
    if (amount.ok) params = { kind, amount: amount.value };
  } else if (kind === "free_shipping") {
    params = { kind };
  } else if (kind === "bogo") {
    const take = readWhole(values.take);
    const pay = readWhole(values.pay);
    if (
      take.ok &&
      pay.ok &&
      take.value >= TAKE_MIN &&
      take.value <= TAKE_MAX &&
      pay.value >= 1 &&
      pay.value < take.value
    ) {
      params = { kind, take: take.value, pay: pay.value };
    }
  } else {
    const tiers = readTiers(values.tiers).tiers;
    if (tiers.length > 0) params = { kind, tiers };
  }
  if (params === null) return null;

  const min = readOptional(values.minOrder, parseMinOrder);
  const total = readOptional(values.usageLimitTotal, parseLimit);
  const perCustomer = readOptional(values.usageLimitPerCustomer, parseLimit);
  const mode = couponMode(kind);
  const requiresCoupon =
    mode === "always" ? true : mode === "never" ? false : values.requiresCoupon;
  const flags = flagsApply(kind, requiresCoupon);
  const starts = readInstant(values.startsAt);
  const ends = readInstant(values.endsAt);
  return {
    kind,
    params,
    scope: values.scope,
    currency: values.currency,
    minOrderAmount: min.ok ? min.value : null,
    customerGroupId:
      kind === "group_price" && values.customerGroupId !== "" ? values.customerGroupId : null,
    requiresCoupon,
    stackableWithAutomatic: flags ? values.stackable : false,
    excludeSaleItems: flags ? values.excludeSale : false,
    usageLimitTotal: total.ok ? total.value : null,
    usageLimitPerCustomer: perCustomer.ok ? perCustomer.value : null,
    startsAt: starts ?? null,
    endsAt: ends ?? null,
  };
}

// ── Textos de los problemas ─────────────────────────────────────────────────────────────────
const E = "admin.discounts.wizard.errors" as const;

/** El texto que se ve junto al campo. Los problemas de número comparten texto; el resto es de cada campo. */
export function problemText<F extends keyof Problems>(field: F, problem: FieldProblem<F>): string {
  const code: string = problem;
  if (code === "number" || code === "integer" || code === "decimals") {
    return t(`${E}.generic.${code}`);
  }
  return t(`${E}.${field}.${code}` as MessageKey);
}
