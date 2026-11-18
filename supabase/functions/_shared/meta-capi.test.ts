import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { HttpError } from "./errors.ts";
import {
  buildPurchaseEvent,
  capiBodySchema,
  type CapiDeps,
  type CapiOrder,
  normalizeEmail,
  normalizePhone,
  purchaseEventId,
  sendPurchase,
  sha256Hex,
} from "./meta-capi.ts";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const ORDER: CapiOrder = {
  number: "MIC-000123",
  status: "pending_payment",
  currency: "BOB",
  total: 215,
  profileId: "11111111-1111-4111-8111-111111111111",
  contactEmail: "Ana.Perez@Example.com ",
  contactPhone: "+59171234567",
  createdAt: "2026-11-17T11:30:00Z",
  items: [{ productId: "p-1" }, { productId: "p-2" }, { productId: "p-1" }],
};
const INPUT = {
  order_number: "MIC-000123",
  event_id: "purchase.MIC-000123",
  fbp: "fb.1.1700000000.123456",
  fbc: "fb.1.1700000000.AbCdEf",
  source_url: "https://madeinchola.test/pedido/MIC-000123",
};
const CONTEXT = { ip: "203.0.113.9", userAgent: "Mozilla/5.0 (test)" };

interface Call {
  url: string;
  body: Record<string, unknown>;
}
function deps(over: Partial<CapiDeps> = {}, calls: Call[] = []): CapiDeps {
  return {
    pixelId: () => Promise.resolve("1234567890123"),
    order: () => Promise.resolve(ORDER),
    claim: () => Promise.resolve(true),
    fetch: ((url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch,
    token: "token-secreto",
    graphVersion: "v24.0",
    now: () => NOW,
    ...over,
  };
}

Deno.test("sha256Hex: vectores conocidos", async () => {
  assertEquals(
    await sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assertEquals(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

Deno.test(
  "el correo se normaliza (minúsculas, sin espacios) y el teléfono queda solo con dígitos ANTES de cifrar",
  () => {
    assertEquals(normalizeEmail("  Ana.Perez@Example.COM "), "ana.perez@example.com");
    assertEquals(normalizePhone("+591 7123-4567"), "59171234567");
  },
);

Deno.test(
  "buildPurchaseEvent: datos reales del pedido, correo y teléfono CIFRADOS, y NINGÚN dato personal en claro salvo IP y navegador",
  async () => {
    const event = await buildPurchaseEvent(ORDER, INPUT, {
      ...CONTEXT,
      nowSeconds: 1_794_000_000,
    });
    assertEquals(event.event_name, "Purchase");
    assertEquals(event.event_id, "purchase.MIC-000123");
    assertEquals(event.event_time, 1_794_000_000);
    assertEquals(event.action_source, "website");
    assertEquals(event.event_source_url, "https://madeinchola.test/pedido/MIC-000123");
    assertEquals(event.custom_data, {
      currency: "BOB",
      value: 215,
      order_id: "MIC-000123",
      content_type: "product_group",
      content_ids: ["p-1", "p-2"], // sin repetir
      num_items: 3,
    });
    const user = event.user_data;
    assertEquals(user.em, [await sha256Hex("ana.perez@example.com")]);
    assertEquals(user.ph, [await sha256Hex("59171234567")]);
    assertEquals(user.external_id, [await sha256Hex(ORDER.profileId)]);
    assertEquals([user.fbp, user.fbc], [INPUT.fbp, INPUT.fbc]);
    assertEquals(
      [user.client_ip_address, user.client_user_agent],
      ["203.0.113.9", "Mozilla/5.0 (test)"],
    );
    const text = JSON.stringify(event);
    assert(
      !/ana\.perez|example\.com|59171234567|\+591|7123/i.test(text),
      "ningún dato personal en claro",
    );
    assert(!text.includes(ORDER.profileId), "ni el identificador de la cuenta");
  },
);

Deno.test(
  "buildPurchaseEvent: sin correo no hay `em`; sin IP conocida no se manda IP",
  async () => {
    const event = await buildPurchaseEvent(
      { ...ORDER, contactEmail: null },
      {
        ...INPUT,
        fbp: undefined,
        fbc: undefined,
      },
      {
        ip: "unknown",
        userAgent: "",
        nowSeconds: 1,
      },
    );
    assertEquals("em" in event.user_data, false);
    assertEquals("client_ip_address" in event.user_data, false);
    assertEquals("client_user_agent" in event.user_data, false);
    assertEquals("fbp" in event.user_data, false);
  },
);

Deno.test(
  "el esquema es estricto: número de pedido válido, event_id seguro, nada de campos de más ni URLs raras",
  () => {
    const ok = (v: unknown) => capiBodySchema.safeParse(v).success;
    assert(ok(INPUT));
    assert(ok({ order_number: "MIC-000123", event_id: "purchase.MIC-000123" }));
    assertEquals(ok({ ...INPUT, order_number: "mic-1" }), false);
    assertEquals(ok({ ...INPUT, order_number: "MIC-000123; drop table" }), false);
    assertEquals(ok({ ...INPUT, event_id: "x y" }), false);
    assertEquals(ok({ ...INPUT, event_id: "x".repeat(101) }), false);
    assertEquals(ok({ ...INPUT, fbp: "fb 1" }), false);
    assertEquals(ok({ ...INPUT, source_url: "http://inseguro.test/" }), false);
    assertEquals(ok({ ...INPUT, source_url: "javascript:alert(1)" }), false);
    assertEquals(ok({ ...INPUT, value: 99999 }), false); // el valor NUNCA lo manda el navegador
    assertEquals(ok({ ...INPUT, email: "a@b.c" }), false);
  },
);

Deno.test(
  "sendPurchase: envía a Meta con el ID del Pixel, la versión de la API y el token EN EL CUERPO (nunca en la dirección)",
  async () => {
    const calls: Call[] = [];
    const result = await sendPurchase(
      ORDER.profileId,
      INPUT,
      CONTEXT,
      deps({ testEventCode: "TEST123" }, calls),
    );
    assertEquals(result, { sent: true });
    assertEquals(calls.length, 1);
    assertEquals(calls[0]!.url, "https://graph.facebook.com/v24.0/1234567890123/events");
    assert(!calls[0]!.url.includes("token-secreto"));
    assertEquals(calls[0]!.body.access_token, "token-secreto");
    assertEquals(calls[0]!.body.test_event_code, "TEST123");
    assertEquals((calls[0]!.body.data as unknown[]).length, 1);
  },
);

Deno.test(
  "sendPurchase: sin Pixel o sin token NO llama a nadie (la tienda como nace)",
  async () => {
    const calls: Call[] = [];
    assertEquals(
      await sendPurchase(
        ORDER.profileId,
        INPUT,
        CONTEXT,
        deps({ pixelId: () => Promise.resolve("") }, calls),
      ),
      {
        sent: false,
        reason: "not_configured",
      },
    );
    assertEquals(await sendPurchase(ORDER.profileId, INPUT, CONTEXT, deps({ token: "" }, calls)), {
      sent: false,
      reason: "not_configured",
    });
    assertEquals(calls.length, 0);
  },
);

Deno.test(
  "sendPurchase: un event_id que no corresponde al pedido se rechaza (400) y no se llama a Meta",
  async () => {
    const calls: Call[] = [];
    const error = (await assertRejects(
      () =>
        sendPurchase(
          ORDER.profileId,
          { ...INPUT, event_id: "purchase.MIC-999999" },
          CONTEXT,
          deps({}, calls),
        ),
      HttpError,
    )) as HttpError;
    assertEquals([error.status, error.code], [400, "invalid_event_id"]);
    assertEquals(calls.length, 0);
  },
);

Deno.test("sendPurchase: el pedido de OTRA persona (o que no existe) no se envía", async () => {
  const calls: Call[] = [];
  assertEquals(
    await sendPurchase(
      "otra-persona",
      INPUT,
      CONTEXT,
      deps({ order: () => Promise.resolve(null) }, calls),
    ),
    {
      sent: false,
      reason: "order_not_found",
    },
  );
  assertEquals(calls.length, 0);
});

Deno.test(
  "sendPurchase: pedidos cancelados, reembolsados o de hace más de un día NO se envían",
  async () => {
    const calls: Call[] = [];
    for (const over of [
      { status: "cancelled" },
      { status: "refunded" },
      { createdAt: "2026-11-16T11:00:00Z" }, // 25 horas
    ]) {
      assertEquals(
        await sendPurchase(
          ORDER.profileId,
          INPUT,
          CONTEXT,
          deps({ order: () => Promise.resolve({ ...ORDER, ...over }) }, calls),
        ),
        { sent: false, reason: "order_not_eligible" },
      );
    }
    assertEquals(calls.length, 0);
    // y uno de hace 23 horas sí
    const recent = { ...ORDER, createdAt: "2026-11-16T13:00:00Z" };
    assertEquals(
      await sendPurchase(
        ORDER.profileId,
        INPUT,
        CONTEXT,
        deps({ order: () => Promise.resolve(recent) }, calls),
      ),
      { sent: true },
    );
  },
);

Deno.test("sendPurchase: un pedido ya enviado no se envía dos veces", async () => {
  const calls: Call[] = [];
  assertEquals(
    await sendPurchase(
      ORDER.profileId,
      INPUT,
      CONTEXT,
      deps({ claim: () => Promise.resolve(false) }, calls),
    ),
    {
      sent: false,
      reason: "already_sent",
    },
  );
  assertEquals(calls.length, 0);
});

Deno.test(
  "sendPurchase: si Meta rechaza o no responde, se informa sin lanzar ni filtrar nada",
  async () => {
    const rejected = deps({
      fetch: (() =>
        Promise.resolve(new Response("secreto", { status: 400 }))) as unknown as typeof fetch,
    });
    assertEquals(await sendPurchase(ORDER.profileId, INPUT, CONTEXT, rejected), {
      sent: false,
      reason: "meta_rejected",
      status: 400,
    });
    const down = deps({
      fetch: (() =>
        Promise.reject(new Error("token-secreto en el mensaje"))) as unknown as typeof fetch,
    });
    assertEquals(await sendPurchase(ORDER.profileId, INPUT, CONTEXT, down), {
      sent: false,
      reason: "meta_unreachable",
    });
  },
);

Deno.test("purchaseEventId es el mismo que el del navegador", () => {
  assertEquals(purchaseEventId("MIC-000123"), "purchase.MIC-000123");
});
