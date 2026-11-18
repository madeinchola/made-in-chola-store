import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  type ComplaintDeps,
  type ComplaintInput,
  complaintSchema,
  prepareComplaint,
  receiveComplaint,
} from "./complaint.ts";
import { HttpError } from "./errors.ts";

const VALID: ComplaintInput = {
  contact_name: "Ana Pérez",
  contact_email: "  Ana@Example.COM ",
  kind: "product",
  detail: "La prenda llegó con una costura abierta y no es lo que pedí.",
};

interface Spy {
  limits: [string, number, number][];
  submitted: {
    data: Record<string, unknown>;
    profileId: string | null;
    ipHash: string;
  }[];
}
function deps(
  over: Partial<ComplaintDeps> = {},
  spy: Spy = { limits: [], submitted: [] },
): ComplaintDeps & { spy: Spy } {
  return {
    spy,
    ip: "203.0.113.9",
    userId: () => Promise.resolve(null),
    fingerprint: () => Promise.resolve("a".repeat(64)),
    limit: (key, max, window) => {
      spy.limits.push([key, max, window]);
      return Promise.resolve();
    },
    submit: (data, profileId, ipHash) => {
      spy.submitted.push({ data, profileId, ipHash });
      return Promise.resolve({
        number: "REC-000123",
        due_at: "2026-11-27T12:00:00Z",
      });
    },
    ...over,
  };
}

Deno.test("el esquema es estricto y acota cada campo", () => {
  const ok = (v: unknown) => complaintSchema.safeParse(v).success;
  assert(ok(VALID));
  assertEquals(ok({ ...VALID, kind: "queja" }), false);
  assertEquals(ok({ ...VALID, detail: "corto" }), false);
  assertEquals(ok({ ...VALID, detail: "x".repeat(2001) }), false);
  assertEquals(ok({ ...VALID, contact_name: "   " }), false);
  assertEquals(ok({ ...VALID, contact_name: "x".repeat(121) }), false);
  assertEquals(ok({ ...VALID, status: "closed" }), false); // un campo de más (p. ej. el estado) se rechaza
  assertEquals(ok({ ...VALID, profile_id: "00000000-0000-0000-0000-000000000000" }), false); // la cuenta NUNCA la elige quien reclama
  assertEquals(ok({ ...VALID, detail: 123 }), false);
});

Deno.test("prepareComplaint: correo en minúsculas, teléfono a E.164 y pedido en mayúsculas", () => {
  const data = prepareComplaint({
    ...VALID,
    contact_phone: "7123 4567",
    order_number: " mic-000123 ",
  });
  assertEquals(data, {
    contact_name: "Ana Pérez",
    contact_email: "ana@example.com",
    contact_phone: "+59171234567",
    order_number: "MIC-000123",
    kind: "product",
    detail: VALID.detail,
  });
});

Deno.test(
  "prepareComplaint: basta el teléfono; sin correo NI teléfono se rechaza (no habría cómo responder)",
  () => {
    const phoneOnly = prepareComplaint({
      ...VALID,
      contact_email: undefined,
      contact_phone: "71234567",
    });
    assertEquals([phoneOnly.contact_email, phoneOnly.contact_phone], [null, "+59171234567"]);
    for (const blank of [
      { contact_email: undefined },
      {
        contact_email: "   ",
        contact_phone: " ",
      },
    ]) {
      let error: unknown;
      try {
        prepareComplaint({ ...VALID, ...blank });
      } catch (e) {
        error = e;
      }
      assert(error instanceof HttpError);
      assertEquals([error.status, error.code], [400, "contact_required"]);
    }
  },
);

Deno.test(
  "prepareComplaint: correo, teléfono o pedido inválidos se rechazan con su propio código",
  () => {
    const code = (over: Partial<ComplaintInput>) => {
      try {
        prepareComplaint({ ...VALID, ...over });
        return "ok";
      } catch (e) {
        return (e as HttpError).code;
      }
    };
    assertEquals(code({ contact_email: "no-es-correo" }), "invalid_email");
    assertEquals(code({ contact_email: "a@phone.madeinchola.invalid" }), "invalid_email");
    assertEquals(code({ contact_email: undefined, contact_phone: "abc" }), "invalid_phone");
    assertEquals(code({ contact_email: undefined, contact_phone: "123" }), "invalid_phone");
    assertEquals(
      code({
        contact_email: undefined,
        contact_phone: "7123 4567",
        phone_country: "ZZ",
      }),
      "invalid_phone",
    );
    assertEquals(code({ order_number: "pedido uno" }), "invalid_order_number");
    assertEquals(code({ order_number: "MIC-1" }), "invalid_order_number");
    assertEquals(code({ order_number: "" }), "ok"); // vacío = sin pedido
  },
);

Deno.test(
  "receiveComplaint: registra con la huella de la red (nunca la IP) y devuelve el número y el plazo",
  async () => {
    const d = deps();
    const result = await receiveComplaint(VALID, d);
    assertEquals(result, {
      number: "REC-000123",
      due_at: "2026-11-27T12:00:00Z",
    });
    assertEquals(d.spy.submitted.length, 1);
    assertEquals(d.spy.submitted[0]!.ipHash, "a".repeat(64));
    assertEquals(d.spy.submitted[0]!.profileId, null);
    assert(!JSON.stringify(d.spy.submitted[0]).includes("203.0.113.9"), "la IP no viaja a la base");
  },
);

Deno.test(
  "receiveComplaint: con sesión válida el reclamo queda ligado a SU cuenta (y suma al límite por cuenta)",
  async () => {
    const d = deps({
      userId: () => Promise.resolve("11111111-1111-4111-8111-111111111111"),
    });
    await receiveComplaint(VALID, d);
    assertEquals(d.spy.submitted[0]!.profileId, "11111111-1111-4111-8111-111111111111");
    assert(
      d.spy.limits.some(([key]) => key === "complaint:user:11111111-1111-4111-8111-111111111111"),
    );
  },
);

Deno.test(
  "receiveComplaint: aplica los límites por red (5/h) y globales (300/día) ANTES de hacer nada más",
  async () => {
    const d = deps();
    await receiveComplaint(VALID, d);
    assertEquals(d.spy.limits[0], ["complaint:ip:203.0.113.9", 5, 3600]);
    assertEquals(d.spy.limits[1], ["complaint:global", 300, 86400]);
    // si un límite se pasa, no se guarda nada
    const blocked = deps({
      limit: () => Promise.reject(new HttpError(429, "rate_limited", "Demasiados intentos")),
    });
    const error = (await assertRejects(
      () => receiveComplaint(VALID, blocked),
      HttpError,
    )) as HttpError;
    assertEquals(error.status, 429);
    assertEquals(blocked.spy.submitted.length, 0);
  },
);

Deno.test(
  "receiveComplaint: el campo trampa devuelve un «recibido» y NO guarda nada (pero sí cuenta para los límites)",
  async () => {
    const d = deps();
    const result = await receiveComplaint(
      {
        ...VALID,
        website: "http://spam.example",
      },
      d,
    );
    assertEquals(result, { number: null, due_at: null });
    assertEquals(d.spy.submitted.length, 0);
    assert(d.spy.limits.length >= 2, "inundar con robots también agota el límite");
    // un valor en blanco no es un robot
    const human = deps();
    await receiveComplaint({ ...VALID, website: "   " }, human);
    assertEquals(human.spy.submitted.length, 1);
  },
);

Deno.test("receiveComplaint: los datos inválidos se rechazan ANTES de tocar la base", async () => {
  const d = deps();
  await assertRejects(() => receiveComplaint({ ...VALID, contact_email: "mal" }, d), HttpError);
  assertEquals(d.spy.submitted.length, 0);
});
