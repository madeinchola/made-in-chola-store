import { t } from "@/i18n";
import type { adminAnalytics } from "@/i18n/admin/analytics";
import type { RowProblem } from "./types";

type ErrorCode = keyof typeof adminAnalytics.import.errors;
type FieldKey = keyof typeof adminAnalytics.import.fields;

const ERROR_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  "required",
  "invalid_format",
  "too_many_decimals",
  "too_long",
  "too_large",
  "price_invalid",
  "currency_unknown",
  "category_not_found",
  "parent_not_found",
  "product_not_found",
  "sku_not_found",
  "sku_conflict",
  "variant_exists_other_sku",
  "below_reserved",
  "product_archived",
  "variant_archived",
  "category_archived",
  "cycle",
  "duplicate_in_file",
  "duplicate",
  "formula",
  "number_ambiguous",
  "db_error",
  "unknown",
]);
const FIELD_KEYS: ReadonlySet<string> = new Set<FieldKey>([
  "code",
  "name",
  "description",
  "model",
  "materials",
  "washcare",
  "cost",
  "price",
  "currency",
  "categories",
  "color",
  "color_hex",
  "size",
  "sku",
  "stock",
  "parent",
  "slug",
]);

/** El nombre de un campo en palabras (el de la plantilla); un campo que no conoce se muestra tal cual. */
export function fieldLabel(field: string): string {
  return FIELD_KEYS.has(field) ? t(`admin.analytics.import.fields.${field as FieldKey}`) : field;
}

/** Un problema de fila en una frase que se entiende sin saber nada de la base. */
export function explainProblem(problem: RowProblem): string {
  const code = (ERROR_CODES.has(problem.code) ? problem.code : "unknown") as ErrorCode;
  return t(`admin.analytics.import.errors.${code}`, { field: fieldLabel(problem.field) });
}
