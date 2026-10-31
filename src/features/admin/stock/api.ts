import { fromDbError } from "@/lib/db-errors";
import { getSupabase } from "@/lib/supabase";
import type { StockLight } from "@/features/catalog/types";

export interface StockAlertSummary {
  low: number;
  critical: number;
  out: number;
  /** low + critical + out. */
  total: number;
}

export type AlertLight = Exclude<StockLight, "ok">;
export const ALERT_LIGHTS: readonly AlertLight[] = ["out", "critical", "low"];

/** Cuántos productos PUBLICADOS (no archivados) tienen cada nivel de alerta como peor semáforo. */
export async function getStockAlertSummary(): Promise<StockAlertSummary> {
  const sb = getSupabase();
  const counts = await Promise.all(
    ALERT_LIGHTS.map((light) =>
      sb
        .from("admin_product_stock")
        .select("product_id", { count: "exact", head: true })
        .eq("status", "active")
        .is("archived_at", null)
        .eq("worst_light", light),
    ),
  );
  for (const c of counts) if (c.error) throw fromDbError(c.error);
  const [out, critical, low] = counts.map((c) => c.count ?? 0) as [number, number, number];
  return { low, critical, out, total: low + critical + out };
}

export interface StockAlertVariant {
  variantId: string;
  productId: string;
  productCode: string;
  productName: string;
  colorName: string;
  sizeLabel: string | null;
  stockOnHand: number;
  light: AlertLight;
}

/**
 * Las variantes más urgentes (primero las que tienen menos stock) de productos publicados y no archivados. Dos pasos porque
 * la vista de variantes no expone si el producto está archivado.
 */
export async function listStockAlertVariants(limit = 8): Promise<StockAlertVariant[]> {
  const sb = getSupabase();
  const products = await sb
    .from("admin_product_stock")
    .select("product_id")
    .eq("status", "active")
    .is("archived_at", null)
    .in("worst_light", [...ALERT_LIGHTS])
    .limit(200);
  if (products.error) throw fromDbError(products.error);
  const ids = (products.data ?? [])
    .map((p) => p.product_id)
    .filter((id): id is string => id !== null);
  if (ids.length === 0) return [];

  const { data, error } = await sb
    .from("admin_stock_overview")
    .select(
      "variant_id,product_id,product_code,product_name,color_name,size_label,stock_on_hand,stock_light",
    )
    .in("product_id", ids)
    .is("variant_archived_at", null)
    .in("stock_light", [...ALERT_LIGHTS])
    .order("stock_on_hand", { ascending: true })
    .order("product_name", { ascending: true })
    .limit(limit);
  if (error) throw fromDbError(error);
  return (data ?? []).flatMap((r) => {
    const light = ALERT_LIGHTS.find((l) => l === r.stock_light);
    if (!light || !r.variant_id || !r.product_id) return [];
    return [
      {
        variantId: r.variant_id,
        productId: r.product_id,
        productCode: String(r.product_code),
        productName: String(r.product_name),
        colorName: String(r.color_name),
        sizeLabel: r.size_label,
        stockOnHand: r.stock_on_hand ?? 0,
        light,
      },
    ];
  });
}
