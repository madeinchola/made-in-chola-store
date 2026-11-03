import { adoptSession, type IssuedSession } from "@/features/auth/adoptSession";
import { callFunction, type FunctionResult } from "@/lib/functions";
import { getSupabase } from "@/lib/supabase";

/**
 * Llamadas a las Edge Functions de seguridad de la cuenta. Todas piden la contraseña actual (una sesión robada no basta)
 * y devuelven el `FunctionResult` tal cual: `callFunction` nunca lanza, y cada pantalla decide en qué campo mostrar cada
 * código de error. Las contraseñas solo viajan en el cuerpo de la petición: no se guardan ni se registran.
 */

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/** `relogin`: el servidor no pudo entregar una sesión nueva; la antigua ya no sirve y hay que iniciar sesión otra vez. */
export type ChangePasswordResult = FunctionResult<{ ok: true; relogin: boolean }>;

/**
 * Cambiar la contraseña cierra TODAS las sesiones (también la actual): el servidor entrega una nueva y se adopta aquí. Si
 * no llegó o no se pudo adoptar, se cierra la sesión local (la vieja ya no sirve) y se avisa con `relogin`.
 */
export async function changePassword(
  input: ChangePasswordInput,
  token: string | undefined,
): Promise<ChangePasswordResult> {
  const result = await callFunction<{ ok: true; session?: IssuedSession | null }>(
    "change-password",
    { current_password: input.currentPassword, new_password: input.newPassword },
    { token },
  );
  if (!result.ok) return result;
  if (await adoptSession(result.data.session))
    return { ok: true, data: { ok: true, relogin: false } };
  await getSupabase().auth.signOut({ scope: "local" });
  return { ok: true, data: { ok: true, relogin: true } };
}

export interface DeactivateAccountInput {
  password: string;
  /** Reemplaza además los datos personales por valores anónimos (irreversible). */
  anonymize: boolean;
}

export function deactivateAccount(
  input: DeactivateAccountInput,
  token: string | undefined,
): Promise<FunctionResult<{ ok: true }>> {
  return callFunction(
    "deactivate-account",
    { password: input.password, anonymize: input.anonymize },
    { token },
  );
}
