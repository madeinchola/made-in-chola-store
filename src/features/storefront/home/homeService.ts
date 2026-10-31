import { mapProductSummary } from "@/features/catalog/mappers";
import type { ProductSummary } from "@/features/catalog/types";
import { fromDbError } from "@/lib/db-errors";
import { getSupabase } from "@/lib/supabase";

/**
 * Productos elegidos a mano para una fila de la portada. Va por la vista pública: un producto que dejó de ser
 * visible (borrador, archivado, oculto) simplemente no aparece. El orden es el que eligió el admin.
 */
export async function getProductsByIds(ids: readonly string[]): Promise<ProductSummary[]> {
  if (ids.length === 0) return [];
  const { data, error } = await getSupabase()
    .from("public_products")
    .select("*")
    .in("id", [...ids]);
  if (error) throw fromDbError(error);
  const byId = new Map((data ?? []).map((row) => [row.id, mapProductSummary(row)]));
  return ids.flatMap((id) => {
    const product = byId.get(id);
    return product ? [product] : [];
  });
}
