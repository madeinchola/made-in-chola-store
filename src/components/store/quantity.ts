/** Tope absoluto de unidades por línea cuando no se indica `max` (4 dígitos: el campo no se desborda). */
export const ABSOLUTE_MAX_QUANTITY = 9999;

/**
 * Interpreta lo escrito en el campo de cantidad. Solo dígitos ASCII (se ignoran espacios en los extremos):
 * "1e3", "-5", "٣", "12a" o más de 4 dígitos → null (se rechaza el cambio). Cadena vacía → "".
 */
export function parseQuantityDraft(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return "";
  if (!/^[0-9]+$/.test(text) || text.length > String(ABSOLUTE_MAX_QUANTITY).length) return null;
  return text;
}

/** Tope efectivo: `max` (o 9999 si falta o no es un número) nunca por debajo de `min`. */
export function upperBound(min: number, max: number | undefined): number {
  const limit = max !== undefined && Number.isFinite(max) ? Math.trunc(max) : ABSOLUTE_MAX_QUANTITY;
  return Math.max(min, Math.min(limit, ABSOLUTE_MAX_QUANTITY));
}

/** Acota a [min, max] (max < min cuenta como max = min). Nunca devuelve NaN, decimales ni valores fuera de rango. */
export function clampQuantity(n: number, min: number, max: number | undefined): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(Math.trunc(n), min), upperBound(min, max));
}
