import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { cashOnDeliveryProvider } from "./payments/cash_on_delivery.ts";
import { type ChargeableOrder, completeCharge } from "./payments/charge.ts";
import { createFakeProvider } from "./payments/fake.ts";
import { createRegistry, defaultRegistry } from "./payments/registry.ts";
import type { ChargeContext, PaymentOrder, PaymentProvider } from "./payments/types.ts";
import { whatsappProvider } from "./payments/whatsapp.ts";

const ORDER: PaymentOrder = {
  id: "o-1",
  number: "MIC-000123",
  total: 255,
  currency: "BOB",
  method: "whatsapp",
};
const ctx = (settings: Record<string, string | null> = {}): ChargeContext => ({
  order: ORDER,
  setting: (key) => Promise.resolve(settings[key] ?? null),
});

Deno.test(
  "el registro de producción trae WhatsApp, contra entrega y los dos QR (S11), y nada más",
  () => {
    assertEquals(defaultRegistry().ids(), ["cash_on_delivery", "manual_qr", "qr_api", "whatsapp"]);
  },
);

Deno.test("el proveedor falso NO está en el registro de producción", () => {
  assertEquals(defaultRegistry().get("fake"), null);
});

Deno.test("un proveedor desconocido da null (no lanza): el checkout decide qué hacer", () => {
  assertEquals(defaultRegistry().get("stripe"), null);
  assertEquals(defaultRegistry().get(""), null);
});

Deno.test("no se pueden registrar dos proveedores con el mismo id", () => {
  assertThrows(() => createRegistry([whatsappProvider, whatsappProvider]), Error, "repetido");
});

Deno.test("WhatsApp devuelve el número configurado de la tienda", async () => {
  const instruction = await whatsappProvider.createCharge(ctx({ whatsapp_orders: "+59167528677" }));
  assertEquals(instruction, { kind: "whatsapp", phone_e164: "+59167528677" });
});

Deno.test(
  "WhatsApp sin número configurado devuelve null (la pantalla avisa, el pedido sí se creó)",
  async () => {
    assertEquals(await whatsappProvider.createCharge(ctx()), {
      kind: "whatsapp",
      phone_e164: null,
    });
  },
);

Deno.test("contra entrega no necesita nada del exterior", async () => {
  assertEquals(await cashOnDeliveryProvider.createCharge(ctx()), {
    kind: "cash_on_delivery",
  });
});

// ── Contrato: cualquier proveedor, real o falso, cumple la misma interfaz ─────────────────────
const providers: PaymentProvider[] = [
  whatsappProvider,
  cashOnDeliveryProvider,
  createFakeProvider(),
];

for (const provider of providers) {
  Deno.test(`contrato [${provider.id}]: tiene id y las 4 operaciones`, () => {
    assert(provider.id.length > 0);
    for (const op of ["createCharge", "handleWebhook", "refund", "getStatus"] as const) {
      assertEquals(typeof provider[op], "function", op);
    }
  });

  Deno.test(
    `contrato [${provider.id}]: createCharge devuelve una instrucción con «kind»`,
    async () => {
      const instruction = await provider.createCharge(ctx({ whatsapp_orders: "+59167528677" }));
      assertEquals(typeof instruction.kind, "string");
      assert(instruction.kind.length > 0);
    },
  );

  Deno.test(
    `contrato [${provider.id}]: getStatus nunca inventa un estado fuera del catálogo`,
    async () => {
      const status = await provider.getStatus(ORDER, "pending");
      assert(["pending", "paid", "failed", "cancelled", "refunded"].includes(status));
    },
  );

  Deno.test(`contrato [${provider.id}]: refund responde con ok y manual`, async () => {
    const result = await provider.refund({ order: ORDER, amount: 10 });
    assertEquals(typeof result.ok, "boolean");
    assertEquals(typeof result.manual, "boolean");
  });
}

Deno.test(
  "los proveedores sin sistema externo reconocen el estado que ya tiene la base y reembolsan a mano",
  async () => {
    for (const provider of [whatsappProvider, cashOnDeliveryProvider]) {
      assertEquals(await provider.getStatus(ORDER, "paid"), "paid");
      assertEquals(await provider.getStatus(ORDER, "cancelled"), "cancelled");
      assertEquals(await provider.refund({ order: ORDER, amount: 10 }), {
        ok: true,
        manual: true,
      });
      assertEquals(await provider.handleWebhook({ headers: {}, body: "{}" }), {
        handled: false,
      });
    }
  },
);

Deno.test(
  "el proveedor falso permite probar el pago, el fallo y el reembolso del flujo genérico",
  async () => {
    const paid = createFakeProvider({ status: "paid" });
    assertEquals(await paid.getStatus(ORDER, "pending"), "paid");
    assertEquals(await paid.createCharge(ctx()), {
      kind: "fake",
      reference: "fake-MIC-000123",
    });
    assertEquals(
      await paid.handleWebhook({
        headers: {},
        body: JSON.stringify({ order_id: "o-1", status: "paid" }),
      }),
      { handled: true, order_id: "o-1", status: "paid" },
    );
    assertEquals((await paid.refund({ order: ORDER, amount: 255 })).ok, true);
    assertEquals(
      (await paid.refund({ order: ORDER, amount: 256 })).ok,
      false,
      "no se reembolsa más de lo cobrado",
    );
    assertEquals((await paid.refund({ order: ORDER, amount: 0 })).ok, false);
    const failing = createFakeProvider({ status: "pending", failCharge: true });
    await assertRejects(() => failing.createCharge(ctx()), Error, "a propósito");
  },
);

Deno.test(
  "un flujo genérico funciona con CUALQUIER proveedor del registro (sin saber cuál es)",
  async () => {
    const registry = createRegistry([
      whatsappProvider,
      cashOnDeliveryProvider,
      createFakeProvider(),
    ]);
    for (const id of registry.ids()) {
      const provider = registry.get(id)!;
      const instruction = await provider.createCharge(ctx({ whatsapp_orders: "+59167528677" }));
      assertEquals(typeof instruction.kind, "string", id);
    }
  },
);

// ── completeCharge: lo que hace la Edge Function tras crear el pedido (proveedor ausente, que falla, o que responde) ──
const CHARGEABLE: ChargeableOrder = { ...ORDER, provider: "whatsapp" };
const settings = (key: string) =>
  Promise.resolve(key === "whatsapp_orders" ? "+59167528677" : null);

Deno.test(
  "completeCharge: con un proveedor real devuelve su instrucción y ningún problema",
  async () => {
    const outcome = await completeCharge(defaultRegistry(), CHARGEABLE, settings);
    assertEquals(outcome, {
      instruction: { kind: "whatsapp", phone_e164: "+59167528677" },
      problem: null,
    });
  },
);

Deno.test(
  "completeCharge: le pasa al proveedor el pedido SIN el campo «provider» (solo lo que PaymentOrder define)",
  async () => {
    let received: PaymentOrder | null = null;
    const spy: PaymentProvider = {
      ...createFakeProvider(),
      async createCharge(c) {
        received = c.order;
        return { kind: "fake", reference: "r" };
      },
    };
    await completeCharge(
      createRegistry([spy]),
      {
        ...CHARGEABLE,
        provider: "fake",
      },
      settings,
    );
    assertEquals(received, ORDER);
  },
);

Deno.test(
  "completeCharge: un método con un proveedor que no está implementado NO lanza: «provider_unavailable»",
  async () => {
    const outcome = await completeCharge(
      defaultRegistry(),
      { ...CHARGEABLE, provider: "stripe" },
      settings,
    );
    assertEquals(outcome.instruction, null);
    assertEquals(outcome.problem, "provider_unavailable");
    assertEquals(outcome.cause, "stripe");
  },
);

Deno.test(
  "completeCharge: un proveedor que lanza NO propaga el error: «provider_failed» con la causa para el registro",
  async () => {
    const registry = createRegistry([createFakeProvider({ status: "pending", failCharge: true })]);
    const outcome = await completeCharge(
      registry,
      {
        ...CHARGEABLE,
        provider: "fake",
      },
      settings,
    );
    assertEquals(outcome.instruction, null);
    assertEquals(outcome.problem, "provider_failed");
    assert(outcome.cause?.includes("falló a propósito"));
  },
);

Deno.test(
  "completeCharge: la causa técnica es solo para el servidor; la respuesta al cliente lleva el código estable",
  async () => {
    const registry = createRegistry([createFakeProvider({ status: "pending", failCharge: true })]);
    const outcome = await completeCharge(
      registry,
      {
        ...CHARGEABLE,
        provider: "fake",
      },
      settings,
    );
    // lo único que la Edge Function copia a la respuesta es `problem` (un código), nunca `cause`
    assert(["provider_unavailable", "provider_failed"].includes(outcome.problem as string));
  },
);
