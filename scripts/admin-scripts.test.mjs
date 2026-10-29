import { describe, expect, it } from "vitest";
import { assertLocal, DEV_PASSWORD } from "./dev-seed.mjs";
import { parseArgs } from "./promote-admin.mjs";

describe("promote-admin: parseArgs", () => {
  it("normaliza el email", () => {
    expect(parseArgs([" Admin@Chola.COM "])).toEqual({ email: "admin@chola.com" });
  });
  it.each([[[]], [["no-es-email"]], [["--flag"]], [["a b@c.com"]]])("rechaza %j", (argv) => {
    expect(() => parseArgs(argv)).toThrow(/Uso:/);
  });
});

describe("dev-seed: protección contra entornos reales", () => {
  it.each(["http://127.0.0.1:54321", "http://localhost:54321"])("permite %s", (url) => {
    expect(() => assertLocal(url)).not.toThrow();
  });
  it.each([
    "https://abcdefgh.supabase.co",
    "http://127.0.0.1.evil.com",
    "https://localhost.evil.com:443",
    "http://192.168.1.10:54321",
    "",
  ])("se NIEGA a correr contra %j", (url) => {
    expect(() => assertLocal(url)).toThrow(/solo funciona contra Supabase local/);
  });
  it("la contraseña de desarrollo cumple la política real", async () => {
    const { validatePassword } = await import("../supabase/functions/_shared/password-policy");
    expect(validatePassword(DEV_PASSWORD)).toEqual({ ok: true });
  });
});

describe("with-clean-db: propaga el código de salida del comando", async () => {
  const { exitCodeOf } = await import("./with-clean-db.mjs");
  it("0 si pasó, el código real si falló, 1 si murió por señal", () => {
    expect(exitCodeOf({ status: 0 })).toBe(0);
    expect(exitCodeOf({ status: 3 })).toBe(3);
    expect(exitCodeOf({ status: null })).toBe(1);
  });
});
