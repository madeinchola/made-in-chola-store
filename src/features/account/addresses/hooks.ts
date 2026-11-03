import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { COUNTRIES, DEFAULT_COUNTRY } from "@/lib/countries";
import {
  archiveAddress,
  createAddress,
  listActiveAddresses,
  listArchivedAddresses,
  listDeliveryCountries,
  restoreAddress,
  setDefaultAddress,
  updateAddress,
} from "./api";
import { addressKeys } from "./queryKeys";
import type { AddressInput, DeliveryCountry } from "./types";

/**
 * Tras cualquier cambio se recargan las DOS listas (activas y archivadas): archivar o restaurar mueve filas entre ellas, y
 * marcar la predeterminada o archivar la actual hace que la base cambie OTRA fila (otra pasa a ser la predeterminada).
 * Se devuelve la promesa para que la mutación no termine hasta tener la lista al día (quien espera `mutateAsync` ya ve
 * la pantalla actualizada y puede mover el foco con seguridad).
 */
export const invalidateAddresses = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: addressKeys.all });

/** Siempre fresca: otra pestaña o dispositivo pudo cambiarla. Sin `profileId` (sesión sin cargar) no consulta. */
export const useActiveAddresses = (profileId: string | undefined) =>
  useQuery({
    queryKey: addressKeys.active(profileId ?? ""),
    queryFn: () => listActiveAddresses(profileId as string),
    enabled: Boolean(profileId),
    staleTime: 0,
  });

export const useArchivedAddresses = (profileId: string | undefined) =>
  useQuery({
    queryKey: addressKeys.archived(profileId ?? ""),
    queryFn: () => listArchivedAddresses(profileId as string),
    enabled: Boolean(profileId),
    staleTime: 0,
  });

/** País de reserva si la vista no responde: la tienda opera en Bolivia, así que el formulario sigue siendo usable. */
const fallbackCountry = COUNTRIES.find((c) => c.code === DEFAULT_COUNTRY);
export const FALLBACK_COUNTRIES: DeliveryCountry[] = fallbackCountry
  ? [{ code: fallbackCountry.code, name: fallbackCountry.name }]
  : [];

/** Países habilitados. Cambian rara vez: caché larga, y con error se usa el país por defecto en vez de bloquear el formulario. */
export function useDeliveryCountries() {
  const query = useQuery({
    queryKey: addressKeys.countries(),
    queryFn: listDeliveryCountries,
    staleTime: 10 * 60_000,
  });
  const countries = query.data && query.data.length > 0 ? query.data : FALLBACK_COUNTRIES;
  return { countries, isLoading: query.isLoading, isError: query.isError };
}

function useAddressMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => invalidateAddresses(queryClient) });
}

const required = (profileId: string | undefined): string => {
  // La pantalla solo existe con sesión; si faltara, es un error de programación, no de la persona.
  if (!profileId) throw new Error("Sesión sin perfil: no se puede usar la libreta de direcciones");
  return profileId;
};

export const useCreateAddress = (profileId: string | undefined) =>
  useAddressMutation((input: AddressInput) => createAddress(required(profileId), input));

export const useUpdateAddress = (profileId: string | undefined) =>
  useAddressMutation((v: { id: string; input: AddressInput }) =>
    updateAddress(required(profileId), v.id, v.input),
  );

export const useArchiveAddress = (profileId: string | undefined) =>
  useAddressMutation((id: string) => archiveAddress(required(profileId), id));

export const useRestoreAddress = (profileId: string | undefined) =>
  useAddressMutation((id: string) => restoreAddress(required(profileId), id));

export const useSetDefaultAddress = (profileId: string | undefined) =>
  useAddressMutation((id: string) => setDefaultAddress(required(profileId), id));
