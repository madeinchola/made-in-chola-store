import { beforeAll, describe, expect, it } from "vitest";
import {
  clearRateLimits,
  jwtSub,
  randomTag,
  recoverySession,
  registerAndLogin,
  rest,
  rpc,
  svcRest,
  svcRpc,
} from "../../../../test-support/api";

/**
 * Operación de pedidos (Sprint 12) contra la nube, con la pila REAL (PostgREST + RLS + funciones SECURITY DEFINER) y, sobre todo,
 * con CONCURRENCIA real: lo que una prueba pgTAP de una sola sesión no puede mostrar. Usa una cuenta de administración de prueba
 * que YA existe (`@prueba.test`; no se crean) y deja clientas, productos y pedidos inertes (los pedidos son inmutables a propósito;
 * la entrega vacía la base con `db reset --linked --no-seed`).
 */

let admin = "";
let adminId = "";
let customer: { token: string; id: string } | null = null;

const uniq = () => `${randomTag()}${randomTag()}`;
const A = (name: string, args: Record<string, unknown>) => rpc(name, args, admin);

async function makeProduct(price: number, stock: number) {
  const tag = randomTag();
  const product = await svcRest("POST", "products", {
    code: `S12${tag}`.toUpperCase(),
    slug: `s12-${tag}`,
    name: `Producto S12 ${tag}`,
    cost_base: 10,
  });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  const productId = product.body[0].id as string;
  const color = await svcRest("POST", "product_colors", { product_id: productId, name: "Único" });
  const variant = await svcRest("POST", "product_variants", {
    product_id: productId,
    color_id: color.body[0].id,
  });
  const variantId = variant.body[0].id as string;
  await svcRest("POST", "product_prices", {
    product_id: productId,
    currency: "BOB",
    amount: price,
  });
  await svcRpc("apply_stock_change", {
    p_variant_id: variantId,
    p_delta: stock,
    p_reason: "import",
    p_note: "stock de prueba de S12",
  });
  await svcRest("PATCH", `products?id=eq.${productId}`, { status: "active" });
  return { productId, variantId };
}
const stockOf = async (variantId: string) =>
  (await svcRest("GET", `product_variants?id=eq.${variantId}&select=stock_on_hand`)).body[0]
    .stock_on_hand as number;
const orderOf = async (id: string) => (await svcRest("GET", `orders?id=eq.${id}&select=*`)).body[0];

const ADDRESS = {
  recipient: "Rosa",
  phone_e164: "+59172223333",
  line1: "Av. Arce 100",
  city: "La Paz",
  lat: -16.52,
  lng: -68.15,
};
interface Manual {
  items: { variant_id: string; qty: number; unit_price?: number }[];
  key?: string;
  payment?: string;
  dry?: boolean;
  paid?: boolean;
  profile?: string;
  discount?: number;
  reason?: string | null;
}
const manual = (m: Manual) =>
  A("admin_create_manual_order", {
    p_profile_id: m.profile ?? customer!.id,
    p_items: m.items,
    p_channel: "whatsapp",
    p_payment_method: m.payment ?? "whatsapp",
    p_shipping_method: "delivery",
    p_address: ADDRESS,
    p_idempotency_key: m.dry ? null : (m.key ?? `m-${uniq()}`),
    p_shipping_cost: 15,
    p_slot_id: null,
    p_delivery_date: null,
    p_discount: m.discount ?? 0,
    p_discount_reason: m.reason ?? null,
    p_contact_name: null,
    p_contact_email: null,
    p_contact_phone: "+59171234567",
    p_note: null,
    p_mark_paid: m.paid ?? false,
    p_dry_run: m.dry ?? false,
  });
const refund = (orderId: string, over: Record<string, unknown>) =>
  A("admin_refund_order", {
    p_order_id: orderId,
    p_idempotency_key: `rf-${uniq()}`,
    p_mode: "amount",
    p_items: null,
    p_include_shipping: false,
    p_deduction: 0,
    p_amount: null,
    p_reason: "Prueba de integración",
    p_method: "cash",
    p_destination: null,
    p_external_ref: null,
    p_return_id: null,
    p_cancel: false,
    p_mark_processed: true,
    p_dry_run: false,
    ...over,
  });

beforeAll(async () => {
  await clearRateLimits();
  const admins = await svcRest(
    "GET",
    "profiles?role=eq.admin&is_active=eq.true&select=id,email&limit=30",
  );
  const found = (admins.body as { id: string; email: string | null }[]).find((r) =>
    r.email?.endsWith("@prueba.test"),
  );
  if (!found?.email) return;
  admin = (await recoverySession(found.email)).access;
  adminId = found.id;
  const user = await registerAndLogin({ name: "Clienta S12" });
  customer = { token: user.token, id: user.id };
});

const guard = (ctx: { skip: (note?: string) => void }) => {
  if (!admin || !customer)
    ctx.skip("No hay una cuenta de administración de prueba (@prueba.test) para entrar.");
};

describe("pedido manual", () => {
  it("la vista previa no escribe; crear descuenta el stock y repetir la misma llave devuelve el mismo pedido", async (ctx) => {
    guard(ctx);
    const p = await makeProduct(100, 10);
    const items = [{ variant_id: p.variantId, qty: 2 }];
    const preview = await manual({ items, dry: true });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.outcome).toBe("preview");
    expect(preview.body.totals).toMatchObject({ subtotal: 200, shipping: 15, total: 215 });
    expect(await stockOf(p.variantId)).toBe(10);

    const key = `m-${uniq()}`;
    const created = await manual({ items, key });
    expect(created.body.outcome, JSON.stringify(created.body)).toBe("created");
    expect(created.body.number).toMatch(/^MIC-\d{6,}$/);
    expect(await stockOf(p.variantId)).toBe(8);
    const again = await manual({ items, key });
    expect(again.body.outcome).toBe("existing");
    expect(again.body.number).toBe(created.body.number);
    expect(await stockOf(p.variantId)).toBe(8);
    const order = await orderOf(created.body.order_id);
    expect(order).toMatchObject({
      status: "pending_payment",
      channel: "whatsapp",
      total: 215,
      profile_id: customer!.id,
    });

    // la clienta lo ve (RLS) con las columnas nuevas
    const own = await rest(
      "GET",
      `orders?id=eq.${created.body.order_id}&select=number,channel,edit_count`,
      customer!.token,
    );
    expect(own.body).toEqual([{ number: created.body.number, channel: "whatsapp", edit_count: 0 }]);
  });

  it("dos pedidos manuales por la ÚLTIMA unidad: solo uno se crea y el stock nunca queda negativo", async (ctx) => {
    guard(ctx);
    const p = await makeProduct(50, 1);
    const items = [{ variant_id: p.variantId, qty: 1 }];
    const results = await Promise.all([manual({ items }), manual({ items }), manual({ items })]);
    const outcomes = results.map((r) => r.body.outcome as string).sort();
    expect(outcomes, JSON.stringify(results.map((r) => r.body))).toEqual([
      "created",
      "unavailable",
      "unavailable",
    ]);
    expect(await stockOf(p.variantId)).toBe(0);
  });
});

describe("permisos y RLS (pila real)", () => {
  it("la clienta no ejecuta funciones de administración ni lee reembolsos, notas, ediciones ni lista negra", async (ctx) => {
    guard(ctx);
    const denied = await rpc("admin_attention_summary", {}, customer!.token);
    expect(denied.status).toBe(403);
    expect((await rpc("admin_orders_status_counts", {}, customer!.token)).status).toBe(403);
    for (const table of [
      "refunds",
      "order_notes",
      "order_edits",
      "order_incidents",
      "order_returns",
      "blacklist_entries",
    ]) {
      const res = await rest("GET", `${table}?select=*`, customer!.token);
      expect(res.body, table).toEqual([]);
    }
    // sin sesión, nada
    const anon = await rpc("admin_attention_summary", {});
    expect([401, 403]).toContain(anon.status);
    // el administrador sí lee
    const summary = await A("admin_attention_summary", {});
    expect(summary.status).toBe(200);
    expect(typeof summary.body.orders).toBe("number");
  });

  it("nadie escribe directo: ni la clienta ni el administrador ni la clave de servicio", async (ctx) => {
    guard(ctx);
    const p = await makeProduct(30, 3);
    const created = await manual({ items: [{ variant_id: p.variantId, qty: 1 }] });
    const id = created.body.order_id as string;
    for (const token of [customer!.token, admin]) {
      const patch = await rest("PATCH", `orders?id=eq.${id}`, token, { total: 1 });
      expect([401, 403]).toContain(patch.status);
      const post = await rest("POST", "refunds", token, {
        order_id: id,
        kind: "amount",
        amount: 1,
        currency: "BOB",
        reason: "x",
        idempotency_key: "direct-write-1",
      });
      expect([401, 403]).toContain(post.status);
    }
    const svc = await svcRest("POST", "refunds", {
      order_id: id,
      kind: "amount",
      amount: 1,
      currency: "BOB",
      reason: "x",
      idempotency_key: "direct-write-2",
    });
    expect([401, 403]).toContain(svc.status);
    expect((await orderOf(id)).total).toBe(45);
  });
});

describe("avanzar y editar a la vez (bloqueo optimista)", () => {
  it("dos administradores confirman el pago a la vez: uno gana y el otro recibe «stale»", async (ctx) => {
    guard(ctx);
    const p = await makeProduct(100, 5);
    const created = await manual({ items: [{ variant_id: p.variantId, qty: 1 }] });
    const id = created.body.order_id as string;
    const go = () =>
      A("admin_transition_order", {
        p_order_id: id,
        p_to: "paid",
        p_reason: null,
        p_expected_from: "pending_payment",
      });
    const results = await Promise.all([go(), go(), go()]);
    const wins = results.filter((r) => r.body.ok === true);
    expect(wins, JSON.stringify(results.map((r) => r.body))).toHaveLength(1);
    expect(results.filter((r) => r.body.outcome === "stale")).toHaveLength(2);
    expect((await orderOf(id)).status).toBe("paid");
    const history = await A("admin_order_history", { p_order_id: id });
    expect(
      (history.body as { to_status: string }[]).filter((h) => h.to_status === "paid"),
    ).toHaveLength(1);
  });

  it("dos ediciones con la misma versión del pedido: una se aplica y la otra es «stale»; el stock cuadra", async (ctx) => {
    guard(ctx);
    const p = await makeProduct(100, 10);
    const created = await manual({ items: [{ variant_id: p.variantId, qty: 2 }] });
    const id = created.body.order_id as string;
    const order = await orderOf(id);
    const lines = await svcRest("GET", `order_items?order_id=eq.${id}&select=id`);
    const itemId = lines.body[0].id as string;
    const edit = (qty: number) =>
      A("admin_edit_order", {
        p_order_id: id,
        p_expected_updated_at: order.updated_at,
        p_items: [{ item_id: itemId, qty }],
        p_contact: null,
        p_address: null,
        p_shipping_cost: null,
        p_extra_discount: 0,
        p_reason: "Edición simultánea",
        p_dry_run: false,
      });
    const results = await Promise.all([edit(3), edit(4)]);
    const outcomes = results.map((r) => r.body.outcome as string).sort();
    expect(outcomes, JSON.stringify(results.map((r) => r.body))).toEqual(["edited", "stale"]);
    const final = await orderOf(id);
    expect(final.edit_count).toBe(1);
    const qty = (await svcRest("GET", `order_items?id=eq.${itemId}&select=qty`)).body[0]
      .qty as number;
    expect([3, 4]).toContain(qty);
    // 10 − 2 (pedido) − (qty − 2) (edición) = 10 − qty
    expect(await stockOf(p.variantId)).toBe(10 - qty);
    expect(final.total).toBe(100 * qty + 15);
  });

  it("editar contra una compra que se lleva el mismo stock: nunca se vende de más", async (ctx) => {
    guard(ctx);
    const p = await makeProduct(100, 3);
    const created = await manual({ items: [{ variant_id: p.variantId, qty: 1 }] });
    const id = created.body.order_id as string;
    const lines = await svcRest("GET", `order_items?order_id=eq.${id}&select=id`);
    const itemId = lines.body[0].id as string;
    // quedan 2 unidades: la edición pide +2 (a 3) mientras otro pedido manual pide 2
    const [edit, other] = await Promise.all([
      A("admin_edit_order", {
        p_order_id: id,
        p_expected_updated_at: null,
        p_items: [{ item_id: itemId, qty: 3 }],
        p_contact: null,
        p_address: null,
        p_shipping_cost: null,
        p_extra_discount: 0,
        p_reason: "Más",
        p_dry_run: false,
      }),
      manual({ items: [{ variant_id: p.variantId, qty: 2 }] }),
    ]);
    const stock = await stockOf(p.variantId);
    expect(stock, JSON.stringify([edit.body, other.body])).toBeGreaterThanOrEqual(0);
    const okCount = [edit.body.outcome === "edited", other.body.outcome === "created"].filter(
      Boolean,
    ).length;
    expect(okCount).toBe(1);
    // quedaban 2 unidades: las toma quien gane (la edición o el otro pedido) y no sobra ni falta ninguna
    expect(stock).toBe(0);
  });
});

describe("reembolsos bajo concurrencia real", () => {
  async function paidOrder(price: number) {
    const p = await makeProduct(price, 5);
    const created = await manual({ items: [{ variant_id: p.variantId, qty: 1 }], paid: true });
    expect(created.body.outcome, JSON.stringify(created.body)).toBe("created");
    return { id: created.body.order_id as string, total: price + 15, variantId: p.variantId };
  }

  it("5 reembolsos de 40 a la vez sobre 100 pagados: caben exactamente 2 y nunca se pasa de lo pagado", async (ctx) => {
    guard(ctx);
    const o = await paidOrder(85); // total 100
    expect(o.total).toBe(100);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => refund(o.id, { p_amount: 40 })));
    const done = results.filter((r) => r.body.outcome === "refunded");
    expect(done, JSON.stringify(results.map((r) => r.body))).toHaveLength(2);
    for (const r of results.filter((x) => x.body.outcome !== "refunded")) {
      expect(r.body.errors?.[0]?.code ?? r.body.refund?.errors?.[0]?.code).toBe("exceeds_paid");
    }
    const rows = await svcRest("GET", `refunds?order_id=eq.${o.id}&select=amount,status`);
    const total = (rows.body as { amount: number; status: string }[])
      .filter((r) => r.status !== "rejected")
      .reduce((s, r) => s + Number(r.amount), 0);
    expect(total).toBe(80);
  });

  it("el MISMO reembolso (misma llave) enviado 6 veces a la vez deja UNA fila", async (ctx) => {
    guard(ctx);
    const o = await paidOrder(35); // total 50
    const key = `rf-${uniq()}`;
    const results = await Promise.all(
      Array.from({ length: 6 }, () => refund(o.id, { p_amount: 20, p_idempotency_key: key })),
    );
    expect(
      results.every((r) => ["refunded", "existing"].includes(r.body.outcome)),
      JSON.stringify(results.map((r) => r.body)),
    ).toBe(true);
    expect(new Set(results.map((r) => r.body.refund_id)).size).toBe(1);
    const rows = await svcRest("GET", `refunds?order_id=eq.${o.id}&select=id`);
    expect(rows.body).toHaveLength(1);
  });

  it("cancelar y reembolsar repone el stock y deja el pedido «reembolsado»; repetir no devuelve dos veces", async (ctx) => {
    guard(ctx);
    const o = await paidOrder(60);
    expect(await stockOf(o.variantId)).toBe(4);
    const key = `rf-${uniq()}`;
    const args = {
      p_mode: "all",
      p_cancel: true,
      p_idempotency_key: key,
      p_reason: "La clienta ya no lo quiere",
    };
    const first = await refund(o.id, args);
    expect(first.body.outcome, JSON.stringify(first.body)).toBe("refunded");
    const second = await refund(o.id, args);
    expect(second.body.outcome).toBe("existing");
    expect((await orderOf(o.id)).status).toBe("refunded");
    expect(await stockOf(o.variantId)).toBe(5);
    const rows = await svcRest("GET", `refunds?order_id=eq.${o.id}&select=amount,kind,status`);
    expect(rows.body).toEqual([{ amount: 75, kind: "cancel", status: "processed" }]);
    // y ya no queda nada por devolver
    const more = await refund(o.id, { p_mode: "all", p_dry_run: true });
    expect(more.body.refund.errors[0].code).toBe("nothing_to_refund");
  });
});

describe("lista negra", () => {
  it("bloquea los pedidos manuales de la cuenta y, al levantarlo, vuelve a poder", async (ctx) => {
    guard(ctx);
    const user = await registerAndLogin({ name: "Clienta bloqueada S12" });
    const p = await makeProduct(20, 5);
    const items = [{ variant_id: p.variantId, qty: 1 }];
    const added = await A("admin_blacklist_add", {
      p_kind: "profile",
      p_profile_id: user.id,
      p_phone: null,
      p_email: null,
      p_reason: "Prueba de integración",
      p_order_id: null,
      p_include_contacts: false,
    });
    expect(added.body.outcome, JSON.stringify(added.body)).toBe("added");
    const blocked = await manual({ items, profile: user.id });
    expect(blocked.body.outcome).toBe("blacklisted");
    expect(await stockOf(p.variantId)).toBe(5);
    const lifted = await A("admin_blacklist_lift", {
      p_entry_id: added.body.ids[0],
      p_reason: "Fin de la prueba",
    });
    expect(lifted.body.outcome).toBe("lifted");
    const ok = await manual({ items, profile: user.id });
    expect(ok.body.outcome).toBe("created");
    // quedó la auditoría con el administrador que actuó
    const audit = await A("admin_order_history", { p_order_id: ok.body.order_id });
    expect((audit.body as unknown[]).length).toBeGreaterThan(0);
    expect(jwtSub(admin)).toBe(adminId);
  });
});
