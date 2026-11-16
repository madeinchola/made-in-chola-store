import { corsHeaders, getAllowedOrigins, handlePreflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, jsonResponse } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";
import { buildPreview, type PreviewInput } from "../_shared/notifications/preview.ts";
import { NotifyError, isReservedAddress } from "../_shared/notifications/providers.ts";
import { loadSettings, providerFactory, resolveSiteUrl } from "../_shared/notifications/runtime.ts";
import { VARIABLE_CATALOG } from "../_shared/notifications/variables.ts";
import { effectiveEmailProvider } from "../_shared/notifications/worker.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { requireUserId } from "../_shared/session.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";

const allowedOrigins = getAllowedOrigins();

/**
 * Herramientas del editor de plantillas (S13), solo para administradores:
 *  - `preview`: renderiza una plantilla (guardada o en edición) con valores de ejemplo, igual que el worker.
 *  - `send_test`: la envía de verdad a UN correo permitido (el del propio administrador o uno de los destinatarios de alertas),
 *    con «[PRUEBA]» en el asunto. Así se ve el correo en un buzón real (Gmail, Outlook, Apple Mail) antes de activarlo.
 * No lee ni escribe pedidos ni clientas.
 */
Deno.serve(async (req) => {
  const log = createLogger();
  const cors = { ...corsHeaders(req, allowedOrigins), "Cache-Control": "no-store" };
  const preflight = handlePreflight(req, allowedOrigins);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST")
      throw new HttpError(405, "method_not_allowed", "Método no permitido");
    const userId = await requireUserId(req);
    const { data: isAdmin, error: adminError } = await userClient(req).rpc("is_admin");
    if (adminError || isAdmin !== true)
      throw new HttpError(403, "forbidden", "Solo administradores");

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object")
      throw new HttpError(400, "invalid_body", "Cuerpo inválido");
    const input = parseInput(body);
    const service = serviceClient();
    const settings = await loadSettings(service);
    const site = { siteUrl: resolveSiteUrl(), storeName: settings.storeName };
    const preview = buildPreview(input, site);

    if (body.action === "preview") {
      // Las variables que ESTA audiencia puede usar: el editor las ofrece (una sola fuente de verdad: el catálogo del servidor).
      const variables = VARIABLE_CATALOG.filter(
        (info) => info.audience === "both" || info.audience === input.audience,
      );
      return jsonResponse({ ok: true, preview, variables }, 200, cors);
    }

    if (body.action === "send_test") {
      if (input.channel !== "email")
        throw new HttpError(400, "channel_not_supported", "El envío de prueba es solo para correo");
      if (!preview.ok)
        throw new HttpError(
          400,
          "invalid_template",
          "La plantilla tiene errores",
          {},
          { errors: preview.errors, unknown: preview.unknown },
        );
      await enforceRateLimit(`notify-test:${userId}`, 10, 600);
      const provider = effectiveEmailProvider(settings, { emailProvider: providerFactory() });
      if (!provider)
        throw new HttpError(
          409,
          "provider_not_configured",
          "Aún no hay un proveedor de correo configurado",
        );

      const { data: self } = await service
        .from("profiles")
        .select("email")
        .eq("id", userId)
        .maybeSingle();
      const { data: recipients } = await service.rpc("alert_recipients");
      const allowed = new Set<string>([
        ...((recipients ?? []) as string[]),
        ...(self?.email ? [String(self.email).toLowerCase()] : []),
      ]);
      const to = (
        typeof body.to === "string" && body.to.trim() !== "" ? body.to : (self?.email ?? "")
      )
        .toString()
        .trim()
        .toLowerCase();
      if (to === "" || !allowed.has(to))
        throw new HttpError(
          400,
          "recipient_not_allowed",
          "Solo puedes enviarte la prueba a tu correo o al de un destinatario de alertas",
        );
      // Un proveedor real jamás entrega a un dominio reservado para pruebas.
      if (provider.name !== "fake" && isReservedAddress(to))
        return jsonResponse({ ok: true, sent: false, reason: "reserved_domain" }, 200, cors);
      try {
        const result = await provider.send({
          from: `${settings.fromName} <${settings.fromEmail || "pedidos@chola.test"}>`,
          to: [to],
          replyTo: settings.replyTo || undefined,
          subject: `[PRUEBA] ${preview.subject}`.slice(0, 200),
          html: preview.html ?? "",
          text: preview.text,
          idempotencyKey: `test-${crypto.randomUUID()}`,
        });
        log.info("notify-admin: prueba enviada", { provider: provider.name });
        return jsonResponse(
          { ok: true, sent: true, provider: provider.name, id: result.id },
          200,
          cors,
        );
      } catch (error) {
        if (error instanceof NotifyError)
          throw new HttpError(
            502,
            "provider_error",
            "El proveedor de correo no pudo enviar la prueba",
            {},
            { providerCode: error.code, transient: error.kind === "transient" },
          );
        throw error;
      }
    }
    throw new HttpError(400, "unknown_action", "Acción desconocida");
  } catch (error) {
    if (!(error instanceof HttpError)) log.error("notify-admin falló", { error: String(error) });
    return errorResponse(error, log.correlationId, cors);
  }
});

function parseInput(body: Record<string, unknown>): PreviewInput {
  const channel = body.channel;
  const audience = body.audience;
  if (channel !== "email" && channel !== "whatsapp")
    throw new HttpError(400, "invalid_channel", "Canal inválido");
  if (audience !== "customer" && audience !== "admin")
    throw new HttpError(400, "invalid_audience", "Audiencia inválida");
  const subject = typeof body.subject === "string" ? body.subject : "";
  const text = typeof body.body === "string" ? body.body : "";
  const cta =
    typeof body.cta_label === "string" && body.cta_label.trim() !== "" ? body.cta_label : null;
  // Tope generoso para no procesar basura enorme; los límites de verdad los informa la vista previa.
  if (subject.length > 1000 || text.length > 12000 || (cta?.length ?? 0) > 500)
    throw new HttpError(413, "too_large", "Texto demasiado largo");
  return { channel, audience, subject, body: text, cta_label: cta };
}
