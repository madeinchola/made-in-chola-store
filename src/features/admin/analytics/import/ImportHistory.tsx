import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { DataTable, type Column } from "../../ui/DataTable";
import { EmptyState } from "../../ui/StateViews";
import { formatDateTime } from "@/lib/datetime";
import { listBatches, rollbackBatch } from "./importApi";
import type { ImportBatch, RollbackResult } from "./types";
import { adminKeys } from "../../queryKeys";

const B = "admin.analytics.import.batches" as const;
const KEY = [...adminKeys.all, "analytics", "import-batches"] as const;

const REASONS = ["changed_since", "stock_changed", "db_error"] as const;
type Reason = (typeof REASONS)[number];
const reasonText = (reason: string): string =>
  (REASONS as readonly string[]).includes(reason) ? t(`${B}.reasons.${reason as Reason}`) : reason;

/** Las cargas anteriores: qué hizo cada una y el botón de revertirla (nunca pisa lo que se cambió después). */
export function ImportHistory() {
  const client = useQueryClient();
  const batches = useQuery({ queryKey: KEY, queryFn: () => listBatches(20), staleTime: 0 });
  const [target, setTarget] = useState<ImportBatch | null>(null);
  const [result, setResult] = useState<{ batch: ImportBatch; result: RollbackResult } | null>(null);
  const [failed, setFailed] = useState(false);

  const rollback = useMutation({
    mutationFn: (batch: ImportBatch) => rollbackBatch(batch.id),
    onSuccess: (res, batch) => {
      setFailed(false);
      setResult({ batch, result: res });
      void client.invalidateQueries({ queryKey: KEY });
      // lo revertido cambia el catálogo, el stock y los reportes
      void client.invalidateQueries({ queryKey: [...adminKeys.all, "analytics"] });
    },
    onError: () => setFailed(true),
  });

  const columns: Column<ImportBatch>[] = [
    {
      id: "when",
      header: t(`${B}.colWhen`),
      cell: (b) => <span className="whitespace-nowrap">{formatDateTime(b.createdAt)}</span>,
    },
    {
      id: "kind",
      header: t(`${B}.colKind`),
      cell: (b) => t(`admin.analytics.import.kinds.${b.kind}`),
    },
    {
      id: "file",
      header: t(`${B}.colFile`),
      cell: (b) => <span className="break-all">{b.filename ?? "—"}</span>,
    },
    {
      id: "result",
      header: t(`${B}.colResult`),
      cell: (b) =>
        t(`${B}.counts`, {
          create: b.createdCount,
          update: b.updatedCount,
          skip: b.skippedCount,
          error: b.errorCount,
        }),
    },
    { id: "status", header: t(`${B}.colStatus`), cell: (b) => t(`${B}.status.${b.status}`) },
    {
      id: "actions",
      header: <span className="sr-only">{t(`${B}.colActions`)}</span>,
      cell: (b) =>
        b.status === "rolled_back" ? null : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setTarget(b)}
            aria-label={`${t(`${B}.rollback`)}: ${b.filename ?? t(`admin.analytics.import.kinds.${b.kind}`)}`}
          >
            {t(`${B}.rollback`)}
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <DataTable
        caption={t("admin.analytics.import.history")}
        columns={columns}
        rows={batches.data ?? []}
        getRowId={(b) => b.id}
        loading={batches.isPending}
        error={batches.isError}
        onRetry={() => void batches.refetch()}
        empty={<EmptyState>{t(`${B}.none`)}</EmptyState>}
      />
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t(`${B}.rollbackError`)}
        </p>
      )}
      {result && (
        <div role="status" className="rounded-lg border bg-muted/40 p-3 text-sm">
          <p>
            {t(`${B}.rolledBack`, { reverted: result.result.reverted, total: result.result.total })}
          </p>
          {result.result.conflicts.length > 0 && (
            <>
              <p className="mt-2 font-medium">
                {t(`${B}.conflicts`, { count: result.result.conflicts.length })}
              </p>
              <ul className="mt-1 list-disc pl-5">
                {result.result.conflicts.map((c, i) => (
                  <li key={`${c.row}-${i}`}>
                    {t(`${B}.conflict`, {
                      row: c.row,
                      key: c.key ?? c.entity ?? "—",
                      reason: reasonText(c.reason),
                    })}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={t(`${B}.rollbackTitle`)}
        description={t(`${B}.rollbackBody`)}
        confirmLabel={t(`${B}.rollbackConfirm`)}
        destructive
        onConfirm={async () => {
          if (target) await rollback.mutateAsync(target);
        }}
      />
    </div>
  );
}
