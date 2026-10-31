import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { adminKeys } from "../queryKeys";
import {
  getAdminProduct,
  getDefaultOutOfStockBehavior,
  listAdminProducts,
  listCategoryOptions,
  listCollectionOptions,
  listEnabledCurrencies,
  searchProductsForRelation,
} from "./api";
import type { AdminProductListParams } from "./types";

/** Listado: mantiene los datos anteriores en pantalla mientras llegan los nuevos (sin parpadeo al filtrar o paginar). */
export const useAdminProducts = (params: AdminProductListParams) =>
  useQuery({
    queryKey: adminKeys.productList(params),
    queryFn: () => listAdminProducts(params),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

/** Detalle para editar: siempre fresco (si otra persona edita, se debe ver al volver a la pantalla). */
export const useAdminProduct = (id: string | undefined) =>
  useQuery({
    queryKey: adminKeys.product(id ?? ""),
    queryFn: () => getAdminProduct(id as string),
    enabled: Boolean(id),
    staleTime: 0,
  });

export const useCategoryOptions = () =>
  useQuery({
    queryKey: adminKeys.categoryOptions(),
    queryFn: listCategoryOptions,
    staleTime: 60_000,
  });

export const useCollectionOptions = () =>
  useQuery({
    queryKey: adminKeys.collectionOptions(),
    queryFn: listCollectionOptions,
    staleTime: 60_000,
  });

export const useRelatedSearch = (query: string, excludeId: string) =>
  useQuery({
    queryKey: adminKeys.relatedSearch(query.trim().toLowerCase(), excludeId),
    queryFn: () => searchProductsForRelation(query, excludeId),
    enabled: query.trim().length >= 2,
    staleTime: 30_000,
  });

export const useEnabledCurrencies = () =>
  useQuery({
    queryKey: adminKeys.currencies(),
    queryFn: listEnabledCurrencies,
    staleTime: 60_000,
  });

/** Lo que el admin eligió en Ajustes como comportamiento por defecto sin stock (para los productos nuevos). */
export const useDefaultOutOfStockBehavior = () =>
  useQuery({
    queryKey: adminKeys.defaultOutOfStock(),
    queryFn: getDefaultOutOfStockBehavior,
    staleTime: 0,
    gcTime: 0,
  });
