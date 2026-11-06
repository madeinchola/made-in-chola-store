import { parsePin, type CoordinateProblem, type PinText } from "@/components/map/coords";
import type {
  QuoteBreakdown,
  QuoteParams,
  QuoteResult,
  QuoteSlot,
} from "@/features/shipping/types";
import type { AppError } from "@/lib/errors";
import { formatMoney, fromDecimal } from "@/lib/money";
import { compareIsoDates } from "./SlotsDates";

/**
 * Lógica PURA del simulador de envío. IMPORTANTE: aquí NO se calcula ningún costo, distancia ni tramo: eso lo hace SIEMPRE el
 * servidor (`quote_shipping`). Estas funciones solo arman la pregunta (los parámetros), comparan preguntas, y ordenan y
 * dan formato a lo que el servidor respondió.
 */

/**
 * La última cotización pedida, con la pregunta que se hizo y cuántas ediciones llevaba el formulario en ese momento
 * (`edits`): si después se edita CUALQUIER campo, el resultado deja de valer aunque se vuelva a escribir lo mismo.
 */
export type SimulatorRun =
  | { status: "pending"; params: QuoteParams; edits: number }
  | { status: "done"; params: QuoteParams; edits: number; result: QuoteResult }
  | { status: "failed"; params: QuoteParams; edits: number; error: AppError };

export type AmountProblem = "required" | "invalid";
export type AmountResult = { ok: true; value: number } | { ok: false; problem: AmountProblem };

/** Hasta 15 dígitos enteros y 2 decimales (centavos de boliviano); acepta coma o punto decimal. */
const AMOUNT = /^\d{1,15}([.,]\d{1,2})?$/;

export function parseAmount(text: string): AmountResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, problem: "required" };
  if (!AMOUNT.test(trimmed)) return { ok: false, problem: "invalid" };
  return { ok: true, value: Number(trimmed.replace(",", ".")) };
}

export interface SimulatorValues {
  methodCode: string;
  kind: "delivery" | "pickup";
  /** Latitud y longitud tal como están en el selector (pueden estar vacías: «sin pin»). */
  pin: PinText;
  city: string;
  amount: string;
  /** AAAA-MM-DD, o "" si no se eligió. */
  date: string;
  /** "" si no se eligió franja. */
  slotId: string;
}

export interface SimulatorErrors {
  amount?: AmountProblem;
  lat?: CoordinateProblem;
  lng?: CoordinateProblem;
}

export type BuildParamsResult =
  { ok: true; params: QuoteParams } | { ok: false; errors: SimulatorErrors };

/**
 * Arma los parámetros EXACTOS que se mandan a `quoteShipping`. En el recojo no hay dirección ni fecha: solo método y monto.
 * En domicilio, un destino sin marcar se manda como `null` (el servidor responde «marca tu dirección», que también es algo
 * que se quiere probar); uno a medias o mal escrito se rechaza aquí, porque no es un valor que pueda existir.
 */
export function buildQuoteParams(values: SimulatorValues): BuildParamsResult {
  const errors: SimulatorErrors = {};
  const amount = parseAmount(values.amount);
  if (!amount.ok) errors.amount = amount.problem;

  if (values.kind === "pickup") {
    if (!amount.ok) return { ok: false, errors };
    return { ok: true, params: { methodCode: values.methodCode, orderAmount: amount.value } };
  }

  const pin = parsePin(values.pin);
  if (pin.kind === "invalid") {
    if (pin.lat) errors.lat = pin.lat;
    if (pin.lng) errors.lng = pin.lng;
  }
  if (!amount.ok || pin.kind === "invalid") return { ok: false, errors };
  return {
    ok: true,
    params: {
      methodCode: values.methodCode,
      lat: pin.kind === "pin" ? pin.lat : null,
      lng: pin.kind === "pin" ? pin.lng : null,
      city: values.city.trim() === "" ? null : values.city.trim(),
      orderAmount: amount.value,
      deliveryDate: values.date === "" ? null : values.date,
      slotId: values.slotId === "" ? null : values.slotId,
    },
  };
}

const PARAM_KEYS = [
  "methodCode",
  "lat",
  "lng",
  "city",
  "orderAmount",
  "currency",
  "deliveryDate",
  "slotId",
  "listDays",
] as const;

/** ¿Es la MISMA pregunta? (un campo ausente y uno `null` cuentan igual). Decide si un resultado viejo aún vale. */
export function sameQuoteParams(a: QuoteParams, b: QuoteParams): boolean {
  return PARAM_KEYS.every((key) => (a[key] ?? null) === (b[key] ?? null));
}

export interface SlotDay {
  date: string;
  slots: QuoteSlot[];
}

/** Las franjas que devolvió el servidor, agrupadas por fecha (cronológico) y, dentro del día, por hora de inicio. */
export function groupSlotsByDate(slots: readonly QuoteSlot[]): SlotDay[] {
  const sorted = [...slots].sort(
    (a, b) =>
      compareIsoDates(a.date, b.date) ||
      a.start.localeCompare(b.start) ||
      a.end.localeCompare(b.end) ||
      a.slotId.localeCompare(b.slotId),
  );
  const days: SlotDay[] = [];
  for (const slot of sorted) {
    const last = days[days.length - 1];
    if (last && last.date === slot.date) last.slots.push(slot);
    else days.push({ date: slot.date, slots: [slot] });
  }
  return days;
}

export type EtaParts =
  | { kind: "none" }
  | { kind: "exact"; days: number }
  | { kind: "range"; min: number; max: number }
  | { kind: "from"; days: number }
  | { kind: "upTo"; days: number };

/** El plazo estimado del método (días): solo se interpretan los dos números que guarda el método, nada más. */
export function etaParts(min: number | null, max: number | null): EtaParts {
  if (min !== null && max !== null) {
    return min === max ? { kind: "exact", days: min } : { kind: "range", min, max };
  }
  if (min !== null) return { kind: "from", days: min };
  if (max !== null) return { kind: "upTo", days: max };
  return { kind: "none" };
}

/** Una fila del desglose, con los números TAL CUAL los devolvió el servidor (la pantalla les da formato, no los cambia). */
export type BreakdownRow =
  | { id: "pickup" }
  | { id: "rule"; name: string; kind: "distance" | "flat"; priority: number }
  | { id: "straightKm"; km: number }
  | { id: "routeKm"; km: number }
  | { id: "routeFactor"; factor: number }
  | { id: "tier"; tier: number }
  | { id: "extraKm"; km: number }
  | { id: "flatRate" }
  | { id: "minApplied"; applied: boolean }
  | { id: "maxApplied"; applied: boolean };

/**
 * Convierte el desglose del servidor en filas legibles: regla aplicada, km en línea recta y de ruta, factor, tramo (o km
 * adicionales si pasó el último), y si se aplicó el mínimo o el máximo. Lo que el servidor no informó no se inventa.
 */
export function breakdownRows(b: QuoteBreakdown): BreakdownRow[] {
  if (b.pickup) return [{ id: "pickup" }];
  const rows: BreakdownRow[] = [];
  if (b.rule) {
    rows.push({ id: "rule", name: b.rule.name, kind: b.rule.kind, priority: b.rule.priority });
  }
  if (b.straightKm !== null) rows.push({ id: "straightKm", km: b.straightKm });
  if (b.routeKm !== null) rows.push({ id: "routeKm", km: b.routeKm });
  if (b.routeFactor !== null) rows.push({ id: "routeFactor", factor: b.routeFactor });
  if (b.tier !== null) rows.push({ id: "tier", tier: b.tier });
  else if (b.extraKm !== null) rows.push({ id: "extraKm", km: b.extraKm });
  else if (b.rule?.kind === "flat") rows.push({ id: "flatRate" });
  if (b.rule?.kind === "distance") {
    rows.push({ id: "minApplied", applied: b.minApplied });
    rows.push({ id: "maxApplied", applied: b.maxApplied });
  }
  return rows;
}

const KM = new Intl.NumberFormat("es-BO", { maximumFractionDigits: 2 });
/** «12,35» (solo formato: el número es el del servidor). */
export const formatNumber = (value: number): string => KM.format(value);

/** «Bs 15,00». Si la moneda no se conoce, el importe se muestra tal cual antes que romper la pantalla. */
export function formatServerMoney(value: number, currency: string): string {
  try {
    return formatMoney(fromDecimal(value, currency));
  } catch {
    return `${currency} ${String(value)}`;
  }
}
