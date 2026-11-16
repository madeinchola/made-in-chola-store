import { vi } from "vitest";

/** Todas las funciones de `./api`: las pruebas de pantalla las sustituyen por simulacros (`vi.mock("./api", …)`). */
export const API_FUNCTIONS = [
  "listNotifications",
  "listThread",
  "listForOrder",
  "notificationCounts",
  "notificationHealth",
  "resendNotification",
  "markNotificationSent",
  "cancelNotification",
  "listTemplates",
  "saveTemplate",
  "previewTemplate",
  "sendTestEmail",
] as const;

/** La clase real vive en `./api`; el simulacro necesita una con la misma forma para que `instanceof` funcione en las pruebas. */
export class FunctionError extends Error {
  constructor(
    readonly serverCode: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "FunctionError";
  }
}

export function createApiMock() {
  const mocks = Object.fromEntries(API_FUNCTIONS.map((name) => [name, vi.fn()])) as Record<
    (typeof API_FUNCTIONS)[number],
    ReturnType<typeof vi.fn>
  >;
  return { ...mocks, FunctionError };
}
