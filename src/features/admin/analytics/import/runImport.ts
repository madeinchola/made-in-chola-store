import type { ParsedFile, ParsedRow, RowProblem, RowResult } from "./types";
import { chunkRows } from "./chunks";

/** Lo que pasará (o pasó) con cada fila: lo que dijo la base, o lo que el navegador ya vio antes de preguntar. */
export interface RowOutcome {
  row: number;
  action: RowResult["action"];
  key: string | null;
  errors: RowProblem[];
  /** La descartó el navegador (repetida, fórmula, número ambiguo): no se mandó a la base. */
  local: boolean;
}

export interface ImportCounts {
  create: number;
  update: number;
  skip: number;
  error: number;
}

export interface ImportDeps {
  validate: (kind: ParsedFile["kind"], rows: readonly ParsedRow[]) => Promise<RowResult[]>;
  start: (kind: ParsedFile["kind"], filename: string, total: number) => Promise<string>;
  apply: (batchId: string, rows: readonly ParsedRow[]) => Promise<RowResult[]>;
  finish: (batchId: string) => Promise<void>;
}

export interface RunOptions {
  onProgress?: (progress: { done: number; total: number }) => void;
  shouldCancel?: () => boolean;
}

export const countOutcomes = (outcomes: readonly RowOutcome[]): ImportCounts => ({
  create: outcomes.filter((o) => o.action === "create").length,
  update: outcomes.filter((o) => o.action === "update").length,
  skip: outcomes.filter((o) => o.action === "skip").length,
  error: outcomes.filter((o) => o.action === "error").length,
});

const toOutcome = (r: RowResult, key: string | null): RowOutcome => ({
  row: r.row,
  action: r.action,
  key: r.key ?? key,
  errors: r.errors.map((e) => ({ field: e.field, code: e.code })),
  local: false,
});

/** Las filas que el navegador descartó, con su motivo, listas para el informe. */
function localOutcomes(file: ParsedFile): RowOutcome[] {
  return file.rows
    .filter((r) => r.problems.length > 0)
    .map((r) => ({
      row: r.row,
      action: "error",
      key: r.values.sku || r.values.code || r.values.name || null,
      errors: r.problems,
      local: true,
    }));
}

const sendable = (file: ParsedFile): ParsedRow[] =>
  file.rows.filter((r) => r.problems.length === 0);
const byRow = (a: RowOutcome, b: RowOutcome) => a.row - b.row;

export type PreviewResult =
  { status: "done"; outcomes: RowOutcome[]; counts: ImportCounts } | { status: "cancelled" };

/** Vista previa: pregunta a la base qué haría con cada fila (la base corre la importación de verdad y la deshace). No escribe nada. */
export async function previewImport(
  file: ParsedFile,
  deps: ImportDeps,
  opts: RunOptions = {},
): Promise<PreviewResult> {
  const rows = sendable(file);
  const outcomes: RowOutcome[] = localOutcomes(file);
  let done = 0;
  opts.onProgress?.({ done, total: rows.length });
  for (const chunk of chunkRows(file.kind, rows)) {
    if (opts.shouldCancel?.()) return { status: "cancelled" };
    const results = await deps.validate(file.kind, chunk);
    for (const r of results) outcomes.push(toOutcome(r, null));
    done += chunk.length;
    opts.onProgress?.({ done, total: rows.length });
  }
  outcomes.sort(byRow);
  return { status: "done", outcomes, counts: countOutcomes(outcomes) };
}

export type ApplyResult =
  | { status: "done"; batchId: string; outcomes: RowOutcome[]; counts: ImportCounts }
  | { status: "cancelled"; batchId: string; outcomes: RowOutcome[]; counts: ImportCounts };

/**
 * Confirmar: abre el lote, aplica bloque por bloque (cada uno es una transacción) y lo cierra. Si se cancela o se corta, lo aplicado
 * queda aplicado y el lote queda «en curso» (se ve en el historial y se puede revertir). Las filas con error NO se envían (ni las que
 * descartó el navegador ni las que la revisión ya marcó con error): se omiten y se informan. La base vuelve a validar todo lo que recibe.
 */
export async function applyImport(
  file: ParsedFile,
  deps: ImportDeps,
  opts: RunOptions = {},
  reviewed: readonly RowOutcome[] = [],
): Promise<ApplyResult> {
  const reviewedErrors = new Map(
    reviewed.filter((o) => o.action === "error" && !o.local).map((o) => [o.row, o]),
  );
  const rows = sendable(file).filter((r) => !reviewedErrors.has(r.row));
  const batchId = await deps.start(file.kind, file.fileName, rows.length);
  const outcomes: RowOutcome[] = [...localOutcomes(file), ...reviewedErrors.values()];
  let done = 0;
  opts.onProgress?.({ done, total: rows.length });
  for (const chunk of chunkRows(file.kind, rows)) {
    if (opts.shouldCancel?.()) {
      outcomes.sort(byRow);
      return { status: "cancelled", batchId, outcomes, counts: countOutcomes(outcomes) };
    }
    const results = await deps.apply(batchId, chunk);
    for (const r of results) outcomes.push(toOutcome(r, null));
    done += chunk.length;
    opts.onProgress?.({ done, total: rows.length });
  }
  await deps.finish(batchId);
  outcomes.sort(byRow);
  return { status: "done", batchId, outcomes, counts: countOutcomes(outcomes) };
}
