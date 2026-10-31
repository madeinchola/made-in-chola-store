import type { AdminCategory } from "./types";

type TreeInput = Pick<AdminCategory, "id" | "parentId">;

const byOrder = (a: AdminCategory, b: AdminCategory) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "es");

export interface CategoryTreeNode extends AdminCategory {
  children: CategoryTreeNode[];
  /** 0 = categoría principal. */
  depth: number;
}

/**
 * Árbol de categorías ordenado por `sortOrder` y luego por nombre. Sin `showArchived` se omiten las archivadas.
 *
 * Robusto por diseño (la base impide ciclos, pero esta función no debe colgarse ni perder categorías jamás):
 *  - una categoría cuyo padre no está en la lista (archivado y oculto, o inexistente) se muestra como principal;
 *  - si hubiera un ciclo, se rompe en el primer miembro y todas las categorías siguen apareciendo.
 */
export function buildCategoryTree(
  categories: readonly AdminCategory[],
  options: { showArchived: boolean },
): CategoryTreeNode[] {
  const visible = categories.filter((c) => options.showArchived || !c.archived);
  const byId = new Map(visible.map((c) => [c.id, c]));
  const childrenOf = new Map<string, AdminCategory[]>();
  const roots: AdminCategory[] = [];
  for (const c of [...visible].sort(byOrder)) {
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    if (parent && parent.id !== c.id)
      childrenOf.set(parent.id, [...(childrenOf.get(parent.id) ?? []), c]);
    else roots.push(c);
  }

  const placed = new Set<string>();
  const attach = (c: AdminCategory, depth: number): CategoryTreeNode => {
    placed.add(c.id);
    const children = (childrenOf.get(c.id) ?? [])
      .filter((child) => !placed.has(child.id))
      .map((child) => attach(child, depth + 1));
    return { ...c, children, depth };
  };
  const tree = roots.map((r) => attach(r, 0));
  // Miembros de un ciclo: no cuelgan de ninguna raíz. Se rescatan como principales, uno por uno.
  for (const c of [...visible].sort(byOrder)) {
    if (!placed.has(c.id)) tree.push(attach(c, 0));
  }
  return tree;
}

/** Recorrido en orden de aparición (cada fila con su profundidad), para pintar el árbol como lista indentada. */
export function flattenTree(nodes: readonly CategoryTreeNode[]): CategoryTreeNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

/** Ids de TODAS las descendientes de `rootId` (hijas, nietas…), sin incluirla. A prueba de ciclos. */
export function descendantIds(categories: readonly TreeInput[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const c of categories) {
    if (c.parentId) childrenOf.set(c.parentId, [...(childrenOf.get(c.parentId) ?? []), c.id]);
  }
  const seen = new Set<string>([rootId]);
  const result: string[] = [];
  const stack = [...(childrenOf.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return result;
}

export interface ParentOption {
  id: string;
  name: string;
  depth: number;
  archived: boolean;
}

/**
 * Padres que se pueden ofrecer al crear o editar una categoría, en orden de árbol y con su profundidad:
 *  - NUNCA ella misma ni ninguna descendiente (crearía un ciclo; la base también lo rechaza);
 *  - las archivadas solo si la categoría editada también está archivada (la base no deja colgar una activa de una archivada).
 * `editingId` null = categoría nueva (activa).
 */
export function validParents(
  categories: readonly AdminCategory[],
  editingId: string | null,
  editingArchived = false,
): ParentOption[] {
  const excluded = new Set<string>(
    editingId ? [editingId, ...descendantIds(categories, editingId)] : [],
  );
  return flattenTree(buildCategoryTree(categories, { showArchived: true }))
    .filter((n) => !excluded.has(n.id) && (editingArchived || !n.archived))
    .map((n) => ({ id: n.id, name: n.name, depth: n.depth, archived: n.archived }));
}

/** Hermanas (mismo padre) en el orden en que se muestran. */
export function siblingsOf(
  categories: readonly AdminCategory[],
  parentId: string | null,
  options: { showArchived: boolean },
): AdminCategory[] {
  return categories
    .filter((c) => c.parentId === parentId && (options.showArchived || !c.archived))
    .sort(byOrder);
}

/** Nuevo orden de ids tras mover `id` una posición ("up" hacia el inicio). En el borde no cambia nada. */
export function moveWithin(ids: readonly string[], id: string, direction: "up" | "down"): string[] {
  const index = ids.indexOf(id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ids.length) return [...ids];
  const next = [...ids];
  [next[index], next[target]] = [next[target] as string, next[index] as string];
  return next;
}
