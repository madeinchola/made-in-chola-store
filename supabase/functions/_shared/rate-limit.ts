import { HttpError } from "./errors.ts";
import { serviceClient } from "./supabase.ts";

/** IP del cliente tal como la informa el proxy de Supabase; "unknown" si no hay (se limita igual, en bloque). */
export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

/** SHA-256 hex: las claves de rate limit nunca contienen el email/teléfono en claro. */
export async function hashKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export async function checkRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const { data, error } = await serviceClient().rpc("check_rate_limit", {
    p_key: key,
    p_max: max,
    p_window_seconds: windowSeconds,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: Boolean(row?.allowed),
    retryAfterSeconds: Number(row?.retry_after_seconds ?? 0),
  };
}

export async function resetRateLimit(key: string): Promise<void> {
  const { error } = await serviceClient().rpc("reset_rate_limit", { p_key: key });
  if (error) throw error;
}

/** Lanza 429 si se excede. Con `Retry-After` para que el cliente muestre cuánto esperar. */
export async function enforceRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<void> {
  const result = await checkRateLimit(key, max, windowSeconds);
  if (!result.allowed) {
    throw new HttpError(
      429,
      "rate_limited",
      "Demasiados intentos. Espera un momento e inténtalo de nuevo.",
      {
        "Retry-After": String(result.retryAfterSeconds),
      },
      { retry_after: result.retryAfterSeconds },
    );
  }
}
