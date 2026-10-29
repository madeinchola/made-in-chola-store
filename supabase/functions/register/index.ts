import { z } from "https://esm.sh/zod@3.25.76";
import { corsHeaders, getAllowedOrigins, handlePreflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, jsonResponse } from "../_shared/errors.ts";
import { normalizeEmail, normalizePhone, syntheticEmailFor } from "../_shared/identity.ts";
import { createLogger } from "../_shared/logger.ts";
import { validatePassword } from "../_shared/password-policy.ts";
import { checkPasswordPwned } from "../_shared/pwned.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { parseBody } from "../_shared/validate.ts";

const bodySchema = z.object({
  full_name: z.string().trim().min(1).max(120),
  email: z.string().max(254).optional(),
  phone: z.string().max(40).optional(),
  phone_country: z.string().length(2).optional(),
  password: z.string().max(1024),
});

const allowedOrigins = getAllowedOrigins();

/** Mensaje único cuando el identificador ya está en uso: no confirma explícitamente qué cuentas existen. */
const REGISTER_FAILED = new HttpError(
  409,
  "register_failed",
  "No pudimos crear la cuenta con esos datos. Si ya tienes una, inicia sesión o recupera tu contraseña.",
);

Deno.serve(async (req) => {
  const log = createLogger();
  const cors = corsHeaders(req, allowedOrigins);
  const preflight = handlePreflight(req, allowedOrigins);
  if (preflight) return preflight;

  try {
    if (req.method !== "POST")
      throw new HttpError(405, "method_not_allowed", "Método no permitido");
    await enforceRateLimit(`register:ip:${clientIp(req)}`, 5, 60 * 60);
    const body = await parseBody(req, bodySchema);

    const hasEmail = Boolean(body.email?.trim());
    const hasPhone = Boolean(body.phone?.trim());
    if (!hasEmail && !hasPhone) {
      throw new HttpError(400, "identifier_required", "Ingresa un email o un teléfono");
    }

    let email: string | null = null;
    if (hasEmail) {
      const r = normalizeEmail(body.email!);
      if (!r.ok) throw new HttpError(400, "invalid_email", "El email no es válido");
      email = r.email;
    }
    let phone: string | null = null;
    if (hasPhone) {
      const r = normalizePhone(body.phone!, body.phone_country ?? "BO");
      if (!r.ok) throw new HttpError(400, "invalid_phone", "El teléfono no es válido");
      phone = r.e164;
    }

    const policy = validatePassword(body.password, { email, phone });
    if (!policy.ok) {
      throw new HttpError(
        400,
        "weak_password",
        "La contraseña no cumple los requisitos",
        {},
        {
          failures: policy.failures,
        },
      );
    }
    // Filtraciones: si HIBP no responde NO se bloquea el alta (nunca dejar a alguien sin poder registrarse).
    const pwned = await checkPasswordPwned(body.password);
    if (pwned.pwned) {
      throw new HttpError(
        400,
        "pwned_password",
        "Esa contraseña apareció en filtraciones públicas. Elige otra.",
      );
    }

    const { data, error } = await serviceClient().auth.admin.createUser({
      email: email ?? syntheticEmailFor(phone!),
      password: body.password,
      email_confirm: true, // BR-ACC-03: sin verificación obligatoria
      user_metadata: { full_name: body.full_name, ...(phone ? { phone_e164: phone } : {}) },
    });
    if (error || !data.user) {
      // Email/teléfono duplicado (índice único en profiles o email ya existente en Auth) → mensaje uniforme.
      log.warn("register rechazado", { status: error?.status, code: error?.code });
      throw REGISTER_FAILED;
    }

    log.info("registro ok", { userId: data.user.id });
    return jsonResponse({ ok: true }, 201, cors);
  } catch (error) {
    if (!(error instanceof HttpError)) log.error("register falló", { error: String(error) });
    const headers = error instanceof HttpError ? error.headers : {};
    return errorResponse(error, log.correlationId, { ...cors, ...headers });
  }
});
