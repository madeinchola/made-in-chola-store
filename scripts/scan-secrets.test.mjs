// Pruebas del escáner de secretos con textos SINTÉTICOS: los «secretos» se arman aquí con repeticiones y concatenaciones
// para que este archivo no contenga ninguno completo (y el escáner no se marque a sí mismo).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatFindings,
  isAllowed,
  loadAllowlist,
  loadKnownValues,
  scanLine,
} from "./scan-secrets.mjs";

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const jwt = (payload) => `eyJ${"h".repeat(12)}.${b64(payload)}.${"s".repeat(20)}`;
const ids = (line, known) => scanLine(line, known).map((f) => f.id);

describe("scanLine: formas de clave", () => {
  it("token de acceso de Supabase (sbp_ + 40)", () => {
    expect(ids(`token=${"sbp_" + "a1".repeat(20)}`)).toEqual(["supabase-token-de-acceso"]);
    expect(ids(`token=${"sbp_" + "a".repeat(35)}`)).toEqual([]); // 35 < 36: no es una clave
  });

  it("clave secreta de Supabase (sb_secret_ + 16 o más); el prefijo suelto de la librería no cuenta", () => {
    expect(ids("k=" + "sb_secret_" + "Ab3_".repeat(5))).toEqual(["supabase-clave-secreta"]);
    expect(ids("k=" + "sb_secret_" + "a".repeat(15))).toEqual([]);
    expect(ids('if (key.startsWith("sb_secret_")) throw new Error()')).toEqual([]);
  });

  it("JWT: solo cuenta el de rol de servicio; la clave anónima es pública por diseño", () => {
    expect(ids(`k=${jwt({ role: "service_role", iss: "supabase" })}`)).toEqual([
      "jwt-con-rol-de-servicio",
    ]);
    expect(ids(`k=${jwt({ role: "supabase_admin" })}`)).toEqual(["jwt-con-rol-de-servicio"]);
    expect(ids(`k=${jwt({ role: "anon" })}`)).toEqual([]);
    expect(ids(`k=${jwt({ sub: "123" })}`)).toEqual([]);
    expect(ids(`k=eyJ${"h".repeat(12)}.eyJ${"!".repeat(12)}.${"s".repeat(20)}`)).toEqual([]); // la carga no es JSON
  });

  it("clave privada, token de Meta, de GitHub, de AWS, de Stripe y de Resend", () => {
    expect(ids("-----BEGIN " + "PRIVATE KEY-----")).toEqual(["clave-privada"]);
    expect(ids("-----BEGIN " + "RSA PRIVATE KEY-----")).toEqual(["clave-privada"]);
    expect(ids("t=" + "EAA" + "B".repeat(60))).toEqual(["token-de-meta"]);
    expect(ids("t=" + "EAA" + "B".repeat(59))).toEqual([]);
    expect(ids("t=" + "ghp_" + "c".repeat(36))).toEqual(["token-de-github"]);
    expect(ids("t=" + "AKIA" + "D".repeat(16))).toEqual(["clave-de-aws"]);
    expect(ids("t=" + "sk_live_" + "e".repeat(24))).toEqual(["clave-de-stripe"]);
    expect(ids("t=" + "sk_test_" + "e".repeat(24))).toEqual(["clave-de-stripe"]);
    expect(ids("t=" + "re_" + "f".repeat(8) + "_" + "G".repeat(24))).toEqual(["clave-de-resend"]);
    expect(ids("function re_validate_checkout_request_payload() {}")).toEqual([]); // un identificador, no una clave
  });

  it("URL de Postgres con contraseña real sí; con marcadores de relleno no", () => {
    expect(
      ids("postgresql://postgres:" + "Zq9xK2mP7wLc" + "@db.ref.supabase.co:5432/postgres"),
    ).toEqual(["url-de-postgres-con-contrasena"]);
    for (const placeholder of [
      "[YOUR-PASSWORD]",
      "${DB_PASSWORD}",
      "<contraseña>",
      "REEMPLAZA_CON_LA_CONTRASENA",
      "xxxxxxxx",
    ]) {
      expect(
        ids(`postgresql://postgres:${placeholder}@db.ref.supabase.co:5432/postgres`),
        placeholder,
      ).toEqual([]);
    }
    expect(ids("postgresql://postgres@localhost:5432/postgres")).toEqual([]); // sin contraseña
  });

  it("la marca «secret-scan: allow» salta la línea entera", () => {
    const line = `k=${"sbp_" + "a1".repeat(20)} // secret-scan: allow (ejemplo falso)`;
    expect(scanLine(line)).toEqual([]);
  });

  it("varias claves en una línea dan un hallazgo cada una", () => {
    const line = `${"sbp_" + "a1".repeat(20)} ${"ghp_" + "c".repeat(36)}`;
    expect(ids(line)).toEqual(["supabase-token-de-acceso", "token-de-github"]);
  });
});

describe("scanLine: valores reales conocidos", () => {
  const known = [{ name: "SUPABASE_DB_PASSWORD", value: "Xy7-pAssw0rd-demo" }];

  it("encuentra el valor tal cual, esté donde esté, y dice de cuál variable viene", () => {
    expect(ids("const p = 'Xy7-pAssw0rd-demo';", known)).toEqual(["valor-de-SUPABASE_DB_PASSWORD"]);
    expect(ids("sin nada raro aquí", known)).toEqual([]);
  });

  it("no devuelve el valor en ningún campo del hallazgo", () => {
    const [hit] = scanLine("x Xy7-pAssw0rd-demo y", known);
    expect(JSON.stringify(hit)).not.toContain("Xy7-pAssw0rd-demo");
    expect(hit.length).toBe("Xy7-pAssw0rd-demo".length);
  });
});

describe("loadKnownValues", () => {
  const withEnv = (files, run) => {
    const dir = mkdtempSync(join(tmpdir(), "scan-secrets-"));
    try {
      for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
      return run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("toma los secretos y deja fuera lo público, lo corto, las direcciones y los comentarios", () => {
    const service = jwt({ role: "service_role" });
    const anon = jwt({ role: "anon" });
    const values = withEnv(
      {
        ".env.e2e": [
          "# SECRETO_COMENTADO=abcdefghijklmnopqrstuvwxyz",
          "SUPABASE_DB_PASSWORD=Zq9xK2mP7wLc",
          `SUPABASE_SERVICE_ROLE_KEY="${service}"`,
          `OTRA_CLAVE_JWT=${anon}`,
          "VITE_SUPABASE_ANON_KEY=sb_publishable_abcdefghijklmnop",
          "VITE_SUPABASE_URL=https://abcdefgh.supabase.co",
          "VITE_APP_ENV=local",
          "TOKEN_CORTO=abc123",
          "export OTRO=valor-largo-secreto-123",
        ].join("\n"),
      },
      loadKnownValues,
    );
    expect(values.map((v) => v.name).sort()).toEqual([
      "OTRO",
      "SUPABASE_DB_PASSWORD",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
    expect(values.find((v) => v.name === "SUPABASE_SERVICE_ROLE_KEY")?.value).toBe(service);
  });

  it("sin archivos .env devuelve una lista vacía", () => {
    expect(withEnv({}, loadKnownValues)).toEqual([]);
  });
});

describe("formatFindings", () => {
  it("una línea por (tipo, lugar), sin repetir, y sin el valor", () => {
    const secret = "sbp_" + "a1".repeat(20);
    const hits = scanLine(`${secret} ${secret}`).map((h) => ({ ...h, where: "src/a.ts:3" }));
    const lines = formatFindings([
      ...hits,
      ...hits,
      { id: "clave-de-aws", length: 20, hint: "AKIA", where: "b.ts:1" },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.join("\n")).not.toContain(secret);
    expect(lines[0]).toContain("supabase-token-de-acceso");
    expect(lines[0]).toContain("src/a.ts:3");
    expect(lines[0]).toContain("44 caracteres");
  });
});

describe("lista de falsos conocidos del historial", () => {
  const allow = [
    {
      commit: "23901c6",
      archivo: "test-support/db.test.ts",
      tipo: "url-de-postgres-con-contrasena",
      motivo: "ejemplo",
    },
  ];
  const hit = {
    id: "url-de-postgres-con-contrasena",
    commit: "23901c6",
    file: "test-support/db.test.ts",
  };

  it("solo perdona si coinciden commit, archivo y tipo", () => {
    expect(isAllowed(hit, allow)).toBe(true);
    expect(isAllowed({ ...hit, commit: "23901c6abcdef0" }, allow)).toBe(true); // el hash completo empieza por el prefijo
    expect(isAllowed({ ...hit, commit: "ffffff0" }, allow)).toBe(false);
    expect(isAllowed({ ...hit, file: "src/otro.ts" }, allow)).toBe(false);
    expect(isAllowed({ ...hit, id: "supabase-token-de-acceso" }, allow)).toBe(false);
  });

  it("una entrada sin motivo escrito no perdona nada", () => {
    expect(isAllowed(hit, [{ ...allow[0], motivo: "" }])).toBe(false);
    expect(isAllowed(hit, [{ ...allow[0], motivo: undefined }])).toBe(false);
  });

  it("sin archivo de lista no se perdona nada; el del repositorio tiene motivo en cada entrada", () => {
    expect(loadAllowlist(join(tmpdir(), "no-existe-esta-lista.json"))).toEqual([]);
    const real = loadAllowlist();
    expect(real.length).toBeGreaterThan(0);
    for (const entry of real) {
      expect(entry.motivo.length).toBeGreaterThan(20);
      expect(entry.commit).toMatch(/^[0-9a-f]{7,40}$/);
    }
  });
});
