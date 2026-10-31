import { useQueryClient } from "@tanstack/react-query";
import { catalogKeys } from "@/features/catalog/queryKeys";
import { adminKeys } from "../queryKeys";

/**
 * Tras cambiar un producto hay que refrescar: su detalle, los listados del panel, las alertas de stock y el catálogo público
 * (la tienda lee el producto, su precio, su stock y su estado).
 */
export function useInvalidateProduct() {
  const queryClient = useQueryClient();
  return (productId?: string) =>
    Promise.all([
      productId
        ? queryClient.invalidateQueries({ queryKey: adminKeys.product(productId) })
        : undefined,
      queryClient.invalidateQueries({ queryKey: adminKeys.products() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.stockSummary() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.stockAlerts() }),
      queryClient.invalidateQueries({ queryKey: catalogKeys.all }),
    ]);
}
