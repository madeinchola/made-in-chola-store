import { HttpError } from "./errors.ts";
import { serviceClient } from "./supabase.ts";

/**
 * IP del cliente tal como la informa el proxy de Supabase; "unknown" si no hay (se limita igual, en bloque).
 * `cf-connecting-ip` va primero: lo fija el proxy y el cliente no puede falsearlo. El PRIMER valor de `x-forwarded-for`
 * sí lo puede escribir el cliente cuando el proxy añade en vez de reemplazar, y con eso cualquiera se saltaría los
 * límites por IP (login, carrito) cambiando esa cabecera en cada petición. Sin `cf-connecting-ip` (local, otros
 * proxies) se cae al comportamiento anterior.
 */
export function clientIp(req: Request): string {
  const raw =
    req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "";
  return raw ? normalizeIp(raw) : "unknown";
}

/**
 * Clave de red de una IP. IPv4 tal cual. IPv6 se agrupa por su prefijo /64: una persona recibe un /64 entero (2^64
 * direcciones) y, si cada dirección contara como una red distinta, cualquier límite por IP se saltaría con solo rotar
 * de dirección. `::ffff:1.2.3.4` (IPv4 dentro de IPv6) es la IPv4. Algo que no parece una IP se devuelve en minúsculas.
 */
export function normalizeIp(raw: string): string {
  const ip = raw.trim().toLowerCase().split("%")[0] ?? "";
  if (!ip.includes(":")) return ip;
  const mapped = /^(?:0{0,4}:){2,5}ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped?.[1]) return mapped[1];
  const halves = ip.split("::");
  if (halves.length > 2) return ip;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return ip;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return ip;
  return (
    groups
      .slice(0, 4)
      .map((g) => g.padStart(4, "0"))
      .join(":") + "::/64"
  );
}

/**
 * Huella de una red para guardarla en la base: HMAC-SHA256 con una clave SOLO del servidor. Sirve para comparar «¿misma
 * red?» sin guardar la IP, y sin la clave no se puede revertir ni probando las 4 mil millones de IPv4.
 */
export async function networkFingerprint(ip: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`net:${ip}`));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
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
