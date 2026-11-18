import { useState } from "react";
import { t, type MessageKey } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DataTable, type Column } from "../ui/DataTable";
import { PageHeader } from "../ui/PageHeader";
import { Pagination } from "../ui/Pagination";
import { ComplaintDialog } from "./ComplaintDialog";
import { useComplaints, useComplaintSummary } from "./hooks";
import { formatShortDate } from "./logic";
import { PAGE_SIZE, type ComplaintFilter, type ComplaintRow, type ComplaintStatus } from "./types";

const L = "admin.complaints" as const;
const FILTERS: readonly ComplaintFilter[] = ["open", "all", "answered", "closed"];
const TONE: Record<ComplaintStatus, "danger" | "warning" | "success" | "neutral"> = {
  new: "danger",
  in_review: "warning",
  answered: "success",
  closed: "neutral",
};

/** La bandeja de reclamos: lo pendiente primero y lo más urgente arriba; cada uno se abre para leerlo, responderlo y cerrarlo. */
export function ComplaintsPage() {
  const [filter, setFilter] = useState<ComplaintFilter>("open");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ComplaintRow | null>(null);
  const query = useComplaints(filter, page);
  const summary = useComplaintSummary();
  const rows = query.data?.rows ?? [];

  const columns: Column<ComplaintRow>[] = [
    {
      id: "number",
      header: t(`${L}.table.number`),
      cell: (r) => <span className="font-medium tabular-nums">{r.number}</span>,
    },
    { id: "received", header: t(`${L}.table.received`), cell: (r) => formatShortDate(r.createdAt) },
    {
      id: "kind",
      header: t(`${L}.table.kind`),
      cell: (r) => t(`${L}.kinds.${r.kind}` as MessageKey),
    },
    {
      id: "from",
      header: t(`${L}.table.from`),
      cell: (r) => (
        <span>
          {r.contactName}
          {r.hasAccount && (
            <span className="ml-2 text-xs text-muted-foreground">({t(`${L}.table.account`)})</span>
          )}
        </span>
      ),
    },
    {
      id: "status",
      header: t(`${L}.table.status`),
      cell: (r) => (
        <div className="flex flex-wrap gap-2">
          <Badge tone={TONE[r.status]}>{t(`${L}.status.${r.status}` as MessageKey)}</Badge>
          {r.overdue && <Badge tone="danger">{t(`${L}.table.overdue`)}</Badge>}
        </div>
      ),
    },
    {
      id: "due",
      header: t(`${L}.table.due`),
      cell: (r) =>
        r.status === "new" || r.status === "in_review" ? formatShortDate(r.dueAt) : "—",
    },
    {
      id: "actions",
      header: <span className="sr-only">{t(`${L}.table.actions`)}</span>,
      cell: (r) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          aria-label={t(`${L}.table.openLabel`, { number: r.number })}
          onClick={() => setSelected(r)}
        >
          {t(`${L}.table.open`)}
        </Button>
      ),
    },
  ];

  const counts = summary.data;
  return (
    <>
      <PageHeader title={t(`${L}.title`)} description={t(`${L}.description`)} />
      <div className="space-y-6">
        {counts && (
          <dl
            aria-label={t(`${L}.summary.label`)}
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          >
            {(
              [
                ["new", counts.new, false],
                ["inReview", counts.inReview, false],
                ["overdue", counts.overdue, counts.overdue > 0],
                ["total", counts.total, false],
              ] as const
            ).map(([key, value, alert]) => (
              <div
                key={key}
                className={cn(
                  "rounded-lg border p-4",
                  alert && "border-destructive/40 bg-destructive/5",
                )}
              >
                <dt className="text-sm text-muted-foreground">
                  {t(`${L}.summary.${key}` as MessageKey)}
                </dt>
                <dd
                  className={cn(
                    "mt-1 text-2xl font-semibold tabular-nums",
                    alert && "text-destructive",
                  )}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <div
          role="group"
          aria-label={t(`${L}.filters.label`)}
          className="inline-flex flex-wrap gap-1 rounded-md bg-muted p-1 text-sm"
        >
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                setPage(1);
              }}
              className={cn(
                "min-h-11 rounded-sm px-4 font-medium",
                filter === value ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
            >
              {t(`${L}.filters.${value}` as MessageKey)}
            </button>
          ))}
        </div>
        <DataTable
          caption={t(`${L}.table.caption`)}
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          loading={query.isLoading}
          refreshing={query.isFetching && !query.isLoading}
          error={query.isError}
          onRetry={() => void query.refetch()}
          empty={
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t(`${L}.table.empty`)}
            </p>
          }
        />
        {(query.data?.total ?? 0) > 0 && (
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={query.data?.total ?? 0}
            onPageChange={setPage}
          />
        )}
      </div>
      {selected && <ComplaintDialog row={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
