import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { catalogKeys } from "@/features/catalog/queryKeys";
import {
  getCurrentRates,
  listBanners,
  listCountries,
  listCurrencies,
  listImpactCandidates,
  listRateHistory,
  listSettings,
} from "./api";
import { configKeys } from "./queryKeys";

// El panel siempre lee fresco: lo que se edita aquí lo ve la tienda, y otra persona puede haberlo cambiado.
export const useSettings = () =>
  useQuery({
    queryKey: configKeys.settings(),
    queryFn: listSettings,
    staleTime: 0,
    // El formulario copia los datos a su estado al montarse. Con caché retenida, volver a la pantalla mostraría valores y
    // versiones viejas (y editar daría un falso conflicto): sin caché, cada visita parte de lo que hay en la base.
    gcTime: 0,
  });

export const useBanners = () =>
  useQuery({ queryKey: configKeys.banners(), queryFn: listBanners, staleTime: 0 });

export const useCurrencies = () =>
  useQuery({ queryKey: configKeys.currencies(), queryFn: listCurrencies, staleTime: 0 });

export const useCountries = () =>
  useQuery({ queryKey: configKeys.countries(), queryFn: listCountries, staleTime: 30_000 });

export const useCurrentRates = (codes: readonly string[]) =>
  useQuery({
    queryKey: configKeys.currentRates(codes),
    queryFn: () => getCurrentRates(codes),
    enabled: codes.length > 0,
    staleTime: 0,
  });

export const useRateHistory = (page: number, pageSize: number) =>
  useQuery({
    queryKey: configKeys.rateHistory(page, pageSize),
    queryFn: () => listRateHistory(page, pageSize),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

export const useImpactCandidates = (currency: string | null) =>
  useQuery({
    queryKey: configKeys.impact(currency ?? ""),
    queryFn: () => listImpactCandidates(currency as string),
    enabled: currency !== null,
    staleTime: 30_000,
  });

/** Tras guardar algo de configuración se refresca el panel Y el catálogo público (banner, ajustes, precios convertidos). */
export function useInvalidateConfig() {
  const queryClient = useQueryClient();
  return async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: configKeys.all }),
      queryClient.invalidateQueries({ queryKey: catalogKeys.all }),
    ]);
  };
}

/** Envoltorio mínimo: ejecuta `fn`, y al terminar bien refresca configuración y catálogo. */
export function useConfigMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const invalidate = useInvalidateConfig();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidate() });
}
