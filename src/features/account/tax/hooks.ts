import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/useAuth";
import { t } from "@/i18n";
import { AppError } from "@/lib/errors";
import {
  archiveTaxProfile,
  createTaxProfile,
  listTaxProfiles,
  restoreTaxProfile,
  setDefaultTaxProfile,
  updateTaxProfile,
} from "./api";
import { taxKeys } from "./queryKeys";
import type { TaxProfileInput } from "./types";

/** Datos fiscales de la persona en sesión. Siempre frescos: se editan desde varias pestañas o dispositivos. */
export function useTaxProfiles() {
  const { profile } = useAuth();
  const userId = profile?.id;
  return useQuery({
    queryKey: taxKeys.list(userId ?? ""),
    queryFn: () => listTaxProfiles(userId as string),
    enabled: Boolean(userId),
    staleTime: 0,
  });
}

/** Cualquier cambio (haya salido bien o mal) vuelve a leer la lista: otro dispositivo pudo cambiarla entretanto. */
function useTaxMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: taxKeys.all }),
  });
}

export function useCreateTaxProfile() {
  const { profile } = useAuth();
  const userId = profile?.id;
  return useTaxMutation((input: TaxProfileInput) => {
    if (!userId) throw new AppError("unauthorized", t("acct.security.errors.session"));
    return createTaxProfile(userId, input);
  });
}

export const useUpdateTaxProfile = () =>
  useTaxMutation((v: { id: string; input: TaxProfileInput }) => updateTaxProfile(v.id, v.input));

export const useArchiveTaxProfile = () => useTaxMutation((id: string) => archiveTaxProfile(id));

export const useRestoreTaxProfile = () => useTaxMutation((id: string) => restoreTaxProfile(id));

export const useSetDefaultTaxProfile = () =>
  useTaxMutation((id: string) => setDefaultTaxProfile(id));
