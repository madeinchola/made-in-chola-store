import { z } from "https://esm.sh/zod@3.25.76";
import { INVALID_CREDENTIALS, verifyPassword } from "../_shared/auth.ts";
import { planContactChange } from "../_shared/contact.ts";
import { corsHeaders, getAllowedOrigins, handlePreflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, jsonResponse } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import { parseBody } from "../_shared/validate.ts";

const bodySchema = z.object({
  password: z.string().min(1).max(1024),
  // `undefined` = no tocar · `null` o "" = quitar (siempre que quede el otro) · texto = nuevo valor
  email: z.string().max(254).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  phone_country: z.string().length(2).optional(),
});

const allowedOrigins = getAllowedOrigins();

/** Mensaje ÚNICO si el contacto ya es de otra cuenta o no se pudo aplicar: no confirma qué cuentas existen. */
const CONTACT_FAILED = new HttpError(
  409,
  "contact_update_failed",
  "No pudimos actualizar ese dato de contacto. Revisa que sea tuyo y que no esté en uso en otra cuenta.",
);

/** Otro cambio de contacto se coló entre la lectura y la escritura (dos pestañas, dos dispositivos). */
const CONTACT_CONFLICT = new HttpError(
  409,
  "contact_update_conflict",
  "Tu contacto cambió mientras tanto. Recarga la página e inténtalo de nuevo.",
);

/** Auth no respondió o falló por algo que no es «ya está en uso»: no se afirma nada sobre el dato. */
const CONTACT_UNAVAILABLE = new HttpError(
  503,
  "contact_update_unavailable",
  "No pudimos actualizar tu contacto en este momento. Inténtalo de nuevo en unos minutos.",
);

/** El cambio falló Y no se pudo deshacer: perfil y Auth pueden haber quedado desalineados (queda registrado). */
const CONTACT_INCONSISTENT = new HttpError(
  500,
  "contact_update_inconsistent",
  "Algo salió mal al actualizar tu contacto. Si no puedes ingresar, escríbenos por WhatsApp y lo resolvemos.",
);

/** Errores de GoTrue que significan «ese dato ya es de otra cuenta» (lo único que se explica como tal). */
const AUTH_IN_USE = new Set([
  "email_exists",
  "phone_exists",
  "identity_already_exists",
  "user_already_exists",
]);

const MESSAGES = {
  nothing_to_change: "No hay nada que cambiar",
  invalid_email: "El email no es válido",
  invalid_phone: "El teléfono no es válido",
  identifier_required: "Tu cuenta necesita al menos un email o un teléfono",
} as const;

/**
 * BR-ACC-02/03: el cliente cambia su email y/o teléfono (con su contraseña como confirmación, sin verificación por
 * enlace ni SMS). El perfil se actualiza primero (los índices únicos deciden si el valor ya es de otra cuenta) y luego
 * el email de Auth; si ese segundo paso falla, el primero se deshace. El cambio queda auditado a nombre del cliente.
 *
 *  · Comparar y cambiar: la escritura solo se aplica si el perfil sigue como se LEYÓ; si otro cambio se coló, 409 y no
 *    se pisa nada. El deshacer también compara (solo deshace SU cambio) y SE COMPRUEBA: si falla, se registra con el
 *    identificador de correlación y se responde 500 en vez de fingir un 409 normal.
 *  · Límite de intentos: 5 cada 15 min y 10 al día por cliente, y NO se reinicia con un éxito: quien intercalara un valor
 *    libre entre cada sondeo podría, si no, probar emails ajenos sin tope (un 409 con un valor bien formado significa
 *    «ya está en uso»; es el costo de no verificar el contacto, BR-ACC-03, y por eso el ritmo está acotado).
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
    await enforceRateLimit(`update-contact:${user.id}`, 5, 15 * 60);
    await enforceRateLimit(`update-contact:day:${user.id}`, 10, 24 * 60 * 60);

    // Confirmación: la contraseña actual debe ser correcta (y la sesión que crea la comprobación se cierra al instante).
    if (!(await verifyPassword(user.email ?? "", body.password)))
      throw new HttpError(
        INVALID_CREDENTIALS.status,
        INVALID_CREDENTIALS.code,
        INVALID_CREDENTIALS.message,
      );

    const admin = serviceClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("email, phone_e164, is_active, anonymized_at")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || !profile.is_active || profile.anonymized_at)
      throw new HttpError(401, "unauthorized", "Sesión no válida");

    const plan = planContactChange(
      { email: profile.email, phone: profile.phone_e164, authEmail: user.email ?? "" },
      { email: body.email, phone: body.phone, phoneCountry: body.phone_country },
    );
    if (!plan.ok) throw new HttpError(400, plan.reason, MESSAGES[plan.reason]);
    if (!plan.changed) {
      return jsonResponse({ ok: true, changed: false }, 200, cors);
    }

    const { error: rpcError } = await admin.rpc("change_profile_contact", {
      p_id: user.id,
      p_email: plan.email,
      p_phone: plan.phone,
      p_expect: { email: profile.email, phone: profile.phone_e164 },
    });
    if (rpcError) {
      if (rpcError.code === "40001") throw CONTACT_CONFLICT;
      // 23505: ya es de otra cuenta · 23514: formato o cuenta sin identificador
      if (rpcError.code === "23505" || rpcError.code === "23514") throw CONTACT_FAILED;
      throw rpcError;
    }

    if (plan.authEmailChanged) {
      const { error: authError } = await admin.auth.admin.updateUserById(user.id, {
        email: plan.authEmail,
        email_confirm: true, // BR-ACC-03: sin verificación obligatoria
      });
      if (authError) {
        // Deshacer el paso 1 (solo lo que ESTA petición cambió) para no dejar el perfil y Auth desalineados.
        const { error: undoError } = await admin.rpc("change_profile_contact", {
          p_id: user.id,
          p_email: profile.email,
          p_phone: profile.phone_e164,
          p_expect: { email: plan.email, phone: plan.phone },
        });
        if (undoError) {
          log.error(
            "update-contact: Auth falló y NO se pudo deshacer el perfil: pueden estar desalineados",
            {
              userId: user.id,
              authCode: authError.code,
              undoCode: undoError.code,
            },
          );
          throw CONTACT_INCONSISTENT;
        }
        log.warn("update-contact: Auth rechazó el email, cambio deshecho", {
          code: authError.code,
        });
        // Solo «ya está en uso» se explica como tal; cualquier otro fallo (red, 5xx) no afirma nada sobre el dato.
        throw authError.code && AUTH_IN_USE.has(authError.code)
          ? CONTACT_FAILED
          : CONTACT_UNAVAILABLE;
      }
    }

    log.info("contacto actualizado", { userId: user.id });
    return jsonResponse({ ok: true, changed: true }, 200, cors);
  } catch (error) {
    if (!(error instanceof HttpError)) log.error("update-contact falló", { error: String(error) });
    return errorResponse(error, log.correlationId, cors);
  }
});
