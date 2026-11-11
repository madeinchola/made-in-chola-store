import { expect, type Page } from "@playwright/test";
import {
  clearRateLimits,
  fn,
  recoverySession,
  registerAndLogin,
  rest,
  rpc,
  randomTag,
  svcRest,
  svcRpc,
  testEnv,
} from "./api";

/**
 * Ayudas de los E2E de pagos (S11): una clienta con dirección, un producto, entrar al navegador con su sesión, el método de
 * pago «qr_manual» encendido durante la prueba (y restituido al terminar) y, si existe, una cuenta de administración de prueba.
 * Todo contra la nube; nada se borra (los pedidos son inmutables a propósito).
 */
export interface Customer {
  token: string;
  refresh: string;
  id: string;
  addressId: string;
}

export async function makeProduct(price: number, stock: number) {
  const tag = randomTag();
  const product = await svcRest("POST", "products", {
    code: `Q${tag}`.toUpperCase(),
    slug: `e2e-qr-${tag}`,
    name: `Blusa E2E ${tag}`,
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
    p_note: "E2E pagos",
  });
  await svcRest("PATCH", `products?id=eq.${productId}`, { status: "active" });
  return { productId, variantId, name: product.body[0].name as string };
}

export const stockOf = async (variantId: string): Promise<number> =>
  (await svcRest("GET", `product_variants?id=eq.${variantId}&select=stock_on_hand`)).body[0]
    .stock_on_hand as number;

export async function makeCustomer(): Promise<Customer> {
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

/** Entra al navegador con la sesión de esa persona (igual que lo hace el cliente de Supabase). */
export async function signInAs(page: Page, session: { token: string; refresh: string }) {
  const env = testEnv();
  const user = await fetch(`${env.url}/auth/v1/user`, {
    headers: { apikey: env.anon, Authorization: `Bearer ${session.token}` },
  }).then((r) => r.json());
  const ref = new URL(env.url).hostname.split(".")[0];
  const stored = {
    access_token: session.token,
    refresh_token: session.refresh,
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

/** Una cuenta de administración de prueba que YA existe (`@prueba.test`): no se crean. `null` si no hay ninguna. */
export async function adminSession(): Promise<{ token: string; refresh: string } | null> {
  const admins = await svcRest(
    "GET",
    "profiles?role=eq.admin&is_active=eq.true&select=email&limit=20",
  );
  const email = (admins.body as { email: string | null }[])
    .map((r) => r.email)
    .find((e): e is string => !!e && e.endsWith("@prueba.test"));
  if (!email) return null;
  const session = await recoverySession(email);
  return { token: session.access, refresh: session.refresh };
}

export const QR_PATH = "qr/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.png";
export const ACCOUNT = "Banco de prueba · cuenta 000-000 · Chola (prueba)";

/** Enciende el método QR de ejemplo con su imagen y su cuenta; devuelve cómo estaba para dejarlo igual. */
export async function enableQr(): Promise<Record<string, unknown> | null> {
  // La imagen del QR tiene que EXISTIR en el bucket público (un PNG de 1×1 basta): sin ella la pantalla mostraría una imagen rota.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  const env = testEnv();
  const upload = await fetch(`${env.url}/storage/v1/object/payment-qr/${QR_PATH}`, {
    method: "POST",
    headers: {
      apikey: env.service,
      Authorization: `Bearer ${env.service}`,
      "Content-Type": "image/png",
      "x-upsert": "true",
    },
    body: png as unknown as BodyInit,
  });
  expect(upload.status, await upload.text()).toBe(200);
  const before = await svcRest("GET", "payment_methods?country=eq.BO&code=eq.qr_manual&select=*");
  if ((before.body as unknown[]).length === 0) return null;
  const res = await svcRest("PATCH", "payment_methods?country=eq.BO&code=eq.qr_manual", {
    qr_image_path: QR_PATH,
    account_details: ACCOUNT,
    is_active: true,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return before.body[0] as Record<string, unknown>;
}

export async function restoreQr(original: Record<string, unknown> | null) {
  if (!original) return;
  await svcRest("PATCH", "payment_methods?country=eq.BO&code=eq.qr_manual", {
    is_active: original.is_active,
    qr_image_path: original.qr_image_path ?? null,
    account_details: original.account_details ?? null,
    name: original.name,
    description: original.description ?? null,
    window_minutes: original.window_minutes ?? null,
  });
}

export const money = (n: number) => {
  const [int = "0", frac = "00"] = n.toFixed(2).split(".");
  return `Bs ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
};

/** Compra por QR por la API (sin pasar por el formulario): bolsa → vista previa → pedido con el método «qr_manual». */
export async function placeQrOrder(c: Customer, variantId: string, qty = 1) {
  const cart = await fn(
    "cart",
    { action: "set_item", variant_id: variantId, qty },
    { token: c.token },
  );
  expect(cart.status, JSON.stringify(cart.body)).toBe(200);
  const preview = await fn(
    "checkout",
    {
      action: "preview",
      shipping_method: "delivery",
      address_id: c.addressId,
      payment_method: "qr_manual",
    },
    { token: c.token },
  );
  expect(preview.status, JSON.stringify(preview.body)).toBe(200);
  const total = preview.body.checkout.totals.total as number;
  const created = await fn(
    "checkout",
    {
      action: "create",
      shipping_method: "delivery",
      address_id: c.addressId,
      payment_method: "qr_manual",
      contact_name: "Clienta E2E",
      contact_phone: "+59171234567",
      expected_total: total,
      idempotency_key: `k-${randomTag()}-${randomTag()}`,
    },
    { token: c.token },
  );
  expect(created.body.outcome, JSON.stringify(created.body)).toBe("created");
  const orderId = created.body.order.id as string;
  const view = await rpc("customer_payment_view", { p_order_id: orderId }, c.token);
  return {
    orderId,
    number: created.body.order.number as string,
    total,
    paymentId: view.body.payment.id as string,
    reference: view.body.payment.reference as string,
  };
}

/** Un PNG de verdad para el campo de archivo del navegador. */
export const pngFile = (name = "comprobante.png") => ({
  name,
  mimeType: "image/png",
  // Un PNG real de 1×1 (el navegador lo decodifica) con relleno tras el final: cada archivo tiene su propia huella.
  buffer: Buffer.concat([
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    ),
    Buffer.from(`E2E ${Math.random()}`),
  ]),
});
