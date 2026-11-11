import { adminKeys } from "../queryKeys";

/** Claves de caché del panel de Pagos. Cuelgan de ["admin", "payments"]. */
export const paymentKeys = {
  all: [...adminKeys.all, "payments"] as const,
  proofs: () => [...paymentKeys.all, "proofs"] as const,
  reviews: () => [...paymentKeys.all, "reviews"] as const,
  list: (status: string, provider: string, page: number) =>
    [...paymentKeys.all, "list", status, provider, page] as const,
  events: (paymentId: string) => [...paymentKeys.all, "events", paymentId] as const,
  proofHistory: (paymentId: string) => [...paymentKeys.all, "proof-history", paymentId] as const,
  methods: () => [...paymentKeys.all, "methods"] as const,
  signed: (path: string) => [...paymentKeys.all, "signed", path] as const,
};
