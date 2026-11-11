import { useState } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { toAppError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { AUTOMATIC_QR_IN_UI } from "@/features/payments/automaticQr";
import { DataTable, type Column } from "../ui/DataTable";
import { Pagination } from "../ui/Pagination";
import { EmptyState } from "../ui/StateViews";
import { reconcileNow } from "./api";
import { ConfirmManualDialog } from "./DecisionDialogs";
import { usePaymentEvents, usePayments, useProofHistory } from "./hooks";
import {
  canConfirmManually,
  formatDateTime,
  formatMoney,
  providerFilterOptions,
  providerLabel,
  statusLabel,
  statusTone,
} from "./logic";
import { ProofViewer } from "./ProofViewer";
import {
  PAGE_SIZE,
  PAYMENT_STATUSES,
  type PaymentFilters,
  type PaymentRow,
  type PaymentStatus,
} from "./types";

const L = "admin.payments.list" as const;
const D = "admin.payments.detail" as const;
const ALL = "all";

function PaymentDetailDialog({
  payment,
  onClose,
  onConfirm,
}: {
  payment: PaymentRow | null;
  onClose: () => void;
  onConfirm: (payment: PaymentRow) => void;
}) {
  const events = usePaymentEvents(payment?.id ?? null);
  const proofs = useProofHistory(payment?.id ?? null);
  return (
    <Dialog open={payment !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        {payment && (
          <>
            <DialogHeader>
              <DialogTitle className="break-all">
                {t(`${D}.title`, { reference: payment.reference })}
              </DialogTitle>
              <DialogDescription>
                {t(`${D}.description`, {
                  number: payment.orderNumber,
                  client: payment.contactName,
                })}
              </DialogDescription>
            </DialogHeader>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {(
                [
                  [`${D}.amount`, formatMoney(payment.amount, payment.currency)],
                  [
                    `${D}.received`,
                    payment.receivedAmount === null
                      ? t(`${D}.none`)
                      : formatMoney(payment.receivedAmount, payment.currency),
                  ],
                  [`${D}.status`, statusLabel(payment.status)],
                  [`${D}.method`, providerLabel(payment.provider)],
                  [`${D}.createdAt`, formatDateTime(payment.createdAt)],
                  [`${D}.expiresAt`, formatDateTime(payment.expiresAt)],
                  [`${D}.paidAt`, formatDateTime(payment.paidAt)],
                  // El id del proveedor solo existe con un cobro automático: con la interfaz apagada no se muestra.
                  ...(AUTOMATIC_QR_IN_UI
                    ? ([[`${D}.externalId`, payment.externalId ?? t(`${D}.none`)]] as const)
                    : []),
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{t(label)}</dt>
                  <dd className="break-all">{value}</dd>
                </div>
              ))}
            </dl>

            <section aria-labelledby="events-title" className="space-y-2">
              <h3 id="events-title" className="font-medium">
                {t(`${D}.events.title`)}
              </h3>
              {events.isPending ? (
                <p role="status" className="text-sm text-muted-foreground">
                  {t("admin.states.loading")}
                </p>
              ) : events.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  {t("admin.states.errorTitle")}
                </p>
              ) : events.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t(`${D}.events.empty`)}</p>
              ) : (
                <ul className="divide-y rounded-md border text-sm">
                  {events.data.map((event) => (
                    <li
                      key={event.id}
                      className="flex flex-wrap items-center justify-between gap-2 p-3"
                    >
                      <span className="break-all font-mono text-xs">{event.eventId ?? "—"}</span>
                      <span>
                        {event.outcome
                          ? t(`${D}.events.outcomes.${event.outcome as "applied"}`)
                          : "—"}
                        {event.attempts > 1 && ` · ${t(`${D}.events.attempts`)}: ${event.attempts}`}
                      </span>
                      <span className="text-muted-foreground">
                        {formatDateTime(event.receivedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="proofs-title" className="space-y-2">
              <h3 id="proofs-title" className="font-medium">
                {t(`${D}.proofs.title`)}
              </h3>
              {proofs.isPending ? (
                <p role="status" className="text-sm text-muted-foreground">
                  {t("admin.states.loading")}
                </p>
              ) : proofs.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  {t("admin.states.errorTitle")}
                </p>
              ) : proofs.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t(`${D}.proofs.empty`)}</p>
              ) : (
                <ul className="space-y-3">
                  {proofs.data.map((proof) => (
                    <li key={proof.id} className="space-y-2 rounded-md border p-3 text-sm">
                      <p className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            proof.status === "approved"
                              ? "success"
                              : proof.status === "rejected"
                                ? "danger"
                                : "info"
                          }
                        >
                          {t(`admin.payments.proof.${proof.status}`)}
                        </Badge>
                        <span className="text-muted-foreground">
                          {formatDateTime(proof.createdAt)}
                        </span>
                      </p>
                      {proof.reason && <p>{t(`${D}.proofs.reason`, { reason: proof.reason })}</p>}
                      <ProofViewer path={proof.filePath} mime={proof.mime} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {canConfirmManually(payment.status) && (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => onConfirm(payment)}
                >
                  {t(`${D}.manual.action`)}
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Lista de cobros: cada intento de pago con su estado, filtros y el detalle con los avisos y comprobantes. */
export function PaymentsPage() {
  const [filters, setFilters] = useState<PaymentFilters>({ status: ALL, provider: ALL, page: 0 });
  const [detail, setDetail] = useState<PaymentRow | null>(null);
  const [confirming, setConfirming] = useState<PaymentRow | null>(null);
  const [status, setStatus] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const query = usePayments(filters);
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;

  const done = (message: string) => {
    setStatus(message);
    toast.success(message);
  };

  async function reconcile() {
    if (reconciling) return;
    setReconciling(true);
    try {
      const report = await reconcileNow();
      done(
        report.checked === 0
          ? t(`${L}.reconcileNone`)
          : t(`${L}.reconcileDone`, { checked: report.checked, changed: report.changed }),
      );
      void query.refetch();
    } catch (error) {
      toast.error(toAppError(error).message);
    } finally {
      setReconciling(false);
    }
  }

  const columns: Column<PaymentRow>[] = [
    {
      id: "date",
      header: t(`${L}.columns.date`),
      cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt)}</span>,
    },
    {
      id: "order",
      header: t(`${L}.columns.order`),
      cell: (r) => (
        <div className="min-w-[7rem]">
          <p className="font-medium">{r.orderNumber}</p>
          <p className="text-xs text-muted-foreground">{t(`${L}.attempt`, { n: r.attempt })}</p>
        </div>
      ),
    },
    {
      id: "client",
      header: t(`${L}.columns.client`),
      cell: (r) => <span className="block min-w-[8rem] break-words">{r.contactName}</span>,
    },
    {
      id: "method",
      header: t(`${L}.columns.method`),
      cell: (r) => providerLabel(r.provider),
    },
    {
      id: "status",
      header: t(`${L}.columns.status`),
      cell: (r) => <Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge>,
    },
    {
      id: "amount",
      header: t(`${L}.columns.amount`),
      cell: (r) => (
        <span className="whitespace-nowrap tabular-nums">{formatMoney(r.amount, r.currency)}</span>
      ),
    },
    {
      id: "reference",
      header: t(`${L}.columns.reference`),
      cell: (r) => <span className="font-mono text-xs">{r.reference}</span>,
    },
    {
      id: "actions",
      header: <span className="sr-only">{t(`${L}.columns.actions`)}</span>,
      cell: (r) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t(`${L}.detailLabel`, { reference: r.reference })}
          onClick={() => setDetail(r)}
        >
          {t(`${L}.detail`)}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <Field label={t(`${L}.filters.status`)}>
          <Select
            value={filters.status}
            onChange={(event) =>
              setFilters({
                ...filters,
                status: event.target.value as PaymentStatus | "all",
                page: 0,
              })
            }
          >
            <option value={ALL}>{t(`${L}.filters.all`)}</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t(`${L}.filters.provider`)}>
          <Select
            value={filters.provider}
            onChange={(event) => setFilters({ ...filters, provider: event.target.value, page: 0 })}
          >
            <option value={ALL}>{t(`${L}.filters.all`)}</option>
            {providerFilterOptions().map((p) => (
              <option key={p} value={p}>
                {providerLabel(p)}
              </option>
            ))}
          </Select>
        </Field>
        {/* «Conciliar» le pregunta a un proveedor de cobro automático: sin uno, no se ofrece (el código sigue ahí). */}
        {AUTOMATIC_QR_IN_UI && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            loading={reconciling}
            onClick={() => void reconcile()}
          >
            {reconciling ? t(`${L}.reconciling`) : t(`${L}.reconcile`)}
          </Button>
        )}
      </div>

      <DataTable
        caption={t(`${L}.caption`)}
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        loading={query.isPending}
        refreshing={query.isFetching && !query.isPending}
        error={query.isError}
        onRetry={() => void query.refetch()}
        empty={<EmptyState>{t(`${L}.empty`)}</EmptyState>}
      />
      {total > PAGE_SIZE && (
        <Pagination
          page={filters.page + 1}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={(page) => setFilters({ ...filters, page: page - 1 })}
        />
      )}

      <PaymentDetailDialog
        payment={detail}
        onClose={() => setDetail(null)}
        onConfirm={(p) => {
          setDetail(null);
          setConfirming(p);
        }}
      />
      <ConfirmManualDialog
        payment={confirming}
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        onDone={done}
      />
    </div>
  );
}
