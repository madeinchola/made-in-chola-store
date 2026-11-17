import { fromDbError } from "@/lib/db-errors";
import { getSupabase } from "@/lib/supabase";
import type { ImportBatch, ImportKind, RollbackResult, RowResult } from "./types";

/**
 * Acceso a la carga masiva. Toda la validación y toda la escritura son de la base (funciones SQL que exigen ser administrador y que
 * comparten UN solo motor para la vista previa y para confirmar): aquí solo se mandan las filas por bloques y se leen los resultados.
 */
type Raw = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await (
    getSupabase().rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>
  )(name, args);
  if (error) throw fromDbError(error as { message: string; code?: string });
  return data;
}

const rowsOf = (raw: unknown): RowResult[] =>
  ((((raw ?? {}) as Raw).rows as Raw[] | undefined) ?? []).map((r) => ({
    row: num(r.row),
    action: str(r.action) as RowResult["action"],
    key: strOrNull(r.key),
    errors: ((r.errors ?? []) as Raw[]).map((e) => ({
      field: str(e.field),
      code: str(e.code),
      constraint: strOrNull(e.constraint),
    })),
  }));

/** Las filas como las entiende la base: el número de fila y los campos. */
const payload = (rows: readonly { row: number; values: Record<string, string> }[]) =>
  rows.map((r) => ({ row: r.row, ...r.values }));

export async function validateChunk(
  kind: ImportKind,
  rows: readonly { row: number; values: Record<string, string> }[],
): Promise<RowResult[]> {
  return rowsOf(await rpc("admin_import_validate", { p_kind: kind, p_rows: payload(rows) }));
}

export async function startBatch(
  kind: ImportKind,
  filename: string,
  total: number,
): Promise<string> {
  return String(
    await rpc("admin_import_start", { p_kind: kind, p_filename: filename, p_total: total }),
  );
}

export async function applyChunk(
  batchId: string,
  rows: readonly { row: number; values: Record<string, string> }[],
): Promise<RowResult[]> {
  return rowsOf(await rpc("admin_import_apply_chunk", { p_batch: batchId, p_rows: payload(rows) }));
}

export async function finishBatch(batchId: string): Promise<void> {
  await rpc("admin_import_finish", { p_batch: batchId });
}

export async function rollbackBatch(batchId: string): Promise<RollbackResult> {
  const r = (await rpc("admin_import_rollback", { p_batch: batchId })) as Raw;
  return {
    reverted: num(r.reverted),
    total: num(r.total),
    conflicts: ((r.conflicts ?? []) as Raw[]).map((c) => ({
      row: num(c.row),
      entity: strOrNull(c.entity),
      key: strOrNull(c.key),
      reason: str(c.reason),
    })),
  };
}

export async function listBatches(limit = 20): Promise<ImportBatch[]> {
  const rows = ((await rpc("admin_import_batches", { p_limit: limit })) ?? []) as Raw[];
  return rows.map((r) => ({
    id: str(r.id),
    kind: str(r.kind) as ImportKind,
    filename: strOrNull(r.filename),
    status: str(r.status) as ImportBatch["status"],
    totalRows: num(r.total_rows),
    createdCount: num(r.created_count),
    updatedCount: num(r.updated_count),
    skippedCount: num(r.skipped_count),
    errorCount: num(r.error_count),
    createdAt: str(r.created_at),
    finishedAt: strOrNull(r.finished_at),
    rolledBackAt: strOrNull(r.rolled_back_at),
  }));
}
