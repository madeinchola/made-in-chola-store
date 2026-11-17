export type ImportKind = "products" | "stock" | "prices" | "categories";

/** Un problema de una fila (de las que el navegador puede ver sin preguntar a la base, o de las que devuelve la base). */
export interface RowProblem {
  field: string;
  code: string;
}

export interface ParsedRow {
  /** Número de línea en el archivo (la primera fila de datos es la 2: la 1 es el encabezado). */
  row: number;
  values: Record<string, string>;
  /** Problemas que el navegador ya vio: esas filas no se mandan a la base. */
  problems: RowProblem[];
}

export interface ParsedFile {
  kind: ImportKind;
  fileName: string;
  rows: ParsedRow[];
  /** Encabezados que no son de esta plantilla (se ignoran, pero se avisa). */
  ignoredColumns: string[];
  encoding: "utf-8" | "windows-1252";
  delimiter: string;
}

export type ParseFailureCode =
  "not_csv" | "too_big" | "too_many_rows" | "empty" | "missing_columns" | "unreadable";

export interface ParseFailure {
  code: ParseFailureCode;
  detail?: string;
}

export type ParseOutcome = { ok: true; file: ParsedFile } | { ok: false; failure: ParseFailure };

/** Lo que devuelve la base por cada fila de un bloque. */
export interface RowResult {
  row: number;
  action: "create" | "update" | "skip" | "error";
  key: string | null;
  errors: { field: string; code: string; constraint?: string | null }[];
}

export interface ImportBatch {
  id: string;
  kind: ImportKind;
  filename: string | null;
  status: "applying" | "done" | "rolled_back" | "partially_rolled_back";
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  createdAt: string;
  finishedAt: string | null;
  rolledBackAt: string | null;
}

export interface RollbackResult {
  reverted: number;
  total: number;
  conflicts: { row: number; entity: string | null; key: string | null; reason: string }[];
}
