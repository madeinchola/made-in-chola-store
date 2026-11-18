import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearRateLimits, fn, randomTag, rpc } from "../../../test-support/api";
import { makeCustomer, makeProduct, type Customer } from "../../../test-support/shop";

/**
 * «Descargar mis datos» (Sprint 15) contra la nube, por HTTP real: cada persona recibe SU información (perfil, dirección, pedido con sus
 * líneas) y nada del negocio (costo) ni de otra persona; sin sesión no hay nada. Crea dos clientas con dirección, un producto con costo y
 * un pedido que se cancela al final.
 */
let a: Customer;
let b: Customer;
let orderId = "";
let orderNumber = "";

beforeAll(async () => {
  await clearRateLimits();
  a = await makeCustomer();
  b = await makeCustomer();
  const product = await makeProduct(80, 5); // cost_base 10: el costo SÍ existe y no debe salir
  await fn(
    "cart",
    { action: "set_item", variant_id: product.variantId, qty: 2 },
    { token: a.token },
  );
  const preview = await fn(
    "checkout",
    {
      action: "preview",
      shipping_method: "delivery",
      address_id: a.addressId,
      payment_method: "whatsapp",
    },
    { token: a.token },
  );
  const created = await fn(
    "checkout",
    {
      action: "create",
      shipping_method: "delivery",
      address_id: a.addressId,
      payment_method: "whatsapp",
      contact_name: "Clienta de datos",
      contact_phone: "+59171234567",
      expected_total: preview.body.checkout.totals.total,
      idempotency_key: `k-${randomTag()}-${randomTag()}`,
    },
    { token: a.token },
  );
  orderId = created.body.order?.id as string;
  orderNumber = created.body.order?.number as string;
}, 180_000);

afterAll(async () => {
  if (orderId) await fn("checkout", { action: "cancel", order_id: orderId }, { token: a.token });
  await clearRateLimits();
}, 60_000);

describe("my_data_export (HTTP real)", () => {
  it("sin sesión no devuelve nada", async () => {
    const res = await rpc("my_data_export", {});
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("devuelve lo de quien la llama: perfil, dirección y su pedido con sus líneas; y NADA del costo ni de otra persona", async () => {
    const res = await rpc("my_data_export", {}, a.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const data = res.body as Record<string, unknown> & {
      orders: { number: string; items: { qty: number }[] }[];
      addresses: { line1: string }[];
    };
    expect(data.format_version).toBe(1);
    expect(data.addresses.map((x) => x.line1)).toEqual(["Calle del E2E 123"]);
    const mine = data.orders.find((o) => o.number === orderNumber);
    expect(mine, "el pedido de la persona está").toBeDefined();
    expect(mine!.items).toHaveLength(1);
    expect(mine!.items[0]!.qty).toBe(2);
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/cost_unit|idempotency_key|request_hash|ip_hash/);
    expect(JSON.stringify(data.profile)).not.toContain('"role"');
  });

  it("la otra clienta recibe lo SUYO: sin el pedido de la primera", async () => {
    const res = await rpc("my_data_export", {}, b.token);
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(orderNumber);
    expect((res.body as { orders: unknown[] }).orders).toEqual([]);
  });
});
