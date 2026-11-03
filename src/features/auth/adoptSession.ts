import { getSupabase } from "@/lib/supabase";

/** Sesión nueva que entrega el servidor tras cambiar o restablecer la contraseña. */
export interface IssuedSession {
  access_token: string;
  refresh_token: string;
}

/**
 * Cambiar la contraseña cierra TODAS las sesiones de la cuenta (también la actual: así una robada deja de valer). El
 * servidor entrega una sesión nueva y aquí se adopta para que la persona no quede fuera de su cuenta. Devuelve false si no
 * llegó una sesión utilizable o Supabase no la aceptó: entonces la persona debe iniciar sesión de nuevo.
 */
export async function adoptSession(session: IssuedSession | null | undefined): Promise<boolean> {
  if (!session || !session.access_token || !session.refresh_token) return false;
  const { error } = await getSupabase().auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  return !error;
}
