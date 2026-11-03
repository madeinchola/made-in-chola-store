import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/useAuth";
import { AppError } from "@/lib/errors";
import { t } from "@/i18n";
import {
  changeContact,
  getProfilePreferences,
  listPublicCurrencies,
  updateProfile,
  type ContactChange,
  type ProfilePatch,
} from "./api";
import { profileKeys } from "./queryKeys";

const MINUTE = 60_000;

/** Preferencias de la persona en sesión (la sesión solo trae nombre, email, teléfono y rol). */
export function useProfilePreferences() {
  const { profile } = useAuth();
  const userId = profile?.id;
  return useQuery({
    queryKey: profileKeys.preferences(userId ?? ""),
    queryFn: () => getProfilePreferences(userId as string),
    enabled: Boolean(userId),
  });
}

/** Monedas habilitadas para elegir como preferida: cambian poco. */
export function usePublicCurrencies() {
  return useQuery({
    queryKey: profileKeys.currencies(),
    queryFn: listPublicCurrencies,
    staleTime: 5 * MINUTE,
  });
}

/**
 * Guarda nombre y/o preferencias. Al terminar deja el resultado en la caché (sin parpadeo del valor viejo) y refresca el
 * perfil de la sesión, que es de donde la cabecera y «Hola, …» leen el nombre.
 */
export function useUpdateProfile() {
  const { profile, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const userId = profile?.id;
  return useMutation({
    mutationFn: (patch: ProfilePatch) => {
      if (!userId) throw new AppError("unauthorized", t("acct.security.errors.session"));
      return updateProfile(userId, patch);
    },
    onSuccess: async (preferences) => {
      if (userId) queryClient.setQueryData(profileKeys.preferences(userId), preferences);
      await refreshProfile();
    },
  });
}

/**
 * Cambia (o agrega o quita) el email o el teléfono. NUNCA rechaza: devuelve el `FunctionResult` para que el diálogo
 * ponga cada error donde toca. Si se aplicó, refresca el perfil de la sesión.
 */
export function useChangeContact() {
  const { session, refreshProfile } = useAuth();
  const token = session?.access_token;
  return useMutation({
    mutationFn: (input: ContactChange) => changeContact(input, token),
    onSuccess: async (result) => {
      if (result.ok) await refreshProfile();
    },
  });
}
