import { getEnv } from "./env";

export type FunctionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      /** Segundos de espera cuando el servidor respondió 429. */
      retryAfter?: number;
      /** Reglas de contraseña incumplidas (weak_password). */
      failures?: string[];
    };

/** Llama a una Edge Function. Nunca lanza: red caída y respuestas raras se devuelven como `ok: false`. */
export async function callFunction<T = unknown>(
  name: string,
  body: unknown,
  options: { token?: string; fetchImpl?: typeof fetch } = {},
): Promise<FunctionResult<T>> {
  const env = getEnv();
  const doFetch = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.VITE_SUPABASE_ANON_KEY,
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, code: "network", message: "network" };
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* cuerpo vacío o no JSON */
  }
  if (res.ok) return { ok: true, data: json as T };

  const error = (
    json as {
      error?: { code?: string; message?: string; retry_after?: number; failures?: string[] };
    } | null
  )?.error;
  const headerRetry = Number(res.headers.get("retry-after"));
  const retryAfter =
    error?.retry_after ??
    (Number.isFinite(headerRetry) && headerRetry > 0 ? headerRetry : undefined);
  return {
    ok: false,
    status: res.status,
    code: error?.code ?? "unknown",
    message: error?.message ?? "unknown",
    ...(res.status === 429 ? { retryAfter: retryAfter ?? 60 } : {}),
    ...(error?.failures ? { failures: error.failures } : {}),
  };
}
