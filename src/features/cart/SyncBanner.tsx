import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { storeRoutes } from "@/components/layout/storeRoutes";
import { t } from "@/i18n";
import { useCart } from "./cart-context";
import { NoticeBanner } from "./NoticeBanner";

/**
 * Avisa cuando la bolsa no se puede sincronizar: sin conexión (lo pendiente se conserva y se reintenta), demasiadas
 * peticiones, sesión vencida u otro error. Todos con «Reintentar» (`store.retryNow()`); el de sesión además lleva un
 * enlace para iniciar sesión y volver aquí. `role="status"`: informa sin interrumpir.
 */
export function SyncBanner({ className }: { className?: string }) {
  const { state, store } = useCart();
  const location = useLocation();
  const { sync } = state;
  if (sync.state !== "offline" && sync.state !== "error") return null;

  const retry = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="min-h-11"
      onClick={() => store.retryNow()}
    >
      {t("cart.sync.retry")}
    </Button>
  );

  if (sync.state === "offline") {
    return (
      <NoticeBanner
        tone="warning"
        message={t("cart.sync.offline")}
        actions={retry}
        className={className}
      />
    );
  }

  if (sync.code === "session") {
    return (
      <NoticeBanner
        tone="warning"
        message={t("cart.sync.session")}
        className={className}
        actions={
          <>
            <Link
              to={storeRoutes.login}
              state={{ from: `${location.pathname}${location.search}` }}
              className={buttonVariants({ variant: "outline", size: "sm", className: "min-h-11" })}
            >
              {t("cart.sync.login")}
            </Link>
            {retry}
          </>
        }
      />
    );
  }

  const message =
    sync.code === "rate_limited"
      ? sync.retryAfter !== undefined
        ? t("cart.sync.rateLimited", { seconds: sync.retryAfter })
        : t("cart.sync.rateLimitedNoTime")
      : t("cart.sync.error");
  return <NoticeBanner tone="warning" message={message} actions={retry} className={className} />;
}
