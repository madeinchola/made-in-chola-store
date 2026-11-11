import { corsHeaders, getAllowedOrigins, handlePreflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, jsonResponse } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";
import { defaultRegistry } from "../_shared/payments/registry.ts";
import { type ReconcilePayment, reconcilePayments } from "../_shared/payments/reconcile.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { requireUserId } from "../_shared/session.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";

const allowedOrigins = getAllowedOrigins();
const registry = defaultRegistry();

/**
 * Conciliación de pagos (BR-DAT-03): le pregunta al proveedor por los cobros abiertos que están por vencer o vencieron hace
 * poco y aplica lo que diga por el mismo camino idempotente que un webhook. Solo la ejecuta un ADMINISTRADOR (botón «Conciliar
 * ahora» del panel). Hoy ningún proveedor de producción tiene API de consulta, así que revisa y no cambia nada: la pieza está
 * lista y probada con un proveedor de pruebas para cuando exista uno.
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
    await enforceRateLimit(`payment-reconcile:${userId}`, 10, 600);

    const service = serviceClient();
    const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { data, error } = await service
      .from("payments")
      .select("id, provider, status, reference, amount, currency, order_id, method, orders(number)")
      .in("status", ["initiated", "pending"])
      .gte("expires_at", from)
      .lte("expires_at", to)
      .order("expires_at")
      .limit(200);
    if (error) throw error;

    const payments: ReconcilePayment[] = (data ?? []).map((row) => ({
      id: row.id as string,
      provider: row.provider as string,
      status: row.status as ReconcilePayment["status"],
      reference: row.reference as string,
      amount: Number(row.amount),
      currency: row.currency as string,
      order: {
        id: row.order_id as string,
        number: (row.orders as unknown as { number: string } | null)?.number ?? "",
        method: row.method as string,
      },
    }));
    const report = await reconcilePayments(payments, {
      registry,
      async apply(event) {
        const { data: result, error: rpcError } = await service.rpc("payment_apply_event", {
          p_provider: event.provider,
          p_event_id: event.eventId,
          p_type: event.type,
          p_reference: event.reference,
          p_amount: event.amount,
          p_currency: event.currency,
          p_external_id: null,
          p_payload: { source: "reconcile" },
          p_actor: null,
        });
        if (rpcError) throw rpcError;
        return result as { outcome?: string };
      },
    });
    log.info("payment-reconcile", { ...report });
    return jsonResponse({ ok: true, ...report }, 200, cors);
  } catch (error) {
    if (!(error instanceof HttpError))
      log.error("payment-reconcile falló", { error: String(error) });
    return errorResponse(error, log.correlationId, cors);
  }
});
