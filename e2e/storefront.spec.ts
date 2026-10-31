import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { svcRest } from "../test-support/api";

/**
 * Portada, listados y búsqueda contra la base local con las semillas (supabase/seed.sql). Los números esperados
 * están calculados A MANO desde esa semilla: 27 productos visibles (el borrador, el archivado y la riñonera agotada
 * oculta no salen), 2 sin stock (Vestido Camisero, Cartera Cordón Verde), 12 en el árbol de Ropa (3+3+3+3),
 * 7 sombreros, 4 carteras visibles, 4 objetos; 8 productos entre Bs 400 y Bs 500; «Azul» en 2 productos.
 */

const TOTAL = 27;

/** Los códigos de la semilla son `AAA-000`; los productos que crean otros E2E (panel de administración) no. */
const SEED_CODE = /^[A-Z]{3}-\d{3}$/;
let parked: string[] = [];

// Otros E2E dejan productos activos en la base compartida: aquí se apartan (a borrador) mientras corre este archivo,
// para que los números calculados a mano desde la semilla sigan siendo exactos, y se devuelven al terminar.
test.beforeAll(async () => {
  const active = await svcRest(
    "GET",
    "products?select=id,code&status=eq.active&archived_at=is.null",
  );
  parked = (active.body as { id: string; code: string }[])
    .filter((product) => !SEED_CODE.test(product.code))
    .map((product) => product.id);
  if (parked.length > 0) {
    const hidden = await svcRest("PATCH", `products?id=in.(${parked.join(",")})`, {
      status: "draft",
    });
    expect(hidden.status).toBeLessThan(300);
  }
});

test.afterAll(async () => {
  if (parked.length > 0) {
    await svcRest("PATCH", `products?id=in.(${parked.join(",")})`, { status: "active" });
  }
});
const cards = (page: Page) => page.getByRole("main").locator("article");
const count = (page: Page) =>
  page
    .getByRole("main")
    .getByRole("status")
    .filter({ hasText: /producto/ })
    .first();

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

async function axe(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
  ).toEqual([]);
}

async function applyFilters(
  page: Page,
  fill: (panel: ReturnType<Page["getByRole"]>) => Promise<void>,
) {
  await page.getByRole("button", { name: /^Filtros/ }).click();
  const panel = page.getByRole("dialog", { name: "Filtros" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Cargando opciones…")).toHaveCount(0);
  await fill(panel);
  await panel.getByRole("button", { name: "Aplicar" }).click();
  await expect(panel).toBeHidden();
}

test.describe("portada", () => {
  test("un único h1 (el título del hero), filas de productos con enlaces reales y categorías", async ({
    page,
  }) => {
    await open(page, "/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1, name: "Verano 2027" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lo más popular" })).toBeVisible();
    // «Lo más popular» (4) + colección NADAS (2) + «Sombreros» (4) = 10 tarjetas, cada una UN enlace al producto.
    // Cada fila pide sus productos por separado: se espera a que lleguen las tres antes de contarlas.
    const cardLinks = page.getByRole("main").locator("article a[href^='/producto/']");
    await expect(cardLinks).toHaveCount(10);
    const links = await cardLinks.evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    for (const href of links) expect(href).toMatch(/^\/producto\/[a-z0-9-]+$/);
  });

  test("«Ver colección» del hero lleva a la colección y la tarjeta de categoría a su listado", async ({
    page,
  }) => {
    await open(page, "/");
    await page.getByRole("link", { name: "Ver colección" }).first().click();
    await expect(page).toHaveURL(/\/coleccion\/verano-2027$/);
    await expect(page.getByRole("heading", { level: 1, name: "Verano 2027" })).toBeVisible();
    await expect(count(page)).toHaveText("7 productos");
    await open(page, "/");
    await page.getByRole("main").getByRole("link", { name: "Carteras" }).first().click();
    await expect(page).toHaveURL(/\/categoria\/carteras$/);
    await expect(page.getByRole("heading", { level: 1, name: "Carteras" })).toBeVisible();
  });

  test("clic en una tarjeta abre la ficha de ese producto", async ({ page }) => {
    await open(page, "/");
    const first = page.getByRole("main").locator("article a[href^='/producto/']").first();
    const href = (await first.getAttribute("href"))!;
    await first.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("SEO de la portada: título, canónico, Organization y WebSite en JSON-LD", async ({
    page,
  }) => {
    await open(page, "/?utm_source=ig&fbclid=zzz");
    await expect(page.getByRole("heading", { level: 1, name: "Verano 2027" })).toBeVisible();
    await expect(page).toHaveTitle(/Made In Chola/);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).not.toMatch(/utm_|fbclid/);
    const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map(
      (s) => JSON.parse(s)["@type"],
    );
    expect(types).toEqual(expect.arrayContaining(["Organization", "WebSite"]));
  });

  test("sin desbordes y accesible (WCAG 2.1 A/AA)", async ({ page }) => {
    for (const width of [360, 1366]) {
      await page.setViewportSize({ width, height: 800 });
      await open(page, "/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await noOverflow(page);
    }
    await axe(page);
  });

  test("«Comprar ahora» del pie lleva a la tienda", async ({ page }) => {
    await open(page, "/");
    await page
      .getByRole("contentinfo")
      .getByRole("link", { name: /Comprar ahora/i })
      .click();
    await expect(page).toHaveURL(/\/tienda$/);
  });
});

test.describe("navegación y páginas sin contenido", () => {
  test("al abrir una ficha desde la portada la página vuelve arriba (no hereda el scroll)", async ({
    page,
  }) => {
    await open(page, "/");
    // Con la portada completa (las 10 tarjetas) la página ya es lo bastante alta para desplazarse.
    await expect(page.getByRole("main").locator("article a[href^='/producto/']")).toHaveCount(10);
    await page.evaluate(() => window.scrollTo(0, 1400));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    const first = page.getByRole("main").locator("article a[href^='/producto/']").first();
    await first.scrollIntoViewIfNeeded();
    await first.click();
    await expect(page).toHaveURL(/\/producto\//);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5);
  });

  test("elegir otro color en la ficha NO mueve el scroll (solo cambia la búsqueda de la URL)", async ({
    page,
  }) => {
    const withColors = await svcRest("GET", "public_products?select=id,slug&limit=200");
    let slug = "";
    for (const product of withColors.body as { id: string; slug: string }[]) {
      const colors = await svcRest(
        "GET",
        `public_product_colors?product_id=eq.${product.id}&select=id`,
      );
      if ((colors.body as unknown[]).length >= 2) {
        slug = product.slug;
        break;
      }
    }
    expect(slug).not.toBe("");
    await page.setViewportSize({ width: 390, height: 700 });
    await open(page, `/producto/${slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const radios = page.getByRole("radiogroup", { name: "Color" }).getByRole("radio");
    await radios.nth(1).scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    await radios.nth(1).click();
    await expect(page).toHaveURL(/color=/);
    const after = await page.evaluate(() => window.scrollY);
    expect(Math.abs(after - before)).toBeLessThan(40);
    expect(after).toBeGreaterThan(0);
  });

  test("la 404 y las pantallas provisionales no se indexan", async ({ page }) => {
    await open(page, "/ruta/que/no/existe");
    await expect(page.getByRole("heading", { name: "Página no encontrada" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex,nofollow",
    );
    await open(page, "/nosotros");
    await expect(page.getByText(/disponible pronto/i)).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,follow");
  });

  test("index.html estático: sin ejecutar JavaScript hay título, descripción y Open Graph de la marca", async ({
    request,
  }) => {
    const html = await (await request.get("/")).text();
    expect(html).toContain("<title>Made In Chola · Hecho a mano en Bolivia</title>");
    expect(html).toMatch(/property="og:title"\s+content="Made In Chola · Hecho a mano en Bolivia"/);
    expect(html).toMatch(/name="description"\s+content="Made In Chola: ropa, sombreros/);
  });
});

test.describe("tienda y listados", () => {
  test("muestra todos los productos paginados de 24 en 24, y «atrás» vuelve a la página anterior", async ({
    page,
  }) => {
    await open(page, "/tienda");
    await expect(page.getByRole("heading", { level: 1, name: "Tienda" })).toBeVisible();
    await expect(count(page)).toHaveText(`${TOTAL} productos`);
    await expect(cards(page)).toHaveCount(24);
    await page
      .getByRole("navigation", { name: "Paginación" })
      .getByRole("link", { name: "Página 2" })
      .click();
    await expect(page).toHaveURL(/pagina=2$/);
    await expect(cards(page)).toHaveCount(3); // 27 - 24
    await expect(page).toHaveTitle(/página 2/i);
    await page.goBack();
    await expect(page).not.toHaveURL(/pagina=/);
    await expect(cards(page)).toHaveCount(24);
  });

  test("una página más allá del final salta a la última real", async ({ page }) => {
    await open(page, "/tienda?pagina=99");
    await expect(cards(page)).toHaveCount(3);
    await expect(page).toHaveURL(/pagina=2$/);
  });

  test("orden por precio ascendente: los primeros son los más baratos de la semilla", async ({
    page,
  }) => {
    await open(page, "/tienda?orden=precio-asc");
    await expect(cards(page)).toHaveCount(24);
    const names = await cards(page).getByRole("heading").allTextContents();
    expect(names.slice(0, 5)).toEqual([
      "Llavero Tejido", // 45
      "Aros Plata Chola", // 95
      "Cinturón Cuero", // 160
      "Gorro Alpaca", // 180
      "Bufanda Alpaca", // 210
    ]);
  });

  test("cambiar el orden desde el selector actualiza la URL y la lista", async ({ page }) => {
    await open(page, "/tienda");
    await page.getByLabel("Ordenar por").selectOption({ label: "Precio: de mayor a menor" });
    await expect(page).toHaveURL(/orden=precio-desc$/);
    await expect(cards(page).getByRole("heading").first()).toHaveText("Campera Altiplano"); // 720, el más caro
  });

  test("filtrar por color: se refleja en la URL, en la ficha de filtro activo y sobrevive a recargar y al botón atrás", async ({
    page,
  }) => {
    await open(page, "/tienda");
    await applyFilters(page, async (panel) => {
      await panel.getByRole("checkbox", { name: /^Azul \(2\)/ }).check();
    });
    await expect(page).toHaveURL(/color=Azul$/);
    await expect(count(page)).toHaveText("2 productos");
    await expect(page.getByRole("button", { name: "Quitar filtro: Azul" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Filtros \(1\)/ })).toBeVisible();
    const names = (await cards(page).getByRole("heading").allTextContents()).sort();
    expect(names).toEqual(["Camisa Lino Cochabamba", "Sombrero Cowboy azul"]);
    await page.reload();
    await expect(count(page)).toHaveText("2 productos");
    await page.goBack();
    await expect(page).toHaveURL(/\/tienda$/);
    await expect(count(page)).toHaveText(`${TOTAL} productos`);
  });

  test("color + talla se combinan con Y: Azul y talla M es solo la camisa; quitar la ficha deja el otro filtro", async ({
    page,
  }) => {
    await open(page, "/tienda?color=Azul&talla=M");
    await expect(count(page)).toHaveText("1 producto");
    await expect(cards(page).getByRole("heading")).toHaveText(["Camisa Lino Cochabamba"]);
    await page.getByRole("button", { name: "Quitar filtro: Azul" }).click();
    await expect(page).toHaveURL(/talla=M$/);
    await expect(page).not.toHaveURL(/color=/);
  });

  test("varios colores se combinan con O (Azul o Rojo = 2 azules + el poncho)", async ({
    page,
  }) => {
    await open(page, "/tienda?color=Azul&color=Rojo");
    await expect(count(page)).toHaveText("3 productos");
  });

  test("rango de precio Bs 400 – 500 incluye ambos extremos: 8 productos", async ({ page }) => {
    await open(page, "/tienda");
    await applyFilters(page, async (panel) => {
      await panel.getByLabel("Mínimo (Bs)").fill("400");
      await panel.getByLabel("Máximo (Bs)").fill("500");
    });
    await expect(page).toHaveURL(/min=400/);
    await expect(page).toHaveURL(/max=500/);
    await expect(count(page)).toHaveText("8 productos");
  });

  test("un precio inválido se avisa y no se aplica", async ({ page }) => {
    await open(page, "/tienda");
    await page.getByRole("button", { name: /^Filtros/ }).click();
    const panel = page.getByRole("dialog", { name: "Filtros" });
    await panel.getByLabel("Mínimo (Bs)").fill("abc");
    await panel.getByRole("button", { name: "Aplicar" }).click();
    await expect(panel.getByText("Escribe un monto válido, con hasta 2 decimales.")).toBeVisible();
    await expect(page).not.toHaveURL(/min=/);
  });

  test("«Solo disponibles» oculta los 2 productos sin stock", async ({ page }) => {
    await open(page, "/tienda");
    await applyFilters(page, async (panel) => {
      const stock = panel.getByRole("switch", { name: "Solo disponibles" });
      await stock.click();
      await expect(stock).toHaveAttribute("aria-checked", "true");
    });
    await expect(page).toHaveURL(/disponibles=1$/);
    await expect(count(page)).toHaveText(`${TOTAL - 2} productos`);
  });

  test("sin coincidencias: mensaje claro y «Quitar filtros» deja la lista completa", async ({
    page,
  }) => {
    await open(page, "/tienda?color=Azul&max=100");
    await expect(page.getByText("Ningún producto coincide con tus filtros")).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    await page.getByRole("main").getByRole("button", { name: "Quitar filtros" }).click();
    await expect(count(page)).toHaveText(`${TOTAL} productos`);
    await expect(page).toHaveURL(/\/tienda$/);
  });

  test("valores raros en la URL no rompen la página (inyección, basura, repetidos)", async ({
    page,
  }) => {
    await open(
      page,
      "/tienda?color=%27%3B%20drop%20table&talla=%3Cscript%3E&min=-5&max=NaN&orden=__proto__&pagina=-3",
    );
    await expect(page.getByRole("heading", { level: 1, name: "Tienda" })).toBeVisible();
    await expect(page.getByText("No pudimos cargar los productos")).toHaveCount(0);
  });

  test("categoría: el árbol de Ropa incluye sus subcategorías (3 + 3 + 3 + 3 = 12) y se navega por las migas", async ({
    page,
  }) => {
    await open(page, "/categoria/ropa");
    await expect(page.getByRole("heading", { level: 1, name: "Ropa" })).toBeVisible();
    await expect(count(page)).toHaveText("12 productos");
    await open(page, "/categoria/camisas");
    await expect(count(page)).toHaveText("3 productos");
    await page
      .getByRole("main")
      .getByRole("navigation", { name: /migas|ruta/i })
      .getByRole("link", { name: "Ropa" })
      .click();
    await expect(page).toHaveURL(/\/categoria\/ropa$/);
  });

  test("colección vigente lista sus productos; la vencida da 404", async ({ page }) => {
    await open(page, "/coleccion/nadas");
    await expect(page.getByRole("heading", { level: 1, name: "NADAS" })).toBeVisible();
    await expect(count(page)).toHaveText("4 productos");
    await open(page, "/coleccion/edicion-limitada-2026");
    await expect(page.getByRole("heading", { name: "Página no encontrada" })).toBeVisible();
  });

  test("categoría inexistente: 404 amable sin indexar; slug en MAYÚSCULAS redirige conservando los parámetros", async ({
    page,
  }) => {
    await open(page, "/categoria/no-existe");
    await expect(page.getByRole("heading", { name: "Página no encontrada" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex,nofollow",
    );
    await open(page, "/categoria/SOMBREROS?orden=precio-asc");
    await expect(page).toHaveURL(/\/categoria\/sombreros\?orden=precio-asc$/);
    await expect(count(page)).toHaveText("7 productos");
  });

  test("SEO: filtros y orden no se indexan y apuntan al listado limpio; las páginas sí, con anterior/siguiente", async ({
    page,
  }) => {
    await open(page, "/tienda?orden=precio-asc&color=Azul&utm_source=ig");
    await expect(count(page)).toHaveText("2 productos");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,follow");
    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toMatch(/\/tienda$/);
    await open(page, "/tienda?pagina=2");
    await expect(cards(page)).toHaveCount(3);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index,follow");
    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toMatch(
      /\/tienda\?pagina=2$/,
    );
    expect(await page.locator('link[rel="prev"]').getAttribute("href")).toMatch(/\/tienda$/);
    await expect(page.locator('link[rel="next"]')).toHaveCount(0);
    const itemList = (await page.locator('script[type="application/ld+json"]').allTextContents())
      .map((s) => JSON.parse(s))
      .find((d) => d["@type"] === "ItemList");
    expect(itemList.itemListElement).toHaveLength(3);
  });

  test("sin desbordes a 360 px, con el panel de filtros abierto y accesible", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await open(page, "/tienda");
    await expect(cards(page)).toHaveCount(24);
    await noOverflow(page);
    await axe(page);
    await page.getByRole("button", { name: /^Filtros/ }).click();
    const panel = page.getByRole("dialog", { name: "Filtros" });
    await expect(panel.getByRole("checkbox", { name: /^Azul \(2\)/ })).toBeVisible();
    await axe(page);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(page.getByRole("button", { name: /^Filtros/ })).toBeFocused();
  });
});

test.describe("búsqueda", () => {
  test("desde la cabecera: abre el buscador, escribe y llega a los resultados", async ({
    page,
  }) => {
    await open(page, "/");
    await page.getByRole("banner").getByRole("button", { name: "Buscar" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("searchbox").fill("chakra");
    await sheet.getByRole("searchbox").press("Enter");
    await expect(page).toHaveURL(/\/buscar\?q=chakra$/);
    // El cajón se cierra al enviar (mientras está abierto, el resto de la página queda oculto para los lectores).
    await expect(sheet).toBeHidden();
    await expect(page.getByText("3 resultados para “chakra”")).toBeVisible();
    await expect(cards(page)).toHaveCount(3);
    expect((await cards(page).getByRole("heading").allTextContents()).sort()).toEqual([
      "Chakra amarillo",
      "Chakra naranja",
      "Chakra rosa",
    ]);
  });

  test("ignora acentos y mayúsculas: «PANTALON» encuentra los 2 pantalones por nombre", async ({
    page,
  }) => {
    await open(page, "/buscar?q=PANTALON");
    await expect(page.getByText("2 resultados para “PANTALON”")).toBeVisible();
    await expect(cards(page)).toHaveCount(2);
    expect((await cards(page).getByRole("heading").allTextContents()).sort()).toEqual([
      "Pantalón Palazzo",
      "Pantalón Pliegue",
    ]);
  });

  test("por código de producto", async ({ page }) => {
    await open(page, "/buscar?q=CHQ-001");
    await expect(page.getByText("1 resultado para “CHQ-001”")).toBeVisible();
    await expect(cards(page).getByRole("heading")).toHaveText(["Chaqueta Japandi"]);
  });

  test("tolera una errata de una letra en una palabra larga", async ({ page }) => {
    await open(page, "/buscar?q=Bufanda%20Alpaka");
    await expect(cards(page).getByRole("heading").first()).toHaveText("Bufanda Alpaca");
  });

  test("sin resultados: mensaje claro con la palabra buscada y enlaces para seguir explorando", async ({
    page,
  }) => {
    await open(page, "/buscar?q=zzzzzzzz");
    await expect(page.getByText("No encontramos resultados para “zzzzzzzz”")).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    await expect(
      page.getByRole("main").getByRole("link", { name: "Ver toda la tienda" }),
    ).toBeVisible();
  });

  test("con 1 letra avisa, no cambia la URL y no busca; con comillas y símbolos no rompe", async ({
    page,
  }) => {
    await open(page, "/buscar");
    await expect(page.getByText("¿Qué estás buscando?")).toBeVisible();
    await page.getByRole("main").getByRole("searchbox").fill("a");
    await page.getByRole("main").getByRole("button", { name: "Buscar" }).click();
    await expect(page.getByText("Escribe al menos 2 letras.")).toBeVisible();
    await expect(page).toHaveURL(/\/buscar$/);
    await open(page, "/buscar?q=%25%27%22%5C%3B--%20%3Cb%3E");
    await expect(page.getByText("No pudimos buscar ahora")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Buscar" })).toBeVisible();
  });

  test("no se indexa y su canónico es /buscar sin la consulta; «atrás» devuelve la búsqueda anterior", async ({
    page,
  }) => {
    await open(page, "/buscar?q=chakra");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,follow");
    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toMatch(/\/buscar$/);
    await page.getByRole("main").getByRole("searchbox").fill("bolso");
    await page.getByRole("main").getByRole("button", { name: "Buscar" }).click();
    await expect(page).toHaveURL(/q=bolso$/);
    await expect(cards(page).getByRole("heading")).toHaveText(["Bolso Tejido"]);
    await page.goBack();
    await expect(page).toHaveURL(/q=chakra$/);
    await expect(page.getByRole("main").getByRole("searchbox")).toHaveValue("chakra");
  });

  test("accesible (WCAG 2.1 A/AA) con resultados y sin ellos, en móvil y escritorio", async ({
    page,
  }) => {
    await open(page, "/buscar?q=chakra");
    await expect(cards(page)).toHaveCount(3);
    await axe(page);
    await open(page, "/buscar?q=zzzzzzzz");
    await expect(page.getByText("No encontramos resultados para “zzzzzzzz”")).toBeVisible();
    await axe(page);
    await open(page, "/buscar");
    await axe(page);
  });
});
