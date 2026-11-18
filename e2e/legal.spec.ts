import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  clearRateLimits,
  dbExec,
  dbSql,
  fn,
  rpc,
  STRONG_PASSWORD,
  uniqueEmail,
} from "../test-support/api";
import {
  adminSession,
  makeCustomer,
  makeProduct,
  signInAs,
  type Customer,
} from "../test-support/shop";

/**
 * Textos legales (Sprint 15) en un navegador real contra la nube: el administrador escribe y publica desde el panel, la tienda
 * muestra el texto vigente, el registro y el pago exigen aceptarlo (y lo dejan registrado), y quien ya tenía cuenta ve el aviso
 * de «actualizamos los textos» al publicarse una versión nueva.
 *
 * Publicar es irreversible desde la interfaz (las versiones son inmutables): la prueba SOLO corre si la base no tiene ningún texto
 * legal, y al terminar los borra con SQL directo para dejarla como la encontró. NO crea cuentas de administración (reutiliza una
 * `@prueba.test`). Las cuentas y el pedido de prueba son inertes (el pedido se cancela).
 */

const SLOW = { timeout: 30_000 };
const TERMS_TEXT = [
  "# 1. Condiciones de uso",
  "",
  "Este es el texto de prueba de los términos y condiciones de la tienda, escrito por la prueba automática.",
  "",
  "- Primera regla de prueba",
  "- Segunda regla de prueba",
].join("\n");

const CLEAN = `
begin;
alter table public.legal_versions disable trigger legal_versions_guard_trg;
delete from public.legal_versions;
alter table public.legal_versions enable trigger legal_versions_guard_trg;
alter table public.legal_acceptances disable trigger legal_acceptances_immutable;
delete from public.legal_acceptances;
alter table public.legal_acceptances enable trigger legal_acceptances_immutable;
commit;`;

let skipReason: string | null = null;
let admin: { token: string; refresh: string } | null = null;
let buyer: Customer;
let orderId: string | undefined;

async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    label,
  ).toEqual([]);
}

async function expectNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, label).toBeLessThanOrEqual(0);
}

/** Entra como esa persona; WhatsApp no se abre de verdad. */
async function signIn(page: Page, session: { token: string; refresh: string }) {
  await signInAs(page, session);
  await page.addInitScript(() => {
    window.open = (() => null) as typeof window.open;
  });
}

test.describe.configure({ mode: "serial", timeout: 240_000 });

test.beforeAll(async () => {
  try {
    const existing = Number(dbSql("select count(*) from public.legal_versions"));
    if (existing > 0) {
      skipReason = `Hay ${existing} versiones de textos legales en la base: no se prueba sobre textos reales.`;
      return;
    }
  } catch (error) {
    skipReason = `Sin acceso SQL a la nube: ${(error as Error).message.split("\n")[0]}`;
    return;
  }
  admin = await adminSession();
  if (!admin) {
    skipReason = "No hay una cuenta de administración de prueba (@prueba.test) para entrar.";
    return;
  }
  await clearRateLimits();
  // La compradora y su bolsa se preparan ANTES de publicar (después, registrarse exigiría aceptar los textos).
  buyer = await makeCustomer();
  const product = await makeProduct(60, 20);
  await fn(
    "cart",
    { action: "set_item", variant_id: product.variantId, qty: 1 },
    { token: buyer.token },
  );
});

test.afterAll(async () => {
  if (skipReason?.startsWith("Hay ")) return;
  if (orderId && buyer)
    await fn("checkout", { action: "cancel", order_id: orderId }, { token: buyer.token });
  try {
    dbExec(CLEAN);
  } finally {
    await clearRateLimits();
  }
});

test.beforeEach(() => {
  test.skip(skipReason !== null, skipReason ?? "");
});

test("sin textos publicados: la página legal lo dice, no se indexa y el pie enlaza los cinco documentos", async ({
  page,
}) => {
  await page.goto("/legal/terminos");
  await expect(page.getByRole("heading", { level: 1, name: "Términos y condiciones" })).toBeVisible(
    SLOW,
  );
  await expect(page.getByText("Este documento todavía no está publicado.")).toBeVisible(SLOW);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,follow");
  // el pie lleva los cinco documentos legales
  const legal = page.getByRole("heading", { name: "Legal" }).locator("xpath=..");
  for (const name of [
    "Política de privacidad",
    "Reembolsos",
    "Envíos",
    "Términos de servicio",
    "Política de cookies",
  ]) {
    await expect(legal.getByRole("link", { name })).toBeVisible();
  }
  await page.getByRole("link", { name: "Política de cookies" }).first().click();
  await expect(page).toHaveURL(/\/legal\/cookies$/);
  await expect(page.getByRole("heading", { level: 1, name: "Política de cookies" })).toBeVisible(
    SLOW,
  );
  await expectAccessible(page, "página legal sin publicar");
  await expectNoOverflow(page, "página legal sin publicar");
});

test("el administrador parte del texto de partida, no puede publicarlo tal cual, lo corrige y lo publica", async ({
  page,
}) => {
  await signIn(page, admin!);
  await page.goto("/admin/legal");
  await expect(page.getByRole("heading", { level: 1, name: "Textos legales" })).toBeVisible(SLOW);
  await expect(page.getByText(/los redactó el equipo de desarrollo, no un abogado/)).toBeVisible();
  await expect(page.getByRole("table", { name: "Documentos legales" })).toBeVisible(SLOW);
  await expectAccessible(page, "lista de textos legales");
  await expectNoOverflow(page, "lista de textos legales");
  expect(await page.locator("main").innerText()).not.toMatch(/\badmin\.legal\.[A-Za-z]/);

  await page.getByRole("link", { name: "Editar Términos y condiciones" }).click();
  await expect(page).toHaveURL(/\/admin\/legal\/terms$/);
  const box = page.getByLabel("Texto del documento");
  await expect(box).toHaveValue(/BORRADOR SIN REVISIÓN LEGAL/, SLOW);
  await expect(page.getByText(/Todavía no hay ninguna versión/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Publicar…" })).toBeDisabled();
  await expectAccessible(page, "editor de un texto legal");
  await expectNoOverflow(page, "editor de un texto legal");

  // guardar el texto de partida tal cual: se guarda, pero la marca de borrador impide publicarlo
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page.getByText("Borrador guardado.")).toBeVisible(SLOW);
  await page.getByRole("button", { name: "Publicar…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("No se puede publicar todavía")).toBeVisible();
  await expect(dialog).toContainText("BORRADOR SIN REVISIÓN LEGAL");
  await expect(dialog.getByRole("button", { name: "Publicar", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toHaveCount(0);

  // un texto con HTML no se guarda
  await box.fill("Texto con <script>alert(1)</script> que no debe guardarse jamás.");
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page.getByText(/no admite etiquetas HTML/)).toBeVisible();

  // el texto corregido se guarda, se previsualiza y se publica
  await box.fill(TERMS_TEXT);
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page.getByText("Borrador guardado.").first()).toBeVisible(SLOW);
  await page.getByRole("button", { name: "Vista previa" }).click();
  await expect(page.getByTestId("preview-body")).toContainText("Primera regla de prueba");
  await expectAccessible(page, "vista previa");
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByRole("button", { name: "Publicar…" }).click();
  await expect(dialog.getByRole("radio", { name: "Desde ahora" })).toBeChecked();
  await dialog.getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.getByText("Versión 1 publicada.")).toBeVisible(SLOW);
  await expect(page.getByText(/Vigente: versión 1 desde el/)).toBeVisible(SLOW);
  const table = page.getByRole("table", { name: "Historial de versiones" });
  await expect(table).toContainText("Vigente");

  // la política de privacidad se publica por la API (la interfaz ya se probó): así el registro exige las dos
  const saved = await rpc(
    "admin_legal_save_draft",
    {
      p_kind: "privacy",
      p_body: "Texto de prueba de la política de privacidad, escrito por la prueba automática.",
      p_note: null,
    },
    admin!.token,
  );
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const published = await rpc(
    "admin_legal_publish",
    { p_kind: "privacy", p_effective_at: null, p_note: null },
    admin!.token,
  );
  expect(published.status, JSON.stringify(published.body)).toBe(200);
});

test("la tienda muestra el texto publicado con su versión, se indexa y es accesible", async ({
  page,
}) => {
  await page.goto("/legal/terminos");
  await expect(page.getByTestId("legal-body")).toContainText("Primera regla de prueba", SLOW);
  await expect(page.getByText(/Versión 1 · vigente desde el /)).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "1. Condiciones de uso" }),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index,follow");
  expect(await page.locator("script", { hasText: "alert(1)" }).count()).toBe(0);
  await expectAccessible(page, "página legal publicada");
  await expectNoOverflow(page, "página legal publicada");
  await page.goto("/legal/privacidad");
  await expect(page.getByTestId("legal-body")).toContainText("política de privacidad", SLOW);
});

test("registrarse exige marcar la casilla y deja registrado lo aceptado", async ({ page }) => {
  await clearRateLimits();
  const email = uniqueEmail("legal-e2e");
  await page.goto("/registro");
  await expect(page.getByRole("heading", { level: 1, name: "Crear cuenta" })).toBeVisible(SLOW);
  const consent = page.getByRole("checkbox", { name: /Leí y acepto/ });
  await expect(consent).toBeVisible(SLOW);
  await expect(page.getByRole("link", { name: /Términos y condiciones/ })).toHaveAttribute(
    "href",
    "/legal/terminos",
  );
  await expectAccessible(page, "registro con casilla legal");
  await expectNoOverflow(page, "registro con casilla legal");

  await page.getByLabel("Nombre completo").fill("Clienta Legal E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(STRONG_PASSWORD);
  await page.getByLabel("Repite la contraseña").fill(STRONG_PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByText("Para continuar, acepta los textos legales.")).toBeVisible();
  await expect(page).toHaveURL(/\/registro$/);

  await consent.check();
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).not.toHaveURL(/\/registro$/, SLOW);
  const rows = dbSql(
    `select a.kind || ':' || a.version || ':' || a.context from public.legal_acceptances a
       join public.profiles p on p.id = a.profile_id where p.email = '${email}' order by a.kind`,
  )
    .split("\n")
    .filter(Boolean);
  expect(rows).toEqual(["privacy:1:register", "terms:1:register"]);
});

test("el pago exige aceptar los textos vigentes: sin marcar no se crea el pedido; marcada, sí, y queda registrado", async ({
  page,
}) => {
  await signIn(page, buyer);
  await page.goto("/checkout");
  await expect(page.getByRole("heading", { level: 1, name: "Finalizar compra" })).toBeVisible(SLOW);
  await expect(page.getByTestId("checkout-total")).not.toHaveText("—", SLOW);
  const consent = page.getByRole("checkbox", { name: /Leí y acepto/ });
  await expect(consent).toBeVisible(SLOW);
  // la casilla reemplaza al aviso fijo de «al enviar aceptas»
  await expect(page.getByText(/Al enviar tu pedido aceptas/)).toHaveCount(0);
  await expectAccessible(page, "checkout con casilla legal");
  await expectNoOverflow(page, "checkout con casilla legal");

  await page.getByLabel("Teléfono (WhatsApp)").fill("7123 4567");
  const send = page.getByRole("button", { name: "Enviar pedido por WhatsApp" });
  await expect(send).toBeEnabled(SLOW);
  await send.click();
  await expect(page.getByText("Para continuar, acepta los textos legales.")).toBeVisible();
  await expect(consent).toBeFocused();
  await expect(page).toHaveURL(/\/checkout$/);
  expect(Number(dbSql(`select count(*) from public.orders where profile_id = '${buyer.id}'`))).toBe(
    0,
  );

  await consent.check();
  await send.click();
  await expect(page).toHaveURL(/\/pedido\/MIC-\d{6,}$/, SLOW);
  const number = page.url().match(/MIC-\d{6,}/)![0];
  orderId = dbSql(`select id from public.orders where number = '${number}'`);
  const rows = dbSql(
    `select kind || ':' || version || ':' || context || ':' || (order_id = '${orderId}')
       from public.legal_acceptances where profile_id = '${buyer.id}' order by kind`,
  )
    .split("\n")
    .filter(Boolean);
  expect(rows).toEqual(["privacy:1:checkout:true", "terms:1:checkout:true"]);
});

test("al publicarse una versión nueva, quien ya tiene cuenta ve qué cambió y la acepta de nuevo", async ({
  page,
}) => {
  // el administrador publica la versión 2 de los términos (desde la segunda hay que decir qué cambió)
  const saved = await rpc(
    "admin_legal_save_draft",
    { p_kind: "terms", p_body: `${TERMS_TEXT}\n- Tercera regla de prueba`, p_note: null },
    admin!.token,
  );
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const published = await rpc(
    "admin_legal_publish",
    { p_kind: "terms", p_effective_at: null, p_note: "Se agregó una tercera regla" },
    admin!.token,
  );
  expect(published.status, JSON.stringify(published.body)).toBe(200);

  await signIn(page, buyer);
  await page.goto("/tienda");
  const dialog = page.getByRole("dialog", { name: "Actualizamos nuestros textos legales" });
  await expect(dialog).toBeVisible(SLOW);
  await expect(dialog).toContainText(
    "Términos y condiciones (versión 2): Se agregó una tercera regla",
  );
  await expect(dialog).not.toContainText("Política de privacidad"); // la privacidad no cambió
  await expectAccessible(page, "aviso de textos nuevos");
  await dialog.getByRole("button", { name: "Acepto" }).click();
  await expect(dialog).toHaveCount(0, SLOW);
  const rows = dbSql(
    `select kind || ':' || version || ':' || context from public.legal_acceptances
      where profile_id = '${buyer.id}' and context = 'reaccept'`,
  )
    .split("\n")
    .filter(Boolean);
  expect(rows).toEqual(["terms:2:reaccept"]);

  // al volver a entrar no se lo pide otra vez (se espera a que la consulta de lo pendiente conteste antes de mirar)
  const pending = page.waitForResponse((r) => r.url().includes("my_legal_pending"), SLOW);
  await page.reload();
  expect(await (await pending).json()).toEqual({});
  await expect(
    page.getByRole("dialog", { name: "Actualizamos nuestros textos legales" }),
  ).toHaveCount(0);
});
