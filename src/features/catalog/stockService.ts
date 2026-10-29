import { fromDbError } from "@/lib/db-errors";
import { AppError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import type {
  AdminProductStock,
  AdminVariantStock,
  PublicStockStatus,
  StockAdjustReason,
  StockLight,
} from "./types";

/** Una variante "agotada" no se puede comprar; "pocas unidades" sí. */
export function isPurchasable(status: PublicStockStatus): boolean {
  return status !== "out";
}

export const STOCK_ADJUST_REASONS: readonly StockAdjustReason[] = ["adjust", "import", "return"];

export interface AdjustStockInput {
  variantId: string;
  /** Positivo suma, negativo resta. Entero distinto de 0. */
  delta: number;
  reason: StockAdjustReason;
  note?: string;
}

/**
 * Ajuste manual de stock (solo admin; lo verifica el servidor). Devuelve el stock resultante. El servidor
 * rechaza dejar stock negativo y bajar de lo ya comprometido en pedidos.
 */
export async function adjustStock(input: AdjustStockInput): Promise<number> {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new AppError("validation", "El ajuste debe ser un número entero distinto de 0.");
  }
  if (!STOCK_ADJUST_REASONS.includes(input.reason)) {
    throw new AppError("validation", "Motivo de ajuste no válido.");
  }
  const note = input.note?.trim();
  const { data, error } = await getSupabase().rpc("adjust_stock", {
    p_variant_id: input.variantId,
    p_delta: input.delta,
    p_reason: input.reason,
    ...(note ? { p_note: note } : {}),
  });
  if (error) throw fromDbError(error);
  return data;
}

const LIGHTS: readonly StockLight[] = ["ok", "low", "critical", "out"];
const asLight = (v: string | null): StockLight | null => LIGHTS.find((l) => l === v) ?? null;

/** Variantes con cantidades exactas (solo el admin ve filas: la vista filtra por is_admin()). */
export async function listAdminStock(productId?: string): Promise<AdminVariantStock[]> {
  let query = getSupabase()
    .from("admin_stock_overview")
    .select("*")
    .order("product_name", { ascending: true })
    .order("color_name", { ascending: true })
    .order("size_label", { ascending: true });
  if (productId) query = query.eq("product_id", productId);
  const { data, error } = await query;
  if (error) throw fromDbError(error);
  return (data ?? []).map((r) => ({
    variantId: String(r.variant_id),
    productId: String(r.product_id),
    productCode: String(r.product_code),
    productName: String(r.product_name),
    colorName: String(r.color_name),
    sizeLabel: r.size_label,
    sku: r.sku,
    archived: r.variant_archived_at !== null,
    stockOnHand: r.stock_on_hand ?? 0,
    reserved: r.reserved ?? 0,
    available: r.available ?? 0,
    // Una luz desconocida se trata como la más grave: que el admin lo revise.
    light: asLight(r.stock_light) ?? "critical",
  }));
}

/** Resumen por producto para la lista del panel (semáforo = el peor de sus variantes activas). */
export async function listAdminProductStock(): Promise<AdminProductStock[]> {
  const { data, error } = await getSupabase()
    .from("admin_product_stock")
    .select("*")
    .is("archived_at", null)
    .order("name", { ascending: true });
  if (error) throw fromDbError(error);
  return (data ?? []).map((r) => ({
    productId: String(r.product_id),
    code: String(r.code),
    name: String(r.name),
    totalOnHand: r.total_on_hand ?? 0,
    totalAvailable: r.total_available ?? 0,
    variantsCount: r.variants_count ?? 0,
    variantsOut: r.variants_out ?? 0,
    worstLight: asLight(r.worst_light),
  }));
}
