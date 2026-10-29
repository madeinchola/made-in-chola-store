import type { Database } from "@/lib/database.types";
import { AppError } from "@/lib/errors";
import { toMoney } from "./priceService";
import type {
  Category,
  Collection,
  HomeMedia,
  HomeSection,
  HomeSectionItem,
  HomeSectionKind,
  HomeSourceType,
  MediaKind,
  NewsBanner,
  ProductColor,
  ProductDetail,
  ProductImage,
  ProductSize,
  ProductSummary,
  ProductVariant,
  PublicStockStatus,
  StoreSettings,
} from "./types";

type Views = Database["public"]["Views"];

/** Falla en voz alta si el servidor devuelve un campo obligatorio vacío (deriva del esquema). */
function req<T>(value: T | null | undefined, field: string): T {
  if (value === null || value === undefined) {
    throw new AppError("unknown", `Respuesta incompleta del servidor: falta "${field}"`);
  }
  return value;
}

export function mapProductSummary(row: Views["public_products"]["Row"]): ProductSummary {
  const price = toMoney(req(row.price_bob, "price_bob"));
  return {
    id: req(row.id, "id"),
    slug: req(row.slug, "slug"),
    name: req(row.name, "name"),
    isNew: row.is_new ?? false,
    price: req(price, "price_bob"),
    colorsCount: row.colors_count ?? 0,
    soldOut: row.sold_out ?? false,
    coverPath: row.cover_path,
    coverAlt: row.cover_alt,
    createdAt: req(row.created_at, "created_at"),
  };
}

export function mapProductDetail(
  row: Views["public_product_detail"]["Row"],
): ProductDetail["product"] {
  return {
    ...mapProductSummary(row),
    model: row.model,
    description: row.description ?? "",
    materials: row.materials,
    washcare: row.washcare,
  };
}

export function mapColor(row: Views["public_product_colors"]["Row"]): ProductColor {
  return {
    id: req(row.id, "id"),
    name: req(row.name, "name"),
    hex: row.hex,
    sortOrder: row.sort_order ?? 0,
  };
}

export function mapSize(row: Views["public_product_sizes"]["Row"]): ProductSize {
  return { id: req(row.id, "id"), label: req(row.label, "label"), sortOrder: row.sort_order ?? 0 };
}

const STOCK_STATUSES: readonly PublicStockStatus[] = ["in_stock", "low", "out"];

export function mapVariant(row: Views["public_product_variants"]["Row"]): ProductVariant {
  // Un estado desconocido se trata como agotado: ante la duda, no se vende.
  const status = STOCK_STATUSES.find((s) => s === row.stock_status) ?? "out";
  return {
    id: req(row.id, "id"),
    colorId: req(row.color_id, "color_id"),
    sizeId: row.size_id,
    stockStatus: status,
  };
}

export function mapImage(row: Views["public_product_images"]["Row"]): ProductImage {
  return {
    id: req(row.id, "id"),
    colorId: row.color_id,
    path: req(row.path, "path"),
    alt: row.alt,
    sortOrder: row.sort_order ?? 0,
  };
}

export function mapCategory(row: Views["public_categories"]["Row"]): Category {
  return {
    id: req(row.id, "id"),
    parentId: row.parent_id,
    name: req(row.name, "name"),
    slug: req(row.slug, "slug"),
    description: row.description,
    sortOrder: row.sort_order ?? 0,
  };
}

export function mapCollection(row: Views["public_collections"]["Row"]): Collection {
  return {
    id: req(row.id, "id"),
    name: req(row.name, "name"),
    slug: req(row.slug, "slug"),
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    sortOrder: row.sort_order ?? 0,
  };
}

export function mapBanner(row: Views["public_news_banners"]["Row"]): NewsBanner {
  return { id: req(row.id, "id"), message: req(row.message, "message"), linkUrl: row.link_url };
}

/** Solo valores primitivos: ignora cualquier ajuste cuyo valor no sea texto, número o booleano. */
export function mapSettings(rows: Views["public_store_settings"]["Row"][]): StoreSettings {
  const out: StoreSettings = {};
  for (const row of rows) {
    if (!row.key) continue;
    const v = row.value;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[row.key] = v;
  }
  return out;
}

const HOME_KINDS: readonly HomeSectionKind[] = [
  "hero",
  "product_row",
  "collection_feature",
  "about",
  "banner",
  "tagline",
  "category_tiles",
];
const SOURCE_TYPES: readonly HomeSourceType[] = [
  "none",
  "latest",
  "category",
  "collection",
  "manual",
];
const MEDIA_KINDS: readonly MediaKind[] = ["none", "image", "video"];

function mapMedia(kind: string | null, path: string | null, alt: string | null): HomeMedia {
  const k = MEDIA_KINDS.find((m) => m === kind) ?? "none";
  // Sin ruta no hay medio, aunque el tipo diga lo contrario.
  return { kind: path ? k : "none", path: k === "none" ? null : path, alt };
}

export function mapHomeItem(row: Views["public_home_section_items"]["Row"]): HomeSectionItem {
  return {
    id: req(row.id, "id"),
    sortOrder: row.sort_order ?? 0,
    label: row.label,
    linkUrl: row.link_url,
    media: mapMedia(row.media_kind, row.media_path, row.media_alt),
    productId: row.product_id,
    categoryId: row.category_id,
    collectionId: row.collection_id,
  };
}

/**
 * Une secciones con sus elementos. Una sección de un tipo que este front aún no conoce se OMITE (el home
 * sigue funcionando si un admin o una migración futura añade un tipo nuevo antes de actualizar la tienda).
 */
export function mapHome(
  sections: Views["public_home_sections"]["Row"][],
  items: Views["public_home_section_items"]["Row"][],
): HomeSection[] {
  const byParent = new Map<string, HomeSectionItem[]>();
  for (const row of items) {
    if (!row.section_id) continue;
    byParent.set(row.section_id, [...(byParent.get(row.section_id) ?? []), mapHomeItem(row)]);
  }
  const out: HomeSection[] = [];
  for (const row of sections) {
    const kind = HOME_KINDS.find((k) => k === row.kind);
    if (!kind) continue;
    const id = req(row.id, "id");
    const sourceType = SOURCE_TYPES.find((s) => s === row.source_type) ?? "none";
    out.push({
      id,
      kind,
      sortOrder: row.sort_order ?? 0,
      title: row.title,
      body: row.body,
      ctaLabel: row.cta_label,
      ctaUrl: row.cta_url,
      media: mapMedia(row.media_kind, row.media_path, row.media_alt),
      source: {
        type: sourceType,
        categoryId: row.source_category_id,
        collectionId: row.source_collection_id,
      },
      itemLimit: row.item_limit ?? 4,
      items: (byParent.get(id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
    });
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder);
}
