// Ejecuta un comando de pruebas que ENSUCIA la BD local (integración, E2E) y, pase lo que pase,
// restaura la BD (`supabase db reset`) y vuelve a sembrar los usuarios de desarrollo.
//   node scripts/with-clean-db.mjs <comando> [args…]
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function exitCodeOf(result) {
  return result.status ?? 1;
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) {
    process.stderr.write("Uso: node scripts/with-clean-db.mjs <comando> [args…]\n");
    process.exit(2);
  }
  const tests = spawnSync("npx", [cmd, ...args], { stdio: "inherit" });

  process.stdout.write("\n↺ Restaurando la BD local (db reset + dev:seed)…\n");
  const reset = spawnSync("npx", ["supabase", "db", "reset"], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (reset.status !== 0)
    process.stderr.write("⚠️  db reset falló: la BD local puede tener datos de prueba.\n");
  else spawnSync("node", ["scripts/dev-seed.mjs"], { stdio: ["ignore", "ignore", "inherit"] });

  process.exit(exitCodeOf(tests));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
