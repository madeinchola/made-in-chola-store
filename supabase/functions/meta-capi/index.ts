import { corsHeaders, getAllowedOrigins, handlePreflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, jsonResponse } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";
import { requireUserId } from "../_shared/session.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { parseBodyLimited } from "../_shared/validate.ts";
import {
  capiBodySchema,
  type CapiDeps,
  type CapiOrder,
  GRAPH_VERSION_DEFAULT,
  sendPurchase,
} from "../_shared/meta-capi.ts";

const allowedOrigins = getAllowedOrigins();

/** Dependencias reales: el Pixel sale de los ajustes de la tienda, el pedido de la base (solo el de quien llama) y el token del entorno. */
function realDeps(userId: string): CapiDeps {
  return {
    pixelId: async () => {
      const { data, error } = await serviceClient()
        .from("store_settings")
        .select("value")
        .eq("key", "analytics_meta_pixel_id")
        .maybeSingle();
      if (error) throw error;
      const value = (data as { value?: unknown } | null)?.value;
      return typeof value === "string" ? value : "";
    },
    order: async (uid, number): Promise<CapiOrder | null> => {
      const { data, error } = await serviceClient()
        .from("orders")
        .select(
          "number, status, currency, total, profile_id, contact_email, contact_phone, created_at, order_items(product_id)",
        )
        .eq("number", number)
        .eq("profile_id", uid)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as Record<string, unknown>;
      return {
        number: String(row.number),
        status: String(row.status),
        currency: String(row.currency),
        total: Number(row.total),
        profileId: String(row.profile_id),
        contactEmail: typeof row.contact_email === "string" ? row.contact_email : null,
        contactPhone: String(row.contact_phone),
        createdAt: String(row.created_at),
        items: ((row.order_items as { product_id: string }[] | null) ?? []).map((i) => ({
          productId: i.product_id,
        })),
      };
    },
    // Una sola vez por pedido (7 días): el límite de frecuencia hace de candado.
    claim: async (orderNumber) => {
      try {
        await enforceRateLimit(`capi-order:${orderNumber}`, 1, 7 * 24 * 3600);
        return true;
      } catch (error) {
        if (error instanceof HttpError && error.status === 429) return false;
        throw error;
      }
    },
    fetch,
    token: Deno.env.get("META_CAPI_ACCESS_TOKEN") ?? "",
    ...(Deno.env.get("META_CAPI_TEST_EVENT_CODE")
      ? { testEventCode: Deno.env.get("META_CAPI_TEST_EVENT_CODE")! }
      : {}),
    graphVersion: Deno.env.get("META_GRAPH_VERSION") ?? GRAPH_VERSION_DEFAULT,
    now: () => Date.now(),
  };
}

/**
 * Avisa a Meta (desde el servidor) de un pedido recién creado. El navegador solo la llama si la persona aceptó las cookies de marketing.
 * Sin Pixel o sin token no hace nada. Mejor esfuerzo: la compra nunca depende de esto.
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
    await enforceRateLimit(`meta-capi:${userId}`, 30, 600);
    const body = await parseBodyLimited(req, capiBodySchema, 1024);
    const result = await sendPurchase(
      userId,
      body,
      { ip: clientIp(req), userAgent: req.headers.get("user-agent") ?? "" },
      realDeps(userId),
    );
    // Nada del token ni de los datos de la persona en el registro: solo el pedido y el resultado.
    log.info("API de conversiones", { order: body.order_number, ...result });
    return jsonResponse({ ok: true, ...result }, 200, cors);
  } catch (error) {
    if (!(error instanceof HttpError)) {
      log.error("meta-capi falló", { error: String(error) });
    }
    return errorResponse(error, log.correlationId, cors);
  }
});
