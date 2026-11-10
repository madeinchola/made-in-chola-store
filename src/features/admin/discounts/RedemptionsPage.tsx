import { useMemo, useState } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "../ui/DataTable";
import { SectionCard } from "../ui/PageHeader";
import { EmptyState } from "../ui/StateViews";
import { csvFileName, downloadCsv } from "./csv";
import { useDiscounts, useRedemptions } from "./hooks";
import {
  REDEMPTIONS_LIMIT,
  customerName,
  dateText,
  filterByStatus,
  formatAmount,
  ownerText,
  redemptionTotals,
  redemptionsCsv,
  sortByDate,
  type SortDirection,
  type StatusFilter,
} from "./RedemptionsLogic";
import type { Redemption, RedemptionStatus } from "./types";

const R = "admin.discounts.redemptions" as const;
const ALL = "all";
const STATUSES: readonly RedemptionStatus[] = ["reserved", "applied", "reverted"];
const STATUS_TONE = {
  reserved: "info",
  applied: "success",
  reverted: "neutral",
} as const satisfies Record<RedemptionStatus, string>;

/** Reporte de redenciones: quién usó qué descuento, cuándo y cuánto se descontó. Solo lee; nada se edita aquí. */
export function RedemptionsPage() {
  const [discountId, setDiscountId] = useState<string>(ALL);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [done, setDone] = useState("");

  const discounts = useDiscounts();
  const redemptions = useRedemptions(discountId === ALL ? null : discountId);

  const options = useMemo(
    () =>
      [...(discounts.data ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name, "es") || a.id.localeCompare(b.id))
        .map((d) => ({
          id: d.id,
          label: d.archived ? t(`${R}.filters.archivedName`, { name: d.name }) : d.name,
        })),
    [discounts.data],
  );

  const rows = useMemo(
    () => sortByDate(filterByStatus(redemptions.data ?? [], status), direction),
    [redemptions.data, status, direction],
  );
  const totals = useMemo(() => redemptionTotals(rows), [rows]);
  const filtering = discountId !== ALL || status !== "all";
  const hitLimit = redemptions.isSuccess && redemptions.data.length >= REDEMPTIONS_LIMIT;

  const exportCsv = () => {
    const picked = options.find((o) => o.id === discountId);
    downloadCsv(
      csvFileName(
        picked ? `${t(`${R}.export.fileName`)}-${picked.label}` : t(`${R}.export.fileName`),
      ),
      redemptionsCsv(rows),
    );
    const message = t(`${R}.export.done`, { count: rows.length });
    setDone(message);
    toast.success(message);
  };

  const columns: Column<Redemption>[] = [
    {
      id: "date",
      header: t(`${R}.columns.date`),
      sortKey: "date",
      cell: (r) => <span className="whitespace-nowrap">{dateText(r.createdAt)}</span>,
    },
    {
      id: "discount",
      header: t(`${R}.columns.discount`),
      cell: (r) => (
        <span className="block min-w-[8rem] break-words">
          {r.discountName ?? t(`${R}.cells.unknownDiscount`)}
        </span>
      ),
    },
    {
      id: "code",
      header: t(`${R}.columns.code`),
      cell: (r) =>
        r.couponCode ? (
          <span className="whitespace-nowrap font-mono text-sm">{r.couponCode}</span>
        ) : (
          <span className="text-muted-foreground">{t(`${R}.cells.noCode`)}</span>
        ),
    },
    {
      id: "customer",
      header: t(`${R}.columns.customer`),
      cell: (r) => (
        <div className="min-w-[9rem]">
          <p className="break-words font-medium">{customerName(r)}</p>
          {r.customerEmail && (
            <p className="break-all text-xs text-muted-foreground">{r.customerEmail}</p>
          )}
        </div>
      ),
    },
    {
      id: "owner",
      header: t(`${R}.columns.owner`),
      cell: (r) => <span className="whitespace-nowrap font-mono text-xs">{ownerText(r)}</span>,
    },
    {
      id: "amount",
      header: t(`${R}.columns.amount`),
      className: "text-right",
      cell: (r) => (
        <span className="whitespace-nowrap tabular-nums">{formatAmount(r.amount, r.currency)}</span>
      ),
    },
    {
      id: "status",
      header: t(`${R}.columns.status`),
      cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{t(`${R}.status.${r.status}`)}</Badge>,
    },
  ];

  const exportButton = (
    <Button
      type="button"
      variant="outline"
      className="min-h-11"
      disabled={rows.length === 0}
      onClick={exportCsv}
    >
      {t(`${R}.export.button`)}
    </Button>
  );

  return (
    <SectionCard
      id="redemptions"
      title={t(`${R}.title`)}
      description={t(`${R}.description`)}
      actions={exportButton}
    >
      <div
        role="group"
        aria-label={t(`${R}.filters.label`)}
        className="mb-4 grid gap-4 sm:grid-cols-2"
      >
        <Field label={t(`${R}.filters.discount`)}>
          <Select
            className="min-h-11"
            value={discountId}
            onChange={(e) => setDiscountId(e.target.value)}
          >
            <option value={ALL}>{t(`${R}.filters.allDiscounts`)}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t(`${R}.filters.status`)}>
          <Select
            className="min-h-11"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            <option value="all">{t(`${R}.filters.allStatuses`)}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`${R}.status.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <details className="mb-4 text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium">
          {t(`${R}.statusHelp.summary`)}
        </summary>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
          {STATUSES.map((s) => (
            <li key={s}>{t(`${R}.statusHelp.${s}`)}</li>
          ))}
        </ul>
      </details>

      {hitLimit && (
        <p
          role="status"
          className="mb-4 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning"
        >
          {t(`${R}.limitNotice`, { count: REDEMPTIONS_LIMIT })}
        </p>
      )}

      {redemptions.isSuccess && rows.length > 0 && (
        <div
          role="group"
          aria-label={t(`${R}.totals.label`)}
          aria-live="polite"
          className="mb-4 rounded-lg border bg-muted/40 p-4"
        >
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">{t(`${R}.totals.records`)}</dt>
              <dd className="text-lg font-semibold tabular-nums">{totals.records}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t(`${R}.totals.active`)}</dt>
              <dd className="text-lg font-semibold tabular-nums">{totals.active}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t(`${R}.totals.amount`)}</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {totals.amounts.map((a) => a.text).join(" · ")}
              </dd>
              <dd className="text-xs text-muted-foreground">{t(`${R}.totals.amountNote`)}</dd>
            </div>
          </dl>
        </div>
      )}

      <DataTable
        caption={t(`${R}.title`)}
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        loading={redemptions.isPending}
        refreshing={redemptions.isFetching && !redemptions.isPending}
        error={redemptions.isError}
        onRetry={() => void redemptions.refetch()}
        sort={{ key: "date", direction }}
        onSortChange={() => setDirection((d) => (d === "desc" ? "asc" : "desc"))}
        empty={
          <EmptyState
            action={
              filtering ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => {
                    setDiscountId(ALL);
                    setStatus("all");
                  }}
                >
                  {t(`${R}.filters.clear`)}
                </Button>
              ) : undefined
            }
          >
            {filtering ? t(`${R}.noMatches`) : t(`${R}.empty`)}
          </EmptyState>
        }
      />

      <p className="mt-4 text-xs text-muted-foreground">{t(`${R}.export.hint`)}</p>
      <p role="status" className="sr-only">
        {done}
      </p>
    </SectionCard>
  );
}
