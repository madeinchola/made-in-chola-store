/** Orden de las imágenes de un producto. Funciones puras: la pantalla decide cuándo escribir en la base. */
export interface Ordered {
  id: string;
  sortOrder: number;
}

/**
 * Dado el orden DESEADO (el arreglo, de primero a último), devuelve solo las filas cuyo `sortOrder` hay que
 * cambiar: la posición i queda con `sortOrder = i + 1`. Si ya está en orden, no devuelve nada (cero escrituras).
 */
export function reorderChanges(desired: readonly Ordered[]): Ordered[] {
  const changes: Ordered[] = [];
  desired.forEach((item, index) => {
    const sortOrder = index + 1;
    if (item.sortOrder !== sortOrder) changes.push({ id: item.id, sortOrder });
  });
  return changes;
}

/** Mueve `id` al primer lugar (la imagen principal es la primera). Un id inexistente no cambia nada. */
export function moveToFront(ids: readonly string[], id: string): string[] {
  const index = ids.indexOf(id);
  if (index <= 0) return [...ids];
  return [id, ...ids.slice(0, index), ...ids.slice(index + 1)];
}

/** Siguiente `sort_order` para una imagen nueva: al final. */
export function nextSortOrder(items: readonly { sortOrder: number }[]): number {
  return items.reduce((max, i) => Math.max(max, i.sortOrder), 0) + 1;
}
