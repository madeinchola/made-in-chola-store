import { useQuery } from "@tanstack/react-query";
import { useCategoryTree, useCollections } from "@/features/catalog/hooks";
import { catalogKeys } from "@/features/catalog/queryKeys";
import type { HomeSection, ProductSummary } from "@/features/catalog/types";
import { DEFAULT_QUERY } from "@/features/storefront/listing/listParams";
import { listProductsFiltered } from "@/features/storefront/shopService";
import { getProductsByIds } from "./homeService";
import { clampLimit, flattenCategories, resolveSectionScope } from "./homeSections";

export interface SectionProducts {
  products: ProductSummary[];
  /** Todavía no hay respuesta (o falta el árbol de categorías/colecciones para saber el slug). */
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
}

/** Productos de una sección de la portada según su origen (ver `resolveSectionScope`). */
export function useSectionProducts(section: HomeSection): SectionProducts {
  const tree = useCategoryTree();
  const collections = useCollections();
  const scope = resolveSectionScope(
    section,
    tree.data ? flattenCategories(tree.data) : undefined,
    collections.data,
  );
  const limit = clampLimit(section.itemLimit);

  const query = useQuery({
    queryKey: [...catalogKeys.products(), "home-section", section.id, scope, limit],
    queryFn: async () => {
      if (scope.status === "ready") {
        const page = await listProductsFiltered({
          scope: scope.scope,
          query: { ...DEFAULT_QUERY, sort: "newest" },
          pageSize: limit,
        });
        return page.items;
      }
      if (scope.status === "manual")
        return (await getProductsByIds(scope.productIds)).slice(0, limit);
      return [];
    },
    enabled: scope.status === "ready" || scope.status === "manual",
    staleTime: 60_000,
  });

  const waitingForScope =
    scope.status === "pending" &&
    // Un error al cargar el árbol/colecciones no debe dejar el esqueleto para siempre.
    !(tree.isError || collections.isError);
  return {
    products: scope.status === "ready" || scope.status === "manual" ? (query.data ?? []) : [],
    isPending: waitingForScope || (query.isPending && query.fetchStatus !== "idle"),
    isError: query.isError || (scope.status === "pending" && (tree.isError || collections.isError)),
    refetch: () => void query.refetch(),
  };
}
