import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listAllTargets,
  listCoupons,
  listDiscounts,
  listDiscountUsage,
  listGroups,
  listMembers,
  listRedemptions,
  listTargets,
  searchProfiles,
} from "./api";
import { discountKeys } from "./queryKeys";

// El panel siempre lee fresco: lo que se edita aquí lo ve la tienda al pagar, y otra persona pudo haberlo cambiado.
const fresh = { staleTime: 0, gcTime: 0 } as const;

export const useDiscounts = () =>
  useQuery({ queryKey: discountKeys.list(), queryFn: listDiscounts, ...fresh });
export const useDiscountUsage = () =>
  useQuery({ queryKey: discountKeys.usage(), queryFn: listDiscountUsage, ...fresh });
export const useAllTargets = () =>
  useQuery({ queryKey: [...discountKeys.all, "targets-all"], queryFn: listAllTargets, ...fresh });
export const useTargets = (discountId: string) =>
  useQuery({
    queryKey: discountKeys.targets(discountId),
    queryFn: () => listTargets(discountId),
    ...fresh,
  });
export const useCoupons = (discountId: string) =>
  useQuery({
    queryKey: discountKeys.coupons(discountId),
    queryFn: () => listCoupons(discountId),
    ...fresh,
  });
export const useGroups = () =>
  useQuery({ queryKey: discountKeys.groups(), queryFn: listGroups, ...fresh });
export const useMembers = (groupId: string) =>
  useQuery({
    queryKey: discountKeys.members(groupId),
    queryFn: () => listMembers(groupId),
    ...fresh,
  });
export const useRedemptions = (discountId: string | null) =>
  useQuery({
    queryKey: discountKeys.redemptions(discountId),
    queryFn: () => listRedemptions(discountId),
    ...fresh,
  });
/** Búsqueda de clientas: solo con 2 o más letras; no se guarda en caché (son datos personales). */
export const useProfileSearch = (query: string) =>
  useQuery({
    queryKey: discountKeys.profiles(query),
    queryFn: () => searchProfiles(query),
    enabled: query.trim().length >= 2,
    ...fresh,
  });

/** Tras guardar algo de descuentos se refresca el panel (la bolsa de la tienda se vuelve a leer sola al abrirse). */
export function useInvalidateDiscounts() {
  const queryClient = useQueryClient();
  return async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: discountKeys.all });
  };
}

/** Envoltorio mínimo: ejecuta `fn` y, al terminar bien, refresca el panel de Descuentos. */
export function useDiscountMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const invalidate = useInvalidateDiscounts();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await invalidate();
    },
  });
}
