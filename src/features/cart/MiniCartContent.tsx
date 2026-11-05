import { Link } from "react-router-dom";
import { ShoppingBag } from "lucide-react";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import { storeRoutes } from "@/components/layout/storeRoutes";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { BagList } from "./BagList";
import { useCart } from "./cart-context";
import { CheckoutButton } from "./CheckoutButton";
import { formatCartMoney } from "./format";
import { OrphanNotices } from "./LineNotice";
import { ReservationCountdown } from "./ReservationCountdown";
import { SyncBanner } from "./SyncBanner";
import { LoadError } from "./LoadError";
import { UndoNotice } from "./UndoNotice";
import { cartLoadFailed, pendingAdds } from "./viewState";

/**
 * Contenido del cajón de la bolsa (se carga bajo demanda): avisos, líneas compactas, cuenta regresiva, subtotal y los
 * botones «Pagar» y «Ver bolsa». El subtotal es el del servidor, tal cual.
 */
export function MiniCartContent() {
  const { state, lines, setOpen } = useCart();
  const adding = pendingAdds(state);
  const snapshot = state.snapshot;
  const empty = lines.length === 0 && adding.length === 0;
  // «Actualizando» mientras haya CUALQUIER cambio sin confirmar: una línea quitada (cantidad 0) ya no está en `lines`.
  const syncing = Object.keys(state.pending).length > 0;

  if (cartLoadFailed(state) && empty) {
    return <LoadError className="px-6" />;
  }

  if (!state.loaded && empty) {
    return (
      <div aria-busy="true" className="space-y-3 px-6 pb-6">
        <p role="status" className="sr-only">
          {t("cart.loading")}
        </p>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="space-y-4 px-6 pb-6">
        <SyncBanner />
        <UndoNotice />
        <OrphanNotices />
        {empty ? (
          <div role="status" className="flex flex-col items-center gap-3 py-10 text-center">
            <ShoppingBag
              aria-hidden="true"
              className="h-10 w-10 text-muted-foreground"
              strokeWidth={1.25}
            />
            <p className="font-display text-display-sm">{t("cart.empty.title")}</p>
            <p className="text-sm text-muted-foreground">{t("cart.empty.description")}</p>
            <Link
              to={storeRoutes.shop}
              onClick={() => setOpen(false)}
              className={cn(buttonVariants({ variant: "outline", caps: true }), "mt-2 min-h-11")}
            >
              {t("cart.empty.action")}
            </Link>
          </div>
        ) : (
          <>
            <ReservationCountdown />
            <BagList variant="compact" />
          </>
        )}
      </div>

      {!empty && snapshot && (
        <div className="sticky bottom-0 mt-auto space-y-3 border-t border-border bg-background px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          <p
            className={cn("flex items-baseline justify-between gap-4", syncing && "opacity-60")}
            aria-busy={syncing || undefined}
          >
            <span className="font-medium">{t("cart.summary.subtotal")}</span>
            <span className="tabular-nums">
              {formatCartMoney(snapshot.totals.subtotal, snapshot.currency)}
            </span>
          </p>
          <div>
            <CheckoutButton />
          </div>
          <Link
            to={storeRoutes.cart}
            onClick={() => setOpen(false)}
            className={cn(buttonVariants({ variant: "outline", size: "lg", caps: true }), "w-full")}
          >
            {t("cart.drawer.viewBag")}
          </Link>
        </div>
      )}
    </div>
  );
}
