import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { clearRateLimits, rest, svcRest, svcRpc } from "../test-support/api";

/**
 * Estimador de envío de la bolsa (Sprint 8) en un navegador real contra la nube: un invitado agrega un producto, abre
 * /carrito, marca su ubicación escribiendo ciudad y coordenadas (el mapa es opcional) y ve el costo, el total con envío
 * y los errores de cobertura. Los importes salen del ORIGEN y la TARIFA DE EJEMPLO del seed (`supabase/seed.sql`,
 * bloque «Envíos (S8)»): origen (-16.5, -68.15), tramos 0–3 km → Bs 15, 3–6 → 20, 6–10 → 30 y factor de ruta 130 %.
 * Si el dueño ya cargó otras tarifas, esta prueba debe ajustarse a las suyas (se salta sola si no hay tarifa de ejemplo).
 *
 * Valores calculados a mano: un pin sobre el origen está a 0 km → tramo 1 → Bs 15,00. Un pin a 4,000 km en línea recta
 * (latitud -16.5 + 4 / 111,19508 = -16.464028) tiene ruta 4 × 1,3 = 5,2 km → tramo 2 → Bs 20,00. Cochabamba queda a
 * ≈ 233 km (99 km al sur y 211 km al este): fuera de todas las zonas del seed.
 */

test.beforeEach(async () => {
  await clearRateLimits();
});

const money = (n: number) => {
  const [int = "0", frac = "00"] = n.toFixed(2).split(".");
  return `Bs ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
};

const SLOW = { timeout: 30_000 };

async function hasExampleRate(): Promise<boolean> {
  const r = await svcRest(
    "GET",
    "shipping_rate_rules?name=eq.Por distancia (ejemplo)&archived_at=is.null&select=id",
  );
  return r.status === 200 && (r.body as unknown[]).length > 0;
}

/** Una variante activa con stock y su precio público (como en la prueba del carrito). */
async function pickVariant() {
  const response = await svcRest(
    "GET",
    "product_variants?select=id,stock_on_hand,product_colors(name),product_sizes(label)," +
      "products!inner(slug,name,status,archived_at)" +
      "&archived_at=is.null&stock_on_hand=gte.6&products.status=eq.active&products.archived_at=is.null&limit=40",
  );
  expect(response.status).toBe(200);
  for (const row of response.body as {
    id: string;
    stock_on_hand: number;
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
    const delta = 40 - row.stock_on_hand;
    if (delta > 0) {
      const topUp = await svcRpc("apply_stock_change", {
        p_variant_id: row.id,
        p_delta: delta,
        p_reason: "import",
        p_note: "E2E de envíos: reposición",
      });
      expect(topUp.status, JSON.stringify(topUp.body)).toBe(200);
    }
    return {
      slug: row.products.slug,
      name: row.products.name,
      color: row.product_colors?.name ?? null,
      size: row.product_sizes?.label ?? null,
      price: priceBob,
    };
  }
  throw new Error("Las semillas deben traer una variante activa con stock");
}

const colorSlug = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

async function bagWithOneProduct(page: Page) {
  const pick = await pickVariant();
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
  await page.getByRole("button", { name: "Agregar a la bolsa" }).click();
  const drawer = page.getByRole("dialog", { name: "Tu bolsa" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "Ver bolsa" }).click(SLOW);
  await expect(page).toHaveURL(/\/carrito$/);
  await expect(page.getByRole("heading", { level: 1, name: "Tu bolsa" })).toBeVisible(SLOW);
  return pick;
}

const estimator = (page: Page) => page.getByRole("region", { name: "Calcula tu envío" });
const summary = (page: Page) => page.getByRole("region", { name: "Resumen" });

/** Abre el cajón de ubicación, escribe ciudad y coordenadas y confirma. */
async function locate(page: Page, city: string, lat: string, lng: string) {
  const opener = estimator(page).getByRole("button", {
    name: /Elegir ubicación en el mapa|Cambiar ubicación|Usar otra ubicación/,
  });
  await opener.first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Ciudad" }).fill(city);
  await dialog.getByRole("textbox", { name: "Latitud" }).fill(lat);
  await dialog.getByRole("textbox", { name: "Longitud" }).fill(lng);
  await dialog.getByRole("button", { name: "Usar esta ubicación" }).click();
  await expect(dialog).toBeHidden();
}

/** Errores no controlados de la página: el visitante los vería como el aviso «Algo salió mal». */
function trackUncaught(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /Error no controlado/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

test.describe("estimador de envío en /carrito", () => {
  test.beforeEach(async () => {
    test.skip(
      !(await hasExampleRate()),
      "No hay tarifa de ejemplo cargada (supabase/seed.sql, envíos).",
    );
  });

  test("invitado: sin ubicación invita a elegirla; con ubicación muestra el costo y el total con envío", async ({
    page,
  }) => {
    const uncaught = trackUncaught(page);
    const pick = await bagWithOneProduct(page);
    await expect(estimator(page)).toContainText(
      "Elige dónde recibirás tu pedido para ver cuánto cuesta el envío.",
    );
    await expect(summary(page)).toContainText("Se calcula al elegir tu dirección");

    // Sobre el origen: 0 km → primer tramo (Bs 15,00)
    await locate(page, "La Paz", "-16.5", "-68.15");
    await expect(summary(page)).toContainText(money(15), SLOW);
    await expect(summary(page)).toContainText(money(pick.price + 15));
    await expect(summary(page)).toContainText("Total estimado");

    // Cambiar a un punto a 4 km en línea recta (ruta 5,2 km) → segundo tramo (Bs 20,00)
    await locate(page, "La Paz", "-16.464028", "-68.15");
    await expect(summary(page)).toContainText(money(20), SLOW);
    await expect(summary(page)).toContainText(money(pick.price + 20));
    await expect(summary(page)).not.toContainText(money(pick.price + 15));

    // Escribir coordenadas y confirmar enseguida cierra el cajón con el mapa todavía animando: antes lanzaba un error de
    // Leaflet (`_leaflet_pos`) y salía el aviso «Algo salió mal».
    await page.waitForTimeout(1000);
    expect(uncaught).toEqual([]);
    await expect(page.getByText("Algo salió mal")).toHaveCount(0);
  });

  test("fuera de cobertura: avisa con claridad y NO suma ningún costo al total", async ({
    page,
  }) => {
    const pick = await bagWithOneProduct(page);
    await locate(page, "Cochabamba", "-17.39", "-66.16");
    await expect(estimator(page)).toContainText("Todavía no entregamos en esa dirección.", SLOW);
    await expect(summary(page)).not.toContainText("Total estimado");
    await expect(summary(page)).toContainText(money(pick.price));
  });

  test("una coordenada mal escrita se señala y el foco va al aviso (no se pregunta nada al servidor)", async ({
    page,
  }) => {
    await bagWithOneProduct(page);
    const opener = estimator(page).getByRole("button", { name: "Elegir ubicación en el mapa" });
    await opener.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Ciudad" }).fill("La Paz");
    await dialog.getByRole("button", { name: "Usar esta ubicación" }).click();
    const alert = dialog.getByText(
      "Marca tu ubicación en el mapa o escribe la latitud y la longitud.",
    );
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
  });

  test("accesibilidad AA del estimador con el costo ya calculado", async ({ page }) => {
    await bagWithOneProduct(page);
    await locate(page, "La Paz", "-16.5", "-68.15");
    await expect(summary(page)).toContainText(money(15), SLOW);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
    ).toEqual([]);
  });

  test("sin desbordes a 360 px con el estimador abierto", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await bagWithOneProduct(page);
    await locate(page, "La Paz", "-16.5", "-68.15");
    await expect(summary(page)).toContainText(money(15), SLOW);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
