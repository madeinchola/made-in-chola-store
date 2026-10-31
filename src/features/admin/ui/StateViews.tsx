import type { ReactNode } from "react";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";

/** Carga: anuncia el estado a lectores de pantalla sin mover el foco. */
export function LoadingState({ label = t("admin.states.loading") }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="py-10 text-center text-sm text-muted-foreground"
    >
      {label}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

/** Error recuperable: dice qué pasó y deja reintentar (nunca una pantalla en blanco). */
export function ErrorState({
  title = t("admin.states.errorTitle"),
  message = t("admin.states.errorBody"),
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center"
    >
      <p className="font-medium text-destructive">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          {t("admin.actions.retry")}
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
      <p>{children}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
