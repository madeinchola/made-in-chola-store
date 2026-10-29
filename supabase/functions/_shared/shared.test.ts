import { assertEquals, assertMatch, assertNotMatch, assertRejects } from "jsr:@std/assert@1";
import { z } from "https://esm.sh/zod@3.25.76";
import { corsHeaders, handlePreflight } from "./cors.ts";
import { errorResponse, HttpError, jsonResponse } from "./errors.ts";
import { formatLogLine, redact } from "./logger.ts";
import { parseBody } from "./validate.ts";

const ORIGINS = ["https://madeinchola.com", "https://staging.madeinchola.com"];
const req = (origin?: string, init: RequestInit = {}) =>
  new Request("http://x/fn", {
    ...init,
    headers: { ...(origin ? { origin } : {}), ...(init.headers ?? {}) },
  });

Deno.test("cors: refleja solo orígenes de la lista blanca", () => {
  assertEquals(
    corsHeaders(req("https://staging.madeinchola.com"), ORIGINS)["Access-Control-Allow-Origin"],
    "https://staging.madeinchola.com",
  );
});
Deno.test("cors: origen no permitido NO se refleja (cae al primero permitido, jamás '*')", () => {
  const h = corsHeaders(req("https://evil.com"), ORIGINS);
  assertEquals(h["Access-Control-Allow-Origin"], "https://madeinchola.com");
  assertNotMatch(JSON.stringify(h), /\*"/);
});
Deno.test("cors: preflight OPTIONS responde 204; otros métodos pasan", () => {
  assertEquals(
    handlePreflight(req("https://madeinchola.com", { method: "OPTIONS" }), ORIGINS)?.status,
    204,
  );
  assertEquals(handlePreflight(req("https://madeinchola.com", { method: "POST" }), ORIGINS), null);
});
Deno.test("errors: HttpError conserva status/código y expone correlationId", async () => {
  const res = errorResponse(new HttpError(403, "forbidden", "No"), "corr-9");
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, {
    code: "forbidden",
    message: "No",
    correlationId: "corr-9",
  });
});
Deno.test("errors: un error inesperado da 500 SIN filtrar el mensaje interno", async () => {
  const res = errorResponse(new Error("password=secreto host=db.internal"), "c1");
  assertEquals(res.status, 500);
  const body = JSON.stringify(await res.json());
  assertNotMatch(body, /secreto|db\.internal/);
});
Deno.test("errors: jsonResponse pone Content-Type", () => {
  assertEquals(jsonResponse({ a: 1 }).headers.get("Content-Type"), "application/json");
});
Deno.test("validate: body válido", async () => {
  const out = await parseBody(
    new Request("http://x", { method: "POST", body: '{"qty":2}' }),
    z.object({ qty: z.number().int().positive() }),
  );
  assertEquals(out, { qty: 2 });
});
Deno.test("validate: JSON roto → 400 invalid_json", async () => {
  const e = await assertRejects(
    () => parseBody(new Request("http://x", { method: "POST", body: "{no" }), z.object({})),
    HttpError,
  );
  assertEquals([e.status, e.code], [400, "invalid_json"]);
});
Deno.test("validate: campo inválido → 400 validation con la ruta del campo", async () => {
  const e = await assertRejects(
    () =>
      parseBody(
        new Request("http://x", { method: "POST", body: '{"qty":-1}' }),
        z.object({ qty: z.number().positive() }),
      ),
    HttpError,
  );
  assertEquals(e.status, 400);
  assertMatch(e.message, /^qty:/);
});
Deno.test("logger: redacta email y JWT", () => {
  assertEquals(redact("a ana@x.com t eyJhbGciOi.eyJyb2xlIjoi.sig"), "a [email] t [jwt]");
});

Deno.test(
  "cors: getAllowedOrigins usa ALLOWED_ORIGINS si existe y los de desarrollo si no",
  async () => {
    const { getAllowedOrigins } = await import("./cors.ts");
    const previous = Deno.env.get("ALLOWED_ORIGINS");
    try {
      Deno.env.set("ALLOWED_ORIGINS", " https://a.com , https://b.com ,, ");
      assertEquals(getAllowedOrigins(), ["https://a.com", "https://b.com"]);
      Deno.env.set("ALLOWED_ORIGINS", "");
      const dev = getAllowedOrigins();
      assertEquals(dev.includes("http://localhost:5173"), true);
      assertEquals(
        dev.every((o) => o.startsWith("http://localhost") || o.startsWith("http://127.0.0.1")),
        true,
      );
    } finally {
      if (previous === undefined) Deno.env.delete("ALLOWED_ORIGINS");
      else Deno.env.set("ALLOWED_ORIGINS", previous);
    }
  },
);

Deno.test("logger: redacta teléfonos internacionales", () => {
  assertEquals(
    redact("Key (phone_e164)=(+59171234567) already exists"),
    "Key (phone_e164)=([phone]) already exists",
  );
});
Deno.test(
  "logger: la redacción alcanza a los CAMPOS EXTRA (p. ej. String(error) de Postgres), no solo al mensaje",
  () => {
    const line = formatLogLine("error", "c1", "register falló", {
      error:
        'duplicate key value violates unique constraint "profiles_email_key" Key (email)=(ana@correo.com) already exists. Key (phone_e164)=(+59171234567)',
      token: "eyJhbGciOi.eyJyb2xlIjoi.firma-1",
    });
    assertNotMatch(line, /ana@correo\.com|59171234567|eyJhbGciOi/);
    assertMatch(line, /\[email\]/);
    assertMatch(line, /"correlationId":"c1"/);
  },
);
Deno.test(
  "logger: una línea siempre es JSON válido, aun con comillas y saltos de línea en el error",
  () => {
    const line = formatLogLine("warn", "c2", "m", { error: 'texto "con comillas"\ny salto' });
    assertEquals(JSON.parse(line).level, "warn");
  },
);
Deno.test("logger: no destruye IDs ni fechas normales", () => {
  const line = formatLogLine("info", "3b12435a-0c6d-4d8e-9f10-aabbccddeeff", "ok", {
    at: "2026-10-23T04:12:09Z",
    userId: "f5b397a7-ee09-476e-b3fb-6c519d040fe2",
  });
  assertMatch(line, /3b12435a-0c6d-4d8e-9f10-aabbccddeeff/);
  assertMatch(line, /2026-10-23T04:12:09Z/);
  assertMatch(line, /f5b397a7-ee09-476e-b3fb-6c519d040fe2/);
});
