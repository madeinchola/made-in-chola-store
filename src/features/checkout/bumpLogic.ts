import type { ProductDetail, ProductSummary } from "@/features/catalog/types";

/** Cuántos candidatos se consultan como máximo (cada uno es una ficha) y cuántos se ofrecen. */
export const BUMP_CANDIDATES = 3;
export const BUMP_SHOWN = 2;

export interface Bump {
  product: ProductSummary;
  variantId: string;
}

/**
 * Los candidatos a «suma a tu pedido»: los relacionados del primer producto de la bolsa, sin lo que ya está en ella ni lo agotado.
 */
export function bumpCandidates(
  related: readonly ProductSummary[] | undefined,
  inBagProductIds: ReadonlySet<string>,
): ProductSummary[] {
  return (related ?? [])
    .filter((product) => !inBagProductIds.has(product.id) && !product.soldOut)
    .slice(0, BUMP_CANDIDATES);
}

/**
 * Solo se ofrece para añadir CON UN CLIC un producto que no necesita elegir nada: exactamente UNA variante con stock (un accesorio, un
 * producto de talla única). Si hay que elegir color o talla, la clienta lo hace en la ficha: aquí no se adivina.
 */
export function oneClickVariant(detail: ProductDetail | null | undefined): string | null {
  if (!detail) return null;
  const available = detail.variants.filter((variant) => variant.stockStatus !== "out");
  return available.length === 1 ? available[0]!.id : null;
}

export function pickBumps(
  candidates: readonly ProductSummary[],
  details: readonly (ProductDetail | null | undefined)[],
): Bump[] {
  const bumps: Bump[] = [];
  candidates.forEach((product, index) => {
    const variantId = oneClickVariant(details[index]);
    if (variantId) bumps.push({ product, variantId });
  });
  return bumps.slice(0, BUMP_SHOWN);
}
