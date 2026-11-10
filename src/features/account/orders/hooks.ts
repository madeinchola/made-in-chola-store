import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cancelOrder } from "@/features/checkout/checkoutApi";
import { getOrderById, getOrderByNumber, listOrders } from "./ordersApi";
import { toDetail, toSummary } from "./ordersMapping";

/** Claves de caché de los pedidos. Siempre llevan el id de la clienta: nunca se mezclan cuentas. */
export const orderKeys = {
  all: ["account", "orders"] as const,
  list: (profileId: string) => [...orderKeys.all, "list", profileId] as const,
  byId: (profileId: string, id: string) => [...orderKeys.all, "id", profileId, id] as const,
  byNumber: (profileId: string, number: string) =>
    [...orderKeys.all, "number", profileId, number] as const,
};

/** Siempre frescos: el admin cambia el estado (pagado, enviado…) sin que la clienta haga nada. */
export const useOrders = (profileId: string | undefined) =>
  useQuery({
    queryKey: orderKeys.list(profileId ?? ""),
    queryFn: async () => (await listOrders(profileId as string)).map(toSummary),
    enabled: Boolean(profileId),
    staleTime: 0,
  });

export const useOrderById = (profileId: string | undefined, id: string | undefined) =>
  useQuery({
    queryKey: orderKeys.byId(profileId ?? "", id ?? ""),
    queryFn: async () => {
      const row = await getOrderById(profileId as string, id as string);
      return row ? toDetail(row) : null;
    },
    enabled: Boolean(profileId && id),
    staleTime: 0,
  });

export const useOrderByNumber = (profileId: string | undefined, number: string | undefined) =>
  useQuery({
    queryKey: orderKeys.byNumber(profileId ?? "", number ?? ""),
    queryFn: () => getOrderByNumber(profileId as string, number as string),
    enabled: Boolean(profileId && number),
    staleTime: 0,
  });

export type CancelResult = "done" | "too_late" | "not_found" | "failed";

/** Cancela un pedido (solo antes de «preparing») y deja las listas al día. El servidor decide: aquí no se adivina el estado. */
export function useCancelOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      reason,
    }: {
      orderId: string;
      reason?: string;
    }): Promise<CancelResult> => {
      const result = await cancelOrder(orderId, reason);
      if (!result.ok) return "failed";
      if (result.data.ok) return "done";
      return result.data.outcome === "invalid_transition"
        ? "too_late"
        : result.data.outcome === "not_found"
          ? "not_found"
          : "failed";
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: orderKeys.all }),
  });
}
