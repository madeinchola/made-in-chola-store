// SQL directo contra la base de la NUBE de Made In Chola con `psql` (sin Docker). Solo para las pruebas.
// Lo necesitan las pruebas que simulan el paso del tiempo (vencer una reserva o la garantía de un precio: ni la clave de
// servicio puede escribir esas tablas), las que miran el esquema `auth`, y los pgTAP.
// Conexión: `SUPABASE_DB_URL` (cadena completa) o, más cómodo, `SUPABASE_DB_PASSWORD` (la contraseña tal cual, sin
// codificar) en `.env.e2e`; el host sale de `VITE_SUPABASE_URL`. La contraseña viaja en el ENTORNO de `psql` (PGPASSWORD),
// nunca en sus argumentos (se verían con `ps`).
import { spawn, spawnSync } from "node:child_process";

type Env = Record<string, string | undefined>;

/** Cadena de conexión: `SUPABASE_DB_URL`, o la derivada de `SUPABASE_DB_PASSWORD` + la referencia del proyecto. */
export function dbUrl(env: Env = process.env): string | null {
  if (env.SUPABASE_DB_URL) return env.SUPABASE_DB_URL;
  const password = env.SUPABASE_DB_PASSWORD;
  const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co(?:\/|$)/i.exec(
    env.VITE_SUPABASE_URL ?? "",
  )?.[1];
  if (!password || !ref) return null;
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
}

/** El texto EXACTO que se deja en `.env.e2e` para que la persona lo reemplace (una contraseña real nunca lo es). */
export const PASSWORD_PLACEHOLDER = "REEMPLAZA_CON_LA_CONTRASENA";

/** ¿Es la contraseña vacía, el texto de relleno exacto o algo envuelto en <…>? Una contraseña real que EMPIECE igual no cuenta. */
export const isPlaceholderPassword = (value: string | undefined) => {
  const v = (value ?? "").trim();
  return v === "" || v === PASSWORD_PLACEHOLDER || /^<[^>]*>$/.test(v);
};

/** Variables `PG*` para `psql` a partir de una cadena `postgresql://usuario:clave@host:puerto/base`. */
export function psqlEnv(url: string): Record<string, string> {
  const u = new URL(url);
  if (!/^postgres(ql)?:$/.test(u.protocol))
    throw new Error("SUPABASE_DB_URL no es una cadena de postgres");
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
    PGSSLMODE: "require",
    PGCONNECT_TIMEOUT: "20",
  };
}

const psqlBin = (env: Env = process.env) => env.PSQL_BIN ?? "/opt/homebrew/opt/libpq/bin/psql";

function connection(env: Env = process.env): Record<string, string> {
  const url = dbUrl(env);
  if (!url || isPlaceholderPassword(new URL(url).password)) {
    throw new Error(
      "Falta la contraseña de la base: pon SUPABASE_DB_PASSWORD=<contraseña> en .env.e2e " +
        "(Supabase → Project Settings → Database). Nunca por el chat.",
    );
  }
  return psqlEnv(url);
}

function run(args: string[], input?: string) {
  const result = spawnSync(psqlBin(), ["-X", "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...connection() },
    ...(input === undefined ? {} : { input }),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(
      `No se pudo ejecutar psql (${psqlBin()}): ${result.error.message}. Instálalo con \`brew install libpq\`.`,
    );
  }
  return result;
}

/** Consulta de SOLO LECTURA; devuelve el texto (valores separados por `|`, sin cabecera). */
export function dbSql(query: string): string {
  if (!/^\s*(select|with)\b/i.test(query)) throw new Error("dbSql solo admite consultas SELECT");
  const r = run(["-tA", "-q"], query);
  if (r.status !== 0) throw new Error(`psql falló: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

/** Sentencia de ESCRITURA (simular el paso del tiempo, limpiar el estado de un cupo…). */
export function dbExec(statement: string): void {
  const r = run(["-q"], statement);
  if (r.status !== 0) throw new Error(`psql falló: ${r.stderr.trim()}`);
}

/**
 * Ejecuta un archivo (un pgTAP) y devuelve su salida TAP; no lanza si el archivo falla: devuelve el estado. ASÍNCRONO a
 * propósito: un archivo tarda hasta 3 minutos y, con `spawnSync`, el proceso de Vitest no responde a su coordinador y
 * termina con «Timeout calling onTaskUpdate» aunque todo pase.
 */
export function dbRunFile(
  path: string,
): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // -tA: filas sin cabecera ni alineado = líneas TAP limpias (como las lee `pg_prove`).
    const child = spawn(psqlBin(), ["-X", "-v", "ON_ERROR_STOP=1", "-q", "-tA", "-f", path], {
      env: { ...process.env, ...connection() },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) =>
      reject(
        new Error(
          `No se pudo ejecutar psql (${psqlBin()}): ${error.message}. Instálalo con \`brew install libpq\`.`,
        ),
      ),
    );
    child.on("close", (code) => resolve({ status: code ?? 1, stdout, stderr }));
  });
}

/**
 * Una sesión de `psql` INDEPENDIENTE (conexión y transacción propias) y ASÍNCRONA: para las pruebas de concurrencia que
 * necesitan decenas de sesiones a la vez. Devuelve la salida; rechaza si `psql` sale con error.
 */
export function dbPsql(sql: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(psqlBin(), ["-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], {
      env: { ...process.env, ...connection() },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) =>
      reject(new Error(`No se pudo ejecutar psql (${psqlBin()}): ${error.message}`)),
    );
    child.on("close", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`psql salió con ${code}: ${stderr.trim() || stdout.trim()}`)),
    );
  });
}

/** Líneas de una salida TAP que son fallos o diagnósticos de fallo. */
export function tapFailures(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter(
      (line) =>
        /^not ok\b/.test(line) ||
        /^#\s+(Failed test|Looks like you|have:|want:|caught:|expected:|wanted:)/i.test(line),
    );
}

/** Resumen de una salida TAP: cuántas aserciones pasaron y cuántas fallaron. */
export function tapSummary(output: string): { ok: number; notOk: number; planned: number | null } {
  const lines = output.split(/\r?\n/);
  const plan = lines.map((l) => /^1\.\.(\d+)\s*$/.exec(l)?.[1]).find(Boolean);
  return {
    ok: lines.filter((l) => /^ok\b/.test(l)).length,
    notOk: lines.filter((l) => /^not ok\b/.test(l)).length,
    planned: plan ? Number(plan) : null,
  };
}
