/** Cuántas páginas hacen falta para `total` elementos (mínimo 1: una lista vacía sigue teniendo una página). */
export const pageCount = (total: number, pageSize: number): number =>
  Math.max(1, Math.ceil(total / pageSize));
