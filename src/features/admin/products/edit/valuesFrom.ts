import { amountToInput } from "../../lib/amount";
import type { ProductDataValues } from "../productSchema";
import type { AdminProductData } from "../types";

/** Producto guardado → valores iniciales del formulario de datos (nulos → vacío; costo sin ceros sobrantes). */
export const valuesFrom = (p: AdminProductData): ProductDataValues => ({
  name: p.name,
  code: p.code,
  slug: p.slug,
  model: p.model ?? "",
  description: p.description,
  materials: p.materials ?? "",
  washcare: p.washcare ?? "",
  costBase: amountToInput(p.costBase),
  outOfStockBehavior: p.outOfStockBehavior,
  isNew: p.isNew,
  allowConvertedPrices: p.allowConvertedPrices,
});
