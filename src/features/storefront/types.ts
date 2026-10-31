/** Opciones de filtro de un listado (colores, tallas y rango de precio de lo visible en esa categoría/colección). */
export interface ListingFacets {
  colors: { name: string; hex: string | null; count: number }[];
  sizes: { label: string; count: number }[];
  priceMin: number | null;
  priceMax: number | null;
}

/** Dónde se lista: toda la tienda, una categoría o una colección. */
export interface ListingScope {
  categorySlug?: string;
  collectionSlug?: string;
}
