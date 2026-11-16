import { vi } from "vitest";

/** Todas las funciones de `./api`: las pruebas de pantalla las sustituyen por simulacros (`vi.mock("./api", …)`). */
export const API_FUNCTIONS = [
  "listOrders",
  "listOrdersForExport",
  "statusCounts",
  "getOrder",
  "getHistory",
  "listPayments",
  "listProofs",
  "listRefunds",
  "listPendingRefunds",
  "listReturns",
  "listIncidents",
  "listNotes",
  "listEdits",
  "listBlacklist",
  "blacklistMatches",
  "attentionSummary",
  "attentionOrders",
  "searchCustomers",
  "searchVariants",
  "transitionOrder",
  "undoTransition",
  "addNote",
  "editOrder",
  "refundOrder",
  "processRefund",
  "rejectRefund",
  "openReturn",
  "closeReturn",
  "rejectReturn",
  "codCollect",
  "codReject",
  "openIncident",
  "updateIncident",
  "blacklistAdd",
  "blacklistLift",
  "createManualOrder",
  "listPaymentMethodsLite",
  "listShippingMethodsLite",
] as const;

export function createApiMock(): Record<(typeof API_FUNCTIONS)[number], ReturnType<typeof vi.fn>> {
  return Object.fromEntries(API_FUNCTIONS.map((name) => [name, vi.fn()])) as never;
}
