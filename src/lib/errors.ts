import { newCorrelationId } from "./logger";

export type AppErrorCode =
  "unknown" | "network" | "unauthorized" | "forbidden" | "not_found" | "validation" | "conflict";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly correlationId: string;
  constructor(
    code: AppErrorCode,
    message: string,
    options?: { cause?: unknown; correlationId?: string },
  ) {
    super(message, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.correlationId = options?.correlationId ?? newCorrelationId();
  }
}

/** Normaliza cualquier valor lanzado (incluso strings u objetos raros) a un AppError. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return new AppError("network", error.message, { cause: error });
  }
  if (error instanceof Error) return new AppError("unknown", error.message, { cause: error });
  return new AppError("unknown", typeof error === "string" ? error : "Error desconocido", {
    cause: error,
  });
}

export interface GlobalErrorTarget {
  addEventListener(type: "error", l: (e: ErrorEvent) => void): void;
  addEventListener(type: "unhandledrejection", l: (e: PromiseRejectionEvent) => void): void;
  removeEventListener(type: "error", l: (e: ErrorEvent) => void): void;
  removeEventListener(type: "unhandledrejection", l: (e: PromiseRejectionEvent) => void): void;
}

/** Captura errores no controlados del navegador y los entrega a `onError`. Devuelve la función de limpieza. */
export function installGlobalErrorHandlers(
  onError: (error: AppError) => void,
  target: GlobalErrorTarget = window,
): () => void {
  const onWindowError = (e: ErrorEvent) => onError(toAppError(e.error ?? e.message));
  const onRejection = (e: PromiseRejectionEvent) => onError(toAppError(e.reason));
  target.addEventListener("error", onWindowError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onWindowError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
