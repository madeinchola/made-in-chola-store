import { Link } from "react-router-dom";
import { EmptyState } from "@/components/store/EmptyState";
import { ErrorState } from "@/components/store/ErrorState";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import { storeRoutes } from "@/components/layout/storeRoutes";
import { useAuth } from "@/features/auth/useAuth";
import { t } from "@/i18n";
import { useOrders } from "./hooks";
import { OrderListItem } from "./OrderListItem";
import type { OrderSummary } from "./types";

interface OrdersViewProps {
  orders: readonly OrderSummary[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/**
 * «Mis pedidos»: carga, error con reintento, estado vacío y la lista. Es presentacional: recibe los pedidos ya leídos
 * (y los estados de su consulta).
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

/** `/cuenta/pedidos`: los pedidos de la clienta, el más reciente primero (la RLS deja ver solo los propios). */
export function OrdersPage() {
  const { profile } = useAuth();
  const query = useOrders(profile?.id);
  return (
    <OrdersView
      orders={query.data ?? []}
      isLoading={query.isPending}
      isError={query.isError}
      onRetry={() => void query.refetch()}
    />
  );
}
