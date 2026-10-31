import type { AdminColor, AdminImage } from "../types";

/**
 * ¿La tienda muestra esta imagen? Una imagen asignada a un color ARCHIVADO queda oculta (la tienda y el listado del panel
 * la excluyen: `color_id is null or color activo`). Archivar un color no archiva sus imágenes, por eso hay que filtrar.
 */
export function isImageVisible(image: AdminImage, colors: readonly AdminColor[]): boolean {
  if (!image.colorId) return true;
  const color = colors.find((c) => c.id === image.colorId);
  return color ? !color.archived : true;
}

/** La portada REAL: la primera imagen visible (por orden). Es la misma que ve la tienda y la que lista el panel. */
export function coverImage(
  images: readonly AdminImage[],
  colors: readonly AdminColor[],
): AdminImage | undefined {
  return images.find((image) => isImageVisible(image, colors));
}
