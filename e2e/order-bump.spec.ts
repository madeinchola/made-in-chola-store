import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { clearRateLimits, dbSql, fn, svcRest } from "../test-support/api";
import { makeCustomer, makeProduct, signInAs } from "../test-support/shop";

/**
 * «Suma a tu pedido» (Sprint 15) en un navegador real contra la nube: un producto relacionado con UNA sola variante con stock se agrega
 * con un clic desde el pago, el total lo recalcula el SERVIDOR, y el pedido sale con las dos líneas. Crea una clienta, dos productos de
 * prueba (activos, relacionados entre sí) y un pedido que se cancela al final (el stock vuelve).
 */
const SLOW = { timeout: 30_000 };
test.describe.configure({ timeout: 180_000 });

test("el pago ofrece un relacionado de una sola variante; un clic lo agrega, el total sube lo que cuesta y el pedido lleva las dos líneas", async ({
  page,
}) => {
  await clearRateLimits();
  const main = await makeProduct(100, 5);
  const bump = await makeProduct(30, 5);
  const related = await svcRest("POST", "product_related", {
    product_id: main.productId,
    related_id: bump.productId,
    sort_order: 1,
  });
  expect(related.status, JSON.stringify(related.body)).toBeLessThan(300);
  const customer = await makeCustomer();
  await fn(
    "cart",
    { action: "set_item", variant_id: main.variantId, qty: 1 },
    { token: customer.token },
  );
  await signInAs(page, customer);
  await page.addInitScript(() => {
    window.open = (() => null) as typeof window.open;
  });

  let orderId: string | undefined;
  try {
    await page.goto("/checkout");
    await expect(page.getByRole("heading", { level: 1, name: "Finalizar compra" })).toBeVisible(
      SLOW,
    );
    const total = page.getByTestId("checkout-total");
    await expect(total).not.toHaveText("—", SLOW);
    const money = async () =>
      Number((await total.innerText()).replace(/[^\d,]/g, "").replace(",", "."));
    const before = await money();

    const section = page.getByRole("region", { name: "Suma a tu pedido" });
    await expect(section).toBeVisible(SLOW);
    await expect(section).toContainText(bump.name);
    expect(
      await new AxeBuilder({ page })
        .include("#order-bump-title")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
        .then((r) => r.violations.map((v) => v.id)),
    ).toEqual([]);

    await section.getByRole("button", { name: new RegExp(`Agregar ${bump.name}`) }).click();
    // el total lo recalcula el servidor: sube exactamente lo que cuesta el producto (30,00; el envío no cambia con esta zona de prueba)
    await expect.poll(money, SLOW).toBeGreaterThan(before);
    expect((await money()) - before).toBeGreaterThanOrEqual(30);
    await expect(page.getByRole("region", { name: "Resumen" })).toContainText(bump.name, SLOW);
    // ya está en la bolsa: deja de ofrecerse
    await expect(page.getByRole("region", { name: "Suma a tu pedido" })).toHaveCount(0, SLOW);

    await page.getByLabel("Teléfono (WhatsApp)").fill("7123 4567");
    const send = page.getByRole("button", { name: "Enviar pedido por WhatsApp" });
    await expect(send).toBeEnabled(SLOW);
    await send.click();
    await expect(page).toHaveURL(/\/pedido\/MIC-\d{6,}$/, SLOW);
    const number = page.url().match(/MIC-\d{6,}/)![0];
    orderId = dbSql(`select id from public.orders where number = '${number}'`);
    expect(dbSql(`select count(*) from public.order_items where order_id = '${orderId}'`)).toBe(
      "2",
    );
    expect(
      dbSql(
        `select string_agg(variant_id::text, ',' order by variant_id) from public.order_items where order_id = '${orderId}'`,
      ),
    ).toBe([main.variantId, bump.variantId].sort().join(","));
  } finally {
    if (orderId)
      await fn("checkout", { action: "cancel", order_id: orderId }, { token: customer.token });
  }
});
