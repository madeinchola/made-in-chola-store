import { bearerToken, jwtClaims } from "../_shared/auth.ts";
import {
  type CheckoutRequest,
  checkoutRequestSchema,
  LIMITS,
  MAX_BODY_BYTES,
  planRpc,
  userLimit,
} from "../_shared/checkout.ts";
import { corsHeaders, getAllowedOrigins, handlePreflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, jsonResponse } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";
import { completeCharge } from "../_shared/payments/charge.ts";
import { defaultRegistry } from "../_shared/payments/registry.ts";
import type { PaymentInstruction } from "../_shared/payments/types.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import { parseBodyLimited } from "../_shared/validate.ts";

const allowedOrigins = getAllowedOrigins();
const registry = defaultRegistry();

/** Toda compra requiere cuenta (BR-ACC-01): sin sesión válida no hay checkout. */
async function requireUserId(req: Request): Promise<string> {
  const bearer = bearerToken(req);
  if (!bearer || jwtClaims(bearer)?.role !== "authenticated") {
    throw new HttpError(401, "login_required", "Inicia sesión para continuar");
  }
  const { data, error } = await userClient(req).auth.getUser();
  if (error || !data.user) {
    throw new HttpError(401, "invalid_session", "Tu sesión venció. Inicia sesión de nuevo.");
  }
  return data.user.id;
}

async function readSetting(key: string): Promise<string | null> {
  const { data } = await serviceClient()
    .from("store_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  const value = (data as { value?: unknown } | null)?.value;
  return typeof value === "string" ? value : null;
}

/**
 * Checkout (S10). Es la ÚNICA puerta: las funciones SQL de pedidos solo las ejecuta `service_role`, así que aquí viven la
 * identidad (JWT verificado con Auth), los topes de tasa y el tamaño del cuerpo.
 *
 *  · `preview`: lo que la pantalla muestra (líneas, envío, descuentos, métodos de pago); no escribe nada.
 *  · `create`: crea el pedido de forma atómica e idempotente (la llave evita duplicados por doble clic o reintento de red) y,
 *    si se creó, pide al proveedor de pago la instrucción para completarlo (abrir WhatsApp, pagar al recibir…).
 *  · `cancel`: la clienta cancela su pedido mientras no esté en preparación.
 * El cliente nunca manda precios, descuentos ni líneas: todo se recalcula en el servidor.
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
    const request: CheckoutRequest = await parseBodyLimited(
      req,
      checkoutRequestSchema,
      MAX_BODY_BYTES,
    );
    const ip = clientIp(req);
    await enforceRateLimit(`checkout:ip:${ip}`, LIMITS.anyPerIp.max, LIMITS.anyPerIp.windowSeconds);

    const userId = await requireUserId(req);
    const limit = userLimit(request.action);
    await enforceRateLimit(`checkout:${limit.name}:${userId}`, limit.max, limit.windowSeconds);
    if (request.action === "create") {
      await enforceRateLimit(
        `checkout:createip:${ip}`,
        LIMITS.createPerIp.max,
        LIMITS.createPerIp.windowSeconds,
      );
    }

    const plan = planRpc(request, userId);
    const { data, error } = await serviceClient().rpc(plan.fn, plan.args);
    if (error) {
      // 22023 = entrada que la base no acepta (formato): es un error de petición, no del servidor.
      if (error.code === "22023") {
        throw new HttpError(400, "invalid_request", "La petición no es válida");
      }
      throw error;
    }
    const result = data as Record<string, unknown>;

    // Con el pedido creado (o recuperado por un reintento) se le pide al proveedor la instrucción de pago. Si el proveedor
    // falla o no está implementado el pedido YA existe: se avisa sin perderlo (la clienta lo ve en «Mis pedidos»).
    let instruction: PaymentInstruction | null = null;
    let paymentError: string | null = null;
    if (
      request.action === "create" &&
      (result.outcome === "created" || result.outcome === "existing")
    ) {
      const order = result.order as {
        id: string;
        number: string;
        total: number;
        currency: string;
        payment_method: string;
        payment_provider: string;
      };
      const charge = await completeCharge(
        registry,
        {
          id: order.id,
          number: order.number,
          total: order.total,
          currency: order.currency,
          method: order.payment_method,
          provider: order.payment_provider,
        },
        readSetting,
      );
      instruction = charge.instruction;
      paymentError = charge.problem;
      if (charge.problem) {
        log.error("no se pudo preparar el pago", {
          problem: charge.problem,
          provider: order.payment_provider,
          cause: charge.cause ?? null,
        });
      }
    }

    log.info("checkout", {
      action: request.action,
      outcome: result.outcome ?? null,
    });
    return jsonResponse(
      {
        ...result,
        ...(request.action === "create" && result.order
          ? { payment_instruction: instruction, payment_error: paymentError }
          : {}),
      },
      200,
      cors,
    );
  } catch (error) {
    if (!(error instanceof HttpError)) {
      log.error("checkout falló", { error: String(error) });
    }
    return errorResponse(error, log.correlationId, cors);
  }
});
