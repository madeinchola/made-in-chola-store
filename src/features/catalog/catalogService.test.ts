import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeConfig } from "./testing/fakeSupabase";

const state = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => state.client }));

import {
  MAX_FILTER_IDS,
  getCategoryTree,
  getHome,
  getNewsBanner,
  getProductBySlug,
  getStoreSettings,
  listCategories,
  listProducts,
  searchProducts,
} from "./catalogService";

let calls: ReturnType<typeof createFakeSupabase>["calls"];
function use(config: FakeConfig) {
  const fake = createFakeSupabase(config);
  state.client = fake.client;
  calls = fake.calls;
}

const p = (
  id: string,
  name: string,
  price: number,
  createdAt: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  slug: name.toLowerCase().replace(/ /g, "-"),
  name,
  is_new: false,
  price_bob: price,
  colors_count: 1,
  sold_out: false,
  cover_path: null,
  cover_alt: null,
  created_at: createdAt,
  ...extra,
});

const PRODUCTS = [
  p("p1", "Chaqueta Japandi", 560, "2026-10-01T00:00:00Z"),
  p("p2", "Sombrero Chakra", 450.5, "2026-10-03T00:00:00Z"),
  p("p3", "Cartera Verde", 300, "2026-10-02T00:00:00Z"),
  p("p4", "Bufanda", 300, "2026-10-04T00:00:00Z"),
];
const CATEGORIES = [
  { id: "ropa", parent_id: null, name: "Ropa", slug: "ropa", description: null, sort_order: 0 },
  {
    id: "chaquetas",
    parent_id: "ropa",
    name: "Chaquetas",
    slug: "chaquetas",
    description: null,
    sort_order: 0,
  },
  {
    id: "sombreros",
    parent_id: null,
    name: "Sombreros",
    slug: "sombreros",
    description: null,
    sort_order: 1,
  },
];
const PRODUCT_CATEGORIES = [
  { product_id: "p1", category_id: "chaquetas" }, // p1 está en una SUBcategoría de Ropa
  { product_id: "p4", category_id: "ropa" },
  { product_id: "p2", category_id: "sombreros" },
];
const COLLECTIONS = [
  {
    id: "verano",
    slug: "verano",
    name: "Verano",
    description: null,
    starts_at: null,
    ends_at: null,
    sort_order: 0,
  },
];
const PRODUCT_COLLECTIONS = [
  { product_id: "p1", collection_id: "verano", sort_order: 0 },
  { product_id: "p2", collection_id: "verano", sort_order: 1 },
];

beforeEach(() =>
  use({
    tables: {
      public_products: PRODUCTS,
      public_categories: CATEGORIES,
      public_product_categories: PRODUCT_CATEGORIES,
      public_collections: COLLECTIONS,
      public_product_collections: PRODUCT_COLLECTIONS,
    },
  }),
);

describe("listProducts", () => {
  it("sin filtros: todos, del más nuevo al más antiguo, con el total", async () => {
    const page = await listProducts();
    expect(page.items.map((i) => i.id)).toEqual(["p4", "p2", "p3", "p1"]);
    expect(page.total).toBe(4);
  });

  it("convierte el precio a Money exacto", async () => {
    const page = await listProducts({ sort: "name" });
    const sombrero = page.items.find((i) => i.id === "p2");
    expect(sombrero?.price).toEqual({ amount: 45050, currency: "BOB" });
  });

  it("orden por precio ascendente y descendente; los empates se desempatan por id (paginación estable)", async () => {
    expect((await listProducts({ sort: "price_asc" })).items.map((i) => i.id)).toEqual([
      "p3",
      "p4",
      "p2",
      "p1",
    ]);
    expect((await listProducts({ sort: "price_desc" })).items.map((i) => i.id)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
    ]);
  });

  it("orden por nombre respeta el español", async () => {
    expect((await listProducts({ sort: "name" })).items.map((i) => i.name)).toEqual([
      "Bufanda",
      "Cartera Verde",
      "Chaqueta Japandi",
      "Sombrero Chakra",
    ]);
  });

  it("pagina: limit/offset recortan la página pero el total sigue siendo el del filtro completo", async () => {
    const p1 = await listProducts({ sort: "price_asc", limit: 2, offset: 0 });
    const p2 = await listProducts({ sort: "price_asc", limit: 2, offset: 2 });
    expect(p1.items.map((i) => i.id)).toEqual(["p3", "p4"]);
    expect(p2.items.map((i) => i.id)).toEqual(["p2", "p1"]);
    expect(p1.total).toBe(4);
    expect(p2.total).toBe(4);
  });

  it("limit fuera de rango se corrige (0 → 1; 9999 → 100) y offset negativo → 0", async () => {
    expect((await listProducts({ limit: 0 })).items).toHaveLength(1);
    expect((await listProducts({ limit: 9999 })).items).toHaveLength(4);
    expect((await listProducts({ offset: -5, limit: 2 })).items.map((i) => i.id)).toEqual([
      "p4",
      "p2",
    ]);
    expect((await listProducts({ limit: 2.9 })).items).toHaveLength(2);
  });

  it("por categoría INCLUYE las subcategorías (Ropa trae también lo de Chaquetas)", async () => {
    const page = await listProducts({ categorySlug: "ropa", sort: "name" });
    expect(page.items.map((i) => i.id).sort()).toEqual(["p1", "p4"]);
    expect(page.total).toBe(2);
  });

  it("por una subcategoría solo trae lo suyo, no lo del padre", async () => {
    expect((await listProducts({ categorySlug: "chaquetas" })).items.map((i) => i.id)).toEqual([
      "p1",
    ]);
  });

  it("una categoría inexistente devuelve vacío y NO consulta productos", async () => {
    const page = await listProducts({ categorySlug: "no-existe" });
    expect(page).toEqual({ items: [], total: 0 });
    expect(calls.some((c) => c.name === "public_products")).toBe(false);
  });

  it("por colección: solo sus productos", async () => {
    const page = await listProducts({ collectionSlug: "verano", sort: "name" });
    expect(page.items.map((i) => i.id).sort()).toEqual(["p1", "p2"]);
  });

  it("una colección inexistente devuelve vacío", async () => {
    expect(await listProducts({ collectionSlug: "no-existe" })).toEqual({ items: [], total: 0 });
  });

  it("categoría + colección = intersección", async () => {
    const page = await listProducts({ categorySlug: "ropa", collectionSlug: "verano" });
    expect(page.items.map((i) => i.id)).toEqual(["p1"]);
  });

  it("intersección vacía → vacío sin consultar productos", async () => {
    const page = await listProducts({
      categorySlug: "sombreros",
      collectionSlug: "verano",
      sort: "name",
    });
    expect(page.items.map((i) => i.id)).toEqual(["p2"]); // p2 sí está en ambos
    const none = await listProducts({ categorySlug: "chaquetas", collectionSlug: "inexistente" });
    expect(none.total).toBe(0);
  });

  it("falla con un mensaje claro si el filtro supera el tope de ids de la URL", async () => {
    const many = Array.from({ length: MAX_FILTER_IDS + 1 }, (_, i) => ({
      product_id: `x${i}`,
      category_id: "ropa",
    }));
    use({
      tables: {
        public_categories: CATEGORIES,
        public_product_categories: many,
        public_products: [],
      },
    });
    await expect(listProducts({ categorySlug: "ropa" })).rejects.toMatchObject({
      code: "validation",
    });
  });

  it("un error de la BD se convierte en AppError", async () => {
    use({ tables: {}, errors: { public_products: { code: "42501", message: "denied" } } });
    await expect(listProducts()).rejects.toMatchObject({ name: "AppError", code: "forbidden" });
  });

  it("una fila con campos obligatorios vacíos falla en voz alta (no muestra un precio inventado)", async () => {
    use({
      tables: {
        public_products: [p("bad", "Sin precio", 0, "2026-10-01T00:00:00Z", { price_bob: null })],
      },
    });
    await expect(listProducts()).rejects.toThrow(/Respuesta incompleta/);
  });
});

describe("getProductBySlug", () => {
  const detailRow = {
    ...PRODUCTS[0]!,
    model: "Japandi",
    description: "Cuero",
    materials: null,
    washcare: null,
  };
  const base = () => ({
    public_product_detail: [detailRow],
    public_product_colors: [
      { id: "c2", product_id: "p1", name: "Negro", hex: "#303030", sort_order: 2 },
      { id: "c1", product_id: "p1", name: "Blanco", hex: "#EAE9E1", sort_order: 1 },
      { id: "cx", product_id: "OTRO", name: "Ajeno", hex: null, sort_order: 1 },
    ],
    public_product_sizes: [{ id: "s1", product_id: "p1", label: "XS", sort_order: 1 }],
    public_product_variants: [
      { id: "v1", product_id: "p1", color_id: "c1", size_id: "s1", stock_status: "in_stock" },
      { id: "v2", product_id: "p1", color_id: "c2", size_id: "s1", stock_status: "out" },
    ],
    public_product_images: [
      {
        id: "i2",
        product_id: "p1",
        color_id: null,
        path: "products/p1/b.jpg",
        alt: null,
        sort_order: 2,
      },
      {
        id: "i1",
        product_id: "p1",
        color_id: "c1",
        path: "products/p1/a.jpg",
        alt: "Blanca",
        sort_order: 1,
      },
    ],
    public_product_related: [
      { product_id: "p1", related_id: "p3", sort_order: 1 },
      { product_id: "p1", related_id: "p2", sort_order: 0 },
      { product_id: "p1", related_id: "p-oculto", sort_order: 2 },
    ],
    public_products: PRODUCTS,
  });

  it("arma el detalle con colores, tallas, variantes, imágenes y relacionados — ordenados y solo de ESTE producto", async () => {
    use({ tables: base() });
    const d = await getProductBySlug("chaqueta-japandi");
    expect(d?.product).toMatchObject({ id: "p1", model: "Japandi", description: "Cuero" });
    expect(d?.colors.map((c) => c.name)).toEqual(["Blanco", "Negro"]);
    expect(d?.sizes.map((s) => s.label)).toEqual(["XS"]);
    expect(d?.variants.map((v) => [v.id, v.stockStatus])).toEqual([
      ["v1", "in_stock"],
      ["v2", "out"],
    ]);
    expect(d?.images.map((i) => i.id)).toEqual(["i1", "i2"]);
  });

  it("los relacionados respetan el orden manual y descartan los que ya no son visibles", async () => {
    use({ tables: base() });
    const d = await getProductBySlug("chaqueta-japandi");
    expect(d?.related.map((r) => r.id)).toEqual(["p2", "p3"]); // p-oculto no existe en public_products
  });

  it("sin relacionados no hace la consulta extra de productos", async () => {
    use({ tables: { ...base(), public_product_related: [] } });
    await getProductBySlug("chaqueta-japandi");
    expect(calls.filter((c) => c.name === "public_products")).toHaveLength(0);
  });

  it("un slug inexistente o no público devuelve null (la UI muestra 404)", async () => {
    use({ tables: base() });
    expect(await getProductBySlug("no-existe")).toBeNull();
  });

  it("un error en cualquier consulta se propaga como AppError", async () => {
    use({ tables: base(), errors: { public_product_images: { code: "XX000", message: "boom" } } });
    await expect(getProductBySlug("chaqueta-japandi")).rejects.toMatchObject({
      name: "AppError",
      code: "unknown",
    });
  });
});

describe("searchProducts", () => {
  it("menos de 2 caracteres (o solo espacios) → vacío y SIN llamar al servidor", async () => {
    use({ tables: {}, rpc: { public_search_products: () => [] } });
    expect(await searchProducts("a")).toEqual([]);
    expect(await searchProducts("   ")).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("recorta la consulta y limita el tamaño a 1..100", async () => {
    use({ tables: {}, rpc: { public_search_products: () => [] } });
    await searchProducts("  chaq  ", 5000);
    await searchProducts("chaq", 0);
    expect(calls.map((c) => c.args)).toEqual([
      { p_query: "chaq", p_limit: 100 },
      { p_query: "chaq", p_limit: 1 },
    ]);
  });

  it("mapea los resultados a ProductSummary", async () => {
    use({ tables: {}, rpc: { public_search_products: () => [PRODUCTS[0]] } });
    const r = await searchProducts("chaq");
    expect(r[0]).toMatchObject({ id: "p1", price: { amount: 56000, currency: "BOB" } });
  });

  it("un error del servidor se propaga como AppError", async () => {
    use({ tables: {}, errors: { public_search_products: { code: "42501", message: "x" } } });
    await expect(searchProducts("chaq")).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("categorías, banner, ajustes y home", () => {
  it("listCategories es una lista PLANA ordenada por sort_order y luego por nombre", async () => {
    const cats = await listCategories();
    expect(cats.map((c) => c.slug)).toEqual(["chaquetas", "ropa", "sombreros"]);
  });

  it("getCategoryTree anida las subcategorías bajo su padre", async () => {
    const tree = await getCategoryTree();
    expect(tree.map((n) => n.slug)).toEqual(["ropa", "sombreros"]);
    expect(tree[0]?.children.map((n) => n.slug)).toEqual(["chaquetas"]);
  });

  it("getNewsBanner devuelve el primero o null", async () => {
    use({
      tables: {
        public_news_banners: [
          { id: "b1", message: "Hola", link_url: null },
          { id: "b2", message: "Otro", link_url: null },
        ],
      },
    });
    expect(await getNewsBanner()).toEqual({ id: "b1", message: "Hola", linkUrl: null });
    use({ tables: { public_news_banners: [] } });
    expect(await getNewsBanner()).toBeNull();
  });

  it("getStoreSettings devuelve un mapa clave → valor", async () => {
    use({ tables: { public_store_settings: [{ key: "whatsapp_orders", value: "+59167528677" }] } });
    expect(await getStoreSettings()).toEqual({ whatsapp_orders: "+59167528677" });
  });

  it("getHome une secciones y elementos", async () => {
    use({
      tables: {
        public_home_sections: [
          {
            id: "s1",
            kind: "category_tiles",
            sort_order: 1,
            title: null,
            body: null,
            cta_label: null,
            cta_url: null,
            media_kind: "none",
            media_path: null,
            media_alt: null,
            source_type: "none",
            source_category_id: null,
            source_collection_id: null,
            item_limit: 4,
          },
        ],
        public_home_section_items: [
          {
            id: "i1",
            section_id: "s1",
            sort_order: 1,
            label: "Carteras",
            link_url: "/c",
            media_kind: "none",
            media_path: null,
            media_alt: null,
            product_id: null,
            category_id: "x",
            collection_id: null,
          },
        ],
      },
    });
    const home = await getHome();
    expect(home).toHaveLength(1);
    expect(home[0]?.items[0]).toMatchObject({ label: "Carteras", categoryId: "x" });
  });

  it("un error en secciones o en elementos se propaga", async () => {
    use({ tables: {}, errors: { public_home_section_items: { code: "XX000", message: "x" } } });
    await expect(getHome()).rejects.toMatchObject({ code: "unknown" });
  });
});
