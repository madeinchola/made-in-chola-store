import { z } from "zod";
import { t } from "@/i18n";
import { fromLaPazInputValue } from "@/lib/datetime";

// Reglas idénticas a las restricciones CHECK de `categories` y `collections`.
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME_MAX = 80;
const SLUG_MAX = 80;
export const CATEGORY_DESCRIPTION_MAX = 1000;
export const COLLECTION_DESCRIPTION_MAX = 2000;

const nameSchema = z
  .string()
  .trim()
  .min(1, t("admin.taxonomy.errors.nameRequired"))
  .max(NAME_MAX, t("admin.taxonomy.errors.nameTooLong"));

const slugSchema = z
  .string()
  .trim()
  .min(1, t("admin.taxonomy.errors.slugRequired"))
  .max(SLUG_MAX, t("admin.taxonomy.errors.slugTooLong"))
  .regex(SLUG_RE, t("admin.taxonomy.errors.slugFormat"));

export const categoryFormSchema = z.object({
  name: nameSchema,
  slug: slugSchema,
  description: z
    .string()
    .trim()
    .max(CATEGORY_DESCRIPTION_MAX, t("admin.taxonomy.errors.categoryDescriptionTooLong")),
  /** "" = categoría principal. */
  parentId: z.string(),
});
export type CategoryFormValues = z.infer<typeof categoryFormSchema>;

export interface CategoryInput {
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
}

export const toCategoryInput = (v: CategoryFormValues): CategoryInput => ({
  name: v.name.trim(),
  slug: v.slug.trim(),
  description: v.description.trim() === "" ? null : v.description.trim(),
  parentId: v.parentId === "" ? null : v.parentId,
});

export type WindowResult =
  | { ok: true; startsAt: string | null; endsAt: string | null }
  | { ok: false; field: "startsAt" | "endsAt"; problem: "invalid" | "order" };

/** Convierte las fechas del formulario (hora de La Paz) a UTC y comprueba que el fin sea posterior al inicio. */
export function parseWindow(startsAt: string, endsAt: string): WindowResult {
  let start: string | null;
  let end: string | null;
  try {
    start = fromLaPazInputValue(startsAt);
  } catch {
    return { ok: false, field: "startsAt", problem: "invalid" };
  }
  try {
    end = fromLaPazInputValue(endsAt);
  } catch {
    return { ok: false, field: "endsAt", problem: "invalid" };
  }
  if (start !== null && end !== null && new Date(end).getTime() <= new Date(start).getTime()) {
    return { ok: false, field: "endsAt", problem: "order" };
  }
  return { ok: true, startsAt: start, endsAt: end };
}

export const collectionFormSchema = z
  .object({
    name: nameSchema,
    slug: slugSchema,
    description: z
      .string()
      .trim()
      .max(COLLECTION_DESCRIPTION_MAX, t("admin.taxonomy.errors.collectionDescriptionTooLong")),
    startsAt: z.string(),
    endsAt: z.string(),
  })
  .superRefine((v, ctx) => {
    const w = parseWindow(v.startsAt, v.endsAt);
    if (w.ok) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [w.field],
      message: t(
        w.problem === "invalid"
          ? "admin.taxonomy.errors.dateInvalid"
          : "admin.taxonomy.errors.windowInvalid",
      ),
    });
  });
export type CollectionFormValues = z.infer<typeof collectionFormSchema>;

export interface CollectionInput {
  name: string;
  slug: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

/** Solo para valores ya validados por `collectionFormSchema`. */
export function toCollectionInput(v: CollectionFormValues): CollectionInput {
  const w = parseWindow(v.startsAt, v.endsAt);
  return {
    name: v.name.trim(),
    slug: v.slug.trim(),
    description: v.description.trim() === "" ? null : v.description.trim(),
    startsAt: w.ok ? w.startsAt : null,
    endsAt: w.ok ? w.endsAt : null,
  };
}
