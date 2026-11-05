import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { clearRateLimits, registerAndLogin, rest, svcRest, svcRpc } from "../test-support/api";

/**
 * Bolsa (Sprint 7) en un navegador real contra la base local y la Edge Function `cart`: un invitado agrega desde la
 * ficha, ve el cajón, la página /carrito, cambia la cantidad, quita y deshace; «Pagar» sin sesión lleva a iniciar sesión
 * y vuelve con la bolsa fusionada; sin conexión se avisa y se recupera; sin desbordes a 360 px; accesibilidad AA.
 *
 * Los importes esperados se calculan a mano desde el precio de la semilla (`public_products.price_bob`): la pantalla
 * muestra lo que dice el servidor, y el servidor multiplica precio × cantidad.
 */

test.beforeEach(async () => {
  await clearRateLimits();
});

interface Pick {
  variantId: string;
  slug: string;
  name: string;
  color: string | null;
  size: string | null;
  price: number;
}

const colorSlug = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** «Bs 1.234,50» como lo escribe la tienda. */
const money = (n: number) => {
  const [int = "0", frac = "00"] = n.toFixed(2).split(".");
  return `Bs ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
};

/** Una variante activa con bastante stock (la semilla trae 10 por variante) y su precio público. */
async function pickVariant(): Promise<Pick> {
  const response = await svcRest(
    "GET",
    "product_variants?select=id,stock_on_hand,product_colors(name),product_sizes(label)," +
      "products!inner(slug,name,status,archived_at)" +
      "&archived_at=is.null&stock_on_hand=gte.6&products.status=eq.active&products.archived_at=is.null&limit=40",
  );
  expect(response.status).toBe(200);
  for (const row of response.body as {
    id: string;
    product_colors: { name: string } | null;
    product_sizes: { label: string } | null;
    products: { slug: string; name: string };
  }[]) {
    const price = await rest(
      "GET",
      `public_products?slug=eq.${row.products.slug}&select=price_bob&limit=1`,
    );
    const priceBob = (price.body as { price_bob: number }[])[0]?.price_bob;
    if (typeof priceBob !== "number") continue;
    // Las retenciones del carrito duran 10 minutos: lo que dejan las pruebas anteriores agotaría la variante de la semilla
    // (10 unidades). Se le repone stock para que cada prueba parta de una ficha con existencias, como un cliente real.
    const topUp = await svcRpc("apply_stock_change", {
      p_variant_id: row.id,
      p_delta: 30,
      p_reason: "import",
      p_note: "E2E del carrito: reposición",
    });
    expect(topUp.status, JSON.stringify(topUp.body)).toBe(200);
    return {
      variantId: row.id,
      slug: row.products.slug,
      name: row.products.name,
      color: row.product_colors?.name ?? null,
      size: row.product_sizes?.label ?? null,
      price: priceBob,
    };
  }
  throw new Error("Las semillas deben traer una variante activa con stock");
}

async function openProduct(page: Page, pick: Pick) {
  const color = pick.color ? `?color=${colorSlug(pick.color)}` : "";
  await page.goto(`/producto/${pick.slug}${color}`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole("heading", { level: 1, name: pick.name })).toBeVisible();
  if (pick.size) {
    await page
      .getByRole("radiogroup", { name: "Talla" })
      .getByRole("radio", { name: pick.size, exact: true })
      .click();
  }
}

const addButton = (page: Page) => page.getByRole("button", { name: "Agregar a la bolsa" });
const drawer = (page: Page) => page.getByRole("dialog", { name: "Tu bolsa" });
const bagLink = (page: Page) => page.getByRole("banner").getByRole("link", { name: /^Bolsa/ });
// Con el cajón abierto (diálogo modal) el resto de la página queda oculto a los lectores de pantalla, cabecera incluida, y
// Playwright da por vacío el nombre de lo oculto: el nombre que oirá la persona se comprueba en su `aria-label`.
const bagLinkLabel = (page: Page) => page.locator('header a[href="/carrito"]');
// La primera llamada a la función `cart` tras un rato sin usarla arranca un proceso nuevo (decenas de segundos en una
// máquina cargada): las esperas que dependen de ella no usan los 5 s por defecto.
const SLOW = { timeout: 30_000 };
const bagLines = (page: Page) =>
  page.getByRole("main").getByRole("list", { name: "Productos en tu bolsa" }).getByRole("listitem");

/** Agrega la variante desde la ficha y espera a ver el cajón con su contenido. */
async function addFromProduct(page: Page, pick: Pick) {
  await openProduct(page, pick);
  await addButton(page).click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).getByRole("link", { name: "Ver bolsa" })).toBeVisible(SLOW);
}

async function goToBag(page: Page) {
  await drawer(page).getByRole("link", { name: "Ver bolsa" }).click();
  await expect(page).toHaveURL(/\/carrito$/);
  await expect(page.getByRole("heading", { level: 1, name: "Tu bolsa" })).toBeVisible();
  await expect(bagLines(page)).toHaveCount(1);
}

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function axe(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
  ).toEqual([]);
}

test.describe("agregar desde la ficha", () => {
  test("«Agregar a la bolsa» es el botón principal y «Consultar por WhatsApp» queda debajo como enlace", async ({
    page,
  }) => {
    const pick = await pickVariant();
    await openProduct(page, pick);
    const add = addButton(page);
    await expect(add).toBeVisible();
    await expect(add).not.toHaveAttribute("aria-disabled", "true");
    const whatsapp = page.getByRole("link", { name: /Consultar por WhatsApp/ });
    if ((await whatsapp.count()) > 0) {
      const [addBox, linkBox] = [await add.boundingBox(), await whatsapp.boundingBox()];
      expect(linkBox!.y).toBeGreaterThan(addBox!.y);
    }
  });

  test("invitado: agrega → cajón → /carrito → cambia la cantidad → quita y deshace", async ({
    page,
  }) => {
    const pick = await pickVariant();
    await addFromProduct(page, pick);

    // ── cajón ──
    const dialog = drawer(page);
    await expect(dialog.getByRole("link", { name: pick.name })).toBeVisible();
    await expect(dialog.getByText(/Reservamos tus productos durante \d\d:\d\d/)).toBeVisible();
    await expect(dialog.getByText("Subtotal", { exact: true }).locator("..")).toContainText(
      money(pick.price),
    );
    await expect(dialog.getByRole("link", { name: "Pagar" })).toBeVisible();
    await expect(bagLinkLabel(page)).toHaveAttribute("aria-label", "Bolsa, 1 producto");

    // Esc cierra y el foco vuelve al botón que lo abrió
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(addButton(page)).toBeFocused();

    // ── página /carrito ──
    await bagLink(page).click();
    await expect(page).toHaveURL(/\/carrito$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1, name: "Tu bolsa" })).toBeVisible();
    const line = bagLines(page).first();
    await expect(line.getByRole("link", { name: pick.name })).toBeVisible();
    const qty = line.getByRole("textbox", { name: /^Cantidad de / });
    const total = line.locator("p", { hasText: "Total de la línea:" });
    await expect(qty).toHaveValue("1");
    await expect(total).toContainText(money(pick.price));
    await expect(line.getByRole("button", { name: /^Disminuir la cantidad de / })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    // sube a 2: lo ve al instante y el servidor confirma el total (precio × 2)
    await line.getByRole("button", { name: /^Aumentar la cantidad de / }).click();
    await expect(qty).toHaveValue("2");
    await expect(total).toContainText(money(pick.price * 2));
    const summary = page.getByRole("region", { name: "Resumen" });
    await expect(summary).toContainText("Subtotal (2 productos)");
    await expect(summary).toContainText("Se calcula en el siguiente paso");
    await expect(summary.getByText("Total", { exact: true }).locator("..")).toContainText(
      money(pick.price * 2),
    );

    // la bolsa sobrevive a recargar (el invitado conserva su token)
    await page.reload();
    await expect(bagLines(page)).toHaveCount(1);
    await expect(
      bagLines(page)
        .first()
        .getByRole("textbox", { name: /^Cantidad de / }),
    ).toHaveValue("2");

    // ── quitar y deshacer ──
    await bagLines(page)
      .first()
      .getByRole("button", { name: `Quitar ${pick.name} de la bolsa` })
      .click();
    await expect(page.getByText("Tu bolsa está vacía")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Tu bolsa" })).toBeFocused();
    const undo = page.getByRole("button", { name: "Deshacer" });
    await expect(undo).toBeVisible();
    await undo.click();
    await expect(bagLines(page)).toHaveCount(1);
    await expect(
      bagLines(page)
        .first()
        .getByRole("textbox", { name: /^Cantidad de / }),
    ).toHaveValue("2");
  });

  test("el aviso «Deshacer» desaparece solo a los ~8 segundos", async ({ page }) => {
    const pick = await pickVariant();
    await addFromProduct(page, pick);
    await goToBag(page);
    await bagLines(page)
      .first()
      .getByRole("button", { name: `Quitar ${pick.name} de la bolsa` })
      .click();
    const undo = page.getByRole("button", { name: "Deshacer" });
    await expect(undo).toBeVisible();
    await expect(undo).toBeHidden({ timeout: 14_000 });
    await expect(page.getByText("Tu bolsa está vacía")).toBeVisible();
  });

  test("dentro del cajón, «Quitar» ofrece «Deshacer» dentro del propio cajón", async ({ page }) => {
    const pick = await pickVariant();
    await addFromProduct(page, pick);
    const dialog = drawer(page);
    await dialog.getByRole("button", { name: `Quitar ${pick.name} de la bolsa` }).click();
    await expect(dialog.getByText("Tu bolsa está vacía")).toBeVisible();
    await dialog.getByRole("button", { name: "Deshacer" }).click();
    await expect(dialog.getByRole("link", { name: pick.name })).toBeVisible();
  });
});

test.describe("Pagar", () => {
  test("sin sesión lleva a iniciar sesión y, tras ingresar, vuelve a /carrito con la bolsa de invitado fusionada", async ({
    page,
  }) => {
    const pick = await pickVariant();
    const user = await registerAndLogin({ name: "Carla Quispe" });
    await addFromProduct(page, pick);
    await goToBag(page);

    const pay = page.getByRole("link", { name: "Pagar" });
    await expect(pay).toHaveAttribute("href", "/login");
    await expect(pay).not.toHaveAttribute("aria-disabled", "true");
    await pay.click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Email o teléfono").fill(user.identifier);
    await page.getByLabel("Contraseña", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Ingresar" }).click();

    // vuelve a la bolsa, con la bolsa de invitado ya juntada con la cuenta
    await expect(page).toHaveURL(/\/carrito$/);
    await expect(bagLines(page)).toHaveCount(1);
    await expect(bagLines(page).first().getByRole("link", { name: pick.name })).toBeVisible();
    await expect(page.getByText("Juntamos tu bolsa de invitado con tu cuenta")).toBeVisible();

    // con sesión «Pagar» lleva al pago (pantalla provisional hasta S10)
    const payNow = page.getByRole("link", { name: "Pagar" });
    await expect(payNow).toHaveAttribute("href", "/checkout");
    await payNow.click();
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Pago (próximamente)" }),
    ).toBeVisible();
  });

  test("sin conexión se avisa, «Pagar» queda bloqueado explicando por qué, y al volver la red se recupera", async ({
    page,
    context,
  }) => {
    const pick = await pickVariant();
    await addFromProduct(page, pick);
    await goToBag(page);
    const line = bagLines(page).first();
    // «Pagar» es un enlace mientras se puede pagar y un BOTÓN (sin href) mientras está bloqueado: se localiza por su texto.
    const pay = page.getByRole("main").getByText("Pagar", { exact: true });
    await expect(pay).not.toHaveAttribute("aria-disabled", "true");

    await context.setOffline(true);
    await line.getByRole("button", { name: /^Aumentar la cantidad de / }).click();
    await expect(
      page.getByText(
        "Sin conexión. Mantén esta pestaña abierta: enviaremos tus cambios cuando vuelva la conexión.",
      ),
    ).toBeVisible();
    // el cambio se ve igualmente y Pagar explica el bloqueo (sigue enfocable)
    await expect(line.getByRole("textbox", { name: /^Cantidad de / })).toHaveValue("2");
    await expect(pay).toHaveAttribute("aria-disabled", "true");
    await expect(pay).not.toHaveAttribute("href"); // bloqueado no hay enlace que abrir en otra pestaña
    await expect(pay).toHaveAccessibleDescription("Sin conexión: espera a que vuelva para pagar.");
    await pay.focus();
    await expect(pay).toBeFocused();

    // al volver la red el navegador avisa (`online`) y la bolsa se reintenta sola; si aún se ve, «Reintentar» hace lo mismo
    await context.setOffline(false);
    const retry = page.getByRole("button", { name: "Reintentar" });
    if (await retry.isVisible()) await retry.click();
    await expect(
      page.getByText(
        "Sin conexión. Mantén esta pestaña abierta: enviaremos tus cambios cuando vuelva la conexión.",
      ),
    ).toBeHidden(SLOW);
    await expect(line.locator("p", { hasText: "Total de la línea:" })).toContainText(
      money(pick.price * 2),
      SLOW,
    );
    await expect(pay).not.toHaveAttribute("aria-disabled", "true", SLOW);
  });
});

test.describe("diseño y accesibilidad", () => {
  test("sin desbordes horizontales a 360 px: bolsa vacía, bolsa con productos y cajón", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/carrito");
    await expect(page.getByText("Tu bolsa está vacía")).toBeVisible();
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);

    const pick = await pickVariant();
    await addFromProduct(page, pick);
    const dialog = drawer(page);
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    expect(
      await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
      "el cajón no desborda",
    ).toBeLessThanOrEqual(0);

    await goToBag(page);
    await expect(page.getByRole("region", { name: "Resumen" })).toBeVisible();
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    // los importes y el nombre largo se parten, no empujan la página
    await bagLines(page)
      .first()
      .getByRole("button", { name: /^Aumentar la cantidad de / })
      .click();
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("objetivos táctiles de al menos 44 px (móvil)", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "solo aplica al viewport móvil");
    const pick = await pickVariant();
    await addFromProduct(page, pick);
    const targets = [
      drawer(page).getByRole("button", { name: "Cerrar" }),
      drawer(page).getByRole("button", { name: /^Aumentar la cantidad de / }),
      drawer(page).getByRole("button", { name: /^Disminuir la cantidad de / }),
      drawer(page).getByRole("button", { name: `Quitar ${pick.name} de la bolsa` }),
      drawer(page).getByRole("link", { name: "Pagar" }),
      drawer(page).getByRole("link", { name: "Ver bolsa" }),
    ];
    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(43.5);
      expect(box!.width).toBeGreaterThanOrEqual(43.5);
    }
  });

  test("accesibilidad WCAG 2.1 A/AA: /carrito vacía", async ({ page }) => {
    await page.goto("/carrito");
    await expect(page.getByRole("heading", { level: 1, name: "Tu bolsa" })).toBeVisible();
    await expect(page.getByText("Tu bolsa está vacía")).toBeVisible();
    await axe(page);
  });

  test("accesibilidad WCAG 2.1 A/AA: /carrito con productos y con el cajón abierto", async ({
    page,
  }) => {
    const pick = await pickVariant();
    await addFromProduct(page, pick);
    await axe(page); // cajón abierto
    await goToBag(page);
    await page.waitForLoadState("networkidle");
    await axe(page);
  });

  test("los encabezados de /carrito no saltan de nivel y hay un único h1", async ({ page }) => {
    const pick = await pickVariant();
    await addFromProduct(page, pick);
    await goToBag(page);
    await page.waitForLoadState("networkidle");
    const levels = await page
      .getByRole("main")
      .getByRole("heading")
      .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    levels.forEach((level, i) => {
      if (i > 0) expect(level, `encabezado ${i}`).toBeLessThanOrEqual(levels[i - 1]! + 1);
    });
  });
});
