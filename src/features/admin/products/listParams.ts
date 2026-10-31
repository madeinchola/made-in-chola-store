import type { StockLight } from "@/features/catalog/types";
import type { AdminProductListParams, ListSort, StateFilter } from "./types";

export const PAGE_SIZE = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// El estado de la pantalla vive en la URL (se puede compartir, recargar y volver con "atrás"). Valores en español.
const STATE_BY_URL: Record<string, StateFilter> = {
  todos: "all",
  publicados: "active",
  borradores: "draft",
  agotados: "soldout",
  archivados: "archived",
};
const SORT_BY_URL: Record<string, ListSort> = {
  recientes: "newest",
  editados: "updated",
  nombre: "name",
  codigo: "code",
};
const STOCK_VALUES: readonly (StockLight | "alert")[] = ["ok", "low", "critical", "out", "alert"];

const invert = <K extends string, V extends string>(m: Record<K, V>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k])) as Record<V, K>;
const URL_BY_STATE = invert(STATE_BY_URL);
const URL_BY_SORT = invert(SORT_BY_URL);

export const DEFAULT_LIST_PARAMS: AdminProductListParams = {
  state: "all",
  sort: "newest",
  page: 1,
  pageSize: PAGE_SIZE,
};

/** URL → parámetros. Cualquier valor inválido (a mano, o de un enlace viejo) cae al valor por defecto: nunca rompe. */
export function parseListParams(sp: URLSearchParams): AdminProductListParams {
  const params: AdminProductListParams = { ...DEFAULT_LIST_PARAMS };
  const q = sp.get("q")?.trim();
  if (q) params.search = q.slice(0, 100);
  const state = STATE_BY_URL[sp.get("estado") ?? ""];
  if (state) params.state = state;
  const sort = SORT_BY_URL[sp.get("orden") ?? ""];
  if (sort) params.sort = sort;
  const category = sp.get("categoria");
  if (category && UUID_RE.test(category)) params.categoryId = category;
  const collection = sp.get("coleccion");
  if (collection && UUID_RE.test(collection)) params.collectionId = collection;
  const stock = STOCK_VALUES.find((v) => v === sp.get("stock"));
  if (stock) params.stockLight = stock;
  // Solo dígitos: Number("1e3") o Number("0x10") serían páginas "válidas" que la app nunca escribe.
  const rawPage = sp.get("pagina") ?? "";
  if (/^[1-9]\d{0,5}$/.test(rawPage) && Number(rawPage) <= 100_000) params.page = Number(rawPage);
  return params;
}

/** Parámetros → URL, omitiendo lo que vale el valor por defecto (URLs limpias). */
export function toSearchParams(p: AdminProductListParams): URLSearchParams {
  const sp = new URLSearchParams();
  if (p.search) sp.set("q", p.search);
  if (p.state !== DEFAULT_LIST_PARAMS.state) sp.set("estado", URL_BY_STATE[p.state]);
  if (p.categoryId) sp.set("categoria", p.categoryId);
  if (p.collectionId) sp.set("coleccion", p.collectionId);
  if (p.stockLight) sp.set("stock", p.stockLight);
  if (p.sort !== DEFAULT_LIST_PARAMS.sort) sp.set("orden", URL_BY_SORT[p.sort]);
  if (p.page > 1) sp.set("pagina", String(p.page));
  return sp;
}

/** ¿Hay algún filtro activo (más allá de orden y página)? */
export const hasActiveFilters = (p: AdminProductListParams): boolean =>
  Boolean(p.search) ||
  p.state !== DEFAULT_LIST_PARAMS.state ||
  Boolean(p.categoryId) ||
  Boolean(p.collectionId) ||
  Boolean(p.stockLight);

/** Cambios sobre los parámetros: un valor `undefined` QUITA ese filtro (elegir "Todas"). */
export type ListPatch = {
  [K in keyof AdminProductListParams]?: AdminProductListParams[K] | undefined;
};

/** Aplica un cambio y vuelve a la página 1, salvo que el cambio indique otra página. */
export function applyPatch(
  params: AdminProductListParams,
  patch: ListPatch,
): AdminProductListParams {
  const next: Record<string, unknown> = { ...params, page: 1 };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as unknown as AdminProductListParams;
}
