import { z } from "https://esm.sh/zod@3.25.76";
import type { ParsedWebhook, PaymentEvent, WebhookRequest } from "./types.ts";

/**
 * Verificación de avisos de pago firmados (S11). El contrato genérico que el proveedor real debe cumplir (o que un adaptador
 * traduce):
 *   cabecera  X-Signature: t=<segundos unix>,v1=<hex>[,v1=<hex>]   (varios v1 permiten rotar el secreto sin cortar el servicio)
 *   firma     HMAC-SHA256( secreto, `${t}.${cuerpo crudo}` ) en hexadecimal
 *   ventana   |ahora − t| ≤ 5 minutos (anti repetición; además el evento es único por (proveedor, event_id))
 * El secreto vive SOLO en los secretos de Supabase (`PAYMENT_WEBHOOK_SECRET_<PROVEEDOR>`), nunca en la base ni en el código.
 */
export const SIGNATURE_HEADER = "x-signature";
export const TOLERANCE_SECONDS = 300;
export const WEBHOOK_MAX_BYTES = 16 * 1024;

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparación en tiempo constante (no revela cuántos caracteres coinciden). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Arma la cabecera que enviaría el proveedor (para las pruebas y para quien integre el sistema). */
export async function signPayload(
  secret: string,
  body: string,
  nowSeconds: number,
): Promise<string> {
  return `t=${nowSeconds},v1=${await hmacHex(secret, `${nowSeconds}.${body}`)}`;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

export async function verifySignature(
  body: string,
  header: string | null | undefined,
  secret: string | null,
  nowSeconds: number,
  toleranceSeconds: number = TOLERANCE_SECONDS,
): Promise<SignatureCheck> {
  if (!header) return { ok: false, reason: "falta la firma" };
  let timestamp: number | null = null;
  const candidates: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name === "t" && /^[0-9]{1,12}$/.test(value)) timestamp = Number(value);
    if (name === "v1" && /^[0-9a-f]{64}$/.test(value)) candidates.push(value);
  }
  if (timestamp === null || candidates.length === 0)
    return { ok: false, reason: "firma mal formada" };
  // Sin secreto no hay nada que comparar: se rechaza igual que una firma mala (no se distingue desde fuera).
  if (!secret) return { ok: false, reason: "proveedor sin secreto configurado" };
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return { ok: false, reason: "firma fuera de la ventana de tiempo" };
  }
  const expected = await hmacHex(secret, `${timestamp}.${body}`);
  // Se comparan TODAS (sin cortar en la primera) para no filtrar cuál coincidió.
  let matched = false;
  for (const candidate of candidates) if (safeEqual(candidate, expected)) matched = true;
  return matched ? { ok: true } : { ok: false, reason: "firma inválida" };
}

const TYPE_MAP = {
  "payment.paid": "paid",
  "payment.failed": "failed",
  "payment.disputed": "disputed",
  "payment.refunded": "refunded",
} as const satisfies Record<string, PaymentEvent["type"]>;

/** El cuerpo del aviso genérico. Estricto y sin listas (decisión de S7 sobre el aviso de zod). */
export const genericEventSchema = z
  .object({
    event_id: z.string().min(1).max(200),
    type: z.enum(["payment.paid", "payment.failed", "payment.disputed", "payment.refunded"]),
    reference: z.string().min(1).max(64),
    amount: z.number().min(0).max(999_999_999).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    external_id: z.string().min(1).max(200).optional(),
  })
  .strict();

/** Verifica la firma y entiende un aviso en el formato genérico. Nunca lanza. */
export async function parseSignedGenericEvent(
  req: WebhookRequest,
  ctx: { secret: string | null; nowSeconds: number },
): Promise<ParsedWebhook> {
  const signature = await verifySignature(
    req.body,
    req.headers[SIGNATURE_HEADER],
    ctx.secret,
    ctx.nowSeconds,
  );
  if (!signature.ok) {
    return { ok: false, reason: signature.reason, status: ctx.secret ? 401 : 503 };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(req.body);
  } catch {
    return { ok: false, reason: "el cuerpo no es JSON", status: 400 };
  }
  const parsed = genericEventSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, reason: "el aviso no tiene el formato esperado", status: 400 };
  const data = parsed.data;
  // Un «pagado» sin monto no se puede conciliar: se rechaza en vez de adivinar.
  if (data.type === "payment.paid" && data.amount === undefined) {
    return { ok: false, reason: "un aviso de pago necesita el monto", status: 400 };
  }
  return {
    ok: true,
    event: {
      eventId: data.event_id,
      type: TYPE_MAP[data.type],
      reference: data.reference,
      amount: data.amount ?? null,
      currency: data.currency ?? null,
      externalId: data.external_id ?? null,
    },
  };
}
