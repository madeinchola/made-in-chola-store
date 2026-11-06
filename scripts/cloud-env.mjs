// Lanza un comando con las variables de la NUBE de Made In Chola, leídas de ARCHIVOS (nunca del chat ni impresas):
//   .env.local → VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (públicas)
//   .env.e2e   → SUPABASE_SERVICE_ROLE_KEY (secreta) y, para el SQL directo y pgTAP, SUPABASE_DB_PASSWORD (la contraseña de la base)
// Ambos los ignora git. Lo que ya esté en el entorno del proceso manda sobre los archivos.
//   node scripts/cloud-env.mjs <comando> [args…]      p. ej. `npm run e2e -- --grep "cambios mientras"`
// Solo hay un Supabase (el de la nube): se niega a seguir si la URL apunta a una máquina local.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ENV_FILES = [".env.local", ".env.e2e"];
/** Origen desde el que la función `cart` de la nube acepta peticiones del navegador (CORS). */
export const DEFAULTS = { E2E_HOST: "localhost", E2E_PORT: "5173" };

/** `KEY=valor` por línea; ignora vacías y comentarios; quita `export ` y comillas simples o dobles. Sin interpolación. */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (/^(["']).*\1$/.test(value) && value.length >= 2) value = value.slice(1, -1);
    out[m[1]] = value;
  }
  return out;
}

export function isLocalUrl(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(url ?? "");
}

/** Mezcla DEFAULTS < archivos (en orden) < entorno del proceso. No modifica `process.env`. */
export function buildCloudEnv({ root = ROOT, base = process.env } = {}) {
  const fromFiles = {};
  for (const name of ENV_FILES) {
    const path = join(root, name);
    if (existsSync(path)) Object.assign(fromFiles, parseEnvFile(readFileSync(path, "utf8")));
  }
  const env = { ...DEFAULTS, ...fromFiles, ...base };
  const url = env.VITE_SUPABASE_URL;
  if (!url) throw new Error("Falta VITE_SUPABASE_URL (archivo .env.local).");
  if (isLocalUrl(url)) {
    throw new Error("Solo existe el Supabase de la nube: VITE_SUPABASE_URL no puede ser local.");
  }
  return env;
}

/** Nombres (no valores) de las variables que faltan para lo que se vaya a hacer. */
export function missingVars(env, names) {
  return names.filter((n) => !env[n]);
}

export function exitCodeOf(result) {
  return result.status ?? 1;
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) {
    process.stderr.write("Uso: node scripts/cloud-env.mjs <comando> [args…]\n");
    process.exit(2);
  }
  let env;
  try {
    env = buildCloudEnv();
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(2);
  }
  const absent = missingVars(env, ["VITE_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
  if (absent.length > 0) {
    process.stderr.write(`Faltan en los archivos .env.local / .env.e2e: ${absent.join(", ")}\n`);
    process.exit(2);
  }
  const result = spawnSync("npx", [cmd, ...args], { stdio: "inherit", env });
  process.exit(exitCodeOf(result));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
