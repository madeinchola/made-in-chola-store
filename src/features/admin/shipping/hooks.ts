import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shippingQuoteKeys } from "@/features/shipping/queryKeys";
import {
  listBlockedDates,
  listLocations,
  listMethods,
  listRates,
  listSlots,
  listZones,
} from "./api";
import { shippingKeys } from "./queryKeys";

// El panel siempre lee fresco: lo que se edita aquí lo ve la tienda al cotizar, y otra persona pudo haberlo cambiado.
const fresh = { staleTime: 0, gcTime: 0 } as const;

export const useLocations = () =>
  useQuery({ queryKey: shippingKeys.locations(), queryFn: listLocations, ...fresh });
export const useMethods = () =>
  useQuery({ queryKey: shippingKeys.methods(), queryFn: listMethods, ...fresh });
export const useZones = () =>
  useQuery({ queryKey: shippingKeys.zones(), queryFn: listZones, ...fresh });
export const useRates = () =>
  useQuery({ queryKey: shippingKeys.rates(), queryFn: listRates, ...fresh });
export const useSlots = () =>
  useQuery({ queryKey: shippingKeys.slots(), queryFn: listSlots, ...fresh });
export const useBlockedDates = () =>
  useQuery({ queryKey: shippingKeys.blockedDates(), queryFn: listBlockedDates, ...fresh });

/** Tras guardar algo de envíos se refresca el panel Y las cotizaciones de la tienda (cambian costos, zonas y franjas). */
export function useInvalidateShipping() {
  const queryClient = useQueryClient();
  return async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: shippingKeys.all }),
      queryClient.invalidateQueries({ queryKey: shippingQuoteKeys.all }),
    ]);
  };
}

/** Envoltorio mínimo: ejecuta `fn` y, al terminar bien, refresca el panel de Envíos y las cotizaciones. */
export function useShippingMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const invalidate = useInvalidateShipping();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await invalidate();
    },
  });
}
