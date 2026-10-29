import { expect, test } from "@playwright/test";

test.describe("humo", () => {
  test("home carga con título, h1 y sin errores de consola", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page).toHaveTitle(/Made In Chola/);
    await expect(page.getByRole("heading", { level: 1, name: "Made In Chola" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("ruta inexistente muestra la 404 de la app (no la del servidor)", async ({ page }) => {
    await page.goto("/ruta/que/no/existe");
    await expect(page.getByRole("heading", { name: "Página no encontrada" })).toBeVisible();
  });

  test("refresh en ruta profunda NO da 404 de servidor", async ({ page }) => {
    const response = await page.goto("/producto/vestido-chola-rojo");
    expect(response?.status()).toBe(200);
    await page.reload();
    await expect(page.getByText(/disponible pronto/i)).toBeVisible();
  });

  test("/admin sin sesión redirige a /login", async ({ page }) => {
    await page.goto("/admin/productos");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Acceso" })).toBeVisible();
  });

  test("sin scroll horizontal (responsive)", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
