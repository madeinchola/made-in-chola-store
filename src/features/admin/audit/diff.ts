import { t } from "@/i18n";
import type { AuditAction } from "./tables";

/** Una columna del cambio registrado en `audit_log.diff`. */
export type DiffEntry =
  | { key: string; kind: "changed"; old: unknown; new: unknown }
  /** Columna con datos personales: la base guarda SOLO que cambió (o "[redacted]"), nunca el valor. */
  | { key: string; kind: "redacted" }
  | { key: string; kind: "value"; value: unknown };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const REDACTED = "[redacted]";

/**
 * Interpreta el `diff` según la acción (así lo escribe `audit_changes()`):
 *  - UPDATE: cada columna cambiada es `{old, new}`, o `{changed: true}` si es PII.
 *  - INSERT / DELETE: cada columna con su valor (o `"[redacted]"` si es PII).
 * Un `diff` con otra forma (nulo, arreglo, texto) devuelve lista vacía: nunca rompe la pantalla. Orden alfabético.
 */
export function diffEntries(action: AuditAction, diff: unknown): DiffEntry[] {
  if (!isPlainObject(diff)) return [];
  const entries: DiffEntry[] = [];
  for (const key of Object.keys(diff).sort()) {
    const value = diff[key];
    if (action === "UPDATE" && isPlainObject(value)) {
      if (value.changed === true) entries.push({ key, kind: "redacted" });
      else if ("old" in value || "new" in value)
        entries.push({ key, kind: "changed", old: value.old, new: value.new });
      else entries.push({ key, kind: "value", value });
    } else if (value === REDACTED) {
      entries.push({ key, kind: "redacted" });
    } else {
      entries.push({ key, kind: "value", value });
    }
  }
  return entries;
}

const MAX_VALUE_CHARS = 200;

/** Valor legible: nulo, vacío, sí/no, número, texto o JSON compacto; los textos largos se cortan. */
export function formatDiffValue(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) return t("admin.audit.value.null");
  if (typeof value === "string") text = value === "" ? t("admin.audit.value.empty") : value;
  else if (typeof value === "boolean") text = value ? t("admin.yes") : t("admin.no");
  else if (typeof value === "number") text = String(value);
  else text = JSON.stringify(value) ?? "";
  return [...text].length > MAX_VALUE_CHARS
    ? `${[...text].slice(0, MAX_VALUE_CHARS).join("")}…`
    : text;
}

const LABEL_KEYS = ["name", "message", "code", "label", "slug", "key", "title"] as const;

/** Nombre reconocible de la fila en un alta o baja ("Camisa Chola"); null si el diff no trae ninguno. */
export function entityLabel(diff: unknown): string | null {
  if (!isPlainObject(diff)) return null;
  for (const key of LABEL_KEYS) {
    const value = diff[key];
    if (typeof value === "string" && value.trim() !== "" && value !== REDACTED) return value;
  }
  return null;
}

const SUMMARY_KEYS = 3;

/** Resumen de una línea: «Cambió: name, slug +1», «Creado: "Camisa"», «Eliminado». */
export function changeSummary(action: AuditAction, diff: unknown): string {
  if (action === "UPDATE") {
    const keys = diffEntries(action, diff).map((e) => e.key);
    if (keys.length === 0) return t("admin.audit.summary.updatedNoDetail");
    const shown = keys.slice(0, SUMMARY_KEYS).join(", ");
    return t("admin.audit.summary.updated", {
      fields: keys.length > SUMMARY_KEYS ? `${shown} +${keys.length - SUMMARY_KEYS}` : shown,
    });
  }
  const label = entityLabel(diff);
  if (action === "INSERT")
    return label
      ? t("admin.audit.summary.createdNamed", { label })
      : t("admin.audit.summary.created");
  return label
    ? t("admin.audit.summary.deletedNamed", { label })
    : t("admin.audit.summary.deleted");
}
