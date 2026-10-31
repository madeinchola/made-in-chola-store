import { adminKeys } from "../queryKeys";

/** Claves de caché de Categorías y Colecciones (cuelgan de ["admin"]). */
export const taxonomyKeys = {
  all: [...adminKeys.all, "taxonomy"] as const,
  categories: () => [...taxonomyKeys.all, "categories"] as const,
  collections: () => [...taxonomyKeys.all, "collections"] as const,
  slugFree: (table: "categories" | "collections", slug: string, excludeId: string) =>
    [...taxonomyKeys.all, "slug-free", table, slug, excludeId] as const,
};
