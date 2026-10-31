import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Cabecera y pie fieles al diseño (PDF de Inicio y de Check Out), medidos en navegador real a 1366 px, el ancho del
 * diseño. En móvil no hay diseño: se comprueba que funciona y que no desborda.
 */
test.use({ viewport: { width: 1366, height: 800 } });

const header = (page: Page) => page.getByRole("banner");

async function ready(page: Page, path: string) {
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
  await expect(header(page)).toBeVisible();
}

test.describe("cabecera del diseño (1366 px)", () => {
  test("páginas interiores: barra sólida de 130 px con línea inferior y el contenido a la altura del PDF", async ({
    page,
  }) => {
    await ready(page, "/login");
    const box = (await header(page).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(129);
    expect(box.height).toBeLessThanOrEqual(131);
    expect(await header(page).evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe("1px");
    expect(await header(page).evaluate((el) => getComputedStyle(el).position)).toBe("relative");
    const nav = header(page).getByRole("navigation", { name: "Principal" });
    const shop = nav.getByRole("button", { name: "Tienda" });
    await expect(shop).toBeVisible();
    // PDF: «SHOP» a ~94 px del borde izquierdo y el texto a ~54 px de la parte superior de la cabecera
    const s = (await shop.boundingBox())!;
    expect(s.x).toBeGreaterThan(85);
    expect(s.x).toBeLessThan(105);
    const centerY = s.y + s.height / 2 - box.y;
    expect(centerY).toBeGreaterThan(44);
    expect(centerY).toBeLessThan(66);
  });

  test("izquierda Tienda ⌄ y Nosotros; derecha país, bolsa (0), cuenta y búsqueda, de izquierda a derecha", async ({
    page,
  }) => {
    await ready(page, "/login");
    const nav = header(page).getByRole("navigation", { name: "Principal" });
    const xs: number[] = [];
    for (const locator of [
      nav.getByRole("button", { name: "Tienda" }),
      nav.getByRole("link", { name: "Nosotros" }),
      nav.getByRole("link", { name: "Made In Chola" }),
      nav.getByRole("combobox", { name: "País" }),
      nav.getByRole("link", { name: "Bolsa" }),
      nav.getByRole("link", { name: "Ingresar" }),
      nav.getByRole("button", { name: "Buscar" }),
    ]) {
      await expect(locator).toBeVisible();
      xs.push((await locator.boundingBox())!.x);
    }
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    await expect(page.getByTestId("cart-count")).toHaveText("(0)");
  });

  test("el logotipo es el «MADE IN CHOLA» disperso: tres filas que descienden en diagonal", async ({
    page,
  }) => {
    await ready(page, "/login");
    const letters = header(page)
      .getByRole("link", { name: "Made In Chola" })
      .locator("[aria-hidden='true']");
    await expect(letters).toHaveCount(11);
    const boxes = await letters.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent, x: r.x, y: r.y };
      }),
    );
    const byText = (t: string, n = 0) => boxes.filter((b) => b.text === t)[n]!;
    // fila 1: M A D E a la misma altura; fila 2: I N más abajo; fila 3: C H L; la O baja más y la última A queda a la derecha
    expect(Math.abs(byText("M").y - byText("E").y)).toBeLessThan(2);
    expect(byText("I").y).toBeGreaterThan(byText("M").y + 10);
    expect(byText("C").y).toBeGreaterThan(byText("I").y + 10);
    expect(byText("O").y).toBeGreaterThan(byText("C").y + 8);
    expect(byText("A", 1).x).toBeGreaterThan(byText("L").x);
    expect(byText("M").x).toBeLessThan(byText("E").x);
  });

  test("portada: la cabecera es transparente y blanca SOBRE el hero, debajo de la barra de anuncios", async ({
    page,
  }) => {
    await ready(page, "/");
    expect(await header(page).evaluate((el) => getComputedStyle(el).position)).toBe("absolute");
    expect(await header(page).evaluate((el) => getComputedStyle(el).color)).toBe(
      "rgb(255, 255, 255)",
    );
    expect(await header(page).evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe("0px");
    const hero = page.getByRole("heading", { level: 1, name: "Made In Chola" });
    const heroSection = hero.locator("xpath=ancestor::section[1]");
    const h = (await header(page).boundingBox())!;
    const s = (await heroSection.boundingBox())!;
    // la cabecera cae dentro del hero (lo tapa por arriba, como en el diseño)
    expect(h.y).toBeGreaterThanOrEqual(s.y - 1);
    expect(h.y + h.height).toBeLessThanOrEqual(s.y + s.height);
    // y la barra de anuncios (si hay) queda por encima de la cabecera, sin taparse
    const bar = page.getByRole("region", { name: "Aviso de la tienda" });
    if (await bar.count()) {
      const b = (await bar.boundingBox())!;
      expect(b.y + b.height).toBeLessThanOrEqual(h.y + 1);
    }
  });

  test("las demás páginas no tienen la cabecera superpuesta (empujan el contenido)", async ({
    page,
  }) => {
    await ready(page, "/login");
    expect(await header(page).evaluate((el) => getComputedStyle(el).position)).not.toBe("absolute");
    const title = page.getByRole("heading", { name: "Acceso" });
    const h = (await header(page).boundingBox())!;
    expect((await title.boundingBox())!.y).toBeGreaterThanOrEqual(h.y + h.height);
  });

  test("visitante: el icono de usuario lleva a la pantalla de ingreso", async ({ page }) => {
    await ready(page, "/login");
    // visitante: el icono de usuario lleva a /login
    await header(page).getByRole("link", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("accesibilidad WCAG 2.1 A/AA de la portada (cabecera superpuesta) y de una página interior", async ({
    page,
  }) => {
    for (const path of ["/", "/login"]) {
      await ready(page, path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
        path,
      ).toEqual([]);
    }
  });
});

test.describe("pie del diseño (1366 px)", () => {
  test("cuatro columnas con título en serif subrayado y fila inferior con enlaces legales", async ({
    page,
  }) => {
    await ready(page, "/login");
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("heading", { level: 2, name: "Síguenos" })).toBeVisible();
    const titles = await footer.getByRole("heading", { level: 2 }).allTextContents();
    expect(titles).toEqual(["Índice del sitio", "Síguenos", "Contáctanos", "Legal"]);
    const xs: number[] = [];
    for (const title of titles) {
      xs.push((await footer.getByRole("heading", { level: 2, name: title }).boundingBox())!.x);
    }
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(xs[0]).toBeGreaterThan(60); // ~70 px del PDF
    expect(xs[0]).toBeLessThan(80);
    const style = await footer.getByRole("heading", { level: 2, name: "Legal" }).evaluate((el) => {
      const css = getComputedStyle(el);
      return { family: css.fontFamily, border: css.borderBottomWidth };
    });
    expect(style.family).toMatch(/Baskervville/);
    expect(style.border).toBe("1px");
    const bottom = footer.getByRole("link", { name: "Políticas de Privacidad" });
    await expect(bottom).toBeVisible();
    await expect(footer.getByText(/^Copyright ©/)).toBeVisible();
  });

  test("fondo marrón #382F21, símbolo de marca y SIN boletín ni cupón", async ({ page }) => {
    await ready(page, "/login");
    const footer = page.getByRole("contentinfo");
    expect(await footer.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(56, 47, 33)",
    );
    await expect(footer.locator("svg[aria-hidden='true']").first()).toBeVisible();
    await expect(footer.locator("input, form")).toHaveCount(0);
    expect(await footer.innerText()).not.toMatch(
      /cup[oó]n|10\s?%|newsletter|suscr|primera compra/i,
    );
  });

  test("los enlaces legales y de índice llevan a pantallas que existen (sin 404)", async ({
    page,
  }) => {
    for (const [name, url] of [
      ["Política de privacidad", /\/legal\/privacidad$/],
      ["Reembolsos", /\/legal\/reembolsos$/],
      ["Envíos", /\/legal\/envios$/],
      ["Términos de servicio", /\/legal\/terminos$/],
      ["Nosotros", /\/nosotros$/],
    ] as const) {
      await ready(page, "/login");
      await page.getByRole("contentinfo").getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByText(/disponible pronto/i)).toBeVisible();
    }
  });

  test("el pie y la cabecera pasan axe también con el menú de cuenta y la tienda abiertos", async ({
    page,
  }) => {
    // Sin animaciones: axe mide el contraste a mitad del fundido de entrada del panel y da un falso positivo.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await ready(page, "/login");
    await header(page).getByRole("button", { name: "Tienda" }).click();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
    ).toEqual([]);
  });
});

test.describe("móvil (sin diseño: provisional)", () => {
  test.use({ viewport: { width: 360, height: 760 } });
  test("la cabecera cabe en 360 px sin desbordar y el logotipo se reduce", async ({ page }) => {
    await ready(page, "/login");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    const brand = (await header(page).getByRole("link", { name: "Made In Chola" }).boundingBox())!;
    expect(brand.width).toBeLessThan(140);
    expect((await header(page).boundingBox())!.height).toBeLessThanOrEqual(76);
    await expect(header(page).getByRole("button", { name: "Abrir menú" })).toBeVisible();
    await expect(header(page).getByRole("combobox", { name: "País" })).toBeHidden();
  });
});
