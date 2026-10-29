import type { ListProductsParams } from "./types";

/**
 * Claves de caché de TanStack Query para el catálogo. Todas cuelgan de ["catalog"], así que
 * `invalidateQueries({ queryKey: catalogKeys.all })` limpia todo, y las claves por producto/listado son
 * estables: los mismos parámetros (en cualquier orden de propiedades) dan la misma clave.
 */
const normalizeParams = (p: ListProductsParams) => ({
  categorySlug: p.categorySlug ?? null,
  collectionSlug: p.collectionSlug ?? null,
  sort: p.sort ?? "newest",
  limit: p.limit ?? 24,
  offset: p.offset ?? 0,
});

export const catalogKeys = {
  all: ["catalog"] as const,
  products: () => [...catalogKeys.all, "products"] as const,
  productList: (params: ListProductsParams = {}) =>
    [...catalogKeys.products(), "list", normalizeParams(params)] as const,
  product: (slug: string) => [...catalogKeys.products(), "detail", slug] as const,
  search: (query: string, limit = 24) =>
    [...catalogKeys.products(), "search", query.trim().toLowerCase(), limit] as const,
  categories: () => [...catalogKeys.all, "categories"] as const,
  collections: () => [...catalogKeys.all, "collections"] as const,
  banner: () => [...catalogKeys.all, "banner"] as const,
  settings: () => [...catalogKeys.all, "settings"] as const,
  home: () => [...catalogKeys.all, "home"] as const,
  adminStock: (productId?: string) =>
    [...catalogKeys.all, "admin-stock", productId ?? "all"] as const,
  adminProductStock: () => [...catalogKeys.all, "admin-product-stock"] as const,
};
