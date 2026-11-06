import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button-variants";
import { storeRoutes } from "@/components/layout/storeRoutes";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { useCart } from "./cart-context";
import { CheckoutButton } from "./CheckoutButton";
import { formatCartMoney } from "./format";

/**
 * Resumen y botón «Pagar». Los importes (`subtotal`, `shipping`, `discount`, `total`) salen del servidor y solo se
 * formatean; si hay cambios sin confirmar se atenúan y se indica que se están actualizando. Envío y descuento son PUNTOS
 * DE EXTENSIÓN: hoy llegan en `null` (S8 y S9 los llenarán): sin envío dice «se calcula en el siguiente paso» y sin
 * descuento no hay fila.
 */
export function CartSummary({ className }: { className?: string }) {
  const { state } = useCart();
  const snapshot = state.snapshot;
  if (!snapshot) return null;
  const { totals, currency } = snapshot;
  // Con CUALQUIER cambio sin confirmar: una línea quitada (cantidad 0) ya no está en `lines`, y su total viejo no debe
  // verse como definitivo.
  const syncing = Object.keys(state.pending).length > 0;
  // El rótulo cuenta lo que se COBRA (Σ `billable_qty`), no las unidades que hay en la bolsa (`totals.item_count`): una línea
  // agotada o con menos stock del pedido suma 0 (o menos) al importe, y «Subtotal (3 productos)» con un importe de 2 sería
  // engañoso. Es un conteo, no dinero. La cabecera SÍ cuenta todo lo que hay en la bolsa (`displayCount`): es otro número
  // con otro propósito («tienes cosas aquí»), y por eso pueden diferir.
  const chargedUnits = snapshot.lines.reduce((sum, line) => sum + line.billable_qty, 0);
  const row = "flex items-baseline justify-between gap-4";
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
        <div className={row}>
          <dt>
            {chargedUnits === 1
              ? t("cart.summary.subtotalItemsOne")
              : t("cart.summary.subtotalItems", { n: chargedUnits })}
          </dt>
          <dd className="tabular-nums">{formatCartMoney(totals.subtotal, currency)}</dd>
        </div>
        <div className={row}>
          <dt>{t("cart.summary.shipping")}</dt>
          <dd
            className={cn(
              "text-right tabular-nums",
              totals.shipping === null && "text-muted-foreground",
            )}
          >
            {totals.shipping === null
              ? t("cart.summary.shippingLater")
              : formatCartMoney(totals.shipping, currency)}
          </dd>
        </div>
        {totals.discount !== null && (
          <div className={row}>
            <dt>{t("cart.summary.discount")}</dt>
            <dd className="tabular-nums">
              {formatCartMoney(-Math.abs(totals.discount), currency)}
            </dd>
          </div>
        )}
        <div className={cn(row, "border-t border-border pt-3 text-base font-medium")}>
          <dt>{t("cart.summary.total")}</dt>
          <dd className="tabular-nums">{formatCartMoney(totals.total, currency)}</dd>
        </div>
      </dl>

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
