import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { dbSql, fn, svcRest } from "../test-support/api";
import { makeCustomer, makeProduct, signInAs, type Customer } from "../test-support/shop";

/**
 * Cookies y analítica (Sprint 15) en un navegador real contra la nube. Los scripts de Meta y de Google se SIMULAN (`page.route`): lo que
 * se comprueba es QUÉ pide la tienda y CUÁNDO — nada antes del permiso, solo la categoría aceptada, y al retirarlo todo se detiene y se
 * borran las cookies — no lo que hacen esos servicios.
 *
 * Pone IDs de prueba en los ajustes públicos de la tienda mientras corre y los RESTITUYE al terminar (en la nube no hay otra base).
 */

const SLOW = { timeout: 30_000 };
const PIXEL = "1234567890123";
const GA4 = "G-ABC123DEF4";
const KEYS = ["analytics_meta_pixel_id", "analytics_ga4_id"];
const original: Record<string, unknown> = {};

const FB_STUB = `
  (function () {
    var f = window.fbq;
    f.callMethod = function () { (window.__fbCalls = window.__fbCalls || []).push([].slice.call(arguments)); };
    (f.queue || []).forEach(function (args) { f.callMethod.apply(f, args); });
    f.queue = [];
  })();`;

async function setSettings(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values))
    await svcRest("PATCH", `store_settings?key=eq.${key}`, { value });
}

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  for (const key of KEYS) {
    const row = await svcRest("GET", `store_settings?key=eq.${key}&select=value`);
    original[key] = row.body[0]?.value ?? "";
  }
});
test.afterAll(async () => {
  for (const key of KEYS)
    await svcRest("PATCH", `store_settings?key=eq.${key}`, { value: original[key] ?? "" });
});

/** Simula los scripts de terceros y anota qué dominios de analítica se piden. */
async function spyOnThirdParties(page: Page) {
  const requested: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      /connect\.facebook\.net|googletagmanager\.com|google-analytics\.com|facebook\.com\/tr/.test(
        url,
      )
    )
      requested.push(url);
  });
  await page.route(/connect\.facebook\.net\/.*fbevents\.js/, (route) =>
    route.fulfill({ contentType: "application/javascript", body: FB_STUB }),
  );
  await page.route(/googletagmanager\.com\/gtag\/js/, (route) =>
    route.fulfill({ contentType: "application/javascript", body: "window.__gtagLoaded = true;" }),
  );
  return requested;
}

async function expectAccessible(page: Page, label: string) {
  // axe mide el color que hay EN ESE INSTANTE: con el diálogo desvaneciéndose o un botón cambiando de color por el puntero
  // (la transición dura 150 ms) da un contraste falso. Se espera a que terminen las animaciones finitas antes de medir.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    label,
  ).toEqual([]);
}

const fbCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fbCalls?: unknown[][] }).__fbCalls ?? []);
const dataLayerSize = (page: Page) =>
  page.evaluate(() => (window as unknown as { dataLayer?: unknown[] }).dataLayer?.length ?? 0);

test("sin IDs configurados la tienda NO muestra el aviso ni carga nada de terceros", async ({
  page,
}) => {
  await setSettings({ analytics_meta_pixel_id: "", analytics_ga4_id: "" });
  const requested = await spyOnThirdParties(page);
  await page.goto("/tienda");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible(SLOW);
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("cookie-banner")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Preferencias de cookies" })).toHaveCount(0);
  expect(requested).toEqual([]);
});

test("con IDs el aviso aparece SIN mover la página, no bloquea, es accesible y NADA de terceros se pide antes del permiso", async ({
  page,
}) => {
  await setSettings({ analytics_meta_pixel_id: PIXEL, analytics_ga4_id: GA4 });
  const requested = await spyOnThirdParties(page);
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
      }[])
        if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("/tienda");
  const banner = page.getByTestId("cookie-banner");
  await expect(banner).toBeVisible(SLOW);
  await expect(banner.getByRole("button", { name: "Aceptar todas" })).toBeVisible();
  await expect(banner.getByRole("button", { name: "Solo las necesarias" })).toBeVisible();
  // los dos pesan igual: mismo tamaño
  const [a, b] = await Promise.all([
    banner.getByRole("button", { name: "Aceptar todas" }).boundingBox(),
    banner.getByRole("button", { name: "Solo las necesarias" }).boundingBox(),
  ]);
  expect(Math.abs((a?.height ?? 0) - (b?.height ?? 1))).toBeLessThanOrEqual(2);
  await expectAccessible(page, "aviso de cookies");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  // no desplaza el contenido
  expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(
    0.1,
  );
  // no es un modal: la página de atrás sigue usable (se puede seguir un enlace con el aviso a la vista)
  await page
    .getByRole("link", { name: /Política de cookies/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/legal\/cookies$/);
  await page.waitForTimeout(1500);
  expect(requested, "antes del permiso no se pide nada de Meta ni de Google").toEqual([]);
  expect(await fbCalls(page)).toEqual([]);
});

test("«Solo las necesarias» NO carga nada y la elección se recuerda", async ({ page }) => {
  await setSettings({ analytics_meta_pixel_id: PIXEL, analytics_ga4_id: GA4 });
  const requested = await spyOnThirdParties(page);
  await page.goto("/tienda");
  await page.getByRole("button", { name: "Solo las necesarias" }).first().click();
  await expect(page.getByTestId("cookie-banner")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible(SLOW);
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("cookie-banner")).toHaveCount(0);
  expect(requested).toEqual([]);
  expect(await dataLayerSize(page)).toBe(0);
});

test("personalizar: solo marketing carga Meta y NO Google; cada evento va únicamente al proveedor aceptado", async ({
  page,
}) => {
  await setSettings({ analytics_meta_pixel_id: PIXEL, analytics_ga4_id: GA4 });
  const requested = await spyOnThirdParties(page);
  await page.goto("/tienda");
  await page.getByRole("button", { name: "Personalizar" }).click();
  const dialog = page.getByRole("dialog", { name: "Preferencias de cookies" });
  await expect(dialog.getByRole("checkbox", { name: "Necesarias" })).toBeDisabled();
  await expectAccessible(page, "preferencias de cookies");
  await dialog.getByRole("checkbox", { name: "Marketing" }).check();
  await dialog.getByRole("button", { name: "Guardar preferencias" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => requested.some((u) => /fbevents\.js/.test(u)), SLOW).toBe(true);
  expect(requested.some((u) => /googletagmanager/.test(u))).toBe(false);
  await expect
    .poll(
      async () => (await fbCalls(page)).some((c) => c[0] === "track" && c[1] === "PageView"),
      SLOW,
    )
    .toBe(true);
  const calls = await fbCalls(page);
  expect(calls[0]).toEqual(["init", PIXEL]);
  expect(await dataLayerSize(page)).toBe(0);
});

test("aceptar todas carga Meta y GA4; RETIRAR borra las cookies y detiene todo", async ({
  page,
}) => {
  await setSettings({ analytics_meta_pixel_id: PIXEL, analytics_ga4_id: GA4 });
  await page.addInitScript(() => window.localStorage.removeItem("mic_consent"));
  const requested = await spyOnThirdParties(page);
  await page.goto("/tienda");
  await page.getByRole("button", { name: "Aceptar todas" }).click();
  await expect
    .poll(
      () => requested.some((u) => /googletagmanager\.com\/gtag\/js\?id=G-ABC123DEF4/.test(u)),
      SLOW,
    )
    .toBe(true);
  await expect.poll(() => requested.some((u) => /fbevents\.js/.test(u)), SLOW).toBe(true);
  await expect.poll(() => dataLayerSize(page), SLOW).toBeGreaterThan(1);

  // las cookies que Meta y Google dejarían: se simulan para comprobar que el retiro las borra
  await page.evaluate(() => {
    document.cookie = "_fbp=fb.1.1.2; Path=/";
    document.cookie = "_ga=GA1.1.1.2; Path=/";
    document.cookie = "_ga_ABC123DEF4=GS1.1.1; Path=/";
    document.cookie = "_gid=GA1.1.3; Path=/";
  });
  const sizeBefore = await dataLayerSize(page);
  const fbBefore = (await fbCalls(page)).length;

  // retirar desde el pie
  await page.getByRole("button", { name: "Preferencias de cookies" }).click();
  const dialog = page.getByRole("dialog", { name: "Preferencias de cookies" });
  await expect(dialog.getByRole("checkbox", { name: "Analítica" })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Marketing" })).toBeChecked();
  await dialog.getByRole("button", { name: "Solo las necesarias" }).click();
  await expect(dialog).toHaveCount(0);

  await expect.poll(() => page.evaluate(() => document.cookie), SLOW).not.toMatch(/_fbp|_ga|_gid/);
  expect((await fbCalls(page)).at(-1)).toEqual(["consent", "revoke"]);
  expect(
    await page.evaluate(
      (id) => (window as unknown as Record<string, unknown>)[`ga-disable-${id}`],
      GA4,
    ),
  ).toBe(true);

  // desde ahora NO sale ningún evento nuevo, ni al navegar ni al ver otra página
  const fbAfterRevoke = (await fbCalls(page)).length;
  expect(fbAfterRevoke).toBeGreaterThanOrEqual(fbBefore);
  const sizeAfterRevoke = await dataLayerSize(page);
  expect(sizeAfterRevoke).toBeGreaterThanOrEqual(sizeBefore);
  await page.getByRole("link", { name: "Política de cookies" }).first().click();
  await expect(page).toHaveURL(/\/legal\/cookies$/);
  await page.waitForTimeout(1500);
  expect((await fbCalls(page)).length).toBe(fbAfterRevoke);
  expect(await dataLayerSize(page)).toBe(sizeAfterRevoke);
  expect(await page.evaluate(() => window.localStorage.getItem("mic_attribution"))).toBeNull();
});

test("la atribución: con permiso de analítica se guarda el origen de la visita (sin el identificador del clic) y retirar lo borra", async ({
  page,
}) => {
  await setSettings({ analytics_meta_pixel_id: PIXEL, analytics_ga4_id: GA4 });
  await page.addInitScript(() => window.localStorage.removeItem("mic_consent"));
  await spyOnThirdParties(page);
  await page.goto(
    "/tienda?utm_source=Facebook&utm_medium=cpc&utm_campaign=Lanzamiento&fbclid=IwAR-secreto-largo",
  );
  await page.getByRole("button", { name: "Aceptar todas" }).click();
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("mic_attribution")), SLOW)
    .not.toBeNull();
  const stored = JSON.parse(
    (await page.evaluate(() => window.localStorage.getItem("mic_attribution")))!,
  );
  expect(stored).toMatchObject({
    utm_source: "facebook",
    utm_medium: "cpc",
    utm_campaign: "lanzamiento",
    click_id_kind: "fbclid",
    landing_path: "/tienda",
  });
  expect(JSON.stringify(stored)).not.toContain("secreto");
  await page.getByRole("button", { name: "Preferencias de cookies" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Solo las necesarias" }).click();
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("mic_attribution")), SLOW)
    .toBeNull();
});

/** Una compra completa por WhatsApp con la elección de cookies dada; devuelve el número del pedido y cancela el pedido al final de quien llame. */
async function buyWith(
  page: Page,
  customer: Customer,
  choice: "Aceptar todas" | "Solo las necesarias",
  query: string,
) {
  const product = await makeProduct(60, 5);
  await fn(
    "cart",
    { action: "set_item", variant_id: product.variantId, qty: 1 },
    { token: customer.token },
  );
  await signInAs(page, customer);
  await page.addInitScript(() => {
    window.open = (() => null) as typeof window.open;
  });
  await page.goto(`/tienda${query}`);
  await page.getByRole("button", { name: choice }).click();
  // al pagar se navega por la aplicación (sin recargar): lo guardado y lo cargado sigue ahí
  await page
    .getByRole("link", { name: /bolsa|carrito/i })
    .first()
    .click()
    .catch(() => undefined);
  await page.goto("/checkout");
  await expect(page.getByRole("heading", { level: 1, name: "Finalizar compra" })).toBeVisible(SLOW);
  await expect(page.getByTestId("checkout-total")).not.toHaveText("—", SLOW);
  await page.getByLabel("Teléfono (WhatsApp)").fill("7123 4567");
  const send = page.getByRole("button", { name: "Enviar pedido por WhatsApp" });
  await expect(send).toBeEnabled(SLOW);
  await send.click();
  await expect(page).toHaveURL(/\/pedido\/MIC-\d{6,}$/, SLOW);
  return page.url().match(/MIC-\d{6,}/)![0];
}

test("una compra con permiso de analítica deja su origen junto al pedido y manda UN Purchase a Meta; sin permiso, nada de eso", async ({
  browser,
}) => {
  await setSettings({ analytics_meta_pixel_id: PIXEL, analytics_ga4_id: GA4 });
  const cancel: { token: string; id: string }[] = [];
  try {
    // 1) acepta todo y llega desde un anuncio
    const acceptedCustomer = await makeCustomer();
    const page1 = await (await browser.newContext()).newPage();
    await spyOnThirdParties(page1);
    const withConsent = await buyWith(
      page1,
      acceptedCustomer,
      "Aceptar todas",
      "?utm_source=Facebook&utm_medium=cpc&utm_campaign=Lanzamiento&fbclid=IwAR-secreto",
    );
    const orderId1 = dbSql(`select id from public.orders where number = '${withConsent}'`);
    cancel.push({ token: acceptedCustomer.token, id: orderId1 });
    expect(
      dbSql(
        `select concat_ws('|', utm_source, utm_medium, utm_campaign, click_id_kind) from public.order_attribution where order_id = '${orderId1}'`,
      ),
    ).toBe("facebook|cpc|lanzamiento|fbclid");
    expect(
      dbSql(
        `select (to_jsonb(a)::text like '%secreto%') from public.order_attribution a where order_id = '${orderId1}'`,
      ),
    ).toBe("f");
    const purchases = (await fbCalls(page1)).filter((c) => c[0] === "track" && c[1] === "Purchase");
    expect(purchases).toHaveLength(1);
    expect(purchases[0]![3]).toEqual({ eventID: `purchase.${withConsent}` });
    expect((purchases[0]![2] as { currency: string }).currency).toBe("BOB");
    // recargar la confirmación NO cuenta otra compra
    await page1.reload();
    await expect(
      page1.getByRole("heading", { level: 1, name: "¡Recibimos tu pedido!" }),
    ).toBeVisible(SLOW);
    expect(
      (await fbCalls(page1)).filter((c) => c[0] === "track" && c[1] === "Purchase").length,
    ).toBeLessThanOrEqual(1);

    // 2) solo lo necesario: ni origen ni Purchase
    const rejectedCustomer = await makeCustomer();
    const page2 = await (await browser.newContext()).newPage();
    const requested2 = await spyOnThirdParties(page2);
    const withoutConsent = await buyWith(
      page2,
      rejectedCustomer,
      "Solo las necesarias",
      "?utm_source=tiktok&utm_medium=cpc",
    );
    const orderId2 = dbSql(`select id from public.orders where number = '${withoutConsent}'`);
    cancel.push({ token: rejectedCustomer.token, id: orderId2 });
    expect(
      dbSql(`select count(*) from public.order_attribution where order_id = '${orderId2}'`),
    ).toBe("0");
    expect(await fbCalls(page2)).toEqual([]);
    expect(requested2).toEqual([]);
  } finally {
    for (const order of cancel)
      await fn("checkout", { action: "cancel", order_id: order.id }, { token: order.token });
  }
});
