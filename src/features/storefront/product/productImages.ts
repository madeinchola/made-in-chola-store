import type { ProductImage } from "@/features/catalog/types";

const bySort = (a: ProductImage, b: ProductImage) =>
  a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);

/**
 * Imágenes que se muestran para un color: primero las propias de ese color y después las generales (`colorId` null),
 * cada grupo por su orden. Si el color no tiene propias, solo las generales. Si no hubiera ninguna de las dos (el
 * producto solo tiene fotos de OTROS colores) se muestran todas antes que dejar la ficha sin foto.
 */
export function imagesForColor(
  images: readonly ProductImage[],
  colorId: string | null,
): ProductImage[] {
  const own = colorId === null ? [] : images.filter((i) => i.colorId === colorId).sort(bySort);
  const general = images.filter((i) => i.colorId === null).sort(bySort);
  const merged = [...own, ...general];
  return merged.length > 0 ? merged : [...images].sort(bySort);
}
