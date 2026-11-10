import { bearerToken, jwtClaims } from "../_shared/auth.ts";
import {
  type CartIdentity,
  type CartRequest,
  cartRequestSchema,
  generateCartToken,
  hashCartToken,
  isCartToken,
  isWrite,
  LIMITS,
  MAX_BODY_BYTES,
  planRpc,
} from "../_shared/cart.ts";
import { corsHeaders, getAllowedOrigins, handlePreflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, jsonResponse } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";
import { clientIp, enforceRateLimit, hashKey, networkFingerprint } from "../_shared/rate-limit.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import { parseBodyLimited } from "../_shared/validate.ts";

const allowedOrigins = getAllowedOrigins();

/** Usuario autenticado, o null si es un invitado. El navegador sin sesión manda la clave anónima: eso es un invitado. */
async function authenticatedUserId(req: Request): Promise<string | null> {
  const bearer = bearerToken(req);
  if (!bearer) return null;
  if (jwtClaims(bearer)?.role !== "authenticated") return null;
  const { data, error } = await userClient(req).auth.getUser();
  if (error || !data.user) {
    throw new HttpError(401, "invalid_session", "Tu sesión venció. Inicia sesión de nuevo.");
  }
  return data.user.id;
}

const EMPTY = () => ({ token_state: "none", cart: null, server_time: new Date().toISOString() });

/**
 * Carrito (S7). Es la ÚNICA puerta: las funciones SQL solo las ejecuta `service_role` (igual que `reserve_stock`), así
 * que aquí viven los topes de D-02 (tasa por IP y por identidad, carritos nuevos por IP, tamaño del cuerpo).
 *
 *  · Usuario: su carrito va por su id (el JWT se verifica con Auth). Invitado: por un token opaco que se genera AQUÍ,
 *    se entrega una sola vez y del que la base solo guarda el sha256. Sin token no hay carrito (nada que adivinar).
 *  · Las acciones fijan cantidades absolutas: un reintento o un doble clic no duplica nada.
 *  · `merge` pasa el carrito del invitado al usuario tras iniciar sesión (idempotente).
 */
Deno.serve(async (req) => {
  const log = createLogger();
  const cors = { ...corsHeaders(req, allowedOrigins), "Cache-Control": "no-store" };
  const preflight = handlePreflight(req, allowedOrigins);
  if (preflight) return preflight;

  try {
    if (req.method !== "POST")
      throw new HttpError(405, "method_not_allowed", "Método no permitido");
    const request: CartRequest = await parseBodyLimited(req, cartRequestSchema, MAX_BODY_BYTES);
    const ip = clientIp(req);
    await enforceRateLimit(`cart:ip:${ip}`, LIMITS.anyPerIp.max, LIMITS.anyPerIp.windowSeconds);

    if (request.cart_token !== undefined && !isCartToken(request.cart_token)) {
      throw new HttpError(400, "invalid_cart_token", "El identificador del carrito no es válido");
    }
    const userId = await authenticatedUserId(req);
    if (request.action === "merge" && !userId) {
      throw new HttpError(401, "login_required", "Inicia sesión para continuar");
    }

    let token: string | undefined = request.cart_token;
    let minted = false;
    const mintToken = async () => {
      await enforceRateLimit(
        `cart:new:${ip}`,
        LIMITS.newCartPerIp.max,
        LIMITS.newCartPerIp.windowSeconds,
      );
      token = generateCartToken();
      minted = true;
    };

    if (!userId) {
      if (!token) {
        // Un invitado sin token solo puede crear carrito agregando algo; para todo lo demás no hay nada.
        if (request.action !== "set_item" || request.qty === 0) {
          return jsonResponse(EMPTY(), 200, cors);
        }
        await mintToken();
      }
    }

    const identityKey = userId ?? (await hashKey(token ?? ""));
    if (isWrite(request)) {
      await enforceRateLimit(
        `cart:w:${identityKey}`,
        LIMITS.writePerIdentity.max,
        LIMITS.writePerIdentity.windowSeconds,
      );
      await enforceRateLimit(
        `cart:wip:${ip}`,
        LIMITS.writePerIp.max,
        LIMITS.writePerIp.windowSeconds,
      );
    }
    // Cada intento de cupón cuenta (acierte o no): sin esto se podrían probar códigos al azar sin límite.
    if (request.action === "set_coupon") {
      await enforceRateLimit(
        `cart:coupon:${identityKey}`,
        LIMITS.couponPerIdentity.max,
        LIMITS.couponPerIdentity.windowSeconds,
      );
      await enforceRateLimit(
        `cart:couponip:${ip}`,
        LIMITS.couponPerIp.max,
        LIMITS.couponPerIp.windowSeconds,
      );
    }
    if (request.action === "merge") {
      await enforceRateLimit(
        `cart:merge:${userId}`,
        LIMITS.mergePerUser.max,
        LIMITS.mergePerUser.windowSeconds,
      );
    }

    // Huella de la red del invitado (HMAC con una clave del servidor; la IP no se guarda). Solo la usa la base al estrenar
    // el carrito, para acotar cuántas unidades pueden retener juntos los carritos de una misma red.
    const ipHash =
      userId || ip === "unknown"
        ? null
        : await networkFingerprint(ip, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    const run = async (): Promise<Record<string, unknown>> => {
      const identity: CartIdentity = {
        userId,
        tokenHash: token ? await hashCartToken(token) : null,
        mayCreate: minted,
        ipHash,
      };
      const plan = planRpc(request, identity);
      const { data, error } = await serviceClient().rpc(plan.fn, plan.args);
      if (error) {
        if (error.code === "22023") {
          throw new HttpError(400, "invalid_request", "La petición no es válida");
        }
        throw error;
      }
      return data as Record<string, unknown>;
    };

    let result = await run();
    // El token de este navegador ya fue fusionado o abandonado: se le da uno nuevo y se repite la operación UNA vez.
    if (
      !userId &&
      request.action === "set_item" &&
      request.qty > 0 &&
      result.outcome === "token_retired"
    ) {
      await mintToken();
      result = await run();
    }

    if (isWrite(request)) {
      log.info("cart", { action: request.action, outcome: result.outcome ?? null, user: !!userId });
    }
    return jsonResponse(
      { ...result, ...(minted ? { cart_token: token, token_minted: true } : {}) },
      200,
      cors,
    );
  } catch (error) {
    if (!(error instanceof HttpError)) log.error("cart falló", { error: String(error) });
    return errorResponse(error, log.correlationId, cors);
  }
});
