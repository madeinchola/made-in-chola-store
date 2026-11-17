import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  clearRateLimits,
  randomTag,
  registerAndLogin,
  rpc,
  svcRest,
  svcRpc,
} from "../test-support/api";
import { adminSession, signInAs } from "../test-support/shop";

/**
 * Resumen, reportes, carga masiva y documentos de despacho (Sprint 14) en un navegador real contra la nube.
 * NO crea cuentas de administración: reutiliza una `@prueba.test`. Lo que se importa se REVIERTE al terminar (la reversión archiva).
 * Cubre lo que las pruebas de componentes (con la red simulada) no pueden: textos reales sin claves sueltas, accesibilidad AA, que la
 * pantalla muestre LAS MISMAS cifras que la base, que la descarga sea un CSV de verdad, que la importación llegue a la base con sus
 * permisos y que el PDF salga con el número de hojas y el tamaño de papel correctos.
 */

const SLOW = { timeout: 30_000 };
let admin: { token: string; refresh: string } | null = null;
let customer: { id: string; token: string; refresh: string } | null = null;

test.describe.configure({ timeout: 240_000 });

test.beforeAll(async () => {
  admin = await adminSession();
  if (!admin) return;
  await clearRateLimits();
  const user = await registerAndLogin({ name: `Clienta ${randomTag()}` });
  customer = { id: user.id, token: user.token, refresh: user.refresh };
});
test.beforeEach(async () => {
  test.skip(
    !admin || !customer,
    "No hay una cuenta de administración de prueba (@prueba.test) para entrar.",
  );
});

const A = (name: string, args: Record<string, unknown>) => rpc(name, args, admin!.token);

const day = (offset: number) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/La_Paz" }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

/** Un importe como lo escribe la tienda: «Bs 1.234,50». */
const bs = (amount: number | string) => {
  const cents = Math.round(Number(amount) * 100);
  const [int, frac] = (Math.abs(cents) / 100).toFixed(2).split(".");
  return `${cents < 0 ? "-" : ""}Bs ${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
};

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

/** Un pedido a domicilio con dirección, creado por la misma función que usa el panel. Devuelve su id y número. */
async function seedDeliveryOrder(line1: string, name = "Rosa") {
  const tag = randomTag();
  const product = await svcRest("POST", "products", {
    code: `P${tag}`.toUpperCase(),
    slug: `e2e-print-${tag}`,
    name: `Prenda ${tag}`,
    cost_base: 10,
  });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  const productId = product.body[0].id as string;
  const color = await svcRest("POST", "product_colors", { product_id: productId, name: "Único" });
  const variant = await svcRest("POST", "product_variants", {
    product_id: productId,
    color_id: color.body[0].id,
    sku: `E2E-${tag}`.toUpperCase(),
  });
  await svcRest("POST", "product_prices", { product_id: productId, currency: "BOB", amount: 100 });
  await svcRpc("apply_stock_change", {
    p_variant_id: variant.body[0].id,
    p_delta: 10,
    p_reason: "import",
    p_note: "E2E reportes",
  });
  await svcRest("PATCH", `products?id=eq.${productId}`, { status: "active" });
  const created = await A("admin_create_manual_order", {
    p_profile_id: customer!.id,
    p_items: [{ variant_id: variant.body[0].id, qty: 2 }],
    p_channel: "whatsapp",
    p_payment_method: "whatsapp",
    p_shipping_method: "delivery",
    p_address: {
      recipient: name,
      phone_e164: "+59172223333",
      line1,
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
  const seeded = await seedDeliveryOrder("Av. Arce 100");
  const errors = trackConsoleErrors(page);
  await signInAs(page, admin!);
  const screens: [string, string][] = [
    ["/admin", "Panel de administración"],
    ["/admin/reportes", "Reportes"],
    ["/admin/reportes/productos", "Reportes"],
    ["/admin/reportes/inventario", "Reportes"],
    ["/admin/reportes/descuentos", "Reportes"],
    ["/admin/reportes/pagos", "Reportes"],
    ["/admin/reportes/devoluciones", "Reportes"],
    ["/admin/reportes/clientas", "Reportes"],
    ["/admin/importar", "Importar"],
    [`/admin/pedidos/imprimir?ids=${seeded.id}&doc=label`, "Documentos de despacho"],
    [`/admin/pedidos/imprimir?ids=${seeded.id}&doc=dispatch&formato=a4`, "Documentos de despacho"],
    [
      `/admin/pedidos/imprimir?ids=${seeded.id}&doc=packing&formato=letter`,
      "Documentos de despacho",
    ],
  ];
  for (const [path, heading] of screens) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible(
      SLOW,
    );
    await expect(page.locator("main")).not.toContainText(/Cargando/, SLOW);
    expect(await rawKeys(page), path).toEqual([]);
    await expectAccessible(page, path);
    await expectNoOverflow(page, `${path} (${info.project.name})`);
  }
  expect(errors).toEqual([]);
});

test("el resumen muestra LAS MISMAS cifras que la base y los períodos se calculan en hora de La Paz", async ({
  page,
}) => {
  const from = day(-29);
  const to = day(0);
  const api = await A("admin_sales_summary", { p_from: from, p_to: to, p_granularity: "day" });
  expect(api.status, JSON.stringify(api.body)).toBe(200);
  await signInAs(page, admin!);
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { level: 1, name: "Panel de administración" }),
  ).toBeVisible(SLOW);
  const bob = (api.body.currencies as { currency: string; current: Record<string, number> }[]).find(
    (c) => c.currency === "BOB",
  );
  if (!bob || bob.current.orders === 0) {
    await expect(page.getByText("Todavía no hay ventas en este período")).toBeVisible(SLOW);
  } else {
    const kpis = page.getByTestId("kpis");
    await expect(kpis).toBeVisible(SLOW);
    await expect(kpis.getByText(bs(bob.current.net!), { exact: true })).toBeVisible();
    await expect(kpis.getByText(bs(bob.current.gross!), { exact: true })).toBeVisible();
    await expect(kpis.getByText(String(bob.current.orders), { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByTestId("range-summary")).toContainText("30 días");
  // «Hoy» pide solo el día de hoy de La Paz
  await page.getByRole("button", { name: "Hoy" }).click();
  await expect(page.getByTestId("range-summary")).toContainText("comparado con", SLOW);
  await expect(page).toHaveURL(/p=today/);
  // un período a medida al revés se rechaza sin pedir nada
  await page.getByRole("button", { name: "Otro período" }).click();
  await page.getByLabel("Desde").fill(day(0));
  await page.getByLabel("Hasta").fill(day(-5));
  await page.getByRole("button", { name: "Ver", exact: true }).click();
  await expect(page.getByText("«Desde» no puede ser posterior a «Hasta».")).toBeVisible();
});

test("el reporte de ventas se pagina en el servidor y la descarga es un CSV completo de verdad", async ({
  page,
}) => {
  const from = day(-60);
  const to = day(0);
  const one = await A("admin_report_sales", {
    p_from: from,
    p_to: to,
    p_currency: "BOB",
    p_offset: 0,
    p_limit: 1,
  });
  expect(one.status, JSON.stringify(one.body)).toBe(200);
  const total = one.body.length > 0 ? Number(one.body[0].total_count) : 0;
  await signInAs(page, admin!);
  await page.goto(`/admin/reportes?p=custom&desde=${from}&hasta=${to}`);
  const table = page.getByRole("table", { name: "Ventas" });
  if (total === 0) {
    await expect(page.getByText("No hay nada que mostrar con este filtro.")).toBeVisible(SLOW);
    return;
  }
  await expect(table).toBeVisible(SLOW);
  expect((await table.getByRole("row").count()) - 1).toBe(Math.min(total, 50));
  await expect(page.getByText(`${total} resultados`)).toBeVisible();
  if (total > 50) {
    await page.getByRole("button", { name: "Siguiente" }).click();
    await expect(page.getByText(/Página 2 de/)).toBeVisible(SLOW);
  }
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^reporte-ventas-\d{4}-\d{2}-\d{2}\.csv$/);
  const content = await readFile((await download.path())!, "utf8");
  expect(content.charCodeAt(0)).toBe(0xfeff); // BOM: Excel respeta las tildes
  const lines = content.slice(1).split("\r\n");
  expect(lines.at(-1)).toBe(""); // todo registro termina en CRLF
  expect(lines[0]).toBe(
    "Pedido;Fecha de venta;Estado;Pago;Canal;Clienta;Unidades;Ventas brutas;Descuentos;Envío cobrado;Reembolsado;Ventas netas;Margen",
  );
  // el archivo trae TODAS las filas del filtro, no solo la página que se ve
  expect(lines.length - 2).toBeGreaterThanOrEqual(Math.min(total, 1));
  const fresh = await A("admin_report_sales", {
    p_from: from,
    p_to: to,
    p_currency: "BOB",
    p_offset: 0,
    p_limit: 1,
  });
  const totalNow = Number(fresh.body[0]?.total_count ?? 0);
  expect(lines.length - 2).toBeGreaterThanOrEqual(total);
  expect(lines.length - 2).toBeLessThanOrEqual(totalNow);
  await expect(page.getByText(/Archivo descargado: \d+ filas\./)).toBeVisible();
});

test("importar: plantilla, un archivo de Excel se rechaza, revisión sin guardar, confirmación y reversión", async ({
  page,
}) => {
  const tag = randomTag().toUpperCase();
  const sku = `E2E-IMP-${tag}`;
  const product = await svcRest("POST", "products", {
    code: `I${tag}`,
    slug: `e2e-imp-${tag.toLowerCase()}`,
    name: `Importable ${tag}`,
    cost_base: 10,
  });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  const color = await svcRest("POST", "product_colors", {
    product_id: product.body[0].id,
    name: "Único",
  });
  const variant = await svcRest("POST", "product_variants", {
    product_id: product.body[0].id,
    color_id: color.body[0].id,
    sku,
  });
  await svcRpc("apply_stock_change", {
    p_variant_id: variant.body[0].id,
    p_delta: 4,
    p_reason: "import",
    p_note: "E2E importación",
  });
  const stockOf = async () =>
    (await svcRest("GET", `product_variants?id=eq.${variant.body[0].id}&select=stock_on_hand`))
      .body[0].stock_on_hand as number;

  await signInAs(page, admin!);
  await page.goto("/admin/importar");
  await expect(page.getByRole("heading", { level: 1, name: "Importar" })).toBeVisible(SLOW);
  await page.getByRole("radio", { name: /Stock \(conteo\)/ }).check();

  // la plantilla: UTF-8 con BOM y separada por «;» (Excel en español)
  const tpl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar la plantilla" }).click();
  const template = await readFile((await (await tpl).path())!, "utf8");
  expect(template.charCodeAt(0)).toBe(0xfeff);
  expect(template.slice(1).split("\r\n")[0]).toBe("sku;stock");

  const input = page.getByLabel(/Archivo CSV/);
  // un archivo de Excel se rechaza con instrucciones, sin intentar leerlo
  await input.setInputFiles({
    name: "inventario.xlsx",
    mimeType: "application/vnd.ms-excel",
    buffer: Buffer.from("PK\u0003\u0004"),
  });
  await expect(page.getByRole("alert")).toContainText("archivo de Excel, no un CSV");

  // un CSV con una fila buena y una con un SKU que no existe
  await input.setInputFiles({
    name: "conteo.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`sku;stock\n${sku};9\nNO-EXISTE-${tag};1\n`, "utf8"),
  });
  await expect(page.getByText("2 filas leídas de «conteo.csv».")).toBeVisible(SLOW);
  await page.getByRole("button", { name: "Revisar el archivo" }).click();
  const counts = page.getByTestId("import-counts");
  await expect(counts).toBeVisible(SLOW);
  await expect(
    counts.getByText("Se actualizarían").locator("xpath=following-sibling::dd"),
  ).toHaveText("1");
  await expect(counts.getByText("Con error").locator("xpath=following-sibling::dd")).toHaveText(
    "1",
  );
  // la revisión NO movió ni una unidad
  expect(await stockOf()).toBe(4);
  await page.getByRole("button", { name: "Ver solo las filas con error" }).click();
  await expect(page.getByText("No hay ninguna variante con ese SKU.")).toBeVisible();

  // confirmar
  await page.getByRole("button", { name: "Importar 1 filas" }).click();
  await expect(
    page.getByText("Listo: 0 creadas, 1 actualizadas, 0 sin cambios y 1 con error."),
  ).toBeVisible(SLOW);
  expect(await stockOf()).toBe(9);

  // el historial muestra la carga y se revierte con confirmación
  const history = page.getByRole("table", { name: "Cargas anteriores" });
  const row = history.getByRole("row").filter({ hasText: "conteo.csv" }).first();
  await expect(row).toContainText("Terminada", SLOW);
  await row.getByRole("button", { name: /Revertir/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sí, revertir" }).click();
  await expect(page.getByText("Revertido: 1 de 1 cambios.")).toBeVisible(SLOW);
  expect(await stockOf()).toBe(4);
});

test("imprimir: las etiquetas, la guía y la lista de empaque salen en el papel y con el número de hojas correctos (PDF real)", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "El PDF se verifica una sola vez (escritorio).");
  const orders = [
    await seedDeliveryOrder("Av. Arce 101"),
    await seedDeliveryOrder("Av. Arce 102"),
    await seedDeliveryOrder("Av. Arce 103"),
  ];
  const ids = orders.map((o) => o.id).join(",");
  await signInAs(page, admin!);

  const pdf = async (doc: string, formato: string) => {
    await page.goto(`/admin/pedidos/imprimir?ids=${ids}&doc=${doc}&formato=${formato}`);
    await expect(page.getByTestId("print-area")).toBeVisible(SLOW);
    await page.emulateMedia({ media: "print" });
    const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    await page.emulateMedia({ media: "screen" });
    const text = bytes.toString("latin1");
    const pages = (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
    const box = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
    return { pages, width: Number(box?.[1]), height: Number(box?.[2]) };
  };
  const near = (value: number, expected: number) =>
    expect(Math.abs(value - expected), `${value} ≈ ${expected}`).toBeLessThan(2);

  const label = await pdf("label", "label"); // 10 × 15 cm = 283,5 × 425,2 pt, una etiqueta por hoja
  expect(label.pages).toBe(3);
  near(label.width, 283.46);
  near(label.height, 425.2);
  const labelA4 = await pdf("label", "a4");
  expect(labelA4.pages).toBe(3);
  near(labelA4.width, 595.28);
  near(labelA4.height, 841.89);
  const packing = await pdf("packing", "letter"); // carta = 612 × 792 pt, una lista por pedido
  expect(packing.pages).toBe(3);
  near(packing.width, 612);
  near(packing.height, 792);
  const dispatch = await pdf("dispatch", "a4"); // la guía va apaisada y en UNA hoja
  expect(dispatch.pages).toBe(1);
  near(dispatch.width, 841.89);
  near(dispatch.height, 595.28);

  // al imprimir solo queda la hoja: sin menú, sin controles
  await page.goto(`/admin/pedidos/imprimir?ids=${ids}&doc=label`);
  await expect(page.getByTestId("print-area")).toBeVisible(SLOW);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Imprimir" })).toBeHidden();
  await expect(page.getByTestId("print-area").locator("section").first()).toBeVisible();
  await page.emulateMedia({ media: "screen" });
});

test("una dirección larguísima y con símbolos cabe en UNA etiqueta de 10 × 15 cm (se achica, no se corta ni se va a otra hoja)", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "El PDF se verifica una sola vez (escritorio).");
  const long = `Av. Ñandú & «Los Tajibos» <3> ${"manzana 12 casa 4, ".repeat(9)}`.slice(0, 190);
  const order = await seedDeliveryOrder(long, "María José de los Ángeles Fernández-Quispe");
  await signInAs(page, admin!);
  await page.goto(`/admin/pedidos/imprimir?ids=${order.id}&doc=label&formato=label`);
  const sheet = page.getByTestId("print-area").locator("section").first();
  await expect(sheet).toBeVisible(SLOW);
  await expect(sheet).toContainText("Ñandú & «Los Tajibos» <3>"); // texto, no HTML
  await page.emulateMedia({ media: "print" });
  const bytes = await page.pdf({ preferCSSPageSize: true });
  expect((bytes.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length).toBe(1);
});

test("una clienta no entra a Reportes ni a Importar: vuelve a la tienda", async ({ page }) => {
  await signInAs(page, customer!);
  for (const path of ["/admin/reportes", "/admin/importar", "/admin/pedidos/imprimir"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/, SLOW);
    await expect(
      page.getByRole("heading", { level: 1, name: /Reportes|Importar|Documentos de despacho/ }),
    ).toHaveCount(0);
  }
});
