import { Badge, type BadgeProps } from "@/components/ui/badge";
import { t, type MessageKey } from "@/i18n";
import { ORDER_STATUSES, type OrderStatus } from "./types";

const TONE: Record<OrderStatus, NonNullable<BadgeProps["tone"]>> = {
  pending_payment: "warning",
  paid: "info",
  preparing: "info",
  shipped: "info",
  delivered: "success",
  completed: "success",
  cancelled: "danger",
  refunded: "neutral",
};

const isStatus = (value: string): value is OrderStatus =>
  (ORDER_STATUSES as readonly string[]).includes(value);

/** Estado del pedido SIEMPRE con texto (el color solo refuerza). Un estado que no se conoce se muestra como tal. */
export function OrderStatusBadge({ status }: { status: string }) {
  if (!isStatus(status)) return <Badge>{t("acct.orders.status.unknown")}</Badge>;
  return <Badge tone={TONE[status]}>{t(`acct.orders.status.${status}` as MessageKey)}</Badge>;
}
