#!/usr/bin/env node
// Copia de seguridad de la base de la nube con `pg_dump` (Sprint 16, docs/runbooks.md «Copias y restauración»).
//   npm run backup                       crea backups/made-in-chola-AAAAMMDD-HHMMSS.dump y la verifica con `pg_restore --list`
//   npm run backup -- --out <carpeta>    otra carpeta (por omisión, backups/ en el repositorio; git la ignora)
// Qué incluye: los esquemas public (datos del negocio), auth (cuentas) y storage (la lista de archivos; los archivos mismos NO: las
// imágenes, los QR y los comprobantes viven en Storage y se copian aparte). NO incluye el vault (los secretos se guardan en tu gestor
// de contraseñas, no en una copia). Contraseña de la base: SUPABASE_DB_PASSWORD en .env.e2e. Solo LEE la base.
// AVISO: esto NO sustituye a las copias del plan de Supabase (plan de pago): ensayar la restauración en un proyecto vacío sigue pendiente.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildCloudEnv } from "./cloud-env.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PG_BIN = process.env.PG_BIN ?? "/opt/homebrew/opt/libpq/bin";
export const SCHEMAS = ["public", "auth", "storage"];

/** AAAAMMDD-HHMMSS en hora local de quien corre el script. */
export function stamp(date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** Argumentos de pg_dump: formato personalizado (restaurable por partes), sin dueños ni privilegios (otro proyecto tiene otros roles). */
export function buildDumpArgs(file) {
  return [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--no-comments",
    ...SCHEMAS.flatMap((s) => ["--schema", s]),
    "--file",
    file,
  ];
}

/** Conexión por el pooler en modo sesión (el host directo de la base es solo IPv6). Nunca se imprime. */
export function connectionEnv(env) {
  const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(env.VITE_SUPABASE_URL ?? "")?.[1];
  if (!ref) throw new Error("VITE_SUPABASE_URL no tiene la forma https://<proyecto>.supabase.co");
  if (!env.SUPABASE_DB_PASSWORD) throw new Error("Falta SUPABASE_DB_PASSWORD (archivo .env.e2e).");
  return {
    PGHOST: env.SUPABASE_DB_HOST ?? "aws-0-us-east-2.pooler.supabase.com",
    PGPORT: "5432",
    PGUSER: `postgres.${ref}`,
    PGPASSWORD: env.SUPABASE_DB_PASSWORD,
    PGDATABASE: "postgres",
    PGSSLMODE: "require",
    PGCONNECT_TIMEOUT: "30",
  };
}

/** Resumen de `pg_restore --list`: cuántas tablas con datos y cuántos objetos trae la copia, y de qué esquemas. */
export function summarizeToc(toc) {
  const entries = toc.split("\n").filter((l) => /^\d+;\s/.test(l));
  const count = (kind) =>
    entries.filter((l) => new RegExp(`^\\d+;\\s+\\d+\\s+\\d+\\s+${kind}\\s`).test(l)).length;
  const schemas = new Set(
    entries.map((l) => /^\d+;\s+\d+\s+\d+\s+TABLE DATA\s+(\w+)\s/.exec(l)?.[1]).filter(Boolean),
  );
  return {
    entries: entries.length,
    tables: count("TABLE(?! DATA)"),
    dataSets: count("TABLE DATA"),
    functions: count("FUNCTION"),
    schemas: [...schemas].sort(),
  };
}

/** ¿La copia sirve? Debe traer los datos de los tres esquemas y las tablas clave. */
export function verifyToc(toc) {
  const s = summarizeToc(toc);
  const problems = [];
  for (const schema of SCHEMAS)
    if (!s.schemas.includes(schema)) problems.push(`no trae datos del esquema ${schema}`);
  for (const table of ["orders", "products", "profiles", "payments"]) {
    if (!new RegExp(`TABLE DATA\\s+public\\s+${table}\\s`).test(toc))
      problems.push(`falta la tabla public.${table}`);
  }
  return { ...s, problems };
}

export function parseArgs(argv, cwd = ROOT) {
  const i = argv.indexOf("--out");
  const dir = resolve(cwd, i >= 0 ? (argv[i + 1] ?? "") : "backups");
  if (i >= 0 && !argv[i + 1]) throw new Error("--out necesita una carpeta");
  return { dir };
}

function main() {
  const { dir } = parseArgs(process.argv.slice(2));
  const env = buildCloudEnv();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `made-in-chola-${stamp()}.dump`);
  if (existsSync(file)) throw new Error(`Ya existe ${file}`);
  console.log(`Copiando la base a ${file} …`);
  const dump = spawnSync(join(PG_BIN, "pg_dump"), buildDumpArgs(file), {
    env: { ...process.env, ...connectionEnv(env) },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (dump.status !== 0)
    throw new Error(`pg_dump falló: ${(dump.stderr || String(dump.error)).trim().slice(0, 600)}`);
  const list = spawnSync(join(PG_BIN, "pg_restore"), ["--list", file], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (list.status !== 0)
    throw new Error(`La copia no se pudo leer con pg_restore: ${list.stderr.trim().slice(0, 300)}`);
  const report = verifyToc(list.stdout);
  const mb = (statSync(file).size / 1048576).toFixed(1);
  console.log(
    `Copia lista: ${mb} MB, ${report.entries} objetos, ${report.dataSets} tablas con datos (${report.schemas.join(", ")}).`,
  );
  if (report.problems.length) {
    console.error(`LA COPIA NO SIRVE: ${report.problems.join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log(
      "Verificada con pg_restore --list. Falta ensayar la restauración en un proyecto vacío (docs/runbooks.md).",
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
