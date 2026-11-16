import { errorResponse, HttpError, jsonResponse } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";
import { createWorkerDeps } from "../_shared/notifications/runtime.ts";
import { runWorker } from "../_shared/notifications/worker.ts";
import { bearerToken } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";

/**
 * Worker de notificaciones (S13): toma un lote de `notification_outbox` (`FOR UPDATE SKIP LOCKED`, así que dos workers a la vez
 * nunca envían lo mismo), arma cada mensaje con su plantilla y lo entrega por el proveedor elegido en los ajustes.
 *
 * Lo despierta el cron `notify-worker` (pg_net, cada minuto, solo si hay algo vencido). SOLO acepta la clave de servicio: no es una
 * función para el navegador. Nunca toca pedidos ni pagos; si el proveedor cae, los avisos esperan y se reintentan con retroceso.
 */
Deno.serve(async (req) => {
  const log = createLogger();
  const headers = { "Cache-Control": "no-store" };
  try {
    if (req.method !== "POST")
      throw new HttpError(405, "method_not_allowed", "Método no permitido");
    // Comparación en tiempo constante contra la clave de servicio del entorno: ningún otro llamador (ni un administrador) entra.
    const token = bearerToken(req) ?? "";
    const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (expected === "" || !(await timingSafeEqual(token, expected)))
      throw new HttpError(403, "forbidden", "No autorizado");

    const body = (await req.json().catch(() => ({}))) as {
      ids?: unknown;
      limit?: unknown;
      worker?: unknown;
    };
    const ids =
      Array.isArray(body.ids) && body.ids.every((id) => Number.isInteger(id))
        ? (body.ids as number[])
        : null;
    const limit = Number.isInteger(body.limit)
      ? Math.min(Math.max(body.limit as number, 1), 25)
      : 10;
    const worker =
      typeof body.worker === "string" && body.worker.trim() !== ""
        ? body.worker.trim().slice(0, 60)
        : `edge-${log.correlationId.slice(0, 8)}`;

    const service = serviceClient();
    const deps = createWorkerDeps(service, log);
    const settings = await deps.settings();
    const report = await runWorker(deps, {
      limit,
      worker,
      ids,
      // Resend limita las peticiones por segundo: un envío real cada ~0,55 s.
      spacingMs: settings.emailProvider === "resend" ? 550 : 0,
      deadlineMs: 100_000,
    });
    log.info("notify-worker", { ...report });
    return jsonResponse({ ok: true, ...report }, 200, headers);
  } catch (error) {
    if (!(error instanceof HttpError)) log.error("notify-worker falló", { error: String(error) });
    return errorResponse(error, log.correlationId, headers);
  }
});

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const left = new Uint8Array(x);
  const right = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}
