/**
 * Plan de variantes de un producto: de los colores y tallas ACTIVOS se deduce qué combinaciones debe haber, y se
 * compara con las variantes existentes. Es una función pura: no toca la base de datos, solo dice qué hacer.
 *
 * Reglas:
 *  - Sin tallas activas, hay una variante por color (talla null). Con tallas, una por color × talla.
 *  - Una combinación que ya tiene variante ACTIVA no se toca.
 *  - Una combinación que solo tiene variantes ARCHIVADAS se RESTAURA (conserva SKU e historial de stock) en vez de crear otra.
 *  - Una variante activa que ya no corresponde a ninguna combinación se archiva si su stock es 0; si tiene stock,
 *    queda BLOQUEADA: hay que ajustar su stock a 0 antes (nunca se pierde stock en silencio).
 */
export interface PlanColor {
  id: string;
  archived: boolean;
}
export interface PlanSize {
  id: string;
  archived: boolean;
}
export interface PlanVariant {
  id: string;
  colorId: string;
  /** null = variante sin talla. */
  sizeId: string | null;
  archived: boolean;
  stockOnHand: number;
}

export interface VariantPlan {
  create: { colorId: string; sizeId: string | null }[];
  restore: string[];
  archive: string[];
  blocked: { variantId: string; stockOnHand: number }[];
}

const comboKey = (colorId: string, sizeId: string | null) => `${colorId}|${sizeId ?? ""}`;

export function planVariants(
  colors: readonly PlanColor[],
  sizes: readonly PlanSize[],
  variants: readonly PlanVariant[],
): VariantPlan {
  const activeColors = colors.filter((c) => !c.archived);
  const activeSizes = sizes.filter((s) => !s.archived);

  const wanted: { colorId: string; sizeId: string | null }[] = [];
  for (const color of activeColors) {
    if (activeSizes.length === 0) wanted.push({ colorId: color.id, sizeId: null });
    else for (const size of activeSizes) wanted.push({ colorId: color.id, sizeId: size.id });
  }
  const wantedKeys = new Set(wanted.map((w) => comboKey(w.colorId, w.sizeId)));

  const plan: VariantPlan = { create: [], restore: [], archive: [], blocked: [] };

  for (const combo of wanted) {
    const key = comboKey(combo.colorId, combo.sizeId);
    const matches = variants.filter((v) => comboKey(v.colorId, v.sizeId) === key);
    if (matches.some((v) => !v.archived)) continue;
    const archived = matches.filter((v) => v.archived).sort((a, b) => a.id.localeCompare(b.id));
    const first = archived[0];
    if (first) plan.restore.push(first.id);
    else plan.create.push(combo);
  }

  for (const v of variants) {
    if (v.archived || wantedKeys.has(comboKey(v.colorId, v.sizeId))) continue;
    if (v.stockOnHand === 0) plan.archive.push(v.id);
    else plan.blocked.push({ variantId: v.id, stockOnHand: v.stockOnHand });
  }
  return plan;
}

/** ¿El plan no hace nada? (la matriz ya está completa) */
export const isEmptyPlan = (p: VariantPlan): boolean =>
  p.create.length + p.restore.length + p.archive.length + p.blocked.length === 0;
