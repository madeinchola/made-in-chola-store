import { fromDbError } from "@/lib/db-errors";
import { getSupabase } from "@/lib/supabase";
import { updateVersioned } from "../lib/versioned";
import type { AdminCategory, AdminCollection } from "./types";
import type { CategoryInput, CollectionInput } from "./validation";

/** Un cambio de `sort_order`: lleva la versión leída de la fila para que la actualización no pise a otro admin. */
export interface OrderChange {
  id: string;
  updatedAt: string;
  sortOrder: number;
}

// ── Categorías ─────────────────────────────────────────────────────────────────────────────

interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  archived_at: string | null;
  updated_at: string;
}

const CATEGORY_COLUMNS = "id,parent_id,name,slug,description,sort_order,archived_at,updated_at";

const mapCategory = (r: CategoryRow): AdminCategory => ({
  id: r.id,
  parentId: r.parent_id,
  name: r.name,
  slug: r.slug,
  description: r.description,
  sortOrder: r.sort_order,
  archived: r.archived_at !== null,
  updatedAt: r.updated_at,
});

/** TODAS las categorías (también las archivadas: el panel decide si las muestra), por orden y nombre. */
export async function listAdminCategories(): Promise<AdminCategory[]> {
  const { data, error } = await getSupabase()
    .from("categories")
    .select(CATEGORY_COLUMNS)
    .order("sort_order")
    .order("name");
  if (error) throw fromDbError(error);
  return (data ?? []).map(mapCategory);
}

/** ¿Está libre este slug? `excludeId` = la propia categoría al editarla. Cuenta también las archivadas (el slug es único). */
export async function isCategorySlugAvailable(slug: string, excludeId?: string): Promise<boolean> {
  let query = getSupabase()
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("slug", slug);
  if (excludeId) query = query.neq("id", excludeId);
  const { count, error } = await query;
  if (error) throw fromDbError(error);
  return (count ?? 0) === 0;
}

/** Siguiente `sort_order` al final de las hijas de `parentId` (null = categorías principales). */
async function nextCategorySortOrder(parentId: string | null): Promise<number> {
  let query = getSupabase()
    .from("categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  query = parentId ? query.eq("parent_id", parentId) : query.is("parent_id", null);
  const { data, error } = await query;
  if (error) throw fromDbError(error);
  return (data?.[0]?.sort_order ?? 0) + 1;
}

/** Crea la categoría al final de su nivel. Las reglas de la base (slug único, padre archivado, ciclos) llegan como AppError. */
export async function createCategory(input: CategoryInput): Promise<AdminCategory> {
  const sortOrder = await nextCategorySortOrder(input.parentId);
  const { data, error } = await getSupabase()
    .from("categories")
    .insert({
      parent_id: input.parentId,
      name: input.name,
      slug: input.slug,
      description: input.description,
      sort_order: sortOrder,
    })
    .select(CATEGORY_COLUMNS)
    .single();
  if (error) throw fromDbError(error);
  return mapCategory(data);
}

/**
 * Edita nombre, slug, descripción y padre con control de versión. Si cambia el padre, la categoría pasa al FINAL de su
 * nuevo nivel. Devuelve el nuevo `updated_at`. Lanza `StaleVersionError` si otra persona la modificó antes.
 */
export async function updateCategory(
  category: AdminCategory,
  input: CategoryInput,
): Promise<string> {
  const patch: Record<string, unknown> = {
    parent_id: input.parentId,
    name: input.name,
    slug: input.slug,
    description: input.description,
  };
  if (input.parentId !== category.parentId)
    patch.sort_order = await nextCategorySortOrder(input.parentId);
  return updateVersioned("categories", category.id, category.updatedAt, patch);
}

/** Archiva (`archived_at = ahora`) o restaura (`null`) con control de versión. Nunca borra. */
export const setCategoryArchived = (category: AdminCategory, archived: boolean) =>
  updateVersioned("categories", category.id, category.updatedAt, {
    archived_at: archived ? new Date().toISOString() : null,
  });

/** Escribe `sort_order` SOLO de las filas indicadas, cada una con su versión. Si una falla, se lanza el primer error. */
export async function saveCategoryOrder(changes: readonly OrderChange[]): Promise<void> {
  await Promise.all(
    changes.map((c) =>
      updateVersioned("categories", c.id, c.updatedAt, { sort_order: c.sortOrder }),
    ),
  );
}

// ── Colecciones ────────────────────────────────────────────────────────────────────────────

interface CollectionRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  archived_at: string | null;
  updated_at: string;
}

const COLLECTION_COLUMNS =
  "id,name,slug,description,starts_at,ends_at,sort_order,archived_at,updated_at";

const mapCollection = (r: CollectionRow): AdminCollection => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  description: r.description,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  sortOrder: r.sort_order,
  archived: r.archived_at !== null,
  updatedAt: r.updated_at,
});

/** TODAS las colecciones (también archivadas, vencidas y programadas), por orden y nombre. */
export async function listAdminCollections(): Promise<AdminCollection[]> {
  const { data, error } = await getSupabase()
    .from("collections")
    .select(COLLECTION_COLUMNS)
    .order("sort_order")
    .order("name");
  if (error) throw fromDbError(error);
  return (data ?? []).map(mapCollection);
}

export async function isCollectionSlugAvailable(
  slug: string,
  excludeId?: string,
): Promise<boolean> {
  let query = getSupabase()
    .from("collections")
    .select("id", { count: "exact", head: true })
    .eq("slug", slug);
  if (excludeId) query = query.neq("id", excludeId);
  const { count, error } = await query;
  if (error) throw fromDbError(error);
  return (count ?? 0) === 0;
}

async function nextCollectionSortOrder(): Promise<number> {
  const { data, error } = await getSupabase()
    .from("collections")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  if (error) throw fromDbError(error);
  return (data?.[0]?.sort_order ?? 0) + 1;
}

/** Crea la colección al final del orden. `startsAt`/`endsAt` ya vienen en ISO/UTC (o null). */
export async function createCollection(input: CollectionInput): Promise<AdminCollection> {
  const sortOrder = await nextCollectionSortOrder();
  const { data, error } = await getSupabase()
    .from("collections")
    .insert({
      name: input.name,
      slug: input.slug,
      description: input.description,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      sort_order: sortOrder,
    })
    .select(COLLECTION_COLUMNS)
    .single();
  if (error) throw fromDbError(error);
  return mapCollection(data);
}

/** Edita con control de versión; devuelve el nuevo `updated_at`. */
export const updateCollection = (collection: AdminCollection, input: CollectionInput) =>
  updateVersioned("collections", collection.id, collection.updatedAt, {
    name: input.name,
    slug: input.slug,
    description: input.description,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
  });

export const setCollectionArchived = (collection: AdminCollection, archived: boolean) =>
  updateVersioned("collections", collection.id, collection.updatedAt, {
    archived_at: archived ? new Date().toISOString() : null,
  });

export async function saveCollectionOrder(changes: readonly OrderChange[]): Promise<void> {
  await Promise.all(
    changes.map((c) =>
      updateVersioned("collections", c.id, c.updatedAt, { sort_order: c.sortOrder }),
    ),
  );
}
