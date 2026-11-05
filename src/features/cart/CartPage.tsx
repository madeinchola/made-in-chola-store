import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ShoppingBag } from "lucide-react";
import { EmptyState } from "@/components/store/EmptyState";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import { storeRoutes } from "@/components/layout/storeRoutes";
import { track } from "@/features/storefront/analytics/track";
import { usePageMeta } from "@/features/storefront/seo/usePageMeta";
import { t } from "@/i18n";
import { BagList } from "./BagList";
import { useCart } from "./cart-context";
import { CartSuggestions } from "./CartSuggestions";
import { CartSummary } from "./CartSummary";
import { LoadError } from "./LoadError";
import { OrphanNotices } from "./LineNotice";
import { ReservationCountdown } from "./ReservationCountdown";
import { SyncBanner } from "./SyncBanner";
import { UndoNotice } from "./UndoNotice";
import { cartLoadFailed, pendingAdds } from "./viewState";

/**
 * `/carrito`: líneas, resumen, avisos, cuenta regresiva y sugerencias. Es un espacio PRIVADO (no se indexa). Al entrar
 * se revalida la bolsa con el servidor (precios y stock al día antes de pagar; no repite si se consultó hace poco) y se
 * emite `view_cart` una sola vez por visita con los totales del servidor.
 */
export function CartPage() {
  const { store, state, lines } = useCart();
  usePageMeta({ title: t("cart.title"), robots: "noindex,follow" });

  useEffect(() => {
    store.refetchIfStale();
  }, [store]);

  // `view_cart`: una vez por visita, con lo que dice el servidor (no se recalcula nada aquí).
  const viewed = useRef(false);
  const snapshot = state.snapshot;
  useEffect(() => {
    if (viewed.current || !snapshot || snapshot.lines.length === 0) return;
    viewed.current = true;
    track({
      name: "view_cart",
      items: snapshot.totals.item_count,
      value: snapshot.totals.subtotal,
      currency: snapshot.currency,
    });
  }, [snapshot]);

  const adding = pendingAdds(state);
  const empty = lines.length === 0 && adding.length === 0;

  const loadFailed = cartLoadFailed(state) && empty;

  let body;
  if (loadFailed) {
    body = <LoadError />;
  } else if (!state.loaded && empty) {
    body = (
      <div aria-busy="true" className="space-y-4">
        <p role="status" className="sr-only">
          {t("cart.loading")}
        </p>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  } else if (empty) {
    body = (
      <>
        <OrphanNotices />
        <EmptyState
          icon={ShoppingBag}
          title={t("cart.empty.title")}
          description={t("cart.empty.description")}
          action={
            <Link
              to={storeRoutes.shop}
              className={buttonVariants({ variant: "outline", caps: true, className: "min-h-11" })}
            >
              {t("cart.empty.action")}
            </Link>
          }
        />
      </>
    );
  } else {
    body = (
      <>
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
          <div className="min-w-0 space-y-4">
            <OrphanNotices />
            <ReservationCountdown />
            <BagList />
          </div>
          <CartSummary className="lg:sticky lg:top-6" />
        </div>
        <CartSuggestions />
      </>
    );
  }

  return (
    <div className="container py-8 lg:py-12">
      <h1 tabIndex={-1} data-cart-heading="" className="mb-6 font-display text-display-lg lg:mb-10">
        {t("cart.title")}
      </h1>
      <div className="space-y-4">
        {/* Con la lectura fallida el error ya trae su «Reintentar»: no se repite el aviso de conexión. */}
        {!loadFailed && <SyncBanner />}
        <UndoNotice />
        {body}
      </div>
    </div>
  );
}
