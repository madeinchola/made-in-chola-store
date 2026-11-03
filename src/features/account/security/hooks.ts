import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/useAuth";
import {
  changePassword,
  deactivateAccount,
  type ChangePasswordInput,
  type DeactivateAccountInput,
} from "./api";

/**
 * Cambio de contraseña. La mutación NUNCA rechaza: devuelve el `FunctionResult` (ok o fallo con código) para que el
 * formulario muestre cada error donde corresponde. El token es el de la sesión actual.
 */
export function useChangePassword() {
  const { session } = useAuth();
  const token = session?.access_token;
  return useMutation({ mutationFn: (input: ChangePasswordInput) => changePassword(input, token) });
}

/** Desactivar la cuenta (con o sin anonimizar). Igual que arriba: devuelve el resultado, no lanza. */
export function useDeactivateAccount() {
  const { session } = useAuth();
  const token = session?.access_token;
  return useMutation({
    mutationFn: (input: DeactivateAccountInput) => deactivateAccount(input, token),
  });
}
