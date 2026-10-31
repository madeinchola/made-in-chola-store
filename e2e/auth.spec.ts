import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  authApi,
  clearRateLimits,
  mailpitMessageText,
  mailpitMessagesTo,
  registerAndLogin,
  STRONG_PASSWORD,
  svcRpc,
  uniqueEmail,
  uniquePhone,
} from "../test-support/api";

test.beforeEach(async () => {
  await clearRateLimits();
});

/** Errores de consola que NO son ruido esperado (los 4xx de red los registra el navegador solos). */
function trackConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function uiLogin(page: Page, identifier: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email o teléfono").fill(identifier);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
}

/** Icono de usuario de la cabecera: con sesión es un botón (se llama como la persona) que despliega su cuenta. */
const headerAccount = (page: Page) => page.getByTestId("account-menu");

/** Cierra sesión como lo haría una persona: abre su cuenta en la cabecera y pulsa «Cerrar sesión». */
async function logoutViaHeader(page: Page) {
  await headerAccount(page).click();
  await page.getByRole("banner").getByRole("button", { name: "Cerrar sesión" }).click();
  // La sesión se cierra por red: hasta ver «Ingresar» no hay que navegar (abortaría el cierre y seguiría dentro).
  await expect(page.getByRole("banner").getByRole("link", { name: "Ingresar" })).toBeVisible();
}

test.describe("registro, sesión y logout", () => {
  test("registro por email → queda dentro → /cuenta muestra sus datos → logout → /cuenta lo manda a login", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const email = uniqueEmail("e2e");
    await page.goto("/registro");
    await page.getByLabel("Nombre completo").fill("Lucía Mamani");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña", { exact: true }).fill(STRONG_PASSWORD);
    await page.getByLabel("Repite la contraseña").fill(STRONG_PASSWORD);
    await page.getByRole("button", { name: "Crear cuenta" }).click();

    await expect(headerAccount(page)).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("button", { name: "Lucía Mamani" }),
    ).toBeVisible();
    await headerAccount(page).click();
    await expect(page.getByRole("banner").getByRole("link", { name: "Mi cuenta" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Panel" })).toHaveCount(0); // cliente: sin Panel
    await page.keyboard.press("Escape");

    await page.goto("/cuenta");
    await expect(page.getByTestId("account-name")).toHaveText("Lucía Mamani");
    await expect(page.getByText(email)).toBeVisible();

    await logoutViaHeader(page);
    await expect(page.getByRole("banner").getByRole("link", { name: "Ingresar" })).toBeVisible();
    await page.goto("/cuenta");
    await expect(page).toHaveURL(/\/login$/);
    expect(errors).toEqual([]);
  });

  test("registro SOLO con teléfono y login posterior con otro formato del mismo número", async ({
    page,
  }) => {
    const phone = uniquePhone();
    await page.goto("/registro");
    await page.getByLabel("Nombre completo").fill("Rosa Choque");
    await page.getByRole("button", { name: "Con teléfono" }).click();
    await page.getByLabel("Teléfono").fill(`${phone.slice(0, 4)} ${phone.slice(4)}`);
    await page.getByLabel("Contraseña", { exact: true }).fill(STRONG_PASSWORD);
    await page.getByLabel("Repite la contraseña").fill(STRONG_PASSWORD);
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(headerAccount(page)).toBeVisible();

    await logoutViaHeader(page);
    await uiLogin(page, `+591-${phone}`, STRONG_PASSWORD);
    await expect(
      page.getByRole("banner").getByRole("button", { name: "Rosa Choque" }),
    ).toBeVisible();
    await page.goto("/cuenta");
    await expect(page.getByText(`+591${phone}`)).toBeVisible();
  });

  test("la sesión sobrevive a recargar la página", async ({ page }) => {
    const u = await registerAndLogin({ name: "Persistente" });
    await uiLogin(page, u.identifier, u.password);
    await expect(headerAccount(page)).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("banner").getByRole("button", { name: "Persistente" }),
    ).toBeVisible();
  });

  test("contraseña incorrecta y usuario inexistente muestran EXACTAMENTE el mismo mensaje", async ({
    page,
  }) => {
    const u = await registerAndLogin();
    await clearRateLimits();
    await uiLogin(page, u.identifier, "clave-incorrecta-1");
    const wrong = await page.getByRole("alert").first().innerText();
    await page.goto("/login");
    await uiLogin(page, uniqueEmail("fantasma"), "clave-incorrecta-1");
    await expect(page.getByRole("alert").first()).toBeVisible();
    expect(await page.getByRole("alert").first().innerText()).toBe(wrong);
    expect(wrong).toBe("Email, teléfono o contraseña incorrectos.");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("tras 5 intentos fallidos aparece el bloqueo con el tiempo de espera", async ({ page }) => {
    const u = await registerAndLogin();
    await clearRateLimits();
    for (let i = 0; i < 5; i++) {
      await uiLogin(page, u.identifier, `clave-mala-${i}-x`);
      await expect(page.getByRole("alert").first()).toBeVisible();
    }
    await uiLogin(page, u.identifier, u.password);
    await expect(page.getByRole("alert").first()).toContainText(/Espera \d+ segundos/);
    await expect(page).toHaveURL(/\/login$/);
  });

  test("política de contraseña en el formulario: requisitos visibles y no se envía", async ({
    page,
  }) => {
    await page.goto("/registro");
    await page.getByLabel("Nombre completo").fill("Ana");
    await page.getByLabel("Email").fill(uniqueEmail());
    await page.getByLabel("Contraseña", { exact: true }).fill("password1");
    await page.getByLabel("Repite la contraseña").fill("otra-distinta");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByText("Es una contraseña demasiado común.")).toBeVisible();
    await expect(page.getByText("Las contraseñas no coinciden.")).toBeVisible();
    await expect(page).toHaveURL(/\/registro$/);
  });
});

test.describe("acceso a /admin por rol", () => {
  test("visitante → /login; al ingresar como admin vuelve a /admin y ve el panel", async ({
    page,
  }) => {
    const admin = await registerAndLogin({ name: "Admin E2E" });
    await svcRpc("promote_admin", { p_email: admin.email });
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Email o teléfono").fill(admin.identifier);
    await page.getByLabel("Contraseña", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Panel de administración" })).toBeVisible();
    // Un admin ve el enlace "Panel" en la cabecera pública de la tienda.
    await page.goto("/");
    await headerAccount(page).click(); // «Panel» vive en el menú de la cuenta de la cabecera
    await expect(page.getByRole("banner").getByRole("link", { name: "Panel" })).toBeVisible();
  });

  test("un cliente que escribe /admin a mano NO ve el panel", async ({ page }) => {
    const u = await registerAndLogin();
    await uiLogin(page, u.identifier, u.password);
    await expect(headerAccount(page)).toBeVisible();
    await page.goto("/admin/productos");
    await expect(page.getByRole("heading", { name: "Panel de administración" })).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
  });

  test("admin DEGRADADO con la sesión abierta pierde el acceso en cuanto la app revalida", async ({
    page,
  }) => {
    const a = await registerAndLogin({ name: "Admin Temporal" });
    await svcRpc("promote_admin", { p_email: a.email });
    await uiLogin(page, a.identifier, a.password);
    await expect(headerAccount(page)).toBeVisible(); // esperar a que el login termine antes de navegar
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Panel de administración" })).toBeVisible();

    // Hay otro admin (el del seed), así que se puede degradar a este.
    expect((await svcRpc("set_user_role", { p_id: a.id, p_role: "customer" })).status).toBeLessThan(
      300,
    );
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); // "vuelve a la pestaña"
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Panel de administración" })).toHaveCount(0);
  });
});

test.describe("sesiones revocadas", () => {
  test("cuenta desactivada con la sesión abierta → la app cierra la sesión sola", async ({
    page,
  }) => {
    const u = await registerAndLogin({ name: "A Desactivar" });
    await uiLogin(page, u.identifier, u.password);
    await expect(headerAccount(page)).toBeVisible();
    await svcRpc("deactivate_profile", { p_id: u.id, p_anonymize: false });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByRole("banner").getByRole("link", { name: "Ingresar" })).toBeVisible();
    await page.goto("/cuenta");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("logout en una pestaña cierra la sesión en las demás", async ({ context }) => {
    const u = await registerAndLogin({ name: "Dos Pestañas" });
    const a = await context.newPage();
    await uiLogin(a, u.identifier, u.password);
    await expect(headerAccount(a)).toBeVisible();
    const b = await context.newPage();
    await b.goto("/");
    await expect(b.getByRole("banner").getByRole("button", { name: "Dos Pestañas" })).toBeVisible();
    await logoutViaHeader(a);
    await expect(a.getByRole("banner").getByRole("link", { name: "Ingresar" })).toBeVisible();
    await expect(b.getByRole("banner").getByRole("link", { name: "Ingresar" })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("token vencido/inválido en el storage: la app arranca como visitante, sin pantalla en blanco", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const key =
        Object.keys(localStorage).find((k) => k.includes("auth-token")) ?? "sb-127-auth-token";
      localStorage.setItem(
        key,
        JSON.stringify({
          access_token: "x.y.z",
          refresh_token: "inexistente",
          expires_at: 1,
          expires_in: 1,
          token_type: "bearer",
          user: { id: "u" },
        }),
      );
    });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Made In Chola" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Ingresar" })).toBeVisible();
  });
});

test.describe("recuperación de contraseña (UI + correo real)", () => {
  test("pedir enlace → correo en Mailpit → abrir enlace → política → nueva contraseña → entrar con ella", async ({
    page,
  }) => {
    const u = await registerAndLogin({ name: "Olvidadiza" });
    await page.goto("/recuperar");
    await page.getByLabel("Email").fill(u.email!);
    await page.getByRole("button", { name: "Enviar enlace" }).click();
    await expect(page.getByRole("status")).toContainText("Si existe una cuenta");

    let msgs: { ID: string }[] = [];
    for (let i = 0; i < 20 && msgs.length === 0; i++) {
      await page.waitForTimeout(500);
      msgs = await mailpitMessagesTo(u.email!);
    }
    expect(msgs).toHaveLength(1);
    const text = await mailpitMessageText(msgs[0]!.ID);
    const link = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/
      .exec(text)![0]
      .replace(/&amp;/g, "&");
    await page.goto(link);

    await expect(page.getByRole("heading", { name: "Nueva contraseña" })).toBeVisible();
    await page.getByLabel("Nueva contraseña", { exact: true }).fill("12345678");
    await page.getByLabel("Repite la nueva contraseña").fill("12345678");
    await page.getByRole("button", { name: "Guardar contraseña" }).click();
    await expect(page.getByText(/secuencias como 12345678/)).toBeVisible();

    const nueva = "Nuevo-Cielo-Andino-77";
    await page.getByLabel("Nueva contraseña", { exact: true }).fill(nueva);
    await page.getByLabel("Repite la nueva contraseña").fill(nueva);
    await page.getByRole("button", { name: "Guardar contraseña" }).click();
    await expect(page).toHaveURL(/\/$/);

    await logoutViaHeader(page);
    await clearRateLimits();
    await uiLogin(page, u.identifier, nueva);
    await expect(
      page.getByRole("banner").getByRole("button", { name: "Olvidadiza" }),
    ).toBeVisible();
  });

  test("email inexistente: MISMO mensaje que uno existente y no llega ningún correo", async ({
    page,
  }) => {
    const ghost = uniqueEmail("sinCuenta");
    await page.goto("/recuperar");
    await page.getByLabel("Email").fill(ghost);
    await page.getByRole("button", { name: "Enviar enlace" }).click();
    await expect(page.getByRole("status")).toContainText("Si existe una cuenta");
    await page.waitForTimeout(1500);
    expect(await mailpitMessagesTo(ghost)).toHaveLength(0);
  });

  test("enlace de recuperación inválido → mensaje claro y opción de pedir uno nuevo", async ({
    page,
  }) => {
    await page.goto("/restablecer");
    await expect(page.getByRole("alert")).toContainText("no es válido o ya venció", {
      timeout: 15_000,
    });
    await expect(page.getByRole("link", { name: "Solicitar un enlace nuevo" })).toBeVisible();
  });

  test("usuario solo-teléfono ve la indicación de contactar por WhatsApp", async ({ page }) => {
    await page.goto("/recuperar");
    await expect(page.getByText(/solo con teléfono/i)).toBeVisible();
  });
});

test.describe("accesibilidad y responsive de las pantallas de auth", () => {
  for (const path of ["/login", "/registro", "/recuperar"]) {
    test(`${path}: sin violaciones WCAG A/AA detectables por axe`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
    });

    test(`${path}: sin scroll horizontal`, async ({ page }) => {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("el formulario de login se puede completar solo con teclado", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email o teléfono").focus();
    await page.keyboard.type("nadie@correo.test");
    await page.keyboard.press("Tab");
    await page.keyboard.type("loquesea");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert").first()).toContainText("incorrectos");
  });
});

test("el bundle público no contiene la service key ni secretos", async ({ request, baseURL }) => {
  const html = await (await request.get(baseURL!)).text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map(
    (m) => m[1]!,
  );
  expect(assets.length).toBeGreaterThan(0);
  for (const a of assets) {
    const body = await (await request.get(a)).text();
    // (No se busca el texto "service_role": supabase-js lo menciona en sus mensajes. Lo peligroso es una CLAVE.)
    expect(body, a).not.toMatch(/sb_secret_/);
    // ningún JWT con rol service_role (payload base64url de {"role":"service_role"})
    for (const jwt of body.match(/eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g) ?? []) {
      const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
      expect(payload.role, `JWT en ${a}`).not.toBe("service_role");
    }
  }
  expect(authApi).toBeDefined();
});
