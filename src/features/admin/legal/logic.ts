import type { MessageKey } from "@/i18n";
import { usedVariables } from "@/features/legal/renderLegal";
import { pendingMarkers } from "@/features/legal/starterTexts";
import type { OverviewRow, VersionSummary } from "./types";

/** Las variables que existen y qué ajuste del negocio las llena (nombres de los ajustes públicos de la tienda). */
export const BUSINESS_VARIABLES = [
  "razon_social",
  "nit",
  "direccion",
  "correo",
  "telefono",
] as const;

/** Bolivia no usa horario de verano: La Paz es UTC−4 todo el año. */
const LA_PAZ_OFFSET = "-04:00";
const MAX_BODY = 60_000;
const MIN_BODY = 20;

const laPaz = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", ...options });

export const formatDate = (iso: string) =>
  laPaz({ day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));

export const formatDateTime = (iso: string) =>
  laPaz({
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));

/** `2026-11-20T09:30` (lo que da un `datetime-local`, en hora de La Paz) → instante ISO; `null` si no es una fecha válida. */
export function laPazToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const date = new Date(`${local}:00${LA_PAZ_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Un instante → el valor de un `datetime-local` en hora de La Paz (para el valor mínimo y por omisión). */
export function isoToLaPazLocal(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() - 4 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16);
}

export interface BodyCheck {
  ok: boolean;
  /** Variables escritas que no existen (un error de tipeo como `{{razon}}`). */
  unknown: string[];
  /** Variables que existen pero el negocio todavía no tiene definidas. */
  empty: string[];
  /** Marcas de borrador o por completar que siguen en el texto. */
  pending: string[];
}

/** Lo que impide publicar un texto. El guardado de borradores no se bloquea por esto: se puede guardar a medias. */
export function checkBody(body: string, vars: Record<string, string>): BodyCheck {
  const used = usedVariables(body);
  const unknown = used.filter((name) => !(BUSINESS_VARIABLES as readonly string[]).includes(name));
  const empty = used.filter(
    (name) =>
      (BUSINESS_VARIABLES as readonly string[]).includes(name) && (vars[name] ?? "").trim() === "",
  );
  const pending = pendingMarkers(body);
  return { ok: unknown.length + empty.length + pending.length === 0, unknown, empty, pending };
}

/** Las mismas reglas que la base al guardar; la base manda, esto solo evita ir y volver. */
export function validateBody(body: string): "invalid_body" | "html_not_allowed" | null {
  if (body.trim().length < MIN_BODY || body.length > MAX_BODY) return "invalid_body";
  if (/<[a-zA-Z/!]/.test(body)) return "html_not_allowed";
  return null;
}

export type DisplayStatus = "draft" | "current" | "scheduled" | "replaced";

/** Estado de cada versión a una hora dada: la vigente es la última publicada que ya rige; las que rigen después están programadas. */
export function versionStatuses(
  versions: VersionSummary[],
  now: Date = new Date(),
): Map<number, DisplayStatus> {
  const result = new Map<number, DisplayStatus>();
  let currentFound = false;
  for (const v of [...versions].sort((a, b) => b.version - a.version)) {
    if (v.status === "draft") result.set(v.version, "draft");
    else if (v.effectiveAt !== null && new Date(v.effectiveAt) > now)
      result.set(v.version, "scheduled");
    else if (!currentFound) {
      currentFound = true;
      result.set(v.version, "current");
    } else result.set(v.version, "replaced");
  }
  return result;
}

/** El número que tendrá el borrador al guardarlo: el del borrador que ya hay o el siguiente a la última versión. */
export function draftVersion(row: OverviewRow | undefined): number {
  const draft = row?.versions.find((v) => v.status === "draft");
  if (draft) return draft.version;
  return (row?.versions[0]?.version ?? 0) + 1;
}

const KNOWN_ERRORS = new Set([
  "no_draft",
  "effective_in_past",
  "change_note_required",
  "invalid_body",
  "html_not_allowed",
  "invalid_kind",
]);

/** El código con el que la base rechazó la operación (las funciones lanzan el código como mensaje) o `unknown`. */
export function legalErrorKey(error: unknown): MessageKey {
  const message = error instanceof Error ? error.message.trim() : "";
  const code = KNOWN_ERRORS.has(message) ? message : "unknown";
  return `admin.legal.errors.${code}` as MessageKey;
}
