import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDumpArgs,
  connectionEnv,
  parseArgs,
  SCHEMAS,
  stamp,
  summarizeToc,
  verifyToc,
} from "./backup.mjs";

const TOC = [
  ";",
  "; Archive created at 2026-11-18 10:00:00",
  "210; 1259 16452 TABLE public orders postgres",
  "211; 1259 16460 TABLE public products postgres",
  "212; 1259 16470 TABLE public profiles postgres",
  "213; 1259 16480 TABLE public payments postgres",
  "300; 1259 16500 TABLE auth users supabase_auth_admin",
  "301; 1259 16510 TABLE storage objects supabase_storage_admin",
  "4100; 0 16452 TABLE DATA public orders postgres",
  "4101; 0 16460 TABLE DATA public products postgres",
  "4102; 0 16470 TABLE DATA public profiles postgres",
  "4103; 0 16480 TABLE DATA public payments postgres",
  "4200; 0 16500 TABLE DATA auth users supabase_auth_admin",
  "4300; 0 16510 TABLE DATA storage objects supabase_storage_admin",
  "500; 1255 16600 FUNCTION public system_health() postgres",
].join("\n");

describe("buildDumpArgs", () => {
  const args = buildDumpArgs("/tmp/x.dump");
  it("formato personalizado, sin dueños ni privilegios y solo los tres esquemas", () => {
    expect(args).toContain("--format=custom");
    expect(args).toContain("--no-owner");
    expect(args).toContain("--no-privileges");
    const schemas = args.flatMap((a, i) => (args[i - 1] === "--schema" ? [a] : []));
    expect(schemas).toEqual(["public", "auth", "storage"]);
    expect(SCHEMAS).toEqual(["public", "auth", "storage"]);
  });

  it("escribe en el archivo dado y NUNCA incluye el vault (los secretos no van en una copia)", () => {
    expect(args.slice(-2)).toEqual(["--file", "/tmp/x.dump"]);
    expect(args.join(" ")).not.toMatch(/vault|cron|--data-only/);
  });
});

describe("connectionEnv", () => {
  const env = {
    VITE_SUPABASE_URL: "https://abcdefgh.supabase.co",
    SUPABASE_DB_PASSWORD: "clave-de-prueba",
  };

  it("usa el pooler en modo sesión con el usuario del proyecto y exige TLS", () => {
    expect(connectionEnv(env)).toEqual({
      PGHOST: "aws-0-us-east-2.pooler.supabase.com",
      PGPORT: "5432",
      PGUSER: "postgres.abcdefgh",
      PGPASSWORD: "clave-de-prueba",
      PGDATABASE: "postgres",
      PGSSLMODE: "require",
      PGCONNECT_TIMEOUT: "30",
    });
  });

  it("falla con un mensaje claro sin contraseña o con una URL que no es de Supabase", () => {
    expect(() => connectionEnv({ ...env, SUPABASE_DB_PASSWORD: "" })).toThrow(
      /SUPABASE_DB_PASSWORD/,
    );
    expect(() => connectionEnv({ ...env, VITE_SUPABASE_URL: "https://otra.com" })).toThrow(
      /VITE_SUPABASE_URL/,
    );
  });
});

describe("summarizeToc y verifyToc", () => {
  it("cuenta tablas, tablas con datos, funciones y esquemas con datos", () => {
    expect(summarizeToc(TOC)).toEqual({
      entries: 13,
      tables: 6,
      dataSets: 6,
      functions: 1,
      schemas: ["auth", "public", "storage"],
    });
  });

  it("una copia completa pasa", () => {
    expect(verifyToc(TOC).problems).toEqual([]);
  });

  it("falla y dice qué falta: un esquema o una tabla clave", () => {
    expect(verifyToc(TOC.replace(/.*TABLE DATA auth.*\n/, "")).problems).toEqual([
      "no trae datos del esquema auth",
    ]);
    expect(verifyToc(TOC.replace(/.*TABLE DATA storage.*\n/, "")).problems).toEqual([
      "no trae datos del esquema storage",
    ]);
    for (const table of ["orders", "products", "profiles", "payments"]) {
      expect(
        verifyToc(TOC.replace(new RegExp(`.*TABLE DATA public ${table} .*\\n`), "")).problems,
        table,
      ).toEqual([`falta la tabla public.${table}`]);
    }
    expect(verifyToc("").problems.length).toBe(7);
  });

  it("las líneas de comentario del encabezado no cuentan como objetos", () => {
    expect(summarizeToc(";\n; Archive created at x\n").entries).toBe(0);
  });
});

describe("stamp y parseArgs", () => {
  it("la marca de tiempo es AAAAMMDD-HHMMSS con ceros a la izquierda", () => {
    expect(stamp(new Date(2026, 0, 5, 3, 4, 9))).toBe("20260105-030409");
    expect(stamp(new Date(2026, 10, 18, 14, 36, 40))).toBe("20261118-143640");
  });

  it("la carpeta por omisión es backups/ del repositorio; --out la cambia y exige un valor", () => {
    expect(parseArgs([], "/repo")).toEqual({ dir: resolve("/repo", "backups") });
    expect(parseArgs(["--out", "/otra/carpeta"], "/repo")).toEqual({ dir: "/otra/carpeta" });
    expect(parseArgs(["--out", "rel"], "/repo")).toEqual({ dir: resolve("/repo", "rel") });
    expect(() => parseArgs(["--out"], "/repo")).toThrow(/carpeta/);
  });
});
