import { t } from "@/i18n";
import { AppError, toAppError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import {
  SHIPPING_ERROR_CODES,
  SHIPPING_ERROR_FIELDS,
  type QuoteBreakdown,
  type QuoteParams,
  type QuotePickup,
  type QuoteResult,
  type QuoteSelected,
  type QuoteSlot,
  type ShippingError,
  type ShippingMethodInfo,
} from "./types";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null);
const strOrNull = (v: unknown): string | null => (isStr(v) ? v : null);

/** La respuesta no tiene la forma del contrato: se lanza (la pantalla dice que no se pudo calcular), nunca se adivina. */
function malformed(what: string): never {
  throw new AppError("unknown", t("shipping.errors.unexpected"), {
    cause: new Error(`quote_shipping: ${what}`),
  });
}

function parseMethod(raw: unknown): ShippingMethodInfo | null {
  if (raw === null || raw === undefined) return null;
  if (!isRec(raw) || !isStr(raw.code) || !isStr(raw.name)) return malformed("method");
  if (raw.kind !== "delivery" && raw.kind !== "pickup") return malformed("method.kind");
  return {
    code: raw.code,
    name: raw.name,
    kind: raw.kind,
    description: strOrNull(raw.description),
    etaMinDays: numOrNull(raw.eta_min_days),
    etaMaxDays: numOrNull(raw.eta_max_days),
  };
}

function parseErrors(raw: unknown): ShippingError[] {
  if (!Array.isArray(raw)) return malformed("errors");
  return raw.map((e) => {
    if (!isRec(e) || !isStr(e.code)) return malformed("errors[]");
    const known = (SHIPPING_ERROR_CODES as readonly string[]).includes(e.code);
    const field = (SHIPPING_ERROR_FIELDS as readonly string[]).includes(String(e.field))
      ? (e.field as ShippingError["field"])
      : "system";
    return { code: known ? (e.code as ShippingError["code"]) : "unknown", field };
  });
}

function parseSlots(raw: unknown): QuoteSlot[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return malformed("slots");
  return raw.map((s) => {
    if (
      !isRec(s) ||
      !isStr(s.slot_id) ||
      !isStr(s.date) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(s.date) ||
      !isStr(s.start) ||
      !isStr(s.end) ||
      !isNum(s.capacity) ||
      !isNum(s.remaining) ||
      typeof s.available !== "boolean"
    ) {
      return malformed("slots[]");
    }
    return {
      slotId: s.slot_id,
      date: s.date,
      start: s.start,
      end: s.end,
      capacity: s.capacity,
      remaining: s.remaining,
      available: s.available,
    };
  });
}

function parseBreakdown(raw: unknown): QuoteBreakdown {
  const empty: QuoteBreakdown = {
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
  if (raw === undefined || raw === null) return empty;
  if (!isRec(raw)) return malformed("breakdown");
  if (raw.kind === "pickup") return { ...empty, pickup: true };
  const rule = raw.rule;
  return {
    rule:
      isRec(rule) && isStr(rule.id) && isStr(rule.name) && isNum(rule.priority)
        ? {
            id: rule.id,
            name: rule.name,
            kind: rule.kind === "flat" ? "flat" : "distance",
            priority: rule.priority,
          }
        : null,
    straightKm: numOrNull(raw.straight_km),
    routeKm: numOrNull(raw.route_km),
    routeFactor: numOrNull(raw.route_factor),
    tier: numOrNull(raw.tier),
    extraKm: numOrNull(raw.extra_km),
    minApplied: raw.min_applied === true,
    maxApplied: raw.max_applied === true,
    pickup: false,
  };
}

function parsePickup(raw: unknown): QuotePickup | null {
  if (raw === undefined || raw === null) return null;
  if (
    !isRec(raw) ||
    !isStr(raw.name) ||
    !isStr(raw.address) ||
    !isStr(raw.city) ||
    !isNum(raw.lat) ||
    !isNum(raw.lng)
  ) {
    return malformed("pickup");
  }
  return {
    name: raw.name,
    address: raw.address,
    city: raw.city,
    lat: raw.lat,
    lng: raw.lng,
    hours: strOrNull(raw.hours),
  };
}

function parseSelected(raw: unknown): QuoteSelected | null {
  if (raw === undefined || raw === null) return null;
  if (!isRec(raw) || !isStr(raw.date)) return malformed("selected");
  return {
    date: raw.date,
    slotId: strOrNull(raw.slot_id),
    start: strOrNull(raw.start),
    end: strOrNull(raw.end),
  };
}

/**
 * Convierte la respuesta cruda de `quote_shipping` en un `QuoteResult`, comprobando cada parte. Garantiza las dos reglas que
 * importan: `ok` y `errors` coinciden, y SIN `ok` nunca hay costo (ni uno que el servidor dejara por error).
 */
export function parseQuote(raw: unknown): QuoteResult {
  if (!isRec(raw) || typeof raw.ok !== "boolean") return malformed("raíz");
  const errors = parseErrors(raw.errors);
  if (raw.ok !== (errors.length === 0)) return malformed("ok no coincide con errors");
  const cost = raw.ok ? numOrNull(raw.cost) : null;
  if (raw.ok && cost === null) return malformed("ok sin costo");
  if (cost !== null && cost < 0) return malformed("costo negativo");
  return {
    ok: raw.ok,
    cost,
    currency: strOrNull(raw.currency),
    method: parseMethod(raw.method),
    distanceKm: numOrNull(raw.distance_km),
    breakdown: parseBreakdown(raw.breakdown),
    slots: parseSlots(raw.slots),
    selected: parseSelected(raw.selected),
    pickup: parsePickup(raw.pickup),
    errors,
  };
}

/** Argumentos del RPC: los que no se pasan toman el valor por defecto del servidor (no se mandan `undefined`). */
export function quoteArgs(p: QuoteParams): Record<string, string | number | null> {
  const args: Record<string, string | number | null> = {};
  if (p.methodCode !== undefined) args.p_method_code = p.methodCode;
  if (p.lat !== undefined) args.p_lat = p.lat;
  if (p.lng !== undefined) args.p_lng = p.lng;
  if (p.city !== undefined) args.p_city = p.city;
  if (p.orderAmount !== undefined) args.p_order_amount = p.orderAmount;
  if (p.currency !== undefined) args.p_currency = p.currency;
  if (p.deliveryDate !== undefined) args.p_delivery_date = p.deliveryDate;
  if (p.slotId !== undefined) args.p_slot_id = p.slotId;
  if (p.listDays !== undefined) args.p_list_days = p.listDays;
  return args;
}

/** Pide al servidor la cotización. Un fallo de red o del servidor se lanza como `AppError`; los problemas de DATOS (fuera de cobertura…) llegan dentro de `errors`. */
export async function quoteShipping(params: QuoteParams = {}): Promise<QuoteResult> {
  const { data, error } = await getSupabase().rpc("quote_shipping", quoteArgs(params));
  if (error) throw toAppError(error);
  return parseQuote(data);
}
