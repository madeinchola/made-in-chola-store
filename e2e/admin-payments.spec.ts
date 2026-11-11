import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { clearRateLimits, fn, svcRest, svcRpc } from "../test-support/api";
import {
  ACCOUNT,
  adminSession,
  enableQr,
  makeCustomer,
  makeProduct,
  money,
  placeQrOrder,
  pngFile,
  restoreQr,
  signInAs,
  stockOf,
} from "../test-support/shop";

/**
 * Panel de Pagos (Sprint 11) en un navegador real contra la nube, como administradora.
 *
 * NO crea cuentas de administración: reutiliza una `@prueba.test` que ya existe (entra con un enlace de recuperación que genera
 * la clave de servicio); si no hay, se salta. Las clientas, los productos y los pedidos de prueba son inertes (los pedidos son
 * inmutables a propósito). El método «qr_manual» se enciende durante la prueba y se deja como estaba.
 *
 * Cubre lo que las pruebas de componentes (con la red simulada) no pueden: que el panel carga con TODOS sus textos reales (una
 * clave sin registrar se vería como `admin.payments.…`), que el comprobante se ve por una URL firmada, que cada decisión
 * llega a la base y a la clienta, y que el QR subido queda guardado.
 */

const SLOW = { timeout: 30_000 };
let original: Record<string, unknown> | null = null;
let admin: { token: string; refresh: string } | null = null;

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async () => {
  original = await enableQr();
  admin = await adminSession();
});
test.afterAll(async () => {
  await restoreQr(original);
});
test.beforeEach(async () => {
  test.skip(original === null, "Falta el método de pago «qr_manual» (S11).");
  test.skip(!admin, "No hay una cuenta de administración de prueba (@prueba.test) para entrar.");
  await clearRateLimits();
});

/** Una clave de texto sin registrar se vería como `admin.payments.…`. */
const rawKeys = (page: Page) =>
  page
    .locator("main")
    .evaluate((el) => el.textContent?.match(/\badmin\.[a-z]+\.[A-Za-z0-9_.]+/g) ?? []);

function trackConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Una clienta que ya subió su comprobante: el pedido, el cobro y el comprobante pendiente. */
async function orderWithProof(price: number) {
  const product = await makeProduct(price, 4);
  const customer = await makeCustomer();
  const order = await placeQrOrder(customer, product.variantId);
  const path = `${customer.id}/${order.orderId}/${crypto.randomUUID()}.png`;
  const file = pngFile();
  const put = await fetch(
    `${process.env.VITE_SUPABASE_URL}/storage/v1/object/payment-proofs/${path}`,
    {
      method: "POST",
      headers: {
        apikey: process.env.VITE_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${customer.token}`,
        "Content-Type": "image/png",
      },
      body: file.buffer as unknown as BodyInit,
    },
  );
  expect(put.status).toBe(200);
  const submitted = await fn(
    "payments",
    { action: "proof_submit", payment_id: order.paymentId, path },
    { token: customer.token },
  );
  expect(submitted.body).toMatchObject({ ok: true, outcome: "registered" });
  return { product, customer, order, path, proofId: submitted.body.proof_id as string };
}

test("las tres pestañas cargan con sus textos reales, sin errores de consola y pasan axe AA", async ({
  page,
}, info) => {
  const errors = trackConsoleErrors(page);
  await signInAs(page, admin!);
  await page.goto("/admin/pagos");
  await expect(page.getByRole("heading", { level: 1, name: "Pagos" })).toBeVisible(SLOW);
  const tabs = page.getByRole("navigation", { name: "Secciones de Pagos" });
  for (const name of ["Por revisar", "Pagos", "Métodos"]) {
    await expect(tabs.getByRole("link", { name })).toBeVisible();
  }
  await expect(
    page.getByRole("heading", { level: 2, name: "Comprobantes por revisar" }),
  ).toBeVisible(SLOW);
  expect(await rawKeys(page)).toEqual([]);

  for (const tab of ["Pagos", "Métodos"]) {
    await tabs.getByRole("link", { name: tab }).click();
    await expect(page.getByRole("table").first()).toBeVisible(SLOW);
    expect(await rawKeys(page), tab).toEqual([]);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map(
        (v) =>
          `${v.id}: ${v.nodes.map((n) => n.target.join(" ") + " => " + n.html.slice(0, 160)).join(" | ")}`,
      ),
      tab,
    ).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${tab} (${info.project.name})`).toBeLessThanOrEqual(0);
  }
  expect(errors).toEqual([]);
});

test("«Por revisar»: ve el comprobante por una URL firmada y APRUEBA: el pedido queda pagado y la clienta lo ve", async ({
  page,
}) => {
  const { product, customer, order, path, proofId } = await orderWithProof(55);
  await signInAs(page, admin!);
  await page.goto("/admin/pagos");
  const card = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: `Pedido ${order.number}` }) });
  await expect(card).toBeVisible(SLOW);
  await expect(card.getByText(order.reference, { exact: true })).toBeVisible();
  await expect(card.getByText(money(order.total)).first()).toBeVisible();

  // el archivo se ve por una URL FIRMADA (el bucket es privado)
  const image = card.getByAltText("Comprobante de pago de la clienta");
  await expect(image).toBeVisible(SLOW);
  expect(await image.getAttribute("src")).toMatch(
    /\/storage\/v1\/object\/sign\/payment-proofs\/.+token=/,
  );
  // el navegador la DECODIFICÓ (no es un ícono roto)
  await expect
    .poll(
      () => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      SLOW,
    )
    .toBe(true);
  // sin la firma, la URL pública del mismo archivo no sirve
  const publicUrl = `${process.env.VITE_SUPABASE_URL}/storage/v1/object/public/payment-proofs/${path}`;
  expect((await fetch(publicUrl)).status).not.toBe(200);

  await card.getByRole("button", { name: "Aprobar" }).click();
  const dialog = page.getByRole("dialog", {
    name: `Aprobar el comprobante del pedido ${order.number}`,
  });
  await dialog.getByRole("button", { name: "Aprobar y confirmar el pago" }).click();
  await expect(dialog).toHaveCount(0, SLOW);
  await expect(page.getByRole("heading", { name: `Pedido ${order.number}` })).toHaveCount(0, SLOW);

  const row = (await svcRest("GET", `orders?id=eq.${order.orderId}&select=status`)).body[0];
  expect(row.status).toBe("paid");
  expect(
    (await svcRest("GET", `payment_proofs?id=eq.${proofId}&select=status,reviewed_by`)).body[0],
  ).toMatchObject({
    status: "approved",
  });
  expect(await stockOf(product.variantId)).toBe(3);
  // la clienta ve el pago confirmado
  const customerPage = await page.context().newPage();
  await signInAs(customerPage, customer);
  await customerPage.goto(`/pedido/${order.number}`);
  await expect(customerPage.getByText("Pago confirmado", { exact: true })).toBeVisible(SLOW);
  await customerPage.close();
});

test("«Por revisar»: RECHAZA con motivo (obligatorio) y la clienta lo ve; el comprobante deja la bandeja", async ({
  page,
}) => {
  const { customer, order, proofId } = await orderWithProof(65);
  await signInAs(page, admin!);
  await page.goto("/admin/pagos");
  const card = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: `Pedido ${order.number}` }) });
  await expect(card).toBeVisible(SLOW);
  await card.getByRole("button", { name: "Rechazar" }).click();
  const dialog = page.getByRole("dialog", {
    name: `Rechazar el comprobante del pedido ${order.number}`,
  });
  await dialog.getByRole("button", { name: "Rechazar comprobante" }).click();
  await expect(dialog.getByText("Escribe el motivo del rechazo.")).toBeVisible();
  expect(
    (await svcRest("GET", `payment_proofs?id=eq.${proofId}&select=status`)).body[0].status,
  ).toBe("pending");
  await dialog.getByLabel(/Motivo/).fill("El comprobante es de otra fecha");
  await dialog.getByRole("button", { name: "Rechazar comprobante" }).click();
  await expect(dialog).toHaveCount(0, SLOW);
  await expect(page.getByRole("heading", { name: `Pedido ${order.number}` })).toHaveCount(0, SLOW);
  expect(
    (await svcRest("GET", `payment_proofs?id=eq.${proofId}&select=status,reason`)).body[0],
  ).toEqual({
    status: "rejected",
    reason: "El comprobante es de otra fecha",
  });
  const view = await svcRest("GET", `orders?id=eq.${order.orderId}&select=status`);
  expect(view.body[0].status).toBe("pending_payment");
  await fn("checkout", { action: "cancel", order_id: order.orderId }, { token: customer.token });
});

test("un pago con monto distinto aparece en «Pagos que necesitan tu decisión» y se resuelve con una nota", async ({
  page,
}) => {
  const product = await makeProduct(75, 3);
  const customer = await makeCustomer();
  const order = await placeQrOrder(customer, product.variantId);
  const applied = await svcRpc("payment_apply_event", {
    p_provider: "manual_qr",
    p_event_id: `e2e-${Date.now()}`,
    p_type: "paid",
    p_reference: order.reference,
    p_amount: 1,
    p_currency: "BOB",
    p_external_id: null,
    p_payload: {},
    p_actor: null,
  });
  expect(applied.body).toMatchObject({ outcome: "review", review: "amount_mismatch" });
  await signInAs(page, admin!);
  await page.goto("/admin/pagos");
  const card = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: `Pedido ${order.number}` }) });
  await expect(card).toBeVisible(SLOW);
  await expect(card.getByText("Monto distinto")).toBeVisible();
  await expect(
    card.getByText(new RegExp(`Se esperaba ${money(order.total)} y llegó ${money(1)}`)),
  ).toBeVisible();
  await card.getByRole("button", { name: "Marcar como resuelta" }).click();
  const dialog = page.getByRole("dialog", {
    name: `Resolver la revisión del pedido ${order.number}`,
  });
  await dialog.getByRole("button", { name: "Marcar como resuelta" }).click();
  await expect(dialog.getByText("Escribe qué hiciste.")).toBeVisible();
  await dialog.getByLabel(/Qué hiciste/).fill("Completó el pago por transferencia");
  await dialog.getByRole("button", { name: "Marcar como resuelta" }).click();
  await expect(dialog).toHaveCount(0, SLOW);
  await expect(page.getByRole("heading", { name: `Pedido ${order.number}` })).toHaveCount(0, SLOW);
  expect(
    (await svcRest("GET", `payment_reviews?payment_id=eq.${order.paymentId}&select=status,note`))
      .body[0],
  ).toEqual({
    status: "resolved",
    note: "Completó el pago por transferencia",
  });
  await fn("checkout", { action: "cancel", order_id: order.orderId }, { token: customer.token });
});

test("«Pagos»: lista el cobro, filtra por estado, muestra el detalle con el aviso recibido y confirma un pago a mano", async ({
  page,
}) => {
  const product = await makeProduct(40, 3);
  const customer = await makeCustomer();
  const order = await placeQrOrder(customer, product.variantId);
  await svcRpc("payment_apply_event", {
    p_provider: "manual_qr",
    p_event_id: `e2e-${Date.now()}`,
    p_type: "failed",
    p_reference: order.reference,
    p_amount: null,
    p_currency: "BOB",
    p_external_id: null,
    p_payload: {},
    p_actor: null,
  });
  await signInAs(page, admin!);
  await page.goto("/admin/pagos/lista");
  await page.getByLabel("Estado").selectOption("failed");
  const table = page.getByRole("table", { name: "Cobros" });
  await expect(table.getByText(order.number, { exact: true }).first()).toBeVisible(SLOW);
  await expect(table.getByText("Fallido").first()).toBeVisible();
  await page.getByRole("button", { name: `Ver detalle del cobro ${order.reference}` }).click();
  const detail = page.getByRole("dialog", { name: `Cobro ${order.reference}` });
  await expect(detail.getByText("Avisos recibidos")).toBeVisible(SLOW);
  await expect(detail.getByText("Aplicado")).toBeVisible(SLOW);

  // lo vio en el banco: lo confirma a mano
  await detail.getByRole("button", { name: "Confirmar el pago a mano" }).click();
  const form = page.getByRole("dialog", { name: `Confirmar el pago ${order.reference} a mano` });
  await form.getByLabel(/Nota/).fill("Visto en el banco");
  await form.getByRole("button", { name: "Confirmar el pago" }).click();
  await expect(form).toHaveCount(0, SLOW);
  expect((await svcRest("GET", `orders?id=eq.${order.orderId}&select=status`)).body[0].status).toBe(
    "paid",
  );
  expect(
    (await svcRest("GET", `payments?id=eq.${order.paymentId}&select=status`)).body[0].status,
  ).toBe("paid");
});

test("«Métodos»: sube el QR de la tienda, escribe su cuenta y la clienta lo ve en su pantalla de pago", async ({
  page,
}) => {
  const NEW_ACCOUNT = `Banco E2E · cuenta ${Math.floor(Math.random() * 1e6)}`;
  await signInAs(page, admin!);
  await page.goto("/admin/pagos/metodos");
  await page
    .getByRole("button", { name: /Editar el método Pago con QR/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: /Editar «Pago con QR/ });
  await expect(dialog).toBeVisible(SLOW);
  await dialog.getByLabel("Datos de tu cuenta").fill(NEW_ACCOUNT);
  await dialog.getByLabel("Imagen del QR").setInputFiles(pngFile("mi-qr.png"));
  await expect(dialog.getByText(/Imagen nueva lista/)).toBeVisible();
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog).toHaveCount(0, SLOW);

  const saved = (
    await svcRest(
      "GET",
      "payment_methods?country=eq.BO&code=eq.qr_manual&select=account_details,qr_image_path,is_active",
    )
  ).body[0];
  expect(saved.account_details).toBe(NEW_ACCOUNT);
  expect(saved.qr_image_path).toMatch(/^qr\/[0-9a-f-]{36}\.png$/);
  expect(saved.is_active).toBe(true);
  // la imagen es PÚBLICA (la ve cualquiera que paga)
  const publicQr = await fetch(
    `${process.env.VITE_SUPABASE_URL}/storage/v1/object/public/payment-qr/${saved.qr_image_path}`,
  );
  expect(publicQr.status).toBe(200);

  // y la clienta lo ve en su pantalla de pago
  const customer = await makeCustomer();
  const product = await makeProduct(35, 2);
  const order = await placeQrOrder(customer, product.variantId);
  const customerPage = await page.context().newPage();
  await signInAs(customerPage, customer);
  await customerPage.goto(`/pedido/${order.number}`);
  await expect(customerPage.getByText(NEW_ACCOUNT)).toBeVisible(SLOW);
  await expect(customerPage.getByRole("img", { name: /Código QR/ })).toHaveAttribute(
    "src",
    new RegExp(saved.qr_image_path),
  );
  await customerPage.close();
  await fn("checkout", { action: "cancel", order_id: order.orderId }, { token: customer.token });
  expect(ACCOUNT).not.toBe(NEW_ACCOUNT);
});
