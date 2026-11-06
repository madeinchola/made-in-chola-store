import { DISPLAY_TIMEZONE } from "@/lib/datetime";

/**
 * Fechas de calendario (AAAA-MM-DD, el día en La Paz) del panel de Entregas y del simulador.
 *
 * TRAMPA que evitan estas funciones: `new Date("2026-11-09")` es la medianoche UTC. En una zona con UTC negativo (La Paz es
 * UTC−4) esa medianoche cae el DÍA ANTERIOR y «lunes 9» se mostraría como «domingo 8». Una fecha de calendario no es un
 * instante: se construye a las 12:00 UTC (a salvo de cualquier desfase de ±12 h) y se formatea siempre con `timeZone: "UTC"`.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** AAAA-MM-DD → sus partes, o null si no es una fecha REAL del calendario (`2026-02-31` no lo es). */
export function parseIsoDate(value: string): CalendarDate | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? { year, month, day } : null;
}

/** El instante «mediodía UTC» de una fecha de calendario; null si no es una fecha real. */
export function isoDateToNoonUtc(value: string): Date | null {
  const parts = parseIsoDate(value);
  return parts ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)) : null;
}

/** Día de la semana ISO de una fecha: 1 = lunes … 7 = domingo; null si no es una fecha real. */
export function isoWeekday(value: string): number | null {
  const date = isoDateToNoonUtc(value);
  if (!date) return null;
  const day = date.getUTCDay(); // 0 = domingo
  return day === 0 ? 7 : day;
}

const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string =>
  (parts.find((p) => p.type === type)?.value ?? "").replace(/\.$/, "");

/**
 * «mar 10 nov» (con `year: true`, «mar 10 nov 2026»). Una fecha que no es real se devuelve tal cual: la pantalla nunca
 * se rompe por un texto raro que llegue de la base.
 */
export function formatShortDate(value: string, options: { year?: boolean } = {}): string {
  const date = isoDateToNoonUtc(value);
  if (!date) return value;
  const parts = new Intl.DateTimeFormat("es-BO", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(options.year ? { year: "numeric" } : {}),
  }).formatToParts(date);
  const words = [part(parts, "weekday"), part(parts, "day"), part(parts, "month")];
  if (options.year) words.push(part(parts, "year"));
  return words.join(" ");
}

/** «martes 10 de noviembre de 2026». */
export function formatLongDate(value: string): string {
  const date = isoDateToNoonUtc(value);
  if (!date) return value;
  return new Intl.DateTimeFormat("es-BO", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/** La fecha de HOY en La Paz (AAAA-MM-DD), no en UTC ni en la zona del navegador: a las 22:00 en La Paz ya es mañana en UTC. */
export function todayInLaPaz(now: Date = new Date()): string {
  // El locale sueco da «AAAA-MM-DD» (mismo truco que `toLaPazInputValue`).
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Orden de fechas AAAA-MM-DD (el orden de texto es el cronológico). */
export function compareIsoDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
