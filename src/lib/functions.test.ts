import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callFunction } from "./functions";

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key-de-prueba-suficientemente-larga");
});
afterEach(() => vi.unstubAllEnvs());

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  vi.fn(
    async () => new Response(JSON.stringify(body), { status, headers }),
  ) as unknown as typeof fetch;

describe("callFunction", () => {
  it("envía apikey y, si hay, el Bearer del usuario; el body va como JSON", async () => {
    const fetchImpl = json({ ok: true });
    await callFunction("login", { a: 1 }, { token: "tok", fetchImpl });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]! as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://127.0.0.1:54321/functions/v1/login");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      apikey: "anon-key-de-prueba-suficientemente-larga",
      Authorization: "Bearer tok",
    });
    expect(init.body).toBe('{"a":1}');
  });
  it("no envía Authorization sin token", async () => {
    const fetchImpl = json({});
    await callFunction("login", {}, { fetchImpl });
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![1] as RequestInit;
    expect(init.headers).not.toHaveProperty("Authorization");
  });
  it("éxito devuelve los datos", async () => {
    expect(await callFunction("x", {}, { fetchImpl: json({ session: { a: 1 } }) })).toEqual({
      ok: true,
      data: { session: { a: 1 } },
    });
  });
  it("error estructurado: código, mensaje y failures", async () => {
    const r = await callFunction(
      "x",
      {},
      {
        fetchImpl: json(
          { error: { code: "weak_password", message: "m", failures: ["common"] } },
          400,
        ),
      },
    );
    expect(r).toEqual({
      ok: false,
      status: 400,
      code: "weak_password",
      message: "m",
      failures: ["common"],
    });
  });
  it("429 usa retry_after del cuerpo, o la cabecera, o 60 por defecto", async () => {
    const body = (extra = {}) => ({ error: { code: "rate_limited", message: "m", ...extra } });
    expect(
      await callFunction("x", {}, { fetchImpl: json(body({ retry_after: 12 }), 429) }),
    ).toMatchObject({ retryAfter: 12 });
    expect(
      await callFunction("x", {}, { fetchImpl: json(body(), 429, { "Retry-After": "33" }) }),
    ).toMatchObject({ retryAfter: 33 });
    expect(await callFunction("x", {}, { fetchImpl: json(body(), 429) })).toMatchObject({
      retryAfter: 60,
    });
  });
  it("red caída → code 'network' (no lanza)", async () => {
    const boom = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await callFunction("x", {}, { fetchImpl: boom })).toMatchObject({
      ok: false,
      status: 0,
      code: "network",
    });
  });
  it("respuesta no-JSON (p. ej. 502 del proxy) → code 'unknown', sin lanzar", async () => {
    const html = vi.fn(
      async () => new Response("<html>Bad gateway</html>", { status: 502 }),
    ) as unknown as typeof fetch;
    expect(await callFunction("x", {}, { fetchImpl: html })).toMatchObject({
      ok: false,
      status: 502,
      code: "unknown",
    });
  });
});
