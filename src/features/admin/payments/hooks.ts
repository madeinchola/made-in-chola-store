import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listMethods,
  listOpenReviews,
  listPaymentEvents,
  listPayments,
  listPendingProofs,
  listProofHistory,
  signedProofUrl,
} from "./api";
import { paymentKeys } from "./queryKeys";
import type { PaymentFilters } from "./types";

// El panel siempre lee fresco: otra persona pudo revisar, o el banco pudo avisar, mientras tanto.
const fresh = { staleTime: 0, gcTime: 0 } as const;

export const usePendingProofs = () =>
  useQuery({ queryKey: paymentKeys.proofs(), queryFn: listPendingProofs, ...fresh });
export const useOpenReviews = () =>
  useQuery({ queryKey: paymentKeys.reviews(), queryFn: listOpenReviews, ...fresh });
export const usePayments = (filters: PaymentFilters) =>
  useQuery({
    queryKey: paymentKeys.list(filters.status, filters.provider, filters.page),
    queryFn: () => listPayments(filters),
    placeholderData: keepPreviousData,
    ...fresh,
  });
export const usePaymentEvents = (paymentId: string | null) =>
  useQuery({
    queryKey: paymentKeys.events(paymentId ?? "none"),
    queryFn: () => listPaymentEvents(paymentId as string),
    enabled: paymentId !== null,
    ...fresh,
  });
export const useProofHistory = (paymentId: string | null) =>
  useQuery({
    queryKey: paymentKeys.proofHistory(paymentId ?? "none"),
    queryFn: () => listProofHistory(paymentId as string),
    enabled: paymentId !== null,
    ...fresh,
  });
export const useMethods = () =>
  useQuery({ queryKey: paymentKeys.methods(), queryFn: listMethods, ...fresh });

/** La URL firmada vive 5 minutos: se reutiliza 4 (no se pide una nueva por cada repintado). */
export const useSignedUrl = (path: string | null) =>
  useQuery({
    queryKey: paymentKeys.signed(path ?? "none"),
    queryFn: () => signedProofUrl(path as string),
    enabled: path !== null,
    staleTime: 4 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });

export const useInvalidatePayments = () => {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: paymentKeys.all });
};

/** Una decisión del administrador: al terminar (bien o mal) se vuelve a leer todo, porque otra persona pudo decidir antes. */
export function usePaymentMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const invalidate = useInvalidatePayments();
  return useMutation({ mutationFn: fn, onSettled: () => void invalidate() });
}
