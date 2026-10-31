import { t } from "@/i18n";
import { fromDbError, type DbErrorLike } from "@/lib/db-errors";
import { AppError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";

/**
 * Edición concurrente: toda actualización del panel exige que la fila siga con el `updated_at` que se leyó. Si otra persona
 * guardó mientras tanto, la actualización no toca nada y se lanza este error: el segundo guardado NUNCA pisa en silencio.
 */
export class StaleVersionError extends AppError {
  constructor() {
    super("conflict", t("admin.conflict.body"));
    this.name = "StaleVersionError";
  }
}

export const isStaleVersion = (error: unknown): error is StaleVersionError =>
  error instanceof StaleVersionError;

export type VersionedTable =
  | "products"
  | "product_colors"
  | "product_sizes"
  | "product_variants"
  | "product_images"
  | "product_prices"
  | "categories"
  | "collections"
  | "news_banners"
  | "currencies"
  | "store_settings";

interface Outcome<T> {
  data: T | null;
  error: DbErrorLike | null;
}
interface UpdateBuilder {
  eq(column: string, value: string): UpdateBuilder;
  select(columns: string): PromiseLike<Outcome<{ updated_at: string }[]>>;
}
// El nombre de tabla es una unión: el cliente tipado de Supabase no acepta un `update` genérico sobre ella, así que se
// describe aquí la mínima superficie que se usa (la forma real la verifican los tests de integración).
interface LooseTable {
  update(patch: object): UpdateBuilder;
  select(columns: string): {
    eq(
      column: string,
      value: string,
    ): { maybeSingle(): PromiseLike<Outcome<{ updated_at: string }>> };
  };
}

/**
 * Actualiza una fila solo si su `updated_at` coincide con `expectedUpdatedAt` (TEXTO tal cual lo devolvió la base: pasarlo
 * por `Date` perdería los microsegundos y todo guardado parecería un conflicto). Devuelve el nuevo `updated_at`.
 * Lanza `StaleVersionError` si la fila cambió, `AppError("not_found")` si ya no existe.
 */
export async function updateVersioned(
  table: VersionedTable,
  id: string,
  expectedUpdatedAt: string,
  patch: object,
  idColumn = "id",
): Promise<string> {
  const from = () => getSupabase().from(table) as unknown as LooseTable;
  const { data, error } = await from()
    .update(patch)
    .eq(idColumn, id)
    .eq("updated_at", expectedUpdatedAt)
    .select("updated_at");
  if (error) throw fromDbError(error);
  const row = data?.[0];
  if (row) return row.updated_at;

  // 0 filas: ¿alguien cambió la fila, o ya no existe?
  const current = await from().select("updated_at").eq(idColumn, id).maybeSingle();
  if (current.error) throw fromDbError(current.error);
  if (current.data) throw new StaleVersionError();
  throw new AppError("not_found", t("admin.products.edit.notFound"));
}
