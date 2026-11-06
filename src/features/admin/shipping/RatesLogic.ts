import { t } from "@/i18n";
import { getCurrency } from "@/lib/currencies";
import { formatDateTime } from "@/lib/datetime";
import { formatMoney, fromDecimal } from "@/lib/money";
import { formatKm } from "./ZonesLogic";
import { tierSpans } from "./tierLogic";
import type { RateParams, RateRule, ShippingZone } from "./types";

/** Importe para una lista: «Bs 15» si es exacto, «Bs 15,50» si no. Si la moneda es desconocida, no rompe la pantalla. */
export function formatAmount(value: number, currency: string): string {
  try {
    return formatMoney(fromDecimal(value, currency)).replace(/,00$/, "");
  } catch {
    return `${currency} ${String(value)}`;
  }
}

/** Símbolo para las etiquetas de los campos («Bs»); si la moneda es desconocida, su código. */
export function currencySymbol(code: string): string {
  try {
    return getCurrency(code).symbol;
  } catch {
    return code;
  }
}

const K = "admin.shipping.rates.rules.summary" as const;

/**
 * La regla en una línea legible: «Hasta 3 km: Bs 15 · 3–6 km: Bs 20 · … · Más allá: Bs 3 por km adicional · Mínimo Bs 15»
 * o «Bs 80 fijo» / «Envío gratis». Muestra hasta `maxTiers` tramos y resume el resto («2 tramos más»). Si la regla de
 * distancia no cobra km adicional dice hasta dónde llega, porque más allá cede el paso a la siguiente regla.
 */
export function ruleSummary(params: RateParams, currency: string, maxTiers = 3): string {
  if (params.kind === "flat") {
    return params.cost === 0
      ? t(`${K}.free`)
      : t(`${K}.flat`, { cost: formatAmount(params.cost, currency) });
  }
  const spans = tierSpans(params.tiers);
  const parts = spans.slice(0, maxTiers).map((span, i) =>
    i === 0
      ? t(`${K}.tierFirst`, { to: formatKm(span.toKm), cost: formatAmount(span.cost, currency) })
      : t(`${K}.tierNext`, {
          from: formatKm(span.fromKm),
          to: formatKm(span.toKm),
          cost: formatAmount(span.cost, currency),
        }),
  );
  if (spans.length === 0) parts.push(t(`${K}.noTiers`));
  const hidden = spans.length - maxTiers;
  if (hidden === 1) parts.push(t(`${K}.moreTiersOne`));
  else if (hidden > 1) parts.push(t(`${K}.moreTiersMany`, { count: hidden }));

  const last = spans[spans.length - 1];
  if (params.extraPerKm !== null && params.extraPerKm > 0) {
    parts.push(t(`${K}.extra`, { cost: formatAmount(params.extraPerKm, currency) }));
  } else if (last) {
    parts.push(t(`${K}.noExtra`, { km: formatKm(last.toKm) }));
  }
  if (params.minCost !== null) {
    parts.push(t(`${K}.min`, { cost: formatAmount(params.minCost, currency) }));
  }
  if (params.maxCost !== null) {
    parts.push(t(`${K}.max`, { cost: formatAmount(params.maxCost, currency) }));
  }
  return parts.join(t(`${K}.separator`));
}

/** Rango de monto del pedido al que se limita la regla (ambos extremos inclusivos). */
export function orderRangeText(min: number | null, max: number | null, currency: string): string {
  const O = "admin.shipping.rates.rules.order" as const;
  if (min === null && max === null) return t(`${O}.any`);
  if (min !== null && max === null) return t(`${O}.from`, { min: formatAmount(min, currency) });
  if (min === null && max !== null) return t(`${O}.until`, { max: formatAmount(max, currency) });
  return t(`${O}.between`, {
    min: formatAmount(min as number, currency),
    max: formatAmount(max as number, currency),
  });
}

const safeDate = (iso: string): string => {
  try {
    return formatDateTime(iso);
  } catch {
    return iso;
  }
};

/** Periodo de vigencia en hora de La Paz. */
export function validityText(from: string | null, until: string | null): string {
  const V = "admin.shipping.rates.rules.validity" as const;
  if (from === null && until === null) return t(`${V}.always`);
  if (from !== null && until === null) return t(`${V}.from`, { date: safeDate(from) });
  if (from === null && until !== null) return t(`${V}.until`, { date: safeDate(until) });
  return t(`${V}.range`, { from: safeDate(from as string), to: safeDate(until as string) });
}

export type RateStatus = "live" | "scheduled" | "expired" | "inactive" | "archived";

/**
 * Estado de una regla con las MISMAS reglas que `quote_shipping`: se aplica si no está archivada, está activa, ya empezó
 * (`valid_from <= ahora`) y no terminó (`valid_until > ahora`). Precedencia: archivada, inactiva, programada, vencida.
 */
export function rateStatus(
  rule: Pick<RateRule, "archived" | "isActive" | "validFrom" | "validUntil">,
  now: Date,
): RateStatus {
  if (rule.archived) return "archived";
  if (!rule.isActive) return "inactive";
  const t0 = now.getTime();
  if (rule.validFrom !== null && new Date(rule.validFrom).getTime() > t0) return "scheduled";
  if (rule.validUntil !== null && new Date(rule.validUntil).getTime() <= t0) return "expired";
  return "live";
}

/**
 * Las reglas en el orden en que las evalúa el servidor: mayor prioridad primero; a igualdad, la que tiene zona; a
 * igualdad, la de menor id. Las archivadas van al final (el servidor las ignora).
 */
export function sortRates(rates: readonly RateRule[]): RateRule[] {
  return [...rates].sort(
    (a, b) =>
      Number(a.archived) - Number(b.archived) ||
      b.priority - a.priority ||
      Number(b.zoneId !== null) - Number(a.zoneId !== null) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export type RuleZoneState = "any" | "ok" | "archived" | "inactive" | "blocked" | "unknown";

/** ¿Puede aplicarse la regla según su zona? Solo cuentan las zonas con servicio, activas y no archivadas. */
export function ruleZoneState(
  zoneId: string | null,
  zonesById: ReadonlyMap<string, ShippingZone>,
): RuleZoneState {
  if (zoneId === null) return "any";
  const zone = zonesById.get(zoneId);
  if (!zone) return "unknown";
  if (zone.archived) return "archived";
  if (!zone.allowed) return "blocked";
  if (!zone.isActive) return "inactive";
  return "ok";
}

/** Nombre de la zona de la regla para la lista y el selector, con la nota si no está disponible. */
export function ruleZoneLabel(
  zoneId: string | null,
  zonesById: ReadonlyMap<string, ShippingZone>,
): string {
  const Z = "admin.shipping.rates.rules.zone" as const;
  const state = ruleZoneState(zoneId, zonesById);
  if (state === "any") return t(`${Z}.any`);
  if (state === "unknown") return t(`${Z}.unknown`);
  const name = (zonesById.get(zoneId as string) as ShippingZone).name;
  return state === "ok" ? name : t(`${Z}.${state}`, { name });
}

export interface RateZoneOption {
  /** "" = cualquier zona cubierta. */
  value: string;
  label: string;
}

/**
 * Opciones del selector de zona de una regla: «Cualquier zona cubierta» y las zonas con servicio no archivadas. La zona
 * que la regla ya tiene SIEMPRE aparece (con su nota si ya no sirve): si faltara, el selector enseñaría otra opción y al
 * guardar se cambiaría la zona sin que nadie lo viera.
 */
export function rateZoneOptions(
  zones: readonly ShippingZone[],
  currentZoneId: string | null,
): RateZoneOption[] {
  const byId = new Map(zones.map((z) => [z.id, z]));
  const options: RateZoneOption[] = [
    { value: "", label: t("admin.shipping.rates.rules.zone.any") },
  ];
  for (const zone of zones) {
    if (zone.allowed && !zone.archived) {
      options.push({ value: zone.id, label: ruleZoneLabel(zone.id, byId) });
    }
  }
  if (currentZoneId !== null && !options.some((o) => o.value === currentZoneId)) {
    options.push({
      value: currentZoneId,
      label: byId.has(currentZoneId)
        ? ruleZoneLabel(currentZoneId, byId)
        : t("admin.shipping.rates.rules.form.zoneUnknown"),
    });
  }
  return options;
}

/** Archivar esta regla deja al método sin ninguna tarifa activa (la cotización fallaría con «sin tarifa»). */
export function isLastLiveRule(rule: RateRule, rates: readonly RateRule[]): boolean {
  const live = (r: RateRule) => r.isActive && !r.archived && r.methodId === rule.methodId;
  return live(rule) && !rates.some((r) => r.id !== rule.id && live(r));
}
