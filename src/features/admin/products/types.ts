import type { StockLight } from "@/features/catalog/types";

export type ProductStatus = "draft" | "active";
export type OutOfStockBehavior = "sold_out" | "hide";
/** Estado que ve el admin en el listado (las mismas reglas que la tienda pública; ver admin_product_list). */
export type DisplayState = "active" | "draft" | "soldout" | "hidden" | "archived";
/** Filtro de estado del listado. "all" = todo menos archivados. */
export type StateFilter = "all" | "active" | "draft" | "soldout" | "archived";
export type ListSort = "newest" | "updated" | "name" | "code";

export interface AdminProductRow {
  id: string;
  code: string;
  slug: string;
  name: string;
  status: ProductStatus;
  archived: boolean;
  isNew: boolean;
  outOfStockBehavior: OutOfStockBehavior;
  createdAt: string;
  updatedAt: string;
  priceBob: string | null;
  coverPath: string | null;
  categoryIds: string[];
  collectionIds: string[];
  totalOnHand: number;
  totalAvailable: number;
  variantsCount: number;
  variantsOut: number;
  worstLight: StockLight | null;
  displayState: DisplayState;
}

export interface AdminProductListParams {
  search?: string;
  state: StateFilter;
  categoryId?: string;
  collectionId?: string;
  /** Un nivel de stock, o "alert" = cualquiera con alerta (bajo, crítico o agotado). */
  stockLight?: StockLight | "alert";
  sort: ListSort;
  /** Empieza en 1. */
  page: number;
  pageSize: number;
}

export interface AdminProductList {
  rows: AdminProductRow[];
  total: number;
}

export interface AdminProductData {
  id: string;
  code: string;
  slug: string;
  name: string;
  model: string | null;
  description: string;
  materials: string | null;
  washcare: string | null;
  costBase: string | null;
  outOfStockBehavior: OutOfStockBehavior;
  status: ProductStatus;
  isNew: boolean;
  allowConvertedPrices: boolean;
  archived: boolean;
  createdAt: string;
  /** Versión de la fila: se devuelve tal cual al guardar (control de edición concurrente). */
  updatedAt: string;
}

export interface AdminColor {
  id: string;
  name: string;
  hex: string | null;
  sortOrder: number;
  archived: boolean;
  updatedAt: string;
}

export interface AdminSize {
  id: string;
  label: string;
  sortOrder: number;
  archived: boolean;
  updatedAt: string;
}

export interface AdminVariant {
  id: string;
  colorId: string;
  sizeId: string | null;
  sku: string;
  archived: boolean;
  stockOnHand: number;
  reserved: number;
  available: number;
  light: StockLight;
}

export interface AdminImage {
  id: string;
  path: string;
  alt: string | null;
  colorId: string | null;
  sortOrder: number;
  updatedAt: string;
}

export interface AdminPrice {
  id: string;
  currency: string;
  country: string | null;
  amount: string;
  updatedAt: string;
}

export interface RelatedProduct {
  id: string;
  code: string;
  name: string;
}

export interface AdminProductDetail {
  product: AdminProductData;
  colors: AdminColor[];
  sizes: AdminSize[];
  variants: AdminVariant[];
  images: AdminImage[];
  prices: AdminPrice[];
  categoryIds: string[];
  collectionIds: string[];
  related: RelatedProduct[];
}

export interface TaxonomyOption {
  id: string;
  name: string;
  archived: boolean;
  parentId?: string | null;
}
