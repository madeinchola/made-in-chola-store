import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vitest";
import {
  clearRateLimits,
  dbExec,
  dbPsql,
  fn,
  randomTag,
  recoverySession,
  registerAndLogin,
  rest,
  rpc,
  svcRest,
  svcRpc,
  testEnv,
} from "../../../test-support/api";

/**
 * Pagos con QR (Sprint 11) contra la nube: el cobro con referencia y vencimiento de 24 h, el comprobante en el bucket PRIVADO
 * (dueña, IDOR, archivos falsos), la decisión del administrador (con una cuenta de administración de prueba que YA existe: no
 * se crean), el aviso de pago idempotente bajo concurrencia REAL y su carrera contra el vencimiento, y la función del webhook.
 *
 * NO queda probado aquí el camino «aviso con firma VÁLIDA por HTTP»: exige el secreto `PAYMENT_WEBHOOK_SECRET_QR_API` en los
 * secretos de Supabase y, si no está, la función rechaza con 503. La verificación de la firma se prueba con Deno
 * (`payments-webhook.test.ts`) y la lógica de aplicar el aviso, aquí y en pgTAP, por la función SQL que la función Edge llama.
 *
 * Deja en la nube clientas de prueba inertes (`@prueba.test`), productos de prueba y pedidos cancelados o pagados (inmutables a
 * propósito); la entrega vacía la base con `db reset --linked --no-seed`.
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

const key = () => `k-${randomTag()}-${randomTag()}`;
const QR_PATH = "qr/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.png";

async function makeProduct(opts: { name: string; price: number; stock: number }): Promise<Made> {
  const tag = randomTag();
  const product = await svcRest("POST", "products", {
    code: `P${tag}`.toUpperCase(),
    slug: `pago-${tag}`,
    name: opts.name,
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
    amount: opts.price,
  });
  await svcRpc("apply_stock_change", {
    p_variant_id: variantId,
    p_delta: opts.stock,
    p_reason: "import",
    p_note: "stock de prueba de pagos",
  });
  await svcRest("PATCH", `products?id=eq.${productId}`, { status: "active" });
  return { productId, variantId };
}

const stockOf = async (variantId: string): Promise<number> =>
  (await svcRest("GET", `product_variants?id=eq.${variantId}&select=stock_on_hand`)).body[0]
    .stock_on_hand as number;

async function makeCustomer(label: string): Promise<Customer> {
  await clearRateLimits();
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

/** Compra por QR de punta a punta: bolsa → vista previa → crear el pedido con el método «qr_manual». */
async function placeQrOrder(c: Customer, product: Made, qty = 1) {
  expect((await addToCart(c, product.variantId, qty)).status).toBe(200);
  const preview = await fn(
    "checkout",
    {
      action: "preview",
      shipping_method: "delivery",
      address_id: c.addressId,
      payment_method: "qr_manual",
    },
    { token: c.token },
  );
  expect(preview.status, JSON.stringify(preview.body)).toBe(200);
  const total = preview.body.checkout.totals.total as number;
  const created = await fn(
    "checkout",
    {
      action: "create",
      shipping_method: "delivery",
      address_id: c.addressId,
      payment_method: "qr_manual",
      contact_name: "Cliente de prueba",
      contact_phone: "+59171234567",
      expected_total: total,
      idempotency_key: key(),
    },
    { token: c.token },
  );
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  expect(created.body.outcome, JSON.stringify(created.body)).toBe("created");
  const orderId = created.body.order.id as string;
  const view = await rpc("customer_payment_view", { p_order_id: orderId }, c.token);
  expect(view.status, JSON.stringify(view.body)).toBe(200);
  return {
    orderId,
    number: created.body.order.number as string,
    total,
    paymentId: view.body.payment.id as string,
    reference: view.body.payment.reference as string,
    created: created.body,
  };
}

const viewOf = async (c: Customer, orderId: string) =>
  (await rpc("customer_payment_view", { p_order_id: orderId }, c.token)).body;

// ── Storage por HTTP (como lo hace el navegador) ──
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngBytes = () => Buffer.concat([Buffer.from(PNG_HEAD), randomBytes(64)]);
async function putObject(token: string, path: string, bytes: Uint8Array, contentType: string) {
  const env = testEnv();
  const res = await fetch(`${env.url}/storage/v1/object/payment-proofs/${path}`, {
    method: "POST",
    headers: {
      apikey: env.anon,
      Authorization: `Bearer ${token}`,
      "Content-Type": contentType,
      "x-upsert": "false",
    },
    body: bytes as unknown as BodyInit,
  });
  return { status: res.status, text: await res.text() };
}
async function getObject(token: string | null, path: string) {
  const env = testEnv();
  const res = await fetch(`${env.url}/storage/v1/object/authenticated/payment-proofs/${path}`, {
    headers: { apikey: env.anon, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  await res.arrayBuffer();
  return res.status;
}
async function publicGet(path: string) {
  const env = testEnv();
  const res = await fetch(`${env.url}/storage/v1/object/public/payment-proofs/${path}`, {
    headers: { apikey: env.anon },
  });
  await res.arrayBuffer();
  return res.status;
}
const objectPath = (c: Customer, orderId: string, ext = "png") =>
  `${c.id}/${orderId}/${randomUUID()}.${ext}`;
const submit = (c: Customer, paymentId: string, path: string) =>
  fn("payments", { action: "proof_submit", payment_id: paymentId, path }, { token: c.token });

// ── Estado compartido ──
let ready: string | null = null;
let admin: string | null = null; // access token de una cuenta de administración de prueba (si existe)
let original: Record<string, unknown> | null = null;

beforeAll(async () => {
  await clearRateLimits();
  const probe = await fn("payments", { action: "retry", order_id: randomUUID() });
  if (probe.status === 404) ready = "La función `payments` no está desplegada.";
  const method = await svcRest("GET", "payment_methods?country=eq.BO&code=eq.qr_manual&select=*");
  if (!ready && (method.body as unknown[]).length === 0)
    ready = "Falta el método «qr_manual» (S11).";
  if (ready) return;
  original = method.body[0] as Record<string, unknown>;
  const on = await svcRest("PATCH", "payment_methods?country=eq.BO&code=eq.qr_manual", {
    qr_image_path: QR_PATH,
    account_details: "Banco de prueba · cuenta 000-000 · Chola (prueba)",
    is_active: true,
  });
  expect(on.status, JSON.stringify(on.body)).toBe(200);
  const admins = await svcRest(
    "GET",
    "profiles?role=eq.admin&is_active=eq.true&select=email&limit=20",
  );
  const email = (admins.body as { email: string | null }[])
    .map((r) => r.email)
    .find((e): e is string => !!e && e.endsWith("@prueba.test"));
  if (email) admin = (await recoverySession(email)).access;
});

afterAll(async () => {
  if (original) {
    await svcRest("PATCH", "payment_methods?country=eq.BO&code=eq.qr_manual", {
      is_active: original.is_active,
      qr_image_path: original.qr_image_path ?? null,
      account_details: original.account_details ?? null,
    });
  }
  await clearRateLimits();
});

const guard = () => {
  if (ready) throw new Error(`Prueba omitida: ${ready}`);
};
const needAdmin = (ctx: TestContext) => {
  guard();
  if (!admin) ctx.skip();
};

describe("pagos · el cobro con QR", () => {
  it("el pedido nace con un cobro: referencia = número, vence en 24 h, y la clienta ve el QR y la cuenta (sin datos internos)", async () => {
    guard();
    const product = await makeProduct({ name: "Prenda QR", price: 100, stock: 5 });
    const c = await makeCustomer("qr");
    const order = await placeQrOrder(c, product, 2);
    expect(order.created.payment_instruction).toEqual({ kind: "manual_qr" });
    expect(order.created.payment_error).toBeNull();
    expect(order.reference).toBe(order.number);

    const payment = (await svcRest("GET", `payments?id=eq.${order.paymentId}&select=*`)).body[0];
    expect(payment).toMatchObject({
      status: "pending",
      provider: "manual_qr",
      method: "qr_manual",
      attempt: 1,
    });
    expect(Number(payment.amount)).toBe(order.total);
    const hours = (Date.parse(payment.expires_at) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);

    const view = await viewOf(c, order.orderId);
    expect(view.outcome).toBe("ok");
    expect(view.method).toEqual({
      code: "qr_manual",
      name: expect.any(String),
      description: expect.anything(),
      account_details: "Banco de prueba · cuenta 000-000 · Chola (prueba)",
      qr_image_path: QR_PATH,
    });
    expect(view.can_upload).toBe(true);
    expect(view.can_retry).toBe(false);
    expect(Math.abs(Date.parse(view.server_now) - Date.now())).toBeLessThan(60_000);
    expect(Object.keys(view.payment).sort()).toEqual([
      "amount",
      "currency",
      "expires_at",
      "id",
      "method",
      "paid_at",
      "provider",
      "reference",
      "status",
      "under_review",
    ]);

    // otra clienta NO ve ese pago (ni sabe que existe)
    const other = await makeCustomer("qr-otra");
    expect((await viewOf(other, order.orderId)).outcome).toBe("not_found");
    // y sin sesión no se ejecuta
    const anon = await rpc("customer_payment_view", { p_order_id: order.orderId });
    expect([401, 403]).toContain(anon.status);

    await fn("checkout", { action: "cancel", order_id: order.orderId }, { token: c.token });
    expect(await stockOf(product.variantId)).toBe(5);
  }, 240_000);

  it("la clienta lee su cobro pero NO los comprobantes, las revisiones ni los avisos recibidos", async () => {
    guard();
    const product = await makeProduct({ name: "Prenda QR lectura", price: 40, stock: 3 });
    const c = await makeCustomer("lectura");
    const order = await placeQrOrder(c, product);
    expect(
      (
        (await rest("GET", `payments?id=eq.${order.paymentId}&select=id,status`, c.token))
          .body as unknown[]
      ).length,
    ).toBe(1);
    for (const table of ["payment_proofs", "payment_reviews", "webhook_events"]) {
      const res = await rest("GET", `${table}?select=id`, c.token);
      expect(res.status, table).toBe(200);
      expect(res.body, table).toEqual([]);
    }
    // ni escribir un cobro como pagado, ni crear comprobantes a mano
    expect([401, 403]).toContain(
      (await rest("PATCH", `payments?id=eq.${order.paymentId}`, c.token, { status: "paid" }))
        .status,
    );
    expect([401, 403]).toContain(
      (
        await rest("POST", "payment_proofs", c.token, {
          payment_id: order.paymentId,
          order_id: order.orderId,
        })
      ).status,
    );
    // ni ejecutar las funciones del servidor
    for (const name of ["payment_apply_event", "payment_retry", "payment_proof_register"]) {
      const res = await rpc(name, {}, c.token);
      expect([401, 403, 404], name).toContain(res.status);
    }
    await fn("checkout", { action: "cancel", order_id: order.orderId }, { token: c.token });
  }, 240_000);
});

describe("pagos · comprobantes (bucket privado)", () => {
  it("sube su archivo, la función lo revisa y lo registra; solo ella lo lee; idempotente; otra clienta no puede tocarlo", async () => {
    guard();
    const product = await makeProduct({ name: "Prenda QR comprobante", price: 80, stock: 4 });
    const a = await makeCustomer("comp-a");
    const b = await makeCustomer("comp-b");
    const order = await placeQrOrder(a, product);
    const path = objectPath(a, order.orderId);
    const bytes = pngBytes();

    const up = await putObject(a.token, path, bytes, "image/png");
    expect(up.status, up.text).toBe(200);
    const first = await submit(a, order.paymentId, path);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ ok: true, outcome: "registered" });
    const proofId = first.body.proof_id as string;

    // la base: pendiente, con la huella del archivo y su tipo REAL
    const proof = (await svcRest("GET", `payment_proofs?id=eq.${proofId}&select=*`)).body[0];
    expect(proof).toMatchObject({
      status: "pending",
      mime: "image/png",
      size_bytes: bytes.length,
      file_path: path,
    });
    expect(proof.file_hash).toMatch(/^[0-9a-f]{64}$/);

    // la clienta ve «en revisión» y ya no puede subir otro
    const view = await viewOf(a, order.orderId);
    expect(view.proof).toMatchObject({ status: "pending" });
    expect(view.can_upload).toBe(false);

    // el mismo archivo, la misma respuesta (reintento de red)
    expect((await submit(a, order.paymentId, path)).body).toMatchObject({
      ok: true,
      outcome: "existing",
      proof_id: proofId,
    });
    // la misma imagen en OTRA ruta (doble toque): el mismo comprobante, y el archivo sobrante se borra
    const twin = objectPath(a, order.orderId);
    expect((await putObject(a.token, twin, bytes, "image/png")).status).toBe(200);
    expect((await submit(a, order.paymentId, twin)).body).toMatchObject({
      ok: true,
      outcome: "existing",
      proof_id: proofId,
    });
    expect(await getObject(a.token, twin)).not.toBe(200);
    expect(await getObject(a.token, path)).toBe(200);

    // nadie más lo lee: ni otra clienta, ni sin sesión, ni por la URL pública
    expect(await getObject(b.token, path)).not.toBe(200);
    expect(await getObject(null, path)).not.toBe(200);
    expect(await publicGet(path)).not.toBe(200);
    // ni sube a la carpeta de la primera, ni registra su archivo
    const intruder = await putObject(
      b.token,
      `${a.id}/${order.orderId}/${randomUUID()}.png`,
      pngBytes(),
      "image/png",
    );
    expect(intruder.status).not.toBe(200);
    const stolen = await submit(b, order.paymentId, path);
    expect(stolen.body).toMatchObject({ ok: false, outcome: "not_found" });
    expect(await getObject(a.token, path)).toBe(200); // el archivo de la dueña sigue ahí
    // …ni la propia dueña lo borra mandando SU ruta ya registrada con un cobro que no existe (antes el registro respondía «no
    // existe» y la función borraba el archivo: se perdía la evidencia y la ruta quedaba libre para subir otra cosa)
    const ghost = await submit(a, randomUUID(), path);
    expect(ghost.body).toMatchObject({ ok: false, outcome: "not_found" });
    expect(await getObject(a.token, path)).toBe(200);
    expect(
      (await svcRest("GET", `payment_proofs?id=eq.${proofId}&select=status,file_path`)).body,
    ).toEqual([{ status: "pending", file_path: path }]);
    // ni cambia ni borra lo ya subido (no hay políticas de update ni delete para la clienta)
    const env = testEnv();
    const overwrite = await fetch(`${env.url}/storage/v1/object/payment-proofs/${path}`, {
      method: "PUT",
      headers: {
        apikey: env.anon,
        Authorization: `Bearer ${a.token}`,
        "Content-Type": "image/png",
      },
      body: pngBytes() as unknown as BodyInit,
    });
    expect(overwrite.status).not.toBe(200);
    const remove = await fetch(`${env.url}/storage/v1/object/payment-proofs/${path}`, {
      method: "DELETE",
      headers: { apikey: env.anon, Authorization: `Bearer ${a.token}` },
    });
    expect(remove.status).not.toBe(200);
    expect(await getObject(a.token, path)).toBe(200);

    // el servidor SÍ firma una URL de corta vida
    const signed = await fetch(`${env.url}/storage/v1/object/sign/payment-proofs/${path}`, {
      method: "POST",
      headers: {
        apikey: env.service,
        Authorization: `Bearer ${env.service}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 60 }),
    });
    expect(signed.status).toBe(200);

    // cancelar el pedido cierra el comprobante pendiente
    await fn("checkout", { action: "cancel", order_id: order.orderId }, { token: a.token });
    expect(
      (await svcRest("GET", `payment_proofs?id=eq.${proofId}&select=status,reason`)).body[0],
    ).toEqual({
      status: "rejected",
      reason: "El pedido se canceló",
    });
    expect(await stockOf(product.variantId)).toBe(4);
  }, 300_000);

  it("un archivo falso no pasa: SVG con script, extensión cambiada, tipo no permitido y más de 5 MB", async () => {
    guard();
    const product = await makeProduct({ name: "Prenda QR falsa", price: 50, stock: 3 });
    const c = await makeCustomer("falsos");
    const order = await placeQrOrder(c, product);

    // un SVG con script que se hace pasar por PNG (el navegador declara image/png)
    const svgPath = objectPath(c, order.orderId, "png");
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect((await putObject(c.token, svgPath, svg, "image/png")).status).toBe(200);
    const svgResult = await submit(c, order.paymentId, svgPath);
    expect(svgResult.body).toMatchObject({
      ok: false,
      outcome: "invalid_file",
      reason: "unknown_type",
    });
    expect(await getObject(c.token, svgPath)).not.toBe(200); // se borró

    // un PNG verdadero llamado .jpg
    const mismatch = objectPath(c, order.orderId, "jpg");
    expect((await putObject(c.token, mismatch, pngBytes(), "image/jpeg")).status).toBe(200);
    expect((await submit(c, order.paymentId, mismatch)).body).toMatchObject({
      ok: false,
      outcome: "invalid_file",
      reason: "extension_mismatch",
    });
    expect(await getObject(c.token, mismatch)).not.toBe(200);

    // un HTML y un archivo vacío con tipos permitidos
    const html = objectPath(c, order.orderId, "jpg");
    expect(
      (await putObject(c.token, html, Buffer.from("<html><script>1</script></html>"), "image/jpeg"))
        .status,
    ).toBe(200);
    expect((await submit(c, order.paymentId, html)).body).toMatchObject({
      ok: false,
      outcome: "invalid_file",
    });

    // el bucket rechaza por sí mismo un tipo no permitido y un archivo de más de 5 MB
    expect(
      (
        await putObject(
          c.token,
          objectPath(c, order.orderId, "pdf"),
          Buffer.from("%PDF-1.4"),
          "text/html",
        )
      ).status,
    ).not.toBe(200);
    const big = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(5 * 1024 * 1024 + 1),
    ]);
    expect(
      (await putObject(c.token, objectPath(c, order.orderId, "jpg"), big, "image/jpeg")).status,
    ).not.toBe(200);

    // nada de eso dejó un comprobante ni bloqueó el cobro
    expect(
      (await svcRest("GET", `payment_proofs?order_id=eq.${order.orderId}&select=id`)).body,
    ).toEqual([]);
    expect((await viewOf(c, order.orderId)).can_upload).toBe(true);

    // las rutas inválidas ni se descargan
    expect(
      (await submit(c, order.paymentId, `${c.id}/${order.orderId}/no-es-uuid.png`)).body,
    ).toMatchObject({ outcome: "not_found" });
    expect(
      (await submit(c, order.paymentId, `../${c.id}/${order.orderId}/${randomUUID()}.png`)).body,
    ).toMatchObject({
      outcome: "not_found",
    });
    await fn("checkout", { action: "cancel", order_id: order.orderId }, { token: c.token });
  }, 300_000);
});

describe("pagos · decisión del administrador (cuenta de administración de prueba)", () => {
  it("aprobar: el pedido queda pagado UNA vez, el stock sigue descontado y repetir no hace nada", async (ctx) => {
    needAdmin(ctx);
    const product = await makeProduct({ name: "Prenda QR aprobada", price: 60, stock: 3 });
    const c = await makeCustomer("aprobar");
    const order = await placeQrOrder(c, product);
    const path = objectPath(c, order.orderId);
    expect((await putObject(c.token, path, pngBytes(), "image/png")).status).toBe(200);
    const proofId = (await submit(c, order.paymentId, path)).body.proof_id as string;
    expect(await stockOf(product.variantId)).toBe(2);

    // un cliente NO puede decidir
    const denied = await rpc(
      "admin_review_proof",
      { p_proof_id: proofId, p_decision: "approve" },
      c.token,
    );
    expect([401, 403]).toContain(denied.status);
    expect(
      (await svcRest("GET", `payment_proofs?id=eq.${proofId}&select=status`)).body[0].status,
    ).toBe("pending");

    const approved = await rpc(
      "admin_review_proof",
      { p_proof_id: proofId, p_decision: "approve" },
      admin!,
    );
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body).toMatchObject({ outcome: "approved", payment: { outcome: "applied" } });
    const row = (await svcRest("GET", `orders?id=eq.${order.orderId}&select=status,paid_at`))
      .body[0];
    expect(row.status).toBe("paid");
    expect(row.paid_at).not.toBeNull();
    expect(
      (await svcRest("GET", `payments?id=eq.${order.paymentId}&select=status,received_amount`))
        .body[0],
    ).toMatchObject({
      status: "paid",
    });
    expect(await stockOf(product.variantId)).toBe(2);

    // dos administradores a la vez: gana la primera decisión
    const again = await Promise.all([
      rpc("admin_review_proof", { p_proof_id: proofId, p_decision: "approve" }, admin!),
      rpc(
        "admin_review_proof",
        { p_proof_id: proofId, p_decision: "reject", p_reason: "tarde" },
        admin!,
      ),
    ]);
    for (const r of again) expect(r.body).toMatchObject({ outcome: "already_reviewed" });
    const history = await svcRest(
      "GET",
      `order_status_history?order_id=eq.${order.orderId}&to_status=eq.paid&select=actor_kind`,
    );
    expect(history.body).toEqual([{ actor_kind: "admin" }]);
    // la clienta ve el pago confirmado
    expect((await viewOf(c, order.orderId)).order.status).toBe("paid");
    // y la decisión quedó auditada con quién la tomó
    const audit = await svcRest(
      "GET",
      `audit_log?table_name=eq.payment_proofs&record_id=eq.${proofId}&action=eq.UPDATE&select=actor_id`,
    );
    expect((audit.body as { actor_id: string | null }[]).some((r) => r.actor_id !== null)).toBe(
      true,
    );
  }, 300_000);

  it("rechazar con motivo: la clienta lo ve y puede subir otro; sin motivo no se puede", async (ctx) => {
    needAdmin(ctx);
    const product = await makeProduct({ name: "Prenda QR rechazada", price: 60, stock: 3 });
    const c = await makeCustomer("rechazar");
    const order = await placeQrOrder(c, product);
    const path = objectPath(c, order.orderId);
    expect((await putObject(c.token, path, pngBytes(), "image/png")).status).toBe(200);
    const proofId = (await submit(c, order.paymentId, path)).body.proof_id as string;
    expect(
      (await rpc("admin_review_proof", { p_proof_id: proofId, p_decision: "reject" }, admin!))
        .status,
    ).toBe(400);
    const rejected = await rpc(
      "admin_review_proof",
      { p_proof_id: proofId, p_decision: "reject", p_reason: "No se ve el monto" },
      admin!,
    );
    expect(rejected.body).toMatchObject({ outcome: "rejected" });
    const view = await viewOf(c, order.orderId);
    expect(view.proof).toMatchObject({ status: "rejected", reason: "No se ve el monto" });
    expect(view.can_upload).toBe(true);
    expect(view.order.status).toBe("pending_payment");
    // sube otro y queda en revisión de nuevo
    const second = objectPath(c, order.orderId);
    expect((await putObject(c.token, second, pngBytes(), "image/png")).status).toBe(200);
    expect((await submit(c, order.paymentId, second)).body).toMatchObject({
      ok: true,
      outcome: "registered",
    });
    await fn("checkout", { action: "cancel", order_id: order.orderId }, { token: c.token });
  }, 300_000);

  it("un monto distinto al aprobar NO confirma el pedido: queda en revisión y el admin la resuelve con una nota", async (ctx) => {
    needAdmin(ctx);
    const product = await makeProduct({ name: "Prenda QR monto", price: 70, stock: 3 });
    const c = await makeCustomer("monto");
    const order = await placeQrOrder(c, product);
    const path = objectPath(c, order.orderId);
    expect((await putObject(c.token, path, pngBytes(), "image/png")).status).toBe(200);
    const proofId = (await submit(c, order.paymentId, path)).body.proof_id as string;
    const result = await rpc(
      "admin_review_proof",
      { p_proof_id: proofId, p_decision: "approve", p_received_amount: 1 },
      admin!,
    );
    expect(result.body).toMatchObject({
      outcome: "approved",
      payment: { outcome: "review", review: "amount_mismatch" },
    });
    expect(
      (await svcRest("GET", `orders?id=eq.${order.orderId}&select=status`)).body[0].status,
    ).toBe("pending_payment");
    expect((await viewOf(c, order.orderId)).payment.under_review).toBe(true);
    const review = (
      await svcRest(
        "GET",
        `payment_reviews?payment_id=eq.${order.paymentId}&select=id,reason,status`,
      )
    ).body[0];
    expect(review).toMatchObject({ reason: "amount_mismatch", status: "open" });
    expect(
      (await rpc("admin_resolve_review", { p_review_id: review.id, p_note: " " }, admin!)).status,
    ).toBe(400);
    const resolved = await rpc(
      "admin_resolve_review",
      { p_review_id: review.id, p_note: "Pagó el resto por transferencia" },
      admin!,
    );
    expect(resolved.body).toMatchObject({ outcome: "resolved" });
    expect(
      (await rpc("admin_resolve_review", { p_review_id: review.id, p_note: "otra vez" }, admin!))
        .body,
    ).toMatchObject({
      outcome: "already_resolved",
    });
    await fn("checkout", { action: "cancel", order_id: order.orderId }, { token: c.token });
  }, 300_000);

  it("el administrador ve el comprobante por una URL firmada (autenticado) y la lista de cobros con su pedido", async (ctx) => {
    needAdmin(ctx);
    const product = await makeProduct({ name: "Prenda QR admin", price: 30, stock: 2 });
    const c = await makeCustomer("admin-ve");
    const order = await placeQrOrder(c, product);
    const path = objectPath(c, order.orderId);
    expect((await putObject(c.token, path, pngBytes(), "image/png")).status).toBe(200);
    expect((await submit(c, order.paymentId, path)).body.ok).toBe(true);
    expect(await getObject(admin!, path)).toBe(200);
    const list = await rest(
      "GET",
      `payments?id=eq.${order.paymentId}&select=reference,status,orders(number,contact_name),payment_proofs(status)`,
      admin!,
    );
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body[0]).toMatchObject({
      reference: order.reference,
      orders: { number: order.number },
    });
    await fn("checkout", { action: "cancel", order_id: order.orderId }, { token: c.token });
  }, 300_000);
});

describe("pagos · aviso de pago idempotente y concurrente (payment_apply_event)", () => {
  const apply = (
    provider: string,
    eventId: string,
    type: string,
    reference: string,
    amount: number | null,
  ) =>
    svcRpc("payment_apply_event", {
      p_provider: provider,
      p_event_id: eventId,
      p_type: type,
      p_reference: reference,
      p_amount: amount,
      p_currency: "BOB",
      p_external_id: null,
      p_payload: {},
      p_actor: null,
    });

  it("el MISMO aviso 20 veces y a la vez: UN solo efecto, 19 repetidos, un solo «paid»", async () => {
    guard();
    const product = await makeProduct({ name: "Prenda QR aviso", price: 90, stock: 3 });
    const c = await makeCustomer("aviso");
    const order = await placeQrOrder(c, product);
    const event = `evt-${randomTag()}`;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        apply("manual_qr", event, "paid", order.reference, order.total),
      ),
    );
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);
    const outcomes = results.map((r) => r.body.outcome as string);
    expect(outcomes.filter((o) => o === "applied")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "duplicate")).toHaveLength(19);
    expect(
      (await svcRest("GET", `orders?id=eq.${order.orderId}&select=status`)).body[0].status,
    ).toBe("paid");
    const history = await svcRest(
      "GET",
      `order_status_history?order_id=eq.${order.orderId}&to_status=eq.paid&select=id`,
    );
    expect(history.body).toHaveLength(1);
    const events = await svcRest(
      "GET",
      `webhook_events?provider=eq.manual_qr&event_id=eq.${event}&select=attempts,outcome`,
    );
    expect(events.body).toEqual([{ attempts: 20, outcome: "applied" }]);
    expect(await stockOf(product.variantId)).toBe(2);
    // y ninguna revisión: no hubo duplicado de verdad
    expect(
      (await svcRest("GET", `payment_reviews?payment_id=eq.${order.paymentId}&select=id`)).body,
    ).toEqual([]);
  }, 240_000);

  it("DOS avisos distintos a la vez para el mismo cobro: el pedido se paga UNA vez y el segundo va a revisión como duplicado", async () => {
    guard();
    const product = await makeProduct({ name: "Prenda QR doble", price: 90, stock: 3 });
    const c = await makeCustomer("doble");
    const order = await placeQrOrder(c, product);
    const results = await Promise.all([
      apply("manual_qr", `evt-${randomTag()}`, "paid", order.reference, order.total),
      apply("manual_qr", `evt-${randomTag()}`, "paid", order.reference, order.total),
    ]);
    expect(results.map((r) => r.body.outcome).sort()).toEqual(["applied", "review"]);
    expect(
      (
        await svcRest(
          "GET",
          `order_status_history?order_id=eq.${order.orderId}&to_status=eq.paid&select=id`,
        )
      ).body,
    ).toHaveLength(1);
    expect(
      (
        await svcRest(
          "GET",
          `payment_reviews?payment_id=eq.${order.paymentId}&select=reason,status`,
        )
      ).body,
    ).toEqual([{ reason: "duplicate", status: "open" }]);
  }, 240_000);

  it("el aviso contra el vencimiento en el mismo instante: el dinero NUNCA se pierde y el pedido nunca queda a medias", async () => {
    guard();
    const product = await makeProduct({ name: "Prenda QR carrera", price: 25, stock: 6 });
    const customers: Customer[] = [];
    for (let i = 0; i < 4; i++) customers.push(await makeCustomer(`carrera${i}`));
    const orders = [];
    for (const c of customers) orders.push(await placeQrOrder(c, product));
    // todos vencen ya, sin comprobante pendiente: el vencimiento los cancelaría
    const ids = orders.map((o) => `'${o.orderId}'`).join(", ");
    dbExec(
      `update public.orders set payment_expires_at = now() - interval '1 minute' where id in (${ids});` +
        `update public.payments set expires_at = now() - interval '1 minute' where order_id in (${ids});`,
    );
    const runs = await Promise.all([
      ...orders.map((o) => apply("manual_qr", `evt-${randomTag()}`, "paid", o.reference, o.total)),
      dbPsql("select public.expire_pending_payments()"),
    ]);
    for (const r of runs.slice(0, orders.length))
      expect((r as { status: number }).status).toBe(200);

    let confirmed = 0;
    let late = 0;
    for (const o of orders) {
      const order = (await svcRest("GET", `orders?id=eq.${o.orderId}&select=status`)).body[0]
        .status as string;
      const payment = (await svcRest("GET", `payments?id=eq.${o.paymentId}&select=status`)).body[0]
        .status as string;
      const reviews = (
        await svcRest("GET", `payment_reviews?payment_id=eq.${o.paymentId}&select=reason,status`)
      ).body as {
        reason: string;
        status: string;
      }[];
      // el dinero llegó y queda registrado en los dos desenlaces
      expect(payment, o.number).toBe("paid");
      if (order === "paid") {
        confirmed++;
        expect(reviews, o.number).toEqual([]);
      } else {
        // ganó el vencimiento: el pedido quedó cancelado y el pago tardío abrió una revisión (no se perdió el dinero)
        expect(order, o.number).toBe("cancelled");
        expect(reviews, o.number).toEqual([{ reason: "late", status: "open" }]);
        late++;
      }
    }
    expect(confirmed + late).toBe(4);
    // el stock: lo cancelado volvió; lo pagado sigue descontado (4 vendidos − cancelados)
    expect(await stockOf(product.variantId)).toBe(6 - confirmed);
  }, 300_000);

  it("un aviso de OTRO proveedor sobre un cobro QR manual no lo paga (si un secreto se filtrara, no se confirmarían pedidos ajenos)", async () => {
    guard();
    const product = await makeProduct({ name: "Prenda QR proveedor", price: 45, stock: 2 });
    const c = await makeCustomer("proveedor");
    const order = await placeQrOrder(c, product);
    const foreign = await apply(
      "qr_api",
      `evt-${randomTag()}`,
      "paid",
      order.reference,
      order.total,
    );
    expect(foreign.body.outcome).toBe("unknown_reference");
    expect((await viewOf(c, order.orderId)).order.status).toBe("pending_payment");
    const own = await apply(
      "manual_qr",
      `evt-${randomTag()}`,
      "paid",
      order.reference,
      order.total,
    );
    expect(own.body.outcome).toBe("applied");
    expect((await viewOf(c, order.orderId)).order.status).toBe("paid");
  }, 120_000);

  it("un aviso para una referencia que no existe se registra sin tocar nada; fallido → el pedido sigue y se puede reintentar", async () => {
    guard();
    const unknown = await apply("qr_api", `evt-${randomTag()}`, "paid", "MIC-999999", 10);
    expect(unknown.body.outcome).toBe("unknown_reference");
    const product = await makeProduct({ name: "Prenda QR fallo", price: 35, stock: 3 });
    const c = await makeCustomer("fallo");
    const order = await placeQrOrder(c, product);
    expect(
      (await apply("manual_qr", `evt-${randomTag()}`, "failed", order.reference, null)).body
        .outcome,
    ).toBe("applied");
    const view = await viewOf(c, order.orderId);
    expect(view.payment.status).toBe("failed");
    expect(view.can_retry).toBe(true);
    expect(view.order.status).toBe("pending_payment");
    // la clienta reintenta por la función: cobro nuevo, referencia con «-2», ventana nueva
    const retry = await fn(
      "payments",
      { action: "retry", order_id: order.orderId },
      { token: c.token },
    );
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body).toMatchObject({ ok: true, outcome: "retried" });
    const after = await viewOf(c, order.orderId);
    expect(after.payment.reference).toBe(`${order.number}-2`);
    expect(after.payment.status).toBe("pending");
    expect(after.can_upload).toBe(true);
    // otra clienta no puede reintentar un pedido ajeno
    const other = await makeCustomer("fallo-otra");
    expect(
      (await fn("payments", { action: "retry", order_id: order.orderId }, { token: other.token }))
        .body,
    ).toMatchObject({
      ok: false,
      outcome: "not_found",
    });
    await fn("checkout", { action: "cancel", order_id: order.orderId }, { token: c.token });
  }, 300_000);
});

describe("pagos · vencimiento", () => {
  it("sin pago en 24 h el pedido se cancela, el stock vuelve y la clienta lo ve; con un comprobante en revisión NO se cancela solo", async () => {
    guard();
    const product = await makeProduct({ name: "Prenda QR vence", price: 45, stock: 4 });
    const a = await makeCustomer("vence-a");
    const b = await makeCustomer("vence-b");
    const without = await placeQrOrder(a, product);
    const withProof = await placeQrOrder(b, product);
    const path = objectPath(b, withProof.orderId);
    expect((await putObject(b.token, path, pngBytes(), "image/png")).status).toBe(200);
    expect((await submit(b, withProof.paymentId, path)).body.ok).toBe(true);
    expect(await stockOf(product.variantId)).toBe(2);

    const ids = `'${without.orderId}', '${withProof.orderId}'`;
    dbExec(
      `update public.orders set payment_expires_at = now() - interval '1 minute' where id in (${ids});` +
        `update public.payments set expires_at = now() - interval '1 minute' where order_id in (${ids});`,
    );
    dbExec("select public.expire_pending_payments()");

    const viewA = await viewOf(a, without.orderId);
    expect(viewA.order.status).toBe("cancelled");
    expect(viewA.payment.status).toBe("expired");
    expect(viewA.can_upload).toBe(false);
    expect(await stockOf(product.variantId)).toBe(3); // volvió la del pedido vencido
    expect(
      (await svcRest("GET", `orders?id=eq.${without.orderId}&select=cancelled_by,cancel_reason`))
        .body[0],
    ).toEqual({
      cancelled_by: "system",
      cancel_reason: "expired",
    });
    // pagar un pedido vencido ya no se puede: ni subir comprobantes ni reintentar
    const late = objectPath(a, without.orderId);
    expect((await putObject(a.token, late, pngBytes(), "image/png")).status).not.toBe(200);
    expect(
      (await fn("payments", { action: "retry", order_id: without.orderId }, { token: a.token }))
        .body,
    ).toMatchObject({
      outcome: "order_closed",
    });

    // con un comprobante pendiente de revisión, el pedido sigue en pie
    const viewB = await viewOf(b, withProof.orderId);
    expect(viewB.order.status).toBe("pending_payment");
    expect(viewB.proof.status).toBe("pending");
    // y «Volver a pedir»: sus líneas se pueden leer para rellenar la bolsa
    const lines = await rest(
      "GET",
      `order_items?order_id=eq.${without.orderId}&select=variant_id,qty&order=line_no`,
      a.token,
    );
    expect(lines.body).toEqual([{ variant_id: product.variantId, qty: 1 }]);
    await fn("checkout", { action: "cancel", order_id: withProof.orderId }, { token: b.token });
    expect(await stockOf(product.variantId)).toBe(4);
  }, 300_000);
});

describe("pagos · la función del webhook (sin el secreto del proveedor)", () => {
  const url = () => `${testEnv().url}/functions/v1/payment-webhook`;
  const post = (provider: string, body: string, headers: Record<string, string> = {}) =>
    fetch(`${url()}/${provider}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: testEnv().anon, ...headers },
      body,
    });

  it("solo POST; un proveedor que no existe o que no avisa por webhook no recibe nada", async () => {
    guard();
    const get = await fetch(`${url()}/qr_api`, { headers: { apikey: testEnv().anon } });
    expect(get.status).toBe(405);
    expect((await post("proveedor_inventado", "{}")).status).toBe(404);
    expect((await post("manual_qr", "{}")).status).toBe(404); // el QR manual no avisa
    expect((await post("whatsapp", "{}")).status).toBe(404);
    expect((await post("QR%20API", "{}")).status).toBe(404);
  });

  it("un aviso sin firma o con firma mala se RECHAZA y queda registrado, sin cuerpo", async () => {
    guard();
    const before =
      (
        await svcRest(
          "GET",
          "webhook_events?signature_valid=eq.false&select=id&order=id.desc&limit=1",
        )
      ).body[0]?.id ?? 0;
    const payload = JSON.stringify({
      event_id: `evt-${randomTag()}`,
      type: "payment.paid",
      reference: "MIC-000001",
      amount: 1,
    });
    const unsigned = await post("qr_api", payload);
    // 401 con secreto configurado, 503 sin él: NUNCA 200
    expect([401, 503]).toContain(unsigned.status);
    const forged = await post("qr_api", payload, {
      "x-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"a".repeat(64)}`,
    });
    expect([401, 503]).toContain(forged.status);
    const garbage = await post("qr_api", payload, { "x-signature": "esto-no-es-una-firma" });
    expect([401, 503]).toContain(garbage.status);

    const rows = (
      await svcRest(
        "GET",
        `webhook_events?signature_valid=eq.false&id=gt.${before}&provider=eq.qr_api&select=outcome,error,payload,event_id&order=id`,
      )
    ).body as {
      outcome: string;
      error: string;
      payload: Record<string, unknown>;
      event_id: string | null;
    }[];
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(row.outcome).toBe("rejected");
      expect(row.event_id).toBeNull();
      expect(row.error.length).toBeGreaterThan(0);
      // NUNCA el cuerpo de un aviso que no se pudo autenticar: solo su tamaño y si traía firma
      expect(Object.keys(row.payload).sort()).toEqual(["bytes", "has_signature"]);
    }
  });

  it("un aviso rechazado no cambia ningún cobro (aunque diga «pagado» de un pedido que existe)", async () => {
    guard();
    const product = await makeProduct({ name: "Prenda QR falsificada", price: 20, stock: 2 });
    const c = await makeCustomer("falsificar");
    const order = await placeQrOrder(c, product);
    const forged = await post(
      "qr_api",
      JSON.stringify({
        event_id: `evt-${randomTag()}`,
        type: "payment.paid",
        reference: order.reference,
        amount: order.total,
      }),
      { "x-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"b".repeat(64)}` },
    );
    expect([401, 503]).toContain(forged.status);
    expect(
      (await svcRest("GET", `orders?id=eq.${order.orderId}&select=status`)).body[0].status,
    ).toBe("pending_payment");
    expect(
      (await svcRest("GET", `payments?id=eq.${order.paymentId}&select=status`)).body[0].status,
    ).toBe("pending");
    await fn("checkout", { action: "cancel", order_id: order.orderId }, { token: c.token });
  }, 240_000);

  it("un cuerpo de más de 16 kB se corta con 413 sin procesarlo", async () => {
    guard();
    const big = await post("qr_api", JSON.stringify({ pad: "x".repeat(17_000) }));
    expect(big.status).toBe(413);
  });
});

describe("pagos · la función payments (acceso y límites)", () => {
  it("sin sesión no hay nada: 401; el esquema es estricto (un campo de más → 400); solo POST", async () => {
    guard();
    const anon = await fn("payments", { action: "retry", order_id: randomUUID() });
    expect(anon.status).toBe(401);
    const c = await makeCustomer("acceso");
    const extra = await fn(
      "payments",
      { action: "retry", order_id: randomUUID(), profile_id: c.id },
      { token: c.token },
    );
    expect(extra.status).toBe(400);
    const badAction = await fn(
      "payments",
      { action: "aprobar", order_id: randomUUID() },
      { token: c.token },
    );
    expect(badAction.status).toBe(400);
    const get = await fetch(`${testEnv().url}/functions/v1/payments`, {
      method: "GET",
      headers: { apikey: testEnv().anon },
    });
    expect(get.status).toBe(405);
    const big = await fn(
      "payments",
      { action: "retry", order_id: randomUUID(), pad: "x".repeat(2000) },
      { token: c.token },
    );
    expect(big.status).toBe(413);
  }, 120_000);

  it("reintentar tiene tope por clienta: el 6.º intento en 10 minutos da 429", async () => {
    guard();
    const c = await makeCustomer("tasa");
    await clearRateLimits();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (await fn("payments", { action: "retry", order_id: randomUUID() }, { token: c.token }))
          .status,
      );
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
    await clearRateLimits();
  }, 120_000);

  it("conciliar solo lo ejecuta un administrador", async (ctx) => {
    guard();
    const c = await makeCustomer("concilia");
    const denied = await fn("payment-reconcile", {}, { token: c.token });
    expect(denied.status).toBe(403);
    expect((await fn("payment-reconcile", {})).status).toBe(401);
    needAdmin(ctx);
    const ok = await fn("payment-reconcile", {}, { token: admin! });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    // hoy ningún proveedor de producción puede consultarse: revisa y no cambia nada
    expect(ok.body).toMatchObject({ ok: true, changed: 0, errors: 0 });
  }, 120_000);
});
