import { z } from "https://esm.sh/zod@3.25.76";
import {
  bearerToken,
  INVALID_CREDENTIALS,
  renewSessionsAfterPasswordChange,
  verifyPassword,
} from "../_shared/auth.ts";
import { corsHeaders, getAllowedOrigins, handlePreflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, jsonResponse } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";
import { assertPasswordAcceptable } from "../_shared/password-change.ts";
import { enforceRateLimit, resetRateLimit } from "../_shared/rate-limit.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import { parseBody } from "../_shared/validate.ts";

const bodySchema = z.object({
  current_password: z.string().min(1).max(1024),
  new_password: z.string().max(1024),
});

const allowedOrigins = getAllowedOrigins();

/**
 * Cambio de contraseña DESDE LA CUENTA: exige la contraseña actual (una sesión robada no basta) y aplica la misma
 * política que el registro (longitud, comunes, relación con el contacto, filtraciones). La recuperación por enlace usa
 * `set-password`, que no puede pedir la contraseña actual porque la persona la olvidó.
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

    const body = await parseBody(req, bodySchema);
    const key = `change-password:${user.id}`;
    await enforceRateLimit(key, 5, 15 * 60);

    if (!(await verifyPassword(user.email ?? "", body.current_password)))
      throw new HttpError(
        INVALID_CREDENTIALS.status,
        INVALID_CREDENTIALS.code,
        INVALID_CREDENTIALS.message,
      );

    if (body.new_password === body.current_password)
      throw new HttpError(
        400,
        "same_password",
        "La contraseña nueva debe ser distinta de la actual",
      );

    const admin = serviceClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("email, phone_e164, is_active")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.is_active) throw new HttpError(401, "unauthorized", "Sesión no válida");
    await assertPasswordAcceptable(body.new_password, {
      email: profile.email,
      phone: profile.phone_e164,
    });

    const { error } = await admin.auth.admin.updateUserById(user.id, {
      password: body.new_password,
    });
    if (error) throw error;
    // Quedan cerradas TODAS las sesiones (también una robada) y se entrega una nueva a quien cambió la contraseña.
    const session = await renewSessionsAfterPasswordChange(
      bearerToken(req),
      user.email ?? "",
      body.new_password,
    );
    await resetRateLimit(key);
    log.info("contraseña cambiada desde la cuenta", { userId: user.id });
    return jsonResponse({ ok: true, session }, 200, cors);
  } catch (error) {
    if (!(error instanceof HttpError)) log.error("change-password falló", { error: String(error) });
    return errorResponse(error, log.correlationId, cors);
  }
});
