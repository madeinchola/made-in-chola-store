import { assert, assertEquals } from "jsr:@std/assert@1";
import { createFakeProvider } from "./payments/fake.ts";
import { manualQrProvider } from "./payments/manual_qr.ts";
import { qrApiProvider } from "./payments/qr_api.ts";
import { reconcilePayments, type ReconcilePayment } from "./payments/reconcile.ts";
import { createRegistry, defaultRegistry } from "./payments/registry.ts";
import type { PaymentProvider } from "./payments/types.ts";
import {
  hmacHex,
  parseSignedGenericEvent,
  safeEqual,
  signPayload,
  SIGNATURE_HEADER,
  TOLERANCE_SECONDS,
  verifySignature,
} from "./payments/webhook.ts";

const SECRET = "secreto-de-prueba-0123456789";
const NOW = 1_800_000_000;
const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    event_id: "evt-1",
    type: "payment.paid",
    reference: "MIC-000123",
    amount: 255,
    currency: "BOB",
    external_id: "tx-9",
    ...over,
  });

Deno.test("HMAC-SHA256: vector conocido (RFC 4231, caso 2)", async () => {
  assertEquals(
    await hmacHex("Jefe", "what do ya want for nothing?"),
    "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
  );
});

Deno.test("firma válida", async () => {
  const text = body();
  const header = await signPayload(SECRET, text, NOW);
  assertEquals(await verifySignature(text, header, SECRET, NOW), { ok: true });
});

Deno.test(
  "firma: cuerpo alterado, secreto distinto, firma alterada o ausente se rechazan",
  async () => {
    const text = body();
    const header = await signPayload(SECRET, text, NOW);
    assertEquals((await verifySignature(body({ amount: 1 }), header, SECRET, NOW)).ok, false); // monto cambiado
    assertEquals((await verifySignature(text, header, "otro-secreto-0123456789", NOW)).ok, false);
    const flipped = header.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    assertEquals((await verifySignature(text, flipped, SECRET, NOW)).ok, false);
    assertEquals(await verifySignature(text, null, SECRET, NOW), {
      ok: false,
      reason: "falta la firma",
    });
    assertEquals((await verifySignature(text, "", SECRET, NOW)).ok, false);
    assertEquals((await verifySignature(text, "basura", SECRET, NOW)).ok, false);
    assertEquals((await verifySignature(text, `t=${NOW}`, SECRET, NOW)).ok, false); // sin v1
    assertEquals((await verifySignature(text, `v1=${"a".repeat(64)}`, SECRET, NOW)).ok, false); // sin t
  },
);

Deno.test("firma: un v1 en mayúsculas o de largo incorrecto es una firma mal formada", async () => {
  const text = body();
  const header = await signPayload(SECRET, text, NOW);
  const upper = header.replace(/v1=([0-9a-f]+)/, (_m, h) => `v1=${h.toUpperCase()}`);
  assertEquals((await verifySignature(text, upper, SECRET, NOW)).ok, false);
  assertEquals((await verifySignature(text, `t=${NOW},v1=abc`, SECRET, NOW)).ok, false);
});

Deno.test(
  "firma: anti repetición — fuera de 5 minutos (pasado o futuro) se rechaza; dentro, no",
  async () => {
    const text = body();
    const old = await signPayload(SECRET, text, NOW - TOLERANCE_SECONDS - 1);
    const future = await signPayload(SECRET, text, NOW + TOLERANCE_SECONDS + 1);
    const edge = await signPayload(SECRET, text, NOW - TOLERANCE_SECONDS);
    assertEquals((await verifySignature(text, old, SECRET, NOW)).ok, false);
    assertEquals((await verifySignature(text, future, SECRET, NOW)).ok, false);
    assertEquals((await verifySignature(text, edge, SECRET, NOW)).ok, true);
    assertEquals(TOLERANCE_SECONDS, 300);
  },
);

Deno.test("firma: rotación del secreto — vale si CUALQUIERA de los v1 coincide", async () => {
  const text = body();
  const a = await signPayload("secreto-viejo-0123456789", text, NOW);
  const b = await signPayload(SECRET, text, NOW);
  const both = `${a},${b.split(",")[1]}`;
  assertEquals((await verifySignature(text, both, SECRET, NOW)).ok, true);
  assertEquals((await verifySignature(text, a, SECRET, NOW)).ok, false);
});

Deno.test("firma: sin secreto configurado NADA se acepta", async () => {
  const text = body();
  const header = await signPayload(SECRET, text, NOW);
  const result = await verifySignature(text, header, null, NOW);
  assertEquals(result.ok, false);
});

Deno.test("safeEqual compara en largo y contenido", () => {
  assert(safeEqual("abc", "abc"));
  assertEquals(safeEqual("abc", "abd"), false);
  assertEquals(safeEqual("abc", "abcd"), false);
  assertEquals(safeEqual("", ""), true);
});

const parse = async (text: string, secret: string | null = SECRET, at = NOW, signedAt = NOW) =>
  parseSignedGenericEvent(
    { headers: { [SIGNATURE_HEADER]: await signPayload(SECRET, text, signedAt) }, body: text },
    { secret, nowSeconds: at },
  );

Deno.test("aviso genérico: pagado se entiende en términos internos", async () => {
  const parsed = await parse(body());
  assertEquals(parsed, {
    ok: true,
    event: {
      eventId: "evt-1",
      type: "paid",
      reference: "MIC-000123",
      amount: 255,
      currency: "BOB",
      externalId: "tx-9",
    },
  });
});

Deno.test("aviso genérico: cada tipo del proveedor mapea al interno", async () => {
  const map = {
    "payment.paid": "paid",
    "payment.failed": "failed",
    "payment.disputed": "disputed",
    "payment.refunded": "refunded",
  } as const;
  for (const [external, internal] of Object.entries(map)) {
    const parsed = await parse(body({ type: external }));
    assert(parsed.ok);
    if (parsed.ok) assertEquals(parsed.event.type, internal);
  }
});

Deno.test("aviso genérico: lo que falta es opcional salvo el monto de un pago", async () => {
  const minimal = JSON.stringify({
    event_id: "e",
    type: "payment.failed",
    reference: "MIC-000001",
  });
  const parsed = await parse(minimal);
  assert(parsed.ok);
  if (parsed.ok)
    assertEquals(
      [parsed.event.amount, parsed.event.currency, parsed.event.externalId],
      [null, null, null],
    );
  const noAmount = await parse(
    JSON.stringify({ event_id: "e", type: "payment.paid", reference: "MIC-000001" }),
  );
  assertEquals(noAmount.ok, false);
  if (!noAmount.ok) assertEquals(noAmount.status, 400);
});

Deno.test(
  "aviso genérico: firma mala → 401; sin secreto → 503; JSON roto o campos de más → 400",
  async () => {
    const bad = await parseSignedGenericEvent(
      { headers: { [SIGNATURE_HEADER]: "t=1,v1=" + "a".repeat(64) }, body: body() },
      { secret: SECRET, nowSeconds: NOW },
    );
    assertEquals(bad.ok, false);
    if (!bad.ok) assertEquals(bad.status, 401);
    const noSecret = await parse(body(), null);
    assertEquals(noSecret.ok, false);
    if (!noSecret.ok) assertEquals(noSecret.status, 503);
    const broken = await parse("{no es json");
    assertEquals(broken.ok, false);
    if (!broken.ok) assertEquals(broken.status, 400);
    for (const over of [
      { extra: 1 },
      { type: "payment.cualquier" },
      { amount: -1 },
      { currency: "bob" },
      { reference: "" },
      { event_id: "x".repeat(201) },
    ]) {
      const parsed = await parse(body(over));
      assertEquals(parsed.ok, false, JSON.stringify(over));
      if (!parsed.ok) assertEquals(parsed.status, 400);
    }
  },
);

Deno.test(
  "aviso genérico: una firma vieja (repetición) se rechaza aunque el contenido sea válido",
  async () => {
    const text = body();
    const parsed = await parse(text, SECRET, NOW, NOW - 3600);
    assertEquals(parsed.ok, false);
    if (!parsed.ok) assertEquals(parsed.status, 401);
  },
);

Deno.test(
  "registro: QR manual y QR por aviso están; solo el segundo recibe webhooks; el falso no está",
  () => {
    const registry = defaultRegistry();
    assertEquals(registry.ids(), ["cash_on_delivery", "manual_qr", "qr_api", "whatsapp"]);
    assertEquals(registry.get("manual_qr")?.parseWebhook, undefined);
    assert(typeof registry.get("qr_api")?.parseWebhook === "function");
    assertEquals(registry.get("fake"), null);
  },
);

Deno.test("los proveedores QR devuelven su instrucción y no inventan estados", async () => {
  const order = { id: "o", number: "MIC-000001", total: 10, currency: "BOB", method: "qr_manual" };
  const ctx = { order, setting: () => Promise.resolve(null) };
  assertEquals(await manualQrProvider.createCharge(ctx), { kind: "manual_qr" });
  assertEquals(await qrApiProvider.createCharge(ctx), { kind: "qr_api" });
  assertEquals(await manualQrProvider.getStatus(order, "pending"), "pending");
  assertEquals(await qrApiProvider.getStatus(order, "paid"), "paid");
  assertEquals((await manualQrProvider.refund({ order, amount: 10 })).manual, true);
});

// ── conciliación ──
const PAY = (over: Partial<ReconcilePayment> = {}): ReconcilePayment => ({
  id: "p1",
  provider: "fake",
  status: "pending",
  reference: "MIC-000001",
  amount: 255,
  currency: "BOB",
  order: { id: "o1", number: "MIC-000001", method: "fake" },
  ...over,
});
const recorder = () => {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    apply: (event: Record<string, unknown>) => {
      calls.push(event);
      return Promise.resolve({ outcome: "applied" });
    },
  };
};

Deno.test(
  "conciliación: un webhook perdido se recupera — el proveedor dice «pagado» y se aplica una vez, SIN inventar el monto",
  async () => {
    const registry = createRegistry([createFakeProvider({ status: "paid" })]);
    const rec = recorder();
    const report = await reconcilePayments([PAY()], { registry, apply: rec.apply as never });
    assertEquals(report, { checked: 1, changed: 1, errors: 0, unsupported: 0 });
    // `getStatus` dice «pagado» pero no cuánto: el monto va VACÍO (la base lo manda a revisión del administrador). Con el monto
    // esperado (255) un pago de otro importe se habría confirmado como exacto, saltándose S-06.
    assertEquals(rec.calls, [
      {
        provider: "fake",
        eventId: "reconcile:p1:paid",
        type: "paid",
        reference: "MIC-000001",
        amount: null,
        currency: "BOB",
      },
    ]);
  },
);

Deno.test(
  "conciliación: si el proveedor coincide con lo que ya sabemos no se hace nada",
  async () => {
    const registry = createRegistry([createFakeProvider({ status: "pending" })]);
    const rec = recorder();
    const report = await reconcilePayments([PAY()], { registry, apply: rec.apply as never });
    assertEquals(report, { checked: 1, changed: 0, errors: 0, unsupported: 0 });
    assertEquals(rec.calls.length, 0);
  },
);

Deno.test(
  "conciliación: un cobro «initiated» se compara como pendiente; «failed» y «refunded» se aplican sin monto",
  async () => {
    const failed = createRegistry([createFakeProvider({ status: "failed" })]);
    const rec = recorder();
    await reconcilePayments([PAY({ status: "initiated" })], {
      registry: failed,
      apply: rec.apply as never,
    });
    assertEquals(rec.calls[0]?.type, "failed");
    assertEquals(rec.calls[0]?.amount, null);
    const refunded = createRegistry([createFakeProvider({ status: "refunded" })]);
    const rec2 = recorder();
    await reconcilePayments([PAY({ status: "pending" })], {
      registry: refunded,
      apply: rec2.apply as never,
    });
    assertEquals(rec2.calls[0]?.type, "refunded");
  },
);

Deno.test("conciliación: un estado sin traducción (cancelled, expired) no se aplica", async () => {
  const registry = createRegistry([createFakeProvider({ status: "cancelled" })]);
  const rec = recorder();
  const report = await reconcilePayments([PAY()], { registry, apply: rec.apply as never });
  assertEquals(report.changed, 0);
  assertEquals(rec.calls.length, 0);
});

Deno.test(
  "conciliación: el mismo aviso aplicado dos veces cuenta una (el evento es estable por cobro y estado)",
  async () => {
    const registry = createRegistry([createFakeProvider({ status: "paid" })]);
    const seen = new Set<string>();
    const apply = (event: { eventId: string }) => {
      const duplicate = seen.has(event.eventId);
      seen.add(event.eventId);
      return Promise.resolve({ outcome: duplicate ? "duplicate" : "applied" });
    };
    const first = await reconcilePayments([PAY()], { registry, apply: apply as never });
    const second = await reconcilePayments([PAY()], { registry, apply: apply as never });
    assertEquals([first.changed, second.changed], [1, 0]);
  },
);

Deno.test(
  "conciliación: un proveedor que falla no detiene a los demás; uno desconocido se cuenta aparte",
  async () => {
    const broken: PaymentProvider = {
      ...createFakeProvider(),
      id: "roto",
      getStatus: () => Promise.reject(new Error("timeout")),
    };
    const registry = createRegistry([broken, createFakeProvider({ status: "paid" })]);
    const rec = recorder();
    const report = await reconcilePayments(
      [
        PAY({ id: "a", provider: "roto" }),
        PAY({ id: "b", provider: "no-existe" }),
        PAY({ id: "c" }),
      ],
      { registry, apply: rec.apply as never },
    );
    assertEquals(report, { checked: 2, changed: 1, errors: 1, unsupported: 1 });
    assertEquals(rec.calls.length, 1);
  },
);

Deno.test("conciliación: si aplicar el aviso falla se cuenta como error y sigue", async () => {
  const registry = createRegistry([createFakeProvider({ status: "paid" })]);
  const report = await reconcilePayments([PAY(), PAY({ id: "p2" })], {
    registry,
    apply: () => Promise.reject(new Error("base caída")),
  });
  assertEquals(report, { checked: 2, changed: 0, errors: 2, unsupported: 0 });
});
