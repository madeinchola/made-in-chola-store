import { DISPLAY_TIMEZONE } from "@/lib/datetime";
import { formatMoney, fromDecimal } from "@/lib/money";
import type {
  CurrencySummary,
  DateRange,
  Granularity,
  Kpis,
  RangePreset,
  SalesSummary,
} from "./types";

/** El tope que acepta la base (`_report_bounds`): 731 días. */
export const MAX_RANGE_DAYS = 731;

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `AAAA-MM-DD` válido y real (no existe el 31 de febrero). */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Hoy en La Paz (`AAAA-MM-DD`): el panel no usa la fecha del navegador, que puede estar en otra zona. */
export function laPazToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Días del rango, contando los dos extremos. */
export function daysInRange(range: DateRange): number {
  return (
    Math.round(
      (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / DAY_MS,
    ) + 1
  );
}

export function presetRange(preset: Exclude<RangePreset, "custom">, today: string): DateRange {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "last_month": {
      const firstThis = `${today.slice(0, 8)}01`;
      const lastPrev = addDays(firstThis, -1);
      return { from: `${lastPrev.slice(0, 8)}01`, to: lastPrev };
    }
  }
}

export type RangeProblem = "invalid" | "order" | "too_long";

/** Lo que está mal en un rango escrito a mano (o null). La base lo vuelve a comprobar. */
export function rangeProblem(range: DateRange): RangeProblem | null {
  if (!isIsoDate(range.from) || !isIsoDate(range.to)) return "invalid";
  if (range.from > range.to) return "order";
  if (daysInRange(range) > MAX_RANGE_DAYS) return "too_long";
  return null;
}

/** Hasta un mes, día por día; hasta medio año, por semana; más, por mes (un gráfico de 700 barras no se lee). */
export function granularityFor(range: DateRange): Granularity {
  const days = daysInRange(range);
  return days <= 31 ? "day" : days <= 180 ? "week" : "month";
}

/** Cambio porcentual contra el período anterior; `null` si no se puede calcular (no había anterior o era cero). */
export function percentChange(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

const nf = new Intl.NumberFormat("es-BO", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("es-BO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatInt(value: number): string {
  return nf.format(value);
}

/** «49,1 %» (coma decimal, como el resto de la tienda). */
export function formatPercent(value: number): string {
  return `${nf1.format(value)} %`;
}

/** Importe en su moneda («Bs 1.234,50»); el redondeo es el de la moneda (mitades hacia afuera), como en el resto del panel. */
export function formatAmount(value: number, currency: string): string {
  return formatMoney(fromDecimal(value, currency));
}

/** Cambio con signo para mostrar: «+12,5 %», «−3,0 %», «0,0 %». */
export function formatDelta(pct: number): string {
  const body = nf1.format(Math.abs(pct));
  return pct > 0 ? `+${body} %` : pct < 0 ? `−${body} %` : `${body} %`;
}

const labelDay = new Intl.DateTimeFormat("es-BO", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});
const labelMonth = new Intl.DateTimeFormat("es-BO", {
  timeZone: "UTC",
  month: "short",
  year: "numeric",
});

/** Etiqueta de un cubo de la serie. Los cubos son fechas sin hora: se leen en UTC para que no salten de día. */
export function bucketLabel(bucket: string, granularity: Granularity): string {
  const d = new Date(`${bucket}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return bucket;
  return granularity === "month" ? labelMonth.format(d) : labelDay.format(d);
}

/** Texto largo para el eje, el tooltip y la tabla: la semana dice desde cuándo empieza. */
export function bucketTitle(bucket: string, granularity: Granularity): string {
  const label = bucketLabel(bucket, granularity);
  return granularity === "week" ? `Semana del ${label}` : label;
}

export type MarginState = "none" | "unknown" | "partial" | "full";

/** Qué se sabe del margen: sin pedidos, desconocido (ningún pedido con costos), parcial o completo. */
export function marginState(kpis: Kpis): MarginState {
  if (kpis.orders === 0) return "none";
  if (kpis.costed_orders === 0) return "unknown";
  return kpis.costed_orders < kpis.orders ? "partial" : "full";
}

export function hasSales(summary: SalesSummary | undefined): boolean {
  return (summary?.currencies ?? []).some((c) => c.current.orders > 0);
}

/** La moneda elegida si existe en el resumen; si no, la primera con más pedidos (la que más mueve la tienda). */
export function pickCurrency(
  summary: SalesSummary | undefined,
  selected: string | null,
): CurrencySummary | undefined {
  const list = summary?.currencies ?? [];
  return (
    list.find((c) => c.currency === selected) ??
    [...list].sort((a, b) => b.current.orders - a.current.orders)[0]
  );
}

/** Parte de un total en %, con un decimal (0 si el total es cero). */
export function shareOf(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
}

export const RANGE_PRESETS: readonly Exclude<RangePreset, "custom">[] = [
  "today",
  "7d",
  "30d",
  "month",
  "last_month",
];

/** Etiqueta de un método de pago (el código es el de la base). */
export function paymentMethodLabel(code: string): string {
  switch (code) {
    case "whatsapp":
      return "WhatsApp";
    case "qr_manual":
      return "QR (comprobante)";
    case "qr_auto":
      return "QR automático";
    case "cash_on_delivery":
      return "Contra entrega";
    default:
      return code;
  }
}

export function channelLabel(code: string): string {
  switch (code) {
    case "web":
      return "Tienda web";
    case "whatsapp":
      return "WhatsApp";
    case "manual":
      return "Pedido manual";
    default:
      return code;
  }
}

const labelFull = new Intl.DateTimeFormat("es-BO", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** `AAAA-MM-DD` → «2 mar 2020» (una fecha sin hora no cambia de día por la zona del navegador). */
export function formatRangeDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : labelFull.format(d);
}

const RANGE_PRESET_SET: ReadonlySet<string> = new Set([...RANGE_PRESETS, "custom"]);

export function isRangePreset(value: string | null): value is RangePreset {
  return value !== null && RANGE_PRESET_SET.has(value);
}
