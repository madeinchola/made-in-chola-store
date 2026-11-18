import { describe, expect, it } from "vitest";
import { exitCodeFor, fetchHealth, formatHealth } from "./health.mjs";

const REPORT = {
  status: "crit",
  generated_at: "2026-11-18T14:36:40+00:00",
  checks: [
    { key: "db.size", status: "ok", value: 222, detail: "222 MB" },
    { key: "outbox.backlog", status: "crit", value: 50, detail: "50 avisos esperan" },
    { key: "cron.a", status: "ok", value: 3, detail: "bien" },
    { key: "webhooks.problems", status: "warn", value: 2, detail: "2 avisos de pago" },
    { key: "cron.b", status: "crit", value: 9999, detail: "atrasado" },
  ],
};

describe("formatHealth", () => {
  const lines = formatHealth(REPORT).split("\n");

  it("lista primero lo crítico, luego los avisos y luego lo que está bien, y dentro de cada grupo por nombre", () => {
    expect(lines.slice(0, 5).map((l) => l[0])).toEqual(["✘", "✘", "!", "✔", "✔"]);
    expect(lines[0]).toContain("cron.b");
    expect(lines[1]).toContain("outbox.backlog");
    expect(lines[2]).toContain("webhooks.problems");
    expect(lines[3]).toContain("cron.a");
    expect(lines[4]).toContain("db.size");
  });

  it("cierra con el estado general y los totales", () => {
    expect(lines.at(-1)).toBe(
      "Estado general: CRÍTICO — 2 críticos, 1 avisos, 2 bien (2026-11-18T14:36:40+00:00)",
    );
  });

  it("alinea el texto de cada comprobación y muestra su explicación", () => {
    expect(lines[1]).toBe("✘ outbox.backlog                     50 avisos esperan");
  });

  it("un informe sano y uno vacío no revientan", () => {
    expect(
      formatHealth({
        status: "ok",
        generated_at: "x",
        checks: [{ key: "a", status: "ok", detail: "d" }],
      }),
    ).toContain("Estado general: BIEN");
    expect(formatHealth({ status: "ok", generated_at: "x" })).toContain(
      "0 críticos, 0 avisos, 0 bien",
    );
  });
});

describe("exitCodeFor", () => {
  it("crítico sale con 1; aviso solo con --strict; bien con 0", () => {
    expect(exitCodeFor({ status: "crit" })).toBe(1);
    expect(exitCodeFor({ status: "crit" }, { strict: true })).toBe(1);
    expect(exitCodeFor({ status: "warn" })).toBe(0);
    expect(exitCodeFor({ status: "warn" }, { strict: true })).toBe(1);
    expect(exitCodeFor({ status: "ok" }, { strict: true })).toBe(0);
  });
});

describe("fetchHealth", () => {
  const env = {
    VITE_SUPABASE_URL: "https://abcdefgh.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "clave-de-prueba",
  };

  it("llama a la función con la clave de servicio y devuelve el informe", async () => {
    let seen;
    const out = await fetchHealth(env, async (url, init) => {
      seen = {
        url,
        method: init.method,
        key: init.headers.apikey,
        auth: init.headers.Authorization,
      };
      return { ok: true, status: 200, json: async () => REPORT };
    });
    expect(out).toBe(REPORT);
    expect(seen).toEqual({
      url: "https://abcdefgh.supabase.co/rest/v1/rpc/system_health",
      method: "POST",
      key: "clave-de-prueba",
      auth: "Bearer clave-de-prueba",
    });
  });

  it("falla con un mensaje claro sin claves o si la base responde con error", async () => {
    await expect(fetchHealth({ VITE_SUPABASE_URL: env.VITE_SUPABASE_URL })).rejects.toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
    await expect(fetchHealth({ SUPABASE_SERVICE_ROLE_KEY: "k" })).rejects.toThrow(
      /VITE_SUPABASE_URL/,
    );
    await expect(
      fetchHealth(env, async () => ({
        ok: false,
        status: 404,
        text: async () => "no existe la función",
      })),
    ).rejects.toThrow(/404.*no existe/);
  });
});
