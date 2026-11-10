import { t, type MessageKey } from "@/i18n";
import { displayDate } from "./format";
import { ORDER_STATUSES, type OrderStatus, type OrderTimelineEntry } from "./types";

const isStatus = (value: string): value is OrderStatus =>
  (ORDER_STATUSES as readonly string[]).includes(value);

/**
 * Seguimiento del pedido: cada estado por el que pasó, del primero al último, con su fecha. Es una lista ordenada (no solo
 * color): el paso actual es el último y se anuncia como tal para lectores de pantalla.
 */
export function OrderTimeline({ entries }: { entries: readonly OrderTimelineEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <ol aria-label={t("checkout.confirmation.timeline.title")} className="space-y-3">
      {entries.map((entry, index) => {
        const last = index === entries.length - 1;
        const label = isStatus(entry.status)
          ? t(`checkout.confirmation.timeline.${entry.status}` as MessageKey)
          : t("acct.orders.status.unknown");
        return (
          <li
            key={`${entry.status}-${entry.at}`}
            aria-current={last ? "step" : undefined}
            className="flex items-start gap-3"
          >
            <span
              aria-hidden="true"
              className={`mt-1.5 size-2.5 shrink-0 rounded-full ${last ? "bg-foreground" : "border border-border bg-background"}`}
            />
            <div className="min-w-0">
              <p className={last ? "font-medium" : "text-muted-foreground"}>{label}</p>
              <p className="text-xs text-muted-foreground">
                <time dateTime={entry.at}>{displayDate(entry.at)}</time>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
