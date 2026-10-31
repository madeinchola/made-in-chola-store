export type PageItem = number | "ellipsis-start" | "ellipsis-end";

/** Entero ≥ 1 o 1: `NaN` (p. ej. `Math.ceil(undefined / 12)` mientras carga), `Infinity` y negativos no rompen la barra. */
export function safePageNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

/**
 * Números de página que se muestran: siempre la primera y la última, la actual con `siblings` vecinas a cada lado y
 * puntos suspensivos en los huecos. Con más de `2·siblings + 5` páginas la cantidad de elementos es CONSTANTE (la barra
 * no cambia de ancho al avanzar). `page` fuera de rango se acota; `totalPages` < 1 cuenta como 1.
 */
export function getPageItems(page: number, totalPages: number, siblings = 1): PageItem[] {
  const total = safePageNumber(totalPages);
  const current = Math.min(safePageNumber(page), total);
  const sib = Math.max(0, Math.floor(siblings));
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);

  if (total <= sib * 2 + 5) return range(1, total);

  const left = Math.max(current - sib, 1);
  const right = Math.min(current + sib, total);
  const gapLeft = left > 2;
  const gapRight = right < total - 1;
  const edge = 3 + 2 * sib;

  if (!gapLeft && gapRight) return [...range(1, edge), "ellipsis-end", total];
  if (gapLeft && !gapRight) return [1, "ellipsis-start", ...range(total - edge + 1, total)];
  return [1, "ellipsis-start", ...range(left, right), "ellipsis-end", total];
}
