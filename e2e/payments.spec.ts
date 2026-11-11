import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { clearRateLimits, dbExec, fn, rpc, svcRest, svcRpc } from "../test-support/api";
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
  type Customer,
} from "../test-support/shop";

/**
 * Pago con QR (Sprint 11) en un navegador real contra la nube, como clienta: el código, el monto exacto, la referencia, la cuenta
 * regresiva, la subida del comprobante y cada estado del pago (en revisión, confirmado sin recargar, rechazado con motivo,
 * vencido con «Volver a pedir»). Además: archivo inválido sin tocar el servidor, accesibilidad AA, CLS y sin desbordes.
 *
 * El método «qr_manual» se enciende durante la prueba (con una imagen y una cuenta de prueba) y se deja como estaba. Crea clientas
 * `@prueba.test` y productos de prueba; los pedidos son inmutables a propósito (se cancelan al final cuando se puede).
 */

const SLOW = { timeout: 30_000 };
let original: Record<string, unknown> | null = null;
let admin: { token: string; refresh: string } | null = null;

test.describe.configure({ timeout: 150_000 });

test.beforeAll(async () => {
  original = await enableQr();
  admin = await adminSession();
});
test.afterAll(async () => {
  await restoreQr(original);
});
test.beforeEach(async () => {
  test.skip(original === null, "Falta el método de pago «qr_manual» (S11).");
  await clearRateLimits();
});

async function openOrder(page: Page, customer: Customer, number: string) {
  await signInAs(page, customer);
  await page.goto(`/pedido/${number}`);
  await expect(page.getByRole("heading", { level: 2, name: "Paga con QR" })).toBeVisible(SLOW);
}

const panel = (page: Page) => page.getByRole("region", { name: "Paga con QR" });

test("compra por QR: ve el código, el monto exacto y la referencia; sube su comprobante («en revisión») y, al confirmarse el pago, la pantalla lo muestra SIN recargar", async ({
  page,
}) => {
  const product = await makeProduct(80, 5);
  const customer = await makeCustomer();
  await fn(
    "cart",
    { action: "set_item", variant_id: product.variantId, qty: 1 },
    { token: customer.token },
  );
  await signInAs(page, customer);
  await page.goto("/checkout");
  await expect(page.getByRole("heading", { level: 1, name: "Finalizar compra" })).toBeVisible(SLOW);
  await expect(page.getByTestId("checkout-total")).not.toHaveText("—", SLOW);
  await page.getByRole("radio", { name: /Pago con QR/ }).check();
  await page.getByLabel("Teléfono (WhatsApp)").fill("71234567");
  await page.getByRole("button", { name: "Confirmar pedido" }).click();

  await expect(page).toHaveURL(/\/pedido\/MIC-\d{6,}$/, SLOW);
  const number = page.url().match(/MIC-\d{6,}/)![0];
  await expect(page.getByRole("heading", { level: 2, name: "Paga con QR" })).toBeVisible(SLOW);
  const order = (await svcRest("GET", `orders?number=eq.${number}&select=id,total`)).body[0];
  const total = Number(order.total);

  // el código de la tienda, el monto EXACTO, la referencia (= número del pedido), la cuenta y la cuenta regresiva
  const qr = panel(page).getByRole("img", { name: `Código QR para pagar el pedido ${number}` });
  await expect(qr).toBeVisible(SLOW);
  await expect(qr).toHaveAttribute("src", /\/storage\/v1\/object\/public\/payment-qr\/qr\//);
  // la imagen CARGÓ de verdad (no es un ícono roto)
  await expect
    .poll(() => qr.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), SLOW)
    .toBe(true);
  await expect(page.getByTestId("payment-amount")).toHaveText(money(total));
  await expect(page.getByTestId("payment-reference")).toHaveText(number);
  await expect(panel(page).getByText(ACCOUNT)).toBeVisible();
  await expect(page.getByTestId("payment-countdown")).toHaveText(/^2[34]:\d\d:\d\d$/);
  await expect(panel(page).getByText("Falta tu pago")).toBeVisible();

  // sube su comprobante
  await panel(page).getByLabel("Comprobante de pago").setInputFiles(pngFile());
  await expect(panel(page).getByText("Archivo elegido: comprobante.png")).toBeVisible();
  await panel(page).getByRole("button", { name: "Enviar comprobante" }).click();
  await expect(panel(page).getByText("Recibimos tu comprobante", { exact: true })).toBeVisible(
    SLOW,
  );
  await expect(panel(page).getByRole("heading", { name: "Sube tu comprobante" })).toHaveCount(0);
  const proof = (await svcRest("GET", `payment_proofs?order_id=eq.${order.id}&select=status,mime`))
    .body;
  expect(proof).toEqual([{ status: "pending", mime: "image/png" }]);
  // el pedido sigue reservado: el stock está descontado
  expect(await stockOf(product.variantId)).toBe(4);

  // el banco/proveedor confirma el pago: la pantalla lo ve por sí sola (consulta cada 10 s), sin recargar
  const paymentId = (await svcRest("GET", `payments?order_id=eq.${order.id}&select=id,reference`))
    .body[0];
  const applied = await svcRpc("payment_apply_event", {
    p_provider: "manual_qr",
    p_event_id: `e2e-${Date.now()}`,
    p_type: "paid",
    p_reference: paymentId.reference,
    p_amount: total,
    p_currency: "BOB",
    p_external_id: null,
    p_payload: {},
    p_actor: null,
  });
  expect(applied.body.outcome).toBe("applied");
  await expect(panel(page).getByText("Pago confirmado", { exact: true })).toBeVisible({
    timeout: 40_000,
  });
  await expect(page.getByTestId("payment-countdown")).toHaveCount(0);
  await expect(panel(page).getByRole("img", { name: /Código QR/ })).toHaveCount(0);
});

test("un comprobante rechazado: la clienta ve el MOTIVO y puede subir otro", async ({ page }) => {
  test.skip(!admin, "No hay una cuenta de administración de prueba (@prueba.test).");
  const product = await makeProduct(60, 4);
  const customer = await makeCustomer();
  const order = await placeQrOrder(customer, product.variantId);
  await openOrder(page, customer, order.number);
  await panel(page).getByLabel("Comprobante de pago").setInputFiles(pngFile());
  await panel(page).getByRole("button", { name: "Enviar comprobante" }).click();
  await expect(panel(page).getByText("Recibimos tu comprobante", { exact: true })).toBeVisible(
    SLOW,
  );

  const proofId = (await svcRest("GET", `payment_proofs?order_id=eq.${order.orderId}&select=id`))
    .body[0].id;
  const rejected = await rpc(
    "admin_review_proof",
    { p_proof_id: proofId, p_decision: "reject", p_reason: "No se ve el monto" },
    admin!.token,
  );
  expect(rejected.body.outcome).toBe("rejected");
  await expect(panel(page).getByText("No pudimos aceptar tu comprobante")).toBeVisible({
    timeout: 40_000,
  });
  await expect(panel(page).getByText(/Motivo: No se ve el monto/)).toBeVisible();
  await expect(panel(page).getByRole("heading", { name: "Sube tu comprobante" })).toBeVisible();
  await fn("checkout", { action: "cancel", order_id: order.orderId }, { token: customer.token });
});

test("sin pago en el tiempo, el pedido vence: lo ve, el stock vuelve y «Volver a pedir» le rellena la bolsa", async ({
  page,
}) => {
  const product = await makeProduct(45, 3);
  const customer = await makeCustomer();
  const order = await placeQrOrder(customer, product.variantId);
  expect(await stockOf(product.variantId)).toBe(2);
  dbExec(
    `update public.orders set payment_expires_at = now() - interval '1 minute' where id = '${order.orderId}';` +
      `update public.payments set expires_at = now() - interval '1 minute' where order_id = '${order.orderId}';`,
  );
  dbExec("select public.expire_pending_payments()");
  expect(await stockOf(product.variantId)).toBe(3);

  await signInAs(page, customer);
  await page.goto(`/pedido/${order.number}`);
  await expect(panel(page).getByText("El tiempo para pagar terminó", { exact: true })).toBeVisible(
    SLOW,
  );
  await expect(panel(page).getByText(/devolvimos los productos al inventario/)).toBeVisible();
  await expect(panel(page).getByRole("img", { name: /Código QR/ })).toHaveCount(0);
  await expect(panel(page).getByRole("heading", { name: "Sube tu comprobante" })).toHaveCount(0);

  await panel(page).getByRole("button", { name: "Volver a pedir" }).click();
  await expect(page).toHaveURL(/\/carrito$/, SLOW);
  await expect(page.getByText(product.name).first()).toBeVisible(SLOW);
});

test("un archivo que no es un comprobante se explica en la pantalla y NO sale nada al servidor", async ({
  page,
}) => {
  const product = await makeProduct(30, 3);
  const customer = await makeCustomer();
  const order = await placeQrOrder(customer, product.variantId);
  const calls: string[] = [];
  page.on("request", (r) => {
    if (/\/functions\/v1\/payments|\/storage\/v1\/object\/payment-proofs/.test(r.url()))
      calls.push(r.url());
  });
  await openOrder(page, customer, order.number);
  await panel(page)
    .getByLabel("Comprobante de pago")
    .setInputFiles({
      name: "comprobante.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("<svg><script>alert(1)</script></svg>"),
    });
  await expect(panel(page).getByRole("alert")).toContainText(
    "Solo aceptamos fotos (JPG, PNG o WebP) y PDF.",
  );
  await expect(panel(page).getByRole("button", { name: "Enviar comprobante" })).toBeDisabled();
  expect(calls).toEqual([]);
  expect(
    (await svcRest("GET", `payment_proofs?order_id=eq.${order.orderId}&select=id`)).body,
  ).toEqual([]);
  await fn("checkout", { action: "cancel", order_id: order.orderId }, { token: customer.token });
});

test("accesibilidad AA, CLS y sin desbordes en la pantalla de pago", async ({ page }, info) => {
  const product = await makeProduct(70, 3);
  const customer = await makeCustomer();
  const order = await placeQrOrder(customer, product.variantId);
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number; __shifts: string[] };
    w.__cls = 0;
    w.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
        startTime: number;
        sources: { node: Node | null }[];
      }[]) {
        if (e.hadRecentInput) continue;
        w.__cls += e.value;
        if (e.value >= 0.005) {
          const nodes = e.sources.map((s) => {
            const el = s.node as HTMLElement | null;
            return el ? `${el.nodeName.toLowerCase()}.${String(el.className).slice(0, 40)}` : "?";
          });
          w.__shifts.push(
            `${Math.round(e.startTime)}ms ${e.value.toFixed(3)} ${nodes.join(" | ")}`,
          );
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await openOrder(page, customer, order.number);
  await expect(panel(page).getByRole("img", { name: /Código QR/ })).toBeVisible(SLOW);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  info.annotations.push({ type: "CLS", description: cls.toFixed(4) });
  process.stdout.write(`CLS_PAGO ${info.project.name} ${cls.toFixed(4)}\n`);
  const shifts = await page.evaluate(() => (window as unknown as { __shifts: string[] }).__shifts);
  if (cls >= 0.1) process.stdout.write(`SHIFTS ${info.project.name}\n${shifts.join("\n")}\n`);
  expect(cls).toBeLessThan(0.1);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
  ).toEqual([]);
  // los controles se tocan bien en móvil
  if (info.project.name === "mobile") {
    const send = await panel(page)
      .getByRole("button", { name: "Enviar comprobante" })
      .boundingBox();
    expect(send!.height).toBeGreaterThanOrEqual(36);
  }
  await fn("checkout", { action: "cancel", order_id: order.orderId }, { token: customer.token });
});
