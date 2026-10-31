import type { ProductSort } from "@/features/catalog/types";

/** Productos por página del listado. */
export const PAGE_SIZE = 24;
export const MAX_FILTER_VALUES = 20;
export const MAX_VALUE_LENGTH = 40;
export const MAX_PAGE = 10_000;

/** Estado de un listado tal como vive en la URL (`?color=rojo&talla=m&min=100&orden=precio-asc&pagina=2`). */
export interface ListingQuery {
  colors: string[];
  sizes: string[];
  minPrice: number | null;
  maxPrice: number | null;
  inStockOnly: boolean;
  sort: ProductSort;
  page: number;
}

export const DEFAULT_QUERY: ListingQuery = {
  colors: [],
  sizes: [],
  minPrice: null,
  maxPrice: null,
  inStockOnly: false,
  sort: "newest",
  page: 1,
};

const SORT_TO_PARAM: Record<ProductSort, string> = {
  newest: "nuevos",
  price_asc: "precio-asc",
  price_desc: "precio-desc",
  name: "nombre",
};
// Map y no un objeto: con `{}` el valor «constructor» o «__proto__» de la URL devolvería funciones del prototipo.
const PARAM_TO_SORT = new Map<string, ProductSort>(
  (Object.entries(SORT_TO_PARAM) as [ProductSort, string][]).map(([sort, param]) => [param, sort]),
);

export const SORT_OPTIONS = Object.keys(SORT_TO_PARAM) as ProductSort[];

/** Quita los caracteres de control (se recorre carácter a carácter: una expresión regular con rangos de control no pasa el lint). */
function stripControl(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) out += ch;
  }
  return out;
}

/** Valores de filtro de la URL: recortados, sin caracteres de control, sin repetidos (ni por mayúsculas) y acotados. */
function cleanValues(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = stripControl(raw.replace(/\s+/g, " ")).replace(/\s+/g, " ").trim();
    if (value.length === 0 || value.length > MAX_VALUE_LENGTH) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= MAX_FILTER_VALUES) break;
  }
  return out;
}

/** Precio de la URL: entero o con hasta 2 decimales, sin signo ni notación científica; cualquier otra cosa se ignora. */
function parsePrice(raw: string | null): number | null {
  if (raw === null || !/^\d{1,9}(\.\d{1,2})?$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

function parsePage(raw: string | null): number {
  if (raw === null || !/^\d{1,6}$/.test(raw.trim())) return 1;
  const page = Number(raw.trim());
  return page >= 1 && page <= MAX_PAGE ? page : 1;
}

/** Lee el estado del listado desde la URL. Una URL manipulada nunca lanza: lo inválido se descarta. */
export function parseListingQuery(source: URLSearchParams | string): ListingQuery {
  const params = typeof source === "string" ? new URLSearchParams(source) : source;
  let minPrice = parsePrice(params.get("min"));
  let maxPrice = parsePrice(params.get("max"));
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }
  return {
    colors: cleanValues(params.getAll("color")),
    sizes: cleanValues(params.getAll("talla")),
    minPrice,
    maxPrice,
    inStockOnly: params.get("disponibles") === "1",
    sort: PARAM_TO_SORT.get(params.get("orden") ?? "") ?? DEFAULT_QUERY.sort,
    page: parsePage(params.get("pagina")),
  };
}

/** Escribe el estado en la URL omitiendo todo lo que sea el valor por defecto (URLs limpias y estables). */
export function toSearchParams(query: ListingQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const color of query.colors) params.append("color", color);
  for (const size of query.sizes) params.append("talla", size);
  if (query.minPrice !== null) params.set("min", String(query.minPrice));
  if (query.maxPrice !== null) params.set("max", String(query.maxPrice));
  if (query.inStockOnly) params.set("disponibles", "1");
  if (query.sort !== DEFAULT_QUERY.sort) params.set("orden", SORT_TO_PARAM[query.sort]);
  if (query.page > 1) params.set("pagina", String(query.page));
  return params;
}

/** ¿Hay algún filtro activo (sin contar orden ni página)? */
export function isFiltered(query: ListingQuery): boolean {
  return (
    query.colors.length > 0 ||
    query.sizes.length > 0 ||
    query.minPrice !== null ||
    query.maxPrice !== null ||
    query.inStockOnly
  );
}

/** Cantidad de filtros activos (para el contador del botón «Filtros»). */
export function activeFilterCount(query: ListingQuery): number {
  return (
    query.colors.length +
    query.sizes.length +
    (query.minPrice !== null || query.maxPrice !== null ? 1 : 0) +
    (query.inStockOnly ? 1 : 0)
  );
}

/** Cambia filtros u orden y vuelve a la página 1 (la página de antes ya no tiene sentido con otros resultados). */
export function withChange(query: ListingQuery, change: Partial<ListingQuery>): ListingQuery {
  return { ...query, ...change, page: change.page ?? 1 };
}

export interface ListingSeo {
  /** Ruta canónica (sin filtros ni orden; solo `pagina` si es mayor que 1). */
  canonicalPath: string;
  /** Las combinaciones de filtros u orden NO se indexan (serían infinitas); las páginas sí. */
  robots: "index,follow" | "noindex,follow";
  prevPath: string | null;
  nextPath: string | null;
}

/** Reglas de SEO de un listado: canónico, indexación y enlaces de paginación (`rel=prev/next`). */
export function listingSeo(path: string, query: ListingQuery, totalPages: number): ListingSeo {
  const pageOf = (page: number) => (page > 1 ? `${path}?pagina=${page}` : path);
  const noindex = isFiltered(query) || query.sort !== DEFAULT_QUERY.sort;
  const page = Math.min(query.page, Math.max(1, totalPages));
  return {
    canonicalPath: pageOf(page),
    robots: noindex ? "noindex,follow" : "index,follow",
    prevPath: page > 1 ? pageOf(page - 1) : null,
    nextPath: page < totalPages ? pageOf(page + 1) : null,
  };
}
