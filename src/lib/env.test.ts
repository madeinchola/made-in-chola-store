import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env";

const b64url = (o: object) =>
  btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (role: string) =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ role })}.firma-de-prueba-123`;

const valid = {
  VITE_SUPABASE_URL: "http://127.0.0.1:54321",
  VITE_SUPABASE_ANON_KEY: jwt("anon"),
};

describe("parseEnv", () => {
  it("acepta una configuración válida y aplica defaults", () => {
    const env = parseEnv(valid);
    expect(env.VITE_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(env.VITE_APP_ENV).toBe("local");
    expect(env.VITE_SITE_URL).toBe("http://localhost:5173");
  });
  it("falla ruidosamente nombrando CADA variable que falta", () => {
    try {
      parseEnv({});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const issues = (e as EnvError).issues.join("\n");
      expect(issues).toContain("VITE_SUPABASE_URL");
      expect(issues).toContain("VITE_SUPABASE_ANON_KEY");
    }
  });
  it("una variable vacía cuenta como ausente", () => {
    expect(() => parseEnv({ ...valid, VITE_SUPABASE_URL: "" })).toThrow(/VITE_SUPABASE_URL/);
  });
  it("rechaza URL malformada", () => {
    expect(() => parseEnv({ ...valid, VITE_SUPABASE_URL: "no-es-url" })).toThrow(/URL/);
  });
  it("rechaza una anon key demasiado corta", () => {
    expect(() => parseEnv({ ...valid, VITE_SUPABASE_ANON_KEY: "abc" })).toThrow(/ANON_KEY/);
  });
  it("RECHAZA una clave service_role (no debe llegar al navegador)", () => {
    expect(() => parseEnv({ ...valid, VITE_SUPABASE_ANON_KEY: jwt("service_role") })).toThrow(
      /service_role/,
    );
  });
  it("acepta claves no-JWT (formato nuevo sb_publishable_…) siempre que no sean service_role", () => {
    expect(
      parseEnv({ ...valid, VITE_SUPABASE_ANON_KEY: "sb_publishable_abcdefghijklmnop" })
        .VITE_SUPABASE_ANON_KEY,
    ).toMatch(/^sb_publishable/);
  });
  it("rechaza entornos desconocidos", () => {
    expect(() => parseEnv({ ...valid, VITE_APP_ENV: "prod" })).toThrow(/VITE_APP_ENV/);
  });
});
