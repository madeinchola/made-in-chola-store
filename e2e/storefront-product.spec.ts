import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { rest, svcRest } from "../test-support/api";

/** Ficha de producto contra la base local con las semillas: variantes, estados, SEO, redirecciones y accesibilidad. */

interface Picked {
  slug: string;
  name: string;
  price: number;
  colors: { id: string; name: string }[];
  sizes: { id: string; label: string }[];
}

async function listVisible() {
  const response = await rest(
    "GET",
    "public_products?select=id,slug,name,price_bob,sold_out&limit=500",
  );
  expect(response.status).toBe(200);
  return response.body as {
    id: string;
    slug: string;
    name: string;
    price_bob: number;
    sold_out: boolean;
  }[];
}

async function describe(product: {
  id: string;
  slug: string;
  name: string;
  price_bob: number;
}): Promise<Picked> {
  const [colors, sizes] = await Promise.all([
    rest(
      "GET",
      `public_product_colors?product_id=eq.${product.id}&select=id,name&order=sort_order`,
    ),
    rest(
      "GET",
      `public_product_sizes?product_id=eq.${product.id}&select=id,label&order=sort_order`,
    ),
  ]);
  return {
    slug: product.slug,
    name: product.name,
    price: product.price_bob,
    colors: colors.body,
    sizes: sizes.body,
  };
}

async function pickWithColorsAndSizes(): Promise<Picked> {
  for (const p of (await listVisible()).filter((x) => !x.sold_out)) {
    const info = await describe(p);
    if (info.colors.length >= 2 && info.sizes.length >= 2) return info;
  }
  throw new Error("Las semillas deben tener un producto con 2+ colores y 2+ tallas");
}

const money = (n: number) => `Bs ${n.toFixed(2).replace(".", ",")}`;
const colorSlug = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
}

test.describe("ficha de producto", () => {
  test("muestra nombre, precio y la información del producto, y no pide iniciar sesión", async ({
    page,
  }) => {
    const product = await pickWithColorsAndSizes();
    await open(page, `/producto/${product.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
    await expect(page.getByText(money(product.price), { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Color" })).toBeVisible();
    await expect(
      page
        .getByRole("group", { name: /Talla/ })
        .or(page.getByRole("radiogroup", { name: "Talla" })),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/producto/${product.slug}`);
  });

  test("sin elegir talla el botón principal está bloqueado y lo explica; al elegirla es «Agregar a la bolsa» y la consulta por WhatsApp queda debajo como enlace con el producto", async ({
    page,
  }) => {
    const product = await pickWithColorsAndSizes();
    await open(page, `/producto/${product.slug}`);
    const blocked = page.getByRole("button", { name: "Elige una talla" });
    await expect(blocked).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText("Elige una talla para continuar.")).toBeVisible();
    await page.getByRole("radio", { name: product.sizes[0]!.label, exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Agregar a la bolsa" })).toBeVisible();
    const link = page.getByRole("link", { name: /Consultar por WhatsApp/ });
    await expect(link).toBeVisible();
    const href = (await link.getAttribute("href"))!;
    expect(href).toMatch(/^https:\/\/wa\.me\/\d{8,15}\?text=/);
    const text = decodeURIComponent(href.split("?text=")[1]!);
    expect(text).toContain(product.name);
    expect(text).toContain(`Talla: ${product.sizes[0]!.label}`);
    expect(text).toContain(money(product.price));
    expect(await link.getAttribute("rel")).toContain("noopener");
    expect(await link.getAttribute("target")).toBe("_blank");
  });

  test("elegir otro color cambia la etiqueta y la URL (enlace compartible) y recargar conserva el color", async ({
    page,
  }) => {
    const product = await pickWithColorsAndSizes();
    const second = product.colors[1]!;
    await open(page, `/producto/${product.slug}`);
    await page
      .getByRole("radio", { name: new RegExp(`^${second.name}`) })
      .first()
      .click();
    await expect(page.getByText(`Color: ${second.name}`, { exact: false }).first()).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`color=${colorSlug(second.name)}$`));
    await page.reload();
    await expect(page.getByText(`Color: ${second.name}`, { exact: false }).first()).toBeVisible();
  });

  test("un color inválido en la URL se ignora (no rompe la página)", async ({ page }) => {
    const product = await pickWithColorsAndSizes();
    await open(page, `/producto/${product.slug}?color=%27%3Bdrop%20table&utm_source=ig`);
    await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
  });

  test("un producto agotado se ve pero no se puede consultar ni comprar", async ({ page }) => {
    const soldOut = (await listVisible()).find((p) => p.sold_out);
    test.skip(!soldOut, "las semillas no traen un producto agotado visible");
    await open(page, `/producto/${soldOut!.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: soldOut!.name })).toBeVisible();
    await expect(page.getByRole("button", { name: "Agotado" }).first()).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(page.getByRole("link", { name: /Consultar por WhatsApp/ })).toHaveCount(0);
  });

  test("un borrador o archivado por URL directa da una 404 amable con enlace a la tienda y sin indexar", async ({
    page,
  }) => {
    const hidden = await svcRest(
      "GET",
      "products?select=slug&or=(status.eq.draft,archived_at.not.is.null)&limit=1",
    );
    const slug = hidden.body[0].slug as string;
    await open(page, `/producto/${slug}`);
    await expect(page.getByRole("heading", { name: "No encontramos este producto" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ver la tienda" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex,nofollow",
    );
  });

  test("un slug inexistente tampoco deja la pantalla en blanco", async ({ page }) => {
    await open(page, "/producto/esto-no-existe-jamas");
    await expect(page.getByRole("heading", { name: "No encontramos este producto" })).toBeVisible();
  });

  test("un slug con MAYÚSCULAS redirige al canónico en minúsculas", async ({ page }) => {
    const product = (await listVisible())[0]!;
    await open(page, `/producto/${product.slug.toUpperCase()}`);
    await expect(page).toHaveURL(new RegExp(`/producto/${product.slug}$`));
    await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
  });

  test("un producto renombrado conserva su enlace viejo: redirige al slug actual", async ({
    page,
  }) => {
    const product = (await listVisible()).find((p) => !p.sold_out)!;
    const oldSlug = product.slug;
    const newSlug = `${oldSlug}-renombrado`;
    expect(
      (await svcRest("PATCH", `products?id=eq.${product.id}`, { slug: newSlug })).status,
    ).toBeLessThan(300);
    try {
      await open(page, `/producto/${oldSlug}`);
      await expect(page).toHaveURL(new RegExp(`/producto/${newSlug}$`));
      await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
    } finally {
      await svcRest("PATCH", `products?id=eq.${product.id}`, { slug: oldSlug });
    }
  });

  test("SEO: título, canónico LIMPIO (sin utm/fbclid), Open Graph con imagen y JSON-LD Product con su precio", async ({
    page,
  }) => {
    const product = (await listVisible()).find((p) => !p.sold_out)!;
    await open(page, `/producto/${product.slug}?utm_source=instagram&fbclid=abc123`);
    await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
    await expect(page).toHaveTitle(new RegExp(`^${product.name} · Made In Chola$`));
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toMatch(new RegExp(`/producto/${product.slug}$`));
    expect(canonical).not.toMatch(/utm_|fbclid/);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "product");
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      `${product.name} · Made In Chola`,
    );
    const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();
    const ld = scripts.map((s) => JSON.parse(s));
    const productLd = ld.find((d) => d["@type"] === "Product");
    expect(productLd.name).toBe(product.name);
    expect(productLd.offers).toMatchObject({
      price: product.price_bob.toFixed(2),
      priceCurrency: "BOB",
    });
    expect(ld.find((d) => d["@type"] === "BreadcrumbList").itemListElement).toHaveLength(3);
  });

  test("la descripción es texto: no se insertan etiquetas HTML aunque el admin las escriba", async ({
    page,
  }) => {
    const product = (await listVisible()).find((p) => !p.sold_out)!;
    const original = await svcRest("GET", `products?id=eq.${product.id}&select=description`);
    const evil =
      'Línea 1\nLínea 2 <img src=x onerror="window.__xss=1"> <script>window.__xss=1</script>';
    await svcRest("PATCH", `products?id=eq.${product.id}`, { description: evil });
    try {
      await open(page, `/producto/${product.slug}`);
      await expect(page.getByText("Línea 1", { exact: false })).toBeVisible();
      expect(
        await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
      ).toBeUndefined();
      expect(await page.locator("main img[src='x']").count()).toBe(0);
      await expect(page.getByText("<script>", { exact: false })).toBeVisible(); // se muestra tal cual, como texto
    } finally {
      await svcRest("PATCH", `products?id=eq.${product.id}`, {
        description: original.body[0].description,
      });
    }
  });

  test("sin desbordes horizontales a 360 px y a 1366 px", async ({ page }) => {
    const product = await pickWithColorsAndSizes();
    for (const width of [360, 1366]) {
      await page.setViewportSize({ width, height: 800 });
      await open(page, `/producto/${product.slug}`);
      await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    }
  });

  test("los encabezados de la ficha no saltan de nivel (h1 → h2, nunca h1 → h3)", async ({
    page,
  }) => {
    const product = await pickWithColorsAndSizes();
    await open(page, `/producto/${product.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
    const levels = await page
      .getByRole("main")
      .getByRole("heading")
      .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
    expect(levels[0]).toBe(1);
    levels.forEach((level, i) => {
      if (i > 0) expect(level, `encabezado ${i}`).toBeLessThanOrEqual(levels[i - 1]! + 1);
    });
  });

  test("la ficha no salta al cargar (CLS < 0,1) con red lenta y CPU 4× más lenta, como en Lighthouse móvil", async ({
    page,
    context,
  }) => {
    const product = await pickWithColorsAndSizes();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          hadRecentInput: boolean;
          value: number;
        }[])
          if (!entry.hadRecentInput) w.__cls += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(`/producto/${product.slug}`, { waitUntil: "load" });
    await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.1);
  });

  test("accesibilidad WCAG 2.1 A/AA de la ficha", async ({ page }) => {
    const product = await pickWithColorsAndSizes();
    await open(page, `/producto/${product.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
    ).toEqual([]);
  });
});
