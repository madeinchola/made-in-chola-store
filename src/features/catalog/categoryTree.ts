import type { Category, CategoryNode } from "./types";

const byOrder = (a: Category, b: Category) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "es");

/**
 * Árbol de categorías ordenado (por `sortOrder`, luego nombre). Una categoría cuyo padre no está en la lista
 * (p. ej. el padre fue archivado) se trata como raíz para que no desaparezca del menú.
 */
export function buildCategoryTree(categories: readonly Category[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>(
    categories.map((c) => [c.id, { ...c, children: [] }]),
  );
  const roots: CategoryNode[] = [];
  for (const category of [...categories].sort(byOrder)) {
    const node = nodes.get(category.id);
    if (!node) continue;
    const parent = category.parentId ? nodes.get(category.parentId) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Ids de una categoría y de TODAS sus descendientes (un listado de "Ropa" incluye "Chaquetas"). A prueba de ciclos. */
export function descendantIds(categories: readonly Category[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const c of categories) {
    if (!c.parentId) continue;
    childrenOf.set(c.parentId, [...(childrenOf.get(c.parentId) ?? []), c.id]);
  }
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return [...seen];
}
