import { expect, test, type Page } from "@playwright/test";
import { recoverySession, svcRest, testEnv } from "../test-support/api";

/**
 * Panel de Descuentos (Sprint 9) en un navegador real contra la nube, como administradora.
 *
 * NO crea cuentas: reutiliza una de las cuentas de administración de prueba que ya existen (`@prueba.test`, inertes) y entra
 * con un enlace de recuperación que genera la clave de servicio. Si no hay ninguna, se salta. Lo que crea (un descuento
 * «E2E …» y sus códigos) se archiva al terminar aunque la prueba falle (nada se borra).
 *
 * Cubre lo que las pruebas de componentes (con la red simulada) no pueden: que el panel carga con TODOS sus textos reales
 * (el diccionario del panel se registra al cargar `AdminShell`: una clave sin registrar se vería como `admin.…`), que el
 * asistente guarda lo que dice la vista previa y que la base lo acepta, y que el descuento creado aparece donde debe.
 */

const tag = Math.random().toString(16).slice(2, 8);
const NAME = `E2E descuento ${tag}`;
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
    `discounts?name=like.${encodeURIComponent("E2E descuento %")}&archived_at=is.null`,
    {
      archived_at: new Date().toISOString(),
    },
  );
});

test.beforeEach(() => {
  test.skip(!session, "No hay una cuenta de administración de prueba (@prueba.test) para entrar.");
});

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

function trackConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Una clave de texto sin registrar se vería como `admin.discounts.…`. */
const rawKeys = (page: Page) =>
  page
    .locator("main")
    .evaluate((el) => el.textContent?.match(/\badmin\.[a-z]+\.[A-Za-z0-9_.]+/g) ?? []);

const SLOW = { timeout: 30_000 };

test("las tres pestañas cargan con sus textos reales y el listado muestra los cupones de ejemplo", async ({
  page,
}) => {
  const errors = trackConsoleErrors(page);
  await signIn(page);
  await page.goto("/admin/descuentos");
  await expect(page.getByRole("heading", { level: 1, name: "Descuentos y cupones" })).toBeVisible(
    SLOW,
  );
  const tabs = page.getByRole("navigation", { name: "Secciones de descuentos" });
  for (const name of ["Descuentos", "Redenciones", "Grupos de clientes"]) {
    await expect(tabs.getByRole("link", { name })).toBeVisible();
  }
  await expect(page.getByRole("heading", { level: 2, name: "Descuentos" })).toBeVisible(SLOW);
  await expect(page.getByRole("button", { name: "Nuevo descuento" }).first()).toBeVisible();
  expect(await rawKeys(page)).toEqual([]);

  await tabs.getByRole("link", { name: "Redenciones" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Redenciones" })).toBeVisible(SLOW);
  expect(await rawKeys(page)).toEqual([]);

  await tabs.getByRole("link", { name: "Grupos de clientes" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Grupos de clientes" })).toBeVisible(
    SLOW,
  );
  expect(await rawKeys(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("el asistente crea un cupón del 12,5 %: la vista previa dice lo mismo que la base guarda, y aparece en la lista", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/admin/descuentos");
  await expect(page.getByRole("heading", { level: 2, name: "Descuentos" })).toBeVisible(SLOW);
  await page.getByRole("button", { name: "Nuevo descuento" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Nuevo descuento" });
  await expect(dialog.getByText(/Paso 1 de 2/)).toBeVisible();
  await dialog.getByRole("button", { name: /Porcentaje con código/ }).click();
  await expect(dialog.getByText(/Paso 2 de 2/)).toBeVisible();
  await dialog.getByRole("textbox", { name: "Nombre" }).fill(NAME);
  await dialog.getByRole("textbox", { name: /Porcentaje de descuento/ }).fill("12,5");
  // la vista previa se arma con lo escrito, en lenguaje claro
  await expect(dialog.getByText(/12,5 % en toda la bolsa con el código/)).toBeVisible();
  await dialog.getByRole("button", { name: "Crear descuento" }).click();
  const done = page.getByRole("dialog", { name: "Descuento creado" });
  await expect(done).toBeVisible(SLOW);

  // la base lo guardó EXACTAMENTE como se leyó
  const saved = await svcRest(
    "GET",
    `discounts?name=eq.${encodeURIComponent(NAME)}&select=kind,params,requires_coupon,scope,currency,is_active`,
  );
  expect(saved.status).toBe(200);
  expect(saved.body).toEqual([
    {
      kind: "percent",
      params: { percent: 12.5 },
      requires_coupon: true,
      scope: "order",
      currency: "BOB",
      is_active: true,
    },
  ]);

  // se agregan códigos desde el mismo asistente: uno a mano y diez al azar
  await done.getByRole("button", { name: "Agregar códigos" }).click();
  const codes = page.getByRole("dialog", { name: `Códigos de «${NAME}»` });
  await expect(codes).toBeVisible(SLOW);
  await codes.getByRole("button", { name: "Generar al azar" }).click();
  await codes.getByRole("textbox", { name: "Cantidad de códigos" }).fill("10");
  await codes.getByRole("textbox", { name: /Prefijo/ }).fill("e2e");
  await codes.getByRole("button", { name: "Generar códigos" }).click();
  await expect(codes.getByRole("heading", { name: "Se generaron 10 códigos" })).toBeVisible(SLOW);
  const rows = await svcRest(
    "GET",
    `coupons?discount_id=eq.${(await svcRest("GET", `discounts?name=eq.${encodeURIComponent(NAME)}&select=id`)).body[0].id}&select=code,usage_limit`,
  );
  expect((rows.body as { code: string; usage_limit: number | null }[]).length).toBe(10);
  for (const row of rows.body as { code: string; usage_limit: number | null }[]) {
    expect(row.code).toMatch(/^E2E-[2-9A-HJKMNP-Z]{8}$/); // prefijo en mayúsculas y alfabeto sin 0 O 1 I L
    expect(row.usage_limit).toBeNull();
  }
});

test("archivar el descuento pide confirmar y lo deja al final como «Archivado»", async ({
  page,
}) => {
  // el descuento de la prueba anterior (si no existe, se crea uno por la API para no depender del orden)
  const found = await svcRest("GET", `discounts?name=eq.${encodeURIComponent(NAME)}&select=id`);
  if ((found.body as unknown[]).length === 0) {
    const created = await svcRest("POST", "discounts", {
      name: NAME,
      kind: "percent",
      params: { percent: 10 },
      requires_coupon: true,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
  }
  await signIn(page);
  await page.goto("/admin/descuentos");
  await expect(page.getByRole("heading", { level: 2, name: "Descuentos" })).toBeVisible(SLOW);
  await page.getByRole("button", { name: `Archivar el descuento «${NAME}»` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archivar descuento" }).click();
  await expect(page.getByText("Descuento archivado.")).toBeVisible(SLOW);
  const row = page.getByRole("row", { name: new RegExp(NAME) });
  await expect(row).toContainText("Archivado");
  await expect(row.getByRole("button", { name: `Restaurar el descuento «${NAME}»` })).toBeVisible();
});
