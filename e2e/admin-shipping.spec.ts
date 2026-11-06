import { expect, test, type Page } from "@playwright/test";
import { recoverySession, svcRest, testEnv } from "../test-support/api";

/**
 * Panel de Envíos (Sprint 8) en un navegador real contra la nube, como administrador.
 *
 * NO crea cuentas: reutiliza una de las cuentas de administración de prueba que ya existen (`@prueba.test`, inertes, sin
 * contraseña conocida) y entra con un enlace de recuperación que genera la clave de servicio. Si no hay ninguna, se salta.
 * Los datos que crea (una zona «E2E …») se archivan al terminar aunque la prueba falle.
 *
 * Cubre lo que las pruebas de componentes (con la red simulada) no pueden: que el panel carga con TODOS sus textos
 * (el diccionario del panel se registra al cargar `AdminShell`: una clave sin registrar se vería como `admin.…`), que lee
 * lo que hay en la base y que lo que el admin cambia lo ve el simulador, que usa la misma `quote_shipping` que la tienda.
 * El origen y la tarifa de ejemplo son los del seed (`supabase/seed.sql`): origen (-16.5, -68.15), tramo 1 → Bs 15.
 */

const tag = Math.random().toString(16).slice(2, 8);
const ZONE = `E2E zona ${tag}`;
let session: { access: string; refresh: string } | null = null;

test.beforeAll(async () => {
  const admins = await svcRest(
    "GET",
    "profiles?role=eq.admin&is_active=eq.true&select=email&limit=20",
  );
  const email = (admins.body as { email: string | null }[])
    .map((r) => r.email)
    .find((e): e is string => !!e && e.endsWith("@prueba.test"));
  if (!email) return;
  session = await recoverySession(email);
});

test.afterAll(async () => {
  await svcRest(
    "PATCH",
    `shipping_zones?name=like.${encodeURIComponent("E2E zona %")}&archived_at=is.null`,
    {
      archived_at: new Date().toISOString(),
    },
  );
});

test.beforeEach(() => {
  test.skip(!session, "No hay una cuenta de administración de prueba (@prueba.test) para entrar.");
});

/** Entra como admin dejando la sesión donde la guarda supabase-js, antes de que cargue la aplicación. */
async function signIn(page: Page) {
  const env = testEnv();
  const user = await fetch(`${env.url}/auth/v1/user`, {
    headers: { apikey: env.anon, Authorization: `Bearer ${session!.access}` },
  }).then((r) => r.json());
  const ref = new URL(env.url).hostname.split(".")[0];
  const stored = {
    access_token: session!.access,
    refresh_token: session!.refresh,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  };
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [`sb-${ref}-auth-token`, JSON.stringify(stored)],
  );
}

/** Errores de consola que NO son ruido esperado (los 4xx de red los registra el navegador solos). */
function trackConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Una clave de texto sin registrar se vería como `admin.shipping.…`. */
const rawKeys = (page: Page) =>
  page
    .locator("main")
    .evaluate((el) => el.textContent?.match(/\badmin\.[a-z]+\.[A-Za-z0-9_.]+/g) ?? []);

const SLOW = { timeout: 30_000 };

test("las cinco pestañas cargan con sus textos reales y muestran lo que hay en la base", async ({
  page,
}) => {
  const errors = trackConsoleErrors(page);
  await signIn(page);
  await page.goto("/admin/envios");
  await expect(page.getByRole("heading", { level: 1, name: "Envíos y entregas" })).toBeVisible(
    SLOW,
  );

  const tabs = page.getByRole("navigation", { name: "Secciones de envíos" });
  for (const name of ["Tienda y métodos", "Zonas", "Tarifas", "Entregas", "Simulador"]) {
    await expect(tabs.getByRole("link", { name })).toBeVisible();
  }
  // Tienda y métodos: el origen y los métodos del seed
  await expect(page.getByText("Taller (ejemplo)").first()).toBeVisible(SLOW);
  await expect(page.getByText("Recojo en el taller").first()).toBeVisible();
  expect(await rawKeys(page)).toEqual([]);

  await tabs.getByRole("link", { name: "Zonas" }).click();
  await expect(page.getByText("Hasta 25 km del taller (ejemplo)")).toBeVisible(SLOW);
  await expect(page.getByText("La Paz y El Alto (ejemplo)")).toBeVisible();
  expect(await rawKeys(page)).toEqual([]);

  await tabs.getByRole("link", { name: "Tarifas" }).click();
  await expect(page.getByText("Por distancia (ejemplo)")).toBeVisible(SLOW);
  expect(await rawKeys(page)).toEqual([]);

  await tabs.getByRole("link", { name: "Entregas" }).click();
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible(SLOW);
  expect(await rawKeys(page)).toEqual([]);

  await tabs.getByRole("link", { name: "Simulador" }).click();
  await expect(page.getByRole("button", { name: "Calcular" })).toBeVisible(SLOW);
  expect(await rawKeys(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("el simulador calcula con la misma función que la tienda: sobre el origen, Bs 15,00 por la regla de ejemplo", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/admin/envios/simulador");
  await expect(page.getByRole("button", { name: "Calcular" })).toBeVisible(SLOW);
  await page.getByRole("textbox", { name: "Ciudad" }).fill("La Paz");
  await page.getByRole("textbox", { name: "Monto del pedido (Bs)" }).fill("100");
  await page.getByRole("button", { name: "Calcular" }).click();
  const result = page.getByRole("main");
  await expect(result).toContainText("15,00", SLOW);
  await expect(result).toContainText("Por distancia (ejemplo)");
  await expect(result).toContainText("Tramo 1");
});

test("una zona SIN servicio creada en el panel bloquea la cotización del simulador, y al archivarla vuelve a cotizar", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/admin/envios/zonas");
  await expect(page.getByText("Hasta 25 km del taller (ejemplo)")).toBeVisible(SLOW);

  // crear la zona: radio de 3 km sobre el origen (el centro por defecto es el origen), sin servicio
  await page.getByRole("button", { name: "Nueva zona" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Nueva zona" });
  await dialog.getByRole("textbox", { name: "Nombre" }).fill(ZONE);
  await dialog.getByRole("combobox", { name: /Tipo de zona/ }).selectOption("radius");
  await dialog.getByRole("textbox", { name: "Radio (km)" }).fill("3");
  await dialog.getByRole("checkbox", { name: "Zona sin servicio" }).check();
  await dialog.getByRole("button", { name: "Guardar zona" }).click();
  await expect(page.getByText("Zona creada.")).toBeVisible(SLOW);
  await expect(page.getByRole("row", { name: new RegExp(ZONE) })).toContainText("Sin servicio");

  // el simulador (mismo servidor) la respeta
  await page.getByRole("link", { name: "Simulador" }).click();
  await page.getByRole("textbox", { name: "Ciudad" }).fill("La Paz");
  await page.getByRole("textbox", { name: "Monto del pedido (Bs)" }).fill("100");
  await page.getByRole("button", { name: "Calcular" }).click();
  await expect(page.getByRole("main")).toContainText("Por ahora no entregamos en esa zona.", SLOW);
  await expect(page.getByRole("main")).not.toContainText("Por distancia (ejemplo)");

  // archivarla desde el panel devuelve la cotización
  await page.getByRole("link", { name: "Zonas" }).click();
  await page.getByRole("button", { name: `Archivar la zona «${ZONE}»` }).click();
  await page.getByRole("button", { name: "Archivar zona" }).click();
  await expect(page.getByText("Zona archivada.")).toBeVisible(SLOW);
  await page.getByRole("link", { name: "Simulador" }).click();
  await page.getByRole("textbox", { name: "Ciudad" }).fill("La Paz");
  await page.getByRole("textbox", { name: "Monto del pedido (Bs)" }).fill("100");
  await page.getByRole("button", { name: "Calcular" }).click();
  await expect(page.getByRole("main")).toContainText("15,00", SLOW);
});
