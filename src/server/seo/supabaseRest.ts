/**
 * Cliente mínimo de la API REST de Supabase para las funciones de borde (sin supabase-js: el borde carga solo lo
 * imprescindible). SOLO lee las vistas públicas con la clave anónima: ninguna llamada puede ver costos, archivados ni stock.
 */
export interface SeoEnv {
  SUPABASE_URL?: string | undefined;
  SUPABASE_ANON_KEY?: string | undefined;
  SITE_URL?: string | undefined;
}

export interface SeoDeps {
  env: SeoEnv;
  fetch: typeof fetch;
}

const TIMEOUT_MS = 5000;

export class SeoConfigError extends Error {}

/** `GET /rest/v1/<path>`; `path` ya trae los filtros (con los valores codificados). */
export async function rest<T>(deps: SeoDeps, path: string): Promise<T[]> {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = deps.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY)
    throw new SeoConfigError("Falta la configuración de Supabase.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await deps.fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/${path}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Supabase respondió ${response.status}`);
    const data: unknown = await response.json();
    return Array.isArray(data) ? (data as T[]) : [];
  } finally {
    clearTimeout(timer);
  }
}

/** `POST /rest/v1/rpc/<nombre>` con argumentos con nombre; devuelve el JSON tal cual (objeto o arreglo). */
export async function rpc<T>(
  deps: SeoDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = deps.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY)
    throw new SeoConfigError("Falta la configuración de Supabase.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await deps.fetch(
      `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/${encodeURIComponent(name)}`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new Error(`Supabase respondió ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** URL pública de un archivo del bucket de imágenes de producto. */
export function productImageUrl(supabaseUrl: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/product-images/${encoded}`;
}

/** Un slug válido: minúsculas, números y guiones sueltos. Todo lo demás se rechaza antes de tocar la base. */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isSlug = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.length <= 120 && SLUG.test(value);
