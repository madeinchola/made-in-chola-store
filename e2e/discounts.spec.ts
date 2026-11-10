import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { clearRateLimits, fn, rest, svcRest, svcRpc } from "../test-support/api";

/**
 * Cupón de descuento en la bolsa (Sprint 9) en un navegador real contra la nube: un invitado agrega un producto, abre
 * /carrito, aplica un cupón de ejemplo del seed (`EJEMPLO10`: 10 %), ve el descuento por línea y en el resumen, lo quita, prueba un
 * código inexistente y uno vencido, y comprueba que el cupón sobrevive a recargar la página.
 *
 * Se SALTA si la Edge Function `cart` desplegada aún no entiende `set_coupon` o si faltan los cupones de ejemplo del seed
 * (`supabase/seed.sql`, bloque «Descuentos (S9)»). Valores calculados a mano: 10 % de un precio P (en centavos) =
 * round(P_centavos × 10 / 100) centavos, igual que el servidor (redondeo por línea, medio centavo hacia arriba).
 */

test.beforeEach(async () => {
  await clearRateLimits();
});

const money = (n: number) => {
  const [int = "0", frac = "00"] = n.toFixed(2).split(".");
  return `Bs ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
};
const tenPercent = (price: number) => Math.round((Math.round(price * 100) * 10) / 100) / 100;
const SLOW = { timeout: 30_000 };

async function ready(): Promise<string | null> {
  // 1) ¿la función desplegada entiende set_coupon? (si no, el esquema la rechaza con 400)
  const probe = await fn("cart", { action: "set_coupon", code: "PRUEBA" });
  if (probe.status === 400)
    return "La función `cart` desplegada aún no acepta cupones (hay que desplegarla).";
  // 2) ¿están los cupones de ejemplo?
  const found = await svcRest(
    "GET",
    "coupons?code=eq.EJEMPLO10&archived_at=is.null&select=id,is_active",
  );
  if (found.status !== 200 || (found.body as unknown[]).length === 0) {
    return "Faltan los cupones de ejemplo del seed (bloque «Descuentos (S9)» de supabase/seed.sql).";
  }
  return null;
}

async function pickVariant(maxPrice = Infinity) {
  const response = await svcRest(
    "GET",
    "product_variants?select=id,stock_on_hand,product_colors(name),product_sizes(label)," +
      "products!inner(slug,name,status,archived_at)" +
      "&archived_at=is.null&stock_on_hand=gte.6&products.status=eq.active&products.archived_at=is.null&limit=60",
  );
  expect(response.status).toBe(200);
  for (const row of response.body as {
    id: string;
    stock_on_hand: number;
    product_colors: { name: string } | null;
    product_sizes: { label: string } | null;
    products: { slug: string; name: string };
  }[]) {
    const price = await rest(
      "GET",
      `public_products?slug=eq.${row.products.slug}&select=price_bob&limit=1`,
    );
    const priceBob = (price.body as { price_bob: number }[])[0]?.price_bob;
    if (typeof priceBob !== "number" || priceBob > maxPrice) continue;
    const delta = 40 - row.stock_on_hand;
    if (delta > 0) {
      const topUp = await svcRpc("apply_stock_change", {
        p_variant_id: row.id,
        p_delta: delta,
        p_reason: "import",
        p_note: "E2E de cupones: reposición",
      });
      expect(topUp.status, JSON.stringify(topUp.body)).toBe(200);
    }
    return {
      slug: row.products.slug,
      name: row.products.name,
      color: row.product_colors?.name ?? null,
      size: row.product_sizes?.label ?? null,
      price: priceBob,
    };
  }
  return null;
}

const colorSlug = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

async function bagWith(page: Page, pick: NonNullable<Awaited<ReturnType<typeof pickVariant>>>) {
  const color = pick.color ? `?color=${colorSlug(pick.color)}` : "";
  await page.goto(`/producto/${pick.slug}${color}`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole("heading", { level: 1, name: pick.name })).toBeVisible();
  if (pick.size) {
    await page
      .getByRole("radiogroup", { name: "Talla" })
      .getByRole("radio", { name: pick.size, exact: true })
      .click();
  }
  await page.getByRole("button", { name: "Agregar a la bolsa" }).click();
  const drawer = page.getByRole("dialog", { name: "Tu bolsa" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "Ver bolsa" }).click(SLOW);
  await expect(page).toHaveURL(/\/carrito$/);
  await expect(page.getByRole("heading", { level: 1, name: "Tu bolsa" })).toBeVisible(SLOW);
}

const summary = (page: Page) => page.getByRole("region", { name: "Resumen" });
const field = (page: Page) => summary(page).getByRole("textbox", { name: "Código de cupón" });

/** Errores no controlados: el visitante los vería como «Algo salió mal». */
function trackUncaught(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /Error no controlado/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

test.describe("cupón en /carrito", () => {
  test.beforeEach(async () => {
    const reason = await ready();
    test.skip(reason !== null, reason ?? "");
  });

  test("aplicar «ejemplo-10»: el descuento sale en el resumen y en la línea; quitarlo devuelve el campo y el total original", async ({
    page,
  }) => {
    const uncaught = trackUncaught(page);
    const pick = (await pickVariant())!;
    await bagWith(page, pick);
    const off = tenPercent(pick.price);
    const net = Math.round((pick.price - off) * 100) / 100;

    await field(page).fill("ejemplo-10"); // se normaliza: minúsculas y guion
    await summary(page).getByRole("button", { name: "Aplicar" }).click();

    // tarjeta del cupón
    await expect(summary(page).getByText("Tu cupón")).toBeVisible(SLOW);
    await expect(summary(page)).toContainText("Código: EJEMPLO10");
    await expect(summary(page)).toContainText(`Ahorras ${money(off)}`);
    // resumen: la fila de descuento, el desglose por nombre y UN solo total, ya descontado
    await expect(summary(page)).toContainText(money(off));
    await expect(summary(page)).toContainText("Cupón del 10 % (ejemplo): −" + money(off));
    await expect(summary(page)).toContainText(`Total${money(net)}`);
    // la línea: precio original tachado, precio final y el descuento nombrado
    const line = page
      .getByRole("main")
      .getByRole("list", { name: "Productos en tu bolsa" })
      .getByRole("listitem")
      .first();
    await expect(line).toContainText(money(pick.price));
    await expect(line).toContainText(money(net));
    await expect(line).toContainText("Cupón del 10 % (ejemplo)");

    // quitar
    await summary(page).getByRole("button", { name: "Quitar el cupón EJEMPLO10" }).click();
    await expect(field(page)).toBeVisible(SLOW);
    await expect(field(page)).toBeFocused();
    await expect(summary(page)).not.toContainText("Tu cupón");
    await expect(summary(page)).toContainText(`Total${money(pick.price)}`);
    await page.waitForTimeout(500);
    expect(uncaught).toEqual([]);
  });

  test("un código inexistente: avisa «no es válido», conserva lo escrito y deja el foco en el campo", async ({
    page,
  }) => {
    await bagWith(page, (await pickVariant())!);
    await field(page).fill("NOEXISTE99");
    await summary(page).getByRole("button", { name: "Aplicar" }).click();
    const alert = summary(page).getByRole("alert");
    await expect(alert).toContainText(
      "Ese código no es válido. Revísalo e inténtalo de nuevo.",
      SLOW,
    );
    await expect(field(page)).toHaveValue("NOEXISTE99");
    await expect(field(page)).toBeFocused();
    await expect(summary(page)).not.toContainText("Tu cupón");
  });

  test("un cupón VENCIDO avisa «ya venció» (se crea uno vencido para la prueba y se archiva al terminar)", async ({
    page,
  }) => {
    const existing = await svcRest("GET", "discounts?name=eq.E2E%20cup%C3%B3n%20vencido&select=id");
    let discountId = (existing.body as { id: string }[])[0]?.id;
    if (discountId) {
      // Quedó archivado por la corrida anterior (el proyecto de móvil y el de escritorio comparten este descuento): un descuento
      // archivado responde «código no válido», no «ya venció». Se restaura para que la prueba se pueda repetir.
      const restored = await svcRest("PATCH", `discounts?id=eq.${discountId}`, {
        archived_at: null,
      });
      expect(restored.status, JSON.stringify(restored.body)).toBeLessThan(300);
    } else {
      const created = await svcRest("POST", "discounts", {
        name: "E2E cupón vencido",
        kind: "percent",
        params: { percent: 10 },
        requires_coupon: true,
        starts_at: "2026-01-01T00:00:00Z",
        ends_at: "2026-06-01T00:00:00Z",
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      discountId = created.body[0].id as string;
      const coupon = await svcRest("POST", "coupons", {
        discount_id: discountId,
        code: "E2E-VENCIDO",
      });
      expect(coupon.status, JSON.stringify(coupon.body)).toBe(201);
    }
    try {
      await bagWith(page, (await pickVariant())!);
      await field(page).fill("e2e-vencido");
      await summary(page).getByRole("button", { name: "Aplicar" }).click();
      await expect(summary(page).getByRole("alert")).toContainText("Ese cupón ya venció.", SLOW);
    } finally {
      await svcRest("PATCH", `discounts?id=eq.${discountId}`, {
        archived_at: new Date().toISOString(),
      });
    }
  });

  test("mínimo no alcanzado: el cupón queda guardado con el aviso de cuánto falta y se puede quitar", async ({
    page,
  }) => {
    const pick = await pickVariant(140); // EJEMPLO20 pide Bs 150: con un producto de menos de Bs 150 no llega
    test.skip(pick === null, "No hay un producto de menos de Bs 140 para probar el mínimo.");
    await bagWith(page, pick!);
    await field(page).fill("EJEMPLO20");
    await summary(page).getByRole("button", { name: "Aplicar" }).click();
    const missing = Math.round((150 - pick!.price) * 100) / 100;
    await expect(summary(page)).toContainText(
      `Te faltan ${money(missing)} para usar este cupón.`,
      SLOW,
    );
    await expect(summary(page)).toContainText("Código: EJEMPLO20");
    await expect(summary(page)).toContainText(`Total${money(pick!.price)}`); // no baja nada todavía
    await summary(page).getByRole("button", { name: "Quitar el cupón EJEMPLO20" }).click();
    await expect(field(page)).toBeVisible(SLOW);
  });

  test("el cupón sobrevive a recargar la página (queda guardado en la bolsa del servidor)", async ({
    page,
  }) => {
    const pick = (await pickVariant())!;
    await bagWith(page, pick);
    await field(page).fill("EJEMPLO10");
    await summary(page).getByRole("button", { name: "Aplicar" }).click();
    await expect(summary(page).getByText("Tu cupón")).toBeVisible(SLOW);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Tu bolsa" })).toBeVisible(SLOW);
    await expect(summary(page).getByText("Tu cupón")).toBeVisible(SLOW);
    await expect(summary(page)).toContainText(`Ahorras ${money(tenPercent(pick.price))}`);
  });

  test("accesibilidad AA con el cupón aplicado, y sin desbordes a 360 px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await bagWith(page, (await pickVariant())!);
    await field(page).fill("EJEMPLO10");
    await summary(page).getByRole("button", { name: "Aplicar" }).click();
    await expect(summary(page).getByText("Tu cupón")).toBeVisible(SLOW);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
    ).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
