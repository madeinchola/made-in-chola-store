import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button-variants";
import { storeRoutes } from "@/components/layout/storeRoutes";
import { canQuote, shippingRow, type ShippingRow } from "@/features/shipping/estimate";
import { ShippingEstimator } from "@/features/shipping/ShippingEstimator";
import { useShippingEstimate } from "@/features/shipping/useShippingEstimate";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { useCart } from "./cart-context";
import { CheckoutButton } from "./CheckoutButton";
import { CouponForm } from "./CouponForm";
import { formatCartMoney } from "./format";
import { discountsOf } from "./selectors";
import type { CartSnapshot } from "./types";

/**
 * Resumen y botón «Pagar». Los importes (`subtotal`, `shipping`, `discount`, `total`) salen del servidor y solo se
 * formatean; si hay cambios sin confirmar se atenúan y se indica que se están actualizando.
 *
 * Descuentos (S9): con `totals.discount !== null` hay una fila «Descuento» y, debajo, el desglose de lo aplicado («Oferta:
 * −Bs 15,00»; el envío gratis no entra: no baja el subtotal). `totals.total` YA viene neto y es la base del «Total estimado».
 * Con envío gratis (`discounts.free_shipping`) la fila de envío dice «Gratis» en cuanto hay cotización válida (antes, una nota
 * «Tienes envío gratis») y el costo cotizado NO se suma. El bloque del cupón (`CouponForm`) vive aquí, no en el cajón.
 *
 * Envío (S8): mientras el servidor no lo llene en la bolsa (`totals.shipping === null`, lo hará el checkout, S10) el
 * resumen lo ESTIMA con el estimador de envío: la fila dice el costo (o por qué no hay), y con un costo válido aparece un
 * «Total estimado» = subtotal + envío, aparte del total de la bolsa, que NO cambia. Es una estimación: el pedido la recalcula.
 */
export function CartSummary({ className }: { className?: string }) {
  const { state } = useCart();
  const snapshot = state.snapshot;
  if (!snapshot) return null;
  // Con CUALQUIER cambio sin confirmar: una línea quitada (cantidad 0) ya no está en `lines`, y su total viejo no debe
  // verse como definitivo.
  const syncing = Object.keys(state.pending).length > 0;
  return <SummaryBody snapshot={snapshot} syncing={syncing} className={className} />;
}

/** El texto de la fila «Envío» estimada. Sin importe (sin destino, calculando, sin estimación) va atenuado: no es un número. */
function describeShipping(row: ShippingRow, currency: string): { text: string; muted: boolean } {
  switch (row.kind) {
    case "later":
      return { text: t("cart.summary.shippingLater"), muted: true };
    case "calculating":
      return { text: t("cart.summary.shippingCalculating"), muted: true };
    case "unavailable":
      return { text: t("cart.summary.shippingUnavailable"), muted: true };
    case "free":
      return { text: t("cart.summary.shippingFree"), muted: false };
    case "cost":
      return { text: formatCartMoney(row.cost, currency), muted: false };
  }
}

function SummaryBody({
  snapshot,
  syncing,
  className,
}: {
  snapshot: CartSnapshot;
  syncing: boolean;
  className: string | undefined;
}) {
  const { totals, currency } = snapshot;
  const discounts = discountsOf(snapshot);
  const freeShipping = discounts.free_shipping;
  // El envío gratis no baja el subtotal: no es una línea del desglose del descuento.
  const breakdown = discounts.applied.filter((entry) => !entry.free_shipping);
  // El servidor manda: si ya informa el envío de la bolsa se muestra tal cual y no se estima nada.
  const serverShipping = totals.shipping;
  const estimate = useShippingEstimate({
    subtotal: totals.subtotal,
    // el descuento (S9), cuando exista, ya viene restado en `totals.total`: el total estimado lo respeta
    baseTotal: totals.total,
    currency,
    quotable:
      serverShipping === null &&
      canQuote({ lineCount: snapshot.lines.length, subtotal: totals.subtotal }),
    freeShipping,
  });
  const row = shippingRow(estimate.quote, freeShipping);
  const shippingCell =
    serverShipping !== null
      ? { text: formatCartMoney(serverShipping, currency), muted: false }
      : describeShipping(row, currency);
  // Sin destino elegido aún no hay cotización: el envío sigue «por calcular», pero se avisa que será gratis.
  const freeShippingNote = serverShipping === null && freeShipping && row.kind === "later";
  // El rótulo cuenta lo que se COBRA (Σ `billable_qty`), no las unidades que hay en la bolsa (`totals.item_count`): una línea
  // agotada o con menos stock del pedido suma 0 (o menos) al importe, y «Subtotal (3 productos)» con un importe de 2 sería
  // engañoso. Es un conteo, no dinero. La cabecera SÍ cuenta todo lo que hay en la bolsa (`displayCount`): es otro número
  // con otro propósito («tienes cosas aquí»), y por eso pueden diferir.
  const chargedUnits = snapshot.lines.reduce((sum, line) => sum + line.billable_qty, 0);
  const itemsRow = "flex items-baseline justify-between gap-4";
  // Sin `aria-busy`: algunos lectores de pantalla no anuncian lo que está dentro de un contenedor ocupado, y aquí dentro
  // vive la región viva «Actualizando…».
  return (
    <section
      aria-labelledby="cart-summary-title"
      className={cn("space-y-5 rounded-card border border-border bg-card p-5 sm:p-6", className)}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="cart-summary-title" className="font-display text-display-sm">
          {t("cart.summary.title")}
        </h2>
        <span aria-hidden="true" className="inline-flex h-4 w-4 items-center justify-center">
          {syncing && <Loader2 className="h-4 w-4 animate-spin" />}
        </span>
        <span role="status" className="sr-only">
          {syncing ? t("cart.summary.updating") : ""}
        </span>
      </div>

      <dl className={cn("space-y-3 text-sm", syncing && "opacity-60")}>
        <div className={itemsRow}>
          <dt>
            {chargedUnits === 1
              ? t("cart.summary.subtotalItemsOne")
              : t("cart.summary.subtotalItems", { n: chargedUnits })}
          </dt>
          <dd className="tabular-nums">{formatCartMoney(totals.subtotal, currency)}</dd>
        </div>
        <div className={cn(itemsRow, freeShippingNote && "flex-wrap")}>
          <dt>{t("cart.summary.shipping")}</dt>
          <dd
            className={cn("text-right tabular-nums", shippingCell.muted && "text-muted-foreground")}
          >
            {shippingCell.text}
          </dd>
          {freeShippingNote && (
            <dd className="basis-full text-xs text-success">
              {t("cart.summary.freeShippingNote")}
            </dd>
          )}
        </div>
        {totals.discount !== null && (
          <div className={cn(itemsRow, breakdown.length > 0 && "flex-wrap")}>
            <dt>{t("cart.summary.discount")}</dt>
            <dd className="tabular-nums">
              {formatCartMoney(-Math.abs(totals.discount), currency)}
            </dd>
            {breakdown.length > 0 && (
              <dd className="basis-full space-y-0.5 text-xs text-muted-foreground">
                {breakdown.map((entry) => (
                  <p
                    key={`${entry.discount_id}-${entry.coupon_id ?? "oferta"}`}
                    className="break-words"
                  >
                    {t("cart.summary.discountLine", {
                      name: entry.name,
                      amount: formatCartMoney(entry.amount, currency),
                    })}
                  </p>
                ))}
              </dd>
            )}
          </div>
        )}
        {/* UN solo total a la vista: con una estimación de envío, «Total» (la bolsa, sin envío) quedaría justo debajo de la
            fila «Envío» con un importe que no la incluye. El servidor sigue siendo la fuente de `totals.total`; solo no se muestra. */}
        <div className={cn(itemsRow, "border-t border-border pt-3 text-base font-medium")}>
          {estimate.total === null ? (
            <>
              <dt>{t("cart.summary.total")}</dt>
              <dd className="tabular-nums">{formatCartMoney(totals.total, currency)}</dd>
            </>
          ) : (
            <>
              <dt>{t("cart.summary.totalEstimated")}</dt>
              <dd className="tabular-nums">{formatCartMoney(estimate.total, currency)}</dd>
            </>
          )}
        </div>
      </dl>
      {estimate.total !== null && (
        <p className="text-xs text-muted-foreground">{t("cart.summary.estimateNote")}</p>
      )}

      <CouponForm />

      {serverShipping === null && (
        // Con cambios sin confirmar la estimación aún es la del subtotal anterior: se atenúa y se marca ocupada, como las filas.
        <div className={cn(syncing && "opacity-60")} aria-busy={syncing || undefined}>
          <ShippingEstimator estimate={estimate} />
        </div>
      )}

      <div>
        <CheckoutButton />
        <Link
          to={storeRoutes.shop}
          className={cn(
            buttonVariants({ variant: "link" }),
            "mt-4 flex min-h-11 w-full justify-center",
          )}
        >
          {t("cart.continueShopping")}
        </Link>
      </div>
    </section>
  );
}
