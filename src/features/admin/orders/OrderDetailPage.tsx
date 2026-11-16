import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { t, type MessageKey } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "../ui/StateViews";
import { SectionCard } from "../ui/PageHeader";
import { undoTransition } from "./api";
import { ActionDialogsHost, type DialogState } from "./ActionDialogsHost";
import { AdvanceDialog } from "./AdvanceDialog";
import {
  useAttention,
  useBlacklist,
  useBlacklistMatches,
  useHistory,
  useIncidents,
  useOrder,
  useOrderMutation,
  useOrderPayments,
  useOrderProofs,
  useRefunds,
  useReturns,
} from "./hooks";
import {
  advanceLabelKey,
  canCancel,
  canEdit,
  canRefund,
  canReturn,
  canUndo,
  errorText,
  formatDateTime,
  formatMoney,
  statusLabel,
  statusTone,
} from "./logic";
import { IncidentsCard, RefundsCard, ReturnsCard } from "./OrderFinance";
import { CustomerCard, DeliveryCard, ItemsCard, PaymentsCard } from "./OrderSections";
import { EditsCard, HistoryCard, NotesCard } from "./OrderTimeline";
import { resultCode, succeeded, TRANSITION_OK } from "./outcomes";

const D = "admin.orders.detail" as const;

/**
 * Detalle del pedido: todo lo que el equipo necesita para atenderlo sin salir de la pantalla, y las acciones permitidas según el
 * estado. Cada acción es una función de la base que valida, bloquea el pedido y deja rastro; la pantalla solo la ofrece.
 */
export function OrderDetailPage() {
  const { id = "" } = useParams();
  const order = useOrder(id);
  const payments = useOrderPayments(id);
  const proofs = useOrderProofs(id);
  const refunds = useRefunds(id);
  const returns = useReturns(id);
  const incidents = useIncidents(id);
  const blacklist = useBlacklist();
  const attention = useAttention();
  const history = useHistory(id);
  const o = order.data;
  const matches = useBlacklistMatches(id, o != null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [advance, setAdvance] = useState(false);
  const [status, setStatus] = useState("");
  const undo = useOrderMutation((a: { id: string; status: string }) =>
    undoTransition(a.id, a.status),
  );

  if (order.isPending) return <LoadingState />;
  if (order.isError) return <ErrorState onRetry={() => void order.refetch()} />;
  if (!o) {
    return (
      <div className="space-y-4">
        <p role="alert">{t(`${D}.notFound`)}</p>
        <Link to="/admin/pedidos" className="underline underline-offset-2">
          {t(`${D}.back`)}
        </Link>
      </div>
    );
  }

  const done = (message: string) => setStatus(message);
  const list = payments.data ?? [];
  const cod = list.find((p) => p.provider === "cash_on_delivery");
  const codOpen = !!cod && cod.status === "paid" && !cod.collectedAt;
  const entries = (blacklist.data ?? []).filter((b) => b.isActive);
  const isBlacklisted = entries.some(
    (b) =>
      (b.kind === "profile" && b.profileId === o.profileId) ||
      (b.kind === "phone" && b.phone === o.contactPhone) ||
      (b.kind === "email" && !!o.contactEmail && b.email === o.contactEmail),
  );
  const flags = (attention.data ?? []).filter((a) => a.orderId === o.id);
  const advanceKey = advanceLabelKey(o.status);
  const lastStep = history.data?.[history.data.length - 1];
  // «Deshacer» se ofrece solo si el último cambio lo hizo un administrador (la base decide si aún está en la ventana).
  const showUndo =
    canUndo(o.status) && lastStep?.actorKind === "admin" && lastStep.toStatus === o.status;

  async function runUndo() {
    if (!o || undo.isPending) return;
    try {
      const result = await undo.mutateAsync({ id: o.id, status: o.status });
      if (succeeded(result, TRANSITION_OK)) {
        const message = t(`${D}.undone`);
        done(message);
        toast.success(message);
      } else {
        toast.error(errorText(resultCode(result)));
      }
    } catch (error) {
      toast.error(errorText(undefined));
      void error;
    }
  }

  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      <Link
        to="/admin/pedidos"
        className="inline-flex min-h-11 items-center gap-1 text-sm underline-offset-2 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t(`${D}.back`)}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold">{o.number}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge tone={statusTone(o.status)}>{statusLabel(o.status)}</Badge>
            <span>{formatDateTime(o.createdAt)}</span>
            <span>· {formatMoney(o.total, o.currency)}</span>
            {o.channel !== "web" && (
              <Badge tone="info">{t(`admin.orders.channel.${o.channel}` as MessageKey)}</Badge>
            )}
            {o.editCount > 0 && (
              <Badge tone="warning">{t(`${D}.edited`, { count: o.editCount })}</Badge>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {advanceKey && (
            <Button type="button" className="min-h-11" onClick={() => setAdvance(true)}>
              {t(advanceKey)}
            </Button>
          )}
          {showUndo && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              loading={undo.isPending}
              onClick={() => void runUndo()}
            >
              {t(`${D}.undo`)}
            </Button>
          )}
        </div>
      </header>

      {flags.length > 0 && (
        <section
          aria-label={t(`${D}.flagsTitle`)}
          className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm"
        >
          <p className="font-medium">{t(`${D}.flagsTitle`)}</p>
          <ul className="mt-1 list-disc pl-5">
            {flags.map((f) => (
              <li key={f.kind}>
                {t(`admin.orders.attention.kinds.${f.kind}` as MessageKey)}
                {typeof f.detail.amount === "number" &&
                  ` · ${formatMoney(f.detail.amount, o.currency)}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label={t(`${D}.actions`)}>
        {canEdit(o.status) && (
          <Button type="button" variant="outline" onClick={() => setDialog({ kind: "edit" })}>
            {t(`${D}.edit`)}
          </Button>
        )}
        {canCancel(o.status) && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setDialog({ kind: "refund", preset: { cancel: true, mode: "all" } })}
          >
            {t(`${D}.cancelRefund`)}
          </Button>
        )}
        {canRefund(o.status) && (
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setDialog({
                kind: "refund",
                preset: { cancel: false, mode: o.status === "cancelled" ? "all" : "items" },
              })
            }
          >
            {t(`${D}.refund`)}
          </Button>
        )}
        {canReturn(o.status) && (
          <Button type="button" variant="outline" onClick={() => setDialog({ kind: "returnOpen" })}>
            {t(`${D}.openReturn`)}
          </Button>
        )}
        {codOpen && ["shipped", "delivered", "completed"].includes(o.status) && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setDialog({ kind: "codCollect", expected: cod?.amount ?? o.total })}
          >
            {t(`${D}.codCollect`)}
          </Button>
        )}
        {codOpen && o.status === "shipped" && (
          <Button type="button" variant="outline" onClick={() => setDialog({ kind: "codReject" })}>
            {t(`${D}.codReject`)}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => setDialog({ kind: "incident" })}>
          {t(`${D}.openIncident`)}
        </Button>
        {!isBlacklisted && (
          <Button type="button" variant="outline" onClick={() => setDialog({ kind: "blacklist" })}>
            {t(`${D}.blacklistAdd`)}
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CustomerCard order={o} blacklisted={isBlacklisted} />
        <DeliveryCard order={o} />
      </div>
      <ItemsCard order={o} />
      <PaymentsCard order={o} payments={list} proofs={proofs.data ?? []} />
      <RefundsCard
        refunds={refunds.data ?? []}
        onProcess={(refund) => setDialog({ kind: "refundProcess", refund })}
        onReject={(refund) => setDialog({ kind: "refundReject", refund })}
      />
      <ReturnsCard
        returns={returns.data ?? []}
        order={o}
        onClose={(ret) => setDialog({ kind: "returnClose", ret })}
        onReject={(ret) => setDialog({ kind: "returnReject", ret })}
        onRefund={(ret) =>
          setDialog({
            kind: "refund",
            preset: {
              cancel: false,
              mode: "items",
              returnId: ret.id,
              qty: Object.fromEntries(ret.items.map((i) => [i.orderItemId, i.qty])),
            },
          })
        }
      />
      <IncidentsCard
        incidents={incidents.data ?? []}
        onUpdate={(incident) => setDialog({ kind: "incidentUpdate", incident })}
      />

      {(matches.data ?? []).length > 0 && (
        <SectionCard
          id="matches"
          title={t(`${D}.matches.title`)}
          description={t(`${D}.matches.description`)}
        >
          <ul className="divide-y text-sm">
            {(matches.data ?? []).map((m) => (
              <li
                key={m.profileId}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span>{m.fullName}</span>
                <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  {m.reasons.map((r) => (
                    <Badge key={r} tone="neutral">
                      {t(`${D}.matches.reasons.${r}` as MessageKey)}
                    </Badge>
                  ))}
                  {m.blacklisted && <Badge tone="danger">{t(`${D}.matches.blocked`)}</Badge>}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <HistoryCard orderId={o.id} />
        <NotesCard orderId={o.id} />
      </div>
      <EditsCard orderId={o.id} currency={o.currency} />

      <AdvanceDialog
        order={advance ? { id: o.id, number: o.number, status: o.status } : null}
        onOpenChange={(open) => !open && setAdvance(false)}
        onDone={done}
      />
      <ActionDialogsHost order={o} state={dialog} onClose={() => setDialog(null)} onDone={done} />
    </div>
  );
}
