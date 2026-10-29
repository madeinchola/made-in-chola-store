import { z } from "https://esm.sh/zod@3.25.76";
import { corsHeaders, getAllowedOrigins, handlePreflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, jsonResponse } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";
import { validatePassword } from "../_shared/password-policy.ts";
import { checkPasswordPwned } from "../_shared/pwned.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import { parseBody } from "../_shared/validate.ts";

const bodySchema = z.object({ password: z.string().max(1024) });

const allowedOrigins = getAllowedOrigins();

/**
 * Cambio de contraseña con la MISMA política que el registro (longitud, comunes, filtraciones).
 * Lo usa la pantalla "restablecer contraseña" (con la sesión temporal del enlace de recuperación)
 * y el cambio desde la cuenta. Requiere un JWT de usuario válido.
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

    await enforceRateLimit(`set-password:${user.id}`, 10, 15 * 60);
    const { password } = await parseBody(req, bodySchema);

    const { data: profile } = await serviceClient()
      .from("profiles")
      .select("email, phone_e164")
      .eq("id", user.id)
      .maybeSingle();
    const policy = validatePassword(password, {
      email: profile?.email,
      phone: profile?.phone_e164,
    });
    if (!policy.ok) {
      throw new HttpError(
        400,
        "weak_password",
        "La contraseña no cumple los requisitos",
        {},
        { failures: policy.failures },
      );
    }
    if ((await checkPasswordPwned(password)).pwned) {
      throw new HttpError(
        400,
        "pwned_password",
        "Esa contraseña apareció en filtraciones públicas. Elige otra.",
      );
    }

    const { error } = await serviceClient().auth.admin.updateUserById(user.id, { password });
    if (error) throw error;
    log.info("contraseña actualizada", { userId: user.id });
    return jsonResponse({ ok: true }, 200, cors);
  } catch (error) {
    if (!(error instanceof HttpError)) log.error("set-password falló", { error: String(error) });
    return errorResponse(error, log.correlationId, cors);
  }
});
