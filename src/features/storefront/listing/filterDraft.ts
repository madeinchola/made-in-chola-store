import { MAX_FILTER_VALUES, type ListingQuery } from "./listParams";

/** Clave de comparación de un valor de filtro: sin acentos, sin mayúsculas, sin espacios sobrantes. */
export function normalizeKey(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function includesValue(list: readonly string[], value: string): boolean {
  const key = normalizeKey(value);
  return list.some((item) => normalizeKey(item) === key);
}

/** Añade el valor si no está y lo quita si está (sin distinguir acentos ni mayúsculas); respeta el tope de la URL. */
export function toggleValue(list: readonly string[], value: string): string[] {
  if (includesValue(list, value)) return removeValue(list, value);
  return [...list, value].slice(0, MAX_FILTER_VALUES);
}

export function removeValue(list: readonly string[], value: string): string[] {
  const key = normalizeKey(value);
  return list.filter((item) => normalizeKey(item) !== key);
}

export type PriceParse = { ok: true; value: number | null } | { ok: false };

/**
 * Lee un precio escrito a mano: vacío = sin límite; «100», «100.5» o «100,50» (la coma también vale). Nada de signos,
 * notación científica, separadores de miles ni más de 2 decimales.
 */
export function parsePriceInput(text: string): PriceParse {
  const raw = text.trim();
  if (raw === "") return { ok: true, value: null };
  if (!/^\d{1,9}([.,]\d{1,2})?$/.test(raw)) return { ok: false };
  return { ok: true, value: Number(raw.replace(",", ".")) };
}

/** Lo que el panel de filtros edita antes de pulsar «Aplicar». */
export interface FilterDraft {
  colors: string[];
  sizes: string[];
  min: string;
  max: string;
  inStockOnly: boolean;
}

export const draftFromQuery = (query: ListingQuery): FilterDraft => ({
  colors: [...query.colors],
  sizes: [...query.sizes],
  min: query.minPrice === null ? "" : String(query.minPrice),
  max: query.maxPrice === null ? "" : String(query.maxPrice),
  inStockOnly: query.inStockOnly,
});

export type DraftResult =
  { ok: true; query: ListingQuery } | { ok: false; errors: { min: boolean; max: boolean } };

/**
 * Convierte el borrador en la nueva consulta (vuelve a la página 1). Si algún precio no es válido NO se aplica nada y
 * se indica cuál; un mínimo mayor que el máximo se corrige intercambiándolos.
 */
export function applyDraft(base: ListingQuery, draft: FilterDraft): DraftResult {
  const min = parsePriceInput(draft.min);
  const max = parsePriceInput(draft.max);
  if (!min.ok || !max.ok) return { ok: false, errors: { min: !min.ok, max: !max.ok } };
  let minPrice = min.value;
  let maxPrice = max.value;
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }
  return {
    ok: true,
    query: {
      ...base,
      colors: draft.colors.slice(0, MAX_FILTER_VALUES),
      sizes: draft.sizes.slice(0, MAX_FILTER_VALUES),
      minPrice,
      maxPrice,
      inStockOnly: draft.inStockOnly,
      page: 1,
    },
  };
}

/** Un filtro activo que se puede quitar desde su ficha. */
export type ActiveFilter =
  | { kind: "color"; value: string }
  | { kind: "size"; value: string }
  | { kind: "price" }
  | { kind: "stock" };

export function activeFilters(query: ListingQuery): ActiveFilter[] {
  return [
    ...query.colors.map((value): ActiveFilter => ({ kind: "color", value })),
    ...query.sizes.map((value): ActiveFilter => ({ kind: "size", value })),
    ...(query.minPrice !== null || query.maxPrice !== null ? [{ kind: "price" } as const] : []),
    ...(query.inStockOnly ? [{ kind: "stock" } as const] : []),
  ];
}

/** La consulta sin ese filtro, de vuelta en la página 1. */
export function withoutFilter(query: ListingQuery, filter: ActiveFilter): ListingQuery {
  const base = { ...query, page: 1 };
  switch (filter.kind) {
    case "color":
      return { ...base, colors: removeValue(query.colors, filter.value) };
    case "size":
      return { ...base, sizes: removeValue(query.sizes, filter.value) };
    case "price":
      return { ...base, minPrice: null, maxPrice: null };
    case "stock":
      return { ...base, inStockOnly: false };
  }
}

/** Todos los filtros fuera; se conservan orden y la página vuelve a 1. */
export const withoutFilters = (query: ListingQuery): ListingQuery => ({
  ...query,
  colors: [],
  sizes: [],
  minPrice: null,
  maxPrice: null,
  inStockOnly: false,
  page: 1,
});

const LISTING_KEYS = ["color", "talla", "min", "max", "disponibles", "orden", "pagina"] as const;

/**
 * Parámetros nuevos de la URL: los del listado se reescriben según `query` y los DEMÁS (utm_…, fbclid, q…) se
 * conservan tal cual, para no perder la atribución de una campaña al filtrar.
 */
export function mergeListingParams(
  current: URLSearchParams,
  next: URLSearchParams,
): URLSearchParams {
  const out = new URLSearchParams(current);
  for (const key of LISTING_KEYS) out.delete(key);
  for (const [key, value] of next) out.append(key, value);
  return out;
}
