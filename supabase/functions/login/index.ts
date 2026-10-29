import { z } from "https://esm.sh/zod@3.25.76";
import { burnDecoyHash, INVALID_CREDENTIALS, statelessAnonClient } from "../_shared/auth.ts";
import { corsHeaders, getAllowedOrigins, handlePreflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, jsonResponse } from "../_shared/errors.ts";
import { classifyIdentifier } from "../_shared/identity.ts";
import { createLogger } from "../_shared/logger.ts";
import { clientIp, enforceRateLimit, hashKey, resetRateLimit } from "../_shared/rate-limit.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { parseBody } from "../_shared/validate.ts";

// Ventana de bloqueo progresivo: 5 intentos por identificador y 30 por IP cada 15 min.
const WINDOW_SECONDS = 15 * 60;
const MAX_PER_IDENTIFIER = 5;
const MAX_PER_IP = 30;

const bodySchema = z.object({
  identifier: z.string().min(1).max(254),
  password: z.string().min(1).max(1024),
});

const allowedOrigins = getAllowedOrigins();

/**
 * Login por email O teléfono (S-02). Todo ocurre en el servidor y la respuesta de fallo es SIEMPRE la
 * misma, de modo que no se puede enumerar qué cuentas existen ni qué email tiene un teléfono.
 */
Deno.serve(async (req) => {
  const log = createLogger();
  const cors = corsHeaders(req, allowedOrigins);
  const preflight = handlePreflight(req, allowedOrigins);
  if (preflight) return preflight;

  try {
    if (req.method !== "POST")
      throw new HttpError(405, "method_not_allowed", "Método no permitido");
    const { identifier, password } = await parseBody(req, bodySchema);

    const parsed = classifyIdentifier(identifier);
    // La clave se calcula también para identificadores inválidos (con el texto crudo): así el
    // bloqueo es idéntico exista o no la cuenta.
    const identKey = `login:id:${await hashKey(parsed.value ?? identifier.trim().toLowerCase())}`;
    await enforceRateLimit(`login:ip:${clientIp(req)}`, MAX_PER_IP, WINDOW_SECONDS);
    await enforceRateLimit(identKey, MAX_PER_IDENTIFIER, WINDOW_SECONDS);

    let authEmail: string | null = null;
    if (parsed.kind !== "invalid") {
      const { data, error } = await serviceClient().rpc("resolve_login_email", {
        p_kind: parsed.kind,
        p_value: parsed.value,
      });
      if (error) throw error;
      authEmail = (data as string | null) ?? null;
    }

    if (!authEmail) {
      await burnDecoyHash(password);
      throw new HttpError(
        INVALID_CREDENTIALS.status,
        INVALID_CREDENTIALS.code,
        INVALID_CREDENTIALS.message,
      );
    }

    const { data, error } = await statelessAnonClient().auth.signInWithPassword({
      email: authEmail,
      password,
    });
    if (error || !data.session) {
      throw new HttpError(
        INVALID_CREDENTIALS.status,
        INVALID_CREDENTIALS.code,
        INVALID_CREDENTIALS.message,
      );
    }

    await resetRateLimit(identKey);
    log.info("login ok", { userId: data.user.id });
    const { access_token, refresh_token, expires_in, expires_at } = data.session;
    return jsonResponse(
      { session: { access_token, refresh_token, expires_in, expires_at } },
      200,
      cors,
    );
  } catch (error) {
    if (!(error instanceof HttpError)) log.error("login falló", { error: String(error) });
    return errorResponse(error, log.correlationId, cors);
  }
});
