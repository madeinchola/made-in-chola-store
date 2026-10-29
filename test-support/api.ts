// Utilidades de prueba contra Supabase LOCAL (integración y E2E). Nunca apuntan a un entorno remoto.
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

export interface LocalEnv {
  url: string;
  anon: string;
  service: string;
}

let cached: LocalEnv | undefined;

export function localEnv(): LocalEnv {
  if (cached) return cached;
  const url = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
    throw new Error(
      `Las pruebas de integración solo corren contra Supabase LOCAL (recibido: ${url})`,
    );
  }
  let anon = process.env.VITE_SUPABASE_ANON_KEY;
  let service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!anon || !service || anon.startsWith("placeholder")) {
    const out = execSync("npx supabase status -o env", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const get = (k: string) => new RegExp(`^${k}="?([^"\\n]+)"?$`, "m").exec(out)?.[1];
    anon = get("ANON_KEY");
    service = get("SERVICE_ROLE_KEY");
  }
  if (!anon || !service)
    throw new Error("No se pudo obtener las claves locales: ¿corre `supabase start`?");
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
  const env = localEnv();
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

const service = () => ({ key: localEnv().service, token: localEnv().service });
export const svcRpc = (name: string, args: unknown) =>
  call("POST", `/rest/v1/rpc/${name}`, { body: args, ...service() });
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

export const STRONG_PASSWORD = "Chola-Cielo-2026!";

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

export async function mailpitMessagesTo(address: string): Promise<{ ID: string }[]> {
  const res = await fetch(
    `http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
  );
  return ((await res.json()) as { messages: { ID: string }[] }).messages ?? [];
}

export async function mailpitMessageText(id: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:54324/api/v1/message/${id}`);
  const m = (await res.json()) as { Text: string; HTML: string };
  return `${m.Text}\n${m.HTML}`;
}
