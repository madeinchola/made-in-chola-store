import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearRateLimits,
  fn,
  randomTag,
  registerAndLogin,
  rest,
  svcRest,
  svcRpc,
  testEnv,
} from "../../../test-support/api";

/**
 * Checkout (Sprint 10) contra la nube: la función `checkout` por HTTP real, la RLS con tokens de clientas y la
 * concurrencia REAL de `create_order` (100 intentos simultáneos sobre 10 unidades). Los importes esperados se calculan a
 * mano; el costo de envío se LEE de la vista previa del servidor (depende de las tarifas de ejemplo de S8) y se comprueba
 * que total = subtotal − descuento + envío al centavo.
 *
 * Deja en la nube clientas de prueba inertes (`@prueba.test`), pedidos cancelados y productos de prueba archivables:
 * nada se borra (inmutables a propósito); la entrega vacía la base con `db reset --linked --no-seed`.
 */

interface Customer {
  token: string;
  id: string;
  addressId: string;
}
interface Made {
  productId: string;
  variantId: string;
}

async function makeProduct(opts: { name: string; price: number; stock: number }): Promise<Made> {
  const tag = randomTag();
  const product = await svcRest("POST", "products", {
    code: `K${tag}`.toUpperCase(),
    slug: `pedido-${tag}`,
    name: opts.name,
    cost_base: 10,
  });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  const productId = product.body[0].id as string;
  const color = await svcRest("POST", "product_colors", { product_id: productId, name: "Único" });
  expect(color.status, JSON.stringify(color.body)).toBe(201);
  const variant = await svcRest("POST", "product_variants", {
    product_id: productId,
    color_id: color.body[0].id,
  });
  expect(variant.status, JSON.stringify(variant.body)).toBe(201);
  const variantId = variant.body[0].id as string;
  const price = await svcRest("POST", "product_prices", {
    product_id: productId,
    currency: "BOB",
    amount: opts.price,
  });
  expect(price.status, JSON.stringify(price.body)).toBe(201);
  if (opts.stock > 0) {
    const stock = await svcRpc("apply_stock_change", {
      p_variant_id: variantId,
      p_delta: opts.stock,
      p_reason: "import",
      p_note: "stock de prueba de pedidos",
    });
    expect(stock.status, JSON.stringify(stock.body)).toBe(200);
  }
  const publish = await svcRest("PATCH", `products?id=eq.${productId}`, { status: "active" });
  expect(publish.status, JSON.stringify(publish.body)).toBe(200);
  return { productId, variantId };
}

const stockOf = async (variantId: string): Promise<number> => {
  const res = await svcRest("GET", `product_variants?id=eq.${variantId}&select=stock_on_hand`);
  return res.body[0].stock_on_hand as number;
};

async function makeCustomer(label: string): Promise<Customer> {
  await clearRateLimits(); // el registro admite pocos intentos por hora y red; los tests comparten IP
  const user = await registerAndLogin({ name: `Cliente ${label}` });
  const address = await rest("POST", "addresses", user.token, {
    profile_id: user.id,
    label: "Casa",
    recipient: `Cliente ${label}`,
    phone_e164: "+59171234567",
    line1: `Calle ${label}`,
    city: "La Paz",
    country: "BO",
    lat: -16.52,
    lng: -68.15,
  });
  expect(address.status, JSON.stringify(address.body)).toBe(201);
  return { token: user.token, id: user.id, addressId: address.body[0].id as string };
}

const addToCart = (c: Customer, variantId: string, qty: number) =>
  fn("cart", { action: "set_item", variant_id: variantId, qty }, { token: c.token });

const previewOf = (c: Customer, payment = "whatsapp") =>
  fn(
    "checkout",
    {
      action: "preview",
      shipping_method: "delivery",
      address_id: c.addressId,
      payment_method: payment,
    },
    { token: c.token },
  );

const createFor = (
  c: Customer,
  total: number,
  key: string,
  extra: Record<string, unknown> = {},
  token: string | undefined = c.token,
) =>
  fn(
    "checkout",
    {
      action: "create",
      shipping_method: "delivery",
      address_id: c.addressId,
      payment_method: "whatsapp",
      contact_name: "Cliente de prueba",
      contact_phone: "+59171234567",
      expected_total: total,
      idempotency_key: key,
      ...extra,
    },
    token ? { token } : {},
  );

const key = () => `k-${randomTag()}-${randomTag()}`;
const cents = (n: number) => Math.round(n * 100);

let ready: string | null = null;
let reserveSetting = "true";

beforeAll(async () => {
  await clearRateLimits();
  const probe = await fn("checkout", { action: "preview", shipping_method: "delivery" });
  if (probe.status === 404) ready = "La función `checkout` no está desplegada.";
  const methods = await svcRest("GET", "public_shipping_methods?code=eq.delivery&select=code");
  if (!ready && (methods.body as unknown[]).length === 0)
    ready = "Faltan los métodos de envío de ejemplo (S8).";
  const pay = await svcRest(
    "GET",
    "payment_methods?code=eq.whatsapp&is_active=eq.true&select=code",
  );
  if (!ready && (pay.body as unknown[]).length === 0)
    ready = "Falta el método de pago «whatsapp» (S10).";
  const setting = await svcRest("GET", "store_settings?key=eq.reserve_on_add_to_cart&select=value");
  reserveSetting = String(setting.body[0]?.value ?? "true");
});

afterAll(async () => {
  await svcRest("PATCH", "store_settings?key=eq.reserve_on_add_to_cart", {
    value: reserveSetting === "false" ? false : true,
  });
  await svcRest("PATCH", "payment_methods?code=eq.cash_on_delivery", { max_amount: null });
  await clearRateLimits();
});

const guard = () => {
  if (ready) throw new Error(`Prueba omitida: ${ready}`);
};

describe("checkout · acceso y validación (HTTP real)", () => {
  it("sin sesión no hay checkout (toda compra requiere cuenta): 401 login_required", async () => {
    guard();
    const res = await fn("checkout", { action: "preview", shipping_method: "delivery" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("login_required");
  });

  it("la clave anónima no vale como sesión: 401", async () => {
    guard();
    const res = await fn(
      "checkout",
      { action: "preview", shipping_method: "delivery" },
      { token: testEnv().anon },
    );
    expect(res.status).toBe(401);
  });

  it("el esquema es estricto: un campo de más (p. ej. un precio) → 400", async () => {
    guard();
    const c = await makeCustomer("esquema");
    const res = await fn(
      "checkout",
      { action: "preview", shipping_method: "delivery", total: 1 },
      { token: c.token },
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation");
  });

  it("un cuerpo de más de 2 kB se corta con 413 y un JSON roto da 400", async () => {
    guard();
    const c = await makeCustomer("cuerpo");
    const big = await fn(
      "checkout",
      { action: "preview", shipping_method: "delivery", pad: "x".repeat(3000) },
      { token: c.token },
    );
    expect(big.status).toBe(413);
    const broken = await fetch(`${testEnv().url}/functions/v1/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: testEnv().anon,
        Authorization: `Bearer ${c.token}`,
      },
      body: "{",
    });
    expect(broken.status).toBe(400);
  });

  it("solo POST: GET → 405", async () => {
    guard();
    const res = await fetch(`${testEnv().url}/functions/v1/checkout`, {
      method: "GET",
      headers: { apikey: testEnv().anon },
    });
    expect(res.status).toBe(405);
  });
});

describe("checkout · compra de extremo a extremo", () => {
  it("vista previa → crear → leer → cancelar: los importes cuadran al centavo y el stock se mueve y se repone", async () => {
    guard();
    const product = await makeProduct({ name: "Prenda de pedido E2E", price: 100, stock: 10 });
    const c = await makeCustomer("feliz");
    expect((await addToCart(c, product.variantId, 2)).status).toBe(200);

    const pv = await previewOf(c);
    expect(pv.status, JSON.stringify(pv.body)).toBe(200);
    const view = pv.body.checkout;
    expect(view.ok, JSON.stringify(view.errors)).toBe(true);
    expect(view.totals.subtotal).toBe(200); // 2 × 100,00
    const shipping = view.totals.shipping as number;
    expect(shipping).toBeGreaterThan(0);
    expect(cents(view.totals.total)).toBe(cents(200 + shipping)); // sin descuento
    const methods = view.payment.methods as { code: string; available: boolean }[];
    expect(methods.map((m) => m.code).sort()).toEqual(["cash_on_delivery", "whatsapp"]);

    const before = await stockOf(product.variantId);
    expect(before).toBe(10);
    const k = key();
    const res = await createFor(c, view.totals.total, k);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.outcome).toBe("created");
    const order = res.body.order;
    expect(order.number).toMatch(/^MIC-\d{6,}$/);
    expect(order.status).toBe("pending_payment");
    expect(order.subtotal).toBe(200);
    expect(order.shipping_cost).toBe(shipping);
    expect(cents(order.total)).toBe(cents(200 + shipping));
    expect(order.items).toHaveLength(1);
    expect(order.items[0].qty).toBe(2);
    expect(order.items[0].unit_price).toBe(100);
    // el proveedor de pago devuelve la instrucción (y el número de WhatsApp es el público de la tienda)
    expect(res.body.payment_error).toBeNull();
    expect(res.body.payment_instruction.kind).toBe("whatsapp");
    const store = await svcRest("GET", "store_settings?key=eq.whatsapp_orders&select=value");
    expect(res.body.payment_instruction.phone_e164).toBe(store.body[0].value);

    // stock firme descontado y movimiento de venta con el número del pedido
    expect(await stockOf(product.variantId)).toBe(8);
    const moves = await svcRest(
      "GET",
      `stock_movements?ref=eq.${order.number}&select=delta,reason`,
    );
    expect(moves.body).toEqual([{ delta: -2, reason: "sale" }]);

    // la clienta lo lee con SU sesión (resiliencia: sigue ahí aunque no abra WhatsApp)
    const mine = await rest(
      "GET",
      `orders?number=eq.${order.number}&select=number,status,total,order_items(qty),payments(status,provider)`,
      c.token,
    );
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].payments).toEqual([{ status: "pending", provider: "whatsapp" }]);

    // el carrito quedó convertido: la vista previa dice que no hay bolsa
    expect((await previewOf(c)).body.outcome).toBe("no_cart");

    // cancelar (criterio 5): repone el stock
    const cancel = await fn(
      "checkout",
      { action: "cancel", order_id: order.id, reason: "prueba" },
      { token: c.token },
    );
    expect(cancel.body).toMatchObject({ ok: true, outcome: "transitioned" });
    expect(await stockOf(product.variantId)).toBe(10);
    const after = await rest("GET", `orders?id=eq.${order.id}&select=status,cancelled_by`, c.token);
    expect(after.body[0]).toEqual({ status: "cancelled", cancelled_by: "customer" });
  });

  it("idempotencia por HTTP (criterio 4): la misma llave devuelve el MISMO pedido y no descuenta dos veces", async () => {
    guard();
    const product = await makeProduct({ name: "Prenda idempotente", price: 40, stock: 5 });
    const c = await makeCustomer("idem");
    await addToCart(c, product.variantId, 1);
    const total = (await previewOf(c)).body.checkout.totals.total as number;
    const k = key();
    const first = await createFor(c, total, k);
    expect(first.body.outcome).toBe("created");
    const second = await createFor(c, total, k);
    expect(second.body.outcome).toBe("existing");
    expect(second.body.order.id).toBe(first.body.order.id);
    expect(await stockOf(product.variantId)).toBe(4);
    // la MISMA llave con OTRO contenido (otro método de pago) no devuelve el pedido viejo: es un conflicto
    const other = await createFor(c, total, k, { payment_method: "cash_on_delivery" });
    expect(other.body.outcome).toBe("rejected");
    expect(other.body.errors[0].code).toBe("idempotency_conflict");
    expect(await stockOf(product.variantId)).toBe(4);
    const mine = await rest("GET", "orders?select=id", c.token);
    expect(mine.body).toHaveLength(1);
    await fn("checkout", { action: "cancel", order_id: first.body.order.id }, { token: c.token });
  });

  it("BR-CHK-04: si el total que vio no coincide, NO se crea y se le muestra la diferencia", async () => {
    guard();
    const product = await makeProduct({ name: "Prenda revalidada", price: 30, stock: 5 });
    const c = await makeCustomer("reval");
    await addToCart(c, product.variantId, 1);
    const total = (await previewOf(c)).body.checkout.totals.total as number;
    const res = await createFor(c, total - 5, key());
    expect(res.body.outcome).toBe("changed");
    expect(res.body.reason).toBe("total");
    expect(res.body.expected_total).toBeCloseTo(total - 5, 2);
    expect(res.body.actual_total).toBeCloseTo(total, 2);
    expect(await stockOf(product.variantId)).toBe(5);
    expect((await rest("GET", "orders?select=id", c.token)).body).toHaveLength(0);
    // con el total correcto sí se crea
    const ok = await createFor(c, total, key());
    expect(ok.body.outcome).toBe("created");
    await fn("checkout", { action: "cancel", order_id: ok.body.order.id }, { token: c.token });
  });

  it("sin stock suficiente: «unavailable» con el detalle por línea y nada se crea", async () => {
    guard();
    const product = await makeProduct({ name: "Prenda justa", price: 20, stock: 3 });
    const c = await makeCustomer("stock");
    await addToCart(c, product.variantId, 3);
    // el admin baja el stock a 1 mientras la clienta completaba sus datos
    await svcRpc("apply_stock_change", {
      p_variant_id: product.variantId,
      p_delta: -2,
      p_reason: "adjust",
      p_note: "prueba",
    });
    const total = (await previewOf(c)).body.checkout.totals.total ?? 100;
    const res = await createFor(c, total, key());
    expect(res.body.outcome).toBe("unavailable");
    expect(res.body.lines[0].status).toBe("low_stock");
    expect(res.body.lines[0].available).toBe(1);
    expect(await stockOf(product.variantId)).toBe(1);
    expect((await rest("GET", "orders?select=id", c.token)).body).toHaveLength(0);
  });

  it("lista negra (S-07): sin contra entrega, pero compra por WhatsApp sin problema", async () => {
    guard();
    const product = await makeProduct({ name: "Prenda lista negra", price: 25, stock: 5 });
    const c = await makeCustomer("negra");
    await addToCart(c, product.variantId, 1);
    await svcRest("PATCH", `profiles?id=eq.${c.id}`, { blacklisted: true });
    const pv = await previewOf(c, "cash_on_delivery");
    const cod = (
      pv.body.checkout.payment.methods as {
        code: string;
        available: boolean;
        reason: string | null;
      }[]
    ).find((m) => m.code === "cash_on_delivery")!;
    expect(cod.available).toBe(false);
    expect(cod.reason).toBe("not_available"); // no se le dice que está en la lista negra
    const total = pv.body.checkout.totals.total as number;
    const blocked = await createFor(c, total, key(), { payment_method: "cash_on_delivery" });
    expect(blocked.body.outcome).toBe("rejected");
    expect(blocked.body.errors[0].code).toBe("payment_unavailable");
    expect(await stockOf(product.variantId)).toBe(5);
    const okRes = await createFor(c, total, key());
    expect(okRes.body.outcome).toBe("created");
    await fn("checkout", { action: "cancel", order_id: okRes.body.order.id }, { token: c.token });
    await svcRest("PATCH", `profiles?id=eq.${c.id}`, { blacklisted: false });
  });

  it("contra entrega crea el pedido y su instrucción es «cash_on_delivery»", async () => {
    guard();
    const product = await makeProduct({ name: "Prenda contra entrega", price: 25, stock: 5 });
    const c = await makeCustomer("cod");
    await addToCart(c, product.variantId, 1);
    const total = (await previewOf(c, "cash_on_delivery")).body.checkout.totals.total as number;
    const res = await createFor(c, total, key(), { payment_method: "cash_on_delivery" });
    expect(res.body.outcome).toBe("created");
    expect(res.body.payment_instruction).toEqual({ kind: "cash_on_delivery" });
    expect(res.body.order.payment_provider).toBe("cash_on_delivery");
    await fn("checkout", { action: "cancel", order_id: res.body.order.id }, { token: c.token });
  });
});

describe("checkout · RLS y aislamiento entre clientas", () => {
  it("una clienta solo ve SUS pedidos y no puede cancelar, editar ni borrar los de otra", async () => {
    guard();
    const product = await makeProduct({ name: "Prenda aislada", price: 15, stock: 5 });
    const a = await makeCustomer("rls-a");
    const b = await makeCustomer("rls-b");
    await addToCart(a, product.variantId, 1);
    const total = (await previewOf(a)).body.checkout.totals.total as number;
    const created = await createFor(a, total, key());
    expect(created.body.outcome).toBe("created");
    const orderId = created.body.order.id as string;

    // B no ve nada de A (ni por id ni por número)
    expect((await rest("GET", "orders?select=id", b.token)).body).toHaveLength(0);
    expect((await rest("GET", `orders?id=eq.${orderId}&select=id`, b.token)).body).toHaveLength(0);
    expect((await rest("GET", "order_items?select=id", b.token)).body).toHaveLength(0);
    expect((await rest("GET", "payments?select=id", b.token)).body).toHaveLength(0);
    // el anónimo ni siquiera puede consultar la tabla
    const anon = await rest("GET", "orders?select=id");
    expect(anon.status).toBe(401);

    // B no puede cancelar el pedido de A: responde «no existe» y el pedido sigue igual
    const cancel = await fn(
      "checkout",
      { action: "cancel", order_id: orderId },
      { token: b.token },
    );
    expect(cancel.body).toMatchObject({ ok: false, outcome: "not_found" });
    // ni editar, ni borrar, ni crear pedidos a mano
    expect([401, 403]).toContain(
      (await rest("PATCH", `orders?id=eq.${orderId}`, a.token, { total: 1 })).status,
    );
    expect([401, 403]).toContain((await rest("DELETE", `orders?id=eq.${orderId}`, a.token)).status);
    expect([401, 403]).toContain(
      (await rest("POST", "orders", a.token, { number: "MIC-999999", profile_id: a.id })).status,
    );
    const still = await svcRest("GET", `orders?id=eq.${orderId}&select=status,total`);
    expect(still.body[0].status).toBe("pending_payment");
    expect(cents(still.body[0].total)).toBe(cents(total));

    // y NO puede ejecutar las funciones del servidor directamente
    const direct = await fetch(`${testEnv().url}/rest/v1/rpc/create_order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: testEnv().anon,
        Authorization: `Bearer ${a.token}`,
      },
      body: JSON.stringify({}),
    });
    expect([401, 403, 404]).toContain(direct.status);

    await fn("checkout", { action: "cancel", order_id: orderId }, { token: a.token });
  });
});

describe("checkout · lo que la clienta NO debe leer ni acaparar", () => {
  it("A1: la clienta lee sus líneas pero NO el costo del producto (order_items.cost_unit) ni las notas internas del historial", async () => {
    guard();
    const product = await makeProduct({ name: "Prenda costo oculto", price: 50, stock: 3 }); // cost_base 10
    const c = await makeCustomer("costo");
    await addToCart(c, product.variantId, 1);
    const total = (await previewOf(c)).body.checkout.totals.total as number;
    const created = await createFor(c, total, key());
    expect(created.body.outcome).toBe("created");
    const orderId = created.body.order.id as string;

    // lo que «Mis pedidos» necesita se lee
    const lines = await rest(
      "GET",
      `order_items?order_id=eq.${orderId}&select=product_name,qty,unit_price,final_total`,
      c.token,
    );
    expect(lines.status).toBe(200);
    expect(lines.body).toHaveLength(1);
    const history = await rest(
      "GET",
      `order_status_history?order_id=eq.${orderId}&select=to_status,created_at`,
      c.token,
    );
    expect(history.status).toBe(200);
    expect(history.body.length).toBeGreaterThanOrEqual(1);

    // lo que es del negocio, no: ni pidiéndolo, ni con «*», ni embebido desde el pedido
    for (const path of [
      `order_items?order_id=eq.${orderId}&select=cost_unit`,
      `order_items?order_id=eq.${orderId}&select=*`,
      `orders?id=eq.${orderId}&select=order_items(cost_unit)`,
      `order_status_history?order_id=eq.${orderId}&select=reason`,
      `order_status_history?order_id=eq.${orderId}&select=actor_id`,
      `order_status_history?order_id=eq.${orderId}&select=*`,
    ]) {
      const res = await rest("GET", path, c.token);
      expect([401, 403], path).toContain(res.status);
    }
    // el servidor sí lo guarda (informes de margen, S14)
    const server = await svcRest("GET", `order_items?order_id=eq.${orderId}&select=cost_unit`);
    expect(Number(server.body[0].cost_unit)).toBe(10);
    await fn("checkout", { action: "cancel", order_id: orderId }, { token: c.token });
  });

  it("M2: una clienta no puede acaparar el inventario con pedidos sin confirmar: el 6.º se rechaza y al cancelar uno vuelve a poder", async () => {
    guard();
    const product = await makeProduct({ name: "Prenda tope abiertos", price: 10, stock: 20 });
    const c = await makeCustomer("tope");
    const cap = Number(
      (await svcRest("GET", "store_settings?key=eq.open_orders_max&select=value")).body[0].value,
    );
    expect(cap).toBe(5);
    const placed: string[] = [];
    for (let i = 0; i < cap; i++) {
      await addToCart(c, product.variantId, 1);
      const total = (await previewOf(c)).body.checkout.totals.total as number;
      const res = await createFor(c, total, key());
      expect(res.body.outcome, `pedido ${i + 1}: ${JSON.stringify(res.body)}`).toBe("created");
      placed.push(res.body.order.id);
    }
    await addToCart(c, product.variantId, 1);
    const total = (await previewOf(c)).body.checkout.totals.total as number;
    const sixth = await createFor(c, total, key());
    expect(sixth.body.outcome).toBe("rejected");
    expect(sixth.body.errors[0].code).toBe("too_many_open_orders");
    expect(await stockOf(product.variantId)).toBe(20 - cap); // el rechazado no descontó nada
    // cancelar uno libera un cupo
    const cancel = await fn(
      "checkout",
      { action: "cancel", order_id: placed[0] },
      { token: c.token },
    );
    expect(cancel.body.ok).toBe(true);
    const again = await createFor(c, total, key());
    expect(again.body.outcome, JSON.stringify(again.body)).toBe("created");
    placed.push(again.body.order.id);
    for (const id of placed.slice(1)) {
      await fn("checkout", { action: "cancel", order_id: id }, { token: c.token });
    }
    expect(await stockOf(product.variantId)).toBe(20);
  }, 240_000);
});

describe("checkout · límites de tasa", () => {
  it("crear pedidos tiene tope por clienta: el 11.º intento en 10 minutos da 429 con Retry-After", async () => {
    guard();
    const c = await makeCustomer("tasa");
    await clearRateLimits();
    let last = 0;
    let retry: string | null = null;
    for (let i = 0; i < 11; i++) {
      const res = await createFor(c, 1, key()); // sin bolsa: se rechaza sin tocar nada, pero cada intento cuenta
      last = res.status;
      retry = res.headers.get("retry-after");
      if (i < 10) expect(res.status, `intento ${i + 1}`).toBe(200);
    }
    expect(last).toBe(429);
    expect(Number(retry)).toBeGreaterThan(0);
    await clearRateLimits();
  });
});

describe("checkout · concurrencia REAL de create_order (BR-DAT-02, criterios 2 y 4)", () => {
  it("100 intentos simultáneos de 25 clientas sobre 10 unidades: se venden EXACTAMENTE 10, sin stock negativo, sin números repetidos ni huecos", async () => {
    guard();
    // Sin retención al agregar: todas pueden llenar su bolsa y la competencia ocurre al crear el pedido.
    await svcRest("PATCH", "store_settings?key=eq.reserve_on_add_to_cart", { value: false });
    const product = await makeProduct({ name: "Última tanda", price: 100, stock: 10 });
    const customers: Customer[] = [];
    for (let i = 0; i < 25; i++) customers.push(await makeCustomer(`c${i}`));
    for (const c of customers) expect((await addToCart(c, product.variantId, 1)).status).toBe(200);
    const total = (await previewOf(customers[0]!)).body.checkout.totals.total as number;
    const counterBefore = (await svcRest("GET", "order_counters?prefix=eq.MIC&select=last_value"))
      .body[0].last_value as number;
    expect(await stockOf(product.variantId)).toBe(10);

    // Por clienta: 2 intentos con la MISMA llave y 2 con llaves distintas, todos a la vez.
    const attempts = customers.flatMap((c) => {
      const same = key();
      const args = (k: string) => ({
        p_profile_id: c.id,
        p_address_id: c.addressId,
        p_tax_profile_id: null,
        p_shipping_method: "delivery",
        p_slot_id: null,
        p_delivery_date: null,
        p_payment_method: "whatsapp",
        p_contact_name: "Cliente",
        p_contact_email: null,
        p_contact_phone: "+59171234567",
        p_expected_total: total,
        p_idempotency_key: k,
      });
      return [same, same, key(), key()].map((k) => svcRpc("create_order", args(k)));
    });
    expect(attempts).toHaveLength(100);
    const results = await Promise.all(attempts);
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);

    const tally = { created: 0, existing: 0, rejected: 0, unavailable: 0, other: 0 };
    const created: { id: string; number: string; profile: string }[] = [];
    results.forEach((r, index) => {
      const outcome = r.body.outcome as keyof typeof tally;
      if (outcome in tally) tally[outcome]++;
      else tally.other++;
      if (outcome === "created") {
        created.push({
          id: r.body.order.id,
          number: r.body.order.number,
          profile: customers[Math.floor(index / 4)]!.id,
        });
      }
    });
    expect(tally.other).toBe(0);
    expect(tally.created + tally.existing + tally.rejected + tally.unavailable).toBe(100);

    // EXACTAMENTE 10 pedidos creados y el stock en 0 (nunca negativo)
    expect(tally.created).toBe(10);
    expect(await stockOf(product.variantId)).toBe(0);
    // una clienta, a lo sumo un pedido creado; y lo que dice la base coincide con lo que dijeron las respuestas
    expect(new Set(created.map((o) => o.profile)).size).toBe(10);
    const inDb = await svcRest(
      "GET",
      `orders?id=in.(${created.map((o) => o.id).join(",")})&select=id,number,total,status&order=number`,
    );
    expect(inDb.body).toHaveLength(10);
    // los perdedores no dejaron nada: ni pedidos ni movimientos
    const allOrders = await svcRest(
      "GET",
      `orders?profile_id=in.(${customers.map((c) => c.id).join(",")})&select=id`,
    );
    expect(allOrders.body).toHaveLength(10);
    const sales = await svcRest(
      "GET",
      `stock_movements?variant_id=eq.${product.variantId}&reason=eq.sale&select=delta,stock_after,ref&order=id`,
    );
    expect(sales.body).toHaveLength(10);
    expect(sales.body.every((m: { delta: number }) => m.delta === -1)).toBe(true);
    expect(Math.min(...sales.body.map((m: { stock_after: number }) => m.stock_after))).toBe(0);
    // números: 10 distintos y CONSECUTIVOS a partir del contador anterior (sin huecos aunque 90 intentos fallaron)
    const numbers = created.map((o) => Number(o.number.split("-")[1])).sort((x, y) => x - y);
    expect(numbers).toEqual(Array.from({ length: 10 }, (_, i) => counterBefore + 1 + i));
    const counterAfter = (await svcRest("GET", "order_counters?prefix=eq.MIC&select=last_value"))
      .body[0].last_value as number;
    expect(counterAfter).toBe(counterBefore + 10);
    // cada «existing» apunta a un pedido que SÍ se creó
    for (const r of results.filter((x) => x.body.outcome === "existing")) {
      expect(created.map((o) => o.id)).toContain(r.body.order.id);
    }

    // limpieza: cancelar los 10 repone las 10 unidades
    for (const o of created) {
      const res = await svcRpc("cancel_order_by_customer", {
        p_profile_id: o.profile,
        p_order_id: o.id,
        p_reason: "limpieza de prueba",
      });
      expect(res.body.ok).toBe(true);
    }
    expect(await stockOf(product.variantId)).toBe(10);
    await svcRest("PATCH", "store_settings?key=eq.reserve_on_add_to_cart", {
      value: reserveSetting === "false" ? false : true,
    });
  }, 300_000);
});

describe("checkout · cupón de UN solo uso y última unidad a la vez (atomicidad)", () => {
  it("dos clientas compiten por el cupón y la última unidad: gana una con las dos cosas; la otra no gasta nada; al cancelar, todo se devuelve", async () => {
    guard();
    await svcRest("PATCH", "store_settings?key=eq.reserve_on_add_to_cart", { value: false });
    const product = await makeProduct({ name: "Última unidad con cupón", price: 100, stock: 1 });
    const tag = randomTag().toUpperCase();
    const discount = await svcRest("POST", "discounts", {
      name: `E2E cupón único ${tag}`,
      kind: "percent",
      params: { percent: 10 },
      requires_coupon: true,
    });
    expect(discount.status, JSON.stringify(discount.body)).toBe(201);
    const discountId = discount.body[0].id as string;
    const code = `UN${tag}`;
    const coupon = await svcRest("POST", "coupons", {
      discount_id: discountId,
      code,
      usage_limit: 1,
    });
    expect(coupon.status, JSON.stringify(coupon.body)).toBe(201);

    const a = await makeCustomer("cupon-a");
    const b = await makeCustomer("cupon-b");
    for (const c of [a, b]) {
      expect((await addToCart(c, product.variantId, 1)).status).toBe(200);
      const set = await fn("cart", { action: "set_coupon", code }, { token: c.token });
      expect(set.body.outcome, JSON.stringify(set.body)).toBe("coupon_set");
    }
    const pv = await previewOf(a);
    const total = pv.body.checkout.totals.total as number;
    expect(pv.body.checkout.totals.discount).toBe(10); // 10 % de 100,00
    const args = (c: Customer) => ({
      p_profile_id: c.id,
      p_address_id: c.addressId,
      p_tax_profile_id: null,
      p_shipping_method: "delivery",
      p_slot_id: null,
      p_delivery_date: null,
      p_payment_method: "whatsapp",
      p_contact_name: "Cliente",
      p_contact_email: null,
      p_contact_phone: "+59171234567",
      p_expected_total: total,
      p_idempotency_key: key(),
    });
    const [ra, rb] = await Promise.all([
      svcRpc("create_order", args(a)),
      svcRpc("create_order", args(b)),
    ]);
    const outcomes = [ra.body.outcome, rb.body.outcome].sort();
    expect(outcomes, JSON.stringify([ra.body, rb.body])).toEqual(["created", "unavailable"]);
    const [winner, loser, win] = ra.body.outcome === "created" ? [a, b, ra] : [b, a, rb];

    // el ganador se llevó la unidad Y el uso del cupón; el perdedor no gastó ni stock ni cupón
    expect(await stockOf(product.variantId)).toBe(0);
    const uses = await svcRest(
      "GET",
      `discount_redemptions?discount_id=eq.${discountId}&select=profile_id,status,amount`,
    );
    expect(uses.body).toHaveLength(1);
    expect(uses.body[0]).toMatchObject({ profile_id: winner.id, status: "reserved" });
    expect((await rest("GET", "orders?select=id", loser.token)).body).toHaveLength(0);

    // al cancelar el ganador, la unidad y el uso del cupón VUELVEN (criterio 5) y la otra clienta puede comprar con ese cupón
    const cancel = await svcRpc("cancel_order_by_customer", {
      p_profile_id: winner.id,
      p_order_id: win.body.order.id,
      p_reason: "prueba",
    });
    expect(cancel.body.ok).toBe(true);
    expect(await stockOf(product.variantId)).toBe(1);
    const reverted = await svcRest(
      "GET",
      `discount_redemptions?discount_id=eq.${discountId}&select=status`,
    );
    expect(reverted.body).toEqual([{ status: "reverted" }]);
    const retry = await svcRpc("create_order", args(loser));
    expect(retry.body.outcome, JSON.stringify(retry.body)).toBe("created");
    expect(retry.body.order.coupon_code).toBe(code);
    expect(retry.body.order.discount_total).toBe(10);
    await svcRpc("cancel_order_by_customer", {
      p_profile_id: loser.id,
      p_order_id: retry.body.order.id,
      p_reason: "limpieza",
    });
    await svcRest("PATCH", `discounts?id=eq.${discountId}`, {
      archived_at: new Date().toISOString(),
    });
    await svcRest("PATCH", "store_settings?key=eq.reserve_on_add_to_cart", {
      value: reserveSetting === "false" ? false : true,
    });
  }, 180_000);
});

const createArgs = (c: Customer, total: number, k: string) => ({
  p_profile_id: c.id,
  p_address_id: c.addressId,
  p_tax_profile_id: null,
  p_shipping_method: "delivery",
  p_slot_id: null,
  p_delivery_date: null,
  p_payment_method: "whatsapp",
  p_contact_name: "Cliente",
  p_contact_email: null,
  p_contact_phone: "+59171234567",
  p_expected_total: total,
  p_idempotency_key: k,
});

describe("checkout · orden de candados y carreras de estado (M5)", () => {
  it("12 clientas piden las MISMAS dos variantes en orden inverso a la vez: sin deadlock, se venden exactamente 6 de cada una", async () => {
    guard();
    await svcRest("PATCH", "store_settings?key=eq.reserve_on_add_to_cart", { value: false });
    const a = await makeProduct({ name: "Variante A cruzada", price: 40, stock: 6 });
    const b = await makeProduct({ name: "Variante B cruzada", price: 60, stock: 6 });
    const customers: Customer[] = [];
    for (let i = 0; i < 12; i++) customers.push(await makeCustomer(`x${i}`));
    // la mitad agrega A y luego B; la otra mitad, B y luego A (las líneas quedan en orden distinto)
    for (const [i, c] of customers.entries()) {
      const [first, second] = i % 2 === 0 ? [a, b] : [b, a];
      expect((await addToCart(c, first.variantId, 1)).status).toBe(200);
      expect((await addToCart(c, second.variantId, 1)).status).toBe(200);
    }
    const total = (await previewOf(customers[0]!)).body.checkout.totals.total as number;
    const results = await Promise.all(
      customers.map((c) => svcRpc("create_order", createArgs(c, total, key()))),
    );
    // ninguna falló por deadlock (40P01) ni por otro error del servidor
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);
    const created = results.filter((r) => r.body.outcome === "created");
    const unavailable = results.filter((r) => r.body.outcome === "unavailable");
    expect(
      created.length + unavailable.length,
      JSON.stringify(results.map((r) => r.body.outcome)),
    ).toBe(12);
    expect(created).toHaveLength(6);
    expect(await stockOf(a.variantId)).toBe(0);
    expect(await stockOf(b.variantId)).toBe(0);
    // cada pedido creado llevó UNA unidad de cada variante, nunca una sola (todo o nada)
    for (const r of created) expect(r.body.order.items).toHaveLength(2);
    // limpieza
    for (const [index, r] of results.entries()) {
      if (r.body.outcome !== "created") continue;
      await svcRpc("cancel_order_by_customer", {
        p_profile_id: customers[index]!.id,
        p_order_id: r.body.order.id,
        p_reason: "limpieza de prueba",
      });
    }
    expect(await stockOf(a.variantId)).toBe(6);
    expect(await stockOf(b.variantId)).toBe(6);
    await svcRest("PATCH", "store_settings?key=eq.reserve_on_add_to_cart", {
      value: reserveSetting === "false" ? false : true,
    });
  }, 300_000);

  it("la clienta cancela justo cuando el admin pasa a «preparing»: gana UNA, la otra recibe invalid_transition y el stock queda coherente", async () => {
    guard();
    await svcRest("PATCH", "store_settings?key=eq.reserve_on_add_to_cart", { value: false });
    const product = await makeProduct({ name: "Prenda carrera de estado", price: 30, stock: 6 });
    const customers: Customer[] = [];
    for (let i = 0; i < 6; i++) customers.push(await makeCustomer(`r${i}`));
    const orders: string[] = [];
    for (const c of customers) {
      await addToCart(c, product.variantId, 1);
      const total = (await previewOf(c)).body.checkout.totals.total as number;
      const res = await createFor(c, total, key());
      expect(res.body.outcome, JSON.stringify(res.body)).toBe("created");
      orders.push(res.body.order.id);
      // el admin confirma el pago (pending_payment → paid): ahora ambos pueden mover el pedido
      const paid = await svcRpc("transition_order_status", {
        p_order_id: res.body.order.id,
        p_to: "paid",
        p_actor: c.id,
        p_actor_kind: "admin",
        p_reason: null,
      });
      expect(paid.body.ok, JSON.stringify(paid.body)).toBe(true);
    }
    expect(await stockOf(product.variantId)).toBe(0);
    // los 6 pares de llamadas, TODAS a la vez
    const calls = customers.flatMap((c, i) => [
      svcRpc("cancel_order_by_customer", {
        p_profile_id: c.id,
        p_order_id: orders[i],
        p_reason: "carrera",
      }),
      svcRpc("transition_order_status", {
        p_order_id: orders[i],
        p_to: "preparing",
        p_actor: c.id,
        p_actor_kind: "admin",
        p_reason: null,
      }),
    ]);
    const out = await Promise.all(calls);
    let cancelled = 0;
    for (let i = 0; i < 6; i++) {
      const cancel = out[i * 2]!;
      const prepare = out[i * 2 + 1]!;
      expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
      expect(prepare.status, JSON.stringify(prepare.body)).toBe(200);
      const wins = [cancel.body.ok, prepare.body.ok].filter(Boolean).length;
      expect(wins, `carrera ${i}: ${JSON.stringify([cancel.body, prepare.body])}`).toBe(1);
      const loser = cancel.body.ok ? prepare.body : cancel.body;
      expect(loser.outcome).toBe("invalid_transition");
      const row = (await svcRest("GET", `orders?id=eq.${orders[i]}&select=status`)).body[0];
      expect(row.status).toBe(cancel.body.ok ? "cancelled" : "preparing");
      if (cancel.body.ok) cancelled++;
      // el historial no tiene dos destinos: o cancelled o preparing, nunca ambos
      const hist = await svcRest(
        "GET",
        `order_status_history?order_id=eq.${orders[i]}&to_status=in.(cancelled,preparing)&select=to_status`,
      );
      expect(hist.body).toHaveLength(1);
    }
    // el stock se repuso SOLO por los cancelados
    expect(await stockOf(product.variantId)).toBe(cancelled);
    // limpieza: lo que quedó en preparing lo cancela el admin (la clienta ya no puede)
    for (let i = 0; i < 6; i++) {
      await svcRpc("transition_order_status", {
        p_order_id: orders[i],
        p_to: "cancelled",
        p_actor: customers[i]!.id,
        p_actor_kind: "admin",
        p_reason: "limpieza de prueba",
      });
    }
    expect(await stockOf(product.variantId)).toBe(6);
    await svcRest("PATCH", "store_settings?key=eq.reserve_on_add_to_cart", {
      value: reserveSetting === "false" ? false : true,
    });
  }, 300_000);
});
