export interface CartBadge {
  visible: boolean;
  /** Texto de la píldora: el número, o "99+" desde 100 (el número exacto va en el nombre accesible). */
  text: string;
  /** Cantidad normalizada (entero ≥ 0) para el nombre accesible. */
  count: number;
}

/** Normaliza la cantidad de la bolsa: entero ≥ 0 (NaN, negativos e infinitos cuentan como 0). */
export function normalizeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function cartBadge(value: number): CartBadge {
  const count = normalizeCount(value);
  return { visible: count > 0, text: count > 99 ? "99+" : String(count), count };
}
