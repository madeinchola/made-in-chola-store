import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  clearRateLimits,
  randomTag,
  registerAndLogin,
  rest,
  rpc,
  svcRest,
  svcRpc,
} from "../test-support/api";
import { adminSession, signInAs } from "../test-support/shop";

/**
 * Notificaciones (Sprint 13) en un navegador real contra la nube: el panel de administración (registro, plantillas con vista previa,
 * envío y alertas) y la pantalla de preferencias de la clienta.
 *
 * NO crea cuentas de administración: reutiliza una `@prueba.test` que ya existe. Los pedidos y las clientas de prueba son inertes.
 * Cubre lo que las pruebas de componentes (con la red simulada) no pueden: que cada pantalla carga con TODOS sus textos reales (una
 * clave sin registrar se vería como `admin.notifications.…`), que la vista previa llega a la función `notify-admin` DESPLEGADA, y que
 * cada acción llega a la base con sus permisos reales.
 */

const SLOW = { timeout: 30_000 };
let admin: { token: string; refresh: string } | null = null;
let customer: { id: string; name: string; email: string; token: string; refresh: string } | null =
  null;

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async () => {
  admin = await adminSession();
  if (!admin) return;
  await clearRateLimits();
  const name = `Clienta ${randomTag()}`;
  const user = await registerAndLogin({ name });
  customer = { id: user.id, name, email: user.email!, token: user.token, refresh: user.refresh };
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
    .evaluate((el) => el.textContent?.match(/\b(?:admin|acct)\.[a-z]+\.[A-Za-z0-9_.]+/g) ?? []);

function trackConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function expectNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, label).toBeLessThanOrEqual(0);
}

async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map(
      (v) =>
        `${v.id}: ${v.nodes.map((n) => n.target.join(" ") + " => " + n.html.slice(0, 140)).join(" | ")}`,
    ),
    label,
  ).toEqual([]);
}

/** Un pedido de partida, creado por la misma función que usa el panel. */
async function seedOrder() {
  const tag = randomTag();
  const product = await svcRest("POST", "products", {
    code: `N${tag}`.toUpperCase(),
    slug: `e2e-not-${tag}`,
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
  await svcRest("POST", "product_prices", { product_id: productId, currency: "BOB", amount: 100 });
  await svcRpc("apply_stock_change", {
    p_variant_id: variant.body[0].id,
    p_delta: 10,
    p_reason: "import",
    p_note: "E2E notificaciones",
  });
  await svcRest("PATCH", `products?id=eq.${productId}`, { status: "active" });
  const created = await A("admin_create_manual_order", {
    p_profile_id: customer!.id,
    p_items: [{ variant_id: variant.body[0].id, qty: 1 }],
    p_channel: "whatsapp",
    p_payment_method: "whatsapp",
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
    p_mark_paid: false,
    p_dry_run: false,
  });
  expect(created.body.outcome, JSON.stringify(created.body)).toBe("created");
  return { id: created.body.order_id as string, number: created.body.number as string };
}

test("todas las pantallas cargan con sus textos reales, sin errores de consola, sin desborde y pasan axe AA", async ({
  page,
}, info) => {
  const errors = trackConsoleErrors(page);
  await signInAs(page, admin!);
  const screens: [string, string][] = [
    ["/admin/notificaciones", "Notificaciones"],
    ["/admin/notificaciones/plantillas", "Notificaciones"],
    ["/admin/notificaciones/envio", "Notificaciones"],
  ];
  for (const [path, heading] of screens) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible(
      SLOW,
    );
    await expect(page.locator("main")).not.toContainText("Cargando…", SLOW);
    expect(await rawKeys(page), path).toEqual([]);
    await expectAccessible(page, path);
    await expectNoOverflow(page, `${path} (${info.project.name})`);
  }
  expect(errors).toEqual([]);
});

test("la pantalla de preferencias de la clienta carga con sus textos reales y pasa axe AA", async ({
  page,
}, info) => {
  const errors = trackConsoleErrors(page);
  await signInAs(page, customer!);
  await page.goto("/cuenta/notificaciones");
  await expect(page.getByRole("heading", { name: "Notificaciones", level: 2 })).toBeVisible(SLOW);
  await expect(
    page.getByRole("radiogroup", { name: "¿Por dónde prefieres recibirlos?" }),
  ).toBeVisible(SLOW);
  expect(await rawKeys(page)).toEqual([]);
  await expectAccessible(page, "/cuenta/notificaciones");
  await expectNoOverflow(page, `preferencias (${info.project.name})`);
  expect(errors).toEqual([]);
});

test("un cambio de estado deja su aviso en el registro; el administrador lo ve, lo descarta y lo reenvía", async ({
  page,
}) => {
  const order = await seedOrder();
  const step = await A("admin_transition_order", {
    p_order_id: order.id,
    p_to: "paid",
    p_reason: null,
    p_expected_from: null,
  });
  expect(step.body.ok, JSON.stringify(step.body)).toBe(true);
  await signInAs(page, admin!);
  await page.goto("/admin/notificaciones");
  await page.getByRole("searchbox", { name: "Buscar" }).fill(order.number);
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  const table = page.getByRole("table", { name: "Registro de avisos" });
  // El pedido manual ya dejó «Pedido recibido»; aquí interesa el de «confirmado».
  const row = table
    .getByRole("row")
    .filter({ hasText: order.number })
    .filter({ hasText: "Pedido confirmado" });
  await expect(row).toHaveCount(1, SLOW);
  await expect(row).toContainText("En cola");
  await expect(row).toContainText("Correo");
  await expect(row).toContainText(customer!.email);

  await row.getByRole("button", { name: /Ver el aviso/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("link", { name: order.number })).toHaveAttribute(
    "href",
    `/admin/pedidos/${order.id}`,
  );
  await expect(dialog.getByText(customer!.email)).toBeVisible();
  await dialog.getByRole("button", { name: "Descartar" }).click();
  await expect(page.getByText("Aviso descartado.")).toBeVisible(SLOW);
  await expect(row).toContainText("Cancelado", SLOW);
  const stored = (
    await svcRest(
      "GET",
      `notification_outbox?order_id=eq.${order.id}&type=eq.order_confirmed&select=status,last_error`,
    )
  ).body[0];
  expect(stored).toMatchObject({ status: "cancelled", last_error: "cancelled_by_admin" });

  await row
    .filter({ hasText: "Cancelado" })
    .getByRole("button", { name: /Ver el aviso/ })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Reenviar" }).click();
  await expect(page.getByText("Se reenviará en menos de un minuto.")).toBeVisible(SLOW);
  const copies = (
    await svcRest(
      "GET",
      `notification_outbox?order_id=eq.${order.id}&type=eq.order_confirmed&select=status,resent_of&order=id.asc`,
    )
  ).body as { status: string; resent_of: number | null }[];
  expect(copies).toHaveLength(2);
  expect(copies[1]).toMatchObject({ status: "pending" });
  expect(copies[1]!.resent_of).not.toBeNull();
});

test("«empacado» espera su ventana y «deshacer» lo cancela: la clienta nunca recibe un aviso engañoso", async ({
  page,
}) => {
  const order = await seedOrder();
  for (const to of ["paid", "preparing"]) {
    const step = await A("admin_transition_order", {
      p_order_id: order.id,
      p_to: to,
      p_reason: null,
      p_expected_from: null,
    });
    expect(step.body.ok, JSON.stringify(step.body)).toBe(true);
  }
  expect(
    (await A("admin_undo_transition", { p_order_id: order.id, p_expected_status: null })).body
      .outcome,
  ).toBe("undone");
  await signInAs(page, admin!);
  await page.goto("/admin/notificaciones");
  await page.getByRole("searchbox", { name: "Buscar" }).fill(order.number);
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  // Se acota por el número del pedido: mientras llega la búsqueda, la tabla muestra por un instante las filas anteriores
  // (keepPreviousData), y una aserción sobre «todas las filas» leería datos de otros pedidos.
  const mine = page
    .getByRole("table", { name: "Registro de avisos" })
    .getByRole("row")
    .filter({ hasText: order.number });
  const packed = mine.filter({ hasText: "Pedido empacado" });
  await expect(packed).toHaveCount(1, SLOW);
  await expect(packed).toContainText("Cancelado", SLOW);
  await expect(packed).toContainText("el paso se deshizo", SLOW);
  await expect(mine.filter({ hasText: "Pedido confirmado" })).toContainText("En cola", SLOW);
});

test("el aviso de «no están saliendo los correos» explica por qué y lleva a lo que falta", async ({
  page,
}) => {
  const health = (await A("admin_notification_health", {})).body;
  test.skip(
    health.email_provider !== "none" && health.worker_configured === true,
    "El envío ya está configurado: no hay aviso que mostrar.",
  );
  await signInAs(page, admin!);
  await page.goto("/admin/notificaciones");
  const banner = page
    .getByRole("status")
    .filter({ hasText: "Ahora mismo no están saliendo todos los avisos" });
  await expect(banner).toBeVisible(SLOW);
  await banner.getByRole("link", { name: "Ver qué falta" }).click();
  await expect(page).toHaveURL(/\/admin\/notificaciones\/envio$/);
  await expect(page.getByRole("heading", { name: "Cómo está el envío" })).toBeVisible(SLOW);
  await expect(page.getByRole("heading", { name: /Para que los correos salgan/ })).toBeVisible();
  await expect(page.getByText(/RESEND_API_KEY/)).toBeVisible();
});

test("el editor de plantillas muestra la vista previa REAL, no deja guardar un error de tipeo y guarda lo correcto", async ({
  page,
}) => {
  await signInAs(page, admin!);
  await page.goto("/admin/notificaciones/plantillas");
  const original = (
    await rest(
      "GET",
      "notification_templates?key=eq.order_completed&channel=eq.whatsapp&select=*",
      admin!.token,
    )
  ).body[0] as { id: number; body: string };
  await page.getByRole("button", { name: "Editar «Pedido completado» (WhatsApp)" }).click();
  const dialog = page.getByRole("dialog");
  // Vista previa de WhatsApp: armada por la función desplegada, con los valores de ejemplo.
  await expect(dialog.getByText(/cerramos tu pedido MIC-000123/)).toBeVisible(SLOW);
  await expect(dialog.getByText(/de 1000 caracteres/)).toBeVisible();

  const body = dialog.getByLabel("Mensaje");
  await body.fill(`${original.body} {{customer_nmae}}`);
  await expect(
    dialog.getByText(/Estas variables no existen para este aviso: customer_nmae/),
  ).toBeVisible(SLOW);
  await dialog.getByRole("button", { name: "Guardar plantilla" }).click();
  await expect(dialog.getByText("Corrige los errores marcados antes de guardar.")).toBeVisible(
    SLOW,
  );
  const untouched = (
    await rest("GET", `notification_templates?id=eq.${original.id}&select=body`, admin!.token)
  ).body[0] as { body: string };
  expect(untouched.body, "con un error de tipeo NO se guardó nada").toBe(original.body);

  try {
    await body.fill(`${original.body} ¡Gracias!`);
    await expect(dialog.getByText(/¡Gracias!/).first()).toBeVisible(SLOW);
    await expect(dialog.getByText(/no existen/)).toHaveCount(0, SLOW);
    await dialog.getByRole("button", { name: "Guardar plantilla" }).click();
    await expect(page.getByText("Plantilla guardada.")).toBeVisible(SLOW);
    const saved = (
      await rest(
        "GET",
        `notification_templates?id=eq.${original.id}&select=body,is_default,updated_by`,
        admin!.token,
      )
    ).body[0] as { body: string; is_default: boolean; updated_by: string | null };
    expect(saved.body).toBe(`${original.body} ¡Gracias!`);
    expect(saved.is_default, "editarla la marca como revisada por la tienda").toBe(false);
    expect(saved.updated_by).toBeTruthy();
  } finally {
    await rest("PATCH", `notification_templates?id=eq.${original.id}`, admin!.token, {
      body: original.body,
    });
  }
});

test("la vista previa de un correo se muestra en un marco aislado y el envío de prueba explica lo que falta", async ({
  page,
}) => {
  await signInAs(page, admin!);
  await page.goto("/admin/notificaciones/plantillas");
  await page.getByRole("button", { name: "Editar «Pedido enviado» (Correo)" }).click();
  const dialog = page.getByRole("dialog");
  const frame = dialog.locator('iframe[title="Vista previa del correo"]');
  await expect(frame).toBeVisible(SLOW);
  await expect(frame).toHaveAttribute("sandbox", "");
  await expect(
    dialog
      .frameLocator('iframe[title="Vista previa del correo"]')
      // El párrafo (no el texto previo oculto que algunos clientes de correo muestran junto al asunto).
      .getByText("Hola Ana,", { exact: true }),
  ).toBeVisible(SLOW);
  await expect(dialog.getByText("Tu pedido MIC-000123 va en camino")).toBeVisible();
  const health = (await A("admin_notification_health", {})).body;
  if (health.email_provider === "none") {
    await dialog.getByRole("button", { name: "Enviarme una prueba" }).click();
    await expect(page.getByText(/Aún no hay un proveedor de correo configurado/)).toBeVisible(SLOW);
  }
  // Insertar una variable con un clic.
  await dialog.getByRole("button", { name: /Insertar la variable order_total/ }).click();
  await expect(dialog.getByLabel("Mensaje")).toHaveValue(/\{\{order_total\}\}/);
});

test("los ajustes del envío se validan en la pantalla y se guardan con control de versión", async ({
  page,
}) => {
  await signInAs(page, admin!);
  await page.goto("/admin/notificaciones/envio");
  const recipients = page.getByLabel("Correos que reciben las alertas internas");
  await expect(recipients).toBeVisible(SLOW);
  const before = (await svcRest("GET", "store_settings?key=eq.alert_recipients&select=value"))
    .body[0].value as string;
  try {
    await recipients.fill("bien@prueba.test, mal");
    await expect(page.getByText("«mal» no es un correo válido.")).toBeVisible();
    await page.getByRole("button", { name: "Guardar ajustes" }).click();
    await expect(page.getByText("Corrige los campos marcados antes de guardar.")).toBeVisible(SLOW);
    expect(
      (await svcRest("GET", "store_settings?key=eq.alert_recipients&select=value")).body[0].value,
      "no se guardó con un error",
    ).toBe(before);

    await recipients.fill("equipo@prueba.test, otra@prueba.test");
    await page.getByRole("button", { name: "Guardar ajustes" }).click();
    await expect(page.getByText("Ajustes guardados.")).toBeVisible(SLOW);
    expect(
      (await svcRest("GET", "store_settings?key=eq.alert_recipients&select=value")).body[0].value,
    ).toBe("equipo@prueba.test, otra@prueba.test");
    await page.getByRole("button", { name: "Guardar ajustes" }).click();
    await expect(page.getByText("No cambiaste nada.")).toBeVisible(SLOW);
  } finally {
    await svcRest("PATCH", "store_settings?key=eq.alert_recipients", { value: before });
  }
});

test("la clienta elige cómo recibir sus avisos y su consentimiento queda fechado; se conserva al recargar", async ({
  page,
}) => {
  await signInAs(page, customer!);
  await page.goto("/cuenta");
  await page.getByRole("link", { name: "Notificaciones", exact: true }).click();
  await expect(page).toHaveURL(/\/cuenta\/notificaciones$/);
  const channel = page.getByRole("radiogroup", { name: "¿Por dónde prefieres recibirlos?" });
  await expect(channel.getByRole("radio", { name: "Automático" })).toBeChecked(SLOW);
  await expect(channel.getByRole("radio", { name: "WhatsApp" })).toBeDisabled();
  await expect(
    page.getByText("Agrega un teléfono en tu perfil para elegir esta opción."),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Quiero recibir novedades por correo" }),
  ).not.toBeChecked();

  await channel.getByRole("radio", { name: "Correo" }).check();
  await page.getByRole("checkbox", { name: "Quiero recibir novedades por correo" }).check();
  await page.getByRole("button", { name: "Guardar preferencias" }).click();
  await expect(page.getByText("Preferencias guardadas.")).toBeVisible(SLOW);
  const stored = (
    await svcRest("GET", `notification_preferences?profile_id=eq.${customer!.id}&select=*`)
  ).body[0];
  expect(stored).toMatchObject({
    preferred_channel: "email",
    marketing_email: true,
    marketing_whatsapp: false,
  });
  expect(stored.marketing_consent_at).toBeTruthy();

  await page.reload();
  await expect(channel.getByRole("radio", { name: "Correo" })).toBeChecked(SLOW);
  await expect(
    page.getByRole("checkbox", { name: "Quiero recibir novedades por correo" }),
  ).toBeChecked();
  await expect(page.getByText(/Aceptaste el/)).toBeVisible();

  await page.getByRole("checkbox", { name: "Quiero recibir novedades por correo" }).uncheck();
  await page.getByRole("button", { name: "Guardar preferencias" }).click();
  await expect(page.getByText("Preferencias guardadas.")).toBeVisible(SLOW);
  const after = (
    await svcRest("GET", `notification_preferences?profile_id=eq.${customer!.id}&select=*`)
  ).body[0];
  expect(after).toMatchObject({ marketing_email: false, marketing_consent_at: null });
  await expect(page.getByText(/Aceptaste el/)).toHaveCount(0);
});

test("un cliente no entra al panel de notificaciones", async ({ page }) => {
  await signInAs(page, customer!);
  await page.goto("/admin/notificaciones");
  await expect(
    page.getByRole("heading", { level: 1, name: "Notificaciones", exact: true }),
  ).toHaveCount(0, SLOW);
});
