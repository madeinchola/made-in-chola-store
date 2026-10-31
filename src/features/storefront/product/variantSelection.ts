import type { ProductDetail, ProductVariant, PublicStockStatus } from "@/features/catalog/types";
import { isPurchasable } from "@/features/catalog/stockService";

/**
 * Selección de color y talla de la ficha: lógica PURA (sin React) y sin cantidades exactas, solo el estado público de
 * cada variante (`in_stock` | `low` | `out`). Una combinación color+talla que no existe como variante NO se puede
 * elegir; una que existe pero está agotada tampoco.
 */
type Detail = Pick<ProductDetail, "colors" | "sizes" | "variants">;

/** «Azúl Marino» → «azul-marino»: el nombre del color como va en la URL (`?color=azul-marino`). */
export function colorSlug(name: string): string {
  const withoutAccents = Array.from(name.normalize("NFD"))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x300 || code > 0x36f; // marcas diacríticas combinadas
    })
    .join("");
  return withoutAccents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface ColorOption {
  id: string;
  name: string;
  hex: string | null;
  slug: string;
  /** Alguna variante de este color se puede comprar. */
  available: boolean;
}

/**
 * Opciones de color con un slug ÚNICO por producto: la base solo garantiza nombres distintos (sin importar acentos,
 * mayúsculas ni signos), así que «Café» y «Cafe», o dos nombres solo con emojis, darían el mismo slug (o ninguno) y
 * el segundo no se podría elegir por enlace. El primero conserva el slug limpio; los demás llevan `-2`, `-3`…; un
 * nombre sin letras ni números usa `color-<posición>`.
 */
export function colorOptions(detail: Detail): ColorOption[] {
  const taken = new Set<string>();
  return detail.colors.map((color, index) => {
    const base = colorSlug(color.name) || `color-${index + 1}`;
    let slug = base;
    for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
    taken.add(slug);
    return {
      id: color.id,
      name: color.name,
      hex: color.hex,
      slug,
      available: detail.variants.some(
        (v) => v.colorId === color.id && isPurchasable(v.stockStatus),
      ),
    };
  });
}

/** ¿El producto tiene tallas? (si no, cada color tiene una única variante sin talla) */
export const hasSizes = (detail: Detail): boolean => detail.sizes.length > 0;

/** Color por defecto: el primero con algo disponible; si todo está agotado, el primero. null si no hay colores. */
export function defaultColorId(detail: Detail): string | null {
  const options = colorOptions(detail);
  return (options.find((o) => o.available) ?? options[0])?.id ?? null;
}

/**
 * Color pedido por la URL (`?color=negro`) si existe; un valor inválido o desconocido se ignora y manda el de por
 * defecto (nunca lanza ni deja la pantalla sin color).
 */
export function resolveColorId(
  detail: Detail,
  requestedSlug: string | null | undefined,
): string | null {
  const requested = requestedSlug ? colorSlug(requestedSlug) : "";
  if (requested) {
    const match = colorOptions(detail).find((o) => o.slug === requested);
    if (match) return match.id;
  }
  return defaultColorId(detail);
}

export const variantFor = (
  detail: Detail,
  colorId: string,
  sizeId: string | null,
): ProductVariant | undefined =>
  detail.variants.find((v) => v.colorId === colorId && v.sizeId === sizeId);

export type SizeState = PublicStockStatus | "unavailable";

export interface SizeOption {
  id: string;
  label: string;
  /** `unavailable`: ese color no tiene esa talla. */
  state: SizeState;
  /** Se puede elegir (existe y no está agotada). */
  selectable: boolean;
}

/** Tallas del producto en el orden del admin, con su estado PARA ESE COLOR. */
export function sizeOptions(detail: Detail, colorId: string | null): SizeOption[] {
  return detail.sizes.map((size) => {
    const variant = colorId === null ? undefined : variantFor(detail, colorId, size.id);
    const state: SizeState = variant ? variant.stockStatus : "unavailable";
    return {
      id: size.id,
      label: size.label,
      state,
      selectable: state !== "out" && state !== "unavailable",
    };
  });
}

/** Talla única: se preselecciona (si se puede comprar en ese color). Con varias tallas no se adivina nada. */
export function autoSizeId(detail: Detail, colorId: string | null): string | null {
  if (detail.sizes.length !== 1) return null;
  const only = sizeOptions(detail, colorId)[0];
  return only?.selectable ? only.id : null;
}

/** La talla elegida solo vale si sigue siendo elegible en ese color; si no, la talla única o ninguna. */
export function reconcileSize(
  detail: Detail,
  colorId: string | null,
  sizeId: string | null,
): string | null {
  if (
    sizeId !== null &&
    sizeOptions(detail, colorId).some((o) => o.id === sizeId && o.selectable)
  ) {
    return sizeId;
  }
  return autoSizeId(detail, colorId);
}

/** Al cambiar de color: se conserva la talla si sigue disponible; si no, se limpia (o queda la talla única). */
export const keepSizeAfterColorChange = reconcileSize;

export type PurchaseState =
  /** Todo el producto está agotado. */
  | "sold_out"
  /** Este color está agotado pero otros no. */
  | "color_sold_out"
  /** Hay tallas y falta elegir una. */
  | "choose_size"
  | "ready";

export interface Selection {
  state: PurchaseState;
  /** Variante elegida (solo en `ready`). */
  variant: ProductVariant | null;
  /** Estado de esa variante: `low` muestra «Pocas unidades». */
  status: PublicStockStatus | null;
}

/** Qué puede hacer la persona con la selección actual (decide el botón principal). */
export function selectionState(
  detail: Detail,
  colorId: string | null,
  sizeId: string | null,
): Selection {
  const none = (state: PurchaseState): Selection => ({ state, variant: null, status: null });
  if (!detail.variants.some((v) => isPurchasable(v.stockStatus))) return none("sold_out");
  if (colorId === null) return none("sold_out");

  const ofColor = detail.variants.filter((v) => v.colorId === colorId);
  if (!ofColor.some((v) => isPurchasable(v.stockStatus))) return none("color_sold_out");

  if (hasSizes(detail)) {
    const size = reconcileSize(detail, colorId, sizeId);
    if (size === null) return none("choose_size");
    const variant = variantFor(detail, colorId, size);
    return variant && isPurchasable(variant.stockStatus)
      ? { state: "ready", variant, status: variant.stockStatus }
      : none("choose_size");
  }
  const variant = ofColor.find((v) => v.sizeId === null) ?? ofColor[0];
  return variant && isPurchasable(variant.stockStatus)
    ? { state: "ready", variant, status: variant.stockStatus }
    : none("color_sold_out");
}

/** Disponibilidad del producto para los datos estructurados: algo disponible → in_stock; solo pocas → low; nada → out. */
export function aggregateAvailability(detail: Detail): PublicStockStatus {
  if (detail.variants.some((v) => v.stockStatus === "in_stock")) return "in_stock";
  if (detail.variants.some((v) => v.stockStatus === "low")) return "low";
  return "out";
}
