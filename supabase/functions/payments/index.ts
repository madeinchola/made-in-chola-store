import {
  checkProofFile,
  LIMITS,
  MAX_BODY_BYTES,
  parseProofPath,
  type PaymentsRequest,
  paymentsRequestSchema,
  userLimit,
} from "../_shared/payments-api.ts";
import { corsHeaders, getAllowedOrigins, handlePreflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, jsonResponse } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";
import { requireUserId } from "../_shared/session.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { parseBodyLimited } from "../_shared/validate.ts";

const allowedOrigins = getAllowedOrigins();
const BUCKET = "payment-proofs";

/**
 * Pagos de la clienta (S11). Dos acciones:
 *  · `retry`: nuevo cobro (misma orden, ventana nueva) para un pedido que sigue pendiente.
 *  · `proof_submit`: la clienta ya subió el archivo a su carpeta del bucket PRIVADO; aquí se revisa de verdad (tipo real por sus
 *    bytes, tamaño, huella sha256) y se registra para que el administrador lo vea. Un archivo que no pasa se BORRA.
 * La identidad es siempre la del JWT verificado; nunca viene en el cuerpo.
 */
Deno.serve(async (req) => {
  const log = createLogger();
  const cors = { ...corsHeaders(req, allowedOrigins), "Cache-Control": "no-store" };
  const preflight = handlePreflight(req, allowedOrigins);
  if (preflight) return preflight;

  try {
    if (req.method !== "POST")
      throw new HttpError(405, "method_not_allowed", "Método no permitido");
    const request: PaymentsRequest = await parseBodyLimited(
      req,
      paymentsRequestSchema,
      MAX_BODY_BYTES,
    );
    await enforceRateLimit(
      `payments:ip:${clientIp(req)}`,
      LIMITS.anyPerIp.max,
      LIMITS.anyPerIp.windowSeconds,
    );
    const userId = await requireUserId(req);
    const limit = userLimit(request.action);
    await enforceRateLimit(`payments:${limit.name}:${userId}`, limit.max, limit.windowSeconds);

    const service = serviceClient();

    if (request.action === "retry") {
      const { data, error } = await service.rpc("payment_retry", {
        p_profile_id: userId,
        p_order_id: request.order_id,
      });
      if (error) throw error;
      log.info("payments", {
        action: "retry",
        outcome: (data as { outcome?: string }).outcome ?? null,
      });
      return jsonResponse(data, 200, cors);
    }

    // ── proof_submit ──
    const parsed = parseProofPath(request.path, userId);
    // Una ruta que no es de su carpeta no se toca: ni se descarga ni se borra.
    if (!parsed) return jsonResponse({ ok: false, outcome: "not_found" }, 200, cors);

    // Solo se borra lo que NO quedó registrado como comprobante. Sin esta guarda, mandar la ruta de un comprobante ya registrado con
    // un `payment_id` ajeno o inventado (el registro responde «no existe») hacía que se borrara la evidencia de un pago, y la
    // ruta quedaba libre para subir OTRO contenido que ya no se comparaba con la huella guardada.
    const discard = async () => {
      const { data: registered, error: lookupError } = await service
        .from("payment_proofs")
        .select("id")
        .eq("file_path", request.path)
        .maybeSingle();
      if (lookupError) {
        // Ante la duda no se borra: un archivo huérfano está acotado y es privado; una evidencia perdida no se recupera.
        log.warn("no se pudo comprobar si el comprobante está registrado", {
          error: lookupError.message,
        });
        return;
      }
      if (registered) return;
      const { error } = await service.storage.from(BUCKET).remove([request.path]);
      if (error) log.warn("no se pudo borrar un comprobante inválido", { error: error.message });
    };

    const { data: blob, error: downloadError } = await service.storage
      .from(BUCKET)
      .download(request.path);
    if (downloadError || !blob) {
      return jsonResponse({ ok: false, outcome: "file_missing" }, 200, cors);
    }
    // Se lee con un tope: el bucket ya limita el tamaño, pero aquí no se confía.
    const bytes = new Uint8Array(await blob.slice(0, LIMITS_PROOF_READ).arrayBuffer());
    const verdict = await checkProofFile(bytes, parsed.ext);
    if (!verdict.ok || bytes.byteLength !== blob.size) {
      await discard();
      return jsonResponse(
        { ok: false, outcome: "invalid_file", reason: verdict.ok ? "too_large" : verdict.reason },
        200,
        cors,
      );
    }

    const { data, error } = await service.rpc("payment_proof_register", {
      p_profile_id: userId,
      p_payment_id: request.payment_id,
      p_path: request.path,
      p_hash: verdict.hash,
      p_mime: verdict.mime,
      p_size: verdict.size,
    });
    if (error) {
      if (error.code === "22023") {
        await discard();
        throw new HttpError(400, "invalid_request", "La petición no es válida");
      }
      throw error;
    }
    const result = data as { ok: boolean; outcome: string; file_path?: string; proof_id?: string };
    // Si no quedó registrado ESTE archivo (cobro cerrado, tope, ya hay uno en revisión, o es la misma imagen que otra ruta), no se guarda.
    if (!result.ok || (result.file_path && result.file_path !== request.path)) await discard();
    log.info("payments", { action: "proof_submit", outcome: result.outcome });
    return jsonResponse(
      { ok: result.ok, outcome: result.outcome, proof_id: result.proof_id ?? null },
      200,
      cors,
    );
  } catch (error) {
    if (!(error instanceof HttpError)) log.error("payments falló", { error: String(error) });
    return errorResponse(error, log.correlationId, cors);
  }
});

/** Cuántos bytes se leen como máximo de un comprobante: un byte más que el tope, para detectar que se pasó. */
const LIMITS_PROOF_READ = 5 * 1024 * 1024 + 1;
