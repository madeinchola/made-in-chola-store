/**
 * Importes escritos por el admin (precio, costo, tipo de cambio). Estrictos como la base de datos: más decimales de los
 * que admite la moneda se RECHAZAN (la base los rechaza; redondear en silencio cambiaría el precio sin que se note).
 * Se acepta coma o punto decimal, sin separador de miles. Trabaja con texto: nunca con floats.
 */
export type AmountProblem = "empty" | "format" | "decimals" | "not_positive" | "too_large";

export type AmountResult = { ok: true; value: string } | { ok: false; problem: AmountProblem };

const AMOUNT_RE = /^(\d+)(?:[.,](\d+))?$/;
/** La base exige amount < 1 000 000 000: como máximo 9 dígitos enteros. */
const MAX_INT_DIGITS = 9;

export interface ParseAmountOptions {
  /** Decimales que admite la moneda (BOB: 2). */
  decimals: number;
  /** El costo puede ser 0; un precio no. */
  allowZero?: boolean;
}

/** Devuelve el importe normalizado ("12,5" → "12.5", "007.10" → "7.10") o el problema encontrado. */
export function parseAmount(raw: string, options: ParseAmountOptions): AmountResult {
  const text = raw.trim();
  if (text === "") return { ok: false, problem: "empty" };
  const m = AMOUNT_RE.exec(text);
  if (!m) return { ok: false, problem: "format" };
  const rawInt = m[1] ?? "0";
  const frac = m[2] ?? "";
  if (frac.length > options.decimals) return { ok: false, problem: "decimals" };
  const int = rawInt.replace(/^0+(?=\d)/, "");
  if (int.length > MAX_INT_DIGITS) return { ok: false, problem: "too_large" };
  const isZero = /^0*$/.test(int) && /^0*$/.test(frac);
  if (isZero && !options.allowZero) return { ok: false, problem: "not_positive" };
  return { ok: true, value: frac === "" ? int : `${int}.${frac}` };
}

/** Importe de la base (número o texto) → texto para un campo editable, sin ceros de relleno innecesarios. */
export function amountToInput(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}
