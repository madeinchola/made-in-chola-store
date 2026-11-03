import { Link } from "react-router-dom";
import { t } from "@/i18n";
import { orderDetailRoute } from "../accountRoutes";
import { displayDate, displayMoney } from "./format";
import { OrderStatusBadge } from "./OrderStatusBadge";
import type { OrderSummary } from "./types";

/**
 * Una fila de «Mis pedidos»: número (enlace al detalle), fecha, estado y total. Presentacional: recibe el pedido por
 * props y no consulta nada (el Sprint 10 lo llenará con datos reales). Un solo enlace por fila, estirado sobre el número.
 */
export function OrderListItem({ order }: { order: OrderSummary }) {
  return (
    <li className="relative flex flex-col gap-3 rounded-card border border-border p-4 transition-colors duration-fast ease-standard hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <Link
          to={orderDetailRoute(order.id)}
          className="block break-words font-display text-display-sm after:absolute after:inset-0"
        >
          {t("acct.orders.item.order", { number: order.number })}
        </Link>
        <p className="text-sm text-muted-foreground">
          {t("acct.orders.item.placedOn")}{" "}
          <time dateTime={order.createdAt}>{displayDate(order.createdAt)}</time>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <OrderStatusBadge status={order.status} />
        <p className="font-medium tabular-nums">
          <span className="sr-only">{t("acct.orders.item.total")}: </span>
          {displayMoney(order.total)}
        </p>
      </div>
    </li>
  );
}
