// Promueve una cuenta EXISTENTE a admin en el Supabase de la nube. Solo con la service key (nunca desde el navegador).
//   npm run admin:promote -- correo@dominio.com
// La URL sale de .env.local (VITE_SUPABASE_URL) y la clave de .env.e2e (SUPABASE_SERVICE_ROLE_KEY); ambos los ignora git.
import { pathToFileURL } from "node:url";
import { buildCloudEnv } from "./cloud-env.mjs";

export function parseArgs(argv) {
  const email = argv.find((a) => !a.startsWith("--"))?.trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Uso: npm run admin:promote -- correo@dominio.com");
  }
  return { email: email.toLowerCase() };
}

function credentials() {
  const env = buildCloudEnv();
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Faltan VITE_SUPABASE_URL (.env.local) y SUPABASE_SERVICE_ROLE_KEY (.env.e2e)");
  }
  return { url, key };
}

async function main() {
  const { email } = parseArgs(process.argv.slice(2));
  const { url, key } = credentials();
  const res = await fetch(`${url}/rest/v1/rpc/promote_admin`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_email: email }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`No se pudo promover (${res.status}): ${detail}`);
  }
  process.stdout.write(`✅ ${email} ahora es admin\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  });
}
