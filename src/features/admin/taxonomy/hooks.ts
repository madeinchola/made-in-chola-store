import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { catalogKeys } from "@/features/catalog/queryKeys";
import { adminKeys } from "../queryKeys";
import {
  createCategory,
  createCollection,
  isCategorySlugAvailable,
  isCollectionSlugAvailable,
  listAdminCategories,
  listAdminCollections,
  saveCategoryOrder,
  saveCollectionOrder,
  setCategoryArchived,
  setCollectionArchived,
  updateCategory,
  updateCollection,
  type OrderChange,
} from "./api";
import { taxonomyKeys } from "./queryKeys";
import type { AdminCategory, AdminCollection } from "./types";
import type { CategoryInput, CollectionInput } from "./validation";

/** Tras cualquier cambio se refresca el panel, los selectores del formulario de producto y la tienda pública. */
export async function invalidateTaxonomy(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: taxonomyKeys.all }),
    queryClient.invalidateQueries({ queryKey: adminKeys.categoryOptions() }),
    queryClient.invalidateQueries({ queryKey: adminKeys.collectionOptions() }),
    queryClient.invalidateQueries({ queryKey: catalogKeys.all }),
  ]);
}

/** Siempre fresco: si otra persona edita, se debe ver al volver a la pantalla. */
export const useAdminCategories = () =>
  useQuery({ queryKey: taxonomyKeys.categories(), queryFn: listAdminCategories, staleTime: 0 });

export const useAdminCollections = () =>
  useQuery({ queryKey: taxonomyKeys.collections(), queryFn: listAdminCollections, staleTime: 0 });

function useTaxonomyMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => invalidateTaxonomy(queryClient),
  });
}

export const useCreateCategory = () =>
  useTaxonomyMutation((input: CategoryInput) => createCategory(input));
export const useUpdateCategory = () =>
  useTaxonomyMutation((v: { category: AdminCategory; input: CategoryInput }) =>
    updateCategory(v.category, v.input),
  );
export const useSetCategoryArchived = () =>
  useTaxonomyMutation((v: { category: AdminCategory; archived: boolean }) =>
    setCategoryArchived(v.category, v.archived),
  );
export const useReorderCategories = () =>
  useTaxonomyMutation((changes: readonly OrderChange[]) => saveCategoryOrder(changes));

export const useCreateCollection = () =>
  useTaxonomyMutation((input: CollectionInput) => createCollection(input));
export const useUpdateCollection = () =>
  useTaxonomyMutation((v: { collection: AdminCollection; input: CollectionInput }) =>
    updateCollection(v.collection, v.input),
  );
export const useSetCollectionArchived = () =>
  useTaxonomyMutation((v: { collection: AdminCollection; archived: boolean }) =>
    setCollectionArchived(v.collection, v.archived),
  );
export const useReorderCollections = () =>
  useTaxonomyMutation((changes: readonly OrderChange[]) => saveCollectionOrder(changes));

export const slugCheckers = {
  categories: isCategorySlugAvailable,
  collections: isCollectionSlugAvailable,
} as const;
