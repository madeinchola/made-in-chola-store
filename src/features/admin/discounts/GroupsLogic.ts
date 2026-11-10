import { t } from "@/i18n";
import type { CustomerGroup, Discount, GroupInput } from "./types";

/** Lógica PURA de los grupos de clientes: orden, formulario, descuentos que dependen de un grupo y búsqueda. Sin React ni red. */

export const MAX_GROUP_NAME = 80;
export const MAX_GROUP_DESCRIPTION = 300;
/** Mínimo de letras para buscar clientas. */
export const MIN_SEARCH_LENGTH = 2;

/** Los vigentes primero y los archivados al final; dentro de cada bloque se respeta el orden de la base. */
export function sortGroups(groups: readonly CustomerGroup[]): CustomerGroup[] {
  return [...groups.filter((g) => !g.archived), ...groups.filter((g) => g.archived)];
}

/** Réplica de `char_length()` de Postgres: cuenta caracteres (puntos de código), no unidades UTF-16. */
const length = (text: string): number => [...text].length;

/** Réplica del índice único `lower(btrim(name))` entre los grupos no archivados. */
const nameKey = (name: string): string => name.trim().toLowerCase();

export interface GroupFormValues {
  name: string;
  description: string;
}
export interface GroupFormErrors {
  name?: "required" | "tooLong" | "duplicate";
  description?: "tooLong";
}
export type GroupFormResult =
  { ok: true; value: GroupInput } | { ok: false; errors: GroupFormErrors };

export const groupFormFrom = (group: CustomerGroup | null): GroupFormValues => ({
  name: group?.name ?? "",
  description: group?.description ?? "",
});

/**
 * Valida el formulario. El nombre no puede repetirse (sin importar mayúsculas) con otro grupo NO archivado; el grupo que se
 * edita no cuenta contra sí mismo. La descripción vacía se guarda como «sin descripción» (null).
 */
export function validateGroupForm(
  values: GroupFormValues,
  options: { existing: readonly CustomerGroup[]; editingId: string | null },
): GroupFormResult {
  const errors: GroupFormErrors = {};
  const name = values.name.trim();
  const description = values.description.trim();
  if (name === "") errors.name = "required";
  else if (length(name) > MAX_GROUP_NAME) errors.name = "tooLong";
  else if (
    options.existing.some(
      (g) => !g.archived && g.id !== options.editingId && nameKey(g.name) === nameKey(name),
    )
  )
    errors.name = "duplicate";
  if (length(description) > MAX_GROUP_DESCRIPTION) errors.description = "tooLong";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, description: description === "" ? null : description } };
}

export function groupFieldErrors(errors: GroupFormErrors): { name?: string; description?: string } {
  const K = "admin.discounts.groups.form.errors" as const;
  const out: { name?: string; description?: string } = {};
  if (errors.name === "required") out.name = t(`${K}.nameRequired`);
  if (errors.name === "tooLong") out.name = t(`${K}.nameTooLong`);
  if (errors.name === "duplicate") out.name = t(`${K}.nameDuplicate`);
  if (errors.description) out.description = t(`${K}.descriptionTooLong`);
  return out;
}

/** Los descuentos vigentes (no archivados) que dan su precio a este grupo: archivarlo los deja sin efecto. */
export function discountsUsingGroup(groupId: string, discounts: readonly Discount[]): Discount[] {
  return discounts.filter((d) => !d.archived && d.customerGroupId === groupId);
}

/** «A, B, C» o, si son más de `max`, «A, B, C y 2 más». */
export function summarizeNames(names: readonly string[], max = 3): string {
  if (names.length <= max) return names.join(", ");
  return t("admin.discounts.groups.confirmArchive.moreNames", {
    names: names.slice(0, max).join(", "),
    count: names.length - max,
  });
}

/** Texto de la advertencia al archivar: cuántos descuentos dejarán de aplicarse y cuáles (vacío si ninguno). */
export function archiveImpactText(groupId: string, discounts: readonly Discount[]): string {
  const used = discountsUsingGroup(groupId, discounts);
  const K = "admin.discounts.groups.confirmArchive" as const;
  const names = summarizeNames(used.map((d) => d.name));
  if (used.length === 0) return "";
  return used.length === 1
    ? t(`${K}.usedByOne`, { names })
    : t(`${K}.usedByMany`, { count: used.length, names });
}

export function memberCountText(count: number): string {
  const K = "admin.discounts.groups.members" as const;
  if (count === 0) return t(`${K}.none`);
  return count === 1 ? t(`${K}.one`) : t(`${K}.count`, { count });
}

/** Nombre y correo de un miembro tal como se muestran; sin dato, un texto claro en vez de un hueco. */
export const memberName = (fullName: string | null): string =>
  fullName !== null && fullName.trim() !== ""
    ? fullName
    : t("admin.discounts.groups.membersDialog.noName");
