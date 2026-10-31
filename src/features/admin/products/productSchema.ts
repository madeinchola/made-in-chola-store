import { z } from "zod";
import { t } from "@/i18n";
import { parseAmount, type AmountProblem } from "../lib/amount";

// Reglas idénticas a las restricciones CHECK de la base (products, product_colors, product_sizes).
export const CODE_RE = /^[A-Za-z0-9._-]{1,40}$/;
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
export const MAX_COLOR_NAME = 40;
export const MAX_SIZE_LABEL = 20;
/** Tope de colores y de tallas por producto en el panel (12 × 10 = 120 variantes ya es mucho). */
export const MAX_ITEMS = 30;

/**
 * Texto plano: normaliza saltos de línea y quita caracteres de control (salvo salto de línea y tabulación). Se recorre
 * carácter a carácter en vez de usar una expresión regular con rangos de control (más claro y sin falsos positivos).
 */
export function cleanText(value: string): string {
  let out = "";
  for (const ch of value.replace(/\r\n?/g, "\n")) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || (code >= 32 && code !== 127)) out += ch;
  }
  return out;
}

export function amountErrorMessage(problem: AmountProblem, decimals: number): string {
  switch (problem) {
    case "empty":
      return t("admin.products.errors.amountEmpty");
    case "format":
      return t("admin.products.errors.amountFormat");
    case "decimals":
      return t("admin.products.errors.amountDecimals", { decimals });
    case "not_positive":
      return t("admin.products.errors.amountNotPositive");
    case "too_large":
      return t("admin.products.errors.amountTooLarge");
  }
}

/** Costo opcional en BOB: vacío vale, 0 vale, hasta 2 decimales. */
function costIssue(value: string): string | null {
  if (value.trim() === "") return null;
  const r = parseAmount(value, { decimals: 2, allowZero: true });
  return r.ok ? null : amountErrorMessage(r.problem, 2);
}

export const productDataSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, t("admin.products.errors.nameRequired"))
    .max(160, t("admin.products.errors.nameTooLong")),
  code: z
    .string()
    .trim()
    .min(1, t("admin.products.errors.codeRequired"))
    .regex(CODE_RE, t("admin.products.errors.codeFormat")),
  slug: z
    .string()
    .trim()
    .min(1, t("admin.products.errors.slugRequired"))
    .max(80, t("admin.products.errors.slugTooLong"))
    .regex(SLUG_RE, t("admin.products.errors.slugFormat")),
  model: z.string().trim().max(120, t("admin.products.errors.modelTooLong")),
  description: z.string().max(5000, t("admin.products.errors.descriptionTooLong")),
  materials: z.string().trim().max(1000, t("admin.products.errors.materialsTooLong")),
  washcare: z.string().trim().max(1000, t("admin.products.errors.washcareTooLong")),
  costBase: z.string().superRefine((value, ctx) => {
    const message = costIssue(value);
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  }),
  outOfStockBehavior: z.enum(["sold_out", "hide"]),
  isNew: z.boolean(),
  allowConvertedPrices: z.boolean(),
});

export type ProductDataValues = z.infer<typeof productDataSchema>;

/** Columnas de `products` que escribe el formulario de datos (vacío → NULL en las opcionales). */
export interface ProductDataPatch {
  name: string;
  code: string;
  slug: string;
  model: string | null;
  description: string;
  materials: string | null;
  washcare: string | null;
  cost_base: number | null;
  out_of_stock_behavior: "sold_out" | "hide";
  is_new: boolean;
  allow_converted_prices: boolean;
}

const orNull = (s: string): string | null => (s.trim() === "" ? null : s.trim());

export function toProductPatch(values: ProductDataValues): ProductDataPatch {
  const cost = parseAmount(values.costBase, { decimals: 2, allowZero: true });
  return {
    name: values.name.trim(),
    code: values.code.trim(),
    slug: values.slug.trim(),
    model: orNull(cleanText(values.model)),
    description: cleanText(values.description).trim(),
    materials: orNull(cleanText(values.materials)),
    washcare: orNull(cleanText(values.washcare)),
    // Hasta 9 dígitos y 2 decimales: un number representa el valor exacto.
    cost_base: cost.ok ? Number(cost.value) : null,
    out_of_stock_behavior: values.outOfStockBehavior,
    is_new: values.isNew,
    allow_converted_prices: values.allowConvertedPrices,
  };
}

// ── Listas de colores y tallas (validadas a mano: son pequeñas y acotadas por la interfaz) ───────────────

export interface ColorDraft {
  name: string;
  /** "" = sin tono. */
  hex: string;
}

export type ListErrors = Record<number, string>;

/** Errores por posición. Colores: nombre 1–40, único sin distinguir mayúsculas, tono opcional #RRGGBB. */
export function validateColors(colors: readonly ColorDraft[]): ListErrors {
  const errors: ListErrors = {};
  const seen = new Map<string, number>();
  colors.forEach((c, i) => {
    const name = c.name.trim();
    if (name === "") errors[i] = t("admin.products.colorsSizes.colorRequired");
    else if (name.length > MAX_COLOR_NAME) errors[i] = t("admin.products.errors.nameTooLong");
    else if (seen.has(name.toLowerCase()))
      errors[i] = t("admin.products.colorsSizes.duplicateName");
    else if (c.hex.trim() !== "" && !HEX_RE.test(c.hex.trim()))
      errors[i] = t("admin.products.colorsSizes.invalidHex");
    seen.set(name.toLowerCase(), i);
  });
  return errors;
}

/** Tallas: 1–20 caracteres, únicas sin distinguir mayúsculas. */
export function validateSizes(sizes: readonly string[]): ListErrors {
  const errors: ListErrors = {};
  const seen = new Set<string>();
  sizes.forEach((s, i) => {
    const label = s.trim();
    if (label === "") errors[i] = t("admin.products.colorsSizes.sizeRequired");
    else if (label.length > MAX_SIZE_LABEL) errors[i] = t("admin.products.errors.nameTooLong");
    else if (seen.has(label.toLowerCase()))
      errors[i] = t("admin.products.colorsSizes.duplicateSize");
    seen.add(label.toLowerCase());
  });
  return errors;
}
