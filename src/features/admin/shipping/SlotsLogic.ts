import type { SettingRow } from "../config/types";
import type { DeliverySlot, SlotUpdateInput } from "./types";

/** Lógica PURA de las franjas de entrega (agrupar por día, solapes, validación del formulario). Sin React ni red. */

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
/** ISO: 1 = lunes … 7 = domingo. */
export type Weekday = (typeof WEEKDAYS)[number];

/** Clave del nombre de cada día en los textos (`admin.shipping.delivery.weekdays.<clave>`). */
export const WEEKDAY_KEYS = {
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
  7: "sunday",
} as const satisfies Record<Weekday, string>;

export const MIN_CAPACITY = 1;
export const MAX_CAPACITY = 1000;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** «09:30» → 570 minutos desde la medianoche; null si no es una hora HH:MM válida. */
export function timeToMinutes(value: string): number | null {
  const match = HHMM.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** «09:00–11:00» (con raya). */
export const slotRangeText = (slot: Pick<DeliverySlot, "startTime" | "endTime">): string =>
  `${slot.startTime}–${slot.endTime}`;

export interface WeekdayGroup {
  weekday: Weekday;
  slots: DeliverySlot[];
}

/**
 * Las franjas de UN método repartidas de lunes a domingo (siempre los siete días, aunque no tengan franjas), cada día
 * ordenado por hora de inicio. Las archivadas se omiten salvo que se pidan.
 */
export function groupSlotsByWeekday(
  slots: readonly DeliverySlot[],
  methodId: string,
  options: { includeArchived?: boolean } = {},
): WeekdayGroup[] {
  const visible = slots.filter(
    (s) => s.methodId === methodId && (options.includeArchived === true || !s.archived),
  );
  return WEEKDAYS.map((weekday) => ({
    weekday,
    slots: visible
      .filter((s) => s.weekday === weekday)
      .sort(
        (a, b) =>
          (timeToMinutes(a.startTime) ?? 0) - (timeToMinutes(b.startTime) ?? 0) ||
          (timeToMinutes(a.endTime) ?? 0) - (timeToMinutes(b.endTime) ?? 0) ||
          Number(a.archived) - Number(b.archived) ||
          a.id.localeCompare(b.id),
      ),
  }));
}

export interface SlotCandidate {
  methodId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
  /** Al EDITAR: la propia franja, que no cuenta contra sí misma. */
  id?: string;
}

export interface SlotConflicts {
  /** Otra franja del mismo día que empieza a la MISMA hora: la base lo rechaza (índice único), así que bloquea. */
  sameStart: DeliverySlot | null;
  /** Franjas activas del mismo día cuyo horario se pisa con el de esta (advertencia, no bloqueo). */
  overlaps: DeliverySlot[];
}

/**
 * ¿Choca esta franja con otras del mismo método y día? Las archivadas no cuentan. El solape es de intervalos abiertos por
 * el borde: terminar a las 12:00 y empezar a las 12:00 NO se solapan. Una franja inactiva no se ofrece, así que no genera
 * advertencia (ni la recibe).
 */
export function findSlotConflicts(
  candidate: SlotCandidate,
  all: readonly DeliverySlot[],
): SlotConflicts {
  const none: SlotConflicts = { sameStart: null, overlaps: [] };
  const start = timeToMinutes(candidate.startTime);
  const end = timeToMinutes(candidate.endTime);
  if (start === null) return none;
  const siblings = all.filter(
    (s) =>
      s.methodId === candidate.methodId &&
      s.weekday === candidate.weekday &&
      !s.archived &&
      s.id !== candidate.id,
  );
  const sameStart = siblings.find((s) => timeToMinutes(s.startTime) === start) ?? null;
  if (end === null || end <= start || !candidate.isActive) return { sameStart, overlaps: [] };
  const overlaps = siblings.filter((s) => {
    if (!s.isActive || s === sameStart) return false;
    const sStart = timeToMinutes(s.startTime);
    const sEnd = timeToMinutes(s.endTime);
    return sStart !== null && sEnd !== null && start < sEnd && sStart < end;
  });
  return { sameStart, overlaps };
}

export interface SlotFormValues {
  weekday: number;
  startTime: string;
  endTime: string;
  /** Tal como se escribe: se valida aquí. */
  capacity: string;
  isActive: boolean;
}

export type SlotFieldProblem =
  | "startInvalid"
  | "sameStart"
  | "endInvalid"
  | "endNotAfterStart"
  | "capacityRequired"
  | "capacityInteger"
  | "capacityRange";

export interface SlotFormErrors {
  startTime?: Extract<SlotFieldProblem, "startInvalid" | "sameStart">;
  endTime?: Extract<SlotFieldProblem, "endInvalid" | "endNotAfterStart">;
  capacity?: Extract<SlotFieldProblem, "capacityRequired" | "capacityInteger" | "capacityRange">;
}

export type SlotFormResult =
  { ok: true; value: SlotUpdateInput } | { ok: false; errors: SlotFormErrors };

/**
 * Valida el formulario y arma lo que se manda a la base: SOLO `startTime`, `endTime`, `capacity` y `isActive` (el método y el
 * día se agregan al crear y no se cambian al editar). `sameStart` viene ya calculada con `findSlotConflicts`.
 */
export function validateSlotForm(
  values: SlotFormValues,
  conflicts: Pick<SlotConflicts, "sameStart">,
): SlotFormResult {
  const errors: SlotFormErrors = {};
  const start = timeToMinutes(values.startTime);
  const end = timeToMinutes(values.endTime);
  if (start === null) errors.startTime = "startInvalid";
  else if (conflicts.sameStart) errors.startTime = "sameStart";
  if (end === null) errors.endTime = "endInvalid";
  else if (start !== null && end <= start) errors.endTime = "endNotAfterStart";

  const capacityText = values.capacity.trim();
  let capacity = 0;
  if (capacityText === "") errors.capacity = "capacityRequired";
  else if (!/^\d+$/.test(capacityText)) errors.capacity = "capacityInteger";
  else {
    capacity = Number(capacityText);
    if (capacity < MIN_CAPACITY || capacity > MAX_CAPACITY) errors.capacity = "capacityRange";
  }

  if (errors.startTime || errors.endTime || errors.capacity) return { ok: false, errors };
  return {
    ok: true,
    value: {
      startTime: values.startTime,
      endTime: values.endTime,
      capacity,
      isActive: values.isActive,
    },
  };
}

/** Lee un ajuste numérico (entero) de la lista de ajustes; null si falta o no es un número. */
export function settingInt(rows: readonly SettingRow[] | undefined, key: string): number | null {
  const value = rows?.find((r) => r.key === key)?.value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}
