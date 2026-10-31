import { Badge, type BadgeProps } from "@/components/ui/badge";
import { t } from "@/i18n";
import type { PublicStockStatus } from "@/features/catalog/types";

const TONE: Record<PublicStockStatus, NonNullable<BadgeProps["tone"]>> = {
  in_stock: "success",
  low: "warning",
  out: "danger",
};

/** Disponibilidad pública de una variante. El texto SIEMPRE es visible: el color nunca es la única señal. */
export function StockBadge({
  status,
  className,
}: {
  status: PublicStockStatus;
  className?: string | undefined;
}) {
  return (
    <Badge tone={TONE[status]} className={className}>
      {t(`store.stock.${status}`)}
    </Badge>
  );
}
