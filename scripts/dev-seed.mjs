// Usuarios de DESARROLLO en Supabase LOCAL (se niega a correr contra cualquier otro entorno).
//   npm run dev:seed
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { seedImages } from "./dev-seed-images.mjs";

export const DEV_PASSWORD = "Chola-Dev-2026!";
export const DEV_USERS = [
  { full_name: "Admin Chola", email: "admin@madeinchola.test", admin: true },
  { full_name: "Cliente Demo", email: "cliente@madeinchola.test" },
  { full_name: "Cliente Teléfono", phone: "71111111" },
];

export function assertLocal(url) {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
    throw new Error(`dev:seed solo funciona contra Supabase local (recibido: ${url})`);
  }
}

async function main() {
  const out = execSync("npx supabase status -o env", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const get = (k) => new RegExp(`^${k}="?([^"\\n]+)"?$`, "m").exec(out)?.[1];
  const url = get("API_URL");
  const anon = get("ANON_KEY");
  const service = get("SERVICE_ROLE_KEY");
  assertLocal(url);

  const post = (path, body, key = anon) =>
    fetch(`${url}${path}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  // El registro tiene límite por IP: se limpia para que re-ejecutar el seed sea idempotente.
  await fetch(`${url}/rest/v1/rate_limits?key=like.*`, {
    method: "DELETE",
    headers: { apikey: service, Authorization: `Bearer ${service}` },
  });

  for (const u of DEV_USERS) {
    const res = await post("/functions/v1/register", {
      full_name: u.full_name,
      email: u.email,
      phone: u.phone,
      password: DEV_PASSWORD,
    });
    const state =
      res.status === 201
        ? "creado"
        : res.status === 409
          ? "ya existía"
          : `ERROR ${res.status} ${await res.text()}`;
    process.stdout.write(`  ${u.email ?? u.phone}: ${state}\n`);
    if (u.admin) {
      const p = await post("/rest/v1/rpc/promote_admin", { p_email: u.email }, service);
      process.stdout.write(
        `  ${u.email}: ${p.ok ? "rol admin" : `no se pudo promover (${p.status})`}\n`,
      );
    }
  }
  // Imágenes de ejemplo del catálogo (el catálogo en sí lo carga supabase/seed.sql en cada `db reset`).
  try {
    const n = await seedImages(url, service, (line) => process.stdout.write(`${line}\n`));
    process.stdout.write(
      n > 0 ? `  imágenes de ejemplo: ${n} subidas\n` : "  imágenes de ejemplo: ya existían\n",
    );
  } catch (e) {
    process.stderr.write(`  ⚠️ imágenes de ejemplo omitidas: ${e.message}\n`);
  }
  process.stdout.write(`\nContraseña de todos: ${DEV_PASSWORD}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  });
}
