import type {
  Category,
  CategoryNode,
  Collection,
  HomeSection,
  HomeSectionItem,
} from "@/features/catalog/types";

/** Secciones ordenadas por `sortOrder` (estable: las empatadas conservan su orden de llegada). */
export function sortSections(sections: readonly HomeSection[]): HomeSection[] {
  return sections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => a.section.sortOrder - b.section.sortOrder || a.index - b.index)
    .map(({ section }) => section);
}

export function sortItems(items: readonly HomeSectionItem[]): HomeSectionItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.sortOrder - b.item.sortOrder || a.index - b.index)
    .map(({ item }) => item);
}

/** La primera sección `hero` (si hay varias, solo la primera lleva el único <h1> de la página). */
export function findHero(sections: readonly HomeSection[]): HomeSection | undefined {
  return sections.find((s) => s.kind === "hero");
}

/** Texto útil: recortado y sin espacios de más; vacío → null. */
export function cleanText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/** Cantidad de productos de una fila: la del admin, acotada a 1–24 (valores raros no rompen el servidor). */
export function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 4;
  return Math.min(Math.max(Math.trunc(limit), 1), 24);
}

/**
 * «Colección NADAS» → ["Colección", "NADAS"]: el diseño pone el NOMBRE de la colección en cursiva. Si el título no
 * empieza por «Colección», no hay nada que resaltar y se devuelve entero.
 */
export function splitCollectionTitle(title: string): { prefix: string; name: string } | null {
  const match = /^(colecci[oó]n)\s+(\S.*)$/i.exec(title.trim());
  return match ? { prefix: match[1] as string, name: (match[2] as string).trim() } : null;
}

/** Proporciones de las baldosas de categorías del PDF: alta · casi cuadrada · grande (se repiten si hay más). */
export const TILE_ASPECTS = ["aspect-[5/7]", "aspect-[7/6]", "aspect-[7/8]"] as const;

export function tileAspect(index: number): string {
  return TILE_ASPECTS[
    ((index % TILE_ASPECTS.length) + TILE_ASPECTS.length) % TILE_ASPECTS.length
  ] as string;
}

/** Con exactamente 3 baldosas la última ocupa 2 columnas (anchos 1·1·2 del diseño); en otro caso, todas 1. */
export function tileSpanClass(index: number, count: number): string {
  return count === 3 && index === 2 ? "col-span-2" : "col-span-1";
}

/** Aplana el árbol de categorías (todas las ramas). */
export function flattenCategories(tree: readonly CategoryNode[]): Category[] {
  const out: Category[] = [];
  const walk = (nodes: readonly CategoryNode[]) => {
    for (const node of nodes) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(tree);
  return out;
}

export type SectionScope =
  | { status: "none" }
  | { status: "pending" }
  | { status: "ready"; scope: { categorySlug?: string; collectionSlug?: string } }
  | { status: "manual"; productIds: string[] };

/**
 * De dónde salen los productos de una sección:
 *  · none → no hay productos;  latest → los más nuevos de toda la tienda;
 *  · category/collection → los de esa categoría/colección (el admin guarda el id y la consulta necesita el slug:
 *    mientras el árbol no ha llegado → pending; si no existe o está archivada/vencida → none);
 *  · manual → los productos elegidos a mano (`items`), en su orden y sin repetir.
 */
export function resolveSectionScope(
  section: HomeSection,
  categories: readonly Category[] | undefined,
  collections: readonly Collection[] | undefined,
): SectionScope {
  switch (section.source.type) {
    case "latest":
      return { status: "ready", scope: {} };
    case "category": {
      if (!section.source.categoryId) return { status: "none" };
      if (!categories) return { status: "pending" };
      const slug = categories.find((c) => c.id === section.source.categoryId)?.slug;
      return slug ? { status: "ready", scope: { categorySlug: slug } } : { status: "none" };
    }
    case "collection": {
      if (!section.source.collectionId) return { status: "none" };
      if (!collections) return { status: "pending" };
      const slug = collections.find((c) => c.id === section.source.collectionId)?.slug;
      return slug ? { status: "ready", scope: { collectionSlug: slug } } : { status: "none" };
    }
    case "manual": {
      const ids = sortItems(section.items).flatMap((item) =>
        item.productId ? [item.productId] : [],
      );
      const unique = [...new Set(ids)];
      return unique.length > 0 ? { status: "manual", productIds: unique } : { status: "none" };
    }
    default:
      return { status: "none" };
  }
}

/** Destino de «Ver todo» de una sección sin enlace propio: su categoría o colección de origen. */
export function fallbackViewAllPath(
  section: HomeSection,
  categories: readonly Category[] | undefined,
  collections: readonly Collection[] | undefined,
): string | null {
  if (section.source.type === "category" && section.source.categoryId) {
    const slug = categories?.find((c) => c.id === section.source.categoryId)?.slug;
    return slug ? `/categoria/${encodeURIComponent(slug)}` : null;
  }
  if (section.source.type === "collection" && section.source.collectionId) {
    const slug = collections?.find((c) => c.id === section.source.collectionId)?.slug;
    return slug ? `/coleccion/${encodeURIComponent(slug)}` : null;
  }
  if (section.source.type === "latest") return "/tienda";
  return null;
}
