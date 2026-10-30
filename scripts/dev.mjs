// `npm run dev`: levanta Supabase local (si se puede) y luego Vite.
// Si Docker/Supabase CLI no están disponibles, avisa claramente y arranca solo el front.
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
const has = (cmd) => run("which", [cmd]).status === 0;

export function planDev({ hasDocker, dockerRunning, supabaseRunning }) {
  if (!hasDocker) return { startSupabase: false, warning: "Docker no está instalado" };
  if (!dockerRunning)
    return { startSupabase: false, warning: "Docker está instalado pero no está corriendo" };
  return { startSupabase: !supabaseRunning, warning: null };
}

export function isEntrypoint(metaUrl, argv1) {
  return Boolean(argv1) && metaUrl === pathToFileURL(argv1).href;
}

async function main() {
  const hasDocker = has("docker");
  const dockerRunning = hasDocker && run("docker", ["info"]).status === 0;
  const supabaseRunning = dockerRunning && run("npx", ["supabase", "status"]).status === 0;
  const plan = planDev({ hasDocker, dockerRunning, supabaseRunning });

  if (plan.warning) {
    process.stderr.write(
      `\n⚠️  ${plan.warning}: se inicia SOLO el frontend (sin Supabase local).\n\n`,
    );
  } else if (plan.startSupabase) {
    process.stdout.write("Iniciando Supabase local…\n");
    // Mismo script que el README (`db:start`): lleva las exclusiones que Colima necesita y usa el CLI fijado del repo.
    const started = run("npm", ["run", "--silent", "db:start"]);
    if (started.status !== 0) {
      process.stderr.write(
        `\n⚠️  supabase start falló:\n${started.stderr}\nSe inicia solo el frontend.\n\n`,
      );
    }
  }

  const vite = spawn("npx", ["vite", ...process.argv.slice(2)], { stdio: "inherit" });
  vite.on("exit", (code) => process.exit(code ?? 0));
}

// pathToFileURL codifica espacios/acentos igual que import.meta.url (la ruta del proyecto tiene espacios).
if (isEntrypoint(import.meta.url, process.argv[1])) await main();
