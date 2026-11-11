import { corsHeaders, getAllowedOrigins } from "../_shared/cors.ts";
import { errorResponse, HttpError, jsonResponse } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";
import { defaultRegistry } from "../_shared/payments/registry.ts";
import { SIGNATURE_HEADER, WEBHOOK_MAX_BYTES } from "../_shared/payments/webhook.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { readLimitedText } from "../_shared/validate.ts";

const registry = defaultRegistry();
const allowedOrigins = getAllowedOrigins();

/** El secreto de cada proveedor vive SOLO en los secretos de Supabase: PAYMENT_WEBHOOK_SECRET_<PROVEEDOR>. */
function secretFor(provider: string): string | null {
  const value = Deno.env.get(`PAYMENT_WEBHOOK_SECRET_${provider.toUpperCase()}`);
  return value && value.length >= 16 ? value : null;
}

/**
 * Aviso de pago de un proveedor (S11): `POST /functions/v1/payment-webhook/<proveedor>`. No usa JWT (el que llama es un
 * servidor externo): lo que autentica es la FIRMA. Todo aviso con firma inválida se rechaza y queda registrado; uno válido se
 * aplica de forma idempotente por (proveedor, event_id) en la base, así que un reintento o una repetición no hacen nada de más.
 */
Deno.serve(async (req) => {
  const log = createLogger();
  const cors = { ...corsHeaders(req, allowedOrigins), "Cache-Control": "no-store" };
  try {
    if (req.method !== "POST")
      throw new HttpError(405, "method_not_allowed", "Método no permitido");
    const provider = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
    await enforceRateLimit(`payment-webhook:ip:${clientIp(req)}`, 120, 60);

    const adapter = /^[a-z][a-z0-9_]{1,31}$/.test(provider) ? registry.get(provider) : null;
    if (!adapter || !adapter.parseWebhook) {
      // Un proveedor que no avisa por webhook (o no existe) no recibe avisos.
      throw new HttpError(404, "unknown_provider", "Proveedor desconocido");
    }

    const body = await readLimitedText(req, WEBHOOK_MAX_BYTES);
    const headers: Record<string, string> = {};
    const signature = req.headers.get(SIGNATURE_HEADER);
    if (signature) headers[SIGNATURE_HEADER] = signature;

    const service = serviceClient();
    const parsed = await adapter.parseWebhook(
      { headers, body },
      { secret: secretFor(provider), nowSeconds: Math.floor(Date.now() / 1000) },
    );
    if (!parsed.ok) {
      // Se registra el MOTIVO y el tamaño, nunca el cuerpo de un aviso que no se pudo autenticar.
      const { error } = await service.rpc("payment_log_invalid_event", {
        p_provider: provider,
        p_reason: parsed.reason,
        p_payload: { bytes: body.length, has_signature: Boolean(signature) },
      });
      if (error) log.warn("no se pudo registrar el aviso rechazado", { error: error.message });
      log.warn("aviso de pago rechazado", { provider, reason: parsed.reason });
      return jsonResponse(
        { ok: false, error: { code: "rejected", message: "Aviso rechazado" } },
        parsed.status,
        cors,
      );
    }

    const { event } = parsed;
    const { data, error } = await service.rpc("payment_apply_event", {
      p_provider: provider,
      p_event_id: event.eventId,
      p_type: event.type,
      p_reference: event.reference,
      p_amount: event.amount,
      p_currency: event.currency,
      p_external_id: event.externalId,
      p_payload: JSON.parse(body),
      p_actor: null,
    });
    if (error) {
      if (error.code === "22023")
        throw new HttpError(400, "invalid_event", "El aviso no es válido");
      // Cualquier otro fallo es nuestro: 500 para que el proveedor REINTENTE (el aviso no se pierde ni se duplica).
      throw error;
    }
    const outcome = (data as { outcome?: string }).outcome ?? null;
    log.info("payment-webhook", { provider, outcome });
    return jsonResponse({ ok: true, outcome }, 200, cors);
  } catch (error) {
    if (!(error instanceof HttpError)) log.error("payment-webhook falló", { error: String(error) });
    return errorResponse(error, log.correlationId, cors);
  }
});
