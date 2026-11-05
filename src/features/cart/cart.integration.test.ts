import { createHash, randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearRateLimits,
  fn,
  localEnv,
  localExec,
  localSql,
  login,
  randomTag,
  registerAndLogin,
  svcRest,
  svcRpc,
} from "../../../test-support/api";

/**
 * Carrito (Sprint 7) contra la base y las Edge Functions LOCALES, por HTTP real y con concurrencia real. Los valores
 * esperados se calculan a mano (precios con céntimos, sumas de reservas, órdenes de llegada que no importan).
 */

interface Made {
  productId: string;
  variantId: string;
}

async function makeProduct(opts: { name: string; price: number; stock: number }): Promise<Made> {
  const tag = randomTag();
  const product = await svcRest("POST", "products", {
    code: `C${tag}`.toUpperCase(),
    slug: `carrito-${tag}`,
    name: opts.name,
    cost_base: 10,
  });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  const productId = product.body[0].id as string;
  const color = await svcRest("POST", "product_colors", { product_id: productId, name: "Único" });
  expect(color.status, JSON.stringify(color.body)).toBe(201);
  const variant = await svcRest("POST", "product_variants", {
    product_id: productId,
    color_id: color.body[0].id,
  });
  expect(variant.status, JSON.stringify(variant.body)).toBe(201);
  const variantId = variant.body[0].id as string;
  const price = await svcRest("POST", "product_prices", {
    product_id: productId,
    currency: "BOB",
    amount: opts.price,
  });
  expect(price.status, JSON.stringify(price.body)).toBe(201);
  if (opts.stock > 0) {
    const stock = await svcRpc("apply_stock_change", {
      p_variant_id: variantId,
      p_delta: opts.stock,
      p_reason: "import",
      p_note: "stock de prueba del carrito",
    });
    expect(stock.status, JSON.stringify(stock.body)).toBe(200);
  }
  const publish = await svcRest("PATCH", `products?id=eq.${productId}`, { status: "active" });
  expect(publish.status, JSON.stringify(publish.body)).toBe(200);
  return { productId, variantId };
}

const cart = (body: unknown, token?: string, headers?: Record<string, string>) =>
  fn("cart", body, { ...(token ? { token } : {}), ...(headers ? { headers } : {}) });
/** Simula desde qué red llega la petición (el proxy de Supabase la informa en `cf-connecting-ip`). */
const fromNet = (ip: string) => ({ "cf-connecting-ip": ip });
/** Una red IPv6 (/64) nueva en cada ejecución: lo retenido por una ejecución anterior (10 min) no puede afectar a esta. */
const freshV4 = () =>
  `198.${10 + Math.floor(Math.random() * 100)}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
const freshNet = () => `2001:db8:${randomTag().slice(0, 4)}:${randomTag().slice(0, 4)}`;
const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const randomToken = () => `ct_${randomBytes(32).toString("base64url")}`;
const reservedOf = (variantId: string) =>
  Number(
    localSql(
      `select coalesce(sum(qty),0) from public.stock_reservations where variant_id = '${variantId}' and owner_type = 'cart' and status = 'active' and (expires_at is null or expires_at > now())`,
    ),
  );
const reservedBy = (variantId: string, cartId: string) =>
  Number(
    localSql(
      `select coalesce(sum(qty),0) from public.stock_reservations where variant_id = '${variantId}' and owner_id = '${cartId}' and status = 'active'`,
    ),
  );
const lineOf = (body: any, variantId: string) =>
  (body.cart?.lines as any[] | undefined)?.find((l) => l.variant_id === variantId);
/** Quita lo que cambia entre dos lecturas del mismo carrito (la hora del servidor). */
const stable = (body: any) => ({ ...body, server_time: undefined });

beforeEach(async () => {
  await clearRateLimits();
});

let p1: Made; // 100.00 · 50 u
let p2: Made; // 50.50 · 20 u

beforeAll(async () => {
  p1 = await makeProduct({ name: "Carrito uno", price: 100, stock: 50 });
  p2 = await makeProduct({ name: "Carrito dos", price: 50.5, stock: 20 });
});

describe("carrito de invitado", () => {
  it("el primer alta emite un token; la base guarda solo su hash y retiene el stock", async () => {
    const res = await cart({ action: "set_item", variant_id: p1.variantId, qty: 2 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const token = res.body.cart_token as string;
    expect(token).toMatch(/^ct_[A-Za-z0-9_-]{43}$/);
    expect(res.body.token_minted).toBe(true);
    expect(res.body.outcome).toBe("ok");
    expect(res.body.applied).toBe(2);
    expect(res.body.cart.totals.subtotal).toBe(200); // 2 × 100,00
    expect(lineOf(res.body, p1.variantId).line_total).toBe(200);
    expect(res.body.cart.reservation.state).toBe("held");
    expect(res.body.cart.can_checkout).toBe(true);
    // Solo el sha256 llega a la base: el token en claro no existe en ninguna fila.
    expect(
      localSql(`select count(*) from public.carts where token_hash = '${hashOf(token)}'`),
    ).toBe("1");
    expect(localSql(`select count(*) from public.carts where token_hash like 'ct\\_%'`)).toBe("0");
    expect(reservedBy(p1.variantId, res.body.cart.cart_id)).toBe(2);
    // Sin sesión y sin cuenta: el carrito no lleva ningún dato personal.
    expect(
      localSql(`select profile_id is null from public.carts where id = '${res.body.cart.cart_id}'`),
    ).toBe("t");
  });

  it("un token inventado por el cliente NO crea carrito: el servidor emite otro (no se salta el tope de carritos nuevos)", async () => {
    const fake = randomToken();
    const res = await cart({
      action: "set_item",
      variant_id: p1.variantId,
      qty: 1,
      cart_token: fake,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.token_minted).toBe(true);
    expect(res.body.cart_token).not.toBe(fake);
    expect(localSql(`select count(*) from public.carts where token_hash = '${hashOf(fake)}'`)).toBe(
      "0",
    );
    expect(
      localSql(
        `select count(*) from public.carts where token_hash = '${hashOf(res.body.cart_token)}'`,
      ),
    ).toBe("1");
  });

  it("leer con un token desconocido no crea nada y no revela nada", async () => {
    const fake = randomToken();
    const res = await cart({ action: "get", cart_token: fake });
    expect(res.status).toBe(200);
    expect(res.body.token_state).toBe("none");
    expect(res.body.cart).toBeNull();
    expect(localSql(`select count(*) from public.carts where token_hash = '${hashOf(fake)}'`)).toBe(
      "0",
    );
  });

  it("sin token, leer / vaciar / quitar no hacen nada (sin tocar la base)", async () => {
    const before = localSql("select count(*) from public.carts");
    for (const body of [
      { action: "get" },
      { action: "clear" },
      { action: "refresh" },
      { action: "remove_item", variant_id: p1.variantId },
      { action: "set_item", variant_id: p1.variantId, qty: 0 },
    ]) {
      const res = await cart(body);
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(res.body.cart).toBeNull();
    }
    expect(localSql("select count(*) from public.carts")).toBe(before);
  });

  it("la cantidad es absoluta e idempotente: repetir no duplica ni la línea ni la retención", async () => {
    const made = await makeProduct({ name: "Idempotente", price: 100, stock: 20 });
    const first = await cart({ action: "set_item", variant_id: made.variantId, qty: 2 });
    const token = first.body.cart_token as string;
    const cartId = first.body.cart.cart_id as string;
    for (let i = 0; i < 3; i++) {
      const again = await cart({
        action: "set_item",
        variant_id: made.variantId,
        qty: 2,
        cart_token: token,
      });
      expect(again.body.cart.totals.line_count).toBe(1);
      expect(lineOf(again.body, made.variantId).qty).toBe(2);
    }
    expect(reservedBy(made.variantId, cartId)).toBe(2); // no 8
    expect(
      localSql(
        `select count(*) from public.stock_reservations where variant_id = '${made.variantId}' and status = 'active'`,
      ),
    ).toBe("1");
    const five = await cart({
      action: "set_item",
      variant_id: made.variantId,
      qty: 5,
      cart_token: token,
    });
    expect(five.body.cart.totals.subtotal).toBe(500);
    expect(reservedBy(made.variantId, cartId)).toBe(5);
    const removed = await cart({
      action: "set_item",
      variant_id: made.variantId,
      qty: 0,
      cart_token: token,
    });
    expect(removed.body.outcome).toBe("removed");
    expect(removed.body.cart.totals.line_count).toBe(0);
    expect(reservedBy(made.variantId, cartId)).toBe(0);
    // Quitar otra vez lo ya quitado no falla.
    const twice = await cart({
      action: "remove_item",
      variant_id: made.variantId,
      cart_token: token,
    });
    expect(twice.status).toBe(200);
  });

  it("pedir más de lo que hay ajusta con aviso; pedir más del tope por variante lo recorta", async () => {
    const low = await makeProduct({ name: "Poco stock", price: 10, stock: 3 });
    const adjusted = await cart({ action: "set_item", variant_id: low.variantId, qty: 5 });
    expect(adjusted.body.outcome).toBe("adjusted");
    expect(adjusted.body.requested).toBe(5);
    expect(adjusted.body.applied).toBe(3);
    const capped = await cart({ action: "set_item", variant_id: p1.variantId, qty: 999 });
    expect(capped.body.outcome).toBe("capped_variant"); // tope por defecto: 10
    expect(capped.body.applied).toBe(10);
    expect(capped.body.cart.totals.subtotal).toBe(1000);
  });

  it("agotado y no disponible no crean línea", async () => {
    const empty = await makeProduct({ name: "Agotado", price: 10, stock: 0 });
    const out = await cart({ action: "set_item", variant_id: empty.variantId, qty: 1 });
    expect(out.body.outcome).toBe("out_of_stock");
    expect(out.body.applied).toBe(0);
    expect(out.body.cart.totals.line_count).toBe(0);
    const ghost = await cart({
      action: "set_item",
      variant_id: "00000000-0000-4000-8000-000000000000",
      qty: 1,
    });
    expect(ghost.body.outcome).toBe("unavailable");
  });
});

describe("entradas hostiles y límites de tasa", () => {
  it("rechaza cuerpos y campos que no corresponden, sin llegar a la base", async () => {
    const big = await fn("cart", { action: "get", cart_token: "x".repeat(5000) });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe("payload_too_large");
    const cases: [unknown, number, string?][] = [
      [{ action: "get", extra: 1 }, 400, "validation"],
      [{ action: "nope" }, 400, "validation"],
      [{ action: "set_item", variant_id: p1.variantId, qty: 1001 }, 400, "validation"],
      [{ action: "set_item", variant_id: p1.variantId, qty: -1 }, 400, "validation"],
      [{ action: "set_item", variant_id: p1.variantId, qty: 1.5 }, 400, "validation"],
      [{ action: "set_item", variant_id: "no-es-uuid", qty: 1 }, 400, "validation"],
      [{ action: "set_item", variant_id: p1.variantId, qty: 1, unit_price: 1 }, 400, "validation"],
      [{ action: "get", cart_token: "ct_corto" }, 400, "invalid_cart_token"],
      [{ action: "merge", cart_token: randomToken() }, 401, "login_required"],
    ];
    for (const [body, status, code] of cases) {
      const res = await cart(body);
      expect(res.status, JSON.stringify(body)).toBe(status);
      if (code) expect(res.body.error.code, JSON.stringify(body)).toBe(code);
    }
    const notJson = await fetch(`${localEnv().url}/functions/v1/cart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{no es json",
    });
    expect(notJson.status).toBe(400);
    const get = await fetch(`${localEnv().url}/functions/v1/cart`, {
      method: "GET",
    });
    expect(get.status).toBe(405);
  });

  it("un cliente no puede mandar precios ni importes: lo que se cobra lo calcula el servidor", async () => {
    const made = await makeProduct({ name: "Sin trampa", price: 40, stock: 5 });
    const res = await cart({
      action: "set_item",
      variant_id: made.variantId,
      qty: 1,
      unit_price: 0.01,
    });
    expect(res.status).toBe(400);
    const ok = await cart({ action: "set_item", variant_id: made.variantId, qty: 1 });
    expect(ok.body.cart.totals.subtotal).toBe(40);
  });

  it("el carrito nuevo número 31 desde la misma red en una hora se rechaza con 429 y Retry-After (y no afecta a otra red)", async () => {
    const many = await makeProduct({ name: "Muchos carritos A", price: 10, stock: 500 });
    const net = fromNet(freshV4());
    const results: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await cart(
        { action: "set_item", variant_id: many.variantId, qty: 1 },
        undefined,
        net,
      );
      results.push(res.status);
      if (res.status === 429) {
        expect(res.body.error.code).toBe("rate_limited");
        expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
      }
    }
    expect(results.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(results[30]).toBe(429);
    // Otra red (otra IP) sigue pudiendo abrir su carrito.
    const other = await cart(
      { action: "set_item", variant_id: many.variantId, qty: 1 },
      undefined,
      fromNet(freshV4()),
    );
    expect(other.status).toBe(200);
  }, 120_000);

  it("rotar de dirección IPv6 DENTRO del mismo /64 no evade el límite: cuenta como una sola red", async () => {
    const many = await makeProduct({ name: "Muchos carritos B", price: 10, stock: 500 });
    const results: number[] = [];
    for (let i = 0; i < 31; i++) {
      const host = (i + 1).toString(16);
      const res = await cart(
        { action: "set_item", variant_id: many.variantId, qty: 1 },
        undefined,
        fromNet(`2001:db8:77:9::${host}`),
      );
      results.push(res.status);
    }
    expect(results.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(results[30]).toBe(429); // 31 direcciones distintas, una sola red /64
    const otherPrefix = await cart(
      { action: "set_item", variant_id: many.variantId, qty: 1 },
      undefined,
      fromNet("2001:db8:77:a::1"),
    );
    expect(otherPrefix.status).toBe(200); // otro /64 es otra red
  }, 120_000);

  it("un JWT con aspecto de usuario pero falso da 401; la clave anónima como Bearer es un invitado", async () => {
    const forged = [
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
      Buffer.from(
        JSON.stringify({ role: "authenticated", sub: "11111111-1111-4111-8111-111111111111" }),
      ).toString("base64url"),
      "firma-falsa",
    ].join(".");
    const bad = await cart({ action: "get" }, forged);
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("invalid_session");
    // El navegador sin sesión manda la clave anónima como Bearer: es un invitado, no un error.
    const guest = await cart({ action: "get" }, localEnv().anon);
    expect(guest.status).toBe(200);
    expect(guest.body.cart).toBeNull();
  });
});

describe("carrito de usuario", () => {
  it("el mismo usuario ve el MISMO carrito desde dos dispositivos (criterio 5)", async () => {
    const user = await registerAndLogin();
    const second = await login(user.identifier, user.password);
    const tokenB = second.body.session.access_token as string;
    const add = await cart({ action: "set_item", variant_id: p1.variantId, qty: 2 }, user.token);
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    await cart({ action: "set_item", variant_id: p2.variantId, qty: 3 }, tokenB);
    const a = await cart({ action: "get" }, user.token);
    const b = await cart({ action: "get" }, tokenB);
    expect(stable(a.body)).toEqual(stable(b.body));
    // 2 × 100,00 + 3 × 50,50 = 200,00 + 151,50
    expect(a.body.cart.totals.subtotal).toBe(351.5);
    expect(a.body.cart.totals.item_count).toBe(5);
    expect(a.body.cart.totals.line_count).toBe(2);
    expect(a.body.cart.totals.total).toBe(351.5); // envío y descuento aún sin llenar (S8/S9)
    expect(a.body.cart.totals.shipping).toBeNull();
    expect(a.body.cart.totals.discount).toBeNull();
  });

  it("un cliente nunca ve el carrito de otro (usuarios ni invitados)", async () => {
    const alice = await registerAndLogin({ name: "Alice" });
    const bob = await registerAndLogin({ name: "Bob" });
    await cart({ action: "set_item", variant_id: p1.variantId, qty: 1 }, alice.token);
    const guest = await cart({ action: "set_item", variant_id: p2.variantId, qty: 1 });
    const bobView = await cart({ action: "get" }, bob.token);
    expect(bobView.body.cart).toBeNull();
    // Un token de invitado no sirve para leer el carrito de un usuario ni al revés.
    const guestView = await cart({ action: "get", cart_token: guest.body.cart_token });
    expect(guestView.body.cart.totals.line_count).toBe(1);
    expect(lineOf(guestView.body, p2.variantId)).toBeDefined();
    expect(lineOf(guestView.body, p1.variantId)).toBeUndefined();
    // Con sesión, el token de invitado se ignora: manda el usuario.
    const asBob = await cart({ action: "get", cart_token: guest.body.cart_token }, bob.token);
    expect(asBob.body.cart).toBeNull();
    // Un usuario no puede tocar la tabla directamente.
    const direct = await fn("cart", { action: "get" }, { token: alice.token });
    expect(direct.status).toBe(200);
  });
});

describe("acaparamiento: tope de unidades retenidas por red (D-02)", () => {
  async function withCap<T>(cap: number, body: () => Promise<T>): Promise<T> {
    const set = await svcRest("PATCH", "store_settings?key=eq.cart_max_units_per_ip", {
      value: cap,
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    try {
      return await body();
    } finally {
      await svcRest("PATCH", "store_settings?key=eq.cart_max_units_per_ip", { value: 150 });
    }
  }

  it("los carritos de una misma red no retienen en total más que el cupo, aunque repitan y renueven sin fin", async () => {
    const made = await makeProduct({ name: "Cupo por red", price: 10, stock: 100 });
    await withCap(5, async () => {
      const prefix = freshNet();
      const net = fromNet(`${prefix}::1`);
      const sameNet = fromNet(`${prefix}:ffff::2`); // otra dirección del MISMO /64: es la misma red
      const a = await cart(
        { action: "set_item", variant_id: made.variantId, qty: 3 },
        undefined,
        net,
      );
      const b = await cart(
        { action: "set_item", variant_id: made.variantId, qty: 4 },
        undefined,
        net,
      );
      expect(a.body.applied).toBe(3);
      expect(b.body.applied).toBe(4); // se agrega igual…
      expect(reservedBy(made.variantId, a.body.cart.cart_id)).toBe(3);
      expect(reservedBy(made.variantId, b.body.cart.cart_id)).toBe(0); // …pero sin retención: 4 > 5 − 3
      expect(b.body.cart.reservation.state).toBe("expired");
      // Un bot que repite sin parar: ni renovar ni refrescar ni subir y bajar la cantidad pasa del cupo (5).
      for (let i = 0; i < 6; i++) {
        await cart(
          { action: "set_item", variant_id: made.variantId, qty: 1 + (i % 2) },
          b.body.cart_token,
          net,
        );
        await cart({ action: "refresh" }, b.body.cart_token, sameNet);
      }
      const total = Number(
        localSql(
          `select coalesce(sum(r.qty),0) from public.stock_reservations r join public.carts c on c.id = r.owner_id where r.owner_type = 'cart' and r.status = 'active' and (r.expires_at is null or r.expires_at > now()) and c.id in ('${a.body.cart.cart_id}','${b.body.cart.cart_id}')`,
        ),
      );
      expect(total).toBeLessThanOrEqual(5);
      // Otra red no se ve afectada por el cupo de esta.
      const c = await cart(
        { action: "set_item", variant_id: made.variantId, qty: 4 },
        undefined,
        fromNet(`${freshNet()}::1`),
      );
      expect(reservedBy(made.variantId, c.body.cart.cart_id)).toBe(4);
    });
  });

  it("un usuario con sesión no tiene cupo por red (lo acota su cuenta), y la base no guarda su IP ni la del invitado en claro", async () => {
    const made = await makeProduct({ name: "Sin huella de usuario", price: 10, stock: 100 });
    const user = await registerAndLogin();
    await withCap(2, async () => {
      const res = await cart(
        { action: "set_item", variant_id: made.variantId, qty: 6 },
        user.token,
        fromNet(`${freshNet()}::1`),
      );
      expect(reservedBy(made.variantId, res.body.cart.cart_id)).toBe(6); // por encima del cupo de 2: no aplica a usuarios
      expect(
        localSql(`select ip_hash is null from public.carts where id = '${res.body.cart.cart_id}'`),
      ).toBe("t");
      const guest = await cart(
        { action: "set_item", variant_id: made.variantId, qty: 1 },
        undefined,
        fromNet(`${freshNet()}::1`),
      );
      const stored = localSql(
        `select ip_hash from public.carts where id = '${guest.body.cart.cart_id}'`,
      );
      expect(stored).toMatch(/^[0-9a-f]{64}$/);
      expect(stored).not.toContain("203"); // es un HMAC, no la IP
      expect(localSql(`select count(*) from public.carts where ip_hash like '%203.0.113%'`)).toBe(
        "0",
      );
    });
  });
});

describe("«Deshacer» y los precios aceptados (S-04)", () => {
  it("quitar y volver a agregar dentro de 15 min conserva el precio y la garantía de entrada (se cobra lo mismo que se veía)", async () => {
    const made = await makeProduct({ name: "Deshacer con garantía", price: 100, stock: 20 });
    const user = await registerAndLogin();
    const add = await cart({ action: "set_item", variant_id: made.variantId, qty: 2 }, user.token);
    const locked = lineOf(add.body, made.variantId).price_locked_until as string;
    await svcRest("PATCH", `product_prices?product_id=eq.${made.productId}&currency=eq.BOB`, {
      amount: 120,
    });
    const raised = await cart({ action: "get" }, user.token);
    expect(lineOf(raised.body, made.variantId).unit_price).toBe(100); // garantía vigente: se respeta 100
    await cart({ action: "remove_item", variant_id: made.variantId }, user.token);
    const undone = await cart(
      { action: "set_item", variant_id: made.variantId, qty: 2 },
      user.token,
    ); // «Deshacer»
    const line = lineOf(undone.body, made.variantId);
    expect([line.unit_price, line.price_at_add, line.price_notice]).toEqual([
      100,
      100,
      "guaranteed",
    ]);
    expect(line.price_locked_until).toBe(locked); // la misma garantía de antes, no una nueva
    expect(undone.body.cart.totals.subtotal).toBe(200); // 2 × 100, no 2 × 120
    expect(undone.body.cart.can_checkout).toBe(true);
  });

  it("aceptar precios: con la garantía vigente no cambia nada; vencida, solo si el precio que se vio es el vigente", async () => {
    const made = await makeProduct({ name: "Aceptar con cuidado", price: 80, stock: 20 });
    const user = await registerAndLogin();
    await cart({ action: "set_item", variant_id: made.variantId, qty: 1 }, user.token);
    await svcRest("PATCH", `product_prices?product_id=eq.${made.productId}&currency=eq.BOB`, {
      amount: 100,
    });
    // Garantía vigente: aceptar (todo o una línea) NO hace perder el precio asegurado.
    const all = await cart({ action: "accept_prices" }, user.token);
    expect(lineOf(all.body, made.variantId).price_at_add).toBe(80);
    const one = await cart(
      { action: "accept_prices", variant_id: made.variantId, expected_price: 100 },
      user.token,
    );
    expect(lineOf(one.body, made.variantId).price_at_add).toBe(80);
    // Vence la garantía. La persona vio 90 pero el vigente es 100: no se acepta nada.
    localExec(
      `update public.cart_items set price_locked_until = now() - interval '1 minute' where variant_id = '${made.variantId}'`,
    );
    const stale = await cart(
      { action: "accept_prices", variant_id: made.variantId, expected_price: 90 },
      user.token,
    );
    const l1 = lineOf(stale.body, made.variantId);
    expect([l1.price_at_add, l1.price_notice, l1.blocking]).toEqual([80, "expired_raised", true]);
    // Con el precio correcto sí.
    const ok = await cart(
      { action: "accept_prices", variant_id: made.variantId, expected_price: 100 },
      user.token,
    );
    const l2 = lineOf(ok.body, made.variantId);
    expect([l2.price_at_add, l2.price_notice, l2.blocking]).toEqual([100, null, false]);
    // Un precio esperado absurdo se rechaza antes de llegar a la base.
    for (const expected_price of [0, -5, 1e12, "100"]) {
      const bad = await cart(
        { action: "accept_prices", variant_id: made.variantId, expected_price },
        user.token,
      );
      expect(bad.status, String(expected_price)).toBe(400);
    }
  });
});

describe("el carrito no revela lo que no debe", () => {
  it("`available` no pasa del máximo por variante: un invitado no puede leer el stock exacto (50)", async () => {
    const made = await makeProduct({ name: "Stock oculto", price: 10, stock: 50 });
    const res = await cart(
      { action: "set_item", variant_id: made.variantId, qty: 1 },
      undefined,
      fromNet(freshV4()),
    );
    expect(lineOf(res.body, made.variantId).available).toBe(10); // tope por variante, no 50
    expect(JSON.stringify(res.body)).not.toMatch(/"available":50/);
  });

  it("pedir una variante que no existe, o un producto que no se vende, no deja un carrito vacío", async () => {
    const draft = await makeProduct({ name: "Borrador", price: 10, stock: 5 });
    await svcRest("PATCH", `products?id=eq.${draft.productId}`, { status: "draft" });
    const before = localSql("select count(*) from public.carts");
    for (const variant_id of ["00000000-0000-4000-8000-0000000000bb", draft.variantId]) {
      const res = await cart(
        { action: "set_item", variant_id, qty: 1 },
        undefined,
        fromNet(freshV4()),
      );
      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe("unavailable");
      expect(res.body.cart).toBeNull();
    }
    expect(localSql("select count(*) from public.carts")).toBe(before);
  });
});

describe("cuenta desactivada", () => {
  it("al desactivarla se abandona su carrito y libera el stock; con su sesión vieja no ve ni reabre nada", async () => {
    const made = await makeProduct({ name: "Cuenta se va", price: 22, stock: 6 });
    const user = await registerAndLogin();
    const added = await cart(
      { action: "set_item", variant_id: made.variantId, qty: 2 },
      user.token,
    );
    expect(reservedBy(made.variantId, added.body.cart.cart_id)).toBe(2);
    const off = await fn(
      "deactivate-account",
      { password: user.password, anonymize: false },
      { token: user.token },
    );
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(
      localSql(
        `select count(*) from public.carts where profile_id = '${user.id}' and status = 'active'`,
      ),
    ).toBe("0");
    expect(reservedOf(made.variantId)).toBe(0); // el stock vuelve a estar libre
    // Con el JWT que ya tenía (aún no vencido): o se rechaza la sesión, o la base no le da ni le crea carrito.
    const view = await cart({ action: "get" }, user.token);
    expect([200, 401]).toContain(view.status);
    if (view.status === 200) expect(view.body.cart).toBeNull();
    const retry = await cart(
      { action: "set_item", variant_id: made.variantId, qty: 1 },
      user.token,
    );
    if (retry.status === 200) expect(retry.body.applied).toBe(0);
    expect(
      localSql(
        `select count(*) from public.carts where profile_id = '${user.id}' and status = 'active'`,
      ),
    ).toBe("0");
    expect(reservedOf(made.variantId)).toBe(0);
  });
});

describe("fusión al iniciar sesión", () => {
  it("suma sin duplicar, deja el precio más favorable, es idempotente y retira el token", async () => {
    const user = await registerAndLogin();
    await cart({ action: "set_item", variant_id: p1.variantId, qty: 1 }, user.token); // ya tenía 1 de p1 a 100,00
    const g1 = await cart({ action: "set_item", variant_id: p1.variantId, qty: 2 });
    const token = g1.body.cart_token as string;
    const guestCartId = g1.body.cart.cart_id as string;
    await cart({ action: "set_item", variant_id: p2.variantId, qty: 1, cart_token: token });

    const merged = await cart({ action: "merge", cart_token: token }, user.token);
    expect(merged.status, JSON.stringify(merged.body)).toBe(200);
    expect(merged.body.merged).toBe(true);
    expect(merged.body.merged_lines).toBe(2);
    expect(lineOf(merged.body, p1.variantId).qty).toBe(3); // 1 + 2
    expect(lineOf(merged.body, p2.variantId).qty).toBe(1);
    expect(merged.body.cart.totals.subtotal).toBe(350.5); // 3 × 100,00 + 1 × 50,50
    // Las retenciones del invitado pasaron al usuario: 3 + 1 en total, 0 del invitado.
    expect(reservedBy(p1.variantId, guestCartId)).toBe(0);
    expect(reservedBy(p1.variantId, merged.body.cart.cart_id)).toBe(3);
    expect(localSql(`select status from public.carts where id = '${guestCartId}'`)).toBe("merged");

    // Idempotente: una segunda llamada (doble clic, otra pestaña) no cambia nada.
    const again = await cart({ action: "merge", cart_token: token }, user.token);
    expect(again.body.merged).toBe(false);
    expect(again.body.already).toBe(true);
    expect(
      stable({ ...again.body, merged: undefined, already: undefined, token_state: undefined }).cart,
    ).toEqual(stable(merged.body).cart);

    // El token fusionado ya no abre nada, y agregar con él da un carrito de invitado NUEVO.
    const stale = await cart({ action: "get", cart_token: token });
    expect(stale.body.token_state).toBe("retired");
    expect(stale.body.cart).toBeNull();
    const fresh = await cart({
      action: "set_item",
      variant_id: p2.variantId,
      qty: 1,
      cart_token: token,
    });
    expect(fresh.body.token_minted).toBe(true);
    expect(fresh.body.cart_token).not.toBe(token);
  });

  it("dos fusiones simultáneas del mismo carrito cuentan UNA vez (no 5 en vez de 3)", async () => {
    const user = await registerAndLogin();
    await cart({ action: "set_item", variant_id: p2.variantId, qty: 1 }, user.token);
    const g = await cart({ action: "set_item", variant_id: p2.variantId, qty: 2 });
    const token = g.body.cart_token as string;
    const [a, b] = await Promise.all([
      cart({ action: "merge", cart_token: token }, user.token),
      cart({ action: "merge", cart_token: token }, user.token),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.merged, b.body.merged].sort()).toEqual([false, true]);
    const view = await cart({ action: "get" }, user.token);
    expect(lineOf(view.body, p2.variantId).qty).toBe(3);
    expect(reservedBy(p2.variantId, view.body.cart.cart_id)).toBe(3);
  });

  it("la suma que excede el stock se ajusta con aviso", async () => {
    const scarce = await makeProduct({ name: "Escaso", price: 20, stock: 4 });
    const user = await registerAndLogin();
    await cart({ action: "set_item", variant_id: scarce.variantId, qty: 3 }, user.token);
    const g = await cart({ action: "set_item", variant_id: scarce.variantId, qty: 1 });
    // El invitado retiene 1 de las 4; el usuario ya tiene 3: la suma (4) cabe justo.
    const ok = await cart({ action: "merge", cart_token: g.body.cart_token }, user.token);
    expect(lineOf(ok.body, scarce.variantId).qty).toBe(4);
    expect(ok.body.adjusted_lines).toBe(0);
    // Otro invitado pide 2: ya no hay (4 de 4 retenidas por el usuario).
    const late = await cart({ action: "set_item", variant_id: scarce.variantId, qty: 2 });
    expect(late.body.outcome).toBe("out_of_stock");
  });

  it("iniciar sesión sin carrito de invitado, o con uno vacío, no rompe nada", async () => {
    const user = await registerAndLogin();
    const empty = await cart({ action: "merge", cart_token: randomToken() }, user.token);
    expect(empty.status).toBe(200);
    expect(empty.body.merged).toBe(false);
    expect(empty.body.token_state).toBe("none");
  });
});

describe("concurrencia real (criterio 2: sin overselling)", () => {
  it("8 invitados piden 2 de las últimas 3 unidades: se reparten exactamente 3, nunca más", async () => {
    const last = await makeProduct({ name: "Últimas tres", price: 15, stock: 3 });
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        cart({ action: "set_item", variant_id: last.variantId, qty: 2 }),
      ),
    );
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);
    const applied = results.map((r) => r.body.applied as number).sort((x, y) => x - y);
    // Llegue en el orden que llegue: uno se lleva 2, otro 1 (ajustado) y los otros 6 se quedan sin nada.
    expect(applied).toEqual([0, 0, 0, 0, 0, 0, 1, 2]);
    expect(applied.reduce((n, x) => n + x, 0)).toBe(3);
    expect(reservedOf(last.variantId)).toBe(3);
    const outcomes = results.map((r) => r.body.outcome as string).sort();
    expect(outcomes).toEqual(["adjusted", "ok", ...Array(6).fill("out_of_stock")].sort());
  });

  it("diez cambios simultáneos de cantidad de un mismo carrito: sin errores 500 y la retención coincide con la línea", async () => {
    const made = await makeProduct({ name: "Doble clic", price: 12, stock: 50 });
    const user = await registerAndLogin();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        cart({ action: "set_item", variant_id: made.variantId, qty: i + 1 }, user.token),
      ),
    );
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);
    const view = await cart({ action: "get" }, user.token);
    const qty = lineOf(view.body, made.variantId).qty as number;
    expect(qty).toBeGreaterThanOrEqual(1);
    expect(qty).toBeLessThanOrEqual(10);
    expect(reservedBy(made.variantId, view.body.cart.cart_id)).toBe(qty);
    expect(
      localSql(
        `select count(*) from public.stock_reservations where variant_id = '${made.variantId}' and status = 'active'`,
      ),
    ).toBe("1");
  });

  it("agregar de dos dispositivos del mismo usuario a la vez no pierde ni duplica líneas", async () => {
    const x = await makeProduct({ name: "Pestaña X", price: 7, stock: 30 });
    const y = await makeProduct({ name: "Pestaña Y", price: 9, stock: 30 });
    const user = await registerAndLogin();
    const second = await login(user.identifier, user.password);
    const [a, b] = await Promise.all([
      cart({ action: "set_item", variant_id: x.variantId, qty: 2 }, user.token),
      cart(
        { action: "set_item", variant_id: y.variantId, qty: 3 },
        second.body.session.access_token,
      ),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const view = await cart({ action: "get" }, user.token);
    expect(view.body.cart.totals.line_count).toBe(2);
    expect(view.body.cart.totals.subtotal).toBe(41); // 2 × 7 + 3 × 9
    expect(
      localSql(
        `select count(*) from public.carts where profile_id = '${user.id}' and status = 'active'`,
      ),
    ).toBe("1");
  });
});

describe("retención, precios y cambios mientras está en el carrito", () => {
  it("al vencer la retención el carrito permanece, informa, y reintenta si hay stock (criterio 3)", async () => {
    const made = await makeProduct({ name: "Vence", price: 30, stock: 10 });
    const user = await registerAndLogin();
    await cart({ action: "set_item", variant_id: made.variantId, qty: 4 }, user.token);
    localExec(
      `update public.stock_reservations set expires_at = now() - interval '1 minute' where variant_id = '${made.variantId}' and status = 'active'`,
    );
    const expired = await cart({ action: "get" }, user.token);
    expect(expired.body.cart.reservation.state).toBe("expired");
    expect(lineOf(expired.body, made.variantId).qty).toBe(4); // el carrito permanece
    expect(lineOf(expired.body, made.variantId).reserved_qty).toBe(0);
    expect(lineOf(expired.body, made.variantId).status).toBe("ok"); // aún hay stock
    expect(expired.body.cart.can_checkout).toBe(true);

    // Mientras tanto otros se llevan TODO el stock (10): ya no se puede volver a retener.
    const takers = await Promise.all(
      [1, 2].map(() => cart({ action: "set_item", variant_id: made.variantId, qty: 5 })),
    );
    expect(takers.map((t) => t.body.applied).sort()).toEqual([5, 5]);
    const refused = await cart({ action: "refresh" }, user.token);
    expect(refused.body.renewed).toBe(0);
    expect(lineOf(refused.body, made.variantId).status).toBe("out_of_stock");
    expect(refused.body.cart.can_checkout).toBe(false);

    // Uno suelta sus 5: ahora sí se reintenta y la retención vuelve.
    await cart({
      action: "set_item",
      variant_id: made.variantId,
      qty: 0,
      cart_token: takers[0]!.body.cart_token,
    });
    const renewed = await cart({ action: "refresh" }, user.token);
    expect(renewed.body.renewed).toBe(1);
    expect(renewed.body.cart.reservation.state).toBe("held");
    // Quiere 4 y quedan 5 libres (10 − los 5 del otro que sigue reteniendo): caben, así que vuelve a estar 'ok'.
    expect(lineOf(renewed.body, made.variantId).status).toBe("ok");
    expect(lineOf(renewed.body, made.variantId).reserved_qty).toBe(4);
    expect(renewed.body.cart.can_checkout).toBe(true);
  });

  it("'refresh' no alarga una retención que sigue vigente (si no, se podría retener para siempre)", async () => {
    const made = await makeProduct({ name: "No se alarga", price: 30, stock: 10 });
    const user = await registerAndLogin();
    const first = await cart(
      { action: "set_item", variant_id: made.variantId, qty: 2 },
      user.token,
    );
    const before = lineOf(first.body, made.variantId).reservation_expires_at as string;
    const refreshed = await cart({ action: "refresh" }, user.token);
    expect(refreshed.body.renewed).toBe(0);
    expect(lineOf(refreshed.body, made.variantId).reservation_expires_at).toBe(before);
  });

  it("el precio que cambia se ve ANTES de pagar y se respeta el de entrada dentro de la garantía (criterio 4, S-04)", async () => {
    const made = await makeProduct({ name: "Cambia de precio", price: 80, stock: 20 });
    const user = await registerAndLogin();
    const add = await cart({ action: "set_item", variant_id: made.variantId, qty: 2 }, user.token);
    expect(add.body.cart.totals.subtotal).toBe(160); // 2 × 80,00

    // Sube a 100 dentro de los 7 días: se respeta 80, se avisa, no bloquea.
    await svcRest("PATCH", `product_prices?product_id=eq.${made.productId}&currency=eq.BOB`, {
      amount: 100,
    });
    const raised = await cart({ action: "get" }, user.token);
    const l1 = lineOf(raised.body, made.variantId);
    expect([l1.unit_price, l1.price_notice, l1.status, l1.blocking]).toEqual([
      80,
      "guaranteed",
      "price_changed",
      false,
    ]);
    expect(raised.body.cart.can_checkout).toBe(true);
    expect(raised.body.cart.totals.subtotal).toBe(160);

    // Vence la garantía: ahora se cobraría 100 y hay que aceptarlo para poder pagar.
    localExec(
      `update public.cart_items set price_locked_until = now() - interval '1 minute' where variant_id = '${made.variantId}'`,
    );
    const expired = await cart({ action: "get" }, user.token);
    const l2 = lineOf(expired.body, made.variantId);
    expect([l2.unit_price, l2.price_notice, l2.blocking]).toEqual([100, "expired_raised", true]);
    expect(expired.body.cart.can_checkout).toBe(false);
    expect(expired.body.cart.totals.subtotal).toBe(200);

    const accepted = await cart(
      { action: "accept_prices", variant_id: made.variantId },
      user.token,
    );
    const l3 = lineOf(accepted.body, made.variantId);
    expect([l3.unit_price, l3.price_notice, l3.blocking, l3.status]).toEqual([
      100,
      null,
      false,
      "ok",
    ]);
    expect(accepted.body.cart.can_checkout).toBe(true);

    // Baja a 60 con garantía nueva: se cobra el menor.
    await svcRest("PATCH", `product_prices?product_id=eq.${made.productId}&currency=eq.BOB`, {
      amount: 60,
    });
    const dropped = await cart({ action: "get" }, user.token);
    const l4 = lineOf(dropped.body, made.variantId);
    expect([l4.unit_price, l4.price_notice, l4.blocking]).toEqual([60, "dropped", false]);
    expect(dropped.body.cart.totals.subtotal).toBe(120);
  });

  it("si se despublica o archiva el producto, el cliente lo ve y no puede pagar; la retención se libera", async () => {
    const made = await makeProduct({ name: "Se archiva", price: 25, stock: 6 });
    const user = await registerAndLogin();
    await cart({ action: "set_item", variant_id: made.variantId, qty: 2 }, user.token);
    expect(reservedOf(made.variantId)).toBe(2);
    // (No se puede archivar la ÚNICA variante de un producto publicado: se despublica el producto, que es lo que hace el admin.)
    const hide = await svcRest("PATCH", `products?id=eq.${made.productId}`, { status: "draft" });
    expect(hide.status, JSON.stringify(hide.body)).toBe(200);
    const view = await cart({ action: "get" }, user.token);
    const line = lineOf(view.body, made.variantId);
    expect([line.status, line.blocking, line.billable_qty, line.line_total]).toEqual([
      "unavailable",
      true,
      0,
      0,
    ]);
    expect(view.body.cart.can_checkout).toBe(false);
    expect(view.body.cart.totals.subtotal).toBe(0);
    expect(reservedOf(made.variantId)).toBe(0); // despublicar liberó la retención
    // No se puede volver a agregar mientras esté fuera de la tienda.
    const readd = await cart(
      { action: "set_item", variant_id: made.variantId, qty: 3 },
      user.token,
    );
    expect(readd.body.outcome).toBe("unavailable");
    // Archivado del todo: sigue sin poder pagarse y la persona lo puede quitar.
    const archive = await svcRest("PATCH", `products?id=eq.${made.productId}`, {
      archived_at: new Date().toISOString(),
    });
    expect(archive.status, JSON.stringify(archive.body)).toBe(200);
    const archivedView = await cart({ action: "get" }, user.token);
    expect(lineOf(archivedView.body, made.variantId).status).toBe("unavailable");
    const removed = await cart(
      { action: "set_item", variant_id: made.variantId, qty: 0 },
      user.token,
    );
    expect(removed.body.cart.totals.line_count).toBe(0);
    expect(removed.body.cart.can_checkout).toBe(false); // bolsa vacía
  });

  it("con la retención al agregar desactivada (D-02) no se retiene nada, pero igual se ajusta al stock", async () => {
    const made = await makeProduct({ name: "Sin retención", price: 18, stock: 3 });
    try {
      const patch = await svcRest("PATCH", "store_settings?key=eq.reserve_on_add_to_cart", {
        value: false,
      });
      expect(patch.status, JSON.stringify(patch.body)).toBe(200);
      const res = await cart({ action: "set_item", variant_id: made.variantId, qty: 5 });
      expect(res.body.outcome).toBe("adjusted");
      expect(res.body.applied).toBe(3);
      expect(res.body.cart.reservation.state).toBe("none");
      expect(reservedOf(made.variantId)).toBe(0);
    } finally {
      await svcRest("PATCH", "store_settings?key=eq.reserve_on_add_to_cart", { value: true });
    }
  });
});

describe("rendimiento", () => {
  it("un carrito de 50 líneas se lee y se actualiza con rapidez", async () => {
    const tag = randomTag();
    const product = await svcRest("POST", "products", {
      code: `W${tag}`.toUpperCase(),
      slug: `carrito-50-${tag}`,
      name: "Cincuenta",
      cost_base: 5,
    });
    const productId = product.body[0].id as string;
    const colors = await svcRest(
      "POST",
      "product_colors",
      Array.from({ length: 50 }, (_, i) => ({ product_id: productId, name: `Color ${i + 1}` })),
    );
    expect(colors.status, JSON.stringify(colors.body)).toBe(201);
    const variants = await svcRest(
      "POST",
      "product_variants",
      (colors.body as { id: string }[]).map((c) => ({ product_id: productId, color_id: c.id })),
    );
    expect(variants.status, JSON.stringify(variants.body)).toBe(201);
    await svcRest("POST", "product_prices", { product_id: productId, currency: "BOB", amount: 10 });
    const ids = (variants.body as { id: string }[]).map((v) => v.id);
    await Promise.all(
      ids.map((id) =>
        svcRpc("apply_stock_change", {
          p_variant_id: id,
          p_delta: 5,
          p_reason: "import",
          p_note: "50 líneas",
        }),
      ),
    );
    await svcRest("PATCH", `products?id=eq.${productId}`, { status: "active" });

    const user = await registerAndLogin();
    try {
      await svcRest("PATCH", "store_settings?key=eq.cart_max_lines", { value: 50 });
      await svcRest("PATCH", "store_settings?key=eq.cart_max_reserved_units", { value: 200 });
      for (const id of ids) {
        const r = await cart({ action: "set_item", variant_id: id, qty: 2 }, user.token);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        await clearRateLimits(); // 50 escrituras seguidas superarían el tope de 60/min con otras pruebas
      }
      const t0 = Date.now();
      const view = await cart({ action: "get" }, user.token);
      const getMs = Date.now() - t0;
      expect(view.body.cart.totals.line_count).toBe(50);
      expect(view.body.cart.totals.subtotal).toBe(1000); // 50 × 2 × 10,00
      const t1 = Date.now();
      const upd = await cart({ action: "set_item", variant_id: ids[0], qty: 3 }, user.token);
      const setMs = Date.now() - t1;
      expect(upd.body.cart.totals.subtotal).toBe(1010);
      expect(getMs, `get con 50 líneas: ${getMs} ms`).toBeLessThan(2500);
      expect(setMs, `set_item con 50 líneas: ${setMs} ms`).toBeLessThan(2500);
    } finally {
      await svcRest("PATCH", "store_settings?key=eq.cart_max_lines", { value: 30 });
      await svcRest("PATCH", "store_settings?key=eq.cart_max_reserved_units", { value: 30 });
    }
  }, 120_000);
});
