import { t } from "@/i18n";
import type { QuoteSlot } from "./types";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * AAAA-MM-DD (un día del calendario del negocio, sin hora ni zona) → un instante a las 12:00 UTC de ese día. NUNCA se usa
 * `new Date("AAAA-MM-DD")`: esa forma se interpreta como medianoche UTC, y en una zona con UTC negativo (Bolivia es UTC−4)
 * el día local resultante es el ANTERIOR (el lunes se vería «dom»). A mediodía UTC el día es el mismo en cualquier zona
 * real, y aun así se formatea con `timeZone: "UTC"` para que no dependa de la del dispositivo.
 * Devuelve `null` si no es una fecha real (`2026-02-31` no existe: JavaScript la desbordaría a marzo en silencio).
 */
export function isoDateToUtcNoon(iso: string): Date | null {
  const match = ISO_DATE.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const same =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return same ? date : null;
}

/**
 * «lun 9 nov». Si no es una fecha válida devuelve el texto recibido (es lo único que se puede decir sin inventar).
 * El formateador se crea en cada llamada a propósito: así toma la configuración vigente y la prueba de zonas horarias
 * puede comprobar que el resultado no cambia con la zona del dispositivo.
 */
export function formatSlotDate(iso: string): string {
  const date = isoDateToUtcNoon(iso);
  if (!date) return iso;
  const parts = new Intl.DateTimeFormat("es-BO", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).formatToParts(date);
  const part = (type: string) =>
    (parts.find((p) => p.type === type)?.value ?? "").replace(/\.$/, "");
  return `${part("weekday")} ${part("day")} ${part("month")}`;
}

/** «10:00 a 12:00». Las horas llegan ya como HH:MM del servidor: no se interpretan ni se convierten de zona. */
export function formatSlotRange(start: string, end: string): string {
  return t("shipping.slots.range", { start, end });
}

export interface SlotDay {
  /** AAAA-MM-DD. */
  date: string;
  /** «lun 9 nov». */
  label: string;
  slots: QuoteSlot[];
}

/**
 * Agrupa las franjas por día, en orden cronológico (fecha y luego hora de inicio). No filtra nada: las llenas siguen en la
 * lista (se muestran deshabilitadas). El orden del servidor no se da por supuesto.
 */
export function groupSlotsByDate(slots: readonly QuoteSlot[]): SlotDay[] {
  const byDate = new Map<string, QuoteSlot[]>();
  for (const slot of slots) {
    const day = byDate.get(slot.date);
    if (day) day.push(slot);
    else byDate.set(slot.date, [slot]);
  }
  return [...byDate.keys()].sort().map((date) => ({
    date,
    label: formatSlotDate(date),
    slots: (byDate.get(date) ?? [])
      .slice()
      .sort((a, b) => a.start.localeCompare(b.start) || a.slotId.localeCompare(b.slotId)),
  }));
}
