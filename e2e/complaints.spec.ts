import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { clearRateLimits, dbExec, dbSql, randomTag } from "../test-support/api";
import { adminSession, signInAs } from "../test-support/shop";

/**
 * Canal de reclamos (Sprint 15) en un navegador real contra la nube: una visitante llena el formulario público y recibe su número; la
 * administradora lo encuentra en la bandeja, lo abre, lo responde y queda registrado. NO crea cuentas de administración (reutiliza una
 * `@prueba.test`). Los reclamos de prueba llevan un marcador y se borran al terminar con SQL directo.
 */
const SLOW = { timeout: 30_000 };
const tag = randomTag();
const NAME = `Prueba E2E ${tag}`;
const DETAIL =
  "La prenda llegó con una costura abierta y no es lo que pedí. Prueba automática E2E.";
let admin: { token: string; refresh: string } | null = null;

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  admin = await adminSession();
  await clearRateLimits();
});
test.afterAll(async () => {
  try {
    dbExec(`delete from public.notification_outbox where dedupe_key in (select 'complaint_new:' || id::text from public.complaints where contact_name like 'Prueba E2E ${tag}%');
            delete from public.complaints where contact_name like 'Prueba E2E ${tag}%';`);
  } catch {
    /* los avisos quedan inertes */
  }
  await clearRateLimits();
});
test.beforeEach(async () => {
  await clearRateLimits();
});

async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    label,
  ).toEqual([]);
}
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

let number = "";

test("el pie enlaza al canal de reclamos y el formulario es accesible, sin desbordes y sin claves de texto sueltas", async ({
  page,
}) => {
  await page.goto("/tienda");
  const legal = page.getByRole("heading", { name: "Legal" }).locator("xpath=..");
  await legal.getByRole("link", { name: "Reclamos" }).click();
  await expect(page).toHaveURL(/\/reclamos$/);
  await expect(page.getByRole("heading", { level: 1, name: "Reclamos" })).toBeVisible(SLOW);
  await expect(page.getByText(/en un plazo de hasta \d+ días/)).toBeVisible(SLOW);
  await expectAccessible(page, "formulario de reclamos");
  expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  expect(await page.locator("main").innerText()).not.toMatch(/\bcomplaints\.[a-zA-Z]+\./);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index,follow");
});

test("vacío no envía: explica cada campo y deja el foco en el primero", async ({ page }) => {
  await page.goto("/reclamos");
  await page.getByRole("button", { name: "Enviar reclamo" }).click();
  await expect(page.getByText("Escribe tu nombre.")).toBeVisible();
  await expect(
    page.getByText("Escribe un correo o un teléfono para poder responderte."),
  ).toBeVisible();
  await expect(page.getByLabel("Tu nombre")).toBeFocused();
  await expectAccessible(page, "formulario con errores");
});

test("una visitante reclama: recibe su número y su plazo, y queda registrado", async ({ page }) => {
  await page.goto("/reclamos");
  await page.getByLabel("Tu nombre").fill(NAME);
  await page.getByLabel("Correo electrónico").fill("prueba.e2e@example.com");
  await page.getByLabel("Número de pedido (si lo tienes)").fill("mic-000123");
  await page.getByLabel("¿Sobre qué es tu reclamo?").selectOption("delivery");
  await page.getByLabel("Cuéntanos qué pasó").fill(DETAIL);
  // el campo trampa no se alcanza con el teclado
  await page.getByLabel("Cuéntanos qué pasó").focus();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name),
  ).not.toBe("website");
  await page.getByRole("button", { name: "Enviar reclamo" }).click();
  const title = page.getByRole("heading", { level: 1, name: "Recibimos tu reclamo" });
  await expect(title).toBeVisible(SLOW);
  await expect(title).toBeFocused();
  const text = await page.getByRole("status").innerText();
  number = /REC-\d{6,}/.exec(text)![0];
  expect(text).toMatch(/Te responderemos antes del \d{1,2} de \w+ de \d{4}/);
  await expectAccessible(page, "confirmación del reclamo");
  expect(
    dbSql(
      `select status || '|' || kind || '|' || order_number || '|' || contact_email from public.complaints where number = '${number}'`,
    ),
  ).toBe("new|delivery|MIC-000123|prueba.e2e@example.com");
});

test("la administradora lo ve en la bandeja (nuevo, con su plazo), lo abre, lo responde y queda registrado", async ({
  page,
}) => {
  test.skip(!admin, "No hay una cuenta de administración de prueba (@prueba.test) para entrar.");
  await signInAs(page, admin!);
  await page.goto("/admin/reclamos");
  await expect(page.getByRole("heading", { level: 1, name: "Reclamos" })).toBeVisible(SLOW);
  const table = page.getByRole("table", { name: "Reclamos" });
  await expect(table).toBeVisible(SLOW);
  const rowOfMine = table.getByRole("row").filter({ hasText: number });
  await expect(rowOfMine).toContainText(NAME);
  await expect(rowOfMine).toContainText("Nuevo");
  await expectAccessible(page, "bandeja de reclamos");
  expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  expect(await page.locator("main").innerText()).not.toMatch(/\badmin\.complaints\.[a-zA-Z]/);

  await rowOfMine.getByRole("button", { name: `Abrir el reclamo ${number}` }).click();
  const dialog = page.getByRole("dialog", { name: `Reclamo ${number}` });
  await expect(dialog).toContainText(DETAIL);
  // la animación de entrada del diálogo termina antes de medir contraste (a medio desvanecer, axe lee colores a medias)
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await expect(dialog.getByRole("link", { name: "Escribir un correo" })).toHaveAttribute(
    "href",
    new RegExp(`^mailto:prueba\\.e2e@example\\.com\\?subject=.*${number}`),
  );
  await expect(dialog).toContainText("MIC-000123");
  await expectAccessible(page, "detalle del reclamo");

  // «respondido» exige escribir qué se contestó
  await dialog.getByLabel("Estado").selectOption("answered");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Escribe qué le respondiste");
  await dialog.getByLabel("Lo que respondiste").fill("Le enviamos otra prenda por la misma vía.");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Reclamo actualizado.")).toBeVisible(SLOW);
  await expect(dialog).toHaveCount(0);
  expect(
    dbSql(
      `select status || '|' || response || '|' || (answered_at is not null)::text from public.complaints where number = '${number}'`,
    ),
  ).toBe("answered|Le enviamos otra prenda por la misma vía.|true");
  // ya no está entre los abiertos, sí entre los respondidos
  await expect(table.getByRole("row").filter({ hasText: number })).toHaveCount(0, SLOW);
  await page.getByRole("button", { name: "Respondidos" }).click();
  await expect(table.getByRole("row").filter({ hasText: number })).toContainText(
    "Respondido",
    SLOW,
  );
});
