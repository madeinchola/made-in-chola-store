import { t, type MessageKey } from "@/i18n";

/**
 * Validación del número de documento de los datos fiscales, en DOS niveles según el ajuste público `tax_id_validation`:
 *
 * - `strict` (por defecto, también si el ajuste no carga): formato propio de cada tipo.
 *     · CI    4 a 10 dígitos + complemento opcional, separado por guion o espacio: `1234567`, `1234567-1A`,
 *             `1234567 1A`, `1234567-A` (sin distinguir mayúsculas). El complemento es una letra o un dígito y una letra.
 *     · NIT   7 a 13 dígitos (solo números).
 *     · CE    5 a 20 letras o números (carnet de extranjería).
 *     · PAS   5 a 20 letras o números (pasaporte).
 *     · OTRO  3 a 20 letras o números.
 * - `lenient`: cualquier documento de letras y números (más espacio, punto, barra y guion) de 3 a 24 caracteres, sin
 *   importar el tipo. Existe para no bloquear una venta si el formato real de un documento cambia.
 *
 * SUPUESTOS: los rangos de arriba NO son las reglas oficiales de verificación de NIT/CI de Bolivia (pendientes del
 * dueño, ver Sprint 6). Están pensados para descartar errores de tipeo evidentes sin rechazar documentos reales.
 * Cuando lleguen las reglas oficiales, cámbialas SOLO aquí (las constantes de `RANGES`).
 *
 * El valor devuelto es el CANÓNICO que se guarda: mayúsculas, espacios internos compactados y, en el CI estricto,
 * `dígitos[-complemento]` (así `1234567 1a` y `1234567-1A` no se registran como dos documentos distintos). La base
 * de datos vuelve a recortar y pasar a mayúsculas, y solo valida cordura (`^[A-Za-z0-9][A-Za-z0-9 ./-]{1,23}$`).
 *
 * Los caracteres se comprueban con clases ASCII explícitas (sin la bandera `i`/`u`): así «ı» o «ſ», que al pasar a
 * mayúsculas se vuelven «I» y «S», NO se cuelan como letras válidas.
 */

export const TAX_DOC_TYPES = ["ci", "nit", "ce", "pas", "otro"] as const;
export type TaxDocType = (typeof TAX_DOC_TYPES)[number];

export type TaxIdMode = "strict" | "lenient";
export type TaxIdFailure = "empty" | "invalid_format" | "too_short" | "too_long";
export type TaxIdResult = { ok: true; value: string } | { ok: false; reason: TaxIdFailure };

/** Límites inclusivos de longitud. `ci` cuenta solo los dígitos (sin complemento). */
export const RANGES = {
  ci: { min: 4, max: 10 },
  nit: { min: 7, max: 13 },
  ce: { min: 5, max: 20 },
  pas: { min: 5, max: 20 },
  otro: { min: 3, max: 20 },
  /** Nivel `lenient`: caracteres del documento completo (con separadores). */
  lenient: { min: 3, max: 24 },
} as const;

/** El ajuste público llega como texto libre: cualquier valor distinto de «lenient» se trata como `strict`. */
export const parseTaxIdMode = (raw: unknown): TaxIdMode =>
  raw === "lenient" ? "lenient" : "strict";

const fail = (reason: TaxIdFailure): TaxIdResult => ({ ok: false, reason });

function checkLength(length: number, range: { min: number; max: number }): TaxIdFailure | null {
  if (length < range.min) return "too_short";
  if (length > range.max) return "too_long";
  return null;
}

/** Solo dígitos, o solo letras y números, con la longitud del rango. */
function validateSimple(
  text: string,
  pattern: RegExp,
  range: { min: number; max: number },
): TaxIdResult {
  if (!pattern.test(text)) return fail("invalid_format");
  const problem = checkLength(text.length, range);
  return problem ? fail(problem) : { ok: true, value: text.toUpperCase() };
}

const CI_SHAPE = /^([0-9]+)(?:[ -](.+))?$/;
const CI_COMPLEMENT = /^(?:[0-9][A-Za-z]|[A-Za-z])$/;

function validateCi(text: string): TaxIdResult {
  const match = CI_SHAPE.exec(text);
  if (!match) return fail("invalid_format");
  const digits = match[1] ?? "";
  const problem = checkLength(digits.length, RANGES.ci);
  if (problem) return fail(problem);
  const complement = match[2];
  if (complement === undefined) return { ok: true, value: digits };
  if (!CI_COMPLEMENT.test(complement)) return fail("invalid_format");
  return { ok: true, value: `${digits}-${complement.toUpperCase()}` };
}

function validateLenient(text: string): TaxIdResult {
  if (!/^[A-Za-z0-9][A-Za-z0-9 ./-]*$/.test(text)) return fail("invalid_format");
  const problem = checkLength(text.length, RANGES.lenient);
  return problem ? fail(problem) : { ok: true, value: text.toUpperCase() };
}

/** Valida y normaliza un documento. Nunca lanza. */
export function validateTaxId(
  type: TaxDocType,
  input: string,
  mode: TaxIdMode = "strict",
): TaxIdResult {
  // Espacios de los extremos fuera y los internos compactados (también tabulaciones y espacios duros).
  const text = input.trim().replace(/\s+/g, " ");
  if (text === "") return fail("empty");
  if (mode === "lenient") return validateLenient(text);
  switch (type) {
    case "ci":
      return validateCi(text);
    case "nit":
      return validateSimple(text, /^[0-9]+$/, RANGES.nit);
    case "ce":
      return validateSimple(text, /^[A-Za-z0-9]+$/, RANGES.ce);
    case "pas":
      return validateSimple(text, /^[A-Za-z0-9]+$/, RANGES.pas);
    case "otro":
      return validateSimple(text, /^[A-Za-z0-9]+$/, RANGES.otro);
  }
}

/** Mensaje en español para un fallo de `validateTaxId`. */
export function taxIdMessage(type: TaxDocType, reason: TaxIdFailure, mode: TaxIdMode): string {
  if (reason === "empty") return t("acct.tax.errors.empty");
  const group = mode === "lenient" ? "lenient" : type;
  const range = RANGES[group];
  return t(`acct.tax.errors.${group}.${reason}` as MessageKey, { min: range.min, max: range.max });
}

/** Ayuda bajo el campo: qué formato se espera para ese tipo y nivel. */
export function taxIdHint(type: TaxDocType, mode: TaxIdMode): string {
  if (mode === "lenient") {
    return t("acct.tax.hints.lenient", { min: RANGES.lenient.min, max: RANGES.lenient.max });
  }
  const range = RANGES[type];
  return t(`acct.tax.hints.strict.${type}` as MessageKey, { min: range.min, max: range.max });
}
