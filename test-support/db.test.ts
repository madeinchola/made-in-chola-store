import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  dbPsql,
  dbRunFile,
  dbSql,
  dbUrl,
  isPlaceholderPassword,
  psqlEnv,
  tapFailures,
  tapSummary,
} from "./db";

describe("dbUrl", () => {
  it("usa SUPABASE_DB_URL tal cual si está", () => {
    expect(
      dbUrl({ SUPABASE_DB_URL: "postgresql://u:p@h:6543/x", SUPABASE_DB_PASSWORD: "otra" }),
    ).toBe("postgresql://u:p@h:6543/x");
  });
  it("deriva la cadena de la contraseña SIN codificar y la referencia de VITE_SUPABASE_URL", () => {
    expect(
      dbUrl({
        SUPABASE_DB_PASSWORD: "p@ss/w:rd#1?%",
        VITE_SUPABASE_URL: "https://abcdefgh.supabase.co",
      }),
    ).toBe("postgresql://postgres:p%40ss%2Fw%3Ard%231%3F%25@db.abcdefgh.supabase.co:5432/postgres");
  });
  it("devuelve null si falta la contraseña o la URL no es de un proyecto de Supabase", () => {
    expect(dbUrl({ VITE_SUPABASE_URL: "https://abcdefgh.supabase.co" })).toBeNull();
    expect(dbUrl({ SUPABASE_DB_PASSWORD: "x" })).toBeNull();
    expect(
      dbUrl({ SUPABASE_DB_PASSWORD: "x", VITE_SUPABASE_URL: "http://127.0.0.1:54321" }),
    ).toBeNull();
    expect(
      dbUrl({
        SUPABASE_DB_PASSWORD: "x",
        VITE_SUPABASE_URL: "https://evil.com/abcdefgh.supabase.co",
      }),
    ).toBeNull();
  });
});

describe("psqlEnv", () => {
  it("separa host, puerto, usuario, contraseña y base; decodifica la contraseña y exige TLS", () => {
    const url =
      "postgresql://postgres:p%40ss%2Fw%3Ard%231%3F%25@db.abcdefgh.supabase.co:5432/postgres";
    expect(psqlEnv(url)).toEqual({
      PGHOST: "db.abcdefgh.supabase.co",
      PGPORT: "5432",
      PGUSER: "postgres",
      PGPASSWORD: "p@ss/w:rd#1?%",
      PGDATABASE: "postgres",
      PGSSLMODE: "require",
      PGCONNECT_TIMEOUT: "20",
    });
  });
  it("puerto y base por defecto; rechaza lo que no es una cadena de postgres", () => {
    const e = psqlEnv("postgres://postgres:x@h");
    expect(e.PGPORT).toBe("5432");
    expect(e.PGDATABASE).toBe("postgres");
    expect(() => psqlEnv("https://abcdefgh.supabase.co")).toThrow(/no es una cadena de postgres/);
  });
});

describe("isPlaceholderPassword", () => {
  it.each([
    "",
    "   ",
    "<contraseña>",
    "REEMPLAZA_CON_LA_CONTRASENA",
    "  REEMPLAZA_CON_LA_CONTRASENA  ",
  ])("%j es relleno", (v) => expect(isPlaceholderPassword(v)).toBe(true));
  it.each([
    "k3j#Zq9x-Lm",
    "contraseña-real-123",
    "Pegasus9!",
    "Reemplaza-Mi-Clave-7",
    "REEMPLAZA_CON_LA_CONTRASENA2",
    "<no-cerrado",
  ])("%j NO es relleno", (v) => expect(isPlaceholderPassword(v)).toBe(false));
  it("undefined es relleno", () => expect(isPlaceholderPassword(undefined)).toBe(true));
});

describe("dbSql solo lee", () => {
  it.each(["delete from x", "update x set a=1", "drop table x", "insert into x values (1)", ""])(
    "rechaza %j antes de conectarse",
    (q) => expect(() => dbSql(q)).toThrow(/solo admite consultas SELECT/),
  );
});

describe("TAP", () => {
  const out = [
    "1..4",
    "ok 1 - uno",
    "ok 2 - dos",
    "not ok 3 - tres",
    '#   Failed test 3: "tres"',
    "#         have: 1",
    "#         want: 2",
    "ok 4 - cuatro",
    "# Looks like you failed 1 test of 4",
  ].join("\n");
  it("cuenta aserciones y plan", () => {
    expect(tapSummary(out)).toEqual({ ok: 3, notOk: 1, planned: 4 });
    expect(tapSummary("sin tap")).toEqual({ ok: 0, notOk: 0, planned: null });
  });
  it("extrae solo los fallos y su diagnóstico", () => {
    expect(tapFailures(out)).toEqual([
      "not ok 3 - tres",
      '#   Failed test 3: "tres"',
      "#         have: 1",
      "#         want: 2",
      "# Looks like you failed 1 test of 4",
    ]);
    expect(tapFailures("ok 1\nok 2")).toEqual([]);
  });
  it("«ok» dentro de un texto no se toma por aserción", () => {
    expect(tapSummary("ok 1 - a\n  ok 2 - indentado\nnot ok 2 - b")).toEqual({
      ok: 1,
      notOk: 1,
      planned: null,
    });
  });
});

describe("dbRunFile (con un `psql` de mentira)", () => {
  const dirs: string[] = [];
  const saved = { ...process.env };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    process.env = { ...saved };
  });
  /** Un ejecutable que imprime `stdout`, `stderr` y sale con `code`; y deja en `args.txt` lo que recibió. */
  function fakePsql(stdout: string, stderr: string, code: number, delayMs = 0) {
    const dir = mkdtempSync(join(tmpdir(), "fake-psql-"));
    dirs.push(dir);
    const bin = join(dir, "psql");
    writeFileSync(
      bin,
      `#!/bin/sh\necho "$@" > "${join(dir, "args.txt")}"\nenv | grep '^PGPASSWORD=' > "${join(dir, "env.txt")}"\nsleep ${delayMs / 1000}\nprintf '%s' '${stdout}'\nprintf '%s' '${stderr}' >&2\nexit ${code}\n`,
    );
    chmodSync(bin, 0o755);
    process.env.PSQL_BIN = bin;
    process.env.SUPABASE_DB_PASSWORD = "p@ss/w:rd";
    process.env.VITE_SUPABASE_URL = "https://abcdefgh.supabase.co";
    delete process.env.SUPABASE_DB_URL;
    return dir;
  }

  it("devuelve la salida TAP y el código 0, sin bloquear: otras tareas siguen corriendo mientras tanto", async () => {
    const dir = fakePsql("1..1\nok 1 - x\n", "", 0, 400);
    let ticks = 0;
    const timer = setInterval(() => ticks++, 50);
    const result = await dbRunFile("/ruta/de/prueba.sql");
    clearInterval(timer);
    expect(result).toEqual({ status: 0, stdout: "1..1\nok 1 - x\n", stderr: "" });
    expect(ticks).toBeGreaterThan(3); // el bucle de eventos NO estuvo bloqueado (con spawnSync serían 0)
    const args = (await import("node:fs")).readFileSync(join(dir, "args.txt"), "utf8").trim();
    expect(args).toBe("-X -v ON_ERROR_STOP=1 -q -tA -f /ruta/de/prueba.sql");
    // la contraseña viaja en el ENTORNO, decodificada, y NUNCA en los argumentos
    expect((await import("node:fs")).readFileSync(join(dir, "env.txt"), "utf8").trim()).toBe(
      "PGPASSWORD=p@ss/w:rd",
    );
    expect(args).not.toContain("p@ss");
  });

  it("si psql falla devuelve su código y su error en vez de lanzar", async () => {
    fakePsql("not ok 1 - roto\n", "ERROR: boom", 3);
    expect(await dbRunFile("x.sql")).toEqual({
      status: 3,
      stdout: "not ok 1 - roto\n",
      stderr: "ERROR: boom",
    });
  });

  it("sin la contraseña de la base lanza un mensaje claro antes de ejecutar nada", async () => {
    fakePsql("", "", 0);
    process.env.SUPABASE_DB_PASSWORD = "REEMPLAZA_CON_LA_CONTRASENA";
    await expect(dbRunFile("x.sql")).rejects.toThrow(/Falta la contraseña de la base/);
  });

  it("si psql no existe lo dice y explica cómo instalarlo", async () => {
    fakePsql("", "", 0);
    process.env.PSQL_BIN = "/no/existe/psql";
    await expect(dbRunFile("x.sql")).rejects.toThrow(/brew install libpq/);
  });
});

describe("dbPsql (sesión independiente, con un `psql` de mentira)", () => {
  const dirs: string[] = [];
  const saved = { ...process.env };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    process.env = { ...saved };
  });
  function fakePsql(stdout: string, stderr: string, code: number) {
    const dir = mkdtempSync(join(tmpdir(), "fake-psql-"));
    dirs.push(dir);
    const bin = join(dir, "psql");
    writeFileSync(
      bin,
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${join(dir, "args.txt")}"\nprintf '%s' '${stdout}'\nprintf '%s' '${stderr}' >&2\nexit ${code}\n`,
    );
    chmodSync(bin, 0o755);
    process.env.PSQL_BIN = bin;
    process.env.SUPABASE_DB_PASSWORD = "clave-de-prueba";
    process.env.VITE_SUPABASE_URL = "https://abcdefgh.supabase.co";
    delete process.env.SUPABASE_DB_URL;
    return dir;
  }

  it("pasa el SQL como UN argumento de -c (sin intérprete de por medio) y devuelve la salida", async () => {
    const dir = fakePsql("reserved\n", "", 0);
    const sql = "select 'a; b' || $$c$$; select 1";
    expect(await dbPsql(sql)).toEqual({ stdout: "reserved\n", stderr: "" });
    const args = (await import("node:fs")).readFileSync(join(dir, "args.txt"), "utf8").split("\n");
    expect(args.slice(0, 6)).toEqual(["-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql]);
    expect(args.join(" ")).not.toContain("clave-de-prueba");
  });

  it("rechaza con el código y el error de psql si falla", async () => {
    fakePsql("", "ERROR: boom", 3);
    await expect(dbPsql("select 1")).rejects.toThrow(/psql salió con 3: ERROR: boom/);
  });

  it("30 sesiones a la vez no se bloquean entre sí", async () => {
    fakePsql("ok", "", 0);
    const results = await Promise.all(Array.from({ length: 30 }, () => dbPsql("select 1")));
    expect(results.every((r) => r.stdout === "ok")).toBe(true);
  });
});
