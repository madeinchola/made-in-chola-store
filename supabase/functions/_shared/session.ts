import { bearerToken, jwtClaims } from "./auth.ts";
import { HttpError } from "./errors.ts";
import { userClient } from "./supabase.ts";

/** Toda compra y todo pago requiere cuenta (BR-ACC-01): sin sesión válida no hay nada que hacer. Devuelve el id VERIFICADO con Auth. */
export async function requireUserId(req: Request): Promise<string> {
  const bearer = bearerToken(req);
  if (!bearer || jwtClaims(bearer)?.role !== "authenticated") {
    throw new HttpError(401, "login_required", "Inicia sesión para continuar");
  }
  const { data, error } = await userClient(req).auth.getUser();
  if (error || !data.user) {
    throw new HttpError(401, "invalid_session", "Tu sesión venció. Inicia sesión de nuevo.");
  }
  return data.user.id;
}
