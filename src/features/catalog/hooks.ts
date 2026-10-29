import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getCategoryTree,
  getHome,
  getNewsBanner,
  getProductBySlug,
  getStoreSettings,
  listCollections,
  listProducts,
  searchProducts,
} from "./catalogService";
import { catalogKeys } from "./queryKeys";
import {
  adjustStock,
  listAdminProductStock,
  listAdminStock,
  type AdjustStockInput,
} from "./stockService";
import type { ListProductsParams } from "./types";

const MINUTE = 60_000;

// Contenido público: cambia poco → se mantiene fresco unos minutos (el QueryClient global usa 30 s).
export const useCategoryTree = () =>
  useQuery({ queryKey: catalogKeys.categories(), queryFn: getCategoryTree, staleTime: 5 * MINUTE });

export const useCollections = () =>
  useQuery({
    queryKey: catalogKeys.collections(),
    queryFn: listCollections,
    staleTime: 5 * MINUTE,
  });

export const useNewsBanner = () =>
  useQuery({ queryKey: catalogKeys.banner(), queryFn: getNewsBanner, staleTime: 5 * MINUTE });

export const useStoreSettings = () =>
  useQuery({ queryKey: catalogKeys.settings(), queryFn: getStoreSettings, staleTime: 5 * MINUTE });

export const useHome = () =>
  useQuery({ queryKey: catalogKeys.home(), queryFn: getHome, staleTime: 2 * MINUTE });

export const useProducts = (params: ListProductsParams = {}) =>
  useQuery({ queryKey: catalogKeys.productList(params), queryFn: () => listProducts(params) });

export const useProduct = (slug: string | undefined) =>
  useQuery({
    queryKey: catalogKeys.product(slug ?? ""),
    queryFn: () => getProductBySlug(slug as string),
    enabled: Boolean(slug),
  });

/** La búsqueda solo se lanza con 2+ caracteres (igual que el servicio). */
export const useProductSearch = (query: string, limit?: number) =>
  useQuery({
    queryKey: catalogKeys.search(query, limit),
    queryFn: () => searchProducts(query, limit),
    enabled: query.trim().length >= 2,
  });

// Panel admin: el stock cambia con cada venta/ajuste → siempre fresco.
export const useAdminStock = (productId?: string) =>
  useQuery({
    queryKey: catalogKeys.adminStock(productId),
    queryFn: () => listAdminStock(productId),
    staleTime: 0,
  });

export const useAdminProductStock = () =>
  useQuery({
    queryKey: catalogKeys.adminProductStock(),
    queryFn: listAdminProductStock,
    staleTime: 0,
  });

/** Ajuste manual de stock; al terminar refresca el stock del panel Y los productos públicos (cambia "agotado"). */
export function useAdjustStock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AdjustStockInput) => adjustStock(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...catalogKeys.all, "admin-stock"] }),
        queryClient.invalidateQueries({ queryKey: catalogKeys.adminProductStock() }),
        queryClient.invalidateQueries({ queryKey: catalogKeys.products() }),
      ]);
    },
  });
}
