import { z } from "https://esm.sh/zod@3.25.76";
import { INVALID_CREDENTIALS, statelessAnonClient } from "../_shared/auth.ts";
import { corsHeaders, getAllowedOrigins, handlePreflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, jsonResponse } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";
import { enforceRateLimit, resetRateLimit } from "../_shared/rate-limit.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import { parseBody } from "../_shared/validate.ts";

const bodySchema = z.object({
  password: z.string().min(1).max(1024),
  anonymize: z.boolean().default(false),
});

const allowedOrigins = getAllowedOrigins();

/**
 * BR-ACC-07: el cliente desactiva SU cuenta (con su contraseña como confirmación). La fila de profiles
 * se conserva para pedidos/contabilidad; opcionalmente se anonimiza la PII. Se banea el usuario en Auth
 * para que no pueda renovar el token, y desde ya las políticas RLS (`is_active`) dejan de darle datos.
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

    const { password, anonymize } = await parseBody(req, bodySchema);
    const key = `deactivate:${user.id}`;
    await enforceRateLimit(key, 5, 15 * 60);

    // Confirmación: la contraseña actual debe ser correcta.
    const { error: pwError } = await statelessAnonClient().auth.signInWithPassword({
      email: user.email ?? "",
      password,
    });
    if (pwError)
      throw new HttpError(
        INVALID_CREDENTIALS.status,
        INVALID_CREDENTIALS.code,
        INVALID_CREDENTIALS.message,
      );

    const admin = serviceClient();
    const { error: rpcError } = await admin.rpc("deactivate_profile", {
      p_id: user.id,
      p_anonymize: anonymize,
    });
    if (rpcError) {
      if (rpcError.code === "P0001")
        throw new HttpError(409, "last_admin", "No se puede desactivar al último administrador");
      throw rpcError;
    }

    const authUpdate: Record<string, unknown> = { ban_duration: "876000h" }; // ~100 años
    if (anonymize) {
      authUpdate.email = `deleted-${user.id}@deleted.madeinchola.invalid`;
      authUpdate.user_metadata = {};
    }
    const { error: banError } = await admin.auth.admin.updateUserById(user.id, authUpdate);
    if (banError) throw banError;

    await resetRateLimit(key);
    log.info("cuenta desactivada", { userId: user.id, anonymize });
    return jsonResponse({ ok: true }, 200, cors);
  } catch (error) {
    if (!(error instanceof HttpError))
      log.error("deactivate-account falló", { error: String(error) });
    return errorResponse(error, log.correlationId, cors);
  }
});
