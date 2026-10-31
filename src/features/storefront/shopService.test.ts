import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeConfig } from "@/features/catalog/testing/fakeSupabase";
import { DEFAULT_QUERY, type ListingQuery } from "./listing/listParams";

const state = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => state.client }));

import { findSlugRedirect, getListingFacets, listProductsFiltered } from "./shopService";

let calls: ReturnType<typeof createFakeSupabase>["calls"];
function use(config: FakeConfig) {
  const fake = createFakeSupabase(config);
  state.client = fake.client;
  calls = fake.calls;
}
const rpcArgs = () => calls.filter((c) => c.kind === "rpc").at(-1)?.args ?? {};

const row = (id: string, price = 100) => ({
  id,
  slug: `p-${id}`,
  name: `Producto ${id}`,
  is_new: false,
  price_bob: price,
  colors_count: 2,
  sold_out: false,
  cover_path: null,
  cover_alt: null,
  created_at: "2026-01-01T00:00:00Z",
});
const q = (over: Partial<ListingQuery> = {}): ListingQuery => ({ ...DEFAULT_QUERY, ...over });

describe("listProductsFiltered", () => {
  beforeEach(() =>
    use({ tables: {}, rpc: { public_list_products: () => ({ total: 0, items: [] }) } }),
  );

  it("sin filtros manda solo el orden, el límite y el desplazamiento por defecto", async () => {
    await listProductsFiltered({ query: q() });
    expect(rpcArgs()).toEqual({
      p_in_stock_only: false,
      p_sort: "newest",
      p_limit: 24,
      p_offset: 0,
    });
  });

  it("manda cada filtro con el nombre que espera la función SQL", async () => {
    await listProductsFiltered({
      scope: { categorySlug: "ropa", collectionSlug: "verano" },
      query: q({
        colors: ["Rojo"],
        sizes: ["M"],
        minPrice: 10,
        maxPrice: 99.5,
        inStockOnly: true,
        sort: "price_asc",
      }),
    });
    expect(rpcArgs()).toEqual({
      p_category_slug: "ropa",
      p_collection_slug: "verano",
      p_colors: ["Rojo"],
      p_sizes: ["M"],
      p_min_price: 10,
      p_max_price: 99.5,
      p_in_stock_only: true,
      p_sort: "price_asc",
      p_limit: 24,
      p_offset: 0,
    });
  });

  it("el precio mínimo 0 SÍ se envía (no se confunde con «sin filtro»)", async () => {
    await listProductsFiltered({ query: q({ minPrice: 0 }) });
    expect(rpcArgs()).toMatchObject({ p_min_price: 0 });
  });

  it.each([
    [1, 24, 0],
    [2, 24, 24],
    [5, 24, 96],
    [3, 10, 20],
  ])("página %i con tamaño %i → desplazamiento %i", async (page, size, offset) => {
    await listProductsFiltered({ query: q({ page }), pageSize: size });
    expect(rpcArgs()).toMatchObject({ p_limit: size, p_offset: offset });
  });

  it("acota el tamaño de página a 1..100 y la página a ≥ 1", async () => {
    await listProductsFiltered({ query: q({ page: 0 }), pageSize: 1000 });
    expect(rpcArgs()).toMatchObject({ p_limit: 100, p_offset: 0 });
    await listProductsFiltered({ query: q(), pageSize: 0 });
    expect(rpcArgs()).toMatchObject({ p_limit: 1 });
  });

  it("convierte las filas en productos con dinero exacto y devuelve el total del servidor", async () => {
    use({
      tables: {},
      rpc: {
        public_list_products: () => ({ total: 57, items: [row("a", 450.5), row("b", 18.9)] }),
      },
    });
    const page = await listProductsFiltered({ query: q({ page: 3 }) });
    expect(page.total).toBe(57);
    expect(page.items.map((p) => [p.slug, p.price])).toEqual([
      ["p-a", { amount: 45050, currency: "BOB" }],
      ["p-b", { amount: 1890, currency: "BOB" }],
    ]);
  });

  it("una página pasada del final devuelve ítems vacíos pero el total (la pantalla puede saltar a la última)", async () => {
    use({ tables: {}, rpc: { public_list_products: () => ({ total: 4, items: [] }) } });
    expect(await listProductsFiltered({ query: q({ page: 9 }) })).toEqual({ items: [], total: 4 });
  });

  it.each([
    null,
    undefined,
    "x",
    7,
    [],
    { total: "3", items: [] },
    { total: 3, items: "no" },
    { items: [] },
  ])(
    "una respuesta con forma inesperada (%j) falla en voz alta, no pinta un listado vacío engañoso",
    async (bad) => {
      use({ tables: {}, rpc: { public_list_products: () => bad } });
      await expect(listProductsFiltered({ query: q() })).rejects.toThrow(/inesperada/);
    },
  );

  it("un error de la base se traduce a un error de la aplicación", async () => {
    use({
      tables: {},
      errors: { public_list_products: { code: "42501", message: "permission denied" } },
    });
    await expect(listProductsFiltered({ query: q() })).rejects.toThrow();
  });
});

describe("getListingFacets", () => {
  it("interpreta colores, tallas y rango de precio", async () => {
    use({
      tables: {},
      rpc: {
        public_listing_facets: () => ({
          colors: [
            { name: "Rojo", hex: "#C00000", count: 2 },
            { name: "Verde", hex: null, count: 1 },
          ],
          sizes: [{ label: "S", count: 1 }],
          price_min: 50,
          price_max: 400,
        }),
      },
    });
    expect(await getListingFacets({ categorySlug: "ropa" })).toEqual({
      colors: [
        { name: "Rojo", hex: "#C00000", count: 2 },
        { name: "Verde", hex: null, count: 1 },
      ],
      sizes: [{ label: "S", count: 1 }],
      priceMin: 50,
      priceMax: 400,
    });
    expect(rpcArgs()).toEqual({ p_category_slug: "ropa" });
  });

  it("descarta entradas mal formadas en vez de romper y deja los precios nulos", async () => {
    use({
      tables: {},
      rpc: {
        public_listing_facets: () => ({
          colors: [null, 5, { name: 3 }, { name: "Azul", hex: 7, count: "x" }],
          sizes: ["M", { label: null }, { label: "L", count: 2 }],
          price_min: null,
          price_max: "abc",
        }),
      },
    });
    expect(await getListingFacets()).toEqual({
      colors: [{ name: "Azul", hex: null, count: 0 }],
      sizes: [{ label: "L", count: 2 }],
      priceMin: null,
      priceMax: null,
    });
    expect(rpcArgs()).toEqual({});
  });

  it("una respuesta que no es un objeto falla en voz alta", async () => {
    use({ tables: {}, rpc: { public_listing_facets: () => [] } });
    await expect(getListingFacets()).rejects.toThrow(/inesperada/);
  });
});

describe("findSlugRedirect", () => {
  it("devuelve el slug actual de un producto renombrado", async () => {
    use({
      tables: { public_product_slug_redirects: [{ old_slug: "viejo", current_slug: "nuevo" }] },
    });
    expect(await findSlugRedirect("viejo")).toBe("nuevo");
    expect(calls.at(-1)?.filters).toContain("eq:old_slug=viejo");
  });

  it("null si no hay redirección", async () => {
    use({ tables: { public_product_slug_redirects: [] } });
    expect(await findSlugRedirect("nada")).toBeNull();
  });
});
