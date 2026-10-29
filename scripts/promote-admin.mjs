// Promueve una cuenta EXISTENTE a admin. Solo con la service key (nunca desde el navegador).
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run admin:promote -- correo@dominio.com
// Local: omite las variables y se leen de `supabase status`.
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function parseArgs(argv) {
  const email = argv.find((a) => !a.startsWith("--"))?.trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Uso: npm run admin:promote -- correo@dominio.com");
  }
  return { email: email.toLowerCase() };
}

function credentials() {
  let url = process.env.SUPABASE_URL;
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const out = execSync("npx supabase status -o env", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const get = (k) => new RegExp(`^${k}="?([^"\\n]+)"?$`, "m").exec(out)?.[1];
    url ??= get("API_URL");
    key ??= get("SERVICE_ROLE_KEY");
  }
  if (!url || !key) throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
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
