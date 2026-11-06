import { charLength } from "../config/pgText";
import { compareIsoDates, parseIsoDate } from "./SlotsDates";
import type { BlockedDate } from "./types";

/** Lógica PURA de las fechas bloqueadas (orden de la lista y validación del formulario). Sin React ni red. */

export const MAX_BLOCKED_REASON = 120;

export interface BlockedGroups {
  /** De hoy en adelante, la más cercana primero. */
  upcoming: BlockedDate[];
  /** Anteriores a hoy, la más reciente primero. */
  past: BlockedDate[];
  /** Archivadas (sea cual sea su fecha), la más reciente primero. */
  archived: BlockedDate[];
}

/**
 * Reparte las fechas bloqueadas para la lista: primero las futuras (hoy cuenta como futura: todavía se puede entregar o no),
 * luego las pasadas, y las archivadas en un bloque aparte. `today` es AAAA-MM-DD en La Paz.
 */
export function splitBlockedDates(dates: readonly BlockedDate[], today: string): BlockedGroups {
  const live = dates.filter((d) => !d.archived);
  return {
    upcoming: live
      .filter((d) => compareIsoDates(d.blockedOn, today) >= 0)
      .sort((a, b) => compareIsoDates(a.blockedOn, b.blockedOn) || a.id.localeCompare(b.id)),
    past: live
      .filter((d) => compareIsoDates(d.blockedOn, today) < 0)
      .sort((a, b) => compareIsoDates(b.blockedOn, a.blockedOn) || a.id.localeCompare(b.id)),
    archived: dates
      .filter((d) => d.archived)
      .sort((a, b) => compareIsoDates(b.blockedOn, a.blockedOn) || a.id.localeCompare(b.id)),
  };
}

/** Una fecha pasada SE PUEDE registrar (queda como historial), pero se avisa de que no cambia nada hacia adelante. */
export const isPastDate = (blockedOn: string, today: string): boolean =>
  parseIsoDate(blockedOn) !== null && compareIsoDates(blockedOn, today) < 0;

export interface BlockedFormValues {
  /** AAAA-MM-DD ("" si no se eligió). */
  blockedOn: string;
  reason: string;
}

export interface BlockedFormErrors {
  blockedOn?: "required" | "invalid" | "duplicate";
  reason?: "tooLong";
}

export type BlockedFormResult =
  | { ok: true; value: { blockedOn: string; reason: string | null } }
  | { ok: false; errors: BlockedFormErrors };

/**
 * Valida el formulario. Al CREAR se exige una fecha real y que ese día no esté ya bloqueado (entre las no archivadas: la base
 * lo rechazaría igual); al EDITAR la fecha no se toca, solo el motivo. El motivo vacío o de espacios se guarda como «sin
 * motivo» (null).
 */
export function validateBlockedForm(
  values: BlockedFormValues,
  context: { mode: "create" | "edit"; existing: readonly BlockedDate[] },
): BlockedFormResult {
  const errors: BlockedFormErrors = {};
  if (context.mode === "create") {
    if (values.blockedOn === "") errors.blockedOn = "required";
    else if (parseIsoDate(values.blockedOn) === null) errors.blockedOn = "invalid";
    else if (context.existing.some((d) => !d.archived && d.blockedOn === values.blockedOn)) {
      errors.blockedOn = "duplicate";
    }
  }
  const reason = values.reason.trim();
  if (charLength(reason) > MAX_BLOCKED_REASON) errors.reason = "tooLong";
  if (errors.blockedOn || errors.reason) return { ok: false, errors };
  return {
    ok: true,
    value: { blockedOn: values.blockedOn, reason: reason === "" ? null : reason },
  };
}
