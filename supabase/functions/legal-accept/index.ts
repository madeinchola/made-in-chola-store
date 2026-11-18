import { z } from "https://esm.sh/zod@3.25.76";
import { corsHeaders, getAllowedOrigins, handlePreflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, jsonResponse } from "../_shared/errors.ts";
import { assertLegalSubset, defaultLegalDeps, legalFields } from "../_shared/legal.ts";
import { createLogger } from "../_shared/logger.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";
import { requireUserId } from "../_shared/session.ts";
import { parseBodyLimited } from "../_shared/validate.ts";

const bodySchema = z.object({ ...legalFields }).strict();
const allowedOrigins = getAllowedOrigins();

/**
 * Aceptar de nuevo los textos legales (S15): al publicarse una versión nueva de los términos o la privacidad, quien ya tenía cuenta
 * debe aceptarla al entrar. Puede mandar solo las que le faltaban; cada versión tiene que ser EXACTAMENTE la vigente, y se registra con
 * la huella de su red.
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
    const userId = await requireUserId(req);
    await enforceRateLimit(`legal-accept:${userId}`, 20, 600);
    const body = await parseBodyLimited(req, bodySchema, 512);
    const legal = defaultLegalDeps();
    const versions = await assertLegalSubset(body, legal);
    if (Object.keys(versions).length > 0) {
      await legal.record({
        profileId: userId,
        orderId: null,
        context: "reaccept",
        versions,
        ip: clientIp(req),
      });
    }
    log.info("textos legales aceptados de nuevo", { userId });
    return jsonResponse({ ok: true, versions }, 200, cors);
  } catch (error) {
    if (!(error instanceof HttpError)) {
      log.error("legal-accept falló", { error: String(error) });
    }
    return errorResponse(error, log.correlationId, cors);
  }
});
