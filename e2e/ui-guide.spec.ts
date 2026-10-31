import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Sistema de UI (Sprint 4): accesibilidad, maquetación y comportamiento global de los componentes, sobre la guía
 * `/_ui` (el E2E construye con VITE_UI_GUIDE=true; el build de producción no la incluye).
 */

const BREAKPOINTS = [
  { name: "movil-360", width: 360, height: 780 },
  { name: "tableta-768", width: 768, height: 1024 },
  { name: "escritorio-1280", width: 1280, height: 900 },
] as const;

/** Las imágenes de la guía son rutas ficticias de Storage: se responden con una imagen generada. */
async function fakeStorageImages(page: Page) {
  await page.route("**/storage/v1/object/public/product-images/guia/**", (route) => {
    const label = route.request().url().split("/").pop() ?? "imagen";
    return route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><rect width="600" height="800" fill="#d9d2c7"/><text x="300" y="400" font-size="36" text-anchor="middle" fill="#382f21">${label}</text></svg>`,
    });
  });
}

async function openGuide(page: Page) {
  await fakeStorageImages(page);
  await page.goto("/_ui");
  await expect(page.getByRole("heading", { level: 1, name: "Guía de componentes" })).toBeVisible();
  // Las fuentes provisionales tienen que haber llegado antes de medir nada.
  await page.evaluate(() => document.fonts.ready);
}

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("guía de componentes (/_ui)", () => {
  test("sin violaciones de accesibilidad WCAG 2.1 A/AA", async ({ page }) => {
    await openGuide(page);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
    ).toEqual([]);
  });

  for (const bp of BREAKPOINTS) {
    test(`sin scroll horizontal y con captura a ${bp.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await openGuide(page);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      await page.screenshot({
        path: testInfo.outputPath(`guia-${bp.name}.png`),
        fullPage: true,
      });
    });
  }

  test("reflujo al 200 % y 400 % de zoom (640 y 320 px CSS) sin scroll horizontal", async ({
    page,
  }) => {
    for (const width of [640, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await openGuide(page);
      expect(await horizontalOverflow(page), `ancho ${width}`).toBeLessThanOrEqual(0);
    }
  });

  test("las fuentes propias se sirven desde el mismo origen y se aplican", async ({ page }) => {
    const fontResponses: { url: string; status: number }[] = [];
    page.on("response", (r) => {
      if (/\.woff2$/.test(r.url())) fontResponses.push({ url: r.url(), status: r.status() });
    });
    await openGuide(page);
    const origin = new URL(page.url()).origin;
    expect(fontResponses.length).toBeGreaterThanOrEqual(2);
    for (const f of fontResponses) {
      expect(f.url.startsWith(`${origin}/fonts/`), f.url).toBe(true);
      expect(f.status, f.url).toBe(200);
    }
    const loaded = await page.evaluate(() => ({
      jost: document.fonts.check('16px "Jost"'),
      baskervville: document.fonts.check('16px "Baskervville"'),
    }));
    expect(loaded).toEqual({ jost: true, baskervville: true });
  });

  test("si las fuentes fallan, el texto sigue visible con la fuente de respaldo y sin romper la maquetación", async ({
    page,
  }) => {
    await page.route("**/fonts/*.woff2", (route) => route.abort());
    await page.goto("/_ui");
    const title = page.getByRole("heading", { level: 1, name: "Guía de componentes" });
    await expect(title).toBeVisible();
    const family = await title.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toMatch(/serif/);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("cambiar un token cambia la interfaz (el botón principal toma el nuevo --primary)", async ({
    page,
  }) => {
    await openGuide(page);
    const button = page.getByRole("button", { name: "Principal", exact: true });
    const color = () => button.evaluate((el) => getComputedStyle(el).backgroundColor);
    const before = await color();
    await page.addStyleTag({ content: ":root { --primary: 200 80% 40%; }" });
    // El botón anima el color (transition-colors 120 ms): se espera a que el valor calculado llegue al final.
    // hsl(200 80% 40%) = rgb(20, 129, 184) (calculado a mano)
    await expect
      .poll(async () => {
        const channels = ((await color()).match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
        return [20, 129, 184].every((want, i) => Math.abs((channels[i] ?? -99) - want) <= 1);
      })
      .toBe(true);
    expect(before).not.toBe(await color());
  });

  test("«reducir movimiento» elimina las transiciones", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openGuide(page);
    const durations = await page
      .getByRole("button", { name: "Principal", exact: true })
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.transitionDuration, style.animationDuration];
      });
    for (const value of durations.flatMap((v) => v.split(",")).map((v) => v.trim())) {
      const seconds = value.endsWith("ms") ? parseFloat(value) / 1000 : parseFloat(value);
      expect(seconds).toBeLessThan(0.001);
    }
  });

  test("con movimiento normal el botón SÍ anima (el token --duration-fast se aplica)", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openGuide(page);
    const duration = await page
      .getByRole("button", { name: "Principal", exact: true })
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(duration)).toBeCloseTo(0.12, 2);
  });

  test("diálogo: se abre con teclado, atrapa el foco, Esc lo cierra y el foco vuelve al botón", async ({
    page,
  }) => {
    await openGuide(page);
    const opener = page.getByRole("button", { name: "Abrir diálogo" });
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "¿Vaciar la bolsa?" });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("cajón: abre, atrapa el foco y devuelve el foco al cerrar", async ({ page }) => {
    await openGuide(page);
    const opener = page.getByRole("button", { name: "Cajón derecho" });
    await opener.click();
    const sheet = page.getByRole("dialog", { name: "Cajón derecho" });
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("acordeón y pestañas funcionan con teclado", async ({ page }) => {
    await openGuide(page);
    const cambios = page.getByRole("button", { name: "Cambios y devoluciones" });
    await cambios.focus();
    await page.keyboard.press("Enter");
    await expect(cambios).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Tienes 7 días para cambiar tu compra.")).toBeVisible();

    const desc = page.getByRole("tab", { name: "Descripción" });
    await desc.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Materiales" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByText("100 % algodón pima peruano.")).toBeVisible();
  });

  test("paginación: avanzar cambia la página actual y el anuncio", async ({ page }) => {
    await openGuide(page);
    await page.getByRole("button", { name: "Página 5", exact: true }).click();
    await expect(page.getByRole("button", { name: "Página 5, página actual" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("paginación: al llegar a la última página con el teclado, «Siguiente» se desactiva SIN perder el foco", async ({
    page,
  }) => {
    await openGuide(page);
    const next = page.getByRole("button", { name: "Siguiente", exact: true }).first();
    await next.scrollIntoViewIfNeeded();
    await next.focus();
    for (let i = 0; i < 8; i++) await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Página 12, página actual" })).toBeVisible();
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await expect(next).toBeFocused();
  });

  test("carrusel: al llegar al final con el teclado el botón se desactiva SIN perder el foco", async ({
    page,
  }) => {
    await openGuide(page);
    const region = page.getByRole("region", { name: "Ejemplo de carrusel" });
    await region.scrollIntoViewIfNeeded();
    const next = region.getByRole("button", { name: "Siguiente" });
    await next.focus();
    for (let i = 0; i < 6 && (await next.getAttribute("aria-disabled")) !== "true"; i++) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(450); // animación de embla
    }
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await expect(next).toBeFocused();
  });

  test("carrusel: las flechas del teclado desplazan y el botón anterior se activa", async ({
    page,
  }) => {
    await openGuide(page);
    const region = page.getByRole("region", { name: "Ejemplo de carrusel" });
    await region.scrollIntoViewIfNeeded();
    const prev = region.getByRole("button", { name: "Anterior" });
    await expect(prev).toHaveAttribute("aria-disabled", "true");
    await region.getByRole("button", { name: "Siguiente" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(prev).toHaveAttribute("aria-disabled", "false");
  });

  test("galería: ampliar con teclado, cambiar con las flechas y volver el foco al botón", async ({
    page,
  }) => {
    await openGuide(page);
    await page.getByRole("region", { name: "Imágenes del producto" }).scrollIntoViewIfNeeded();
    const zoomButton = page.getByRole("button", { name: "Ampliar imagen" });
    await zoomButton.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Imagen ampliada" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Imagen 1 de 3")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByText("Imagen 2 de 3")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(dialog.getByText("Imagen 1 de 3")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(zoomButton).toBeFocused();
  });

  test("galería: las miniaturas cambian la imagen activa", async ({ page }) => {
    await openGuide(page);
    await page.getByRole("region", { name: "Imágenes del producto" }).scrollIntoViewIfNeeded();
    const second = page.getByRole("button", { name: "Ver imagen 2 de 3" });
    await second.click();
    await expect(second).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("button", { name: "Ver imagen 1 de 3" })).not.toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  test("talla agotada no se puede elegir; color y talla se mueven con las flechas", async ({
    page,
  }) => {
    await openGuide(page);
    await expect(page.getByRole("radio", { name: /agotada/ })).toBeDisabled();
    const white = page.getByRole("radio", { name: "Blanco" });
    await white.scrollIntoViewIfNeeded();
    await white.focus();
    // Radix selecciona la opción al llegar el foco solo si la flecha sigue pulsada; `press` la suelta al instante
    // (una persona tarda decenas de ms), por eso se mantiene pulsada un momento.
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(80);
    await page.keyboard.up("ArrowRight");
    await expect(page.getByRole("radio", { name: "Crema" })).toBeChecked();
  });

  test("cantidad: botones, escritura acotada al máximo y sin NaN", async ({ page }) => {
    await openGuide(page);
    const steppers = page.getByRole("group", { name: "Selector de cantidad" });
    const capped = steppers.nth(1); // tope de 3
    await capped.scrollIntoViewIfNeeded();
    const input = capped.getByRole("textbox", { name: "Cantidad" });
    await expect(input).toHaveValue("2");
    await capped.getByRole("button", { name: "Aumentar cantidad" }).click();
    await expect(input).toHaveValue("3");
    const plus = capped.getByRole("button", { name: "Aumentar cantidad" });
    await expect(plus).toHaveAttribute("aria-disabled", "true");
    // subir con el teclado hasta el tope no debe soltar el foco del botón «+»
    await capped.getByRole("button", { name: "Disminuir cantidad" }).click();
    await plus.focus();
    await page.keyboard.press("Enter");
    await expect(input).toHaveValue("3");
    await expect(plus).toBeFocused();
    await input.fill("999");
    await input.blur();
    await expect(input).toHaveValue("3");
    await input.fill("");
    await input.blur();
    await expect(input).toHaveValue("3");
  });

  test("tarjetas de producto: un solo enlace por tarjeta y el nombre largo no desborda", async ({
    page,
  }) => {
    await openGuide(page);
    const cards = page.locator("article");
    await expect(cards).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(cards.nth(i).getByRole("link")).toHaveCount(1);
    }
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("la guía no existe fuera de /_ui (rutas inventadas siguen dando 404 de la app)", async ({
    page,
  }) => {
    await page.goto("/_ui/otra-cosa");
    await expect(page.getByRole("heading", { name: "Página no encontrada" })).toBeVisible();
  });
});

test.describe("revisión independiente: defectos medidos en navegador real", () => {
  test("pantalla de 1920 px: el contenedor no pasa de 1400 px (var() no vale en media queries)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await openGuide(page);
    const widths = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".container"), (el) => el.getBoundingClientRect().width),
    );
    expect(widths.length).toBeGreaterThan(0);
    for (const width of widths) expect(width).toBeLessThanOrEqual(1400);
  });

  test("la tarjeta de producto muestra un anillo de foco visible (el enlace es de bloque)", async ({
    page,
  }) => {
    await openGuide(page);
    const link = page.locator("article").first().getByRole("link");
    await link.scrollIntoViewIfNeeded();
    await link.focus();
    const style = await link.evaluate((el) => {
      const css = getComputedStyle(el);
      return { display: css.display, shadow: css.boxShadow };
    });
    expect(style.display).toBe("block");
    expect(style.shadow).not.toBe("none");
  });

  test("las pestañas dibujan el anillo de foco dentro (no lo recorta el desplazamiento horizontal)", async ({
    page,
  }) => {
    await openGuide(page);
    const tab = page.getByRole("tab", { name: "Materiales" });
    await tab.scrollIntoViewIfNeeded();
    await tab.focus();
    expect(await tab.evaluate((el) => getComputedStyle(el).boxShadow)).toContain("inset");
  });

  test("una ruta de navegación con un nombre largo sin espacios no desborda", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await openGuide(page);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("el cajón del menú: la X sigue a la vista aunque el contenido se desplace", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 360 });
    await openGuide(page);
    await page.getByRole("button", { name: "Abrir menú" }).click();
    const dialog = page.getByRole("dialog", { name: "Menú" });
    await expect(dialog).toBeVisible();
    const close = dialog.getByRole("button", { name: "Cerrar" });
    await expect(close).toBeVisible();
    // desplaza el cuerpo del cajón hasta el final
    await dialog.evaluate((el) => {
      for (const node of Array.from(el.querySelectorAll("div"))) {
        if (node.scrollHeight > node.clientHeight) node.scrollTop = node.scrollHeight;
      }
    });
    const box = await close.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(360);
    await close.click();
    await expect(dialog).toBeHidden();
  });

  test("abrir un diálogo con un CLIC de ratón y cerrarlo con Esc devuelve el foco al botón (también en Safari)", async ({
    page,
  }) => {
    await openGuide(page);
    const opener = page.getByRole("button", { name: "Abrir diálogo" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "¿Vaciar la bolsa?" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("el pie no desborda con un correo larguísimo (360 px)", async ({ page }) => {
    await page.route("**/rest/v1/public_store_settings*", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            key: "contact_email",
            value: "contacto.tienda.online.atencion.al.cliente@madeinchola-bolivia-tienda.com",
          },
        ]),
      }),
    );
    await page.setViewportSize({ width: 360, height: 800 });
    await openGuide(page);
    await expect(page.getByRole("link", { name: /madeinchola-bolivia-tienda\.com/ })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("la región de avisos de sonner se anuncia en español", async ({ page }) => {
    await openGuide(page);
    await expect(page.locator("section[aria-label^='Notificaciones']")).toHaveCount(1);
  });
});

test.describe("rendimiento visual", () => {
  test("la portada no se desplaza al cambiar de fuente (CLS < 0.1)", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          value: number;
          hadRecentInput: boolean;
        }[]) {
          if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.1);
  });
});
