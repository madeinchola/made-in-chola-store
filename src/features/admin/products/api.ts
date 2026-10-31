import type { StockLight } from "@/features/catalog/types";
import { fromDbError } from "@/lib/db-errors";
import { AppError } from "@/lib/errors";
import type { Database } from "@/lib/database.types";
import { getSupabase } from "@/lib/supabase";
import { updateVersioned } from "../lib/versioned";
import { type ColorDraft, type ProductDataPatch } from "./productSchema";
import { productImagePath, type PreparedImage } from "./imageProcessing";
import { nextSortOrder, type Ordered } from "./imageOrder";
import { planVariants, type VariantPlan } from "./variantPlan";
import type {
  AdminColor,
  AdminImage,
  AdminPrice,
  AdminProductDetail,
  AdminProductList,
  AdminProductListParams,
  AdminProductRow,
  AdminSize,
  AdminVariant,
  DisplayState,
  OutOfStockBehavior,
  ProductStatus,
  RelatedProduct,
  TaxonomyOption,
} from "./types";

const LIGHTS: readonly StockLight[] = ["ok", "low", "critical", "out"];
const asLight = (v: string | null): StockLight | null => LIGHTS.find((l) => l === v) ?? null;
const STATES: readonly DisplayState[] = ["active", "draft", "soldout", "hidden", "archived"];
const asState = (v: string | null): DisplayState => STATES.find((s) => s === v) ?? "draft";

/** Sin los caracteres que rompen la sintaxis de un filtro `or` de PostgREST ni los comodines de LIKE. */
export function searchTerm(raw: string): string {
  return raw
    .replace(/[%,()"\\*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type ListRow = Database["public"]["Views"]["admin_product_list"]["Row"];

const mapListRow = (r: ListRow): AdminProductRow => ({
  id: String(r.id),
  code: String(r.code),
  slug: String(r.slug),
  name: String(r.name),
  status: r.status === "active" ? "active" : "draft",
  archived: r.archived_at !== null,
  isNew: Boolean(r.is_new),
  outOfStockBehavior: r.out_of_stock_behavior === "hide" ? "hide" : "sold_out",
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  priceBob: r.price_bob === null ? null : String(r.price_bob),
  coverPath: r.cover_path,
  categoryIds: r.category_ids ?? [],
  collectionIds: r.collection_ids ?? [],
  totalOnHand: r.total_on_hand ?? 0,
  totalAvailable: r.total_available ?? 0,
  variantsCount: r.variants_count ?? 0,
  variantsOut: r.variants_out ?? 0,
  worstLight: asLight(r.worst_light),
  displayState: asState(r.display_state),
});

/** Listado del panel: una sola consulta con filtros, orden, paginación y conteo exacto en el servidor. */
export async function listAdminProducts(params: AdminProductListParams): Promise<AdminProductList> {
  let query = getSupabase().from("admin_product_list").select("*", { count: "exact" });

  switch (params.state) {
    case "all":
      query = query.is("archived_at", null);
      break;
    case "active":
      query = query.is("archived_at", null).eq("status", "active");
      break;
    case "draft":
      query = query.is("archived_at", null).eq("status", "draft");
      break;
    case "soldout":
      query = query.in("display_state", ["soldout", "hidden"]);
      break;
    case "archived":
      query = query.not("archived_at", "is", null);
      break;
  }
  if (params.categoryId) query = query.contains("category_ids", [params.categoryId]);
  if (params.collectionId) query = query.contains("collection_ids", [params.collectionId]);
  if (params.stockLight === "alert") query = query.in("worst_light", ["low", "critical", "out"]);
  else if (params.stockLight) query = query.eq("worst_light", params.stockLight);
  const term = searchTerm(params.search ?? "");
  if (term) query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%`);

  switch (params.sort) {
    case "newest":
      query = query.order("created_at", { ascending: false });
      break;
    case "updated":
      query = query.order("updated_at", { ascending: false });
      break;
    case "name":
      query = query.order("name", { ascending: true });
      break;
    case "code":
      query = query.order("code", { ascending: true });
      break;
  }
  // El id desempata: sin él, dos productos con el mismo valor pueden saltar de página al paginar.
  query = query.order("id", { ascending: true });

  const from = (Math.max(1, params.page) - 1) * params.pageSize;
  const { data, error, count } = await query.range(from, from + params.pageSize - 1);
  if (error?.code === "PGRST103") {
    // Página más allá del final (URL a mano, o se archivó el último de la última página): PostgREST responde 416.
    // No es un fallo: se devuelve una página vacía con el total real para que la pantalla vuelva a la última válida.
    const first = await query.range(0, 0);
    if (first.error) throw fromDbError(first.error);
    return { rows: [], total: first.count ?? 0 };
  }
  if (error) throw fromDbError(error);
  return { rows: (data ?? []).map(mapListRow), total: count ?? 0 };
}

/** Detalle completo para editar. null si no existe. */
export async function getAdminProduct(id: string): Promise<AdminProductDetail | null> {
  const sb = getSupabase();
  const [product, colors, sizes, variants, stock, images, prices, cats, colls, rels] =
    await Promise.all([
      sb.from("products").select("*").eq("id", id).maybeSingle(),
      sb
        .from("product_colors")
        .select("*")
        .eq("product_id", id)
        .order("sort_order")
        .order("created_at"),
      sb
        .from("product_sizes")
        .select("*")
        .eq("product_id", id)
        .order("sort_order")
        .order("created_at"),
      sb
        .from("product_variants")
        .select("id,color_id,size_id,sku,archived_at")
        .eq("product_id", id)
        .order("created_at"),
      sb
        .from("admin_stock_overview")
        .select("variant_id,stock_on_hand,reserved,available,stock_light")
        .eq("product_id", id),
      sb
        .from("product_images")
        .select("*")
        .eq("product_id", id)
        .is("archived_at", null)
        .order("sort_order")
        .order("created_at"),
      sb.from("product_prices").select("*").eq("product_id", id),
      sb.from("product_categories").select("category_id").eq("product_id", id),
      sb.from("product_collections").select("collection_id").eq("product_id", id),
      sb
        .from("product_related")
        .select("related_id,sort_order")
        .eq("product_id", id)
        .order("sort_order"),
    ]);
  for (const r of [product, colors, sizes, variants, stock, images, prices, cats, colls, rels]) {
    if (r.error) throw fromDbError(r.error);
  }
  const p = product.data;
  if (!p) return null;

  const relatedIds = (rels.data ?? []).map((r) => r.related_id);
  let related: RelatedProduct[] = [];
  if (relatedIds.length > 0) {
    const { data, error } = await sb.from("products").select("id,code,name").in("id", relatedIds);
    if (error) throw fromDbError(error);
    const byId = new Map((data ?? []).map((r) => [r.id, r]));
    related = relatedIds.flatMap((rid) => {
      const row = byId.get(rid);
      return row ? [{ id: row.id, code: row.code, name: row.name }] : [];
    });
  }

  const stockByVariant = new Map((stock.data ?? []).map((s) => [String(s.variant_id), s]));
  return {
    product: {
      id: p.id,
      code: p.code,
      slug: p.slug,
      name: p.name,
      model: p.model,
      description: p.description,
      materials: p.materials,
      washcare: p.washcare,
      costBase: p.cost_base === null ? null : String(p.cost_base),
      outOfStockBehavior: p.out_of_stock_behavior === "hide" ? "hide" : "sold_out",
      status: p.status === "active" ? "active" : "draft",
      isNew: p.is_new,
      allowConvertedPrices: p.allow_converted_prices,
      archived: p.archived_at !== null,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    },
    colors: (colors.data ?? []).map((c): AdminColor => ({
      id: c.id,
      name: c.name,
      hex: c.hex,
      sortOrder: c.sort_order,
      archived: c.archived_at !== null,
      updatedAt: c.updated_at,
    })),
    sizes: (sizes.data ?? []).map((s): AdminSize => ({
      id: s.id,
      label: s.label,
      sortOrder: s.sort_order,
      archived: s.archived_at !== null,
      updatedAt: s.updated_at,
    })),
    variants: (variants.data ?? []).map((v): AdminVariant => {
      const st = stockByVariant.get(v.id);
      return {
        id: v.id,
        colorId: v.color_id,
        sizeId: v.size_id,
        sku: v.sku,
        archived: v.archived_at !== null,
        stockOnHand: st?.stock_on_hand ?? 0,
        reserved: st?.reserved ?? 0,
        available: st?.available ?? 0,
        // Una luz desconocida se trata como la más grave: que el admin lo revise.
        light: asLight(st?.stock_light ?? null) ?? "critical",
      };
    }),
    images: (images.data ?? []).map((i): AdminImage => ({
      id: i.id,
      path: i.path,
      alt: i.alt,
      colorId: i.color_id,
      sortOrder: i.sort_order,
      updatedAt: i.updated_at,
    })),
    prices: (prices.data ?? []).map((pr): AdminPrice => ({
      id: pr.id,
      currency: pr.currency,
      country: pr.country,
      amount: String(pr.amount),
      updatedAt: pr.updated_at,
    })),
    categoryIds: (cats.data ?? []).map((c) => c.category_id),
    collectionIds: (colls.data ?? []).map((c) => c.collection_id),
    related,
  };
}

/** ¿Está libre este slug/código? (excluyendo al propio producto al editar). El código no distingue mayúsculas. */
export async function isSlugAvailable(slug: string, excludeId?: string): Promise<boolean> {
  let q = getSupabase()
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("slug", slug);
  if (excludeId) q = q.neq("id", excludeId);
  const { count, error } = await q;
  if (error) throw fromDbError(error);
  return (count ?? 0) === 0;
}

export async function isCodeAvailable(code: string, excludeId?: string): Promise<boolean> {
  // ilike sin comodines = igualdad sin distinguir mayúsculas; `_` es comodín de LIKE, así que se escapa.
  let q = getSupabase()
    .from("products")
    .select("id", { count: "exact", head: true })
    .ilike(
      "code",
      code.replace(/[\\%_]/g, (c) => `\\${c}`),
    );
  if (excludeId) q = q.neq("id", excludeId);
  const { count, error } = await q;
  if (error) throw fromDbError(error);
  return (count ?? 0) === 0;
}

// ── Creación ───────────────────────────────────────────────────────────────────────────────

export interface CreateProductInput {
  data: ProductDataPatch;
  /** Precio en BOB ya validado (texto decimal). */
  priceBob: string;
  colors: ColorDraft[];
  sizes: string[];
}

/** El producto (borrador) se creó pero un paso posterior falló: se puede terminar desde la edición. */
export class PartialCreateError extends AppError {
  constructor(
    readonly productId: string,
    cause: AppError,
  ) {
    super(cause.code, cause.message, { cause });
    this.name = "PartialCreateError";
  }
}

type VariantInsert = Database["public"]["Tables"]["product_variants"]["Insert"];
// El SKU lo completa un trigger de la base cuando llega vacío; el tipo generado no lo sabe y lo exige.
const variantRows = (rows: { product_id: string; color_id: string; size_id: string | null }[]) =>
  rows as unknown as VariantInsert[];

/**
 * Crea el producto como BORRADOR con su precio, colores, tallas y todas las variantes (stock 0). Si falla después de crear
 * el producto, lanza `PartialCreateError` con su id (un borrador a medias no se ve en la tienda y se completa editando).
 */
export async function createProduct(input: CreateProductInput): Promise<{ id: string }> {
  const sb = getSupabase();
  const { data: created, error } = await sb
    .from("products")
    .insert({ ...input.data, status: "draft" })
    .select("id")
    .single();
  if (error) throw fromDbError(error);
  const productId = created.id;
  try {
    const price = await sb
      .from("product_prices")
      .insert({ product_id: productId, currency: "BOB", amount: Number(input.priceBob) });
    if (price.error) throw fromDbError(price.error);

    const colors = await sb
      .from("product_colors")
      .insert(
        input.colors.map((c, i) => ({
          product_id: productId,
          name: c.name.trim(),
          hex: c.hex.trim() === "" ? null : c.hex.trim(),
          sort_order: i + 1,
        })),
      )
      .select("id,name,sort_order");
    if (colors.error) throw fromDbError(colors.error);

    const labels = input.sizes.map((s) => s.trim()).filter(Boolean);
    let sizeRows: { id: string }[] = [];
    if (labels.length > 0) {
      const sizes = await sb
        .from("product_sizes")
        .insert(labels.map((label, i) => ({ product_id: productId, label, sort_order: i + 1 })))
        .select("id,sort_order");
      if (sizes.error) throw fromDbError(sizes.error);
      sizeRows = [...(sizes.data ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    }

    const colorRows = [...(colors.data ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    const plan = planVariants(
      colorRows.map((c) => ({ id: c.id, archived: false })),
      sizeRows.map((s) => ({ id: s.id, archived: false })),
      [],
    );
    await applyPlanCreates(productId, plan.create);
    return { id: productId };
  } catch (e) {
    throw new PartialCreateError(
      productId,
      e instanceof AppError ? e : fromDbError({ message: String(e) }),
    );
  }
}

async function applyPlanCreates(
  productId: string,
  create: { colorId: string; sizeId: string | null }[],
): Promise<void> {
  if (create.length === 0) return;
  const { error } = await getSupabase()
    .from("product_variants")
    .insert(
      variantRows(
        create.map((c) => ({ product_id: productId, color_id: c.colorId, size_id: c.sizeId })),
      ),
    );
  if (error) throw fromDbError(error);
}

// ── Edición del producto (con control de versión) ─────────────────────────────────────────

export const updateProductData = (id: string, expectedUpdatedAt: string, patch: ProductDataPatch) =>
  updateVersioned("products", id, expectedUpdatedAt, patch);

export const setProductStatus = (id: string, expectedUpdatedAt: string, status: ProductStatus) =>
  updateVersioned("products", id, expectedUpdatedAt, { status });

export const setProductArchived = (id: string, expectedUpdatedAt: string, archived: boolean) =>
  updateVersioned("products", id, expectedUpdatedAt, {
    archived_at: archived ? new Date().toISOString() : null,
  });

export async function duplicateProduct(id: string, code: string, name: string): Promise<string> {
  const { data, error } = await getSupabase().rpc("admin_duplicate_product", {
    p_product_id: id,
    p_new_code: code,
    p_new_name: name,
  });
  if (error) throw fromDbError(error);
  return data;
}

// ── Precios ────────────────────────────────────────────────────────────────────────────────

export interface PriceChange {
  currency: string;
  /** Texto decimal ya validado; null = quitar el precio de esa moneda. */
  amount: string | null;
}

/** Aplica los cambios sobre los precios generales (sin país). Actualizar exige la versión leída. */
export async function savePrices(
  productId: string,
  existing: readonly AdminPrice[],
  changes: readonly PriceChange[],
): Promise<void> {
  const sb = getSupabase();
  for (const change of changes) {
    const current = existing.find((p) => p.currency === change.currency && p.country === null);
    if (change.amount === null) {
      if (!current) continue;
      const { error } = await sb.rpc("admin_delete_product_price", {
        p_product_id: productId,
        p_currency: change.currency,
        p_country: null as unknown as string,
      });
      if (error) throw fromDbError(error);
    } else if (current) {
      await updateVersioned("product_prices", current.id, current.updatedAt, {
        amount: Number(change.amount),
      });
    } else {
      const { error } = await sb.from("product_prices").insert({
        product_id: productId,
        currency: change.currency,
        amount: Number(change.amount),
      });
      if (error) throw fromDbError(error);
    }
  }
}

// ── Colores, tallas y variantes ───────────────────────────────────────────────────────────

export async function addColor(
  productId: string,
  color: ColorDraft,
  sortOrder: number,
): Promise<void> {
  const { error } = await getSupabase()
    .from("product_colors")
    .insert({
      product_id: productId,
      name: color.name.trim(),
      hex: color.hex.trim() === "" ? null : color.hex.trim(),
      sort_order: sortOrder,
    });
  if (error) throw fromDbError(error);
}

export const updateColor = (c: AdminColor, patch: { name: string; hex: string | null }) =>
  updateVersioned("product_colors", c.id, c.updatedAt, { name: patch.name.trim(), hex: patch.hex });

export const setColorArchived = (c: AdminColor, archived: boolean) =>
  updateVersioned("product_colors", c.id, c.updatedAt, {
    archived_at: archived ? new Date().toISOString() : null,
  });

export async function addSize(productId: string, label: string, sortOrder: number): Promise<void> {
  const { error } = await getSupabase()
    .from("product_sizes")
    .insert({ product_id: productId, label: label.trim(), sort_order: sortOrder });
  if (error) throw fromDbError(error);
}

export const updateSize = (s: AdminSize, label: string) =>
  updateVersioned("product_sizes", s.id, s.updatedAt, { label: label.trim() });

export const setSizeArchived = (s: AdminSize, archived: boolean) =>
  updateVersioned("product_sizes", s.id, s.updatedAt, {
    archived_at: archived ? new Date().toISOString() : null,
  });

/** Ejecuta un plan de variantes: crea, restaura y archiva (las bloqueadas no se tocan: tienen stock). */
export async function applyVariantPlan(productId: string, plan: VariantPlan): Promise<void> {
  const sb = getSupabase();
  await applyPlanCreates(productId, plan.create);
  for (const id of plan.restore) {
    const { error } = await sb.from("product_variants").update({ archived_at: null }).eq("id", id);
    if (error) throw fromDbError(error);
  }
  if (plan.archive.length > 0) {
    const { error } = await sb
      .from("product_variants")
      .update({ archived_at: new Date().toISOString() })
      .in("id", plan.archive);
    if (error) throw fromDbError(error);
  }
}

// ── Imágenes ───────────────────────────────────────────────────────────────────────────────

/** Sube el archivo al bucket y registra su fila. Si el registro falla, intenta borrar el archivo huérfano. */
export async function uploadProductImage(
  productId: string,
  image: PreparedImage,
  existing: readonly { sortOrder: number }[],
): Promise<AdminImage> {
  const sb = getSupabase();
  const path = productImagePath(productId, crypto.randomUUID(), image.ext);
  const up = await sb.storage.from("product-images").upload(path, image.blob, {
    contentType: image.contentType,
    upsert: false,
    cacheControl: "31536000",
  });
  if (up.error) throw new AppError("unknown", up.error.message, { cause: up.error });

  const { data, error } = await sb
    .from("product_images")
    .insert({ product_id: productId, path, sort_order: nextSortOrder(existing) })
    .select("*")
    .single();
  if (error) {
    await sb.storage.from("product-images").remove([path]);
    throw fromDbError(error);
  }
  return {
    id: data.id,
    path: data.path,
    alt: data.alt,
    colorId: data.color_id,
    sortOrder: data.sort_order,
    updatedAt: data.updated_at,
  };
}

export const updateImage = (
  image: AdminImage,
  patch: { alt?: string | null; color_id?: string | null },
) => updateVersioned("product_images", image.id, image.updatedAt, patch);

export const archiveImage = (image: AdminImage) =>
  updateVersioned("product_images", image.id, image.updatedAt, {
    archived_at: new Date().toISOString(),
  });

/** Escribe el nuevo orden (solo las filas que cambian). Sin control de versión: el orden es de último guardado. */
export async function saveImageOrder(changes: readonly Ordered[]): Promise<void> {
  const sb = getSupabase();
  const results = await Promise.all(
    changes.map((c) =>
      sb.from("product_images").update({ sort_order: c.sortOrder }).eq("id", c.id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw fromDbError(failed.error);
}

// ── Organización: categorías, colecciones y relacionados ──────────────────────────────────

export async function setProductCategories(
  productId: string,
  ids: readonly string[],
): Promise<void> {
  const { error } = await getSupabase().rpc("admin_set_product_categories", {
    p_product_id: productId,
    p_category_ids: [...ids],
  });
  if (error) throw fromDbError(error);
}

export async function setProductCollections(
  productId: string,
  ids: readonly string[],
): Promise<void> {
  const { error } = await getSupabase().rpc("admin_set_product_collections", {
    p_product_id: productId,
    p_collection_ids: [...ids],
  });
  if (error) throw fromDbError(error);
}

export async function setProductRelated(productId: string, ids: readonly string[]): Promise<void> {
  const { error } = await getSupabase().rpc("admin_set_product_related", {
    p_product_id: productId,
    p_related_ids: [...ids],
  });
  if (error) throw fromDbError(error);
}

/** Categorías y colecciones para los selectores (incluye archivadas: un producto puede seguir asociado a una). */
export async function listCategoryOptions(): Promise<TaxonomyOption[]> {
  const { data, error } = await getSupabase()
    .from("categories")
    .select("id,name,parent_id,archived_at")
    .order("sort_order")
    .order("name");
  if (error) throw fromDbError(error);
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    parentId: c.parent_id,
    archived: c.archived_at !== null,
  }));
}

export async function listCollectionOptions(): Promise<TaxonomyOption[]> {
  const { data, error } = await getSupabase()
    .from("collections")
    .select("id,name,archived_at")
    .order("sort_order")
    .order("name");
  if (error) throw fromDbError(error);
  return (data ?? []).map((c) => ({ id: c.id, name: c.name, archived: c.archived_at !== null }));
}

/** Busca productos (no archivados) para marcarlos como relacionados. */
export async function searchProductsForRelation(
  query: string,
  excludeId: string,
): Promise<RelatedProduct[]> {
  const term = searchTerm(query);
  if (term.length < 2) return [];
  const { data, error } = await getSupabase()
    .from("products")
    .select("id,code,name")
    .is("archived_at", null)
    .neq("id", excludeId)
    .or(`name.ilike.%${term}%,code.ilike.%${term}%`)
    .order("name")
    .limit(8);
  if (error) throw fromDbError(error);
  return (data ?? []).map((r) => ({ id: r.id, code: r.code, name: r.name }));
}

// ── Monedas y sincronización de variantes ─────────────────────────────────────────────────

export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
}

/** Monedas habilitadas por el admin (la base, BOB, siempre). */
export async function listEnabledCurrencies(): Promise<CurrencyInfo[]> {
  const { data, error } = await getSupabase()
    .from("currencies")
    .select("code,name,symbol,decimals")
    .eq("enabled", true)
    .order("code");
  if (error) throw fromDbError(error);
  return (data ?? []).map((c) => ({
    code: c.code,
    name: c.name,
    symbol: c.symbol,
    decimals: c.decimals,
  }));
}

/**
 * Tras añadir, archivar o restaurar colores/tallas: lee el estado FRESCO del producto, calcula qué variantes faltan,
 * sobran o hay que restaurar, y lo aplica. Devuelve el plan para que la pantalla informe (p. ej. variantes bloqueadas
 * por tener stock). Es idempotente: ejecutarlo dos veces seguidas no hace nada la segunda.
 */
export async function syncProductVariants(productId: string): Promise<VariantPlan> {
  const detail = await getAdminProduct(productId);
  if (!detail) throw new AppError("not_found", "producto inexistente");
  const plan = planVariants(
    detail.colors.map((c) => ({ id: c.id, archived: c.archived })),
    detail.sizes.map((s) => ({ id: s.id, archived: s.archived })),
    detail.variants.map((v) => ({
      id: v.id,
      colorId: v.colorId,
      sizeId: v.sizeId,
      archived: v.archived,
      stockOnHand: v.stockOnHand,
    })),
  );
  await applyVariantPlan(productId, plan);
  return plan;
}

/**
 * Valor por defecto de "cuando no hay stock" que el admin fijó en Ajustes (`default_out_of_stock_behavior`). Si el ajuste no
 * existe o trae algo inesperado, se usa "agotado" (el valor con el que nace la columna en la base).
 */
export async function getDefaultOutOfStockBehavior(): Promise<OutOfStockBehavior> {
  const { data, error } = await getSupabase()
    .from("store_settings")
    .select("value")
    .eq("key", "default_out_of_stock_behavior")
    .maybeSingle();
  if (error) throw fromDbError(error);
  return data?.value === "hide" ? "hide" : "sold_out";
}

export interface SetVariantStockInput {
  variantId: string;
  /** El stock que la persona VIO al editar: si ya no coincide, la base rechaza (no se aplica a ciegas). */
  expected: number;
  newValue: number;
  reason: "adjust" | "import" | "return";
  note?: string;
}

/**
 * Fija el stock de una variante a un valor EXACTO, comprobando de forma atómica que sigue siendo el que se vio (ver
 * `admin_set_stock`). Si una venta o un compañero lo cambió mientras se editaba, la base rechaza diciendo cuánto hay ahora.
 * Devuelve el stock resultante.
 */
export async function setVariantStock(input: SetVariantStockInput): Promise<number> {
  const { data, error } = await getSupabase().rpc("admin_set_stock", {
    p_variant_id: input.variantId,
    p_expected: input.expected,
    p_new: input.newValue,
    p_reason: input.reason,
    ...(input.note ? { p_note: input.note } : {}),
  });
  if (error) throw fromDbError(error);
  return data;
}
