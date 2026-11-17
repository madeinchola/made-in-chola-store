import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  MAX_EXPORT_ROWS,
  defaultExportDeps,
  exportReport,
  type ExportProgress,
} from "./exportReport";
import type { CsvNumberFormat } from "./reportFormat";
import { fetchReportPage } from "./reportsApi";
import type { ReportDef } from "./reportTypes";

const X = "admin.analytics.reports.export" as const;

type State =
  | { phase: "idle" }
  | { phase: "running"; progress: ExportProgress }
  | { phase: "message"; text: string; tone: "ok" | "warn" | "error" };

interface ExportPanelProps {
  report: ReportDef;
  filters: { from: string; to: string; currency: string | null };
  currency: string;
  disabled?: boolean;
}

/** Descarga el reporte completo del filtro (no solo la página visible), con progreso, cancelación y el mensaje de cómo terminó. */
export function ExportPanel({ report, filters, currency, disabled }: ExportPanelProps) {
  const [format, setFormat] = useState<CsvNumberFormat>("excel");
  const [state, setState] = useState<State>({ phase: "idle" });
  const cancelled = useRef(false);

  async function run() {
    cancelled.current = false;
    setState({ phase: "running", progress: { done: 0, total: 0 } });
    try {
      const outcome = await exportReport(
        {
          report,
          filters,
          currency,
          format,
          onProgress: (progress) => setState({ phase: "running", progress }),
          shouldCancel: () => cancelled.current,
        },
        defaultExportDeps(fetchReportPage),
      );
      if (outcome.status === "cancelled") {
        setState({ phase: "message", text: t(`${X}.cancelled`), tone: "warn" });
      } else if (outcome.status === "empty") {
        setState({ phase: "message", text: t(`${X}.nothing`), tone: "warn" });
      } else {
        const text = t(`${X}.done`, { rows: outcome.rows });
        setState({
          phase: "message",
          text: outcome.truncated
            ? `${text} ${t(`${X}.truncated`, { max: MAX_EXPORT_ROWS })}`
            : text,
          tone: outcome.truncated ? "warn" : "ok",
        });
      }
    } catch {
      setState({ phase: "message", text: t(`${X}.error`), tone: "error" });
    }
  }

  const running = state.phase === "running";
  return (
    <div className="rounded-lg border bg-background p-4">
      <h2 className="text-sm font-semibold">{t(`${X}.title`)}</h2>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 text-sm sm:max-w-md">
          <span className="mb-1 block font-medium">{t(`${X}.format`)}</span>
          <Select
            value={format}
            onChange={(e) => setFormat(e.target.value as CsvNumberFormat)}
            disabled={running}
          >
            <option value="excel">{t(`${X}.formats.excel`)}</option>
            <option value="standard">{t(`${X}.formats.standard`)}</option>
          </Select>
        </label>
        {running ? (
          <Button type="button" variant="outline" onClick={() => (cancelled.current = true)}>
            {t(`${X}.cancel`)}
          </Button>
        ) : (
          <Button type="button" onClick={() => void run()} disabled={disabled}>
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            {t(`${X}.button`)}
          </Button>
        )}
      </div>
      <p
        role="status"
        aria-live="polite"
        className={
          state.phase === "message" && state.tone === "error"
            ? "mt-3 text-sm text-destructive"
            : "mt-3 text-sm"
        }
      >
        {state.phase === "running"
          ? t(`${X}.running`, { done: state.progress.done, total: state.progress.total })
          : state.phase === "message"
            ? state.text
            : ""}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{t(`${X}.note`)}</p>
    </div>
  );
}
