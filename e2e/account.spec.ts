import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  clearRateLimits,
  login,
  registerAndLogin,
  svcRest,
  uniqueEmail,
  uniquePhone,
} from "../test-support/api";

/**
 * «Mi cuenta» (Sprint 6) en un navegador real contra la base local y las Edge Functions reales:
 * navegación, perfil (nombre, contacto con contraseña, preferencias), seguridad (cambiar contraseña, desactivar),
 * datos fiscales y «Mis pedidos». Las direcciones y el mapa están en `account-addresses.spec.ts`.
 */

type User = Awaited<ReturnType<typeof registerAndLogin>>;

test.beforeEach(async () => {
  await clearRateLimits();
});

async function signIn(page: Page, user: User) {
  await page.goto("/login");
  await page.getByLabel("Email o teléfono").fill(user.identifier);
  await page.getByLabel("Contraseña", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByTestId("account-menu")).toBeVisible();
}

const section = (page: Page, title: string) => page.getByRole("heading", { level: 2, name: title });
const profileRow = async (userId: string) =>
  (
    (
      await svcRest(
        "GET",
        `profiles?id=eq.${userId}&select=full_name,email,phone_e164,preferred_currency,preferred_locale,is_active`,
      )
    ).body as {
      full_name: string;
      email: string | null;
      phone_e164: string | null;
      preferred_currency: string | null;
      preferred_locale: string;
      is_active: boolean;
    }[]
  )[0]!;

test.describe("marco de la cuenta", () => {
  test("la navegación lleva a cada sección, marca la activa y el título cambia", async ({
    page,
  }) => {
    const user = await registerAndLogin({ name: "Lucía Mamani" });
    await signIn(page, user);
    await page.goto("/cuenta");
    await expect(page.getByRole("heading", { level: 1, name: "Mi cuenta" })).toBeVisible();
    await expect(page.getByText("Hola, Lucía Mamani")).toBeVisible();
    await expect(page.getByTestId("account-name")).toHaveText("Lucía Mamani");

    const nav = page.getByRole("navigation", { name: "Secciones de mi cuenta" });
    for (const [link, url, heading] of [
      ["Direcciones", /\/cuenta\/direcciones$/, "Direcciones"],
      ["Datos fiscales", /\/cuenta\/datos-fiscales$/, "Datos fiscales"],
      ["Mis pedidos", /\/cuenta\/pedidos$/, "Mis pedidos"],
      ["Seguridad", /\/cuenta\/seguridad$/, "Seguridad"],
      ["Perfil", /\/cuenta$/, "Perfil"],
    ] as const) {
      await nav.getByRole("link", { name: link }).click();
      await expect(page).toHaveURL(url);
      await expect(section(page, heading)).toBeVisible();
      await expect(nav.getByRole("link", { name: link })).toHaveAttribute("aria-current", "page");
    }
  });

  test("sin sesión, cada sección manda a iniciar sesión (y no deja ver nada)", async ({ page }) => {
    for (const path of [
      "/cuenta",
      "/cuenta/direcciones",
      "/cuenta/datos-fiscales",
      "/cuenta/pedidos",
      "/cuenta/seguridad",
      "/cuenta/pedidos/abc",
    ]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login$/);
    }
  });

  test("el enlace «Mi cuenta» del menú de la cabecera lleva al perfil", async ({ page }) => {
    const user = await registerAndLogin();
    await signIn(page, user);
    await page.getByTestId("account-menu").click();
    await page.getByRole("banner").getByRole("link", { name: "Mi cuenta" }).click();
    await expect(page).toHaveURL(/\/cuenta$/);
  });
});

test.describe("perfil", () => {
  test("cambiar el nombre: se guarda, el saludo y el perfil se actualizan, y un nombre vacío se rechaza", async ({
    page,
  }) => {
    const user = await registerAndLogin({ name: "Nombre Viejo" });
    await signIn(page, user);
    await page.goto("/cuenta");
    await page.getByRole("button", { name: "Editar nombre" }).click();
    const dialog = page.getByRole("dialog", { name: "Editar nombre" });
    await dialog.getByLabel("Nombre completo").fill("   ");
    await dialog.getByRole("button", { name: "Guardar" }).click();
    await expect(dialog.getByText("Ingresa tu nombre.")).toBeVisible();
    await dialog.getByLabel("Nombre completo").fill("Lucía Nueva 🧵");
    await dialog.getByRole("button", { name: "Guardar" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("account-name")).toHaveText("Lucía Nueva 🧵");
    await expect(page.getByText("Hola, Lucía Nueva 🧵")).toBeVisible();
    expect((await profileRow(user.id)).full_name).toBe("Lucía Nueva 🧵");
  });

  test("agregar un teléfono pidiendo la contraseña: contraseña mal → error en el campo y no cambia nada; bien → se guarda y sirve para entrar", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    await signIn(page, user);
    await page.goto("/cuenta");
    const phone = uniquePhone();
    await page.getByRole("button", { name: "Agregar teléfono" }).click();
    const dialog = page.getByRole("dialog", { name: "Agregar teléfono" });
    await dialog.getByLabel("Teléfono", { exact: true }).fill(phone);
    await dialog.getByLabel("Tu contraseña actual").fill("Mala-Clave-000!");
    await dialog.getByRole("button", { name: "Agregar teléfono" }).click();
    await expect(dialog.getByText("La contraseña actual no es correcta.")).toBeVisible();
    await expect(dialog.getByLabel("Tu contraseña actual")).toBeFocused();
    expect((await profileRow(user.id)).phone_e164).toBeNull();

    await dialog.getByLabel("Tu contraseña actual").fill(user.password);
    await dialog.getByRole("button", { name: "Agregar teléfono" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page
        .getByText(`+591 ${phone.slice(0, 4)} ${phone.slice(4)}`)
        .or(page.getByText(new RegExp(phone.slice(0, 4)))),
    ).toBeVisible();
    expect((await profileRow(user.id)).phone_e164).toBe(`+591${phone}`);
    expect((await login(phone, user.password)).status).toBe(200);
  });

  test("cambiar el email: se entra con el nuevo; un email que ya es de otra cuenta da UN mensaje que no revela de quién es", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    const other = await registerAndLogin();
    await signIn(page, user);
    await page.goto("/cuenta");

    await page.getByRole("button", { name: "Cambiar email" }).click();
    const dialog = page.getByRole("dialog", { name: "Cambiar email" });
    await dialog.getByLabel("Nuevo email").fill(other.email!);
    await dialog.getByLabel("Tu contraseña actual").fill(user.password);
    await dialog.getByRole("button", { name: "Cambiar email" }).click();
    await expect(dialog.getByText(/No pudimos actualizar ese dato de contacto/)).toBeVisible();
    expect((await profileRow(user.id)).email).toBe(user.email);

    const next = uniqueEmail("nuevo");
    await dialog.getByLabel("Nuevo email").fill(next);
    await dialog.getByLabel("Tu contraseña actual").fill(user.password);
    await dialog.getByRole("button", { name: "Cambiar email" }).click();
    await expect(dialog).toBeHidden();
    expect((await profileRow(user.id)).email).toBe(next);
    expect((await login(next, user.password)).status).toBe(200);
    expect((await login(user.email!, user.password)).status).toBe(401);
  });

  test("no se puede quitar el único dato para entrar: «Quitar» se explica; con los dos, quitar el teléfono funciona", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    await signIn(page, user);
    await page.goto("/cuenta");
    const remove = page.getByRole("button", { name: "Quitar email" });
    await expect(remove).toHaveAttribute("aria-disabled", "true");
    await expect(
      page.getByText(
        "Es tu único dato para ingresar. Agrega un teléfono antes de quitar el email.",
      ),
    ).toBeVisible();
    await remove.click({ force: true }); // aria-disabled: el clic se ignora
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const phone = uniquePhone();
    await page.getByRole("button", { name: "Agregar teléfono" }).click();
    const add = page.getByRole("dialog", { name: "Agregar teléfono" });
    await add.getByLabel("Teléfono", { exact: true }).fill(phone);
    await add.getByLabel("Tu contraseña actual").fill(user.password);
    await add.getByRole("button", { name: "Agregar teléfono" }).click();
    await expect(add).toBeHidden();

    await page.getByRole("button", { name: "Quitar teléfono" }).click();
    const quit = page.getByRole("dialog", { name: "Quitar teléfono" });
    await quit.getByLabel("Tu contraseña actual").fill(user.password);
    await quit.getByRole("button", { name: "Quitar teléfono" }).click();
    await expect(quit).toBeHidden();
    expect((await profileRow(user.id)).phone_e164).toBeNull();
    expect((await login(user.email!, user.password)).status).toBe(200);
  });

  test("preferencias: moneda y idioma se guardan (y «La de la tienda» las vuelve a NULL)", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    await signIn(page, user);
    await page.goto("/cuenta");
    await expect(page.getByRole("heading", { name: "Preferencias" })).toBeVisible();
    const currency = page.getByLabel("Moneda");
    await expect(currency.locator("option")).toHaveText([
      "La de la tienda",
      "BOB — Boliviano (Bs)",
    ]); // solo la habilitada
    await currency.selectOption({ label: "BOB — Boliviano (Bs)" });
    await page.getByRole("button", { name: "Guardar preferencias" }).click();
    await expect(page.getByText("Preferencias guardadas.")).toBeVisible();
    expect(await profileRow(user.id)).toMatchObject({
      preferred_currency: "BOB",
      preferred_locale: "es",
    });
    await currency.selectOption({ label: "La de la tienda" });
    await page.getByRole("button", { name: "Guardar preferencias" }).click();
    await expect.poll(async () => (await profileRow(user.id)).preferred_currency).toBeNull();
  });
});

test.describe("seguridad", () => {
  const NEW_PASSWORD = "Montaña-Azul-2027!";

  test("cambiar la contraseña: el indicador de fortaleza orienta, la débil se rechaza con motivos y la buena funciona", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    await signIn(page, user);
    await page.goto("/cuenta/seguridad");
    const form = page.getByRole("region", { name: "Cambiar contraseña" });
    await form.getByLabel("Contraseña actual").fill(user.password);

    const next = form.getByLabel("Nueva contraseña", { exact: true });
    await next.fill("abc");
    await expect(
      form.getByRole("status").filter({ hasText: "Seguridad de la contraseña" }),
    ).toHaveText("Seguridad de la contraseña: Débil");
    await form.getByLabel("Repite la nueva contraseña").fill("abc");
    await form.getByRole("button", { name: "Cambiar contraseña" }).click();
    await expect(form.getByRole("alert").first()).toBeVisible();
    expect((await login(user.email!, user.password)).status).toBe(200); // nada cambió

    await next.fill(NEW_PASSWORD);
    await expect(
      form.getByRole("status").filter({ hasText: "Seguridad de la contraseña" }),
    ).toHaveText(/Buena|Fuerte|Aceptable/);
    await form.getByLabel("Repite la nueva contraseña").fill(NEW_PASSWORD);
    await form.getByRole("button", { name: "Cambiar contraseña" }).click();
    await expect(page.getByText("Contraseña actualizada.")).toBeVisible();
    expect((await login(user.email!, NEW_PASSWORD)).status).toBe(200);
    expect((await login(user.email!, user.password)).status).toBe(401);
  });

  test("con la contraseña actual incorrecta el error va al campo y la contraseña no cambia", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    await signIn(page, user);
    await page.goto("/cuenta/seguridad");
    const form = page.getByRole("region", { name: "Cambiar contraseña" });
    await form.getByLabel("Contraseña actual").fill("Mala-Clave-000!");
    await form.getByLabel("Nueva contraseña", { exact: true }).fill(NEW_PASSWORD);
    await form.getByLabel("Repite la nueva contraseña").fill(NEW_PASSWORD);
    await form.getByRole("button", { name: "Cambiar contraseña" }).click();
    await expect(form.getByText("La contraseña actual no es correcta.")).toBeVisible();
    expect((await login(user.email!, user.password)).status).toBe(200);
  });

  test("desactivar la cuenta SIN anonimizar: pide confirmar, cierra la sesión, no se puede volver a entrar y los datos se conservan", async ({
    page,
  }) => {
    const user = await registerAndLogin({ name: "Se Va" });
    await svcRest("POST", "addresses", {
      profile_id: user.id,
      label: "Casa",
      recipient: "Se Va",
      phone_e164: "+59171234567",
      line1: "Calle 1",
      city: "La Paz",
    });
    await signIn(page, user);
    await page.goto("/cuenta/seguridad");
    const region = page.getByRole("region", { name: "Desactivar mi cuenta" });
    await expect(region.getByRole("checkbox", { name: /Anonimizar también/ })).not.toBeChecked(); // desmarcada por defecto
    await region.getByLabel("Contraseña actual").fill(user.password);
    await region.getByRole("button", { name: "Desactivar mi cuenta…" }).click();
    const confirm = page.getByRole("dialog", { name: "¿Desactivar tu cuenta?" });
    await expect(confirm.getByText(/Tus pedidos se conservan/)).toBeVisible();
    await confirm.getByRole("button", { name: "Cancelar" }).click();
    expect((await profileRow(user.id)).is_active).toBe(true); // cancelar no desactiva

    await region.getByRole("button", { name: "Desactivar mi cuenta…" }).click();
    await page
      .getByRole("dialog", { name: "¿Desactivar tu cuenta?" })
      .getByRole("button", { name: "Sí, desactivar mi cuenta" })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("banner").getByRole("link", { name: "Ingresar" })).toBeVisible(); // sesión cerrada
    expect((await login(user.email!, user.password)).status).toBe(401);
    expect(await profileRow(user.id)).toMatchObject({ is_active: false, full_name: "Se Va" });
    expect(
      (
        (await svcRest("GET", `addresses?profile_id=eq.${user.id}&select=recipient`))
          .body as unknown[]
      ).length,
    ).toBe(1);
    await page.goto("/cuenta");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("desactivar ANONIMIZANDO: el nombre, el contacto y las direcciones quedan sin datos personales", async ({
    page,
  }) => {
    const user = await registerAndLogin({ name: "Se Anonimiza" });
    await svcRest("POST", "addresses", {
      profile_id: user.id,
      label: "Casa",
      recipient: "Se Anonimiza",
      phone_e164: "+59171234567",
      line1: "Calle 1",
      city: "La Paz",
      lat: -16.5,
      lng: -68.15,
    });
    await signIn(page, user);
    await page.goto("/cuenta/seguridad");
    const region = page.getByRole("region", { name: "Desactivar mi cuenta" });
    await region.getByRole("checkbox", { name: /Anonimizar también/ }).check();
    await region.getByLabel("Contraseña actual").fill(user.password);
    await region.getByRole("button", { name: "Desactivar mi cuenta…" }).click();
    const confirm = page.getByRole("dialog", { name: "¿Desactivar tu cuenta?" });
    await expect(confirm.getByText(/no se puede deshacer/)).toBeVisible();
    await confirm.getByRole("button", { name: "Sí, desactivar mi cuenta" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(await profileRow(user.id)).toMatchObject({
      is_active: false,
      full_name: "Cliente anonimizado",
      email: null,
      phone_e164: null,
    });
    const address = (
      (
        await svcRest(
          "GET",
          `addresses?profile_id=eq.${user.id}&select=recipient,line1,lat,lng,phone_e164`,
        )
      ).body as Record<string, unknown>[]
    )[0]!;
    expect(address).toMatchObject({
      recipient: "Anonimizado",
      line1: "—",
      lat: null,
      lng: null,
      phone_e164: null,
    });
  });

  test("desactivar con la contraseña incorrecta: error en el campo, ni siquiera se abre la confirmación final y no se desactiva", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    await signIn(page, user);
    await page.goto("/cuenta/seguridad");
    const region = page.getByRole("region", { name: "Desactivar mi cuenta" });
    await region.getByLabel("Contraseña actual").fill("Mala-Clave-000!");
    await region.getByRole("button", { name: "Desactivar mi cuenta…" }).click();
    await page
      .getByRole("dialog", { name: "¿Desactivar tu cuenta?" })
      .getByRole("button", { name: "Sí, desactivar mi cuenta" })
      .click();
    await expect(page.getByText("La contraseña actual no es correcta.")).toBeVisible();
    expect((await profileRow(user.id)).is_active).toBe(true);
    await expect(page).toHaveURL(/\/cuenta\/seguridad$/);
  });
});

test.describe("datos fiscales", () => {
  const rows = async (userId: string) =>
    (
      await svcRest(
        "GET",
        `tax_profiles?profile_id=eq.${userId}&select=doc_type,doc_number,legal_name,is_default,archived_at&order=created_at.asc`,
      )
    ).body as {
      doc_type: string;
      doc_number: string;
      legal_name: string;
      is_default: boolean;
      archived_at: string | null;
    }[];

  async function addTax(page: Page, type: string, number: string, name: string) {
    await page.getByRole("button", { name: "Agregar datos fiscales" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Agregar datos fiscales" });
    await dialog.getByLabel("Tipo de documento").selectOption({ label: type });
    await dialog.getByLabel("Número de documento").fill(number);
    await dialog.getByLabel("Razón social o nombre").fill(name);
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    return dialog;
  }

  test("crear un CI con complemento: queda en formato canónico, predeterminado, y un NIT después no le quita la marca", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    await signIn(page, user);
    await page.goto("/cuenta/datos-fiscales");
    await expect(page.getByText("Aún no tienes datos fiscales")).toBeVisible();

    const dialog = await addTax(page, "Cédula de identidad (CI)", "1234567 1a", "Lucía Mamani");
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Datos fiscales guardados.")).toBeVisible();
    const list = page.getByRole("list", { name: "Datos fiscales activos" });
    await expect(list.getByText("Lucía Mamani")).toBeVisible();
    await expect(list.getByText(/1234567-1A/)).toBeVisible();
    await expect(list.getByText("Predeterminado", { exact: true })).toBeVisible();
    expect((await rows(user.id))[0]).toMatchObject({
      doc_type: "ci",
      doc_number: "1234567-1A",
      is_default: true,
    });

    await addTax(page, "NIT", "1020304050", "Lucía SRL");
    await expect(list.getByText("Lucía SRL")).toBeVisible();
    await expect(list.getByText("Predeterminado", { exact: true })).toHaveCount(1);
    await page
      .getByRole("button", { name: "Hacer predeterminados los datos fiscales de NIT 1020304050" })
      .click();
    await expect
      .poll(async () => (await rows(user.id)).find((r) => r.is_default)?.doc_type)
      .toBe("nit");
  });

  test("validación estricta por tipo: bordes exactos de NIT y CI, con el error junto al campo y sin guardar nada", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    await signIn(page, user);
    await page.goto("/cuenta/datos-fiscales");
    await page.getByRole("button", { name: "Agregar datos fiscales" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Agregar datos fiscales" });
    const number = dialog.getByLabel("Número de documento");
    const submit = dialog.getByRole("button", { name: "Guardar", exact: true });
    await dialog.getByLabel("Razón social o nombre").fill("Prueba");

    await dialog.getByLabel("Tipo de documento").selectOption({ label: "NIT" });
    await number.fill("123456"); // 6 dígitos: un NIT necesita 7
    await submit.click();
    await expect(dialog.getByText(/El NIT debe tener al menos 7 dígitos/)).toBeVisible();
    await expect(number).toBeFocused();
    await number.fill("12345678901234"); // 14: el máximo es 13
    await submit.click();
    await expect(dialog.getByText(/El NIT debe tener como máximo 13 dígitos/)).toBeVisible();
    await number.fill("12AB567");
    await submit.click();
    await expect(dialog.getByText("El NIT lleva solo números.")).toBeVisible();

    await dialog
      .getByLabel("Tipo de documento")
      .selectOption({ label: "Cédula de identidad (CI)" });
    await number.fill("123");
    await submit.click();
    await expect(dialog.getByText(/El CI debe tener al menos 4 dígitos/)).toBeVisible();
    await number.fill("<script>");
    await submit.click();
    await expect(dialog.getByText(/El CI lleva solo números/)).toBeVisible();
    expect(await rows(user.id)).toHaveLength(0);
  });

  test("el ajuste «flexible» del admin relaja el formato (y volver a «estricto» lo endurece)", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    try {
      await svcRest("PATCH", "store_settings?key=eq.tax_id_validation", { value: "lenient" });
      await signIn(page, user);
      await page.goto("/cuenta/datos-fiscales");
      const dialog = await addTax(page, "NIT", "AB-12.3/4", "Relajado SRL"); // un NIT con letras: solo vale en flexible
      await expect(dialog).toBeHidden();
      expect((await rows(user.id))[0]).toMatchObject({ doc_type: "nit", doc_number: "AB-12.3/4" });
    } finally {
      await svcRest("PATCH", "store_settings?key=eq.tax_id_validation", { value: "strict" });
    }
  });

  test("el mismo documento activo dos veces se rechaza con un mensaje claro; archivar, restaurar y el aviso de archivados", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    await signIn(page, user);
    await page.goto("/cuenta/datos-fiscales");
    await addTax(page, "NIT", "1020304050", "Uno");
    await expect(page.getByRole("dialog")).toBeHidden();
    const dup = await addTax(page, "NIT", "1020304050", "Dos");
    await expect(dup.getByRole("alert").first()).toBeVisible(); // el rechazo se explica; el diálogo sigue abierto con lo escrito
    await expect(dup.getByLabel("Razón social o nombre")).toHaveValue("Dos");
    await dup.getByRole("button", { name: "Cancelar" }).click();
    expect(await rows(user.id)).toHaveLength(1);

    await page.getByRole("button", { name: "Archivar datos fiscales de NIT 1020304050" }).click();
    await page
      .getByRole("dialog", { name: "¿Archivar estos datos fiscales?" })
      .getByRole("button", { name: "Sí, archivar" })
      .click();
    await expect(page.getByText("Datos fiscales archivados.")).toBeVisible();
    await page.getByRole("button", { name: /Mostrar archivados \(1\)/ }).click();
    await page.getByRole("button", { name: "Restaurar datos fiscales de NIT 1020304050" }).click();
    await expect(
      page.getByRole("list", { name: "Datos fiscales activos" }).getByText("Uno"),
    ).toBeVisible();
    const finalRows = await rows(user.id);
    expect(finalRows).toHaveLength(1); // nada se borró
    expect(finalRows[0]).toMatchObject({ archived_at: null, is_default: true });
  });

  test("cada clienta ve solo lo suyo (IDOR)", async ({ page }) => {
    const ana = await registerAndLogin({ name: "Ana" });
    const beto = await registerAndLogin({ name: "Beto" });
    await svcRest("POST", "tax_profiles", {
      profile_id: ana.id,
      doc_type: "ci",
      doc_number: "7654321",
      legal_name: "Solo de Ana",
    });
    await signIn(page, beto);
    await page.goto("/cuenta/datos-fiscales");
    await expect(page.getByText("Aún no tienes datos fiscales")).toBeVisible();
    await expect(page.getByText("Solo de Ana")).toHaveCount(0);
  });
});

test.describe("mis pedidos (estructura)", () => {
  test("vacío con enlace a la tienda, consultando SOLO los pedidos de la propia clienta; un pedido inexistente da «no encontrado» sin repetir el id de la URL", async ({
    page,
  }) => {
    const user = await registerAndLogin();
    const calls: string[] = [];
    page.on("request", (r) => /\/rest\/v1\/orders/.test(r.url()) && calls.push(r.url()));
    await signIn(page, user);
    await page.goto("/cuenta/pedidos");
    await expect(page.getByText("Aún no tienes pedidos")).toBeVisible();
    // S10: los pedidos son reales; la lista se pide siempre filtrada por la cuenta (aunque la RLS ya lo garantiza)
    expect(calls.length).toBeGreaterThan(0);
    for (const url of calls) expect(url).toContain(`profile_id=eq.${user.id}`);
    await page.getByRole("link", { name: "Ir a la tienda" }).click();
    await expect(page).toHaveURL(/\/tienda$/);

    await page.goto("/cuenta/pedidos/<img src=x onerror=window.__xss=1>");
    await expect(page.getByText("Pedido no encontrado", { exact: true })).toBeVisible();
    await expect(page.getByText("onerror")).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
    ).toBeUndefined();
    await page.getByRole("link", { name: "Volver a mis pedidos" }).click();
    await expect(page).toHaveURL(/\/cuenta\/pedidos$/);
  });
});

test.describe("registro: indicador de fortaleza", () => {
  test("al escribir la contraseña el texto cambia de nivel (y no solo de color)", async ({
    page,
  }) => {
    await page.goto("/registro");
    const password = page.getByLabel("Contraseña", { exact: true });
    await password.fill("abc");
    await expect(page.getByText("Seguridad de la contraseña: Débil")).toBeVisible();
    await password.fill("Mi-Gatito-Blanco-Rojo-27");
    await expect(page.getByText("Seguridad de la contraseña: Fuerte")).toBeVisible();
  });
});

test.describe("accesibilidad y responsive de la cuenta", () => {
  test("cada sección pasa axe WCAG 2.1 A/AA y no desborda a 360 px", async ({ page }) => {
    const user = await registerAndLogin({ name: "Lucía Mamani" });
    await svcRest("POST", "tax_profiles", {
      profile_id: user.id,
      doc_type: "ci",
      doc_number: "1234567",
      legal_name: "Lucía Mamani",
    });
    await signIn(page, user);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const sections: [string, string][] = [
      ["/cuenta", "Perfil"],
      ["/cuenta/datos-fiscales", "Datos fiscales"],
      ["/cuenta/pedidos", "Mis pedidos"],
      ["/cuenta/seguridad", "Seguridad"],
    ];
    for (const width of [1366, 360]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [path, heading] of sections) {
        await page.goto(path);
        await expect(section(page, heading)).toBeVisible();
        await page.waitForLoadState("networkidle");
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(
          results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
          `${path} @${width}`,
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
          `${path} @${width}`,
        ).toBeLessThanOrEqual(0);
      }
    }
    // diálogos con axe
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/cuenta");
    await page.getByRole("button", { name: "Agregar teléfono" }).click();
    await expect(page.getByRole("dialog", { name: "Agregar teléfono" })).toBeVisible();
    const dialogResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      dialogResults.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
    ).toEqual([]);
  });
});
