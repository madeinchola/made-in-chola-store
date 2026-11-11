import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { EmptyState } from "@/components/store/EmptyState";
import { ErrorState } from "@/components/store/ErrorState";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/features/auth/useAuth";
import { t } from "@/i18n";
import { accountRoutes } from "../accountRoutes";
import { CancelOrderDialog } from "./CancelOrderDialog";
import { displayDate, displayMoney } from "./format";
import { useOrderById } from "./hooks";
import { usePaymentView } from "@/features/payments/hooks";
import { PaymentQrPanel } from "@/features/payments/PaymentQrPanel";
import { isQrMethod } from "./ordersMapping";
import { OrderStatusBadge } from "./OrderStatusBadge";
import { OrderTimeline } from "./OrderTimeline";
import type { OrderDetail } from "./types";

function Crumbs({ current }: { current: string }) {
  return (
    <Breadcrumb label={t("acct.orders.detail.breadcrumbLabel")}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to={accountRoutes.profile}>{t("acct.orders.detail.account")}</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to={accountRoutes.orders}>{t("acct.orders.detail.orders")}</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{current}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t border-border pt-4">
      <h3 className="eyebrow text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Detalle de un pedido: migas, número y estado, seguimiento, artículos, envío, pago y desglose. Presentacional: recibe el
 * pedido ya leído (instantánea congelada al comprar). `onCancel` solo se ofrece si el pedido aún se puede cancelar.
 */
export function OrderDetailView({
  order,
  onCancel,
}: {
  order: OrderDetail;
  onCancel?: () => void;
}) {
  return (
    <div className="space-y-6">
      <Crumbs current={t("acct.orders.detail.number", { number: order.number })} />
      <header className="space-y-2">
        <h2 className="break-words font-display text-display-md">
          {t("acct.orders.detail.number", { number: order.number })}
        </h2>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <OrderStatusBadge status={order.status} />
          <span>
            {t("acct.orders.detail.placedOn")}{" "}
            <time dateTime={order.createdAt}>{displayDate(order.createdAt)}</time>
          </span>
        </p>
      </header>

      {order.timeline && order.timeline.length > 0 && (
        <Section title={t("checkout.confirmation.timeline.title")}>
          <OrderTimeline entries={order.timeline} />
        </Section>
      )}

      <Section title={t("acct.orders.detail.items")}>
        {order.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("acct.orders.detail.itemsEmpty")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {order.items.map((line) => (
              <li key={line.id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="break-words font-medium">{line.name}</p>
                  {line.variant && <p className="text-sm text-muted-foreground">{line.variant}</p>}
                  <p className="text-sm text-muted-foreground">
                    {t("acct.orders.detail.quantity", { n: line.quantity })}
                    {line.unitPrice && (
                      <>
                        {" "}
                        ·{" "}
                        {t("acct.orders.detail.unitPrice", { price: displayMoney(line.unitPrice) })}
                      </>
                    )}
                  </p>
                </div>
                <p className="shrink-0 tabular-nums">{displayMoney(line.total)}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("acct.orders.detail.shipping")}>
        {order.shipping ? (
          <p className="break-words text-sm">
            {order.shipping.label}
            {order.shipping.address && (
              <span className="block text-muted-foreground">{order.shipping.address}</span>
            )}
            {order.shipping.schedule && (
              <span className="block text-muted-foreground">{order.shipping.schedule}</span>
            )}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("acct.orders.detail.shippingEmpty")}</p>
        )}
      </Section>

      <Section title={t("acct.orders.detail.payment")}>
        {order.payment ? (
          <p className="text-sm">{order.payment.label}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("acct.orders.detail.paymentEmpty")}</p>
        )}
      </Section>

      <dl className="space-y-1.5 border-t border-border pt-4 text-sm">
        {order.subtotal && (
          <div className="flex items-baseline justify-between">
            <dt>{t("acct.orders.detail.subtotal")}</dt>
            <dd className="tabular-nums">{displayMoney(order.subtotal)}</dd>
          </div>
        )}
        {order.discount && order.discount.amount !== 0 && (
          <div className="flex items-baseline justify-between">
            <dt>
              {t("acct.orders.detail.discount")}
              {order.couponCode && (
                <span className="text-muted-foreground">
                  {" "}
                  · {t("acct.orders.detail.coupon", { code: order.couponCode })}
                </span>
              )}
            </dt>
            <dd className="tabular-nums">−{displayMoney(order.discount)}</dd>
          </div>
        )}
        {order.shippingCost && (
          <div className="flex items-baseline justify-between">
            <dt>{t("acct.orders.detail.shippingCost")}</dt>
            <dd className="tabular-nums">
              {order.shippingCost.amount === 0
                ? t("acct.orders.detail.shippingFree")
                : displayMoney(order.shippingCost)}
            </dd>
          </div>
        )}
        <div className="flex items-baseline justify-between pt-1 text-base font-medium">
          <dt>{t("acct.orders.detail.total")}</dt>
          <dd className="tabular-nums">{displayMoney(order.total)}</dd>
        </div>
      </dl>

      {order.canCancel && onCancel && (
        <div className="border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("checkout.confirmation.cancel.action")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Pedido que no existe (o que no es de esta persona): mensaje amable y camino de vuelta. No repite el id recibido. */
export function OrderNotFound() {
  return (
    <div className="space-y-6">
      <Crumbs current={t("acct.orders.detail.title")} />
      <EmptyState
        title={t("acct.orders.detail.notFound.title")}
        description={t("acct.orders.detail.notFound.description")}
        action={
          <Link
            to={accountRoutes.orders}
            className={buttonVariants({ variant: "outline", caps: true })}
          >
            {t("acct.orders.detail.notFound.action")}
          </Link>
        }
      />
    </div>
  );
}

/** Marcador de carga: el detalle se lee de la base. */
function DetailLoading() {
  return (
    <div aria-busy="true" className="min-h-[100svh] space-y-3">
      <p className="sr-only" role="status">
        {t("acct.orders.loading")}
      </p>
      <Skeleton className="h-10" />
      <Skeleton className="h-32" />
    </div>
  );
}

/**
 * `/cuenta/pedidos/:orderId`. Lee el pedido de la clienta (la RLS y el filtro por su id impiden ver uno ajeno): un pedido que
 * no existe o no es suyo es «Pedido no encontrado». Nunca se pinta el id de la URL.
 */
export function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { profile } = useAuth();
  const query = useOrderById(profile?.id, orderId);
  const [cancelling, setCancelling] = useState(false);
  // La pantalla de pago se pide YA: si llegara después del detalle lo empujaría hacia abajo (desplazamiento de diseño).
  const method = query.data?.payment?.method;
  const payment = usePaymentView(
    query.data && method && isQrMethod(method) ? query.data.id : undefined,
  );

  if (query.isPending || (query.data && method && isQrMethod(method) && payment.isPending)) {
    return <DetailLoading />;
  }
  if (query.isError) {
    return (
      <ErrorState
        title={t("acct.orders.error.title")}
        description={t("acct.orders.error.description")}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const order = query.data;
  if (!order) return <OrderNotFound />;
  return (
    <>
      {order.payment?.method && isQrMethod(order.payment.method) && (
        <div className="mb-6">
          <PaymentQrPanel orderId={order.id} />
        </div>
      )}
      <OrderDetailView order={order} onCancel={() => setCancelling(true)} />
      <CancelOrderDialog order={order} open={cancelling} onOpenChange={setCancelling} />
    </>
  );
}
