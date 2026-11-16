import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  clearRateLimits,
  randomTag,
  registerAndLogin,
  rpc,
  svcRest,
  svcRpc,
} from "../test-support/api";
import { adminSession, signInAs, stockOf } from "../test-support/shop";

/**
 * Panel de Pedidos (Sprint 12) en un navegador real contra la nube, como administradora.
 *
 * NO crea cuentas de administración: reutiliza una `@prueba.test` que ya existe (entra con un enlace de recuperación que genera la
 * clave de servicio); si no hay, se salta. Las clientas, los productos y los pedidos de prueba son inertes (los pedidos son
 * inmutables a propósito). Los pedidos de partida se crean con las MISMAS funciones que usa el panel (`admin_create_manual_order`).
 *
 * Cubre lo que las pruebas de componentes (con la red simulada) no pueden: que cada pantalla carga con TODOS sus textos reales (una
 * clave sin registrar se vería como `admin.orders.…`), que cada acción llega a la base y que el flujo diario completo — de «pendiente
 * de pago» a «completado» — se hace solo con la bandeja y el detalle (criterio 1 del sprint).
 */

const SLOW = { timeout: 30_000 };
let admin: { token: string; refresh: string } | null = null;
let customer: { id: string; name: string; token: string } | null = null;

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async () => {
  admin = await adminSession();
  if (!admin) return;
  await clearRateLimits();
  const name = `Clienta ${randomTag()}`;
  const user = await registerAndLogin({ name });
  customer = { id: user.id, name, token: user.token };
});
test.beforeEach(async () => {
  test.skip(
    !admin || !customer,
    "No hay una cuenta de administración de prueba (@prueba.test) para entrar.",
  );
});

const A = (name: string, args: Record<string, unknown>) => rpc(name, args, admin!.token);

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

async function makeProduct(price: number, stock: number) {
  const tag = randomTag();
  const product = await svcRest("POST", "products", {
    code: `E${tag}`.toUpperCase(),
    slug: `e2e-ped-${tag}`,
    name: `Prenda ${tag}`,
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
    p_note: "E2E pedidos",
  });
  await svcRest("PATCH", `products?id=eq.${productId}`, { status: "active" });
  return { productId, variantId, tag, name: `Prenda ${tag}` };
}

/** Un pedido de partida, creado por la misma función que usa el panel (envío plano de 15 Bs). */
async function seedOrder(
  opts: { price?: number; stock?: number; qty?: number; payment?: string; paid?: boolean } = {},
) {
  const product = await makeProduct(opts.price ?? 100, opts.stock ?? 10);
  const created = await A("admin_create_manual_order", {
    p_profile_id: customer!.id,
    p_items: [{ variant_id: product.variantId, qty: opts.qty ?? 2 }],
    p_channel: "whatsapp",
    p_payment_method: opts.payment ?? "whatsapp",
    p_shipping_method: "delivery",
    p_address: {
      recipient: "Rosa",
      phone_e164: "+59172223333",
      line1: "Av. Arce 100",
      city: "La Paz",
      lat: -16.52,
      lng: -68.15,
    },
    p_idempotency_key: `e2e-${randomTag()}${randomTag()}`,
    p_shipping_cost: 15,
    p_slot_id: null,
    p_delivery_date: null,
    p_discount: 0,
    p_discount_reason: null,
    p_contact_name: null,
    p_contact_email: null,
    p_contact_phone: "+59171234567",
    p_note: null,
    p_mark_paid: opts.paid ?? false,
    p_dry_run: false,
  });
  expect(created.body.outcome, JSON.stringify(created.body)).toBe("created");
  return { product, id: created.body.order_id as string, number: created.body.number as string };
}
const status = async (id: string) =>
  (await svcRest("GET", `orders?id=eq.${id}&select=status`)).body[0].status as string;

async function expectNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, label).toBeLessThanOrEqual(0);
}

test("todas las pantallas cargan con sus textos reales, sin errores de consola, sin desborde y pasan axe AA", async ({
  page,
}, info) => {
  const order = await seedOrder();
  const errors = trackConsoleErrors(page);
  await signInAs(page, admin!);
  const screens: [string, string][] = [
    ["/admin/pedidos", "Pedidos"],
    ["/admin/pedidos/atencion", "Pedidos"],
    ["/admin/pedidos/incidencias", "Pedidos"],
    ["/admin/pedidos/lista-negra", "Pedidos"],
    [`/admin/pedidos/${order.id}`, order.number],
  ];
  for (const [path, heading] of screens) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible(
      SLOW,
    );
    await expect(page.locator("main")).not.toContainText("Cargando…", SLOW);
    expect(await rawKeys(page), path).toEqual([]);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map(
        (v) =>
          `${v.id}: ${v.nodes.map((n) => n.target.join(" ") + " => " + n.html.slice(0, 140)).join(" | ")}`,
      ),
      path,
    ).toEqual([]);
    await expectNoOverflow(page, `${path} (${info.project.name})`);
  }
  await page.goto("/admin/pedidos/nuevo");
  await expect(page.getByRole("heading", { name: "Nuevo pedido manual" })).toBeVisible(SLOW);
  expect(await rawKeys(page), "nuevo").toEqual([]);
  await expectNoOverflow(page, `nuevo (${info.project.name})`);
  expect(errors).toEqual([]);
});

test("criterio 1: de «pendiente de pago» a «completado» solo con la bandeja y el detalle (y todo queda en el historial)", async ({
  page,
}) => {
  const order = await seedOrder();
  await signInAs(page, admin!);
  await page.goto("/admin/pedidos");
  await page.getByRole("searchbox", { name: "Buscar" }).fill(order.number);
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  const table = page.getByRole("table", { name: "Pedidos" });
  await expect(table.getByRole("link", { name: order.number, exact: true })).toBeVisible(SLOW);

  // 1) confirmar el pago desde la bandeja, con confirmación
  await table.getByRole("button", { name: `Confirmar pago · ${order.number}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nota (opcional)").fill("Pago visto en el banco");
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await expect(dialog).toHaveCount(0, SLOW);
  await expect(table.getByText("Pagado")).toBeVisible(SLOW);
  expect(await status(order.id)).toBe("paid");

  // 2) el resto, desde el detalle
  await page.goto(`/admin/pedidos/${order.id}`);
  const steps: [string, string][] = [
    ["Pasar a preparación", "En preparación"],
    ["Marcar enviado", "Enviado"],
    ["Marcar entregado", "Entregado"],
    ["Completar pedido", "Completado"],
  ];
  for (const [button, badge] of steps) {
    await page.getByRole("button", { name: button, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0, SLOW);
    await expect(page.locator("header").getByText(badge, { exact: true })).toBeVisible(SLOW);
  }
  expect(await status(order.id)).toBe("completed");
  await expect(page.getByRole("button", { name: /Completar pedido|Pasar a|Marcar/ })).toHaveCount(
    0,
  );

  // el historial muestra cada paso con quién y el motivo
  const history = page.getByRole("region", { name: "Historial" });
  await expect(history.getByText("De «Pendiente de pago» a «Pagado»")).toBeVisible(SLOW);
  await expect(history.getByText("Motivo: Pago visto en el banco")).toBeVisible();
  await expect(history.getByText("De «Entregado» a «Completado»")).toBeVisible();
});

test("editar: calcula el impacto, confirma, recalcula total y stock, y queda en el libro de ediciones", async ({
  page,
}) => {
  const order = await seedOrder({ price: 100, stock: 10, qty: 2 });
  expect(await stockOf(order.product.variantId)).toBe(8);
  await signInAs(page, admin!);
  await page.goto(`/admin/pedidos/${order.id}`);
  await page.getByRole("button", { name: "Editar pedido" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(`Cantidad de ${order.product.name}`).fill("3");
  await dialog.getByRole("button", { name: "Calcular" }).click();
  await expect(dialog.getByText("Escribe el motivo (hasta 300 caracteres).")).toBeVisible();
  await dialog.getByLabel("Motivo del cambio").fill("La clienta pidió una más");
  await dialog.getByRole("button", { name: "Calcular" }).click();
  await expect(dialog.getByText("Total: Bs 215,00 → Bs 315,00")).toBeVisible(SLOW);
  await expect(dialog.getByText(`${order.product.name}: 2 → 3 unidades`)).toBeVisible();
  await expect(dialog.getByText("El cobro abierto pasa a cobrar Bs 315,00.")).toBeVisible();
  expect(await stockOf(order.product.variantId)).toBe(8); // la vista previa no escribe
  await dialog.getByRole("button", { name: "Confirmar cambios" }).click();
  await expect(dialog).toHaveCount(0, SLOW);
  await expect(page.getByText("Editado 1 vez/veces")).toBeVisible(SLOW);
  expect(await stockOf(order.product.variantId)).toBe(7);
  const row = (await svcRest("GET", `orders?id=eq.${order.id}&select=total,edit_count`)).body[0];
  expect(row).toMatchObject({ total: 315, edit_count: 1 });
  const edits = page.getByRole("region", { name: "Ediciones del pedido" });
  await expect(edits.getByText("Total: Bs 215,00 → Bs 315,00")).toBeVisible(SLOW);
  await expect(edits.getByText("Motivo: La clienta pidió una más")).toBeVisible();
});

test("cancelar y reembolsar: el asistente muestra el impacto, y el pedido queda reembolsado con el stock repuesto", async ({
  page,
}) => {
  const order = await seedOrder({ price: 100, stock: 10, qty: 2, paid: true });
  expect(await stockOf(order.product.variantId)).toBe(8);
  await signInAs(page, admin!);
  await page.goto(`/admin/pedidos/${order.id}`);
  await page.getByRole("button", { name: "Cancelar y reembolsar" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Motivo").fill("La clienta ya no lo quiere");
  await dialog.getByLabel(/Sí, ya lo devolví/).check();
  await dialog.getByRole("button", { name: "Calcular impacto" }).click();
  const impact = dialog.getByRole("region", { name: "Impacto" });
  await expect(impact.getByText(/Se devuelven Bs 215,00 de Bs 215,00 pagados/)).toBeVisible(SLOW);
  await expect(impact.getByText(`Vuelven al stock: ${order.product.name} × 2.`)).toBeVisible();
  await expect(impact.getByText("El pedido quedará «Reembolsado».")).toBeVisible();
  expect(await stockOf(order.product.variantId)).toBe(8);
  await dialog.getByRole("button", { name: "Cancelar y reembolsar" }).click();
  await expect(dialog).toHaveCount(0, SLOW);
  await expect(page.locator("header").getByText("Reembolsado", { exact: true })).toBeVisible(SLOW);
  expect(await stockOf(order.product.variantId)).toBe(10);
  const refunds = await svcRest("GET", `refunds?order_id=eq.${order.id}&select=amount,status,kind`);
  expect(refunds.body).toEqual([{ amount: 215, status: "processed", kind: "cancel" }]);
  // un pedido ya reembolsado no ofrece más reembolsos ni cancelaciones
  await expect(page.getByRole("button", { name: "Reembolsar", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancelar y reembolsar" })).toHaveCount(0);
});

test("pedido manual desde la pantalla: clienta, producto, dirección, cálculo y creación", async ({
  page,
}) => {
  const product = await makeProduct(80, 6);
  await signInAs(page, admin!);
  await page.goto("/admin/pedidos/nuevo");
  await page.getByLabel("Buscar clienta").fill(customer!.name);
  await page.getByRole("button", { name: "Elegir" }).first().click({ timeout: 30_000 });
  await page.getByLabel("Buscar producto").fill(product.tag);
  await page.getByRole("button", { name: "Agregar" }).first().click({ timeout: 30_000 });
  await page.getByLabel("Cantidad", { exact: true }).fill("2");
  await page.getByLabel("Recibe", { exact: true }).fill("Rosa");
  await page.getByLabel("Teléfono de quien recibe").fill("72223333");
  await page.getByLabel("Calle y número").fill("Av. Arce 100");
  await page.getByLabel("Teléfono de contacto", { exact: true }).fill("71234567"); // la clienta de prueba solo tiene correo
  await page.getByLabel("Costo de envío (opcional)").fill("15");
  await page.getByRole("button", { name: "Calcular" }).click();
  const summary = page.getByRole("region", { name: "Resumen" });
  await expect(summary.getByText("Bs 175,00", { exact: true })).toBeVisible(SLOW); // 2 × 80 + 15
  await page.getByRole("button", { name: "Crear pedido" }).click();
  await expect(page).toHaveURL(/\/admin\/pedidos\/[0-9a-f-]{36}$/, SLOW);
  await expect(page.getByRole("heading", { level: 2, name: /^MIC-\d{6,}$/ })).toBeVisible(SLOW);
  await expect(page.getByText("WhatsApp (manual)").first()).toBeVisible();
  expect(await stockOf(product.variantId)).toBe(4);
});

test("contra entrega rechazada en la entrega: se cancela, vuelve el stock, queda la incidencia y la cuenta en la lista negra", async ({
  page,
}) => {
  const order = await seedOrder({
    price: 60,
    stock: 5,
    qty: 1,
    payment: "cash_on_delivery",
    paid: true,
  });
  for (const to of ["preparing", "shipped"]) {
    const r = await A("admin_transition_order", {
      p_order_id: order.id,
      p_to: to,
      p_reason: null,
      p_expected_from: null,
    });
    expect(r.body.ok, JSON.stringify(r.body)).toBe(true);
  }
  expect(await stockOf(order.product.variantId)).toBe(4);
  await signInAs(page, admin!);
  await page.goto(`/admin/pedidos/${order.id}`);
  await page.getByRole("button", { name: "Rechazado en la entrega" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Costo asumido por la tienda").fill("15");
  await dialog.getByLabel("Añadir a la lista negra").check();
  await dialog.getByRole("button", { name: "Registrar rechazo" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Para bloquear hay que escribir el motivo");
  await dialog.getByLabel("Motivo del bloqueo").fill("Rechazó el paquete (prueba)");
  await dialog.getByRole("button", { name: "Registrar rechazo" }).click();
  await expect(dialog).toHaveCount(0, SLOW);
  await expect(page.locator("header").getByText("Cancelado", { exact: true })).toBeVisible(SLOW);
  expect(await stockOf(order.product.variantId)).toBe(5);
  const incident = await svcRest(
    "GET",
    `order_incidents?order_id=eq.${order.id}&select=type,cost_assumed,cost_borne_by`,
  );
  expect(incident.body).toEqual([{ type: "rejected", cost_assumed: 15, cost_borne_by: "store" }]);
  await page.goto("/admin/pedidos/lista-negra");
  await expect(
    page
      .getByRole("table", { name: "Lista negra" })
      .getByText("Rechazó el paquete (prueba)")
      .first(),
  ).toBeVisible(SLOW);
  // …se levanta uno desde la misma pantalla y los demás (cuenta y correo) por la función, para no dejar bloqueada a la clienta de prueba
  const active = () =>
    svcRest("GET", `blacklist_entries?source_order_id=eq.${order.id}&is_active=eq.true&select=id`);
  expect(((await active()).body as unknown[]).length).toBeGreaterThanOrEqual(1);
  await page
    .getByRole("button", { name: /Levantar el bloqueo de/ })
    .first()
    .click();
  const lift = page.getByRole("dialog");
  await lift.getByLabel("Por qué se levanta").fill("Fin de la prueba");
  await lift.getByRole("button", { name: "Levantar" }).click();
  await expect(lift).toHaveCount(0, SLOW);
  for (const row of (await active()).body as { id: string }[]) {
    await A("admin_blacklist_lift", { p_entry_id: row.id, p_reason: "Fin de la prueba" });
  }
  expect((await active()).body).toEqual([]);
});

test("bloqueo optimista: si otro administrador ya movió el pedido, la pantalla vieja se lo dice y no mueve nada", async ({
  page,
}) => {
  const order = await seedOrder();
  await signInAs(page, admin!);
  await page.goto(`/admin/pedidos/${order.id}`);
  await expect(page.getByRole("button", { name: "Confirmar pago" })).toBeVisible(SLOW);
  // «otro administrador» lo mueve mientras esta pantalla sigue mostrando «pendiente de pago»
  const other = await A("admin_transition_order", {
    p_order_id: order.id,
    p_to: "paid",
    p_reason: "otro admin",
    p_expected_from: "pending_payment",
  });
  expect(other.body.ok).toBe(true);
  await page.getByRole("button", { name: "Confirmar pago" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Otro administrador cambió este pedido",
    SLOW,
  );
  expect(await status(order.id)).toBe("paid"); // no pasó a «preparing» por error
  const history = await A("admin_order_history", { p_order_id: order.id });
  expect((history.body as { to_status: string }[]).map((h) => h.to_status)).toEqual([
    "pending_payment",
    "paid",
  ]);
});
