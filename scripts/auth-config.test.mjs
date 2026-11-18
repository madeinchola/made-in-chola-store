import { describe, expect, it } from "vitest";
import { BASELINE, evaluate, fetchAuthConfig, formatReport } from "./auth-config.mjs";

/** Una configuración que cumple TODA la línea base, incluido lo del lanzamiento. */
const GOOD = {
  disable_signup: true,
  external_anonymous_users_enabled: false,
  mailer_autoconfirm: false,
  password_min_length: 8,
  refresh_token_rotation_enabled: true,
  jwt_exp: 3600,
  security_update_password_require_reauthentication: true,
  security_captcha_enabled: true,
  smtp_host: "smtp.resend.com",
  rate_limit_email_sent: 30,
  password_hibp_enabled: true,
  site_url: "https://madeinchola.com",
  uri_allow_list: "https://madeinchola.com/restablecer,https://www.madeinchola.com/restablecer",
};

const statusOf = (config, key, opts) => evaluate(config, opts).find((r) => r.key === key)?.status;

describe("línea base de Auth", () => {
  it("una configuración correcta cumple todas las reglas", () => {
    expect(evaluate(GOOD, { launch: true }).filter((r) => r.status !== "ok")).toEqual([]);
  });

  it("cada regla se rompe sola: cambiar UNA clave a un valor malo hace fallar exactamente esa regla", () => {
    const bad = {
      disable_signup: false,
      external_anonymous_users_enabled: true,
      mailer_autoconfirm: true,
      password_min_length: 6,
      refresh_token_rotation_enabled: false,
      jwt_exp: 86400,
      security_update_password_require_reauthentication: false,
      security_captcha_enabled: false,
      smtp_host: null,
      rate_limit_email_sent: 2,
      password_hibp_enabled: false,
      site_url: "https://made-in-chola-store.vercel.app",
      uri_allow_list: "https://madeinchola.com/restablecer,http://localhost:5173/restablecer",
    };
    expect(Object.keys(bad).sort()).toEqual(BASELINE.map((r) => r.key).sort()); // ninguna regla sin caso
    for (const [key, value] of Object.entries(bad)) {
      const failing = evaluate({ ...GOOD, [key]: value }, { launch: true }).filter(
        (r) => r.status !== "ok",
      );
      expect(
        failing.map((r) => r.key),
        key,
      ).toEqual([key]);
    }
  });

  it("los bordes: 8 de largo sí y 7 no; jwt_exp 3600 sí y 3601 no; 30 correos por hora sí y 29 no", () => {
    expect(statusOf({ ...GOOD, password_min_length: 8 }, "password_min_length")).toBe("ok");
    expect(statusOf({ ...GOOD, password_min_length: 7 }, "password_min_length")).toBe("falla");
    expect(statusOf({ ...GOOD, jwt_exp: 3600 }, "jwt_exp")).toBe("ok");
    expect(statusOf({ ...GOOD, jwt_exp: 3601 }, "jwt_exp")).toBe("falla");
    expect(statusOf({ ...GOOD, jwt_exp: 0 }, "jwt_exp")).toBe("falla");
    expect(statusOf({ ...GOOD, rate_limit_email_sent: 30 }, "rate_limit_email_sent")).toBe("ok");
    expect(statusOf({ ...GOOD, rate_limit_email_sent: 29 }, "rate_limit_email_sent")).toBe("falla");
  });

  it("un valor que no es del tipo esperado no cumple (texto «true», clave que falta, nulo)", () => {
    expect(statusOf({ ...GOOD, disable_signup: "true" }, "disable_signup")).toBe("falla");
    expect(statusOf({ ...GOOD, disable_signup: undefined }, "disable_signup")).toBe("falla");
    expect(statusOf({ ...GOOD, password_min_length: "8" }, "password_min_length")).toBe("falla");
    expect(statusOf({ ...GOOD, smtp_host: "   " }, "smtp_host")).toBe("falla");
  });

  it("lo del lanzamiento queda «pendiente» sin --launch y «falla» con él", () => {
    const config = {
      ...GOOD,
      site_url: "https://x.vercel.app",
      uri_allow_list: "http://localhost:5173/restablecer",
    };
    expect(statusOf(config, "site_url")).toBe("pendiente");
    expect(statusOf(config, "uri_allow_list")).toBe("pendiente");
    expect(statusOf(config, "site_url", { launch: true })).toBe("falla");
    expect(statusOf(config, "uri_allow_list", { launch: true })).toBe("falla");
    // y una dirección correcta cumple en los dos modos
    expect(statusOf(GOOD, "site_url")).toBe("ok");
  });

  it("uri_allow_list: http, localhost y 127.0.0.1 no valen aunque haya otras direcciones buenas; vacía tampoco es un problema de localhost", () => {
    for (const bad of [
      "http://madeinchola.com/x",
      "https://localhost:5173/x",
      "https://a.com/x,https://127.0.0.1/x",
    ]) {
      expect(
        statusOf({ ...GOOD, uri_allow_list: bad }, "uri_allow_list", { launch: true }),
        bad,
      ).toBe("falla");
    }
  });
});

describe("informe", () => {
  it("lista primero lo que falla (bloqueantes antes que altos) y cuenta los totales", () => {
    const report = formatReport(
      evaluate({ ...GOOD, security_captcha_enabled: false, smtp_host: null }, { launch: true }),
    );
    const lines = report.split("\n").filter((l) => l.startsWith("✘"));
    expect(lines[0]).toContain("[bloqueante] smtp_host");
    expect(lines[1]).toContain("[alto] security_captcha_enabled");
    expect(report).toContain("11 de 13 reglas cumplidas, 2 fallan, 0 pendientes");
  });

  it("explica por qué cada regla que falla importa, y no repite el porqué de las que cumplen", () => {
    const report = formatReport(evaluate({ ...GOOD, jwt_exp: 86400 }, { launch: true }));
    expect(report).toContain("Una sesión robada caduca pronto.");
    expect(report).not.toContain("Nadie crea cuentas llamando a Auth directamente");
  });

  it("no imprime nada que no sea de la línea base (un secreto de más en la configuración no sale)", () => {
    const report = formatReport(
      evaluate(
        { ...GOOD, smtp_pass: "SECRETO-NO-IMPRIMIR", external_github_secret: "OTRO" },
        { launch: true },
      ),
    );
    expect(report).not.toMatch(/SECRETO|OTRO/);
  });
});

describe("fetchAuthConfig", () => {
  const env = {
    VITE_SUPABASE_URL: "https://abcdefgh.supabase.co",
    SUPABASE_ACCESS_TOKEN: "token-de-prueba",
  };

  it("pide la configuración del proyecto correcto con el token y devuelve el JSON", async () => {
    let seen;
    const out = await fetchAuthConfig(env, async (url, init) => {
      seen = { url, auth: init.headers.Authorization };
      return { ok: true, status: 200, json: async () => ({ disable_signup: true }) };
    });
    expect(out).toEqual({ disable_signup: true });
    expect(seen).toEqual({
      url: "https://api.supabase.com/v1/projects/abcdefgh/config/auth",
      auth: "Bearer token-de-prueba",
    });
  });

  it("falla con un mensaje claro sin token, con una URL rara o con un token que la API rechaza", async () => {
    await expect(fetchAuthConfig({ ...env, SUPABASE_ACCESS_TOKEN: "" })).rejects.toThrow(
      /SUPABASE_ACCESS_TOKEN/,
    );
    await expect(
      fetchAuthConfig({ ...env, VITE_SUPABASE_URL: "https://otra.com" }),
    ).rejects.toThrow(/VITE_SUPABASE_URL/);
    await expect(
      fetchAuthConfig(env, async () => ({ ok: false, status: 401, json: async () => ({}) })),
    ).rejects.toThrow(/401/);
  });
});
