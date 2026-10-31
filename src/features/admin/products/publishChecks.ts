import type { AdminProductDetail } from "./types";

export interface PublishChecks {
  /** Tiene precio general en bolivianos. BLOQUEA (la base no deja publicar sin él). */
  price: boolean;
  /** Tiene al menos una variante activa de un color activo. BLOQUEA (la base tampoco lo permite). */
  variants: boolean;
  /** Tiene al menos una imagen. Solo AVISA: la tienda muestra un marcador sin imagen. */
  images: boolean;
  /** Hay stock disponible en alguna variante. Solo AVISA: se publicaría como agotado. */
  stock: boolean;
  /** Se puede publicar (cumple lo que la base exige). */
  canPublish: boolean;
  /** Algo de lo que solo avisamos no se cumple. */
  hasWarnings: boolean;
}

/** Qué le falta a un producto antes de publicarlo. Función pura sobre el detalle ya cargado. */
export function publishChecks(detail: AdminProductDetail): PublishChecks {
  const activeColors = new Set(detail.colors.filter((c) => !c.archived).map((c) => c.id));
  const activeVariants = detail.variants.filter((v) => !v.archived && activeColors.has(v.colorId));

  const price = detail.prices.some((p) => p.currency === "BOB" && p.country === null);
  const variants = activeVariants.length > 0;
  const images = detail.images.length > 0;
  const stock = activeVariants.some((v) => v.available > 0);

  return {
    price,
    variants,
    images,
    stock,
    canPublish: price && variants,
    hasWarnings: !images || !stock,
  };
}
