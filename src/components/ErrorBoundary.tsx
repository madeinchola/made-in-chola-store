import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "@/i18n";
import { logger } from "@/lib/logger";
import { toAppError } from "@/lib/errors";

interface Props {
  children: ReactNode;
}

interface State {
  correlationId: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { correlationId: null };

  static getDerivedStateFromError(error: unknown): State {
    return { correlationId: toAppError(error).correlationId };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    logger.error("Error de render capturado por ErrorBoundary", {
      error,
      componentStack: info.componentStack,
      reference: this.state.correlationId,
    });
  }

  render() {
    if (this.state.correlationId === null) return this.props.children;
    return (
      <div role="alert" className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="max-w-sm space-y-3 text-center">
          <h1 className="text-lg font-semibold">{t("error.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("error.body")}</p>
          <p className="text-xs text-muted-foreground">
            {t("error.reference", { id: this.state.correlationId })}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm text-muted-foreground underline hover:text-foreground"
          >
            {t("error.reload")}
          </button>
        </div>
      </div>
    );
  }
}
