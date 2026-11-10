import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  clearRateLimits,
  fn,
  randomTag,
  registerAndLogin,
  rest,
  svcRest,
  svcRpc,
  testEnv,
} from "../test-support/api";

/**
 * Checkout (Sprint 10) en un navegador real contra la nube: una clienta con sesión real llena su bolsa, paga por WhatsApp,
 * ve la confirmación, encuentra el pedido en «Mis pedidos» y lo cancela (el stock vuelve). Además: doble clic, stock que cambia
 * mientras compra (revalidación), accesibilidad AA, CLS y desbordes en móvil.
 *
 * Crea una clienta inerte `@prueba.test` y un producto de prueba por prueba (nada se borra; los pedidos se cancelan al final).
 * `window.open` se intercepta: se comprueba QUÉ enlace de WhatsApp se abriría sin abrir WhatsApp de verdad.
 */

const SLOW = { timeout: 30_000 };
const money = (n: number) => {
  const [int = "0", frac = "00"] = n.toFixed(2).split(".");
  return `Bs ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
};
const parseMoney = (text: string) => Number(text.replace(/[^\d,-]/g, "").replace(",", "."));

interface Customer {
  token: string;
  refresh: string;
  id: string;
}

async function makeProduct(price: number, stock: number) {
  const tag = randomTag();
  const product = await svcRest("POST", "products", {
    code: `E${tag}`.toUpperCase(),
    slug: `e2e-pedido-${tag}`,
    name: `Camisa E2E ${tag}`,
    cost_base: 10,
  });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  const productId = product.body[0].id as string;
  const color = await svcRest("POST", "product_colors", { product_id: productId, name: "Único" });
  const variant = await svcRest("POST", "product_variants", {
    product_id: productId,
    color_id: color.body[0].id,
  });
  const variantId = variant.body[0].id as string;
  await svcRest("POST", "product_prices", {
    product_id: productId,
    currency: "BOB",
    amount: price,
  });
  await svcRpc("apply_stock_change", {
    p_variant_id: variantId,
    p_delta: stock,
    p_reason: "import",
    p_note: "E2E pedidos",
  });
  await svcRest("PATCH", `products?id=eq.${productId}`, { status: "active" });
  return {
    productId,
    variantId,
    name: product.body[0].name as string,
    slug: product.body[0].slug as string,
  };
}

const stockOf = async (variantId: string) =>
  (await svcRest("GET", `product_variants?id=eq.${variantId}&select=stock_on_hand`)).body[0]
    .stock_on_hand as number;

async function makeCustomer(): Promise<Customer & { addressId: string }> {
  await clearRateLimits();
  const user = await registerAndLogin({ name: "Clienta E2E" });
  const address = await rest("POST", "addresses", user.token, {
    profile_id: user.id,
    label: "Casa",
    recipient: "Clienta E2E",
    phone_e164: "+59171234567",
    line1: "Calle del E2E 123",
    city: "La Paz",
    country: "BO",
    lat: -16.52,
    lng: -68.15,
  });
  expect(address.status, JSON.stringify(address.body)).toBe(201);
  return {
    token: user.token,
    refresh: user.refresh,
    id: user.id,
    addressId: address.body[0].id as string,
  };
}

/** Entra como la clienta: inyecta su sesión en el almacenamiento local (igual que lo hace el cliente de Supabase). */
async function signIn(page: Page, customer: Customer) {
  const env = testEnv();
  const user = await fetch(`${env.url}/auth/v1/user`, {
    headers: { apikey: env.anon, Authorization: `Bearer ${customer.token}` },
  }).then((r) => r.json());
  const ref = new URL(env.url).hostname.split(".")[0];
  const stored = {
    access_token: customer.token,
    refresh_token: customer.refresh,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  };
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key!, value!);
      // WhatsApp no se abre de verdad: se anota el enlace al que iría.
      (window as unknown as { __opened: string[] }).__opened = [];
      window.open = ((url?: string | URL) => {
        (window as unknown as { __opened: string[] }).__opened.push(String(url));
        return null;
      }) as typeof window.open;
    },
    [`sb-${ref}-auth-token`, JSON.stringify(stored)],
  );
}

const opened = (page: Page) =>
  page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);

async function openCheckout(page: Page) {
  await page.goto("/checkout");
  await expect(page.getByRole("heading", { level: 1, name: "Finalizar compra" })).toBeVisible(SLOW);
  // el total sale del servidor: hasta que llega no es un número
  await expect(page.getByTestId("checkout-total")).toBeVisible(SLOW);
  await expect(page.getByTestId("checkout-total")).not.toHaveText("—", SLOW);
  // …y que el botón ya tenga la vista previa fresca (no «Calculando tu total…»)
  await expect(
    page.getByRole("button", { name: /Enviar pedido por WhatsApp|Confirmar pedido/ }),
  ).toBeEnabled(SLOW);
}

async function cancelCreated(customer: Customer, orderId: string | undefined) {
  if (orderId)
    await fn("checkout", { action: "cancel", order_id: orderId }, { token: customer.token });
}

// Cada prueba crea una clienta, un producto y un pedido reales contra la nube: con 30 s no alcanza (es latencia, no un fallo).
test.describe.configure({ timeout: 120_000 });

test.beforeEach(async () => {
  await clearRateLimits();
});

test("compra completa por WhatsApp: formulario → confirmación → «Mis pedidos» → cancelar (el stock vuelve)", async ({
  page,
}) => {
  const product = await makeProduct(80, 10);
  const customer = await makeCustomer();
  await fn(
    "cart",
    { action: "set_item", variant_id: product.variantId, qty: 2 },
    { token: customer.token },
  );
  await signIn(page, customer);
  await openCheckout(page);

  // el formulario trae lo del perfil y la dirección predeterminada; el resumen, lo que dice el servidor
  await expect(page.getByLabel("Nombre completo")).toHaveValue("Clienta E2E");
  await expect(page.getByRole("radio", { name: /Entrega a domicilio/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Casa/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Pedir por WhatsApp/ })).toBeChecked();
  const summary = page.getByRole("region", { name: "Resumen" });
  await expect(summary).toContainText(product.name);
  await expect(summary.getByText("Subtotal").locator("xpath=following-sibling::dd")).toHaveText(
    money(160),
  ); // 2 × 80,00
  const shipping = parseMoney(
    await summary
      .getByText("Envío", { exact: true })
      .locator("xpath=following-sibling::dd")
      .innerText(),
  );
  expect(shipping).toBeGreaterThan(0);
  await expect(page.getByTestId("checkout-total")).toHaveText(money(160 + shipping));

  // el teléfono no viene del perfil (se registró con correo): se escribe y se normaliza
  await page.getByLabel("Teléfono (WhatsApp)").fill("7123 4567");
  await page.getByRole("button", { name: "Enviar pedido por WhatsApp" }).click();

  await expect(page).toHaveURL(/\/pedido\/MIC-\d{6,}$/, SLOW);
  await expect(page.getByRole("heading", { level: 1, name: "¡Recibimos tu pedido!" })).toBeVisible(
    SLOW,
  );
  const number = page.url().match(/MIC-\d{6,}/)![0];
  const link = page.getByRole("link", { name: "Enviar el pedido por WhatsApp" });
  const href = (await link.getAttribute("href"))!;
  expect(href.startsWith("https://wa.me/")).toBe(true);
  const message = decodeURIComponent(href.split("?text=")[1]!);
  expect(message).toContain(number);
  expect(message).toContain(`2 × ${product.name}`);
  expect(message).toContain(`Total: ${money(160 + shipping)}`);
  expect(message).not.toContain("+59171234567"); // el teléfono propio no viaja en el mensaje
  // se intentó abrir WhatsApp UNA vez con ese mismo enlace
  expect(await opened(page)).toEqual([href]);

  // la base: pedido, stock firme y pago pendiente
  const order = (
    await svcRest(
      "GET",
      `orders?number=eq.${number}&select=id,status,total,contact_phone,payment_method`,
    )
  ).body[0];
  expect(order.status).toBe("pending_payment");
  expect(order.contact_phone).toBe("+59171234567");
  expect(Math.round(order.total * 100)).toBe(Math.round((160 + shipping) * 100));
  expect(await stockOf(product.variantId)).toBe(8);

  // «Mis pedidos»: aparece, y el detalle muestra el seguimiento y el desglose
  await page.goto("/cuenta/pedidos");
  await expect(page.getByRole("link", { name: `Pedido ${number}` })).toBeVisible(SLOW);
  await expect(page.getByText("Pendiente de pago")).toBeVisible();
  await page.getByRole("link", { name: `Pedido ${number}` }).click();
  await expect(page.getByRole("heading", { name: `Pedido ${number}` })).toBeVisible(SLOW);
  await expect(page.getByRole("list", { name: "Seguimiento" })).toContainText("Pedido recibido");
  await expect(page.getByText("Entrega a domicilio")).toBeVisible();

  // cancelar con confirmación: el stock vuelve y el estado cambia
  await page.getByRole("button", { name: "Cancelar el pedido" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sí, cancelar pedido" }).click();
  await expect(page.getByRole("list", { name: "Seguimiento" })).toContainText("Cancelado", SLOW);
  await expect(page.getByRole("button", { name: "Cancelar el pedido" })).toHaveCount(0);
  expect(await stockOf(product.variantId)).toBe(10);
  const after = (await svcRest("GET", `orders?number=eq.${number}&select=status,cancelled_by`))
    .body[0];
  expect(after).toEqual({ status: "cancelled", cancelled_by: "customer" });
});

test("doble clic en «Enviar»: se crea UN solo pedido y se descuenta el stock una vez", async ({
  page,
}) => {
  const product = await makeProduct(50, 6);
  const customer = await makeCustomer();
  await fn(
    "cart",
    { action: "set_item", variant_id: product.variantId, qty: 1 },
    { token: customer.token },
  );
  await signIn(page, customer);
  await openCheckout(page);
  await page.getByLabel("Teléfono (WhatsApp)").fill("71234567");
  const send = page.getByRole("button", { name: "Enviar pedido por WhatsApp" });
  await send.dblclick();
  await expect(page).toHaveURL(/\/pedido\/MIC-\d{6,}$/, SLOW);
  const orders = (await svcRest("GET", `orders?profile_id=eq.${customer.id}&select=id`)).body as {
    id: string;
  }[];
  expect(orders).toHaveLength(1);
  expect(await stockOf(product.variantId)).toBe(5);
  await cancelCreated(customer, orders[0]?.id);
});

test("el stock cambia mientras compra: aviso claro con la línea afectada y NO se crea nada (BR-CHK-04)", async ({
  page,
}) => {
  const product = await makeProduct(60, 5);
  const customer = await makeCustomer();
  await fn(
    "cart",
    { action: "set_item", variant_id: product.variantId, qty: 3 },
    { token: customer.token },
  );
  await signIn(page, customer);
  await openCheckout(page);
  await page.getByLabel("Teléfono (WhatsApp)").fill("71234567");
  // mientras la clienta completaba sus datos, el stock baja a 1
  await svcRpc("apply_stock_change", {
    p_variant_id: product.variantId,
    p_delta: -4,
    p_reason: "adjust",
    p_note: "E2E",
  });
  await page.getByRole("button", { name: "Enviar pedido por WhatsApp" }).click();
  const dialog = page.getByRole("dialog", { name: "Algunos productos ya no están disponibles" });
  await expect(dialog).toBeVisible(SLOW);
  await expect(dialog).toContainText(`${product.name}: solo quedan 1.`);
  await expect(dialog.getByRole("button", { name: /Confirmar/ })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Revisar mi bolsa" })).toHaveAttribute(
    "href",
    "/carrito",
  );
  expect((await svcRest("GET", `orders?profile_id=eq.${customer.id}&select=id`)).body).toHaveLength(
    0,
  );
  expect(await stockOf(product.variantId)).toBe(1);
});

test("contacto incompleto: explica cada campo y lleva el foco al primero, sin llamar al servidor", async ({
  page,
}) => {
  const product = await makeProduct(30, 5);
  const customer = await makeCustomer();
  await fn(
    "cart",
    { action: "set_item", variant_id: product.variantId, qty: 1 },
    { token: customer.token },
  );
  await signIn(page, customer);
  await openCheckout(page);
  await page.getByLabel("Nombre completo").fill("");
  await page.getByRole("button", { name: "Enviar pedido por WhatsApp" }).click();
  await expect(page.getByLabel("Nombre completo")).toBeFocused();
  await expect(page.getByText("Escribe tu nombre.").first()).toBeVisible();
  await expect(page.getByText("Escribe tu teléfono.").first()).toBeVisible();
  expect((await svcRest("GET", `orders?profile_id=eq.${customer.id}&select=id`)).body).toHaveLength(
    0,
  );
});

test("el recojo en tienda no pide dirección y deja el envío en «Sin costo»", async ({ page }) => {
  const methods = await svcRest("GET", "public_shipping_methods?kind=eq.pickup&select=code,name");
  test.skip(
    (methods.body as unknown[]).length === 0,
    "No hay un método de recojo configurado (S8).",
  );
  const product = await makeProduct(70, 5);
  const customer = await makeCustomer();
  await fn(
    "cart",
    { action: "set_item", variant_id: product.variantId, qty: 1 },
    { token: customer.token },
  );
  await signIn(page, customer);
  await openCheckout(page);
  await page.getByRole("radio", { name: new RegExp(methods.body[0].name) }).check();
  await expect(page.getByRole("radio", { name: /Casa/ })).toHaveCount(0);
  await expect(page.getByTestId("checkout-total")).toHaveText(money(70), SLOW);
});

test("accesibilidad AA, CLS y sin desbordes en el checkout", async ({ page }, info) => {
  const product = await makeProduct(80, 6);
  const customer = await makeCustomer();
  await fn(
    "cart",
    { action: "set_item", variant_id: product.variantId, qty: 2 },
    { token: customer.token },
  );
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
      }[]) {
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await signIn(page, customer);
  await openCheckout(page);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  info.annotations.push({ type: "CLS", description: cls.toFixed(4) });
  process.stdout.write(`CLS_CHECKOUT ${info.project.name} ${cls.toFixed(4)}\n`);
  expect(cls).toBeLessThan(0.1);
  // sin desplazamiento horizontal (móvil y escritorio)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  // los objetivos táctiles de los controles principales miden al menos 44 px (móvil)
  if (info.project.name === "mobile") {
    for (const name of [/Entrega a domicilio/, /Pedir por WhatsApp/]) {
      const box = await page
        .getByRole("radio", { name })
        .locator("xpath=ancestor::label")
        .boundingBox();
      expect(box!.height, String(name)).toBeGreaterThanOrEqual(44);
    }
    const button = await page
      .getByRole("button", { name: "Enviar pedido por WhatsApp" })
      .boundingBox();
    expect(button!.height).toBeGreaterThanOrEqual(44);
  }
  // La captura va a la carpeta de resultados de Playwright (portable); con E2E_SHOTS_DIR se guarda donde se pida.
  const shotsDir = process.env.E2E_SHOTS_DIR;
  await page.screenshot({
    path: shotsDir
      ? `${shotsDir.replace(/\/+$/, "")}/checkout-${info.project.name}.png`
      : info.outputPath(`checkout-${info.project.name}.png`),
    fullPage: true,
  });
});

test("lista negra (S-07): contra entrega aparece bloqueada sin decir por qué, y por WhatsApp compra con normalidad", async ({
  page,
}) => {
  const product = await makeProduct(45, 5);
  const customer = await makeCustomer();
  await fn(
    "cart",
    { action: "set_item", variant_id: product.variantId, qty: 1 },
    { token: customer.token },
  );
  await svcRest("PATCH", `profiles?id=eq.${customer.id}`, { blacklisted: true });
  let orderId: string | undefined;
  try {
    await signIn(page, customer);
    await openCheckout(page);
    const cod = page.getByRole("radio", { name: /Efectivo contra entrega/ });
    await expect(cod).toBeDisabled();
    await expect(page.getByText("No disponible para este pedido")).toBeVisible();
    // no se le dice que está en la lista negra
    await expect(page.getByText(/lista negra|bloquead/i)).toHaveCount(0);
    await expect(page.getByRole("radio", { name: /Pedir por WhatsApp/ })).toBeChecked();
    await page.getByLabel("Teléfono (WhatsApp)").fill("71234567");
    await page.getByRole("button", { name: "Enviar pedido por WhatsApp" }).click();
    await expect(page).toHaveURL(/\/pedido\/MIC-\d{6,}$/, SLOW);
    orderId = (await svcRest("GET", `orders?profile_id=eq.${customer.id}&select=id,payment_method`))
      .body[0]?.id;
    expect(orderId).toBeTruthy();
  } finally {
    await svcRest("PATCH", `profiles?id=eq.${customer.id}`, { blacklisted: false });
    await cancelCreated(customer, orderId);
  }
});

test("dirección sin cobertura: lo dice junto a la entrega, no calcula un total y no deja enviar", async ({
  page,
}) => {
  const product = await makeProduct(55, 5);
  const customer = await makeCustomer();
  // una dirección en otra ciudad (Santa Cruz), lejos de cualquier cobertura de ejemplo
  const far = await rest("POST", "addresses", customer.token, {
    profile_id: customer.id,
    label: "Lejos",
    recipient: "Clienta E2E",
    phone_e164: "+59171234567",
    line1: "Av. Lejana 1",
    city: "Santa Cruz",
    country: "BO",
    lat: -17.78,
    lng: -63.18,
  });
  expect(far.status, JSON.stringify(far.body)).toBe(201);
  await fn(
    "cart",
    { action: "set_item", variant_id: product.variantId, qty: 1 },
    { token: customer.token },
  );
  const probe = await fn(
    "checkout",
    {
      action: "preview",
      shipping_method: "delivery",
      address_id: far.body[0].id,
    },
    { token: customer.token },
  );
  test.skip(
    probe.body.checkout?.ok !== false,
    "La cobertura de ejemplo de la nube cubre esa dirección: no hay forma de probar «sin cobertura».",
  );
  await signIn(page, customer);
  await page.goto("/checkout");
  await expect(page.getByRole("heading", { level: 1, name: "Finalizar compra" })).toBeVisible(SLOW);
  // «Casa» (con cobertura) viene elegida; se cambia a la dirección lejana
  await page.getByRole("radio", { name: /Lejos/ }).check();
  await expect(page.getByText("Todavía no entregamos en esa dirección.").first()).toBeVisible(SLOW);
  // sin envío cotizable no hay total honesto
  await expect(page.getByTestId("checkout-total")).toHaveText("—");
  await page.getByLabel("Teléfono (WhatsApp)").fill("71234567");
  await page.getByRole("button", { name: /Enviar pedido por WhatsApp|Confirmar pedido/ }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  expect((await svcRest("GET", `orders?profile_id=eq.${customer.id}&select=id`)).body).toHaveLength(
    0,
  );
  expect(await stockOf(product.variantId)).toBe(5);
});

test("el cupón deja de valer mientras compra: muestra antes y ahora, y al confirmar crea el pedido SIN descuento (BR-CHK-04)", async ({
  page,
}) => {
  const product = await makeProduct(100, 5);
  const customer = await makeCustomer();
  const tag = randomTag().toUpperCase();
  const code = `CU${tag}`;
  const discount = await svcRest("POST", "discounts", {
    name: `E2E cupón vencido ${tag}`,
    kind: "percent",
    params: { percent: 10 },
    requires_coupon: true,
  });
  expect(discount.status, JSON.stringify(discount.body)).toBe(201);
  const discountId = discount.body[0].id as string;
  expect((await svcRest("POST", "coupons", { discount_id: discountId, code })).status).toBe(201);
  await fn(
    "cart",
    { action: "set_item", variant_id: product.variantId, qty: 1 },
    { token: customer.token },
  );
  const set = await fn("cart", { action: "set_coupon", code }, { token: customer.token });
  expect(set.body.outcome, JSON.stringify(set.body)).toBe("coupon_set");
  let orderId: string | undefined;
  try {
    await signIn(page, customer);
    await openCheckout(page);
    const summary = page.getByRole("region", { name: "Resumen" });
    const shipping = parseMoney(
      await summary
        .getByText("Envío", { exact: true })
        .locator("xpath=following-sibling::dd")
        .innerText(),
    );
    await expect(page.getByTestId("checkout-total")).toHaveText(money(100 - 10 + shipping)); // 10 % de 100,00
    await page.getByLabel("Teléfono (WhatsApp)").fill("71234567");

    // mientras completaba el formulario, el administrador apaga el descuento
    expect(
      (await svcRest("PATCH", `discounts?id=eq.${discountId}`, { is_active: false })).status,
    ).toBe(200);

    await page.getByRole("button", { name: "Enviar pedido por WhatsApp" }).click();
    const dialog = page.getByRole("dialog", { name: "Cambió el total de tu pedido" });
    await expect(dialog).toBeVisible(SLOW);
    await expect(dialog.getByText("Antes").locator("xpath=following-sibling::dd")).toHaveText(
      money(90 + shipping),
    );
    await expect(dialog.getByText("Ahora").locator("xpath=following-sibling::dd")).toHaveText(
      money(100 + shipping),
    );
    // nada se creó todavía
    expect(
      (await svcRest("GET", `orders?profile_id=eq.${customer.id}&select=id`)).body,
    ).toHaveLength(0);
    await dialog.getByRole("button", { name: "Confirmar con el nuevo total" }).click();
    await expect(page).toHaveURL(/\/pedido\/MIC-\d{6,}$/, SLOW);
    const order = (
      await svcRest(
        "GET",
        `orders?profile_id=eq.${customer.id}&select=id,total,discount_total,coupon_code`,
      )
    ).body[0];
    orderId = order.id;
    expect(Math.round(order.total * 100)).toBe(Math.round((100 + shipping) * 100));
    expect(Number(order.discount_total)).toBe(0);
    expect(order.coupon_code).toBeNull();
  } finally {
    await cancelCreated(customer, orderId);
    await svcRest("PATCH", `discounts?id=eq.${discountId}`, {
      archived_at: new Date().toISOString(),
    });
  }
});
