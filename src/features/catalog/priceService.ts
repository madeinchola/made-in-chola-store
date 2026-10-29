import { BASE_CURRENCY } from "@/lib/currencies";
import { fromDecimal, type Money } from "@/lib/money";
import { fromDbError } from "@/lib/db-errors";
import { getSupabase } from "@/lib/supabase";

/**
 * Convierte un `numeric` de la BD a Money SIN pasar por floats imprecisos. PostgREST entrega los `numeric`
 * como número JSON (hasta 14 dígitos, dentro del rango exacto de un double); `fromDecimal` los procesa como
 * decimal textual. Devuelve null si no hay valor (p. ej. sin precio en esa moneda).
 */
export function toMoney(
  amount: number | string | null | undefined,
  currency: string = BASE_CURRENCY,
): Money | null {
  if (amount === null || amount === undefined) return null;
  return fromDecimal(amount, currency);
}

export interface PublicPriceOptions {
  currency?: string;
  country?: string | null;
}

/**
 * Precio de un producto VISIBLE en una moneda/país habilitados (servidor: `public_price_for`). Aplica precio
 * explícito → por país → conversión por tipo de cambio si el producto lo permite. null si no hay precio o el
 * producto no es público (nunca se filtra el precio de borradores o archivados).
 */
export async function getPublicPrice(
  productId: string,
  options: PublicPriceOptions = {},
): Promise<Money | null> {
  const currency = options.currency ?? BASE_CURRENCY;
  const { data, error } = await getSupabase().rpc("public_price_for", {
    p_product_id: productId,
    p_currency: currency,
    ...(options.country ? { p_country: options.country } : {}),
  });
  if (error) throw fromDbError(error);
  return toMoney(data, currency);
}
