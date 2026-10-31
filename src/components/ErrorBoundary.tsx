import { Component, type ErrorInfo, type ReactNode } from "react";
import { logger } from "@/lib/logger";
import { toAppError } from "@/lib/errors";
import { ErrorScreen } from "./ErrorScreen";

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
    return <ErrorScreen correlationId={this.state.correlationId} />;
  }
}
