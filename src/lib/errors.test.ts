import { describe, expect, it, vi } from "vitest";
import { AppError, installGlobalErrorHandlers, toAppError } from "./errors";

describe("toAppError", () => {
  it("conserva un AppError tal cual", () => {
    const e = new AppError("forbidden", "no");
    expect(toAppError(e)).toBe(e);
  });
  it("envuelve Error, string y valores raros, siempre con correlationId", () => {
    expect(toAppError(new Error("boom")).message).toBe("boom");
    expect(toAppError("texto").message).toBe("texto");
    const weird = toAppError({ a: 1 });
    expect(weird.message).toBe("Error desconocido");
    expect(weird.correlationId).toBeTruthy();
  });
  it("clasifica fallos de red", () => {
    expect(toAppError(new TypeError("Failed to fetch")).code).toBe("network");
    expect(toAppError(new TypeError("otro")).code).toBe("unknown");
  });
  it("IDs de correlación distintos entre errores", () => {
    expect(toAppError("a").correlationId).not.toBe(toAppError("a").correlationId);
  });
});

describe("installGlobalErrorHandlers", () => {
  it("captura 'error' y 'unhandledrejection' reales del window", () => {
    const onError = vi.fn();
    const stop = installGlobalErrorHandlers(onError);
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("sync") }));
    const rejection = new Event("unhandledrejection") as Event & { reason: unknown };
    rejection.reason = new Error("async");
    window.dispatchEvent(rejection);
    expect(onError.mock.calls.map(([e]) => (e as AppError).message)).toEqual(["sync", "async"]);
    stop();
  });
  it("la función de limpieza quita exactamente los listeners que instaló", () => {
    const added: [string, unknown][] = [];
    const removed: [string, unknown][] = [];
    const target = {
      addEventListener: (type: string, l: unknown) => void added.push([type, l]),
      removeEventListener: (type: string, l: unknown) => void removed.push([type, l]),
    };
    const stop = installGlobalErrorHandlers(vi.fn(), target as never);
    expect(added.map(([t]) => t).sort()).toEqual(["error", "unhandledrejection"]);
    expect(removed).toEqual([]);
    stop();
    expect(removed.sort()).toEqual(added.sort());
  });
});
