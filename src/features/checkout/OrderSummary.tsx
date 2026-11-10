import { useState } from "react";
import { ImagePlaceholder } from "@/components/store/ImagePlaceholder";
import { CouponForm } from "@/features/cart/CouponForm";
import { formatCartMoney } from "@/features/cart/format";
import { productImageUrl } from "@/features/catalog/mediaUrl";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { CheckoutLine, CheckoutPreview } from "./types";

function Thumb({ line }: { line: CheckoutLine }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative h-16 w-14 shrink-0 overflow-hidden rounded-sm bg-muted">
      {line.image_path && !failed ? (
        <img
          src={productImageUrl(line.image_path)}
          alt=""
          width={56}
          height={64}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <ImagePlaceholder />
      )}
      <span className="absolute -right-0 -top-0 rounded-bl-sm bg-foreground px-1.5 text-xs tabular-nums text-background">
        <span className="sr-only">{t("checkout.summary.quantity", { n: line.billable_qty })}</span>
        <span aria-hidden="true">{line.billable_qty}</span>
      </span>
    </div>
  );
}

/**
 * El resumen del pedido: líneas, cupón y desglose. Todos los importes salen de la vista previa del SERVIDOR; aquí solo se
 * les da formato. Mientras falta el envío no hay total honesto y se dice «—» (nunca un total sin envío que luego suba).
 */
export function OrderSummary({
  preview,
  refreshing,
  className,
}: {
  preview: CheckoutPreview | undefined;
  refreshing: boolean;
  className?: string;
}) {
  if (!preview) return null;
  const { currency, totals } = preview;
  const free =
    totals.shipping !== null && totals.shipping > 0 && totals.shipping_discount >= totals.shipping;
  return (
    <section
      aria-labelledby="checkout-summary"
      aria-busy={refreshing || undefined}
      className={cn("space-y-5 rounded-card border border-border bg-card p-5 sm:p-6", className)}
    >
      <h2 id="checkout-summary" className="font-display text-display-sm">
        {t("checkout.summary.title")}
      </h2>
      <ul aria-label={t("checkout.summary.listLabel")} className="space-y-3">
        {preview.lines.map((line) => (
          <li key={line.variant_id} className="flex items-start gap-3">
            <Thumb line={line} />
            <div className="min-w-0 flex-1 text-sm">
              <p className="break-words font-medium">{line.name}</p>
              <p className="text-xs text-muted-foreground">
                {[line.color_name, line.size_label].filter(Boolean).join(" · ")}
              </p>
            </div>
            <p className="shrink-0 text-sm tabular-nums">
              {line.discount > 0 && (
                <span className="mr-1.5 text-xs text-muted-foreground line-through">
                  {formatCartMoney(line.line_total, currency)}
                </span>
              )}
              {formatCartMoney(line.final_total, currency)}
            </p>
          </li>
        ))}
      </ul>

      <CouponForm />

      <dl
        className={cn("space-y-2 border-t border-border pt-4 text-sm", refreshing && "opacity-60")}
      >
        <div className="flex justify-between gap-3">
          <dt>{t("checkout.summary.subtotal")}</dt>
          <dd className="tabular-nums">{formatCartMoney(totals.subtotal, currency)}</dd>
        </div>
        {totals.discount > 0 && (
          <div className="flex justify-between gap-3">
            <dt>{t("checkout.summary.discount")}</dt>
            <dd className="tabular-nums">−{formatCartMoney(totals.discount, currency)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt>{t("checkout.summary.shipping")}</dt>
          <dd
            className={cn(
              "text-right tabular-nums",
              totals.shipping === null && "text-muted-foreground",
            )}
          >
            {totals.shipping === null
              ? t("checkout.summary.shippingPending")
              : free
                ? t("checkout.delivery.shippingFree")
                : totals.shipping === 0
                  ? t("checkout.delivery.pickupFree")
                  : formatCartMoney(totals.shipping, currency)}
          </dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-border pt-3 text-base font-medium">
          <dt>{t("checkout.summary.total")}</dt>
          <dd className="tabular-nums" data-testid="checkout-total">
            {totals.total === null
              ? t("checkout.summary.totalPending")
              : formatCartMoney(totals.total, currency)}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">{t("checkout.summary.taxesIncluded")}</p>
    </section>
  );
}
