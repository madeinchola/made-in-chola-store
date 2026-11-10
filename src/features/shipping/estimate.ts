import { t } from "@/i18n";
import { add, fromDecimal, toDecimalString } from "@/lib/money";
import type { Destination, ScheduleChoice } from "./destination";
import type { QuoteParams, QuoteResult, QuoteSlot, ShippingError } from "./types";

/**
 * Lógica PURA del estimador de envío de la bolsa. Aquí no se calcula ningún costo: el costo lo dice `quote_shipping`
 * (el servidor) y esto solo decide QUÉ mostrar con lo que contestó. La única suma es «subtotal + envío» de dos números del
 * servidor, y se hace en la unidad menor de la moneda (`money`), no con decimales de coma flotante.
 */

/** ¿Se puede preguntar el envío? Hace falta algo que cobrar: una bolsa sin líneas, o sin nada cobrable, no cotiza. */
export function canQuote(input: { lineCount: number; subtotal: number }): boolean {
  return input.lineCount > 0 && Number.isFinite(input.subtotal) && input.subtotal > 0;
}

/**
 * Parámetros del RPC. `orderAmount` es el subtotal que informa el servidor para la bolsa. Con una franja elegida se agregan
 * `deliveryDate` + `slotId` (el servidor valida cupo y antelación); sin ella NO se mandan (no `undefined`, no `null`).
 */
export function buildQuoteParams(
  destination: Destination,
  subtotal: number,
  currency: string,
  schedule: ScheduleChoice | null = null,
): QuoteParams {
  const params: QuoteParams = {
    lat: destination.lat,
    lng: destination.lng,
    city: destination.city,
    orderAmount: subtotal,
    currency,
  };
  if (schedule) {
    params.deliveryDate = schedule.date;
    params.slotId = schedule.slotId;
  }
  return params;
}

/**
 * «Total estimado» = total del servidor (sin envío: el subtotal menos el descuento, cuando exista) + envío del servidor, en la
 * unidad menor de la moneda (100 + 15 = 115; 0,1 + 0,2 = 0,3 y no 0,30000000000000004). `null` si no se puede sumar con seguridad (moneda desconocida, número inválido): es mejor no
 * mostrar un total que mostrar uno inventado.
 */
export function estimatedTotal(
  baseTotal: number,
  shipping: number,
  currency: string,
): number | null {
  try {
    const sum = add(fromDecimal(baseTotal, currency), fromDecimal(shipping, currency));
    return Number(toDecimalString(sum));
  } catch {
    return null;
  }
}

/**
 * El «Total estimado» de la bolsa. Con una cotización válida es `estimatedTotal` (total del servidor + envío). Con ENVÍO GRATIS
 * (descuento de S9: `discounts.free_shipping`) el costo cotizado NO se suma: el total estimado es el total del servidor tal
 * cual (ya con sus descuentos). Sin cotización válida no hay total estimado (`null`).
 */
export function quoteTotal(
  quote: QuoteView,
  baseTotal: number,
  currency: string,
  freeShipping: boolean,
): number | null {
  if (quote.kind !== "ok") return null;
  if (freeShipping) return Number.isFinite(baseTotal) ? baseTotal : null;
  return estimatedTotal(baseTotal, quote.cost, currency);
}

/** Qué puede hacer la clienta ante un error del servidor. */
export type ErrorAction = "location" | "retry" | "schedule" | "none";

/**
 * Para cada código de error, qué se le ofrece. El tipo `Record` obliga a decidirlo en cuanto el servidor agregue un código
 * al contrato: no hay un «caso por omisión» que pase desapercibido.
 */
const ERROR_ACTIONS: Record<ShippingError["code"], ErrorAction> = {
  method_not_found: "retry",
  method_inactive: "retry",
  currency_unsupported: "none",
  invalid_order_amount: "none",
  no_origin: "retry",
  location_required: "location",
  invalid_coordinates: "location",
  blocked_zone: "location",
  coverage_not_configured: "retry",
  out_of_coverage: "location",
  no_rate: "location",
  date_required: "schedule",
  slot_required: "schedule",
  slot_not_found: "schedule",
  slot_mismatch: "schedule",
  slot_full: "schedule",
  date_past: "schedule",
  date_blocked: "schedule",
  date_too_far: "schedule",
  date_too_soon: "schedule",
  unknown: "retry",
};

/** Errores por la UBICACIÓN: se explican con una frase más (no es culpa de la clienta, y hay otra salida). */
const COVERAGE_CODES: ReadonlySet<ShippingError["code"]> = new Set([
  "blocked_zone",
  "out_of_coverage",
  "no_rate",
]);

export interface ErrorView {
  code: ShippingError["code"];
  /** El mensaje del código (`shipping.errors.*`), siempre con texto. */
  message: string;
  /** Una frase de ayuda, solo en los errores de cobertura. */
  help: string | null;
  action: ErrorAction;
}

/** El primer error de la respuesta, traducido y con su acción. Sin errores (no debería pasar con `ok` falso) es `unknown`. */
export function errorView(errors: readonly ShippingError[]): ErrorView {
  const code = errors[0]?.code ?? "unknown";
  return {
    code,
    message: t(`shipping.errors.${code}`),
    help: COVERAGE_CODES.has(code) ? t("shipping.estimator.coverageHelp") : null,
    action: ERROR_ACTIONS[code],
  };
}

/** Plazo estimado del método, en palabras («1 a 2 días»). `null` si el método no lo informa o los números no sirven. */
export function formatEta(min: number | null, max: number | null): string | null {
  const valid = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 0;
  const lo = valid(min) ? min : null;
  const hi = valid(max) ? max : null;
  if (lo === null && hi === null) return null;
  const days = (n: number) =>
    n === 1 ? t("shipping.estimator.eta.oneDay") : t("shipping.estimator.eta.days", { n });
  if (lo === null) return t("shipping.estimator.eta.upTo", { days: days(hi as number) });
  if (hi === null) return t("shipping.estimator.eta.from", { days: days(lo) });
  if (lo === hi) {
    return hi === 0
      ? t("shipping.estimator.eta.sameDay")
      : t("shipping.estimator.eta.exactly", { days: days(hi) });
  }
  if (lo === 0) return t("shipping.estimator.eta.upTo", { days: days(hi) });
  return t("shipping.estimator.eta.range", { min: lo, days: days(hi) });
}

/** Lo que se sabe del envío a esta dirección con este subtotal. */
export type QuoteView =
  /** No se pregunta (sin destino elegido o sin nada que cobrar). */
  | { kind: "idle" }
  /** Preguntado; la respuesta de ESTA consulta todavía no llega. */
  | { kind: "loading" }
  /** No hubo respuesta (red o servidor): se puede reintentar. */
  | { kind: "failed" }
  /** El servidor contestó que no se puede (`ok` falso): hay un error, nunca un costo. */
  | { kind: "rejected"; error: ErrorView }
  | {
      kind: "ok";
      /** Costo del servidor. 0 es un costo real (envío gratis por regla), no «sin costo». */
      cost: number;
      currency: string;
      eta: string | null;
      slots: QuoteSlot[];
    };

export interface QuoteInput {
  /** ¿Se está preguntando? (hay destino y algo que cobrar). */
  asked: boolean;
  /** Moneda de la bolsa: la respuesta debe estar en ella. */
  currency: string;
  /** La respuesta de la consulta ACTUAL (la de estos parámetros), si ya llegó. */
  data: QuoteResult | undefined;
  /** La consulta actual falló. */
  failed: boolean;
}

/**
 * Convierte el estado de la consulta en lo que se muestra. Reglas que protegen a la clienta:
 *  · Sin `ok` NUNCA hay costo (aunque el objeto trajera uno).
 *  · Una respuesta en otra moneda que la de la bolsa no se suma ni se muestra como costo.
 *  · Mientras la consulta actual no responde es `loading`: lo que se mostró para otros parámetros no se reutiliza (la
 *    consulta se identifica por sus parámetros, así que esto lo garantiza quien llama pasando solo la `data` de la actual).
 */
export function quoteView({ asked, currency, data, failed }: QuoteInput): QuoteView {
  if (!asked) return { kind: "idle" };
  if (data === undefined) return failed ? { kind: "failed" } : { kind: "loading" };
  if (!data.ok || data.cost === null) return { kind: "rejected", error: errorView(data.errors) };
  if (data.currency !== null && data.currency !== currency) {
    return { kind: "rejected", error: errorView([{ code: "unknown", field: "currency" }]) };
  }
  return {
    kind: "ok",
    cost: data.cost,
    currency,
    eta: formatEta(data.method?.etaMinDays ?? null, data.method?.etaMaxDays ?? null),
    slots: data.slots,
  };
}

/** Lo que se sabe de la fecha y franja elegidas. */
export type ScheduleView =
  | { kind: "none" }
  | { kind: "checking" }
  | { kind: "failed" }
  | { kind: "rejected"; error: ErrorView }
  | { kind: "confirmed"; date: string; slotId: string; start: string | null; end: string | null };

export interface ScheduleInput {
  choice: ScheduleChoice | null;
  /** ¿Se está validando? (hay elección y la cotización base ya es válida). */
  asked: boolean;
  data: QuoteResult | undefined;
  failed: boolean;
}

/**
 * La elección se da por buena solo si el servidor la CONFIRMA (`selected` con la misma fecha y franja que se pidió). Si
 * contesta que no, se muestra su error; si contesta otra cosa, no se da por buena.
 */
export function scheduleView({ choice, asked, data, failed }: ScheduleInput): ScheduleView {
  if (choice === null) return { kind: "none" };
  if (!asked) return { kind: "none" };
  if (data === undefined) return failed ? { kind: "failed" } : { kind: "checking" };
  if (!data.ok) return { kind: "rejected", error: errorView(data.errors) };
  const selected = data.selected;
  if (selected === null || selected.date !== choice.date || selected.slotId !== choice.slotId) {
    return { kind: "rejected", error: errorView([{ code: "unknown", field: "system" }]) };
  }
  return {
    kind: "confirmed",
    date: selected.date,
    slotId: selected.slotId,
    start: selected.start,
    end: selected.end,
  };
}

/**
 * Las franjas más recientes que conocemos: las de la validación (más nuevas, tras un «llena» de última hora) si ya
 * llegaron; si no, las de la cotización base.
 */
export function freshestSlots(
  base: readonly QuoteSlot[],
  checked: QuoteResult | undefined,
): QuoteSlot[] {
  return checked && checked.slots.length > 0 ? checked.slots : [...base];
}

/** Lo que dice la fila «Envío» del resumen de la bolsa. */
export type ShippingRow =
  /** Todavía no hay destino (o nada que cobrar): «Se calcula al elegir tu dirección». */
  | { kind: "later" }
  | { kind: "calculating" }
  /** No se pudo estimar (error o fallo): sin importe, y el motivo está en el estimador. */
  | { kind: "unavailable" }
  | { kind: "free" }
  | { kind: "cost"; cost: number };

/**
 * La fila «Envío»: un importe SOLO cuando hay un costo válido del servidor; en cualquier otro caso, un texto. Con envío
 * gratis (S9) y una cotización válida dice «Gratis» aunque el método cobre algo; sin cotización sigue como siempre.
 */
export function shippingRow(quote: QuoteView, freeShipping = false): ShippingRow {
  switch (quote.kind) {
    case "idle":
      return { kind: "later" };
    case "loading":
      return { kind: "calculating" };
    case "failed":
    case "rejected":
      return { kind: "unavailable" };
    case "ok":
      return freeShipping || quote.cost === 0
        ? { kind: "free" }
        : { kind: "cost", cost: quote.cost };
  }
}
