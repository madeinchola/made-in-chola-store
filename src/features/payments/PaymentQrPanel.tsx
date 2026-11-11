import { useCallback, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/store/ErrorState";
import { useAuth } from "@/features/auth/useAuth";
import { formatCartMoney } from "@/features/cart/format";
import { t, type MessageKey } from "@/i18n";
import { AUTOMATIC_QR_IN_UI } from "./automaticQr";
import { usePaymentView, useRetryPayment } from "./hooks";
import { isQrPayment, paymentStage } from "./paymentsMapping";
import { qrImageUrl } from "./paymentsApi";
import { PaymentCountdown } from "./PaymentCountdown";
import { ProofUploader } from "./ProofUploader";
import { ReorderButton } from "./ReorderButton";
import type { PaymentStage } from "./types";

const OPEN_STAGES: readonly PaymentStage[] = [
  "awaiting",
  "proof_pending",
  "proof_rejected",
  "in_review",
];
const ENDED_STAGES: readonly PaymentStage[] = ["expired", "cancelled"];

function CopyReference({ reference }: { reference: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sin portapapeles: la referencia está a la vista para copiarla a mano */
    }
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void copy()}
      // Con «Copiada» a la vista el nombre accesible es ese texto (el nombre debe incluir lo que se ve, WCAG 2.5.3).
      aria-label={copied ? undefined : t("pay.copyLabel", { reference })}
    >
      {copied ? t("pay.copied") : t("pay.copy")}
    </Button>
  );
}

/**
 * Pantalla de pago con QR (S11) de un pedido: el código de la tienda, el monto exacto, la referencia, la cuenta, la cuenta
 * regresiva (hora del servidor) y la subida del comprobante, con un estado claro por cada punto del pago. Todo lo que muestra
 * viene de `customer_payment_view`: aquí no se calcula ni se decide nada. Si el pedido no se paga con QR, no pinta nada.
 */
export function PaymentQrPanel({ orderId }: { orderId: string }) {
  const { profile } = useAuth();
  const query = usePaymentView(orderId);
  const retry = useRetryPayment(orderId);
  const [retryProblem, setRetryProblem] = useState<string | null>(null);
  const view = query.data ?? null;
  const stage = view ? paymentStage(view) : null;
  const refreshNow = useCallback(() => void query.refetch(), [query]);

  if (query.isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <p role="status" className="sr-only">
          {t("pay.loading")}
        </p>
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        title={t("pay.loadError.title")}
        description={t("pay.loadError.description")}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!view || !view.payment || !isQrPayment(view) || !stage) return null;

  const { order, payment, method, proof } = view;
  const stageText = (part: "title" | "body") =>
    t(`pay.stage.${stage}.${part}` as MessageKey, {
      number: order.number,
      reason: proof?.reason ?? "",
    });
  const rejectedBody =
    stage === "proof_rejected"
      ? proof?.reason
        ? t("pay.stage.proof_rejected.body", { reason: proof.reason })
        : t("pay.stage.proof_rejected.bodyNoReason")
      : null;
  const open = OPEN_STAGES.includes(stage);
  const ended = ENDED_STAGES.includes(stage);
  const qrUrl = method?.qrImagePath ? qrImageUrl(method.qrImagePath) : null;
  const fetchedAt = query.dataUpdatedAt || Date.now();

  async function onRetry() {
    setRetryProblem(null);
    const result = await retry.mutateAsync();
    if (!result.ok) setRetryProblem(result.problem);
  }

  return (
    <section
      aria-labelledby="payment-qr-title"
      className="space-y-5 rounded-card border border-border bg-card p-5"
    >
      <h2 id="payment-qr-title" className="font-display text-display-sm">
        {t("pay.title")}
      </h2>

      <div className="space-y-1">
        <p className="font-medium">{stageText("title")}</p>
        <p role="status" className="text-sm text-muted-foreground">
          {rejectedBody ?? stageText("body")}
        </p>
      </div>

      {open && payment.expiresAt && (
        <PaymentCountdown
          expiresAt={payment.expiresAt}
          serverNow={view.serverNow}
          fetchedAtMs={fetchedAt}
          onElapsed={refreshNow}
        />
      )}

      {open && (
        <div className="grid gap-5 sm:grid-cols-[15rem_1fr]">
          <div>
            {qrUrl ? (
              <img
                src={qrUrl}
                alt={t("pay.qrAlt", { number: order.number })}
                width={240}
                height={240}
                className="h-60 w-60 max-w-full rounded-md border border-border bg-white object-contain"
              />
            ) : (
              <p role="alert" className="rounded-md border border-border p-3 text-sm">
                {t("pay.qrMissing")}
              </p>
            )}
          </div>
          <div className="min-w-0 space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">{t("pay.amount")}</p>
              <p className="text-2xl font-medium tabular-nums" data-testid="payment-amount">
                {formatCartMoney(payment.amount, payment.currency)}
              </p>
              <p className="text-xs text-muted-foreground">{t("pay.amountHelp")}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("pay.reference")}</p>
              <p className="flex flex-wrap items-center gap-3">
                <code className="break-all font-mono text-base" data-testid="payment-reference">
                  {payment.reference}
                </code>
                <CopyReference reference={payment.reference} />
              </p>
              <p className="text-xs text-muted-foreground">{t("pay.referenceHelp")}</p>
            </div>
            {method?.accountDetails && (
              <div>
                <p className="text-sm text-muted-foreground">{t("pay.account")}</p>
                <p className="whitespace-pre-line break-words text-sm">{method.accountDetails}</p>
              </div>
            )}
            <div>
              <p className="text-sm font-medium">{t("pay.steps.title")}</p>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>{t("pay.steps.one")}</li>
                <li>{t("pay.steps.two")}</li>
                <li>
                  {AUTOMATIC_QR_IN_UI && payment.provider === "qr_api"
                    ? t("pay.steps.auto")
                    : t("pay.steps.manual")}
                </li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {open && view.canUpload && profile && (
        <ProofUploader userId={profile.id} orderId={order.id} paymentId={payment.id} />
      )}

      {stage === "failed" && view.canRetry && (
        <div className="space-y-2">
          <Button type="button" onClick={() => void onRetry()} disabled={retry.isPending}>
            {retry.isPending ? t("pay.retry.working") : t("pay.retry.action")}
          </Button>
          {retryProblem && (
            <p role="alert" className="text-sm text-destructive">
              {t(`pay.retry.problems.${retryProblem}` as MessageKey)}
            </p>
          )}
        </div>
      )}

      {ended && (
        <div className="flex flex-wrap gap-3">
          <ReorderButton orderId={order.id} />
        </div>
      )}
    </section>
  );
}
