import { Link } from "react-router-dom";
import { EmptyState } from "@/components/store/EmptyState";
import { ErrorState } from "@/components/store/ErrorState";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import { storeRoutes } from "@/components/layout/storeRoutes";
import { t } from "@/i18n";
import { OrderListItem } from "./OrderListItem";
import type { OrderSummary } from "./types";

interface OrdersViewProps {
  orders: readonly OrderSummary[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/**
 * Estructura de «Mis pedidos» lista para recibir datos: carga, error con reintento, estado vacío y la lista. Es
 * presentacional: el Sprint 10 solo tiene que pasarle los pedidos que lea (y los estados de su consulta).
 */
export function OrdersView({
  orders,
  isLoading = false,
  isError = false,
  onRetry,
}: OrdersViewProps) {
  let body;
  if (isLoading) {
    body = (
      <div aria-busy="true" className="space-y-3">
        <p className="sr-only" role="status">
          {t("acct.orders.loading")}
        </p>
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  } else if (isError) {
    body = (
      <ErrorState
        title={t("acct.orders.error.title")}
        description={t("acct.orders.error.description")}
        {...(onRetry ? { onRetry } : {})}
      />
    );
  } else if (orders.length === 0) {
    body = (
      <EmptyState
        title={t("acct.orders.empty.title")}
        description={t("acct.orders.empty.description")}
        action={
          <Link
            to={storeRoutes.shop}
            className={buttonVariants({ variant: "outline", caps: true })}
          >
            {t("acct.orders.empty.action")}
          </Link>
        }
      />
    );
  } else {
    body = (
      <ul aria-label={t("acct.orders.list.label")} className="space-y-3">
        {orders.map((order) => (
          <OrderListItem key={order.id} order={order} />
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="font-display text-display-md">{t("acct.orders.title")}</h2>
        <p className="text-muted-foreground">{t("acct.orders.intro")}</p>
      </header>
      {body}
    </div>
  );
}

/** Aún no hay pedidos que leer (llegan con el Sprint 10): ninguna tabla se consulta. */
const NO_ORDERS: readonly OrderSummary[] = [];

/** `/cuenta/pedidos`. PROVISIONAL: siempre vacío hasta S10. */
export function OrdersPage() {
  return <OrdersView orders={NO_ORDERS} />;
}
