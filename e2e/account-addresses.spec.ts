import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { clearRateLimits, registerAndLogin, svcRest } from "../test-support/api";

/**
 * Libreta de direcciones y selector de ubicación (Sprint 6) en un navegador real contra la base local.
 * Las teselas de OpenStreetMap y Nominatim se SUSTITUYEN por respuestas locales: así las pruebas no dependen de internet
 * ni abusan de servicios gratuitos (el mapa y el buscador reales se ven en las capturas manuales y en la revisión).
 */

const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

type User = Awaited<ReturnType<typeof registerAndLogin>>;

test.beforeEach(async ({ page }) => {
  await clearRateLimits();
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
  );
  await page.route("https://*.tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
  );
});

async function signIn(page: Page, user: User) {
  await page.goto("/login");
  await page.getByLabel("Email o teléfono").fill(user.identifier);
  await page.getByLabel("Contraseña", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByTestId("account-menu")).toBeVisible();
}

async function openAddresses(page: Page) {
  await page.goto("/cuenta/direcciones");
  await expect(page.getByRole("heading", { level: 2, name: "Direcciones" })).toBeVisible();
}

interface Fill {
  label: string;
  line1?: string;
  city?: string;
  phone?: string;
  department?: string;
  recipient?: string;
  reference?: string;
  lat?: string;
  lng?: string;
}

async function fillForm(page: Page, f: Fill) {
  const form = page.getByRole("dialog");
  await form.getByLabel(/^Etiqueta/).fill(f.label);
  if (f.recipient) await form.getByLabel(/^Quién recibe/).fill(f.recipient);
  await form.getByLabel(/^Teléfono de contacto/).fill(f.phone ?? "7123 4567");
  await form.getByLabel(/^Departamento/).selectOption({ label: f.department ?? "La Paz" });
  await form.getByLabel(/^Ciudad/).fill(f.city ?? "La Paz");
  await form.getByLabel(/^Calle y número/).fill(f.line1 ?? "Calle Uno 123");
  if (f.reference) await form.getByLabel(/^Referencia/).fill(f.reference);
  if (f.lat !== undefined) await form.getByLabel("Latitud").fill(f.lat);
  if (f.lng !== undefined) await form.getByLabel("Longitud").fill(f.lng);
}

async function addAddress(page: Page, f: Fill) {
  await page.getByRole("button", { name: "Agregar dirección" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await fillForm(page, f);
  await page.getByRole("dialog").getByRole("button", { name: "Guardar dirección" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("heading", { level: 3, name: f.label, exact: true })).toBeVisible();
}

/** Tarjeta de una dirección ACTIVA (las archivadas viven en otra lista, plegada). */
const card = (page: Page, label: string) =>
  page
    .getByRole("list", { name: "Mis direcciones" })
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { level: 3, name: label, exact: true }) });

const stored = async (userId: string) =>
  (
    await svcRest(
      "GET",
      `addresses?profile_id=eq.${userId}&select=label,is_default,archived_at,lat,lng,recipient&order=created_at.asc`,
    )
  ).body as {
    label: string;
    is_default: boolean;
    archived_at: string | null;
    lat: number | null;
    lng: number | null;
    recipient: string;
  }[];

test.describe("direcciones", () => {
  test("estado vacío → crear la primera (queda predeterminada) → se guarda en la base con el teléfono en E.164", async ({
    page,
  }) => {
    const user = await registerAndLogin({ name: "Lucía Mamani" });
    await signIn(page, user);
    await openAddresses(page);
    await expect(page.getByText("Aún no tienes direcciones")).toBeVisible();

    await addAddress(page, { label: "Casa", reference: "Portón verde" });
    await expect(card(page, "Casa").getByText("Predeterminada", { exact: true })).toBeVisible();
    await expect(card(page, "Casa").getByText("Sin ubicación en el mapa")).toBeVisible();
    // El destinatario viene del nombre del perfil
    await expect(card(page, "Casa").getByText("Lucía Mamani", { exact: true })).toBeVisible();

    const rows = await stored(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      label: "Casa",
      is_default: true,
      archived_at: null,
      lat: null,
      lng: null,
    });
    const phone = (await svcRest("GET", `addresses?profile_id=eq.${user.id}&select=phone_e164`))
      .body as { phone_e164: string }[];
    expect(phone[0]!.phone_e164).toBe("+59171234567");
  });

  test("segunda dirección con pin escrito a mano; marcar predeterminada mueve la insignia; el pin queda guardado", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    await signIn(page, user);
    await openAddresses(page);
    await addAddress(page, { label: "Casa" });
    await addAddress(page, { label: "Oficina", lat: "-16,5", lng: "-68.15" });
    await expect(card(page, "Oficina").getByText("Con ubicación en el mapa")).toBeVisible();
    await expect(card(page, "Oficina").getByText("Predeterminada", { exact: true })).toHaveCount(0);

    await card(page, "Oficina")
      .getByRole("button", { name: "Marcar la dirección Oficina como predeterminada" })
      .click();
    await expect(card(page, "Oficina").getByText("Predeterminada", { exact: true })).toBeVisible();
    await expect(card(page, "Casa").getByText("Predeterminada", { exact: true })).toHaveCount(0);

    const rows = await stored(user.id);
    const oficina = rows.find((r) => r.label === "Oficina")!;
    expect(Number(oficina.lat)).toBe(-16.5); // la coma decimal se entendió
    expect(Number(oficina.lng)).toBe(-68.15);
    expect(rows.filter((r) => r.is_default)).toHaveLength(1);
    expect(oficina.is_default).toBe(true);
  });

  test("editar conserva lo demás; archivar la predeterminada pide confirmar, promueve a otra y «Archivadas» permite restaurar", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    await signIn(page, user);
    await openAddresses(page);
    await addAddress(page, { label: "Casa" });
    await addAddress(page, { label: "Oficina" });

    await card(page, "Oficina").getByRole("button", { name: "Editar dirección Oficina" }).click();
    const form = page.getByRole("dialog");
    await expect(form.getByLabel(/^Etiqueta/)).toHaveValue("Oficina");
    await form.getByLabel(/^Ciudad/).fill("El Alto");
    await form.getByRole("button", { name: "Guardar dirección" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(card(page, "Oficina").getByText(/El Alto/)).toBeVisible();

    // Archivar la predeterminada (Casa): confirmación → la otra pasa a ser la predeterminada
    await card(page, "Casa").getByRole("button", { name: "Archivar dirección Casa" }).click();
    const confirm = page.getByRole("dialog", { name: "¿Archivar esta dirección?" });
    await expect(confirm.getByText(/predeterminada/)).toBeVisible();
    await confirm.getByRole("button", { name: "Cancelar" }).click();
    await expect(card(page, "Casa")).toBeVisible(); // cancelar no archiva
    await card(page, "Casa").getByRole("button", { name: "Archivar dirección Casa" }).click();
    await page
      .getByRole("dialog", { name: "¿Archivar esta dirección?" })
      .getByRole("button", { name: "Archivar", exact: true })
      .click();
    await expect(card(page, "Casa")).toHaveCount(0);
    await expect(card(page, "Oficina").getByText("Predeterminada", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Archivadas \(1\)/ }).click();
    await expect(page.getByText("Casa", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Restaurar dirección Casa" }).click();
    await expect(card(page, "Casa")).toBeVisible();
    // restaurar con una predeterminada vigente no le quita la marca a la otra
    await expect(card(page, "Oficina").getByText("Predeterminada", { exact: true })).toBeVisible();
    await expect(card(page, "Casa").getByText("Predeterminada", { exact: true })).toHaveCount(0);

    const rows = await stored(user.id);
    expect(rows.every((r) => r.archived_at === null)).toBe(true); // nada se borró
    expect(rows.filter((r) => r.is_default).map((r) => r.label)).toEqual(["Oficina"]);
  });

  test("validación: campos obligatorios, pin a medias y fuera de rango; el foco va al primer error y nada se guarda", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    await signIn(page, user);
    await openAddresses(page);
    await page.getByRole("button", { name: "Agregar dirección" }).first().click();
    const form = page.getByRole("dialog");
    await form.getByLabel(/^Quién recibe/).fill(""); // viene del perfil: se vacía para probar el error
    await form.getByRole("button", { name: "Guardar dirección" }).click();
    await expect(form.getByText("Escribe quién recibe el pedido.")).toBeVisible();
    await expect(form.getByText("Escribe la ciudad.")).toBeVisible();
    await expect(form.getByText("Escribe la calle y el número.")).toBeVisible();
    await expect(form.getByLabel(/^Etiqueta/)).toBeFocused(); // el primer campo inválido

    await fillForm(page, { label: "X", recipient: "Ana", lat: "-16.5", lng: "" });
    await form.getByRole("button", { name: "Guardar dirección" }).click();
    await expect(form.getByText(/Escribe también la longitud/)).toBeVisible();
    await form.getByLabel("Longitud").fill("-68.15");
    await form.getByLabel("Latitud").fill("91");
    await form.getByRole("button", { name: "Guardar dirección" }).click();
    await expect(form.getByText("La latitud debe estar entre -90 y 90.")).toBeVisible();
    expect(await stored(user.id)).toHaveLength(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("texto raro (HTML, emoji, comillas) se muestra como TEXTO y se guarda tal cual", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    await signIn(page, user);
    await openAddresses(page);
    const label = 'Casa 🧵 <b>x</b> "q"';
    await addAddress(page, {
      label,
      reference: "<img src=x onerror=window.__xss=1> y <script>window.__xss=1</script>",
    });
    expect(
      await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
    ).toBeUndefined();
    await expect(page.getByRole("main").locator("img[src='x']")).toHaveCount(0);
    await expect(card(page, label).getByText(/<script>/)).toBeVisible();
    expect((await stored(user.id))[0]!.label).toBe(label);
  });

  test("tope de 20: con 20 activas «Agregar» se explica y archivar una libera el lugar", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    const seed = Array.from({ length: 20 }, (_, i) => ({
      profile_id: user.id,
      label: `Dir ${String(i + 1).padStart(2, "0")}`,
      recipient: "Ana",
      phone_e164: "+59171234567",
      line1: "Calle",
      city: "La Paz",
      department: "La Paz",
    }));
    expect((await svcRest("POST", "addresses", seed)).status).toBe(201);
    await signIn(page, user);
    await openAddresses(page);
    await expect(page.getByText("20 de 20 direcciones activas")).toBeVisible();
    await expect(page.getByText(/Alcanzaste el máximo de 20 direcciones activas/)).toBeVisible();
    const add = page.getByRole("button", { name: "Agregar dirección" }).first();
    await expect(add).toHaveAttribute("aria-disabled", "true");
    await add.click({ force: true }); // un clic real sobre un botón con aria-disabled: se ignora y no abre nada
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await card(page, "Dir 20").getByRole("button", { name: "Archivar dirección Dir 20" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archivar", exact: true }).click();
    await expect(page.getByText("19 de 20 direcciones activas")).toBeVisible();
    await expect(add).not.toHaveAttribute("aria-disabled", "true");
  });

  test("cada cliente ve SOLO lo suyo (IDOR): otra clienta no ve las direcciones de la primera", async ({
    page,
    browser,
  }) => {
    const ana = await registerAndLogin({ name: "Ana Dueña" });
    const beto = await registerAndLogin({ name: "Beto Otro" });
    await signIn(page, ana);
    await openAddresses(page);
    await addAddress(page, { label: "Solo de Ana" });

    const other = await browser.newContext();
    const page2 = await other.newPage();
    await signIn(page2, beto);
    await openAddresses(page2);
    await expect(page2.getByText("Aún no tienes direcciones")).toBeVisible();
    await expect(page2.getByText("Solo de Ana")).toHaveCount(0);
    await other.close();
  });

  test("sin sesión, /cuenta/direcciones manda a iniciar sesión y, al entrar, vuelve a las direcciones", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    await page.goto("/cuenta/direcciones");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Email o teléfono").fill(user.identifier);
    await page.getByLabel("Contraseña", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(/\/cuenta\/direcciones$/);
    await expect(page.getByRole("heading", { level: 2, name: "Direcciones" })).toBeVisible();
  });
});

test.describe("selector de ubicación (mapa)", () => {
  test("el mapa carga con su atribución, un clic coloca el pin y llena las coordenadas; «Quitar pin» las vacía", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    await signIn(page, user);
    await openAddresses(page);
    await page.getByRole("button", { name: "Agregar dirección" }).first().click();
    const form = page.getByRole("dialog");
    const map = form
      .getByRole("application", { name: /Mapa para ubicar la dirección/ })
      .or(form.locator(".leaflet-container"))
      .first();
    await map.scrollIntoViewIfNeeded();
    // La atribución es un enlace; la nota de privacidad también nombra a OpenStreetMap.
    await expect(form.getByRole("link", { name: "OpenStreetMap" })).toBeVisible();
    await expect(form.getByLabel("Latitud")).toHaveValue("");

    const box = (await map.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const lat = Number(await form.getByLabel("Latitud").inputValue());
    const lng = Number(await form.getByLabel("Longitud").inputValue());
    // el centro por defecto es La Paz (−16.5, −68.15): un clic en el centro cae a menos de 0,1° de ahí
    expect(Math.abs(lat - -16.5)).toBeLessThan(0.1);
    expect(Math.abs(lng - -68.15)).toBeLessThan(0.1);

    await form.getByRole("button", { name: "Quitar pin" }).click();
    await expect(form.getByLabel("Latitud")).toHaveValue("");
    await expect(form.getByLabel("Longitud")).toHaveValue("");
  });

  test("con el teclado: Intro sobre el mapa enfocado coloca el pin en el centro (alternativa sin ratón)", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    await signIn(page, user);
    await openAddresses(page);
    await page.getByRole("button", { name: "Agregar dirección" }).first().click();
    const form = page.getByRole("dialog");
    const map = form.locator(".leaflet-container").first();
    await map.scrollIntoViewIfNeeded();
    await map.focus();
    await page.keyboard.press("Enter");
    await expect(form.getByLabel("Latitud")).not.toHaveValue("");
    expect(Math.abs(Number(await form.getByLabel("Latitud").inputValue()) - -16.5)).toBeLessThan(
      0.01,
    );
  });

  test("buscar un lugar (Nominatim simulado): lista resultados como texto, elegir uno coloca el pin y se guarda", async ({
    page,
  }) => {
    const hits: string[] = [];
    await page.route("https://nominatim.openstreetmap.org/**", (route) => {
      hits.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            place_id: 1,
            lat: "-16.4957",
            lon: "-68.1336",
            display_name: "Plaza Murillo, La Paz, Bolivia <b>x</b>",
          },
          {
            place_id: 2,
            lat: "-16.5000",
            lon: "-68.1500",
            display_name: "Plaza Murillo (otra), La Paz",
          },
        ]),
      });
    });
    const user = await registerAndLogin();
    await signIn(page, user);
    await openAddresses(page);
    await page.getByRole("button", { name: "Agregar dirección" }).first().click();
    const form = page.getByRole("dialog");
    await fillForm(page, { label: "Con búsqueda" });
    await form.getByRole("searchbox", { name: "Buscar un lugar" }).fill("Plaza Murillo");
    // sin autocompletado al teclear: aún no se pidió nada
    await page.waitForTimeout(1500);
    expect(hits).toHaveLength(0);
    await form.getByRole("button", { name: "Buscar", exact: true }).click();
    await expect(form.getByText("2 resultados. Elige uno para marcarlo en el mapa.")).toBeVisible();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("countrycodes=bo");
    await expect(form.getByText("<b>x</b>", { exact: false })).toBeVisible(); // texto, no HTML
    await form.getByRole("button", { name: /Plaza Murillo, La Paz, Bolivia/ }).click();
    await expect(form.getByLabel("Latitud")).toHaveValue("-16.4957");
    await expect(form.getByLabel("Longitud")).toHaveValue("-68.1336");
    await form.getByRole("button", { name: "Guardar dirección" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    const row = (await stored(user.id))[0]!;
    expect(Number(row.lat)).toBe(-16.4957);
    expect(Number(row.lng)).toBe(-68.1336);
  });

  test("si el buscador está caído avisa con claridad y se puede seguir sin pin (la referencia basta)", async ({
    page,
  }) => {
    await page.route("https://nominatim.openstreetmap.org/**", (route) =>
      route.fulfill({ status: 503, body: "caído" }),
    );
    const user = await registerAndLogin();
    await signIn(page, user);
    await openAddresses(page);
    await page.getByRole("button", { name: "Agregar dirección" }).first().click();
    const form = page.getByRole("dialog");
    await form.getByRole("searchbox", { name: "Buscar un lugar" }).fill("Plaza Murillo");
    await form.getByRole("button", { name: "Buscar", exact: true }).click();
    await expect(form.getByText(/No pudimos buscar en este momento/)).toBeVisible();
    await fillForm(page, { label: "Sin pin", reference: "frente a la plaza" });
    await form.getByRole("button", { name: "Guardar dirección" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect((await stored(user.id))[0]).toMatchObject({ label: "Sin pin", lat: null, lng: null });
  });

  test("si las teselas no cargan el formulario sigue funcionando (mapa degradado, coordenadas a mano)", async ({
    page,
  }) => {
    await page.unroute("https://tile.openstreetmap.org/**");
    await page.unroute("https://*.tile.openstreetmap.org/**");
    await page.route(/tile\.openstreetmap\.org/, (route) => route.abort());
    const user = await registerAndLogin();
    await signIn(page, user);
    await openAddresses(page);
    await addAddress(page, { label: "Offline", lat: "-17.78", lng: "-63.18" });
    const row = (await stored(user.id))[0]!;
    expect(Number(row.lat)).toBe(-17.78);
  });

  test("permiso de ubicación denegado: mensaje claro y se puede seguir", async ({
    page,
    context,
  }) => {
    await context.grantPermissions([], { origin: "http://127.0.0.1:4173" });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition: (
            _ok: unknown,
            fail: (e: { code: number; message: string }) => void,
          ) => fail({ code: 1, message: "denied" }),
          watchPosition: () => 0,
          clearWatch: () => undefined,
        },
      });
    });
    const user = await registerAndLogin();
    await signIn(page, user);
    await openAddresses(page);
    await page.getByRole("button", { name: "Agregar dirección" }).first().click();
    const form = page.getByRole("dialog");
    await expect(
      form.getByText(/Usamos tu ubicación solo para marcar el punto en el mapa/),
    ).toBeVisible();
    await form.getByRole("button", { name: "Usar mi ubicación" }).click();
    await expect(form.getByText(/No tenemos permiso para ver tu ubicación/)).toBeVisible();
    await expect(form.getByLabel("Latitud")).toHaveValue("");
  });
});

test.describe("accesibilidad y responsive", () => {
  test("la lista, el formulario (con el mapa) y la confirmación pasan axe WCAG 2.1 A/AA, y no hay desbordes a 360 px", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    await signIn(page, user);
    await openAddresses(page);
    await addAddress(page, { label: "Casa", lat: "-16.5", lng: "-68.15" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const scan = async (where: string) => {
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
        where,
      ).toEqual([]);
    };
    await scan("lista");
    await page.getByRole("button", { name: "Agregar dirección" }).first().click();
    await expect(page.getByRole("dialog").locator(".leaflet-container")).toBeVisible();
    await scan("formulario con mapa");
    await page.keyboard.press("Escape");
    await card(page, "Casa").getByRole("button", { name: "Archivar dirección Casa" }).click();
    await expect(page.getByRole("dialog", { name: "¿Archivar esta dirección?" })).toBeVisible();
    await scan("confirmación");
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 360, height: 780 });
    await openAddresses(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Agregar dirección" }).first().click();
    await expect(page.getByRole("dialog").locator(".leaflet-container")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    const dialog = (await page.getByRole("dialog").boundingBox())!;
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(360 + 1);
  });
});
