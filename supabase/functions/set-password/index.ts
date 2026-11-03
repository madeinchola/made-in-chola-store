import { z } from "https://esm.sh/zod@3.25.76";
import { corsHeaders, getAllowedOrigins, handlePreflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, jsonResponse } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";
import {
  bearerToken,
  isRecentRecoverySession,
  jwtClaims,
  renewSessionsAfterPasswordChange,
} from "../_shared/auth.ts";
import { assertPasswordAcceptable } from "../_shared/password-change.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import { parseBody } from "../_shared/validate.ts";

const bodySchema = z.object({ password: z.string().max(1024) });

const allowedOrigins = getAllowedOrigins();

/**
 * Cambio de contraseña con la MISMA política que el registro (longitud, comunes, filtraciones).
 * Lo usa la pantalla "restablecer contraseña" (con la sesión temporal del enlace de recuperación). El cambio desde
 * la cuenta pide además la contraseña actual y va por `change-password`. Requiere un JWT de usuario válido.
 */
Deno.serve(async (req) => {
  const log = createLogger();
  const cors = corsHeaders(req, allowedOrigins);
  const preflight = handlePreflight(req, allowedOrigins);
  if (preflight) return preflight;

  try {
    if (req.method !== "POST")
      throw new HttpError(405, "method_not_allowed", "Método no permitido");
    const { data: userData, error: userError } = await userClient(req).auth.getUser();
    const user = userData?.user;
    if (userError || !user) throw new HttpError(401, "unauthorized", "Sesión no válida");

    // Solo la sesión que nace del ENLACE DE RECUPERACIÓN (reciente) puede fijar una contraseña sin dar la actual. Con una
    // sesión normal se usa `change-password`, que la pide: así un token robado no basta para quedarse con la cuenta.
    const token = bearerToken(req);
    if (!token || !isRecentRecoverySession(jwtClaims(token)))
      throw new HttpError(
        403,
        "recovery_required",
        "Este enlace ya no sirve para cambiar la contraseña. Pide uno nuevo o usa «Cambiar contraseña» dentro de tu cuenta.",
      );

    await enforceRateLimit(`set-password:${user.id}`, 10, 15 * 60);
    const { password } = await parseBody(req, bodySchema);

    const { data: profile } = await serviceClient()
      .from("profiles")
      .select("email, phone_e164")
      .eq("id", user.id)
      .maybeSingle();
    await assertPasswordAcceptable(password, { email: profile?.email, phone: profile?.phone_e164 });

    const { error } = await serviceClient().auth.admin.updateUserById(user.id, { password });
    if (error) throw error;
    // Se cierran TODAS las sesiones y se entrega una nueva (la de recuperación ya no sirve tras el cambio).
    const session = await renewSessionsAfterPasswordChange(token, user.email ?? "", password);
    log.info("contraseña actualizada", { userId: user.id });
    return jsonResponse({ ok: true, session }, 200, cors);
  } catch (error) {
    if (!(error instanceof HttpError)) log.error("set-password falló", { error: String(error) });
    return errorResponse(error, log.correlationId, cors);
  }
});
