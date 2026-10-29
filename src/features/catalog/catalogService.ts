import { fromDbError } from "@/lib/db-errors";
import { AppError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { buildCategoryTree, descendantIds } from "./categoryTree";
import {
  mapBanner,
  mapCategory,
  mapCollection,
  mapColor,
  mapHome,
  mapImage,
  mapProductDetail,
  mapProductSummary,
  mapSettings,
  mapSize,
  mapVariant,
} from "./mappers";
import type {
  Category,
  CategoryNode,
  Collection,
  HomeSection,
  ListProductsParams,
  NewsBanner,
  ProductDetail,
  ProductPage,
  ProductSort,
  ProductSummary,
  StoreSettings,
} from "./types";

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;
/**
 * Un listado filtrado por categoría/colección pasa los ids por la URL (`in.(…)`): más de ~200 revienta el
 * límite de longitud. El catálogo del MVP está muy por debajo; si algún día no, hay que mover el filtro a SQL.
 */
export const MAX_FILTER_IDS = 200;
const MIN_SEARCH_LENGTH = 2;

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);
const unique = <T>(items: readonly T[]) => [...new Set(items)];

// ── Categorías, colecciones, banner, ajustes ───────────────────────────────────────────────
export async function listCategories(): Promise<Category[]> {
  const { data, error } = await getSupabase()
    .from("public_categories")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw fromDbError(error);
  return (data ?? []).map(mapCategory);
}

export async function getCategoryTree(): Promise<CategoryNode[]> {
  return buildCategoryTree(await listCategories());
}

export async function listCollections(): Promise<Collection[]> {
  const { data, error } = await getSupabase()
    .from("public_collections")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw fromDbError(error);
  return (data ?? []).map(mapCollection);
}

/** El banner vigente (el más reciente); null si no hay ninguno. */
export async function getNewsBanner(): Promise<NewsBanner | null> {
  const { data, error } = await getSupabase().from("public_news_banners").select("*").limit(1);
  if (error) throw fromDbError(error);
  const first = (data ?? [])[0];
  return first ? mapBanner(first) : null;
}

export async function getStoreSettings(): Promise<StoreSettings> {
  const { data, error } = await getSupabase().from("public_store_settings").select("*");
  if (error) throw fromDbError(error);
  return mapSettings(data ?? []);
}

// ── Home ───────────────────────────────────────────────────────────────────────────────────
export async function getHome(): Promise<HomeSection[]> {
  const supabase = getSupabase();
  const [sections, items] = await Promise.all([
    supabase.from("public_home_sections").select("*"),
    supabase.from("public_home_section_items").select("*"),
  ]);
  if (sections.error) throw fromDbError(sections.error);
  if (items.error) throw fromDbError(items.error);
  return mapHome(sections.data ?? [], items.data ?? []);
}

// ── Productos ──────────────────────────────────────────────────────────────────────────────
async function productIdsInCategory(slug: string): Promise<string[]> {
  const categories = await listCategories();
  const root = categories.find((c) => c.slug === slug);
  if (!root) return [];
  const { data, error } = await getSupabase()
    .from("public_product_categories")
    .select("product_id")
    .in("category_id", descendantIds(categories, root.id));
  if (error) throw fromDbError(error);
  return unique((data ?? []).flatMap((r) => (r.product_id ? [r.product_id] : [])));
}

async function productIdsInCollection(slug: string): Promise<string[]> {
  const supabase = getSupabase();
  const found = await supabase
    .from("public_collections")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (found.error) throw fromDbError(found.error);
  if (!found.data?.id) return [];
  const { data, error } = await supabase
    .from("public_product_collections")
    .select("product_id")
    .eq("collection_id", found.data.id);
  if (error) throw fromDbError(error);
  return unique((data ?? []).flatMap((r) => (r.product_id ? [r.product_id] : [])));
}

const intersect = (a: readonly string[], b: readonly string[]) => {
  const inB = new Set(b);
  return a.filter((x) => inB.has(x));
};

const SORTS: Record<
  ProductSort,
  { column: "created_at" | "price_bob" | "name"; ascending: boolean }
> = {
  newest: { column: "created_at", ascending: false },
  price_asc: { column: "price_bob", ascending: true },
  price_desc: { column: "price_bob", ascending: false },
  name: { column: "name", ascending: true },
};

/** Listado paginado de productos visibles, con filtros por categoría (incluye subcategorías) y colección. */
export async function listProducts(params: ListProductsParams = {}): Promise<ProductPage> {
  const limit = clamp(Math.trunc(params.limit ?? DEFAULT_PAGE_SIZE), 1, MAX_PAGE_SIZE);
  const offset = Math.max(0, Math.trunc(params.offset ?? 0));

  let ids: string[] | null = null;
  if (params.categorySlug) ids = await productIdsInCategory(params.categorySlug);
  if (params.collectionSlug) {
    const inCollection = await productIdsInCollection(params.collectionSlug);
    ids = ids ? intersect(ids, inCollection) : inCollection;
  }
  if (ids && ids.length === 0) return { items: [], total: 0 };
  if (ids && ids.length > MAX_FILTER_IDS) {
    throw new AppError(
      "validation",
      `El filtro devuelve más de ${MAX_FILTER_IDS} productos; hay que paginarlo en el servidor.`,
    );
  }

  const sort = SORTS[params.sort ?? "newest"];
  let query = getSupabase().from("public_products").select("*", { count: "exact" });
  if (ids) query = query.in("id", ids);
  // El id como último criterio mantiene estable la paginación cuando hay empates (p. ej. mismo precio).
  const { data, error, count } = await query
    .order(sort.column, { ascending: sort.ascending })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw fromDbError(error);
  const items = (data ?? []).map(mapProductSummary);
  return { items, total: count ?? items.length };
}

/** Productos por ids en el orden dado (los no visibles se descartan). */
async function productsByIds(ids: readonly string[]): Promise<ProductSummary[]> {
  if (ids.length === 0) return [];
  const { data, error } = await getSupabase()
    .from("public_products")
    .select("*")
    .in("id", [...ids]);
  if (error) throw fromDbError(error);
  const byId = new Map((data ?? []).map((r) => [r.id, mapProductSummary(r)]));
  return ids.flatMap((id) => {
    const p = byId.get(id);
    return p ? [p] : [];
  });
}

/** Detalle completo de un producto visible; null si no existe o no es público (la UI muestra 404). */
export async function getProductBySlug(slug: string): Promise<ProductDetail | null> {
  const supabase = getSupabase();
  const found = await supabase
    .from("public_product_detail")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (found.error) throw fromDbError(found.error);
  if (!found.data) return null;
  const product = mapProductDetail(found.data);

  const [colors, sizes, variants, images, related] = await Promise.all([
    supabase
      .from("public_product_colors")
      .select("*")
      .eq("product_id", product.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("public_product_sizes")
      .select("*")
      .eq("product_id", product.id)
      .order("sort_order", { ascending: true }),
    supabase.from("public_product_variants").select("*").eq("product_id", product.id),
    supabase
      .from("public_product_images")
      .select("*")
      .eq("product_id", product.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("public_product_related")
      .select("*")
      .eq("product_id", product.id)
      .order("sort_order", { ascending: true }),
  ]);
  for (const r of [colors, sizes, variants, images, related]) {
    if (r.error) throw fromDbError(r.error);
  }
  const relatedIds = (related.data ?? []).flatMap((r) => (r.related_id ? [r.related_id] : []));
  return {
    product,
    colors: (colors.data ?? []).map(mapColor),
    sizes: (sizes.data ?? []).map(mapSize),
    variants: (variants.data ?? []).map(mapVariant),
    images: (images.data ?? []).map(mapImage),
    related: await productsByIds(relatedIds),
  };
}

/** Búsqueda sin acentos por nombre, modelo y código (servidor: `public_search_products`). */
export async function searchProducts(
  query: string,
  limit = DEFAULT_PAGE_SIZE,
): Promise<ProductSummary[]> {
  const q = query.trim();
  if (q.length < MIN_SEARCH_LENGTH) return [];
  const { data, error } = await getSupabase().rpc("public_search_products", {
    p_query: q,
    p_limit: clamp(Math.trunc(limit), 1, MAX_PAGE_SIZE),
  });
  if (error) throw fromDbError(error);
  return (data ?? []).map(mapProductSummary);
}
