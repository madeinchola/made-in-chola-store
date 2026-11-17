import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { csvFileName, downloadCsv, toCsv } from "@/lib/csv";
import { PageHeader, SectionCard } from "../../ui/PageHeader";
import { useQueryClient } from "@tanstack/react-query";
import { adminKeys } from "../../queryKeys";
import { applyChunk, finishBatch, startBatch, validateChunk } from "./importApi";
import { downloadImportReport } from "./importReport";
import { explainProblem } from "./importMessages";
import { ImportHistory } from "./ImportHistory";
import { IMPORT_KINDS, templateRows } from "./kinds";
import { parseImportFile } from "./parseFile";
import {
  applyImport,
  previewImport,
  type ImportCounts,
  type ImportDeps,
  type RowOutcome,
} from "./runImport";
import type { ImportKind, ParseFailure, ParsedFile } from "./types";

const I = "admin.analytics.import" as const;
const KINDS: readonly ImportKind[] = ["products", "stock", "prices", "categories"];
const deps: ImportDeps = {
  validate: validateChunk,
  start: startBatch,
  apply: applyChunk,
  finish: finishBatch,
};
/** Filas que se muestran en pantalla; el informe descargable trae TODAS. */
const SHOWN = 200;

type Phase =
  | { name: "idle" }
  | { name: "checking"; done: number; total: number }
  | { name: "reviewed"; outcomes: RowOutcome[]; counts: ImportCounts }
  | { name: "applying"; done: number; total: number }
  | { name: "finished"; outcomes: RowOutcome[]; counts: ImportCounts; stopped: boolean }
  | { name: "failed"; message: string };

/** Carga masiva en pasos: elegir qué, subir el CSV, revisar lo que pasaría (sin guardar nada), confirmar y quedarse con el informe. */
export function ImportPage() {
  const client = useQueryClient();
  const [kind, setKind] = useState<ImportKind>("products");
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [failure, setFailure] = useState<ParseFailure | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [onlyErrors, setOnlyErrors] = useState(false);
  const cancelled = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const def = IMPORT_KINDS[kind];

  function reset(nextKind: ImportKind = kind) {
    setKind(nextKind);
    setFile(null);
    setFailure(null);
    setPhase({ name: "idle" });
    setOnlyErrors(false);
    if (input.current) input.current.value = "";
  }

  function downloadTemplate() {
    downloadCsv(csvFileName(def.fileBase), toCsv(templateRows(kind), { delimiter: ";" }));
  }

  async function onFile(selected: File | undefined) {
    setPhase({ name: "idle" });
    setFile(null);
    setFailure(null);
    if (!selected) return;
    try {
      const outcome = parseImportFile(kind, selected.name, await selected.arrayBuffer());
      if (outcome.ok) setFile(outcome.file);
      else setFailure(outcome.failure);
    } catch {
      setFailure({ code: "unreadable" });
    }
  }

  async function review() {
    if (!file) return;
    cancelled.current = false;
    setPhase({ name: "checking", done: 0, total: file.rows.length });
    try {
      const out = await previewImport(file, deps, {
        onProgress: (p) => setPhase({ name: "checking", ...p }),
        shouldCancel: () => cancelled.current,
      });
      if (out.status === "cancelled")
        setPhase({ name: "failed", message: t(`${I}.review.cancelled`) });
      else setPhase({ name: "reviewed", outcomes: out.outcomes, counts: out.counts });
    } catch {
      setPhase({ name: "failed", message: t(`${I}.review.error`) });
    }
  }

  async function confirm() {
    if (!file) return;
    cancelled.current = false;
    setPhase({ name: "applying", done: 0, total: file.rows.length });
    try {
      const out = await applyImport(
        file,
        deps,
        {
          onProgress: (p) => setPhase({ name: "applying", ...p }),
          shouldCancel: () => cancelled.current,
        },
        phase.name === "reviewed" ? phase.outcomes : [],
      );
      setPhase({
        name: "finished",
        outcomes: out.outcomes,
        counts: out.counts,
        stopped: out.status === "cancelled",
      });
    } catch {
      setPhase({ name: "failed", message: t(`${I}.confirm.error`) });
    } finally {
      // el catálogo, el stock y los reportes cambiaron (o pudieron cambiar): se vuelven a leer
      void client.invalidateQueries({ queryKey: [...adminKeys.all, "analytics"] });
      void client.invalidateQueries({ queryKey: adminKeys.all });
    }
  }

  const running = phase.name === "checking" || phase.name === "applying";
  const outcomes = phase.name === "reviewed" || phase.name === "finished" ? phase.outcomes : [];
  const counts = phase.name === "reviewed" || phase.name === "finished" ? phase.counts : null;
  const visible = (onlyErrors ? outcomes.filter((o) => o.action === "error") : outcomes).slice(
    0,
    SHOWN,
  );
  const importable = counts ? counts.create + counts.update + counts.skip : 0;

  return (
    <>
      <PageHeader title={t(`${I}.title`)} description={t(`${I}.description`)} />
      <div className="space-y-6">
        <SectionCard id="import-kind" title={t(`${I}.step1`)}>
          <fieldset disabled={running}>
            <legend className="sr-only">{t(`${I}.kinds.label`)}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {KINDS.map((k) => (
                <label
                  key={k}
                  className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${kind === k ? "border-primary bg-muted/50" : ""}`}
                >
                  <input
                    type="radio"
                    name="import-kind"
                    value={k}
                    checked={kind === k}
                    onChange={() => reset(k)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium">{t(`${I}.kinds.${k}`)}</span>
                    <span className="block text-muted-foreground">{t(`${I}.kindHelp.${k}`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={downloadTemplate}>
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              {t(`${I}.template.download`)}
            </Button>
            <p className="max-w-prose text-xs text-muted-foreground">{t(`${I}.template.note`)}</p>
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium">
              {t(`${I}.template.columns`)}
            </summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <caption className="sr-only">{t(`${I}.template.columns`)}</caption>
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      {t(`${I}.template.column`)}
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      {t(`${I}.template.meaning`)}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {def.columns.map((c) => (
                    <tr key={c.key} className="border-b align-top last:border-b-0">
                      <th scope="row" className="py-2 pr-3 text-left font-medium">
                        <code>{c.header}</code>
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {c.required ? t(`${I}.template.required`) : t(`${I}.template.optional`)}
                        </span>
                      </th>
                      <td className="py-2 pr-3 text-muted-foreground">{c.help}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </SectionCard>

        <SectionCard id="import-file" title={t(`${I}.step2`)}>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t(`${I}.file.label`)}</span>
            <input
              ref={input}
              type="file"
              accept=".csv,text/csv,text/plain"
              disabled={running}
              onChange={(e) => void onFile(e.target.files?.[0])}
              className="block w-full max-w-md text-sm file:mr-3 file:min-h-10 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:text-sm"
            />
            <span className="mt-1 block text-xs text-muted-foreground">{t(`${I}.file.hint`)}</span>
          </label>
          {failure && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {t(`${I}.file.failures.${failure.code}`, { detail: failure.detail ?? "" })}
            </p>
          )}
          {file && (
            <div className="mt-3 space-y-1 text-sm" role="status">
              <p>{t(`${I}.file.read`, { rows: file.rows.length, name: file.fileName })}</p>
              {file.ignoredColumns.length > 0 && (
                <p className="text-muted-foreground">
                  {t(`${I}.file.ignored`, { columns: file.ignoredColumns.join(", ") })}
                </p>
              )}
              {file.encoding === "windows-1252" && (
                <p className="text-muted-foreground">{t(`${I}.file.latin`)}</p>
              )}
            </div>
          )}
        </SectionCard>

        {file && (
          <SectionCard id="import-review" title={t(`${I}.step3`)}>
            {phase.name === "idle" || phase.name === "failed" ? (
              <div className="space-y-3">
                <Button type="button" onClick={() => void review()}>
                  <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t(`${I}.review.button`)}
                </Button>
                {phase.name === "failed" && (
                  <p role="alert" className="text-sm text-destructive">
                    {phase.message}
                  </p>
                )}
              </div>
            ) : null}
            <p role="status" aria-live="polite" className="text-sm">
              {phase.name === "checking"
                ? t(`${I}.review.running`, { done: phase.done, total: phase.total })
                : ""}
            </p>
            {phase.name === "checking" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => (cancelled.current = true)}
              >
                {t(`${I}.review.cancel`)}
              </Button>
            )}
            {counts && (
              <div className="space-y-4">
                <p className="text-sm">{t(`${I}.review.summary`, { total: file.rows.length })}</p>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="import-counts">
                  <Count label={t(`${I}.review.create`)} value={counts.create} />
                  <Count label={t(`${I}.review.update`)} value={counts.update} />
                  <Count label={t(`${I}.review.skip`)} value={counts.skip} />
                  <Count
                    label={t(`${I}.review.error_`)}
                    value={counts.error}
                    tone={counts.error > 0 ? "warn" : "default"}
                  />
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={onlyErrors}
                    onClick={() => setOnlyErrors((v) => !v)}
                  >
                    {onlyErrors ? t(`${I}.review.allRows`) : t(`${I}.review.onlyErrors`)}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      downloadImportReport(
                        outcomes,
                        phase.name === "finished" ? "final" : "preview",
                      )
                    }
                  >
                    <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t(`${I}.review.downloadReport`)}
                  </Button>
                </div>
                {visible.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t(`${I}.review.noErrors`)}</p>
                ) : (
                  <>
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full min-w-[480px] text-left text-sm">
                        <caption className="sr-only">{t(`${I}.step3`)}</caption>
                        <thead className="border-b bg-muted/60">
                          <tr>
                            <th scope="col" className="px-3 py-2 font-medium">
                              {t(`${I}.review.colRow`)}
                            </th>
                            <th scope="col" className="px-3 py-2 font-medium">
                              {t(`${I}.review.colKey`)}
                            </th>
                            <th scope="col" className="px-3 py-2 font-medium">
                              {t(`${I}.review.colResult`)}
                            </th>
                            <th scope="col" className="px-3 py-2 font-medium">
                              {t(`${I}.review.colDetail`)}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {visible.map((o) => (
                            <tr key={o.row} className="border-b align-top last:border-b-0">
                              <td className="px-3 py-2 tabular-nums">{o.row}</td>
                              <td className="break-all px-3 py-2">{o.key ?? "—"}</td>
                              <td className="px-3 py-2">
                                {t(
                                  `${I}.${phase.name === "finished" ? "resultDone" : "result"}.${o.action}`,
                                )}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {o.errors.map(explainProblem).join(" ")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t(`${I}.review.shown`, {
                        shown: visible.length,
                        total: onlyErrors ? counts.error : outcomes.length,
                      })}
                    </p>
                  </>
                )}
              </div>
            )}
          </SectionCard>
        )}

        {phase.name === "reviewed" && (
          <SectionCard id="import-confirm" title={t(`${I}.step4`)}>
            {importable === 0 ? (
              <p className="text-sm text-muted-foreground">{t(`${I}.confirm.nothing`)}</p>
            ) : (
              <div className="space-y-3">
                {phase.counts.error > 0 && (
                  <p className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm">
                    {t(`${I}.confirm.skipping`, { count: phase.counts.error })}
                  </p>
                )}
                <Button type="button" onClick={() => void confirm()}>
                  {t(`${I}.confirm.button`, { count: importable })}
                </Button>
              </div>
            )}
          </SectionCard>
        )}

        {(phase.name === "applying" || phase.name === "finished") && (
          <SectionCard id="import-result" title={t(`${I}.step4`)}>
            <p role="status" aria-live="polite" className="text-sm">
              {phase.name === "applying"
                ? t(`${I}.confirm.running`, { done: phase.done, total: phase.total })
                : t(`${I}.confirm.done`, { ...phase.counts })}
            </p>
            {phase.name === "applying" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => (cancelled.current = true)}
              >
                {t(`${I}.confirm.cancel`)}
              </Button>
            )}
            {phase.name === "finished" && (
              <div className="mt-3 space-y-3">
                {phase.stopped && (
                  <p className="text-sm text-muted-foreground">{t(`${I}.confirm.stopped`)}</p>
                )}
                <Button type="button" variant="outline" onClick={() => reset()}>
                  {t(`${I}.confirm.newImport`)}
                </Button>
              </div>
            )}
          </SectionCard>
        )}

        <SectionCard id="import-history" title={t(`${I}.history`)}>
          <ImportHistory />
        </SectionCard>
      </div>
    </>
  );
}

function Count({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warn";
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${tone === "warn" ? "border-warning/40 bg-warning-soft" : ""}`}
    >
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}
