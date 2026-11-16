import { adminKeys } from "../queryKeys";
import type { OrderFilters } from "./types";

/** Claves de caché del panel de Pedidos. Cuelgan de ["admin", "orders"]. */
export const orderKeys = {
  all: [...adminKeys.all, "orders"] as const,
  list: (filters: OrderFilters) => [...orderKeys.all, "list", filters] as const,
  counts: () => [...orderKeys.all, "counts"] as const,
  detail: (id: string) => [...orderKeys.all, "detail", id] as const,
  history: (id: string) => [...orderKeys.all, "history", id] as const,
  payments: (id: string) => [...orderKeys.all, "payments", id] as const,
  proofs: (id: string) => [...orderKeys.all, "proofs", id] as const,
  refunds: (id: string) => [...orderKeys.all, "refunds", id] as const,
  pendingRefunds: () => [...orderKeys.all, "pending-refunds"] as const,
  returns: (id: string) => [...orderKeys.all, "returns", id] as const,
  incidents: (id: string | "all") => [...orderKeys.all, "incidents", id] as const,
  notes: (id: string) => [...orderKeys.all, "notes", id] as const,
  edits: (id: string) => [...orderKeys.all, "edits", id] as const,
  blacklist: () => [...orderKeys.all, "blacklist"] as const,
  matches: (id: string) => [...orderKeys.all, "matches", id] as const,
  attention: () => [...orderKeys.all, "attention"] as const,
  attentionSummary: () => [...orderKeys.all, "attention-summary"] as const,
  customers: (term: string) => [...orderKeys.all, "customers", term] as const,
  variants: (term: string) => [...orderKeys.all, "variants", term] as const,
  paymentMethods: () => [...orderKeys.all, "payment-methods"] as const,
  shippingMethods: () => [...orderKeys.all, "shipping-methods"] as const,
};
