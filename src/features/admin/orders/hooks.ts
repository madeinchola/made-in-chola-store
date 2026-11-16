import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  attentionOrders,
  attentionSummary,
  blacklistMatches,
  getHistory,
  getOrder,
  listBlacklist,
  listEdits,
  listIncidents,
  listNotes,
  listOrders,
  listPaymentMethodsLite,
  listPayments,
  listPendingRefunds,
  listProofs,
  listRefunds,
  listReturns,
  listShippingMethodsLite,
  searchCustomers,
  searchVariants,
  statusCounts,
} from "./api";
import { orderKeys } from "./queryKeys";
import type { OrderFilters } from "./types";

// El panel siempre lee fresco: otra persona pudo mover el pedido, o el banco pudo avisar, mientras tanto.
const fresh = { staleTime: 0, gcTime: 0 } as const;

export const useOrders = (filters: OrderFilters) =>
  useQuery({
    queryKey: orderKeys.list(filters),
    queryFn: () => listOrders(filters),
    placeholderData: keepPreviousData,
    ...fresh,
  });
export const useStatusCounts = () =>
  useQuery({ queryKey: orderKeys.counts(), queryFn: statusCounts, ...fresh });

export const useOrder = (id: string) =>
  useQuery({ queryKey: orderKeys.detail(id), queryFn: () => getOrder(id), ...fresh });
export const useHistory = (id: string) =>
  useQuery({ queryKey: orderKeys.history(id), queryFn: () => getHistory(id), ...fresh });
export const useOrderPayments = (id: string) =>
  useQuery({ queryKey: orderKeys.payments(id), queryFn: () => listPayments(id), ...fresh });
export const useOrderProofs = (id: string) =>
  useQuery({ queryKey: orderKeys.proofs(id), queryFn: () => listProofs(id), ...fresh });
export const useRefunds = (id: string) =>
  useQuery({ queryKey: orderKeys.refunds(id), queryFn: () => listRefunds(id), ...fresh });
export const usePendingRefunds = () =>
  useQuery({ queryKey: orderKeys.pendingRefunds(), queryFn: listPendingRefunds, ...fresh });
export const useReturns = (id: string) =>
  useQuery({ queryKey: orderKeys.returns(id), queryFn: () => listReturns(id), ...fresh });
export const useIncidents = (orderId?: string) =>
  useQuery({
    queryKey: orderKeys.incidents(orderId ?? "all"),
    queryFn: () => listIncidents(orderId),
    ...fresh,
  });
export const useNotes = (id: string) =>
  useQuery({ queryKey: orderKeys.notes(id), queryFn: () => listNotes(id), ...fresh });
export const useEdits = (id: string) =>
  useQuery({ queryKey: orderKeys.edits(id), queryFn: () => listEdits(id), ...fresh });
export const useBlacklist = () =>
  useQuery({ queryKey: orderKeys.blacklist(), queryFn: listBlacklist, ...fresh });
export const useBlacklistMatches = (orderId: string, enabled: boolean) =>
  useQuery({
    queryKey: orderKeys.matches(orderId),
    queryFn: () => blacklistMatches(orderId),
    enabled,
    ...fresh,
  });
export const useAttention = () =>
  useQuery({ queryKey: orderKeys.attention(), queryFn: attentionOrders, ...fresh });
export const useAttentionSummary = () =>
  useQuery({
    queryKey: orderKeys.attentionSummary(),
    queryFn: attentionSummary,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

export const useCustomerSearch = (term: string) =>
  useQuery({
    queryKey: orderKeys.customers(term),
    queryFn: () => searchCustomers(term),
    enabled: term.trim().length >= 2,
    staleTime: 30_000,
  });
export const useVariantSearch = (term: string) =>
  useQuery({
    queryKey: orderKeys.variants(term),
    queryFn: () => searchVariants(term),
    enabled: term.trim().length >= 2,
    staleTime: 30_000,
  });
export const usePaymentMethodsLite = () =>
  useQuery({
    queryKey: orderKeys.paymentMethods(),
    queryFn: listPaymentMethodsLite,
    staleTime: 5 * 60_000,
  });
export const useShippingMethodsLite = () =>
  useQuery({
    queryKey: orderKeys.shippingMethods(),
    queryFn: listShippingMethodsLite,
    staleTime: 5 * 60_000,
  });

export const useInvalidateOrders = () => {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: orderKeys.all });
};

/** Una acción del administrador: al terminar (bien o mal) se vuelve a leer todo, porque otra persona pudo actuar antes. */
export function useOrderMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const invalidate = useInvalidateOrders();
  return useMutation({ mutationFn: fn, onSettled: () => void invalidate() });
}
