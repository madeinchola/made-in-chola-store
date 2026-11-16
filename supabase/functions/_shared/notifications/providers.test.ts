import { assert, assertEquals, assertFalse, assertRejects } from "jsr:@std/assert@1";
import {
  createFakeProvider,
  createResendProvider,
  type EmailMessage,
  isReservedAddress,
  NotifyError,
} from "./providers.ts";

const MESSAGE: EmailMessage = {
  from: "Made In Chola <pedidos@chola.test>",
  to: ["ana@correo.test"],
  subject: "Tu pedido",
  html: "<p>hola</p>",
  text: "hola",
  idempotencyKey: "notif-42",
};

// ── Dominios reservados ────────────────────────────────────────────────────────────────────
Deno.test("dominios reservados: solo los que la norma reserva para pruebas", () => {
  for (const reserved of [
    "a@prueba.test",
    "a@b.example",
    "a@x.invalid",
    "a@localhost",
    "a@foo.localhost",
    "a@example.com",
    "a@mail.example.org",
    "a@EXAMPLE.NET.",
    "a@sub.example.com",
    "A@Prueba.TEST",
  ])
    assert(isReservedAddress(reserved), reserved);
  for (const real of [
    "a@gmail.com",
    "a@notexample.com",
    "a@example.com.mx",
    "a@test.com",
    "sin-arroba",
    "a@b.testing",
    "a@contest",
    "a@latest.org",
  ])
    assertFalse(isReservedAddress(real), real);
});

// ── Resend: contrato de la petición ────────────────────────────────────────────────────────
function resendWith(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  timeoutMs = 1000,
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(handler(String(url), init ?? {}));
  }) as typeof fetch;
  return { provider: createResendProvider("re_test_key", { fetchImpl, timeoutMs }), calls };
}

Deno.test("Resend: POST /emails con el formato documentado y devuelve el id", async () => {
  const { provider, calls } = resendWith(() =>
    Response.json({ id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }),
  );
  const result = await provider.send({ ...MESSAGE, replyTo: "soporte@chola.test" });
  assertEquals(result, { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" });
  assertEquals(calls.length, 1);
  const call = calls[0]!;
  assertEquals(call.url, "https://api.resend.com/emails");
  assertEquals(call.init.method, "POST");
  const headers = call.init.headers as Record<string, string>;
  assertEquals(headers.Authorization, "Bearer re_test_key");
  assertEquals(headers["Content-Type"], "application/json");
  assertEquals(headers["Idempotency-Key"], "notif-42");
  assertEquals(JSON.parse(String(call.init.body)), {
    from: "Made In Chola <pedidos@chola.test>",
    to: ["ana@correo.test"],
    subject: "Tu pedido",
    html: "<p>hola</p>",
    text: "hola",
    reply_to: "soporte@chola.test",
  });
  assertEquals(provider.name, "resend");
});

Deno.test("Resend: sin reply_to no se manda el campo", async () => {
  const { provider, calls } = resendWith(() => Response.json({ id: "x" }));
  await provider.send(MESSAGE);
  assertFalse("reply_to" in JSON.parse(String(calls[0]!.init.body)));
});

Deno.test("Resend: la clave de idempotencia es la del AVISO, igual en cada reintento", async () => {
  const { provider, calls } = resendWith(() => Response.json({ id: "x" }));
  await provider.send(MESSAGE);
  await provider.send(MESSAGE);
  assertEquals(
    (calls[0]!.init.headers as Record<string, string>)["Idempotency-Key"],
    (calls[1]!.init.headers as Record<string, string>)["Idempotency-Key"],
  );
});

Deno.test("Resend: una clave de idempotencia fuera de 1–256 caracteres ni se intenta", async () => {
  const { provider, calls } = resendWith(() => Response.json({ id: "x" }));
  for (const key of ["", "k".repeat(257)]) {
    const error = await assertRejects(
      () => provider.send({ ...MESSAGE, idempotencyKey: key }),
      NotifyError,
    );
    assertEquals([error.kind, error.code], ["permanent", "invalid_idempotency_key"]);
  }
  assertEquals(calls.length, 0);
  await provider.send({ ...MESSAGE, idempotencyKey: "k".repeat(256) });
  assertEquals(calls.length, 1);
});

// ── Resend: clasificación de errores ───────────────────────────────────────────────────────
const CASES: {
  name: string;
  status: number;
  body?: unknown;
  headers?: HeadersInit;
  kind: "transient" | "permanent";
  code: string;
  retryAfter?: (n: number | undefined) => boolean;
}[] = [
  {
    name: "429 límite de velocidad con Retry-After",
    status: 429,
    body: { name: "rate_limit_exceeded" },
    headers: { "retry-after": "7" },
    kind: "transient",
    code: "rate_limited",
    retryAfter: (n) => n === 7,
  },
  {
    name: "429 límite de velocidad sin cabecera",
    status: 429,
    body: { name: "rate_limit_exceeded" },
    kind: "transient",
    code: "rate_limited",
    retryAfter: (n) => n === undefined,
  },
  {
    name: "429 Retry-After con decimales se redondea hacia arriba",
    status: 429,
    body: { name: "rate_limit_exceeded" },
    headers: { "retry-after": "2.2" },
    kind: "transient",
    code: "rate_limited",
    retryAfter: (n) => n === 3,
  },
  {
    name: "429 cuota diaria: espera hasta la medianoche UTC",
    status: 429,
    body: { name: "daily_quota_exceeded" },
    kind: "transient",
    code: "quota_exceeded",
    retryAfter: (n) => n !== undefined && n >= 60 && n <= 86400,
  },
  {
    name: "429 cuota mensual",
    status: 429,
    body: { name: "monthly_quota_exceeded" },
    kind: "transient",
    code: "quota_exceeded",
    retryAfter: (n) => n !== undefined && n >= 60,
  },
  {
    name: "500",
    status: 500,
    body: { name: "application_error" },
    kind: "transient",
    code: "provider_500",
  },
  {
    name: "503",
    status: 503,
    body: { name: "service_unavailable" },
    kind: "transient",
    code: "provider_503",
  },
  {
    name: "502 con cuerpo que no es JSON",
    status: 502,
    body: "<html>Bad gateway</html>",
    kind: "transient",
    code: "provider_502",
  },
  {
    name: "409 solicitud concurrente con la misma clave",
    status: 409,
    body: { name: "concurrent_idempotent_requests" },
    kind: "transient",
    code: "idempotency_in_progress",
    retryAfter: (n) => n === 30,
  },
  {
    name: "409 misma clave con otro contenido",
    status: 409,
    body: { name: "invalid_idempotent_request" },
    kind: "permanent",
    code: "idempotency_conflict",
  },
  {
    name: "401 clave inválida (lo arregla el dueño: se reintenta)",
    status: 401,
    body: { name: "validation_error" },
    kind: "transient",
    code: "provider_config",
  },
  {
    name: "403 dominio sin verificar (lo arregla el dueño)",
    status: 403,
    body: { name: "validation_error" },
    kind: "transient",
    code: "provider_config",
  },
  {
    name: "403 clave suspendida",
    status: 403,
    body: { name: "suspended_api_key" },
    kind: "transient",
    code: "provider_config",
  },
  {
    name: "400 dirección o campo inválido",
    status: 400,
    body: { name: "validation_error" },
    kind: "permanent",
    code: "invalid_request",
  },
  {
    name: "422 falta un campo",
    status: 422,
    body: { name: "missing_required_field" },
    kind: "permanent",
    code: "invalid_request",
  },
  {
    name: "404",
    status: 404,
    body: { name: "not_found" },
    kind: "permanent",
    code: "provider_404",
  },
];

for (const c of CASES) {
  Deno.test(`Resend: ${c.name}`, async () => {
    const { provider } = resendWith(() =>
      typeof c.body === "string"
        ? new Response(c.body, { status: c.status, headers: c.headers })
        : Response.json(c.body ?? {}, { status: c.status, headers: c.headers }),
    );
    const error = await assertRejects(() => provider.send(MESSAGE), NotifyError);
    assertEquals([error.kind, error.code], [c.kind, c.code]);
    if (c.retryAfter)
      assert(
        c.retryAfter(error.retryAfterSeconds),
        `retryAfter inesperado: ${error.retryAfterSeconds}`,
      );
  });
}

Deno.test(
  "Resend: un 200 sin id no es un envío confirmado (se reintenta con la misma clave)",
  async () => {
    for (const body of [{}, { id: "" }, { id: 7 }]) {
      const { provider } = resendWith(() => Response.json(body));
      const error = await assertRejects(() => provider.send(MESSAGE), NotifyError);
      assertEquals([error.kind, error.code], ["transient", "bad_response"]);
    }
  },
);

Deno.test("Resend: sin red (fetch lanza) es transitorio", async () => {
  const provider = createResendProvider("k", {
    fetchImpl: (() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch,
  });
  const error = await assertRejects(() => provider.send(MESSAGE), NotifyError);
  assertEquals([error.kind, error.code], ["transient", "network"]);
});

Deno.test(
  "Resend: un proveedor que no responde se corta por tiempo (transitorio «timeout»)",
  async () => {
    const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("abortado", "AbortError")),
        );
      })) as typeof fetch;
    const provider = createResendProvider("k", { fetchImpl, timeoutMs: 25 });
    const started = Date.now();
    const error = await assertRejects(() => provider.send(MESSAGE), NotifyError);
    assertEquals([error.kind, error.code], ["transient", "timeout"]);
    assert(Date.now() - started < 1000, "no esperó de más");
  },
);

Deno.test(
  "Resend: el error NUNCA arrastra el texto del proveedor (puede traer la dirección de la clienta)",
  async () => {
    const { provider } = resendWith(() =>
      Response.json(
        { name: "validation_error", message: "Invalid `to` field: ana@correo.test" },
        { status: 400 },
      ),
    );
    const error = await assertRejects(() => provider.send(MESSAGE), NotifyError);
    assertEquals(error.message, "invalid_request");
    assertFalse(JSON.stringify(error).includes("ana@correo.test"));
  },
);

// ── Proveedor de pruebas ───────────────────────────────────────────────────────────────────
const to = (local: string) => ({ ...MESSAGE, to: [`${local}@prueba.test`] });

Deno.test(
  "fake: envía y registra; la misma clave no duplica (como un proveedor real)",
  async () => {
    const fake = createFakeProvider();
    const first = await fake.send(to("ana"));
    const second = await fake.send(to("ana"));
    assertEquals(first, second);
    assertEquals(first.id, "fake_notif-42");
    assertEquals(fake.sent.length, 1);
    await fake.send({ ...to("ana"), idempotencyKey: "notif-43" });
    assertEquals(fake.sent.length, 2);
  },
);

Deno.test("fake: cada comportamiento por la parte local de la dirección", async () => {
  const fake = createFakeProvider();
  const expectErr = async (local: string, kind: string, code: string, retry?: number) => {
    const error = await assertRejects(() => fake.send(to(local)), NotifyError);
    assertEquals([error.kind, error.code, error.retryAfterSeconds], [kind, code, retry], local);
  };
  await expectErr("permanent", "permanent", "invalid_request");
  await expectErr("transient", "transient", "provider_503");
  await expectErr("timeout", "transient", "timeout");
  await expectErr("ratelimit", "transient", "rate_limited", 120);
  assertEquals(fake.sent.length, 0);
});

Deno.test("fake: transient-N falla N veces y luego envía, con la MISMA clave", async () => {
  const fake = createFakeProvider();
  for (let i = 0; i < 2; i++) await assertRejects(() => fake.send(to("transient-2")), NotifyError);
  const result = await fake.send(to("transient-2"));
  assertEquals(result.id, "fake_notif-42");
  assertEquals(fake.attemptsFor("notif-42"), 3);
  assertEquals(fake.sent.length, 1);
});

Deno.test("fake: JAMÁS entrega a una dirección real, aunque lo activen por error", async () => {
  const fake = createFakeProvider();
  const error = await assertRejects(
    () => fake.send({ ...MESSAGE, to: ["ana@gmail.com"] }),
    NotifyError,
  );
  assertEquals([error.kind, error.code], ["permanent", "fake_provider_real_address"]);
  const mixed = await assertRejects(
    () => fake.send({ ...MESSAGE, to: ["a@prueba.test", "real@gmail.com"] }),
    NotifyError,
  );
  assertEquals(mixed.code, "fake_provider_real_address");
  assertEquals(fake.sent.length, 0);
});

Deno.test(
  "fake: el intento viaja con el aviso, así que «transient-N» funciona aunque cada invocación sea un proceso nuevo",
  async () => {
    for (const [attempt, shouldFail] of [
      [1, true],
      [2, true],
      [3, false],
      [4, false],
    ] as const) {
      const fresh = createFakeProvider(); // sin memoria de las llamadas anteriores
      const message = { ...to("transient-2"), attempt };
      if (shouldFail) await assertRejects(() => fresh.send(message), NotifyError);
      else assertEquals((await fresh.send(message)).id, "fake_notif-42");
    }
  },
);
