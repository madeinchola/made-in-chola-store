const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

/**
 * Orígenes permitidos: variable de entorno ALLOWED_ORIGINS (separada por comas) o, si no existe,
 * solo los de desarrollo local. En staging/producción SIEMPRE debe definirse (ver README).
 */
export function getAllowedOrigins(): string[] {
  const configured = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : DEV_ORIGINS;
}

const ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type";

/** CORS con lista blanca de orígenes (ALLOWED_ORIGINS="https://a.com,https://b.com"). Nunca `*` en producción. */
export function corsHeaders(req: Request, allowedOrigins: string[]): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = allowedOrigins.includes(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : (allowedOrigins[0] ?? ""),
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Expose-Headers": "Retry-After",
    Vary: "Origin",
  };
}

export function handlePreflight(req: Request, allowedOrigins: string[]): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(req, allowedOrigins) });
}
