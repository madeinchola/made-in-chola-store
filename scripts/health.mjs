#!/usr/bin/env node
// Informe de salud del sistema (Sprint 16): llama a `public.system_health()` con la clave de servicio y lo imprime legible.
//   npm run health              sale con 1 si algo está en estado crítico
//   npm run health -- --strict  sale con 1 también si hay avisos
//   npm run health -- --json    imprime el JSON tal cual (para un monitor)
// Qué mira, qué significa cada estado y qué hacer: docs/runbooks.md. Solo LEE; no cambia nada.
import { pathToFileURL } from "node:url";
import { buildCloudEnv } from "./cloud-env.mjs";

const MARK = { ok: "✔", warn: "!", crit: "✘" };
const LABEL = { ok: "BIEN", warn: "AVISO", crit: "CRÍTICO" };
const ORDER = { crit: 0, warn: 1, ok: 2 };

/** Texto del informe: primero lo crítico, luego los avisos, luego lo que está bien. */
export function formatHealth(report) {
  const checks = [...(report.checks ?? [])].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || String(a.key).localeCompare(String(b.key)),
  );
  const lines = checks.map((c) => `${MARK[c.status] ?? "?"} ${c.key.padEnd(34)} ${c.detail}`);
  const count = (s) => checks.filter((c) => c.status === s).length;
  lines.push(
    "",
    `Estado general: ${LABEL[report.status] ?? report.status} — ${count("crit")} críticos, ${count("warn")} avisos, ${count("ok")} bien (${report.generated_at})`,
  );
  return lines.join("\n");
}

/** Código de salida: 1 si hay algo crítico (o, con `strict`, algún aviso); 0 si no. */
export function exitCodeFor(report, { strict = false } = {}) {
  if (report.status === "crit") return 1;
  return strict && report.status === "warn" ? 1 : 0;
}

export async function fetchHealth(env, fetchImpl = fetch) {
  const url = env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      "Faltan VITE_SUPABASE_URL (.env.local) y SUPABASE_SERVICE_ROLE_KEY (.env.e2e).",
    );
  const res = await fetchImpl(`${url}/rest/v1/rpc/system_health`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok)
    throw new Error(`system_health respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}

async function main() {
  const args = process.argv.slice(2);
  const report = await fetchHealth(buildCloudEnv());
  console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : formatHealth(report));
  process.exitCode = exitCodeFor(report, { strict: args.includes("--strict") });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
