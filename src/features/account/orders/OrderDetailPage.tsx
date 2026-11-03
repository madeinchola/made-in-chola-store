import { Link } from "react-router-dom";
import { EmptyState } from "@/components/store/EmptyState";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { buttonVariants } from "@/components/ui/button-variants";
import { t } from "@/i18n";
import { accountRoutes } from "../accountRoutes";
import { displayDate, displayMoney } from "./format";
import { OrderStatusBadge } from "./OrderStatusBadge";
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
 * Estructura del detalle de un pedido: migas, número y estado, artículos, envío y pago. Presentacional y PROVISIONAL: la
 * forma real de los datos llega con el Sprint 10.
 */
export function OrderDetailView({ order }: { order: OrderDetail }) {
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

      <p className="flex items-baseline justify-between border-t border-border pt-4 font-medium">
        <span>{t("acct.orders.detail.total")}</span>
        <span className="tabular-nums">{displayMoney(order.total)}</span>
      </p>
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

/**
 * `/cuenta/pedidos/:orderId`. PROVISIONAL: mientras los pedidos no existan (S10), CUALQUIER id muestra «Pedido no
 * encontrado». Nunca se pinta el id de la URL.
 */
export function OrderDetailPage() {
  // S10: aquí se leerá el pedido (por `useParams().orderId`, solo del dueño). Hoy no hay ninguno.
  const order: OrderDetail | null = null;
  return order ? <OrderDetailView order={order} /> : <OrderNotFound />;
}
