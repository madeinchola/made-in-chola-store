import type { Money } from "@/lib/money";

/** Estado público de una variante. Nunca revela cantidades exactas. */
export type PublicStockStatus = "in_stock" | "low" | "out";

/** Semáforo del inventario físico (solo para el panel admin). */
export type StockLight = "ok" | "low" | "critical" | "out";

export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  isNew: boolean;
  /** Precio final (impuestos incluidos) en la moneda base. */
  price: Money;
  colorsCount: number;
  soldOut: boolean;
  /** Ruta en el bucket `product-images`; null = sin imagen (la UI muestra un placeholder). */
  coverPath: string | null;
  coverAlt: string | null;
  createdAt: string;
}

export interface ProductColor {
  id: string;
  name: string;
  hex: string | null;
  sortOrder: number;
}

export interface ProductSize {
  id: string;
  label: string;
  sortOrder: number;
}

export interface ProductVariant {
  id: string;
  colorId: string;
  /** null = producto sin tallas. */
  sizeId: string | null;
  stockStatus: PublicStockStatus;
}

export interface ProductImage {
  id: string;
  /** null = imagen general del producto. */
  colorId: string | null;
  path: string;
  alt: string | null;
  sortOrder: number;
}

export interface ProductDetail {
  product: ProductSummary & {
    model: string | null;
    description: string;
    materials: string | null;
    washcare: string | null;
  };
  colors: ProductColor[];
  sizes: ProductSize[];
  variants: ProductVariant[];
  images: ProductImage[];
  related: ProductSummary[];
}

export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
}

export interface CategoryNode extends Category {
  children: CategoryNode[];
}

export interface Collection {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
}

export interface NewsBanner {
  id: string;
  message: string;
  linkUrl: string | null;
}

export type HomeSectionKind =
  "hero" | "product_row" | "collection_feature" | "about" | "banner" | "tagline" | "category_tiles";

export type HomeSourceType = "none" | "latest" | "category" | "collection" | "manual";
export type MediaKind = "none" | "image" | "video";

export interface HomeMedia {
  kind: MediaKind;
  /** Ruta dentro de `site-media` (imagen) o `site-videos` (video). */
  path: string | null;
  alt: string | null;
}

export interface HomeSectionItem {
  id: string;
  sortOrder: number;
  label: string | null;
  linkUrl: string | null;
  media: HomeMedia;
  productId: string | null;
  categoryId: string | null;
  collectionId: string | null;
}

export interface HomeSection {
  id: string;
  kind: HomeSectionKind;
  sortOrder: number;
  title: string | null;
  body: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  media: HomeMedia;
  source: { type: HomeSourceType; categoryId: string | null; collectionId: string | null };
  itemLimit: number;
  items: HomeSectionItem[];
}

/** Ajustes públicos de la tienda (contacto, redes, WhatsApp, textos del detalle). */
export type StoreSettings = Record<string, string | number | boolean>;

export type ProductSort = "newest" | "price_asc" | "price_desc" | "name";

export interface ListProductsParams {
  categorySlug?: string;
  collectionSlug?: string;
  sort?: ProductSort;
  limit?: number;
  offset?: number;
}

export interface ProductPage {
  items: ProductSummary[];
  total: number;
}

export type StockAdjustReason = "adjust" | "import" | "return";

/** Una variante en el panel admin (con cantidades exactas). */
export interface AdminVariantStock {
  variantId: string;
  productId: string;
  productCode: string;
  productName: string;
  colorName: string;
  sizeLabel: string | null;
  sku: string | null;
  archived: boolean;
  stockOnHand: number;
  reserved: number;
  available: number;
  light: StockLight;
}

/** Resumen de stock de un producto en el panel admin. */
export interface AdminProductStock {
  productId: string;
  code: string;
  name: string;
  totalOnHand: number;
  totalAvailable: number;
  variantsCount: number;
  variantsOut: number;
  /** El peor semáforo entre sus variantes activas; null si no tiene variantes. */
  worstLight: StockLight | null;
}
