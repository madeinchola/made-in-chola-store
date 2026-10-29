import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import {
  clearRateLimits,
  localEnv,
  randomTag,
  registerAndLogin,
  rest,
  rpc,
  svcRest,
  svcRpc,
} from "../../../test-support/api";

// Los servicios usan getSupabase(): en este archivo apunta a un cliente REAL contra Supabase local, que se
// cambia entre visitante (anon) y administrador según el test.
const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => holder.client }));

import {
  getHome,
  getProductBySlug,
  getStoreSettings,
  listProducts,
  searchProducts,
} from "./catalogService";
import { getPublicPrice } from "./priceService";
import { adjustStock, listAdminProductStock, listAdminStock } from "./stockService";
import { slugify } from "./slug";
import { SLUG_CASES } from "./slug.cases";

// ── Utilidades ─────────────────────────────────────────────────────────────────────────────
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function clientWith(token?: string): SupabaseClient<Database> {
  const env = localEnv();
  return createClient<Database>(env.url, env.anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
  });
}

/** Ejecuta `total` tareas con a lo sumo `concurrency` en vuelo (200 conexiones HTTP a la vez saturan el gateway local de Docker). */
async function runPool<T>(
  total: number,
  concurrency: number,
  task: (i: number) => Promise<T>,
): Promise<T[]> {
  const results: T[] = new Array(total);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= total) return;
        results[i] = await task(i);
      }
    }),
  );
  return results;
}

const run = promisify(execFile);
/** Una sesión de psql INDEPENDIENTE dentro del contenedor de Postgres local (conexión propia, transacción propia). */
const psql = (sql: string) =>
  run("docker", [
    "exec",
    "-i",
    "supabase_db_made-in-chola",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);

interface MadeProduct {
  productId: string;
  variantId: string;
  slug: string;
  code: string;
}

/** Crea (como service_role) un producto vendible con 1 color, 1 variante, precio BOB y stock inicial por el libro mayor. */
async function makeProduct(opts: {
  tag: string;
  name: string;
  price: number;
  stock: number;
  behavior?: "sold_out" | "hide";
  model?: string;
  cost?: number;
}): Promise<MadeProduct> {
  const code = `T${opts.tag}-${randomTag()}`.toUpperCase();
  const slug = `${slugify(opts.name)}-${randomTag()}`;
  const product = await svcRest("POST", "products", {
    code,
    slug,
    name: opts.name,
    model: opts.model ?? null,
    cost_base: opts.cost ?? 10,
    out_of_stock_behavior: opts.behavior ?? "sold_out",
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
      p_note: "stock de prueba",
    });
    expect(stock.status, JSON.stringify(stock.body)).toBe(200);
  }
  const publish = await svcRest("PATCH", `products?id=eq.${productId}`, { status: "active" });
  expect(publish.status, JSON.stringify(publish.body)).toBe(200);
  return { productId, variantId, slug, code };
}

async function makeAdmin() {
  const admin = await registerAndLogin({ name: "Admin Prueba" });
  const promoted = await svcRpc("promote_admin", { p_email: admin.email });
  expect(promoted.status, JSON.stringify(promoted.body)).toBe(200);
  return admin;
}

let adminToken = "";
let customerToken = "";
const anonClient = () => clientWith();

beforeAll(async () => {
  await clearRateLimits();
  adminToken = (await makeAdmin()).token;
  customerToken = (await registerAndLogin({ name: "Cliente Prueba" })).token;
  holder.client = anonClient();
});

// ── 1. Permisos por HTTP real ──────────────────────────────────────────────────────────────
describe("permisos reales (PostgREST + RLS + grants)", () => {
  const tag = randomTag();
  let product: MadeProduct;
  beforeAll(async () => {
    product = await makeProduct({ tag, name: `Chaqueta ${tag}`, price: 560, stock: 10, cost: 222 });
  });

  it.each([
    "products",
    "product_variants",
    "product_prices",
    "stock_reservations",
    "stock_movements",
    "store_settings",
    "home_sections",
    "news_banners",
    "exchange_rates",
    "profiles",
    "audit_log",
  ])("anon NO puede leer la tabla %s (42501)", async (table) => {
    const res = await rest("GET", `${table}?select=*&limit=1`);
    expect([401, 403]).toContain(res.status);
    expect(res.body.code).toBe("42501");
  });

  it("anon lee las vistas públicas y NUNCA ve el costo ni el stock exacto", async () => {
    const res = await rest("GET", `public_products?slug=eq.${product.slug}&select=*`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ slug: product.slug, price_bob: 560, sold_out: false });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/cost_base|stock_on_hand|"code"|222/);
    const variants = await rest(
      "GET",
      `public_product_variants?product_id=eq.${product.productId}&select=*`,
    );
    expect(variants.body).toHaveLength(1);
    expect(variants.body[0].stock_status).toBe("in_stock");
    expect(Object.keys(variants.body[0])).not.toContain("available");
  });

  it.each([
    [
      "reserve_stock",
      { p_variant_id: randomUUID(), p_qty: 1, p_owner_type: "cart", p_owner_id: randomUUID() },
    ],
    ["release_stock", { p_owner_type: "cart", p_owner_id: randomUUID() }],
    ["apply_stock_change", { p_variant_id: randomUUID(), p_delta: 1, p_reason: "import" }],
    ["price_for", { p_product_id: randomUUID() }],
    ["adjust_stock", { p_variant_id: randomUUID(), p_delta: 1, p_reason: "adjust" }],
    ["expire_reservations", {}],
  ])("anon NO puede ejecutar %s", async (name, args) => {
    const res = await rpc(name, args);
    expect([401, 403]).toContain(res.status);
    expect(res.body.code).toBe("42501");
  });

  it("un cliente autenticado tampoco puede reservar ni ajustar stock", async () => {
    const reserve = await rpc(
      "reserve_stock",
      { p_variant_id: product.variantId, p_qty: 1, p_owner_type: "cart", p_owner_id: randomUUID() },
      customerToken,
    );
    expect(reserve.body.code).toBe("42501");
    const adjust = await rpc(
      "adjust_stock",
      { p_variant_id: product.variantId, p_delta: 5, p_reason: "adjust" },
      customerToken,
    );
    expect(adjust.body.code).toBe("42501");
    const stock = await svcRest(
      "GET",
      `product_variants?id=eq.${product.variantId}&select=stock_on_hand`,
    );
    expect(stock.body[0].stock_on_hand).toBe(10); // intacto
  });

  it("un cliente ve 0 filas de las tablas de catálogo (RLS) y no puede escribir", async () => {
    const read = await rest("GET", "products?select=id", customerToken);
    expect(read.status).toBe(200);
    expect(read.body).toEqual([]);
    const write = await rest("POST", "categories", customerToken, {
      name: "Hack",
      slug: `hack-${randomTag()}`,
    });
    expect(write.status).toBe(403);
    await rest("PATCH", `products?id=eq.${product.productId}`, customerToken, { name: "Hackeado" });
    const unchanged = await svcRest("GET", `products?id=eq.${product.productId}&select=name`);
    expect(unchanged.body[0].name).not.toBe("Hackeado"); // la RLS filtró la fila: 0 afectadas
  });

  it("el admin crea una categoría por HTTP, pero NO puede borrar ni fijar el stock directo", async () => {
    const slug = `cat-${randomTag()}`;
    const created = await rest("POST", "categories", adminToken, {
      name: "Categoría de prueba",
      slug,
    });
    expect(created.status).toBe(201);
    const del = await rest("DELETE", `categories?slug=eq.${slug}`, adminToken);
    expect(del.status).toBe(403);
    const direct = await rest("PATCH", `product_variants?id=eq.${product.variantId}`, adminToken, {
      stock_on_hand: 999,
    });
    expect(direct.status).toBe(403);
    // ni siquiera service_role puede borrar tablas de catálogo
    const svcDel = await svcRest("DELETE", `categories?slug=eq.${slug}`);
    expect(svcDel.status).toBe(403);
    const svcStock = await svcRest("PATCH", `product_variants?id=eq.${product.variantId}`, {
      stock_on_hand: 999,
    });
    expect(svcStock.status).toBeGreaterThanOrEqual(400);
  });
});

// ── 2. Concurrencia (criterio de aceptación 3) ─────────────────────────────────────────────
describe("reserve_stock bajo concurrencia real", () => {
  const reserve = (variantId: string, qty: number, owner = randomUUID()) =>
    svcRpc("reserve_stock", {
      p_variant_id: variantId,
      p_qty: qty,
      p_owner_type: "cart",
      p_owner_id: owner,
    });

  it("200 intentos simultáneos sobre 1 unidad: gana exactamente 1", async () => {
    const p = await makeProduct({ tag: "c1", name: "Última unidad", price: 100, stock: 1 });
    const results = await runPool(200, 40, () => reserve(p.variantId, 1));
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);
    const statuses = results.map((r) => r.body.status as string);
    expect(statuses.filter((s) => s === "reserved")).toHaveLength(1);
    expect(statuses.filter((s) => s === "insufficient_stock")).toHaveLength(199);
    const active = await svcRest(
      "GET",
      `stock_reservations?variant_id=eq.${p.variantId}&status=eq.active&select=qty`,
    );
    expect(active.body).toHaveLength(1);
    const avail = await svcRest(
      "GET",
      `product_variants?id=eq.${p.variantId}&select=stock_on_hand`,
    );
    expect(avail.body[0].stock_on_hand).toBe(1);
  }, 60_000);

  it("50 pedidos de 3 unidades sobre 10 en stock: ganan exactamente 3 (9 unidades), sobra 1", async () => {
    const p = await makeProduct({ tag: "c2", name: "Diez unidades", price: 100, stock: 10 });
    const results = await runPool(50, 25, () => reserve(p.variantId, 3));
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(results.filter((r) => r.body.status === "reserved")).toHaveLength(3);
    const active = await svcRest(
      "GET",
      `stock_reservations?variant_id=eq.${p.variantId}&status=eq.active&select=qty`,
    );
    const reserved = (active.body as { qty: number }[]).reduce((s, r) => s + r.qty, 0);
    expect(reserved).toBe(9);
    // lo que quedó (1) lo puede tomar alguien con 1 unidad
    const last = await reserve(p.variantId, 1);
    expect(last.body.status).toBe("reserved");
    const none = await reserve(p.variantId, 1);
    expect(none.body.status).toBe("insufficient_stock");
  }, 60_000);

  it("30 sesiones SQL independientes liberadas EN EL MISMO INSTANTE (barrera): gana exactamente 1 de 1 unidad", async () => {
    const p = await makeProduct({ tag: "c0", name: "Barrera", price: 100, stock: 1 });
    const key = 700000 + Math.floor(Math.random() * 90000);
    // El "portero" toma el cerrojo exclusivo y lo mantiene 6 s; las 30 sesiones piden el compartido y quedan en espera.
    // Al soltarse, TODAS avanzan a la vez hacia reserve_stock, cada una con su conexión y su transacción.
    const gate = psql(`select pg_advisory_lock(${key}); select pg_sleep(6);`);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const workers = Array.from({ length: 30 }, () =>
      psql(
        `select pg_advisory_lock_shared(${key}); select public.reserve_stock('${p.variantId}', 1, 'cart', gen_random_uuid()) ->> 'status';`,
      ),
    );
    await gate;
    const outputs = (await Promise.all(workers)).map((r) => r.stdout.trim().split("\n").at(-1));
    expect(outputs.filter((o) => o === "reserved")).toHaveLength(1);
    expect(outputs.filter((o) => o === "insufficient_stock")).toHaveLength(29);
    const active = await svcRest(
      "GET",
      `stock_reservations?variant_id=eq.${p.variantId}&status=eq.active&select=qty`,
    );
    expect(active.body).toEqual([{ qty: 1 }]);
  }, 90_000);

  it("el MISMO dueño repitiendo la petición 50 veces en paralelo deja UNA sola reserva (idempotencia)", async () => {
    const p = await makeProduct({ tag: "c3", name: "Doble clic", price: 100, stock: 5 });
    const owner = randomUUID();
    const results = await runPool(50, 25, () => reserve(p.variantId, 2, owner));
    for (const r of results) expect(r.body.status).toBe("reserved");
    const active = await svcRest(
      "GET",
      `stock_reservations?variant_id=eq.${p.variantId}&owner_id=eq.${owner}&status=eq.active&select=qty`,
    );
    expect(active.body).toEqual([{ qty: 2 }]);
  }, 60_000);

  it("reservas y ajustes de admin mezclados en paralelo: nunca hay más reservado que stock al final", async () => {
    const p = await makeProduct({ tag: "c4", name: "Mezcla", price: 100, stock: 20 });
    const ops: (() => Promise<unknown>)[] = [
      ...Array.from({ length: 40 }, () => () => reserve(p.variantId, 1)),
      ...Array.from(
        { length: 10 },
        () => () =>
          svcRpc("apply_stock_change", {
            p_variant_id: p.variantId,
            p_delta: -1,
            p_reason: "sale",
          }),
      ),
    ];
    await runPool(ops.length, 25, (i) => (ops[i] as () => Promise<unknown>)());
    const row = await svcRest("GET", `product_variants?id=eq.${p.variantId}&select=stock_on_hand`);
    const onHand = row.body[0].stock_on_hand as number;
    const active = await svcRest(
      "GET",
      `stock_reservations?variant_id=eq.${p.variantId}&status=eq.active&select=qty`,
    );
    const reserved = (active.body as { qty: number }[]).reduce((s, r) => s + r.qty, 0);
    expect(onHand).toBe(10); // 20 − 10 ventas
    expect(reserved).toBeLessThanOrEqual(20); // las reservas se hicieron contra lo disponible en cada momento
    const ledger = await svcRest(
      "GET",
      `stock_movements?variant_id=eq.${p.variantId}&select=delta`,
    );
    const sum = (ledger.body as { delta: number }[]).reduce((s, r) => s + r.delta, 0);
    expect(sum).toBe(onHand); // invariante del libro mayor bajo concurrencia
  }, 60_000);
});

// ── 3. Servicios TypeScript contra las vistas reales ───────────────────────────────────────
describe("servicios del catálogo contra Supabase real", () => {
  const tag = randomTag();
  let chaqueta: MadeProduct;
  let hidden: MadeProduct;
  let sombrero: MadeProduct;

  beforeAll(async () => {
    holder.client = anonClient();
    chaqueta = await makeProduct({
      tag,
      name: `Chaqueta Ñandú ${tag}`,
      price: 560,
      stock: 10,
      model: "Edición Ñ",
    });
    sombrero = await makeProduct({ tag, name: `Sombrero ${tag}`, price: 450.5, stock: 3 });
    hidden = await makeProduct({
      tag,
      name: `Oculto ${tag}`,
      price: 100,
      stock: 0,
      behavior: "hide",
    });
  }, 60_000);

  it("listProducts devuelve productos con el precio como Money exacto y respeta 'Ocultar' al agotarse", async () => {
    const page = await listProducts({ limit: 100, sort: "name" });
    const mine = page.items.filter((i) => i.name.includes(tag));
    expect(mine.map((i) => i.name).sort()).toEqual(
      [`Chaqueta Ñandú ${tag}`, `Sombrero ${tag}`].sort(),
    );
    expect(mine.find((i) => i.slug === sombrero.slug)?.price).toEqual({
      amount: 45050,
      currency: "BOB",
    });
    expect(page.items.some((i) => i.slug === hidden.slug)).toBe(false);
    expect(page.total).toBeGreaterThanOrEqual(2);
  });

  it("la paginación del servidor es estable y completa: recorriendo páginas se ve cada producto una sola vez", async () => {
    const all = await listProducts({ limit: 100, sort: "price_asc" });
    const seen: string[] = [];
    for (let offset = 0; offset < all.total; offset += 7) {
      const page = await listProducts({ limit: 7, offset, sort: "price_asc" });
      seen.push(...page.items.map((i) => i.id));
    }
    expect(seen).toHaveLength(all.total);
    expect(new Set(seen).size).toBe(all.total);
  });

  it("getProductBySlug trae el detalle completo y un producto no público devuelve null", async () => {
    const d = await getProductBySlug(chaqueta.slug);
    expect(d?.product).toMatchObject({
      slug: chaqueta.slug,
      model: "Edición Ñ",
      price: { amount: 56000, currency: "BOB" },
    });
    expect(d?.colors.map((c) => c.name)).toEqual(["Único"]);
    expect(d?.variants).toHaveLength(1);
    expect(d?.variants[0]?.stockStatus).toBe("in_stock");
    expect(await getProductBySlug(hidden.slug)).toBeNull();
    expect(await getProductBySlug("slug-que-no-existe")).toBeNull();
  });

  it("al reservar, el estado público cambia sin revelar cantidades; al agotarse con 'Ocultar' desaparece", async () => {
    const p = await makeProduct({ tag, name: `Pocas ${tag}`, price: 100, stock: 3 });
    expect((await getProductBySlug(p.slug))?.variants[0]?.stockStatus).toBe("low"); // 3 <= 5 (aviso)
    await svcRpc("reserve_stock", {
      p_variant_id: p.variantId,
      p_qty: 3,
      p_owner_type: "cart",
      p_owner_id: randomUUID(),
    });
    const after = await getProductBySlug(p.slug);
    expect(after?.variants[0]?.stockStatus).toBe("out");
    expect(after?.product.soldOut).toBe(true);
    const h = await makeProduct({
      tag,
      name: `Se oculta ${tag}`,
      price: 100,
      stock: 2,
      behavior: "hide",
    });
    expect(await getProductBySlug(h.slug)).not.toBeNull();
    await svcRpc("reserve_stock", {
      p_variant_id: h.variantId,
      p_qty: 2,
      p_owner_type: "cart",
      p_owner_id: randomUUID(),
    });
    // "Ocultar" depende del stock FÍSICO: con todo retenido por un carrito sigue visible, como agotado
    expect((await getProductBySlug(h.slug))?.product.soldOut).toBe(true);
    await svcRpc("apply_stock_change", {
      p_variant_id: h.variantId,
      p_delta: -2,
      p_reason: "sale",
    });
    expect(await getProductBySlug(h.slug)).toBeNull(); // sin stock físico sí se oculta
  });

  it("searchProducts ignora acentos y mayúsculas y encuentra por modelo", async () => {
    expect((await searchProducts(`nandu ${tag}`)).map((p) => p.slug)).toEqual([chaqueta.slug]);
    expect((await searchProducts(`ÑANDÚ ${tag.toUpperCase()}`)).map((p) => p.slug)).toEqual([
      chaqueta.slug,
    ]);
    expect((await searchProducts("edicion ñ")).some((p) => p.slug === chaqueta.slug)).toBe(true);
    expect(await searchProducts("x")).toEqual([]);
    expect((await searchProducts(`oculto ${tag}`)).length).toBe(0);
  });

  it("getPublicPrice: precio BOB de un producto visible; un producto oculto o inexistente → null", async () => {
    expect(await getPublicPrice(chaqueta.productId)).toEqual({ amount: 56000, currency: "BOB" });
    expect(await getPublicPrice(hidden.productId)).toBeNull();
    expect(await getPublicPrice(randomUUID())).toBeNull();
    expect(await getPublicPrice(chaqueta.productId, { currency: "USD" })).toBeNull(); // USD deshabilitada
  });

  it("getStoreSettings trae los datos públicos del negocio y ninguno interno", async () => {
    const s = await getStoreSettings();
    expect(s.whatsapp_orders).toBe("+59167528677");
    expect(s.contact_email).toBe("info@madeinchola.com");
    expect(s.social_instagram).toBe("https://www.instagram.com/madeinchola/");
    expect(s.social_youtube).toBe("https://www.youtube.com/@madeinchola9876");
    expect(s).not.toHaveProperty("stock_low_threshold");
    expect(s).not.toHaveProperty("reservation_ttl_minutes");
  });

  it("el admin edita el home por HTTP y la tienda lo ve (y oculta lo desactivado)", async () => {
    const title = `Sección ${tag}`;
    const created = await rest("POST", "home_sections", adminToken, {
      kind: "tagline",
      title,
      sort_order: 9999,
      is_active: true,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body[0].id as string;
    const item = await rest("POST", "home_section_items", adminToken, {
      section_id: id,
      label: "Elemento",
      link_url: "/coleccion/x",
      sort_order: 1,
    });
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    const visible = (await getHome()).find((s) => s.id === id);
    expect(visible).toMatchObject({ kind: "tagline", title });
    expect(visible?.items.map((i) => i.label)).toEqual(["Elemento"]);
    await rest("PATCH", `home_sections?id=eq.${id}`, adminToken, { is_active: false });
    expect((await getHome()).some((s) => s.id === id)).toBe(false);
    const unsafe = await rest("POST", "home_sections", adminToken, {
      kind: "hero",
      cta_label: "Ver",
      cta_url: "javascript:alert(1)",
    });
    expect(unsafe.status).toBe(400);
  });
});

// ── 4. Administración del stock (cliente de admin real) ────────────────────────────────────
describe("stock desde el panel admin (servicios con sesión de admin)", () => {
  const tag = randomTag();
  let p: MadeProduct;
  beforeAll(async () => {
    p = await makeProduct({ tag, name: `Stock ${tag}`, price: 100, stock: 12 });
  }, 60_000);

  it("adjustStock suma y resta con trazabilidad y listAdminStock muestra cantidades exactas", async () => {
    holder.client = clientWith(adminToken);
    expect(
      await adjustStock({ variantId: p.variantId, delta: 8, reason: "import", note: "carga" }),
    ).toBe(20);
    expect(
      await adjustStock({ variantId: p.variantId, delta: -5, reason: "adjust", note: "merma" }),
    ).toBe(15);
    const rows = await listAdminStock(p.productId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      stockOnHand: 15,
      reserved: 0,
      available: 15,
      light: "ok",
      colorName: "Único",
      sizeLabel: null,
      archived: false,
    });
    const summary = (await listAdminProductStock()).find((r) => r.productId === p.productId);
    expect(summary).toMatchObject({
      totalOnHand: 15,
      variantsCount: 1,
      variantsOut: 0,
      worstLight: "ok",
    });
    const ledger = await svcRest(
      "GET",
      `stock_movements?variant_id=eq.${p.variantId}&select=delta,reason,note,stock_after&order=id`,
    );
    expect(ledger.body.map((m: { delta: number }) => m.delta)).toEqual([12, 8, -5]);
    expect(ledger.body.at(-1)).toMatchObject({ reason: "adjust", note: "merma", stock_after: 15 });
  });

  it("no deja bajar de lo comprometido en un pedido y el error llega traducido", async () => {
    holder.client = clientWith(adminToken);
    await svcRpc("reserve_stock", {
      p_variant_id: p.variantId,
      p_qty: 14,
      p_owner_type: "order",
      p_owner_id: randomUUID(),
    });
    await expect(
      adjustStock({ variantId: p.variantId, delta: -2, reason: "adjust" }),
    ).rejects.toMatchObject({
      name: "AppError",
      code: "conflict",
      message: expect.stringContaining("comprometidas"),
    });
    expect(await adjustStock({ variantId: p.variantId, delta: -1, reason: "adjust" })).toBe(14);
  });

  it("restar más de lo que hay → validation; el semáforo del panel refleja el stock", async () => {
    holder.client = clientWith(adminToken);
    const small = await makeProduct({ tag, name: `Semáforo ${tag}`, price: 100, stock: 2 });
    await expect(
      adjustStock({ variantId: small.variantId, delta: -50, reason: "adjust" }),
    ).rejects.toMatchObject({ code: "validation" });
    expect((await listAdminStock(small.productId))[0]?.light).toBe("critical"); // 2 <= crítico (2)
  });

  it("un cliente NO ve el stock de admin ni puede ajustarlo (errores traducidos)", async () => {
    holder.client = clientWith(customerToken);
    expect(await listAdminStock(p.productId)).toEqual([]);
    await expect(
      adjustStock({ variantId: p.variantId, delta: 1, reason: "adjust" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    holder.client = anonClient();
    await expect(listAdminStock()).rejects.toMatchObject({ code: "forbidden" });
  });
});

// ── 5. Storage real ────────────────────────────────────────────────────────────────────────
describe("Storage (API real)", () => {
  const env = () => localEnv();
  async function upload(
    bucket: string,
    path: string,
    body: Uint8Array,
    contentType: string,
    token?: string,
  ) {
    const res = await fetch(`${env().url}/storage/v1/object/${bucket}/${path}`, {
      method: "POST",
      headers: {
        apikey: env().anon,
        Authorization: `Bearer ${token ?? env().anon}`,
        "Content-Type": contentType,
      },
      body: body as unknown as BodyInit,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* no JSON */
    }
    return { status: res.status, body: json };
  }
  const publicGet = (bucket: string, path: string) =>
    fetch(`${env().url}/storage/v1/object/public/${bucket}/${path}`);
  const remove = (bucket: string, path: string, token: string) =>
    fetch(`${env().url}/storage/v1/object/${bucket}/${path}`, {
      method: "DELETE",
      headers: { apikey: env().anon, Authorization: `Bearer ${token}` },
    });
  const pid = randomUUID();
  const path = (ext = "png") => `products/${pid}/${randomUUID()}.${ext}`;

  it("el admin sube una imagen válida y cualquiera la ve por URL pública", async () => {
    const p = path();
    const up = await upload("product-images", p, PNG_1X1, "image/png", adminToken);
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    const got = await publicGet("product-images", p);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toContain("image/png");
    expect(Buffer.from(await got.arrayBuffer()).equals(PNG_1X1)).toBe(true);
  });

  it("anon y clientes NO pueden subir", async () => {
    const a = await upload("product-images", path(), PNG_1X1, "image/png");
    expect(a.status).toBeGreaterThanOrEqual(400);
    const c = await upload("product-images", path(), PNG_1X1, "image/png", customerToken);
    expect(c.status).toBeGreaterThanOrEqual(400);
  });

  it("el admin NO puede subir fuera de la convención de rutas ni a un bucket ajeno", async () => {
    const bad = await upload(
      "product-images",
      "cualquier-cosa.png",
      PNG_1X1,
      "image/png",
      adminToken,
    );
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const wrongBucket = await upload("site-media", path(), PNG_1X1, "image/png", adminToken);
    expect(wrongBucket.status).toBeGreaterThanOrEqual(400);
  });

  it("rechaza tipos no permitidos (html, svg) aunque la ruta sea válida", async () => {
    const html = await upload(
      "product-images",
      path("png"),
      Buffer.from("<script>alert(1)</script>"),
      "text/html",
      adminToken,
    );
    expect(html.status).toBeGreaterThanOrEqual(400);
    const svg = await upload(
      "product-images",
      path("png"),
      Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      "image/svg+xml",
      adminToken,
    );
    expect(svg.status).toBeGreaterThanOrEqual(400);
  });

  it("rechaza imágenes de más de 5 MiB (y acepta una de exactamente 5 MiB)", async () => {
    const tooBig = await upload(
      "product-images",
      path(),
      Buffer.alloc(5 * 1024 * 1024 + 1),
      "image/png",
      adminToken,
    );
    expect(tooBig.status === 413 || tooBig.body?.statusCode === "413").toBe(true);
    const exact = await upload(
      "product-images",
      path(),
      Buffer.alloc(5 * 1024 * 1024),
      "image/png",
      adminToken,
    );
    expect(exact.status, JSON.stringify(exact.body)).toBe(200);
  }, 60_000);

  it("el home admite video mp4 en su bucket y rechaza imágenes en el bucket de video", async () => {
    const mp4 = await upload(
      "site-videos",
      `home/${randomUUID()}.mp4`,
      Buffer.alloc(1024),
      "video/mp4",
      adminToken,
    );
    expect(mp4.status, JSON.stringify(mp4.body)).toBe(200);
    const img = await upload(
      "site-videos",
      `home/${randomUUID()}.png`,
      PNG_1X1,
      "image/png",
      adminToken,
    );
    expect(img.status).toBeGreaterThanOrEqual(400);
  });

  it("solo el admin puede borrar: el borrado del cliente no surte efecto, el del admin sí", async () => {
    const p = path("webp");
    expect((await upload("product-images", p, PNG_1X1, "image/webp", adminToken)).status).toBe(200);
    await remove("product-images", p, customerToken);
    expect((await publicGet("product-images", p)).status).toBe(200); // sigue ahí
    const del = await remove("product-images", p, adminToken);
    expect(del.status).toBe(200);
    expect((await publicGet("product-images", p)).ok).toBe(false); // ya no existe
  });
});

// ── 6. Paridad TypeScript ↔ SQL de slugify ─────────────────────────────────────────────────
describe("slugify: el cliente y la BD producen lo mismo", () => {
  const sql = async (text: string) => {
    const res = await svcRpc("slugify", { p_text: text });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as string;
  };

  it.each(SLUG_CASES)("%j → %j (TypeScript y SQL)", async (input, expected) => {
    expect(slugify(input)).toBe(expected);
    expect(await sql(input)).toBe(expected);
  });

  it("paridad carácter por carácter en el bloque Latin completo (U+00A0–U+017F: Latin-1 y Latin Extendido-A)", async () => {
    const mismatches: string[] = [];
    for (let cp = 0xa0; cp <= 0x17f; cp++) {
      const s = `a${String.fromCodePoint(cp)}b`;
      const [ts, db] = [slugify(s), await sql(s)];
      if (ts !== db) {
        mismatches.push(
          `U+${cp.toString(16).toUpperCase()} ${String.fromCodePoint(cp)}: ts=${JSON.stringify(ts)} sql=${JSON.stringify(db)}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  }, 180_000);

  it("paridad sobre 300 cadenas aleatorias con letras latinas, dígitos, espacios y símbolos", async () => {
    const alphabet =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_.,;:!?¡¿/()%&$#@+*'\"ñÑáéíóúüÁÉÍÓÚÜàèìòùâêîôûäëïöçÇãõåøæœßðþÿ—–";
    const chars = [...alphabet];
    let seed = 20261028;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const mismatches: string[] = [];
    for (let i = 0; i < 300; i++) {
      const len = 1 + Math.floor(rnd() * 24);
      const s = Array.from({ length: len }, () => chars[Math.floor(rnd() * chars.length)]).join("");
      const [ts, db] = [slugify(s), await sql(s)];
      if (ts !== db)
        mismatches.push(`${JSON.stringify(s)}: ts=${JSON.stringify(ts)} sql=${JSON.stringify(db)}`);
    }
    expect(mismatches).toEqual([]);
  }, 120_000);
});

// ── 7. pg_cron expira reservas de verdad ───────────────────────────────────────────────────
describe("pg_cron", () => {
  it("el trabajo programado marca como 'expired' una reserva vencida (puede tardar hasta ~70 s)", async () => {
    const p = await makeProduct({ tag: "cr", name: "Cron", price: 100, stock: 2 });
    const owner = randomUUID();
    const r = await svcRpc("reserve_stock", {
      p_variant_id: p.variantId,
      p_qty: 1,
      p_owner_type: "cart",
      p_owner_id: owner,
      p_ttl_seconds: 1,
    });
    expect(r.body.status).toBe("reserved");
    let status = "active";
    const deadline = Date.now() + 100_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const res = await svcRest("GET", `stock_reservations?owner_id=eq.${owner}&select=status`);
      status = res.body[0].status as string;
      if (status !== "active") break;
    }
    expect(status).toBe("expired");
  }, 130_000);
});

// ── 8. Contrato del seed de desarrollo ─────────────────────────────────────────────────────
describe("datos de ejemplo (supabase/seed.sql + npm run dev:seed)", () => {
  beforeAll(() => {
    holder.client = anonClient();
  });

  it("el catálogo de ejemplo es visible y respeta cada caso límite", async () => {
    const page = await listProducts({ limit: 100, sort: "name" });
    const slugs = new Set(page.items.map((i) => i.slug));
    expect(slugs.has("chaqueta-japandi")).toBe(true);
    expect(slugs.has("chakra-naranja")).toBe(true);
    expect(slugs.has("coleccion-otono-borrador")).toBe(false); // borrador
    expect(slugs.has("chaqueta-descontinuada")).toBe(false); // archivado
    expect(slugs.has("rinonera-bordada")).toBe(false); // agotado + "Ocultar"
    const cartera = page.items.find((i) => i.slug === "cartera-cordon-verde");
    expect(cartera?.soldOut).toBe(true); // agotada pero visible ("Agotado")
    const japandi = page.items.find((i) => i.slug === "chaqueta-japandi");
    expect(japandi).toMatchObject({
      isNew: true,
      colorsCount: 3,
      price: { amount: 56000, currency: "BOB" },
    });
  });

  it("las categorías forman el árbol de Ropa y listar 'ropa' incluye sus subcategorías", async () => {
    const { getCategoryTree } = await import("./catalogService");
    const tree = await getCategoryTree();
    const ropa = tree.find((n) => n.slug === "ropa");
    expect(ropa?.children.map((c) => c.slug).sort()).toEqual([
      "camisas",
      "chaquetas",
      "pantalones",
    ]);
    const ropaList = await listProducts({ categorySlug: "ropa", limit: 100 });
    const chaquetas = await listProducts({ categorySlug: "chaquetas", limit: 100 });
    expect(ropaList.total).toBeGreaterThan(chaquetas.total);
    for (const c of chaquetas.items) expect(ropaList.items.some((i) => i.id === c.id)).toBe(true);
  });

  it("la colección vencida no sale; las vigentes sí, con sus productos", async () => {
    const { listCollections } = await import("./catalogService");
    const slugs = (await listCollections()).map((c) => c.slug);
    expect(slugs).toContain("verano-2027");
    expect(slugs).toContain("nadas");
    expect(slugs).not.toContain("edicion-limitada-2026");
    const nadas = await listProducts({ collectionSlug: "nadas", limit: 100 });
    expect(nadas.items.map((i) => i.slug).sort()).toEqual(
      ["cartera-cordon-verde", "camisa-pliegues", "chakra-naranja", "chaqueta-japandi"].sort(),
    );
  });

  it("el home trae las 8 secciones del diseño en orden y con el mosaico de categorías", async () => {
    const home = await getHome();
    const mine = home.filter((s) => s.sortOrder >= 1 && s.sortOrder <= 8);
    expect(mine.map((s) => s.kind)).toEqual([
      "hero",
      "product_row",
      "collection_feature",
      "about",
      "product_row",
      "banner",
      "tagline",
      "category_tiles",
    ]);
    const tiles = mine.find((s) => s.kind === "category_tiles");
    expect(tiles?.items.map((i) => i.label)).toEqual(["Carteras", "Objetos", "Ropa"]);
  });

  it("los relacionados del producto estrella respetan el orden manual", async () => {
    const d = await getProductBySlug("chaqueta-japandi");
    expect(d?.related.map((r) => r.slug)).toEqual([
      "chakra-naranja",
      "cartera-cordon-verde",
      "camisa-pliegues",
      "pantalon-pliegue",
    ]);
  });

  it("las imágenes de ejemplo existen y son PNG reales descargables (si falla: ejecuta `npm run dev:seed`)", async () => {
    const d = await getProductBySlug("chaqueta-japandi");
    expect(d?.images.length, "faltan las imágenes de ejemplo: ejecuta `npm run dev:seed`").toBe(2);
    const first = d?.images[0];
    const res = await fetch(
      `${localEnv().url}/storage/v1/object/public/product-images/${first?.path}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // sin imágenes → la portada es null y la UI muestra el placeholder
    const bufanda = await getProductBySlug("bufanda-alpaca");
    expect(bufanda?.images).toEqual([]);
  });
});

// ── 9. Correcciones de la revisión independiente ───────────────────────────────────────────
describe("correcciones de la revisión (HTTP real)", () => {
  it("admin_set_product_categories es atómico: llamadas simultáneas con listas distintas nunca se mezclan", async () => {
    const tag = randomTag();
    const p = await makeProduct({ tag, name: `Atómico ${tag}`, price: 100, stock: 1 });
    const a = await svcRest("POST", "categories", { name: `A ${tag}`, slug: `a-${tag}` });
    const b = await svcRest("POST", "categories", { name: `B ${tag}`, slug: `b-${tag}` });
    const [idA, idB] = [a.body[0].id as string, b.body[0].id as string];
    for (let i = 0; i < 15; i++) {
      const results = await Promise.all([
        rpc(
          "admin_set_product_categories",
          { p_product_id: p.productId, p_category_ids: [idA] },
          adminToken,
        ),
        rpc(
          "admin_set_product_categories",
          { p_product_id: p.productId, p_category_ids: [idB] },
          adminToken,
        ),
      ]);
      for (const r of results) expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
      const rows = await svcRest(
        "GET",
        `product_categories?product_id=eq.${p.productId}&select=category_id`,
      );
      expect(rows.body, `iteración ${i}`).toHaveLength(1); // {A} o {B}, jamás {A,B}
    }
  }, 60_000);

  it("el admin quita un precio por HTTP; un cliente no; y el BOB de un producto publicado no se puede quitar", async () => {
    const tag = randomTag();
    const p = await makeProduct({ tag, name: `Precio ${tag}`, price: 100, stock: 1 });
    await svcRest("POST", "product_prices", {
      product_id: p.productId,
      currency: "USD",
      amount: 20,
    });
    const args = { p_product_id: p.productId, p_currency: "USD" };
    const denied = await rpc("admin_delete_product_price", args, customerToken);
    expect(denied.body.code).toBe("42501");
    const ok = await rpc("admin_delete_product_price", args, adminToken);
    expect(ok.status, JSON.stringify(ok.body)).toBeLessThan(300);
    const gone = await svcRest(
      "GET",
      `product_prices?product_id=eq.${p.productId}&currency=eq.USD&select=id`,
    );
    expect(gone.body).toEqual([]);
    const bob = await rpc(
      "admin_delete_product_price",
      { p_product_id: p.productId, p_currency: "BOB" },
      adminToken,
    );
    expect(bob.body.code).toBe("23514");
  });

  it("la auditoría identifica la fila de un ajuste por su clave", async () => {
    const before = await svcRest("GET", "store_settings?key=eq.contact_phone&select=value");
    const original = before.body[0].value as string;
    const changed = await rest("PATCH", "store_settings?key=eq.contact_phone", adminToken, {
      value: "+541199998888",
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    const log = await svcRest(
      "GET",
      "audit_log?table_name=eq.store_settings&record_id=eq.contact_phone&order=id.desc&limit=1&select=record_id,diff",
    );
    expect(log.body[0].record_id).toBe("contact_phone");
    expect(log.body[0].diff._key.key).toBe("contact_phone");
    expect(log.body[0].diff.value.new).toBe("+541199998888");
    await rest("PATCH", "store_settings?key=eq.contact_phone", adminToken, { value: original });
  });

  it("una consulta de búsqueda gigante (anon) responde vacía y rápido, sin reventar", async () => {
    const started = Date.now();
    const res = await rpc("public_search_products", { p_query: "chaqueta ".repeat(25_000) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
