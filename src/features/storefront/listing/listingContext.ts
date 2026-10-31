import type { CategoryNode } from "@/features/catalog/types";
import { PAGE_SIZE } from "./listParams";

/** Busca una categoría (de cualquier nivel) por slug. */
export function findCategory(tree: readonly CategoryNode[], slug: string): CategoryNode | null {
  for (const node of tree) {
    if (node.slug === slug) return node;
    const inChildren = findCategory(node.children, slug);
    if (inChildren) return inChildren;
  }
  return null;
}

/** Camino desde la raíz hasta la categoría (inclusive). Vacío si no existe. */
export function categoryTrail(tree: readonly CategoryNode[], slug: string): CategoryNode[] {
  for (const node of tree) {
    if (node.slug === slug) return [node];
    const rest = categoryTrail(node.children, slug);
    if (rest.length > 0) return [node, ...rest];
  }
  return [];
}

/** Páginas que da un total (mínimo 1: un listado vacío tiene una página, no cero). */
export function totalPagesOf(total: number, pageSize: number = PAGE_SIZE): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}
