/** Mínimo de letras para buscar (igual que la función SQL y `searchProducts`). */
export const MIN_SEARCH_LENGTH = 2;
/** Máximo de caracteres de la consulta (la función SQL también recorta a 80: no hay que enviar más). */
export const MAX_SEARCH_LENGTH = 80;
/** Resultados que muestra la búsqueda (sin paginar). */
export const SEARCH_LIMIT = 48;

/**
 * Consulta de búsqueda saneada para la URL y para la base: sin caracteres de control, con los espacios colapsados,
 * recortada y cortada a 80 caracteres (por caracteres completos: un emoji nunca se parte por la mitad).
 */
export function normalizeSearchQuery(raw: string | null | undefined): string {
  if (!raw) return "";
  let clean = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    clean += code < 32 || code === 127 ? " " : ch;
  }
  const collapsed = clean.replace(/\s+/g, " ").trim();
  return Array.from(collapsed).slice(0, MAX_SEARCH_LENGTH).join("").trim();
}

/** ¿Tiene suficientes letras para consultar? (cuenta caracteres completos, no unidades UTF-16). */
export function isSearchable(query: string): boolean {
  return Array.from(query).length >= MIN_SEARCH_LENGTH;
}
