/** Carga diferida del contenido del cajón de la bolsa (líneas, cuenta regresiva, botones): no entra en la carga inicial. */
export const loadMiniCartContent = () => import("./MiniCartContent");

/** Adelanta la descarga del contenido del cajón (p. ej. al pasar el ratón por «Agregar a la bolsa»). */
export function preloadMiniCart(): void {
  // Sin red el import falla: es solo una descarga adelantada, así que su error no se propaga (no es un rechazo sin atender).
  loadMiniCartContent().catch(() => undefined);
}
