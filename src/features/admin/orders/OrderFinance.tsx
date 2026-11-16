import { t, type MessageKey } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "../ui/PageHeader";
import { formatDateTime, formatMoney, refundStatusLabel } from "./logic";
import type { IncidentRow, OrderDetail, RefundRow, ReturnRow } from "./types";

const REFUND_TONE = {
  requested: "warning",
  approved: "info",
  processed: "success",
  rejected: "neutral",
} as const;
const RF = "admin.orders.refund" as const;

export function RefundsCard({
  refunds,
  onProcess,
  onReject,
}: {
  refunds: readonly RefundRow[];
  onProcess: (r: RefundRow) => void;
  onReject: (r: RefundRow) => void;
}) {
  if (refunds.length === 0) return null;
  return (
    <SectionCard id="refunds" title={t(`${RF}.title`)}>
      <ul className="divide-y text-sm">
        {refunds.map((r) => (
          <li key={r.id} className="space-y-1 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone={REFUND_TONE[r.status]}>{refundStatusLabel(r.status)}</Badge>
                <span>{t(`${RF}.kinds.${r.kind}` as MessageKey)}</span>
              </p>
              <p className="font-medium tabular-nums">{formatMoney(r.amount, r.currency)}</p>
            </div>
            <p>{r.reason}</p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(r.createdAt)}
              {r.processedAt &&
                ` · ${t(`${RF}.processedAt`, { date: formatDateTime(r.processedAt) })}`}
              {r.externalRef && ` · ${t(`${RF}.ref`, { ref: r.externalRef })}`}
              {r.deduction > 0 &&
                ` · ${t(`${RF}.deduction`, { amount: formatMoney(r.deduction, r.currency) })}`}
            </p>
            {r.decisionNote && <p className="text-xs text-muted-foreground">{r.decisionNote}</p>}
            {(r.status === "requested" || r.status === "approved") && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="button" size="sm" onClick={() => onProcess(r)}>
                  {t(`${RF}.actions.process`)}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => onReject(r)}>
                  {t(`${RF}.actions.reject`)}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

const RT = "admin.orders.returns" as const;
const RETURN_TONE = { open: "warning", closed: "success", rejected: "neutral" } as const;

export function ReturnsCard({
  returns,
  order,
  onClose,
  onReject,
  onRefund,
}: {
  returns: readonly ReturnRow[];
  order: OrderDetail;
  onClose: (r: ReturnRow) => void;
  onReject: (r: ReturnRow) => void;
  onRefund: (r: ReturnRow) => void;
}) {
  if (returns.length === 0) return null;
  const name = (id: string) => order.items.find((i) => i.id === id)?.name ?? "";
  return (
    <SectionCard id="returns" title={t(`${RT}.title`)}>
      <ul className="divide-y text-sm">
        {returns.map((r) => (
          <li key={r.id} className="space-y-1 py-3">
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone={RETURN_TONE[r.status]}>
                {t(`${RT}.status.${r.status}` as MessageKey)}
              </Badge>
              <span>{r.reason}</span>
              {r.outsideWindow && <Badge tone="warning">{t(`${RT}.outside`)}</Badge>}
            </p>
            <ul className="list-disc pl-5">
              {r.items.map((i) => (
                <li key={i.id}>
                  {name(i.orderItemId)} × {i.qty} ·{" "}
                  {t(`${RT}.reasons.${i.reasonCode}` as MessageKey)} ·{" "}
                  {t(`${RT}.restocks.${i.restock}` as MessageKey)}
                  {i.restockedAt && ` (${t(`${RT}.restocked`)})`}
                </li>
              ))}
            </ul>
            {r.overrideReason && (
              <p className="text-xs text-muted-foreground">
                {t(`${RT}.overrideShown`, { reason: r.overrideReason })}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{formatDateTime(r.openedAt)}</p>
            {r.status === "open" && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="button" size="sm" onClick={() => onClose(r)}>
                  {t(`${RT}.close`)}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => onReject(r)}>
                  {t(`${RT}.reject`)}
                </Button>
              </div>
            )}
            {r.status === "closed" && (
              <div className="pt-1">
                <Button type="button" size="sm" variant="outline" onClick={() => onRefund(r)}>
                  {t(`${RT}.refund`)}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

const IN = "admin.orders.incidents" as const;
const INCIDENT_TONE = { open: "danger", investigating: "warning", resolved: "success" } as const;

export function IncidentsCard({
  incidents,
  onUpdate,
}: {
  incidents: readonly IncidentRow[];
  onUpdate: (i: IncidentRow) => void;
}) {
  if (incidents.length === 0) return null;
  return (
    <SectionCard id="incidents" title={t(`${IN}.title`)}>
      <ul className="divide-y text-sm">
        {incidents.map((i) => (
          <li key={i.id} className="space-y-1 py-3">
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone={INCIDENT_TONE[i.status]}>
                {t(`${IN}.statuses.${i.status}` as MessageKey)}
              </Badge>
              <span className="font-medium">{t(`${IN}.types.${i.type}` as MessageKey)}</span>
              {i.costAssumed > 0 && (
                <span className="text-muted-foreground">
                  {t(`${IN}.costLine`, {
                    amount: formatMoney(i.costAssumed, "BOB"),
                    who: t(`${IN}.bearers.${i.costBorneBy}` as MessageKey),
                  })}
                </span>
              )}
            </p>
            {i.description && <p>{i.description}</p>}
            {i.resolution && (
              <p className="text-muted-foreground">
                {t(`${IN}.resolutionLine`, { text: i.resolution })}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{formatDateTime(i.openedAt)}</p>
            {i.status !== "resolved" && (
              <div className="pt-1">
                <Button type="button" size="sm" variant="outline" onClick={() => onUpdate(i)}>
                  {t(`${IN}.follow`)}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
