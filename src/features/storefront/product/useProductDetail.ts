import { useQuery } from "@tanstack/react-query";
import { getProductBySlug } from "@/features/catalog/catalogService";
import { catalogKeys } from "@/features/catalog/queryKeys";

/**
 * Detalle del producto. A diferencia del cliente global (que no refresca al enfocar la pestaña) aquí SÍ se refresca:
 * quien deja la ficha abierta y vuelve a ella no debe ver un precio o un stock viejos. La clave es la misma que usa
 * el prefetch de las tarjetas.
 */
export const useProductDetail = (slug: string | undefined) =>
  useQuery({
    queryKey: catalogKeys.product(slug ?? ""),
    queryFn: () => getProductBySlug(slug as string),
    enabled: Boolean(slug),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
