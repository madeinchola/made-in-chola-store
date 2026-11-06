import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCloudEnv,
  DEFAULTS,
  exitCodeOf,
  isLocalUrl,
  missingVars,
  parseEnvFile,
} from "./cloud-env.mjs";

describe("parseEnvFile", () => {
  it("lee KEY=valor, ignora comentarios y líneas vacías, quita `export` y comillas", () => {
    const text = [
      "# comentario",
      "",
      "A=uno",
      "export B = dos ",
      'C="tres con espacios"',
      "D='cuatro'",
      "E=con=igual=dentro",
      "  # otro comentario",
      "F=",
    ].join("\n");
    expect(parseEnvFile(text)).toEqual({
      A: "uno",
      B: "dos",
      C: "tres con espacios",
      D: "cuatro",
      E: "con=igual=dentro",
      F: "",
    });
  });
  it("no interpola ni ejecuta nada ($VAR y $(cmd) quedan literales) y tolera CRLF", () => {
    expect(parseEnvFile("A=$HOME\r\nB=$(echo x)\r\n")).toEqual({ A: "$HOME", B: "$(echo x)" });
  });
  it("ignora líneas que no son asignaciones válidas", () => {
    expect(parseEnvFile("sin igual\n1MALO=x\nOK=1\n=vacio")).toEqual({ OK: "1" });
  });
  it("una comilla suelta no se toma por par", () => {
    expect(parseEnvFile(`A="abierta\nB='`)).toEqual({ A: '"abierta', B: "'" });
  });
});

describe("isLocalUrl", () => {
  it.each([
    "http://127.0.0.1:54321",
    "http://localhost:5173",
    "https://localhost",
    "http://[::1]:80",
  ])("%s es local", (url) => expect(isLocalUrl(url)).toBe(true));
  it.each([
    "https://abcdefgh.supabase.co",
    "http://127.0.0.1.evil.com",
    "https://localhost.evil.com",
    "",
    undefined,
  ])("%j NO es local", (url) => expect(isLocalUrl(url)).toBe(false));
});

describe("buildCloudEnv", () => {
  const dirs = [];
  const project = (files) => {
    const dir = mkdtempSync(join(tmpdir(), "cloud-env-"));
    dirs.push(dir);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return dir;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("junta .env.local y .env.e2e sobre los valores por defecto, y no toca process.env", () => {
    const before = { ...process.env };
    const root = project({
      ".env.local": "VITE_SUPABASE_URL=https://abc.supabase.co\nVITE_SUPABASE_ANON_KEY=pub",
      ".env.e2e": "SUPABASE_SERVICE_ROLE_KEY=secreta",
    });
    const env = buildCloudEnv({ root, base: {} });
    expect(env).toMatchObject({
      ...DEFAULTS,
      VITE_SUPABASE_URL: "https://abc.supabase.co",
      VITE_SUPABASE_ANON_KEY: "pub",
      SUPABASE_SERVICE_ROLE_KEY: "secreta",
    });
    expect(process.env).toEqual(before);
  });

  it("el entorno del proceso manda sobre los archivos, y los archivos sobre los valores por defecto", () => {
    const root = project({
      ".env.local": "VITE_SUPABASE_URL=https://abc.supabase.co\nE2E_PORT=4000",
      ".env.e2e": "E2E_PORT=4100",
    });
    expect(buildCloudEnv({ root, base: {} }).E2E_PORT).toBe("4100"); // .env.e2e > .env.local
    expect(buildCloudEnv({ root, base: { E2E_PORT: "9999" } }).E2E_PORT).toBe("9999");
    const sinArchivo = project({ ".env.local": "VITE_SUPABASE_URL=https://abc.supabase.co" });
    expect(buildCloudEnv({ root: sinArchivo, base: {} }).E2E_PORT).toBe(DEFAULTS.E2E_PORT);
  });

  it("se niega si no hay URL o si la URL es local (solo existe el Supabase de la nube)", () => {
    expect(() => buildCloudEnv({ root: project({}), base: {} })).toThrow(/Falta VITE_SUPABASE_URL/);
    const local = project({ ".env.local": "VITE_SUPABASE_URL=http://127.0.0.1:54321" });
    expect(() => buildCloudEnv({ root: local, base: {} })).toThrow(/no puede ser local/);
    expect(() =>
      buildCloudEnv({ root: project({}), base: { VITE_SUPABASE_URL: "http://localhost:54321" } }),
    ).toThrow(/no puede ser local/);
  });
});

describe("missingVars / exitCodeOf", () => {
  it("devuelve solo los NOMBRES que faltan o están vacíos, nunca valores", () => {
    expect(missingVars({ A: "x", B: "" }, ["A", "B", "C"])).toEqual(["B", "C"]);
  });
  it("propaga el código de salida: 0 si pasó, el real si falló, 1 si murió por señal", () => {
    expect(exitCodeOf({ status: 0 })).toBe(0);
    expect(exitCodeOf({ status: 3 })).toBe(3);
    expect(exitCodeOf({ status: null })).toBe(1);
  });
});
