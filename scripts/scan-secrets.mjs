#!/usr/bin/env node
// Busca secretos en el repositorio: en los archivos actuales (por omisión) o en TODO el historial de git (--history).
//   node scripts/scan-secrets.mjs               archivos versionados y nuevos (los ignorados por git no se miran)
//   node scripts/scan-secrets.mjs --history     cada línea AÑADIDA en cualquier commit de cualquier rama
// Dos fuentes de hallazgos: (1) formas conocidas de claves (token de acceso de Supabase, clave secreta `sb_secret_`, JWT con
// rol de servicio, clave privada, token de Meta, de GitHub, de AWS, de Stripe, de Resend, URL de Postgres con contraseña) y
// (2) los VALORES reales de tus archivos .env* locales (los de este equipo), que son lo que más importa que no se suba.
// NUNCA imprime el valor: solo el tipo, el lugar y cuántos caracteres tiene. Sale con código 1 si encuentra algo.
// Una línea con `secret-scan: allow` se salta (para un valor de ejemplo que es falso a propósito).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ALLOW_MARK = "secret-scan: allow";

const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;
const SERVER_ROLES = new Set(["service_role", "supabase_admin"]);

/** Formas de clave. `check` (opcional) decide si lo encontrado es de verdad un secreto. */
export const PATTERNS = [
  { id: "supabase-token-de-acceso", re: /\bsbp_[A-Za-z0-9]{36,}\b/g },
  { id: "supabase-clave-secreta", re: /\bsb_secret_[A-Za-z0-9_-]{16,}/g },
  {
    id: "clave-privada",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  { id: "token-de-meta", re: /\bEAA[A-Za-z0-9]{60,}\b/g },
  { id: "token-de-github", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { id: "clave-de-aws", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "clave-de-stripe", re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
  { id: "clave-de-resend", re: /\bre_[A-Za-z0-9]{8}_[A-Za-z0-9]{20,}\b/g },
  {
    id: "url-de-postgres-con-contrasena",
    re: /\bpostgres(?:ql)?:\/\/[^\s:@/'"`]+:([^\s@/'"`]{6,})@[^\s/'"`]+/g,
    // «[YOUR-PASSWORD]», «${DB_PASSWORD}», «<contraseña>» o «REEMPLAZA…» son marcadores, no contraseñas
    check: (match) =>
      !/^[[<{$]|REEMPLAZA|PLACEHOLDER|YOUR|xxxx|\*{3,}|%s|%\{/i.test(match[1] ?? ""),
  },
];

/** Decodifica la carga de un JWT; null si no es JSON. */
function jwtPayload(segment) {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Hallazgos de UNA línea de texto: [{ id, length, hint }]. `knownValues` son valores reales a buscar tal cual.
 * Una clave `anon` (JWT con rol `anon`) es pública por diseño y no cuenta.
 */
export function scanLine(line, knownValues = []) {
  if (line.includes(ALLOW_MARK)) return [];
  const found = [];
  for (const { id, re, check } of PATTERNS) {
    for (const match of line.matchAll(re)) {
      if (check && !check(match)) continue;
      found.push({ id, length: match[0].length, hint: match[0].slice(0, 4) });
    }
  }
  for (const match of line.matchAll(JWT)) {
    const role = jwtPayload(match[1])?.role;
    if (typeof role === "string" && SERVER_ROLES.has(role)) {
      found.push({ id: "jwt-con-rol-de-servicio", length: match[0].length, hint: "eyJ…" });
    }
  }
  for (const { name, value } of knownValues) {
    if (line.includes(value))
      found.push({ id: `valor-de-${name}`, length: value.length, hint: "" });
  }
  return found;
}

/** Valores reales de los .env* de este equipo que NO son públicos por diseño. */
export function loadKnownValues(root = ROOT) {
  const out = [];
  for (const file of [".env", ".env.local", ".env.e2e", ".env.production", ".env.development"]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m || line.startsWith("#")) continue;
      const [, name, rest] = m;
      const value = (rest ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
      if (value.length < 12) continue; // un valor corto (true, local, un puerto) coincidiría con cualquier cosa
      if (/^https?:\/\//i.test(value)) continue; // direcciones: públicas
      if (/ANON|PUBLISHABLE/i.test(name ?? "")) continue; // la clave anónima va en el navegador por diseño
      if (
        /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) &&
        value.startsWith("eyJ")
      ) {
        if (!SERVER_ROLES.has(jwtPayload(value.split(".")[1] ?? "")?.role)) continue; // un JWT que no es de servicio
      }
      out.push({ name: name ?? "env", value });
    }
  }
  return out;
}

/**
 * Hallazgos del HISTORIAL que se sabe que son valores de ejemplo falsos (el historial no se reescribe). Cada entrada:
 * { commit, archivo, tipo, motivo }. `commit` es el prefijo del hash donde se añadió la línea.
 */
export function loadAllowlist(path = join(ROOT, "scripts", "secret-scan.allow.json")) {
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8")).historia ?? [];
}

/** ¿Está este hallazgo del historial en la lista de falsos conocidos? Hay que acertar commit, archivo y tipo. */
export function isAllowed(finding, allowlist) {
  return allowlist.some(
    (a) =>
      a.motivo &&
      finding.commit?.startsWith(a.commit) &&
      finding.file === a.archivo &&
      finding.id === a.tipo,
  );
}

const git = (args) =>
  spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

/** Archivos a mirar: versionados y nuevos no ignorados. */
export function filesToScan() {
  const list = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).stdout;
  return list.split("\0").filter(Boolean);
}

function scanTree(knownValues) {
  const findings = [];
  for (const rel of filesToScan()) {
    const abs = join(ROOT, rel);
    let size;
    try {
      size = statSync(abs).size;
    } catch {
      continue; // borrado y aún en el índice
    }
    if (size > MAX_FILE_BYTES) continue;
    const text = readFileSync(abs, "latin1"); // sin fallar con binarios; las claves son ASCII
    if (text.includes("\0")) continue;
    text.split("\n").forEach((line, i) => {
      for (const hit of scanLine(line, knownValues))
        findings.push({ ...hit, where: `${rel}:${i + 1}` });
    });
  }
  return findings;
}

function scanHistory(knownValues) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      ["log", "--all", "-p", "--no-color", "--unified=0", "--format=commit %H"],
      {
        cwd: ROOT,
      },
    );
    const findings = [];
    let commit = "";
    let file = "";
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (line.startsWith("commit ")) {
        commit = line.slice(7, 14);
      } else if (line.startsWith("+++ ")) {
        file = line.replace(/^\+\+\+ (?:b\/)?/, "");
      } else if (line.startsWith("+")) {
        for (const hit of scanLine(line.slice(1), knownValues)) {
          findings.push({ ...hit, commit, file, where: `${commit} ${file}` });
        }
      }
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(findings) : reject(new Error(`git log terminó con ${code}`)),
    );
  });
}

/** Una línea por hallazgo, sin repetir el mismo (tipo, lugar). Nunca incluye el valor. */
export function formatFindings(findings) {
  const seen = new Set();
  const lines = [];
  for (const f of findings) {
    const key = `${f.id}|${f.where}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(
      `  ${f.id}  ${f.where}  (${f.length} caracteres${f.hint ? `, empieza por «${f.hint}»` : ""})`,
    );
  }
  return lines;
}

async function main() {
  const history = process.argv.includes("--history");
  const knownValues = loadKnownValues();
  const allowlist = history ? loadAllowlist() : [];
  const findings = (history ? await scanHistory(knownValues) : scanTree(knownValues)).filter(
    (f) => !isAllowed(f, allowlist),
  );
  const lines = formatFindings(findings);
  const scope = history
    ? "todo el historial (todas las ramas)"
    : `${filesToScan().length} archivos`;
  if (lines.length === 0) {
    console.log(
      `Sin secretos en ${scope}. Valores de .env comparados: ${knownValues.length}.` +
        (allowlist.length ? ` Falsos conocidos del historial: ${allowlist.length}.` : ""),
    );
    return;
  }
  console.error(`SECRETOS ENCONTRADOS en ${scope}:\n${lines.join("\n")}`);
  console.error(
    "\nRevoca y rota cada clave de esta lista (aunque ya la hayas quitado: sigue en el historial de git y en cualquier copia).",
  );
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 2;
  });
}
