import { bearerToken, jwtClaims } from "../_shared/auth.ts";
import { complaintSchema, receiveComplaint } from "../_shared/complaint.ts";
import { corsHeaders, getAllowedOrigins, handlePreflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, jsonResponse } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";
import { clientIp, enforceRateLimit, networkFingerprint } from "../_shared/rate-limit.ts";
import { requireUserId } from "../_shared/session.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { parseBodyLimited } from "../_shared/validate.ts";

const allowedOrigins = getAllowedOrigins();

/**
 * Registrar un reclamo (S15). Público: cualquiera puede reclamar, con o sin cuenta (si manda una sesión válida el reclamo queda ligado a su
 * cuenta). Límites por red, por cuenta y globales; campo trampa para robots; cuerpo de hasta 4 kB. A quien reclama NO se le escribe
 * automáticamente (el correo lo teclea cualquiera): ve su número en pantalla y los administradores reciben la alerta.
 */
Deno.serve(async (req) => {
  const log = createLogger();
  const cors = {
    ...corsHeaders(req, allowedOrigins),
    "Cache-Control": "no-store",
  };
  const preflight = handlePreflight(req, allowedOrigins);
  if (preflight) return preflight;

  try {
    if (req.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", "Método no permitido");
    }
    const body = await parseBodyLimited(req, complaintSchema, 4096);
    const ip = clientIp(req);
    const result = await receiveComplaint(body, {
      ip,
      limit: enforceRateLimit,
      userId: async () => {
        const bearer = bearerToken(req);
        // La clave anónima también viaja como «Bearer»: solo una sesión de persona cuenta como cuenta.
        if (!bearer || jwtClaims(bearer)?.role !== "authenticated") return null;
        try {
          return await requireUserId(req);
        } catch {
          return null; // sesión vencida: reclama como anónima
        }
      },
      fingerprint: () => networkFingerprint(ip, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""),
      submit: async (data, profileId, ipHash) => {
        const { data: saved, error } = await serviceClient().rpc("submit_complaint", {
          p_data: data,
          p_profile: profileId,
          p_ip_hash: ipHash,
        });
        if (error) {
          // `too_many` es el cortafuegos de la base; cualquier otra cosa es un dato que la base no aceptó o un fallo: sin detalles al exterior.
          if (String(error.message).includes("too_many")) {
            throw new HttpError(
              429,
              "rate_limited",
              "Hay demasiados reclamos ahora mismo. Inténtalo en un rato.",
            );
          }
          if (error.code === "23514" || error.code === "22023" || error.code === "23502") {
            throw new HttpError(400, "invalid_complaint", "Revisa los datos del reclamo");
          }
          throw error;
        }
        return saved as { number: string; due_at: string };
      },
    });
    log.info("reclamo recibido", { number: result.number });
    return jsonResponse({ ok: true, ...result }, 200, cors);
  } catch (error) {
    if (!(error instanceof HttpError)) {
      log.error("complaint falló", { error: String(error) });
    }
    return errorResponse(error, log.correlationId, cors);
  }
});
