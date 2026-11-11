import { useState } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "../ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateViews";
import { ApproveProofDialog, RejectProofDialog, ResolveReviewDialog } from "./DecisionDialogs";
import { useOpenReviews, usePendingProofs } from "./hooks";
import { formatBytes, formatDateTime, formatMoney, reasonLabel, reviewSummary } from "./logic";
import { ProofViewer } from "./ProofViewer";
import type { OpenReview, PendingProof } from "./types";

const P = "admin.payments.review.proofs" as const;
const V = "admin.payments.review" as const;

/**
 * «Por revisar»: lo que espera una decisión del administrador. Arriba, los comprobantes que subieron las clientas (el más antiguo
 * primero); abajo, los pagos que el sistema no pudo aplicar solo (monto distinto, duplicado, tardío, contracargo). Cada decisión
 * pasa por una función del servidor que exige ser admin y deja rastro en la auditoría; si otra persona decidió antes, se avisa.
 */
export function ReviewPage() {
  const proofs = usePendingProofs();
  const reviews = useOpenReviews();
  const [status, setStatus] = useState("");
  const [approving, setApproving] = useState<PendingProof | null>(null);
  const [rejecting, setRejecting] = useState<PendingProof | null>(null);
  const [resolving, setResolving] = useState<OpenReview | null>(null);

  const done = (message: string) => {
    setStatus(message);
    toast.success(message);
  };

  return (
    <div className="space-y-8">
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      <SectionCard id="proofs" title={t(`${P}.title`)} description={t(`${P}.description`)}>
        {proofs.isPending ? (
          <LoadingState />
        ) : proofs.isError ? (
          <ErrorState onRetry={() => void proofs.refetch()} />
        ) : proofs.data.length === 0 ? (
          <EmptyState>{t(`${P}.empty`)}</EmptyState>
        ) : (
          <ul className="space-y-4">
            {proofs.data.map((proof) => (
              <li key={proof.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-medium">
                      {t(`${P}.order`, { number: proof.orderNumber })}
                    </h3>
                    <p className="break-words text-sm text-muted-foreground">
                      {proof.contactName} · {proof.contactPhone}
                    </p>
                  </div>
                  <p className="text-right text-lg font-medium tabular-nums">
                    {formatMoney(proof.amount, proof.currency)}
                  </p>
                </div>
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">{t(`${P}.expected`)}</dt>
                    <dd className="tabular-nums">{formatMoney(proof.amount, proof.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t(`${P}.reference`)}</dt>
                    <dd className="break-all font-mono">{proof.reference}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t(`${P}.sent`)}</dt>
                    <dd>
                      {formatDateTime(proof.createdAt)} · {formatBytes(proof.sizeBytes)}
                    </dd>
                  </div>
                </dl>
                {proof.duplicateOf && (
                  <p
                    role="alert"
                    className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
                  >
                    {t(`${P}.duplicate`)}
                  </p>
                )}
                <ProofViewer path={proof.filePath} mime={proof.mime} />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" className="min-h-11" onClick={() => setApproving(proof)}>
                    {t(`${P}.approve`)}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => setRejecting(proof)}
                  >
                    {t(`${P}.reject`)}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard id="reviews" title={t(`${V}.title`)} description={t(`${V}.description`)}>
        {reviews.isPending ? (
          <LoadingState />
        ) : reviews.isError ? (
          <ErrorState onRetry={() => void reviews.refetch()} />
        ) : reviews.data.length === 0 ? (
          <EmptyState>{t(`${V}.empty`)}</EmptyState>
        ) : (
          <ul className="space-y-4">
            {reviews.data.map((review) => (
              <li key={review.id} className="space-y-2 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">{t(`${V}.order`, { number: review.orderNumber })}</h3>
                  <Badge tone={review.reason === "disputed" ? "danger" : "warning"}>
                    {reasonLabel(review.reason)}
                  </Badge>
                </div>
                <p className="text-sm">
                  {reviewSummary(review.reason, review.detail, review.currency)}
                </p>
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">{t(`${V}.expected`)}</dt>
                    <dd className="tabular-nums">{formatMoney(review.amount, review.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t(`${V}.received`)}</dt>
                    <dd className="tabular-nums">
                      {review.receivedAmount === null
                        ? "—"
                        : formatMoney(review.receivedAmount, review.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t(`${P}.reference`)}</dt>
                    <dd className="break-all font-mono">{review.reference}</dd>
                  </div>
                </dl>
                <p className="text-xs text-muted-foreground">
                  {review.contactName} · {formatDateTime(review.openedAt)}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setResolving(review)}
                >
                  {t(`${V}.resolve.action`)}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <ApproveProofDialog
        proof={approving}
        open={approving !== null}
        onOpenChange={(o) => !o && setApproving(null)}
        onDone={done}
      />
      <RejectProofDialog
        proof={rejecting}
        open={rejecting !== null}
        onOpenChange={(o) => !o && setRejecting(null)}
        onDone={done}
      />
      <ResolveReviewDialog
        review={resolving ? { id: resolving.id, orderNumber: resolving.orderNumber } : null}
        open={resolving !== null}
        onOpenChange={(o) => !o && setResolving(null)}
        onDone={done}
      />
    </div>
  );
}
