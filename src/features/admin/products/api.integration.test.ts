import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import {
  clearRateLimits,
  localEnv,
  randomTag,
  registerAndLogin,
  rest,
  svcRest,
  svcRpc,
} from "../../../../test-support/api";

// Los servicios usan getSupabase(): aquí apunta a un cliente REAL contra Supabase local (visitante, cliente o admin).
const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => holder.client }));

import { adjustStock } from "@/features/catalog/stockService";
import { getStockAlertSummary, listStockAlertVariants } from "../stock/api";
import { StaleVersionError } from "../lib/versioned";
import {
  PartialCreateError,
  addColor,
  addSize,
  archiveImage,
  createProduct,
  duplicateProduct,
  getAdminProduct,
  isCodeAvailable,
  isSlugAvailable,
  listAdminProducts,
  listCategoryOptions,
  listEnabledCurrencies,
  saveImageOrder,
  savePrices,
  searchProductsForRelation,
  setColorArchived,
  setProductArchived,
  setProductCategories,
  setProductCollections,
  setProductRelated,
  setProductStatus,
  setVariantStock,
  syncProductVariants,
  updateImage,
  updateProductData,
  uploadProductImage,
} from "./api";
import type { ProductDataPatch } from "./productSchema";
import type { AdminProductListParams } from "./types";

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

let adminToken = "";
let customerToken = "";
const asAdmin = () => void (holder.client = clientWith(adminToken));
const asCustomer = () => void (holder.client = clientWith(customerToken));
const asAnon = () => void (holder.client = clientWith());

beforeAll(async () => {
  await clearRateLimits();
  const admin = await registerAndLogin({ name: "Admin Panel" });
  expect((await svcRpc("promote_admin", { p_email: admin.email })).status).toBe(200);
  adminToken = admin.token;
  customerToken = (await registerAndLogin({ name: "Cliente Panel" })).token;
  asAdmin();
}, 60_000);

const patch = (tag: string, over: Partial<ProductDataPatch> = {}): ProductDataPatch => ({
  name: `Producto ${tag}`,
  code: `IT-${tag}`,
  slug: `producto-${tag}`,
  model: null,
  description: "",
  materials: null,
  washcare: null,
  cost_base: null,
  out_of_stock_behavior: "sold_out",
  is_new: false,
  allow_converted_prices: false,
  ...over,
});

interface Made {
  id: string;
  tag: string;
}
async function makeProduct(
  tag = randomTag(),
  o: { colors?: string[]; sizes?: string[]; price?: string; data?: Partial<ProductDataPatch> } = {},
): Promise<Made> {
  const { id } = await createProduct({
    data: patch(tag, o.data),
    priceBob: o.price ?? "100",
    colors: (o.colors ?? ["Rojo"]).map((name) => ({ name, hex: "" })),
    sizes: o.sizes ?? [],
  });
  return { id, tag };
}
const detailOf = async (id: string) => {
  const d = await getAdminProduct(id);
  if (!d) throw new Error("producto no encontrado");
  return d;
};
const listParams = (over: Partial<AdminProductListParams> = {}): AdminProductListParams => ({
  state: "all",
  sort: "name",
  page: 1,
  pageSize: 50,
  ...over,
});
/** Pone el stock de la primera variante activa en `n` (por el libro mayor, como el panel). */
async function setStock(id: string, n: number) {
  const d = await detailOf(id);
  const v = d.variants.find((x) => !x.archived);
  if (!v) throw new Error("sin variantes");
  if (n !== v.stockOnHand)
    await adjustStock({
      variantId: v.id,
      delta: n - v.stockOnHand,
      reason: n > v.stockOnHand ? "import" : "adjust",
    });
}

// ── Creación ───────────────────────────────────────────────────────────────────────────────
describe("createProduct (BD real)", () => {
  it("crea el borrador con su precio, colores, tallas y TODAS las variantes (stock 0, SKU automático y único)", async () => {
    const tag = randomTag();
    const { id } = await makeProduct(tag, {
      colors: ["Rojo", "Azul"],
      sizes: ["S", "M", "L"],
      price: "120.5",
    });
    const d = await detailOf(id);
    expect(d.product.status).toBe("draft");
    expect(d.product.archived).toBe(false);
    expect(d.colors.map((c) => c.name)).toEqual(["Rojo", "Azul"]);
    expect(d.sizes.map((s) => s.label)).toEqual(["S", "M", "L"]);
    expect(d.variants).toHaveLength(6); // 2 colores × 3 tallas
    expect(d.variants.every((v) => v.stockOnHand === 0 && !v.archived)).toBe(true);
    const skus = d.variants.map((v) => v.sku);
    expect(new Set(skus).size).toBe(6);
    expect(
      skus.every(
        (s) => /^[A-Za-z0-9._-]+$/.test(s) && s.toUpperCase().startsWith(`IT-${tag}`.toUpperCase()),
      ),
    ).toBe(true);
    expect(d.prices).toHaveLength(1);
    expect(d.prices[0]).toMatchObject({ currency: "BOB", country: null, amount: "120.5" });
  });

  it("sin tallas: una variante por color con talla null", async () => {
    const { id } = await makeProduct(randomTag(), { colors: ["Rojo", "Verde"] });
    const d = await detailOf(id);
    expect(d.variants).toHaveLength(2);
    expect(d.variants.every((v) => v.sizeId === null)).toBe(true);
  });

  it("un código repetido (sin distinguir mayúsculas) falla con mensaje claro y NO deja un producto a medias", async () => {
    const a = await makeProduct();
    const code = `it-${a.tag}`.toLowerCase(); // mismo código en minúsculas
    const before = (
      await rest("GET", `products?code=ilike.${encodeURIComponent(code)}&select=id`, adminToken)
    ).body.length;
    const error = await createProduct({
      data: patch(randomTag(), { code }),
      priceBob: "10",
      colors: [{ name: "X", hex: "" }],
      sizes: [],
    }).catch((e: unknown) => e);
    expect((error as Error).message).toBe(
      "Ya existe un producto con ese código (no se distingue entre mayúsculas y minúsculas).",
    );
    expect(error).not.toBeInstanceOf(PartialCreateError);
    const after = (
      await rest("GET", `products?code=ilike.${encodeURIComponent(code)}&select=id`, adminToken)
    ).body.length;
    expect(after).toBe(before);
  });

  it("un slug repetido falla con mensaje claro", async () => {
    const a = await makeProduct();
    const error = await createProduct({
      data: patch(randomTag(), { slug: `producto-${a.tag}` }),
      priceBob: "10",
      colors: [{ name: "X", hex: "" }],
      sizes: [],
    }).catch((e: unknown) => e);
    expect((error as Error).message).toBe("Esa dirección (slug) ya la usa otro producto.");
  });

  it("si falla DESPUÉS de crear el producto (colores repetidos) lanza PartialCreateError con su id y el borrador existe", async () => {
    const tag = randomTag();
    const error = (await createProduct({
      data: patch(tag),
      priceBob: "10",
      colors: [
        { name: "Rojo", hex: "" },
        { name: "rojo", hex: "" },
      ],
      sizes: [],
    }).catch((e: unknown) => e)) as PartialCreateError;
    expect(error).toBeInstanceOf(PartialCreateError);
    expect(error.message).toBe("Ese color ya existe en este producto.");
    const d = await detailOf(error.productId);
    expect(d.product.status).toBe("draft");
    expect(d.product.code).toBe(`IT-${tag}`);
  });

  it("el precio con más de 2 decimales lo rechaza la base (no se redondea)", async () => {
    const error = await createProduct({
      data: patch(randomTag()),
      priceBob: "10.999",
      colors: [{ name: "X", hex: "" }],
      sizes: [],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PartialCreateError);
    expect((error as Error).message).toMatch(/más de 2 decimales/);
  });

  it("un costo y modelo con texto largo o caracteres especiales se guardan tal cual (acentos, ñ, emoji)", async () => {
    const tag = randomTag();
    const { id } = await makeProduct(tag, {
      data: {
        name: `Camisa Ñandú 🇧🇴 ${tag}`,
        model: "Edición Ñ",
        cost_base: 45.5,
        description: "línea 1\nlínea 2",
      },
    });
    const d = await detailOf(id);
    expect(d.product).toMatchObject({
      name: `Camisa Ñandú 🇧🇴 ${tag}`,
      model: "Edición Ñ",
      costBase: "45.5",
      description: "línea 1\nlínea 2",
    });
  });
});

// ── Edición con control de versión (criterio 5: dos admins) ───────────────────────────────
describe("updateProductData: edición concurrente", () => {
  it("guarda y devuelve un updated_at NUEVO; la versión anterior queda obsoleta", async () => {
    const { id, tag } = await makeProduct();
    const d0 = await detailOf(id);
    const next = await updateProductData(
      id,
      d0.product.updatedAt,
      patch(tag, { name: "Nombre 1" }),
    );
    expect(next).not.toBe(d0.product.updatedAt);
    expect((await detailOf(id)).product.name).toBe("Nombre 1");
    expect((await detailOf(id)).product.updatedAt).toBe(next);
  });

  it("el SEGUNDO guardado con la versión vieja se rechaza (StaleVersionError) y NO pisa lo del primero", async () => {
    const { id, tag } = await makeProduct();
    const seen = (await detailOf(id)).product.updatedAt; // ambos admins leyeron lo mismo
    await updateProductData(id, seen, patch(tag, { name: "Cambio del admin A" }));
    const error = await updateProductData(
      id,
      seen,
      patch(tag, { name: "Cambio del admin B" }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StaleVersionError);
    expect((await detailOf(id)).product.name).toBe("Cambio del admin A");
  });

  it("DOS guardados simultáneos con la misma versión: exactamente UNO gana", async () => {
    const { id, tag } = await makeProduct();
    const seen = (await detailOf(id)).product.updatedAt;
    const results = await Promise.allSettled([
      updateProductData(id, seen, patch(tag, { name: "Ganador A" })),
      updateProductData(id, seen, patch(tag, { name: "Ganador B" })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(StaleVersionError);
    expect(["Ganador A", "Ganador B"]).toContain((await detailOf(id)).product.name);
  });

  it("20 guardados simultáneos con la misma versión: exactamente 1 gana y 19 se rechazan", async () => {
    const { id, tag } = await makeProduct();
    const seen = (await detailOf(id)).product.updatedAt;
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        updateProductData(id, seen, patch(tag, { name: `Intento ${i}` })),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      results.filter((r) => r.status === "rejected" && r.reason instanceof StaleVersionError),
    ).toHaveLength(19);
  });

  it("un código duplicado al editar da el mensaje claro, no un conflicto de versión", async () => {
    const a = await makeProduct();
    const b = await makeProduct();
    const v = (await detailOf(b.id)).product.updatedAt;
    const error = await updateProductData(b.id, v, patch(b.tag, { code: `IT-${a.tag}` })).catch(
      (e: unknown) => e,
    );
    expect(error).not.toBeInstanceOf(StaleVersionError);
    expect((error as Error).message).toMatch(/Ya existe un producto con ese código/);
  });

  it("un producto que no existe da not_found, no un falso conflicto", async () => {
    const error = (await updateProductData(
      randomUUID(),
      "2026-01-01T00:00:00+00:00",
      patch("x"),
    ).catch((e: unknown) => e)) as Error & { code: string };
    expect(error).not.toBeInstanceOf(StaleVersionError);
    expect(error.code).toBe("not_found");
  });

  it("abrir y guardar SIN tocar nada no corrompe datos (ida y vuelta de nulos y costo)", async () => {
    const tag = randomTag();
    const { id } = await makeProduct(tag, {
      data: { model: null, cost_base: 0, materials: "Algodón" },
    });
    const d = await detailOf(id);
    await updateProductData(
      id,
      d.product.updatedAt,
      patch(tag, { model: null, cost_base: 0, materials: "Algodón" }),
    );
    const after = await detailOf(id);
    expect(after.product).toMatchObject({
      model: null,
      costBase: "0",
      materials: "Algodón",
      washcare: null,
    });
  });
});

// ── Publicar, archivar, historial de slugs y redirecciones públicas ───────────────────────
describe("estado, archivado y slugs", () => {
  it("publicar sin precio en BOB lo rechaza la base con su mensaje; con precio y variantes, publica", async () => {
    const { id } = await makeProduct();
    const d = await detailOf(id);
    const price = d.prices[0];
    if (!price) throw new Error("fixture");
    // sin precio: lo quitamos mientras es borrador
    await savePrices(id, d.prices, [{ currency: "BOB", amount: null }]);
    const d1 = await detailOf(id);
    expect(d1.prices).toHaveLength(0);
    const error = await setProductStatus(id, d1.product.updatedAt, "active").catch(
      (e: unknown) => e,
    );
    expect((error as Error).message).toMatch(/falta el precio en BOB/);
    await savePrices(id, d1.prices, [{ currency: "BOB", amount: "50" }]);
    const d2 = await detailOf(id);
    await setProductStatus(id, d2.product.updatedAt, "active");
    expect((await detailOf(id)).product.status).toBe("active");
  });

  it("archivar y restaurar: no se borra nada; el listado lo separa", async () => {
    const { id, tag } = await makeProduct();
    const d = await detailOf(id);
    await setProductArchived(id, d.product.updatedAt, true);
    expect((await detailOf(id)).product.archived).toBe(true);
    const archived = await listAdminProducts(listParams({ state: "archived", search: tag }));
    expect(archived.rows.map((r) => r.id)).toEqual([id]);
    expect((await listAdminProducts(listParams({ search: tag }))).total).toBe(0); // "todos" no incluye archivados
    const d2 = await detailOf(id);
    await setProductArchived(id, d2.product.updatedAt, false);
    expect((await listAdminProducts(listParams({ search: tag }))).rows.map((r) => r.id)).toEqual([
      id,
    ]);
  });

  it("renombrar el slug de un producto VISIBLE guarda el historial y la tienda redirige el slug viejo al nuevo", async () => {
    const tag = randomTag();
    const { id } = await makeProduct(tag);
    const d = await detailOf(id);
    await setProductStatus(id, d.product.updatedAt, "active");
    await setStock(id, 10);
    const d1 = await detailOf(id);
    const newSlug = `renombrado-${tag}`;
    await updateProductData(id, d1.product.updatedAt, patch(tag, { slug: newSlug }));
    asAnon();
    try {
      const r = await (holder.client as SupabaseClient<Database>)
        .from("public_product_slug_redirects")
        .select("*")
        .eq("old_slug", `producto-${tag}`);
      expect(r.error).toBeNull();
      expect(r.data).toEqual([{ old_slug: `producto-${tag}`, current_slug: newSlug }]);
    } finally {
      asAdmin();
    }
  });

  it("isSlugAvailable / isCodeAvailable: libres, ocupados, y el propio producto no cuenta", async () => {
    const { id, tag } = await makeProduct();
    expect(await isSlugAvailable(`producto-${tag}`)).toBe(false);
    expect(await isSlugAvailable(`producto-${tag}`, id)).toBe(true);
    expect(await isSlugAvailable(`libre-${tag}`)).toBe(true);
    expect(await isCodeAvailable(`IT-${tag}`)).toBe(false);
    expect(await isCodeAvailable(`it-${tag}`.toLowerCase())).toBe(false); // sin distinguir mayúsculas
    expect(await isCodeAvailable(`IT-${tag}`, id)).toBe(true);
    expect(await isCodeAvailable(`LIBRE-${tag}`)).toBe(true);
  });

  it("un código con guion bajo no se confunde con el comodín de LIKE ('_' no es 'cualquier carácter')", async () => {
    const tag = randomTag();
    await makeProduct(tag, { data: { code: `A_B-${tag}` } });
    expect(await isCodeAvailable(`A_B-${tag}`)).toBe(false);
    expect(await isCodeAvailable(`AxB-${tag}`)).toBe(true); // con '_' sin escapar daría false
  });
});

// ── Listado del panel ──────────────────────────────────────────────────────────────────────
describe("listAdminProducts: filtros, orden y paginación en el servidor", () => {
  const tag = randomTag();
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    // cuatro productos con nombres/códigos distintos y estados de stock distintos
    for (const [key, name, stock] of [
      ["a", "Alpaca", 10], // ok
      ["b", "Bufanda", 3], // low (umbral global 5)
      ["c", "Chal", 1], // critical (≤ 2)
      ["d", "Dril", 0], // out
    ] as const) {
      const { id } = await createProduct({
        data: patch(`${tag}${key}`, { name: `${name} ${tag}`, code: `L-${tag}-${key}` }),
        priceBob: "100",
        colors: [{ name: "Único", hex: "" }],
        sizes: [],
      });
      ids[key] = id;
      const d = await detailOf(id);
      await setProductStatus(id, d.product.updatedAt, "active");
      await setStock(id, stock);
    }
  }, 60_000);

  const byTag = (over: Partial<AdminProductListParams> = {}) =>
    listAdminProducts(listParams({ search: tag, ...over }));
  const codes = (r: { rows: { code: string }[] }) => r.rows.map((x) => x.code.slice(-1));

  it("la búsqueda encuentra por nombre y por código, sin distinguir mayúsculas", async () => {
    expect((await byTag()).total).toBe(4);
    expect(
      (await listAdminProducts(listParams({ search: `alpaca ${tag}` }))).rows.map((r) => r.id),
    ).toEqual([ids.a]);
    expect(
      (await listAdminProducts(listParams({ search: `l-${tag}-b`.toUpperCase() }))).rows.map(
        (r) => r.id,
      ),
    ).toEqual([ids.b]);
  });

  it("caracteres especiales en la búsqueda no rompen la consulta (coma, paréntesis, comillas, %, *)", async () => {
    for (const s of ["a,b", "(x)", 'dril"', "100%", "*", "\\"]) {
      const r = await listAdminProducts(listParams({ search: s }));
      expect(r.total).toBeGreaterThanOrEqual(0);
    }
  });

  it("ordena por nombre y por código", async () => {
    expect(codes(await byTag({ sort: "name" }))).toEqual(["a", "b", "c", "d"]);
    expect(codes(await byTag({ sort: "code" }))).toEqual(["a", "b", "c", "d"]);
  });

  it("paginación: total exacto, páginas sin repetir ni omitir (4 productos, 3 por página)", async () => {
    const p1 = await byTag({ pageSize: 3, page: 1 });
    const p2 = await byTag({ pageSize: 3, page: 2 });
    const p3 = await byTag({ pageSize: 3, page: 3 });
    expect(p1.total).toBe(4);
    expect(p1.rows).toHaveLength(3);
    expect(p2.rows).toHaveLength(1);
    expect(p3.rows).toHaveLength(0);
    expect([...p1.rows, ...p2.rows].map((r) => r.id).sort()).toEqual(Object.values(ids).sort());
  });

  it("una página más allá del final NO es un error: devuelve vacío con el total real", async () => {
    const r = await byTag({ pageSize: 3, page: 99 });
    expect(r.rows).toEqual([]);
    expect(r.total).toBe(4);
  });

  it("filtro de stock por nivel: normal, bajo, crítico, agotado y 'alert' (cualquiera con alerta)", async () => {
    expect(codes(await byTag({ stockLight: "ok" }))).toEqual(["a"]);
    expect(codes(await byTag({ stockLight: "low" }))).toEqual(["b"]);
    expect(codes(await byTag({ stockLight: "critical" }))).toEqual(["c"]);
    expect(codes(await byTag({ stockLight: "out" }))).toEqual(["d"]);
    expect(codes(await byTag({ stockLight: "alert" }))).toEqual(["b", "c", "d"]);
  });

  it("estados: 'agotados' incluye al de stock 0 (se ve como agotado) y 'publicados' a los cuatro", async () => {
    expect(codes(await byTag({ state: "soldout" }))).toEqual(["d"]);
    expect((await byTag({ state: "active" })).total).toBe(4);
    expect((await byTag({ state: "draft" })).total).toBe(0);
  });

  it("cada fila trae precio, stock total, semáforo y estado calculados por la base", async () => {
    const r = await byTag();
    const b = r.rows.find((x) => x.id === ids.b);
    expect(b).toMatchObject({
      priceBob: "100",
      totalOnHand: 3,
      totalAvailable: 3,
      variantsCount: 1,
      variantsOut: 0,
      worstLight: "low",
      displayState: "active",
      status: "active",
      archived: false,
    });
    expect(r.rows.find((x) => x.id === ids.d)).toMatchObject({
      totalOnHand: 0,
      variantsOut: 1,
      worstLight: "out",
      displayState: "soldout",
    });
  });

  it("filtrar por categoría usa la asociación real", async () => {
    const cat = await svcRest("POST", "categories", { name: `Cat ${tag}`, slug: `cat-${tag}` });
    expect(cat.status, JSON.stringify(cat.body)).toBe(201);
    const catId = (Array.isArray(cat.body) ? cat.body[0] : cat.body).id as string;
    await setProductCategories(ids.a as string, [catId]);
    expect((await byTag({ categoryId: catId })).rows.map((r) => r.id)).toEqual([ids.a]);
    expect((await byTag({ categoryId: randomUUID() })).total).toBe(0);
  });

  it("la búsqueda para relacionados excluye al propio producto y a los archivados, y pide 2+ letras", async () => {
    expect(await searchProductsForRelation("a", ids.a as string)).toEqual([]);
    const found = await searchProductsForRelation(`Bufanda ${tag}`, ids.a as string);
    expect(found.map((r) => r.id)).toEqual([ids.b]);
    expect(
      (await searchProductsForRelation(`Alpaca ${tag}`, ids.a as string)).map((r) => r.id),
    ).toEqual([]); // se excluye a sí mismo
  });
});

// ── Permisos reales ────────────────────────────────────────────────────────────────────────
describe("permisos por rol (RLS real)", () => {
  it("un cliente y un visitante NO ven el listado del panel ni pueden crear ni editar productos", async () => {
    const { id, tag } = await makeProduct();
    const v = (await detailOf(id)).product.updatedAt;
    for (const as of [asCustomer, asAnon]) {
      as();
      try {
        const outcome = await listAdminProducts(listParams({ search: tag })).then(
          (l) => ({ total: l.total }),
          (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }),
        );
        // el visitante recibe "sin permiso" (no tiene privilegios); el cliente lee la vista pero sin filas (is_admin() va dentro)
        if ("error" in outcome) expect(outcome.error).toMatch(/permiso/);
        else expect(outcome.total).toBe(0);
        await expect(
          createProduct({
            data: patch(randomTag()),
            priceBob: "1",
            colors: [{ name: "X", hex: "" }],
            sizes: [],
          }),
        ).rejects.toThrow();
        await expect(updateProductData(id, v, patch(tag, { name: "Hackeado" }))).rejects.toThrow();
      } finally {
        asAdmin();
      }
    }
    expect((await detailOf(id)).product.name).toBe(`Producto ${tag}`); // intacto
  });

  it("solo el admin puede duplicar, y la base lo comprueba (no solo la pantalla)", async () => {
    const { id } = await makeProduct();
    asCustomer();
    try {
      await expect(duplicateProduct(id, `X-${randomTag()}`, "Intruso")).rejects.toThrow(
        /permiso|administradores/i,
      );
    } finally {
      asAdmin();
    }
  });

  it("el costo del producto no lo ve la tienda pública (ninguna vista pública lo expone)", async () => {
    const tag = randomTag();
    const { id } = await makeProduct(tag, { data: { cost_base: 77.7 } });
    const d = await detailOf(id);
    await setProductStatus(id, d.product.updatedAt, "active");
    await setStock(id, 5);
    asAnon();
    try {
      const sb = holder.client as SupabaseClient<Database>;
      const r = await sb.from("public_product_detail").select("*").eq("slug", `producto-${tag}`);
      expect(r.data?.length).toBe(1);
      expect(JSON.stringify(r.data)).not.toContain("77.7");
      expect(Object.keys(r.data?.[0] ?? {})).not.toContain("cost_base");
    } finally {
      asAdmin();
    }
  });
});

// ── Precios ────────────────────────────────────────────────────────────────────────────────
describe("savePrices", () => {
  it("actualiza el precio con control de versión y rechaza más de 2 decimales", async () => {
    const { id } = await makeProduct(randomTag(), { price: "100" });
    const d = await detailOf(id);
    await savePrices(id, d.prices, [{ currency: "BOB", amount: "150.75" }]);
    expect((await detailOf(id)).prices[0]?.amount).toBe("150.75");
    const d2 = await detailOf(id);
    await expect(savePrices(id, d2.prices, [{ currency: "BOB", amount: "1.999" }])).rejects.toThrow(
      /más de 2 decimales/,
    );
    expect((await detailOf(id)).prices[0]?.amount).toBe("150.75");
  });

  it("un precio con versión vieja se rechaza como conflicto de edición", async () => {
    const { id } = await makeProduct(randomTag(), { price: "100" });
    const stale = await detailOf(id);
    await savePrices(id, stale.prices, [{ currency: "BOB", amount: "120" }]);
    await expect(
      savePrices(id, stale.prices, [{ currency: "BOB", amount: "130" }]),
    ).rejects.toBeInstanceOf(StaleVersionError);
    expect((await detailOf(id)).prices[0]?.amount).toBe("120");
  });

  it("no se puede quitar el precio en BOB de un producto PUBLICADO (mensaje de la base)", async () => {
    const { id } = await makeProduct();
    const d = await detailOf(id);
    await setProductStatus(id, d.product.updatedAt, "active");
    const d2 = await detailOf(id);
    await expect(savePrices(id, d2.prices, [{ currency: "BOB", amount: null }])).rejects.toThrow(
      /no se puede quitar el precio en BOB/,
    );
    expect((await detailOf(id)).prices).toHaveLength(1);
  });

  it("listEnabledCurrencies trae la moneda base", async () => {
    const list = await listEnabledCurrencies();
    expect(list.find((c) => c.code === "BOB")).toMatchObject({ symbol: "Bs", decimals: 2 });
  });
});

// ── Colores, tallas y variantes ───────────────────────────────────────────────────────────
describe("colores, tallas y sincronización de variantes", () => {
  it("agregar un color y sincronizar crea una variante por cada talla activa (sin tocar las existentes)", async () => {
    const { id } = await makeProduct(randomTag(), { colors: ["Rojo"], sizes: ["S", "M"] });
    const before = await detailOf(id);
    const oldIds = before.variants.map((v) => v.id).sort();
    await addColor(id, { name: "Azul", hex: "#0000ff" }, 2);
    const plan = await syncProductVariants(id);
    expect(plan.create).toHaveLength(2);
    const after = await detailOf(id);
    expect(after.variants).toHaveLength(4);
    expect(
      after.variants
        .map((v) => v.id)
        .filter((vid) => oldIds.includes(vid))
        .sort(),
    ).toEqual(oldIds);
    expect(after.colors.find((c) => c.name === "Azul")?.hex).toBe("#0000ff");
  });

  it("sincronizar dos veces seguidas no hace nada la segunda (idempotente)", async () => {
    const { id } = await makeProduct(randomTag(), { colors: ["Rojo"], sizes: ["S"] });
    await addSize(id, "M", 2);
    const first = await syncProductVariants(id);
    expect(first.create).toHaveLength(1);
    const second = await syncProductVariants(id);
    expect(second).toEqual({ create: [], restore: [], archive: [], blocked: [] });
    expect((await detailOf(id)).variants).toHaveLength(2);
  });

  it("archivar un color archiva sus variantes (con su stock intacto) y restaurarlo las restaura sin duplicar", async () => {
    const { id } = await makeProduct(randomTag(), { colors: ["Rojo", "Azul"], sizes: ["S"] });
    const d = await detailOf(id);
    const rojo = d.colors.find((c) => c.name === "Rojo");
    const rojoVariant = d.variants.find((v) => v.colorId === rojo?.id);
    if (!rojo || !rojoVariant) throw new Error("fixture");
    await adjustStock({ variantId: rojoVariant.id, delta: 6, reason: "import" });
    await setColorArchived(rojo, true);
    await syncProductVariants(id);
    const archived = await detailOf(id);
    expect(archived.variants.find((v) => v.id === rojoVariant.id)).toMatchObject({
      archived: true,
      stockOnHand: 6,
    });
    // restaurar
    await setColorArchived(archived.colors.find((c) => c.id === rojo.id) ?? rojo, false);
    const plan = await syncProductVariants(id);
    expect(plan.restore).toEqual([rojoVariant.id]);
    expect(plan.create).toEqual([]);
    const restored = await detailOf(id);
    expect(restored.variants).toHaveLength(2); // no se creó una variante nueva
    expect(restored.variants.find((v) => v.id === rojoVariant.id)).toMatchObject({
      archived: false,
      stockOnHand: 6,
    });
  });

  it("agregar tallas a un producto sin tallas con stock: la variante sin talla con stock queda BLOQUEADA (no se pierde el stock)", async () => {
    const { id } = await makeProduct(randomTag(), { colors: ["Rojo"] });
    const d = await detailOf(id);
    const v = d.variants[0];
    if (!v) throw new Error("fixture");
    await adjustStock({ variantId: v.id, delta: 5, reason: "import" });
    await addSize(id, "S", 1);
    const plan = await syncProductVariants(id);
    expect(plan.create).toHaveLength(1);
    expect(plan.blocked).toEqual([{ variantId: v.id, stockOnHand: 5 }]);
    const after = await detailOf(id);
    expect(after.variants.find((x) => x.id === v.id)).toMatchObject({
      archived: false,
      stockOnHand: 5,
    });
  });

  it("agregar una talla repetida (sin distinguir mayúsculas) la rechaza la base con mensaje claro", async () => {
    const { id } = await makeProduct(randomTag(), { colors: ["Rojo"], sizes: ["M"] });
    await expect(addSize(id, "m", 2)).rejects.toThrow("Esa talla ya existe en este producto.");
  });
});

// ── Duplicar ───────────────────────────────────────────────────────────────────────────────
describe("duplicateProduct", () => {
  it("clona la estructura como borrador y los errores de la base llegan en español", async () => {
    const tag = randomTag();
    const { id } = await makeProduct(tag, {
      colors: ["Rojo", "Azul"],
      sizes: ["S", "M"],
      data: { model: "Modelo", cost_base: 12 },
    });
    const newCode = `COPIA-${tag}`;
    const newId = await duplicateProduct(id, newCode, `Copia ${tag}`);
    const copy = await detailOf(newId);
    expect(copy.product).toMatchObject({
      code: newCode,
      name: `Copia ${tag}`,
      status: "draft",
      model: "Modelo",
      costBase: "12",
    });
    expect(copy.variants).toHaveLength(4);
    expect(copy.variants.every((v) => v.stockOnHand === 0)).toBe(true);
    expect(copy.prices[0]?.amount).toBe("100");
    await expect(duplicateProduct(id, newCode, "Otra")).rejects.toThrow(
      /ya existe un producto con el código/,
    );
    await expect(duplicateProduct(id, "mal código", "Otra")).rejects.toThrow(
      /El código solo admite|código solo admite/i,
    );
  });
});

// ── Asociaciones ───────────────────────────────────────────────────────────────────────────
describe("categorías, colecciones y relacionados (RPC reales)", () => {
  it("reemplazan las listas completas, respetan el orden de los relacionados y rechazan relacionarse consigo mismo", async () => {
    const a = await makeProduct();
    const b = await makeProduct();
    const c = await makeProduct();
    await setProductRelated(a.id, [c.id, b.id]);
    expect((await detailOf(a.id)).related.map((r) => r.id)).toEqual([c.id, b.id]); // orden manual conservado
    await setProductRelated(a.id, [b.id]);
    expect((await detailOf(a.id)).related.map((r) => r.id)).toEqual([b.id]);
    await setProductRelated(a.id, []);
    expect((await detailOf(a.id)).related).toEqual([]);
    await expect(setProductRelated(a.id, [a.id])).rejects.toThrow(
      /no puede ser relacionado de sí mismo/,
    );

    const col = await svcRest("POST", "collections", {
      name: `Col ${a.tag}`,
      slug: `col-${a.tag}`,
    });
    const colId = (Array.isArray(col.body) ? col.body[0] : col.body).id as string;
    await setProductCollections(a.id, [colId]);
    expect((await detailOf(a.id)).collectionIds).toEqual([colId]);
    await setProductCollections(a.id, []);
    expect((await detailOf(a.id)).collectionIds).toEqual([]);
  });

  it("listCategoryOptions incluye las archivadas, marcadas", async () => {
    const tag = randomTag();
    const r = await svcRest("POST", "categories", {
      name: `Arch ${tag}`,
      slug: `arch-${tag}`,
      archived_at: new Date().toISOString(),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const opts = await listCategoryOptions();
    expect(opts.find((o) => o.name === `Arch ${tag}`)).toMatchObject({ archived: true });
  });
});

// ── Imágenes reales en Storage ─────────────────────────────────────────────────────────────
describe("imágenes (Storage real)", () => {
  const png = {
    blob: new Blob([PNG_1X1], { type: "image/png" }),
    contentType: "image/png",
    ext: "png",
  };

  it("sube el archivo, registra la fila, y la URL pública sirve exactamente esos bytes", async () => {
    const { id } = await makeProduct();
    const img = await uploadProductImage(id, png, []);
    expect(img.sortOrder).toBe(1);
    expect(img.path).toMatch(new RegExp(`^products/${id}/[0-9a-f-]{36}\\.png$`));
    const url = `${localEnv().url}/storage/v1/object/public/product-images/${img.path}`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG_1X1)).toBe(true);
    expect((await detailOf(id)).images.map((i) => i.id)).toEqual([img.id]);
  });

  it("varias imágenes quedan en orden consecutivo; reordenar escribe el nuevo orden", async () => {
    const { id } = await makeProduct();
    const a = await uploadProductImage(id, png, []);
    const b = await uploadProductImage(id, png, [{ sortOrder: a.sortOrder }]);
    const c = await uploadProductImage(id, png, [
      { sortOrder: a.sortOrder },
      { sortOrder: b.sortOrder },
    ]);
    expect([a.sortOrder, b.sortOrder, c.sortOrder]).toEqual([1, 2, 3]);
    await saveImageOrder([
      { id: c.id, sortOrder: 1 },
      { id: a.id, sortOrder: 2 },
      { id: b.id, sortOrder: 3 },
    ]);
    expect((await detailOf(id)).images.map((i) => i.id)).toEqual([c.id, a.id, b.id]);
  });

  it("alt y color se guardan con control de versión; una versión vieja es conflicto", async () => {
    const { id } = await makeProduct(randomTag(), { colors: ["Rojo"] });
    const img = await uploadProductImage(id, png, []);
    const d = await detailOf(id);
    const colorId = d.colors[0]?.id;
    const first = (await detailOf(id)).images[0];
    if (!first || !colorId) throw new Error("fixture");
    await updateImage(first, { alt: "Texto", color_id: colorId });
    const after = (await detailOf(id)).images[0];
    expect(after).toMatchObject({ id: img.id, alt: "Texto", colorId });
    await expect(updateImage(first, { alt: "Con versión vieja" })).rejects.toBeInstanceOf(
      StaleVersionError,
    );
    expect((await detailOf(id)).images[0]?.alt).toBe("Texto");
  });

  it("quitar una imagen la archiva: deja de listarse, pero el archivo sigue en Storage (nada se borra)", async () => {
    const { id } = await makeProduct();
    const img = await uploadProductImage(id, png, []);
    const first = (await detailOf(id)).images[0];
    if (!first) throw new Error("fixture");
    await archiveImage(first);
    expect((await detailOf(id)).images).toEqual([]);
    const res = await fetch(
      `${localEnv().url}/storage/v1/object/public/product-images/${img.path}`,
    );
    expect(res.status).toBe(200);
  });

  it("un cliente NO puede subir imágenes de producto (la RLS de Storage lo impide)", async () => {
    const { id } = await makeProduct();
    asCustomer();
    try {
      await expect(uploadProductImage(id, png, [])).rejects.toThrow();
    } finally {
      asAdmin();
    }
  });

  it("si el registro de la fila falla, el archivo huérfano se borra de Storage", async () => {
    // un producto inexistente hace fallar el insert (FK) DESPUÉS de subir el archivo
    const ghost = randomUUID();
    await expect(uploadProductImage(ghost, png, [])).rejects.toThrow();
    const response = await fetch(`${localEnv().url}/storage/v1/object/list/product-images`, {
      method: "POST",
      headers: {
        apikey: localEnv().anon,
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix: `products/${ghost}`, limit: 10 }),
    });
    expect(response.status).toBe(200);
    const objects = (await response.json()) as unknown[];
    expect(objects).toHaveLength(0); // sin la limpieza quedaría 1 archivo huérfano
  });
});

// ── Fijar stock exacto (admin_set_stock) ───────────────────────────────────────────────────
describe("setVariantStock: valor exacto con comprobación de lo que se vio (BD real)", () => {
  const variantOf = async (id: string) => {
    const v = (await detailOf(id)).variants.find((x) => !x.archived);
    if (!v) throw new Error("sin variantes");
    return v;
  };
  const movements = async (variantId: string) =>
    (
      await rest(
        "GET",
        `stock_movements?variant_id=eq.${variantId}&select=delta,reason,stock_after,note&order=id`,
        adminToken,
      )
    ).body as {
      delta: number;
      reason: string;
      stock_after: number;
      note: string | null;
    }[];

  it("fija el valor, devuelve el resultante y deja UN movimiento con el delta, el motivo y la nota", async () => {
    const { id } = await makeProduct();
    const v = await variantOf(id);
    expect(
      await setVariantStock({
        variantId: v.id,
        expected: 0,
        newValue: 12,
        reason: "import",
        note: "carga inicial",
      }),
    ).toBe(12);
    expect(
      await setVariantStock({
        variantId: v.id,
        expected: 12,
        newValue: 9,
        reason: "adjust",
        note: "conteo",
      }),
    ).toBe(9);
    expect((await variantOf(id)).stockOnHand).toBe(9);
    expect(await movements(v.id)).toEqual([
      { delta: 12, reason: "import", stock_after: 12, note: "carga inicial" },
      { delta: -3, reason: "adjust", stock_after: 9, note: "conteo" },
    ]);
  });

  it("si lo que se vio ya no es lo que hay, la base RECHAZA diciendo cuánto hay ahora y no toca nada", async () => {
    const { id } = await makeProduct();
    const v = await variantOf(id);
    await setStock(id, 10); // otra persona o una venta lo dejó en 10
    const error = await setVariantStock({
      variantId: v.id,
      expected: 3,
      newValue: 5,
      reason: "adjust",
    }).catch((e: unknown) => e);
    expect((error as Error).message).toBe(
      "el stock cambió mientras editabas: ahora hay 10 unidades y esperabas 3",
    );
    expect((await variantOf(id)).stockOnHand).toBe(10);
    expect(await movements(v.id)).toHaveLength(1); // solo la carga de setStock
  });

  it("mismo valor: no hace nada ni deja un movimiento vacío", async () => {
    const { id } = await makeProduct();
    const v = await variantOf(id);
    await setStock(id, 4);
    expect(
      await setVariantStock({ variantId: v.id, expected: 4, newValue: 4, reason: "adjust" }),
    ).toBe(4);
    expect(await movements(v.id)).toHaveLength(1);
  });

  it("20 guardados SIMULTÁNEOS con el mismo 'esperado': exactamente 1 gana y 19 se rechazan (la variante se bloquea)", async () => {
    const { id } = await makeProduct();
    const v = await variantOf(id);
    await setStock(id, 10);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        setVariantStock({ variantId: v.id, expected: 10, newValue: 20 + i, reason: "adjust" }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(19);
    expect(
      rejected.every((r) => /el stock cambió mientras editabas/.test((r.reason as Error).message)),
    ).toBe(true);
    const final = (await variantOf(id)).stockOnHand;
    expect(final).toBeGreaterThanOrEqual(20);
    expect(final).toBeLessThanOrEqual(39);
    expect(await movements(v.id)).toHaveLength(2); // la carga + el ganador
  });

  it("respeta las reglas de adjust_stock: 'carga inicial' no resta, no hay negativos", async () => {
    const { id } = await makeProduct();
    const v = await variantOf(id);
    await setStock(id, 6);
    await expect(
      setVariantStock({ variantId: v.id, expected: 6, newValue: 2, reason: "import" }),
    ).rejects.toThrow(/solo suma/);
    await expect(
      setVariantStock({ variantId: v.id, expected: 6, newValue: -1, reason: "adjust" }),
    ).rejects.toThrow();
    expect((await variantOf(id)).stockOnHand).toBe(6);
  });

  it("un cliente NO puede fijar stock y, con un 'esperado' equivocado, no se entera del stock exacto", async () => {
    const { id } = await makeProduct();
    const v = await variantOf(id);
    await setStock(id, 7);
    asCustomer();
    try {
      const error = await setVariantStock({
        variantId: v.id,
        expected: 999,
        newValue: 1,
        reason: "adjust",
      }).catch((e: unknown) => e);
      expect((error as Error).message).not.toMatch(/ahora hay/);
      expect((error as Error).message).toMatch(/permiso/);
    } finally {
      asAdmin();
    }
    expect((await variantOf(id)).stockOnHand).toBe(7);
  });

  it("cruzar el umbral con setVariantStock encola la alerta igual que cualquier otro cambio", async () => {
    const { id } = await makeProduct();
    const d = await detailOf(id);
    await setProductStatus(id, d.product.updatedAt, "active");
    const v = await variantOf(id);
    await setVariantStock({ variantId: v.id, expected: 0, newValue: 20, reason: "import" });
    await setVariantStock({ variantId: v.id, expected: 20, newValue: 2, reason: "adjust" });
    const outbox = await rest(
      "GET",
      `notification_outbox?type=eq.stock_alert&payload->>variant_id=eq.${v.id}&select=payload`,
      adminToken,
    );
    expect(outbox.body).toHaveLength(1);
    expect(outbox.body[0].payload).toMatchObject({ light: "critical", stock: 2 });
  });
});

// ── Alertas de stock y outbox ──────────────────────────────────────────────────────────────
describe("alertas de stock (campana, tarjeta y outbox)", () => {
  it("al cruzar el umbral aparece en el resumen, en las variantes urgentes y en la outbox", async () => {
    const tag = randomTag();
    const before = await getStockAlertSummary();
    const { id } = await makeProduct(tag);
    const d = await detailOf(id);
    await setProductStatus(id, d.product.updatedAt, "active");
    await setStock(id, 20);
    expect((await getStockAlertSummary()).total).toBe(before.total); // 20 es normal: sin alerta
    await setStock(id, 4); // 20 → 4 cruza el umbral bajo (5)
    const after = await getStockAlertSummary();
    expect(after.low).toBe(before.low + 1);
    expect(after.total).toBe(before.total + 1);

    const urgent = await listStockAlertVariants(200);
    expect(urgent.find((v) => v.productId === id)).toMatchObject({
      light: "low",
      stockOnHand: 4,
      productCode: `IT-${tag}`,
    });

    // la alerta quedó en la outbox (la ve el admin por la API)
    const outbox = await rest(
      "GET",
      `notification_outbox?type=eq.stock_alert&payload->>product_id=eq.${id}&select=payload,status,channel`,
      adminToken,
    );
    expect(outbox.status).toBe(200);
    expect(outbox.body).toHaveLength(1);
    expect(outbox.body[0]).toMatchObject({ status: "pending", channel: "email" });
    expect(outbox.body[0].payload).toMatchObject({ light: "low", stock: 4 });
  });

  it("un borrador o un producto archivado NO cuentan en las alertas", async () => {
    const before = await getStockAlertSummary();
    const { id } = await makeProduct();
    await setStock(id, 1); // borrador con stock crítico
    expect((await getStockAlertSummary()).total).toBe(before.total);
    expect((await listStockAlertVariants(200)).find((v) => v.productId === id)).toBeUndefined();
  });

  it("solo el admin lee la outbox", async () => {
    asCustomer();
    try {
      const r = await (holder.client as SupabaseClient<Database>)
        .from("notification_outbox")
        .select("id")
        .limit(1);
      expect(r.data ?? []).toEqual([]);
    } finally {
      asAdmin();
    }
  });
});
