import { t } from "@/i18n";
import { csvFileName, downloadCsv, toCsv, type CsvDelimiter } from "@/lib/csv";
import { csvValue, type CsvNumberFormat } from "./reportFormat";
import type { ReportDef, ReportPageArgs, ReportPageResult, ReportRow } from "./reportTypes";

/** Filas por petición al exportar: lo bastante grandes para pocas llamadas y lo bastante chicas para no pasar los 8 s de la base. */
export const EXPORT_PAGE = 2000;
/** Tope de filas de un archivo. Más allá, hay que acotar el período (una exportación asíncrona con enlace no se hizo). */
export const MAX_EXPORT_ROWS = 50_000;

export interface ExportProgress {
  done: number;
  total: number;
}

export type ExportOutcome =
  | { status: "empty" }
  | { status: "cancelled" }
  | { status: "done"; rows: number; truncated: boolean };

interface ExportDeps {
  fetchPage: (id: ReportDef["id"], args: ReportPageArgs) => Promise<ReportPageResult>;
  download: (filename: string, csv: string) => void;
  now?: Date;
}

export interface ExportRequest {
  report: ReportDef;
  filters: { from: string; to: string; currency: string | null };
  /** Moneda de las columnas de importe que no traen la suya. */
  currency: string;
  format: CsvNumberFormat;
  onProgress?: (progress: ExportProgress) => void;
  shouldCancel?: () => boolean;
}

/** El archivo en filas de texto: el encabezado y, por cada renglón, cada celda con el formato de su columna. */
export function buildCsvRows(
  report: ReportDef,
  rows: readonly ReportRow[],
  currency: string,
  format: CsvNumberFormat,
): string[][] {
  const header = report.columns.map((c) => t(`admin.analytics.reports.cols.${c.header}`));
  const body = rows.map((row) =>
    report.columns.map((c) => {
      const rowCurrency = c.currencyKey ? String(row[c.currencyKey] ?? currency) : currency;
      return csvValue(c.kind, row[c.key] ?? null, rowCurrency, format);
    }),
  );
  return [header, ...body];
}

/**
 * Descarga el reporte COMPLETO del filtro (no solo la página que se ve), pidiendo páginas al servidor, con progreso y cancelación.
 * El archivo se arma en el navegador: no queda en ningún servidor ni en ningún enlace.
 */
export async function exportReport(
  request: ExportRequest,
  deps: ExportDeps,
): Promise<ExportOutcome> {
  const { report, filters, currency, format, onProgress, shouldCancel } = request;
  const collected: ReportRow[] = [];
  let total = 0;
  let grandTotal = 0;
  let offset = 0;
  for (;;) {
    if (shouldCancel?.()) return { status: "cancelled" };
    const page = await deps.fetchPage(report.id, {
      from: filters.from,
      to: filters.to,
      currency: filters.currency,
      offset,
      limit: EXPORT_PAGE,
    });
    grandTotal = page.total;
    total = Math.min(grandTotal, MAX_EXPORT_ROWS);
    collected.push(...page.rows);
    offset += EXPORT_PAGE;
    onProgress?.({ done: Math.min(collected.length, total), total });
    if (
      page.rows.length < EXPORT_PAGE ||
      collected.length >= MAX_EXPORT_ROWS ||
      collected.length >= page.total
    )
      break;
  }
  if (shouldCancel?.()) return { status: "cancelled" };
  if (collected.length === 0) return { status: "empty" };
  const rows = collected.slice(0, MAX_EXPORT_ROWS);
  const delimiter: CsvDelimiter = format === "excel" ? ";" : ",";
  deps.download(
    csvFileName(report.fileBase, deps.now),
    toCsv(buildCsvRows(report, rows, currency, format), { delimiter }),
  );
  return { status: "done", rows: rows.length, truncated: grandTotal > MAX_EXPORT_ROWS };
}

export const defaultExportDeps = (fetchPage: ExportDeps["fetchPage"]): ExportDeps => ({
  fetchPage,
  download: downloadCsv,
});
