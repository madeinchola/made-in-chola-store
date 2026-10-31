import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { getProductBySlug } from "@/features/catalog/catalogService";
import { catalogKeys } from "@/features/catalog/queryKeys";
import type { ListingQuery } from "./listing/listParams";
import { findSlugRedirect, getListingFacets, listProductsFiltered } from "./shopService";
import type { ListingScope } from "./types";

const MINUTE = 60_000;

/** Listado filtrado. Mantiene la página anterior en pantalla mientras llega la nueva (sin parpadeo al filtrar). */
export const useListing = (scope: ListingScope, query: ListingQuery, pageSize?: number) =>
  useQuery({
    queryKey: [...catalogKeys.products(), "listing", scope, query, pageSize ?? null],
    queryFn: () => listProductsFiltered({ scope, query, ...(pageSize ? { pageSize } : {}) }),
    placeholderData: keepPreviousData,
    staleTime: MINUTE,
  });

/** Opciones de filtro de una categoría/colección (cambian poco). */
export const useListingFacets = (scope: ListingScope) =>
  useQuery({
    queryKey: [...catalogKeys.products(), "facets", scope],
    queryFn: () => getListingFacets(scope),
    staleTime: 5 * MINUTE,
  });

/** Slug actual de un producto renombrado (solo se consulta cuando el slug pedido no existe). */
export const useSlugRedirect = (slug: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: [...catalogKeys.products(), "redirect", slug ?? ""],
    queryFn: () => findSlugRedirect(slug as string),
    enabled: enabled && Boolean(slug),
    staleTime: 5 * MINUTE,
  });

/**
 * Precarga el detalle de un producto (al pasar el ratón o enfocar su tarjeta): cuando se abre la ficha ya está en
 * caché. Devuelve una función que se pasa a `ProductCard`/`ProductRow` como `onPrefetch`.
 */
export function usePrefetchProduct(): (slug: string) => void {
  const queryClient = useQueryClient();
  return (slug: string) => {
    void queryClient.prefetchQuery({
      queryKey: catalogKeys.product(slug),
      queryFn: () => getProductBySlug(slug),
      staleTime: MINUTE,
    });
  };
}
