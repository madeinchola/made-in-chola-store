import type { ReactNode } from "react";
import { TriangleAlert, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  icon?: LucideIcon;
  /** Por defecto "No pudimos cargar esto". */
  title?: string;
  /** Por defecto "Revisa tu conexión e inténtalo de nuevo.". */
  description?: string;
  /** Si se da, aparece el botón "Reintentar". */
  onRetry?: () => void;
  /** Acción adicional (p. ej. volver al inicio). */
  action?: ReactNode;
  className?: string;
}

/** Estado de error recuperable. Se anuncia con `role="alert"`. */
export function ErrorState({
  icon: Icon = TriangleAlert,
  title,
  description,
  onRetry,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center gap-3 px-4 py-12 text-center", className)}
    >
      <Icon aria-hidden="true" className="h-10 w-10 text-destructive" strokeWidth={1.25} />
      <p className="font-display text-display-sm">{title ?? t("ui.state.errorTitle")}</p>
      <p className="max-w-prose text-sm text-muted-foreground">
        {description ?? t("ui.state.errorBody")}
      </p>
      {(onRetry || action) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          {onRetry && (
            <Button type="button" variant="outline" caps onClick={onRetry}>
              {t("ui.state.retry")}
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}
