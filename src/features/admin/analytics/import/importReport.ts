import { t } from "@/i18n";
import { csvFileName, downloadCsv, toCsv } from "@/lib/csv";
import { explainProblem } from "./importMessages";
import type { RowOutcome } from "./runImport";

/**
 * El informe de una revisión o de una carga: una fila por cada fila del archivo, con su número (el de la hoja de cálculo), su clave,
 * qué pasó (o qué pasaría) y por qué. Es lo que se descarga para corregir los errores y volver a subir.
 */
export function buildImportReport(
  outcomes: readonly RowOutcome[],
  mode: "preview" | "final",
): string[][] {
  const words = mode === "preview" ? "result" : "resultDone";
  return [
    [
      t("admin.analytics.import.review.colRow"),
      t("admin.analytics.import.review.colKey"),
      t("admin.analytics.import.review.colResult"),
      t("admin.analytics.import.review.colDetail"),
    ],
    ...outcomes.map((o) => [
      String(o.row),
      o.key ?? "",
      t(`admin.analytics.import.${words}.${o.action}`),
      o.errors.map(explainProblem).join(" "),
    ]),
  ];
}

export function downloadImportReport(
  outcomes: readonly RowOutcome[],
  mode: "preview" | "final",
): void {
  downloadCsv(
    csvFileName(t("admin.analytics.import.confirm.reportName")),
    toCsv(buildImportReport(outcomes, mode), { delimiter: ";" }),
  );
}
