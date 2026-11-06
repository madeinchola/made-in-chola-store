// Utilidades de prueba contra el Supabase de la NUBE de Made In Chola (integración y E2E). No existe un Supabase local.
// Las claves llegan por el entorno: `npm run e2e` y `npm run test:integration` cargan `.env.local` (públicas) y `.env.e2e`
// (secretas, git lo ignora) con `scripts/cloud-env.mjs`. El SQL directo (`dbSql`, `dbExec`) está en `./db`.
import { randomBytes } from "node:crypto";

export { dbExec, dbPsql, dbRunFile, dbSql } from "./db";

export interface TestEnv {
  url: string;
  anon: string;
  service: string;
}

let cached: TestEnv | undefined;

export function testEnv(): TestEnv {
  if (cached) return cached;
  const url = process.env.VITE_SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) {
    throw new Error(
      "Faltan VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY o SUPABASE_SERVICE_ROLE_KEY. Lanza las pruebas con " +
        "`npm run e2e` o `npm run test:integration`: cargan .env.local y .env.e2e.",
    );
  }
  if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(url)) {
    throw new Error(`Solo existe el Supabase de la nube: la URL no puede ser local (${url}).`);
  }
  cached = { url, anon, service };
  return cached;
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

async function call(
  method: string,
  path: string,
  opts: { body?: unknown; key?: string; token?: string; headers?: Record<string, string> } = {},
): Promise<ApiResponse> {
  const env = testEnv();
  const res = await fetch(`${env.url}${path}`, {
    method,
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      apikey: opts.key ?? env.anon,
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* no JSON */
  }
  return { status: res.status, body, headers: res.headers };
}

export const fn = (
  name: string,
  body: unknown,
  opts: { token?: string; headers?: Record<string, string> } = {},
) => call("POST", `/functions/v1/${name}`, { body, ...opts });
export const register = (body: Record<string, unknown>) => fn("register", body);
export const login = (identifier: string, password: string) =>
  fn("login", { identifier, password });
export const rest = (method: string, path: string, token?: string, body?: unknown) =>
  call(method, `/rest/v1/${path}`, { token, body, headers: { Prefer: "return=representation" } });
export const rpc = (name: string, args: unknown, token?: string) =>
  call("POST", `/rest/v1/rpc/${name}`, { body: args, token });
export const authApi = (
  method: string,
  path: string,
  opts: { body?: unknown; token?: string; anon?: boolean } = {},
) => call(method, `/auth/v1/${path}`, opts);

const service = () => ({ key: testEnv().service, token: testEnv().service });
export const svcRpc = (name: string, args: unknown) =>
  call("POST", `/rest/v1/rpc/${name}`, { body: args, ...service() });
/** Auth de administración (crear/borrar usuarios) con la clave de servicio. */
export const svcAuth = (method: string, path: string, body?: unknown) =>
  call(method, `/auth/v1/${path}`, { body, ...service() });

export const svcRest = (method: string, path: string, body?: unknown) =>
  call(method, `/rest/v1/${path}`, {
    body,
    ...service(),
    headers: { Prefer: "return=representation" },
  });

/** Los tests comparten IP: se vacían los contadores para que unos no bloqueen a otros. */
export const clearRateLimits = () => svcRest("DELETE", "rate_limits?key=like.*");

export const randomTag = () => randomBytes(4).toString("hex");
export const uniqueEmail = (prefix = "user") => `${prefix}.${randomTag()}@prueba.test`;
/** Celular boliviano válido y único: 7 + 7 dígitos aleatorios. */
export const uniquePhone = () =>
  `7${Math.floor(Math.random() * 1e7)
    .toString()
    .padStart(7, "0")}`;

/** Contraseña al azar que cumple la política (para cuentas de prueba en la base real: nunca una fija, el repo es público). */
export const randomPassword = () => `Zq-${randomBytes(12).toString("base64url")}-9!`;

/**
 * Contraseña válida de las cuentas de prueba: AL AZAR en cada ejecución (la misma dentro de un proceso, así que registrar y
 * volver a entrar con ella funciona). Antes era una constante, y el repo es público.
 */
export const STRONG_PASSWORD = randomPassword();

export function jwtSub(token: string): string {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()).sub as string;
}

export async function registerAndLogin(
  opts: { email?: string; phone?: string; name?: string; password?: string } = {},
) {
  const password = opts.password ?? STRONG_PASSWORD;
  const email = opts.email ?? (opts.phone ? undefined : uniqueEmail());
  const reg = await register({
    full_name: opts.name ?? "Persona Prueba",
    email,
    phone: opts.phone,
    password,
  });
  if (reg.status !== 201)
    throw new Error(`register falló: ${reg.status} ${JSON.stringify(reg.body)}`);
  const identifier = (email ?? opts.phone)!;
  const res = await login(identifier, password);
  if (res.status !== 200) throw new Error(`login falló: ${res.status} ${JSON.stringify(res.body)}`);
  const token = res.body.session.access_token as string;
  return {
    email,
    phone: opts.phone,
    password,
    identifier,
    token,
    refresh: res.body.session.refresh_token as string,
    id: jwtSub(token),
  };
}

/**
 * Enlace de recuperación de contraseña de esa cuenta, generado por la API de administración (no se manda ningún correo:
 * la nube no tiene una bandeja donde leerlos). Es el mismo enlace que llevaría el correo.
 */
export async function recoveryLink(email: string, redirectTo?: string): Promise<string> {
  const res = await svcAuth("POST", "admin/generate_link", {
    type: "recovery",
    email,
    ...(redirectTo ? { redirect_to: redirectTo } : {}),
  });
  if (res.status !== 200 || typeof res.body?.action_link !== "string") {
    throw new Error(`generate_link falló: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.action_link as string;
}

/** Sesión temporal del ENLACE DE RECUPERACIÓN de esa cuenta (access_token y refresh_token). */
export async function recoverySession(email: string): Promise<{ access: string; refresh: string }> {
  const verify = await fetch(await recoveryLink(email), { redirect: "manual" });
  const hash = new URLSearchParams((verify.headers.get("location") ?? "").split("#")[1]);
  return { access: hash.get("access_token")!, refresh: hash.get("refresh_token")! };
}

/** ¿Sirve todavía este refresh token? (GoTrue responde 200 con una sesión nueva o 4xx si fue revocado). */
export const refreshSession = (refresh_token: string) =>
  authApi("POST", "token?grant_type=refresh_token", { body: { refresh_token } });
