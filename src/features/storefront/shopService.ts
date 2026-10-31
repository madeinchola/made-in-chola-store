import { mapProductSummary } from "@/features/catalog/mappers";
import type { ProductPage } from "@/features/catalog/types";
import type { Database } from "@/lib/database.types";
import { fromDbError } from "@/lib/db-errors";
import { AppError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { PAGE_SIZE, type ListingQuery } from "./listing/listParams";
import type { ListingFacets, ListingScope } from "./types";

type ProductRow = Database["public"]["Views"]["public_products"]["Row"];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Listado con filtros, orden y paginación hechos en el SERVIDOR (`public_list_products`): total exacto aunque se
 * pida una página pasada del final, sin tope de 200 productos y sin traer a la RAM lo que no se muestra.
 */
export async function listProductsFiltered(args: {
  scope?: ListingScope;
  query: ListingQuery;
  pageSize?: number;
}): Promise<ProductPage> {
  const { scope = {}, query } = args;
  const pageSize = Math.min(Math.max(Math.trunc(args.pageSize ?? PAGE_SIZE), 1), 100);
  const { data, error } = await getSupabase().rpc("public_list_products", {
    ...(scope.categorySlug ? { p_category_slug: scope.categorySlug } : {}),
    ...(scope.collectionSlug ? { p_collection_slug: scope.collectionSlug } : {}),
    ...(query.colors.length > 0 ? { p_colors: query.colors } : {}),
    ...(query.sizes.length > 0 ? { p_sizes: query.sizes } : {}),
    ...(query.minPrice !== null ? { p_min_price: query.minPrice } : {}),
    ...(query.maxPrice !== null ? { p_max_price: query.maxPrice } : {}),
    p_in_stock_only: query.inStockOnly,
    p_sort: query.sort,
    p_limit: pageSize,
    p_offset: (Math.max(1, query.page) - 1) * pageSize,
  });
  if (error) throw fromDbError(error);
  if (!isObject(data) || typeof data.total !== "number" || !Array.isArray(data.items)) {
    throw new AppError("unknown", "Respuesta inesperada del listado de productos.");
  }
  return {
    items: (data.items as ProductRow[]).map(mapProductSummary),
    total: data.total,
  };
}

/** Opciones de filtro disponibles en una categoría/colección. */
export async function getListingFacets(scope: ListingScope = {}): Promise<ListingFacets> {
  const { data, error } = await getSupabase().rpc("public_listing_facets", {
    ...(scope.categorySlug ? { p_category_slug: scope.categorySlug } : {}),
    ...(scope.collectionSlug ? { p_collection_slug: scope.collectionSlug } : {}),
  });
  if (error) throw fromDbError(error);
  if (!isObject(data))
    throw new AppError("unknown", "Respuesta inesperada de las opciones de filtro.");
  const colors = Array.isArray(data.colors) ? data.colors : [];
  const sizes = Array.isArray(data.sizes) ? data.sizes : [];
  const num = (value: unknown) => (typeof value === "number" ? value : null);
  return {
    colors: colors.flatMap((c: unknown) =>
      isObject(c) && typeof c.name === "string"
        ? [
            {
              name: c.name,
              hex: typeof c.hex === "string" ? c.hex : null,
              count: num(c.count) ?? 0,
            },
          ]
        : [],
    ),
    sizes: sizes.flatMap((s: unknown) =>
      isObject(s) && typeof s.label === "string"
        ? [{ label: s.label, count: num(s.count) ?? 0 }]
        : [],
    ),
    priceMin: num(data.price_min),
    priceMax: num(data.price_max),
  };
}

/**
 * Si un producto se renombró, el slug viejo sigue funcionando: devuelve el slug actual (solo de productos visibles y
 * de slugs que eran públicos al renombrar), o null si no hay redirección.
 */
export async function findSlugRedirect(oldSlug: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from("public_product_slug_redirects")
    .select("current_slug")
    .eq("old_slug", oldSlug)
    .maybeSingle();
  if (error) throw fromDbError(error);
  return data?.current_slug ?? null;
}
