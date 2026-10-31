import type { AdminProductListParams } from "./products/types";

/** Claves de TanStack Query del panel. Todas cuelgan de ["admin"] (un `invalidateQueries` sobre `all` limpia todo). */
export const adminKeys = {
  all: ["admin"] as const,
  stockSummary: () => [...adminKeys.all, "stock-summary"] as const,
  stockAlerts: () => [...adminKeys.all, "stock-alerts"] as const,
  products: () => [...adminKeys.all, "products"] as const,
  productList: (params: AdminProductListParams) =>
    [...adminKeys.products(), "list", params] as const,
  product: (id: string) => [...adminKeys.products(), "detail", id] as const,
  categoryOptions: () => [...adminKeys.all, "category-options"] as const,
  collectionOptions: () => [...adminKeys.all, "collection-options"] as const,
  defaultOutOfStock: () => [...adminKeys.all, "default-out-of-stock"] as const,
  currencies: () => [...adminKeys.all, "enabled-currencies"] as const,
  relatedSearch: (query: string, excludeId: string) =>
    [...adminKeys.all, "related-search", excludeId, query] as const,
};
