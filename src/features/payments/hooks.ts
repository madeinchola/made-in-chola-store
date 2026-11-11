import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getPaymentView, retryPayment, uploadProof } from "./paymentsApi";
import { paymentStage } from "./paymentsMapping";
import type { PaymentView } from "./types";

export const paymentKeys = {
  view: (orderId: string) => ["payments", "view", orderId] as const,
};

/** Mientras el pago espera algo (comprobante, revisión, aviso del proveedor) se vuelve a preguntar cada 10 s. */
export const POLL_MS = 10_000;
const WAITING_STAGES = new Set(["awaiting", "proof_pending", "proof_rejected", "in_review"]);

export function shouldPoll(view: PaymentView | null | undefined): boolean {
  return Boolean(view && view.payment && WAITING_STAGES.has(paymentStage(view)));
}

export function usePaymentView(orderId: string | undefined) {
  return useQuery({
    queryKey: paymentKeys.view(orderId ?? "none"),
    queryFn: () => getPaymentView(orderId as string),
    enabled: Boolean(orderId),
    // Lo del pago cambia por fuera (el admin aprueba, el banco avisa): siempre se lee fresco.
    staleTime: 0,
    refetchInterval: (query) => (shouldPoll(query.state.data) ? POLL_MS : false),
    refetchOnWindowFocus: true,
  });
}

export function useUploadProof(orderId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: uploadProof,
    onSettled: () => {
      void client.invalidateQueries({ queryKey: paymentKeys.view(orderId) });
    },
  });
}

export function useRetryPayment(orderId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => retryPayment(orderId),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: paymentKeys.view(orderId) });
      void client.invalidateQueries({ queryKey: ["account", "orders"] });
    },
  });
}
