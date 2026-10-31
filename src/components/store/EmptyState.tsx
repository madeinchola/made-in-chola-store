import type { ReactNode } from "react";
import { PackageOpen, type LucideIcon } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  /** Por defecto "No hay nada por aquí". */
  title?: string;
  description?: string;
  /** Siguiente paso posible (botón o enlace). */
  action?: ReactNode;
  className?: string;
}

/** Estado vacío (sin resultados, carrito vacío…). Se anuncia con `role="status"`. */
export function EmptyState({
  icon: Icon = PackageOpen,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn("flex flex-col items-center gap-3 px-4 py-12 text-center", className)}
    >
      <Icon aria-hidden="true" className="h-10 w-10 text-muted-foreground" strokeWidth={1.25} />
      <p className="font-display text-display-sm">{title ?? t("ui.state.emptyTitle")}</p>
      {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
