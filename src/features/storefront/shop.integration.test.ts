import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import { handleRobots, handleSeo, handleSitemap } from "../../server/seo/handlers";
import { localEnv, rest, rpc, svcRest } from "../../../test-support/api";
import { DEFAULT_QUERY, type ListingQuery } from "./listing/listParams";

// Los servicios usan getSupabase(): aquí apunta a un cliente REAL con la clave anónima contra Supabase local.
const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => holder.client }));

import { searchProducts } from "@/features/catalog/catalogService";
import { findSlugRedirect, getListingFacets, listProductsFiltered } from "./shopService";

const norm = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const q = (over: Partial<ListingQuery> = {}): ListingQuery => ({ ...DEFAULT_QUERY, ...over });

interface Visible {
  id: string;
  slug: string;
  name: string;
  price_bob: number;
  sold_out: boolean;
  created_at: string;
}
interface Variant {
  product_id: string;
  color_id: string;
  size_id: string | null;
  stock_status: string;
}

let anon: SupabaseClient<Database>;
let visible: Visible[] = [];
let colors: { id: string; product_id: string; name: string }[] = [];
let sizes: { id: string; product_id: string; label: string }[] = [];
let variants: Variant[] = [];
let categories: { id: string; parent_id: string | null; slug: string }[] = [];
let productCategories: { product_id: string; category_id: string }[] = [];

beforeAll(async () => {
  const env = localEnv();
  anon = createClient<Database>(env.url, env.anon, { auth: { persistSession: false } });
  holder.client = anon;
  const all = async <T>(table: string, select: string): Promise<T[]> => {
    const response = await rest("GET", `${table}?select=${select}&limit=5000`);
    expect(response.status, table).toBe(200);
    return response.body as T[];
  };
  visible = await all<Visible>("public_products", "id,slug,name,price_bob,sold_out,created_at");
  colors = await all("public_product_colors", "id,product_id,name");
  sizes = await all("public_product_sizes", "id,product_id,label");
  variants = await all<Variant>(
    "public_product_variants",
    "product_id,color_id,size_id,stock_status",
  );
  categories = await all("public_categories", "id,parent_id,slug");
  productCategories = await all("public_product_categories", "product_id,category_id");
});

/** Segunda implementación (en el navegador, ingenua) de la regla de filtros, para comparar con la función SQL. */
function expected(query: ListingQuery, categorySlug?: string): Set<string> {
  const catIds = new Set<string>();
  if (categorySlug) {
    const root = categories.find((c) => c.slug === categorySlug);
    if (root) {
      catIds.add(root.id);
      for (let grew = true; grew;) {
        grew = false;
        for (const c of categories) {
          if (c.parent_id && catIds.has(c.parent_id) && !catIds.has(c.id)) {
            catIds.add(c.id);
            grew = true;
          }
        }
      }
    }
  }
  const wantedColors = query.colors.map(norm);
  const wantedSizes = query.sizes.map(norm);
  return new Set(
    visible
      .filter((p) => {
        if (
          categorySlug &&
          !productCategories.some((pc) => pc.product_id === p.id && catIds.has(pc.category_id))
        )
          return false;
        if (query.minPrice !== null && p.price_bob < query.minPrice) return false;
        if (query.maxPrice !== null && p.price_bob > query.maxPrice) return false;
        if (query.inStockOnly && p.sold_out) return false;
        if (wantedColors.length === 0 && wantedSizes.length === 0) return true;
        return variants.some((v) => {
          if (v.product_id !== p.id) return false;
          const color = colors.find((c) => c.id === v.color_id);
          const size = v.size_id ? sizes.find((s) => s.id === v.size_id) : undefined;
          if (wantedColors.length > 0 && !(color && wantedColors.includes(norm(color.name))))
            return false;
          if (wantedSizes.length > 0 && !(size && wantedSizes.includes(norm(size.label))))
            return false;
          if (query.inStockOnly && v.stock_status === "out") return false;
          return true;
        });
      })
      .map((p) => p.id),
  );
}

const idsOf = async (query: ListingQuery, categorySlug?: string, pageSize = 100) =>
  (
    await listProductsFiltered({
      ...(categorySlug ? { scope: { categorySlug } } : {}),
      query,
      pageSize,
    })
  ).items.map((i) => i.id);

describe("listado filtrado en el servidor (contra la base local con las semillas)", () => {
  it("hay catálogo de ejemplo suficiente para que las pruebas signifiquen algo", () => {
    expect(visible.length).toBeGreaterThan(15);
    expect(colors.length).toBeGreaterThan(15);
    expect(variants.length).toBeGreaterThan(30);
  });

  it("sin filtros devuelve EXACTAMENTE lo visible: ni borradores, ni archivados, ni los «ocultos» por agotarse", async () => {
    const page = await listProductsFiltered({ query: q(), pageSize: 100 });
    expect(page.total).toBe(visible.length);
    expect(new Set(page.items.map((i) => i.id))).toEqual(new Set(visible.map((p) => p.id)));
    // los productos ocultos del seed existen en la base pero NO salen
    const hidden = await svcRest(
      "GET",
      "products?select=id,status,archived_at&or=(status.eq.draft,archived_at.not.is.null)",
    );
    expect(hidden.body.length).toBeGreaterThan(0);
    for (const row of hidden.body) expect(page.items.some((i) => i.id === row.id)).toBe(false);
  });

  it("los ítems no traen costo, stock ni datos internos", async () => {
    const response = await rpc("public_list_products", { p_limit: 1 });
    expect(response.status).toBe(200);
    expect(Object.keys(response.body.items[0]).sort()).toEqual([
      "colors_count",
      "cover_alt",
      "cover_path",
      "created_at",
      "id",
      "is_new",
      "name",
      "price_bob",
      "slug",
      "sold_out",
    ]);
  });

  it("cada categoría con sus subcategorías coincide con el cálculo independiente", async () => {
    for (const category of categories.filter((c) => c.parent_id === null)) {
      const got = new Set(await idsOf(q(), category.slug));
      expect(got, category.slug).toEqual(expected(q(), category.slug));
    }
  });

  const combos: [string, Partial<ListingQuery>][] = [
    ["un color", { colors: ["Negro"] }],
    ["un color con otra grafía (mayúsculas/acentos)", { colors: ["NÉGRO"] }],
    ["dos colores (O)", { colors: ["Negro", "Rojo"] }],
    ["una talla", { sizes: ["M"] }],
    ["talla en minúscula", { sizes: ["m"] }],
    ["color + talla en la MISMA variante", { colors: ["Negro"], sizes: ["M"] }],
    ["solo disponibles", { inStockOnly: true }],
    ["color + solo disponibles", { colors: ["Negro"], inStockOnly: true }],
    ["color + talla + solo disponibles", { colors: ["Negro"], sizes: ["S"], inStockOnly: true }],
    ["precio mínimo", { minPrice: 300 }],
    ["precio máximo", { maxPrice: 200 }],
    ["rango de precio", { minPrice: 150, maxPrice: 450.5 }],
    [
      "todo junto",
      {
        colors: ["Negro", "Rojo"],
        sizes: ["S", "M"],
        minPrice: 100,
        maxPrice: 600,
        inStockOnly: true,
      },
    ],
    ["un color que no existe", { colors: ["Fucsia fluorescente"] }],
  ];
  it.each(combos)("filtro «%s» coincide con el cálculo independiente", async (_name, change) => {
    const query = q(change);
    const got = await idsOf(query);
    expect(new Set(got)).toEqual(expected(query));
    expect(got).toHaveLength(new Set(got).size);
  });

  it("combinar categoría con filtros coincide también", async () => {
    const query = q({ colors: ["Negro"], inStockOnly: true });
    expect(new Set(await idsOf(query, "sombreros"))).toEqual(expected(query, "sombreros"));
  });

  it("color + talla nunca devuelve más que mirarlos por separado (la semántica de «misma variante» se prueba a fondo en pgTAP: las semillas crean todas las combinaciones)", async () => {
    const separate = (color: string, size: string) =>
      new Set(
        visible
          .filter(
            (p) =>
              colors.some((c) => c.product_id === p.id && norm(c.name) === norm(color)) &&
              sizes.some((s) => s.product_id === p.id && norm(s.label) === norm(size)),
          )
          .map((p) => p.id),
      );
    for (const color of new Set(colors.map((c) => c.name))) {
      for (const size of new Set(sizes.map((s) => s.label))) {
        const together = new Set(await idsOf(q({ colors: [color], sizes: [size] })));
        const apart = separate(color, size);
        for (const id of together) expect(apart.has(id)).toBe(true);
      }
    }
  });

  it.each([
    ["price_asc", (a: Visible, b: Visible) => a.price_bob - b.price_bob],
    ["price_desc", (a: Visible, b: Visible) => b.price_bob - a.price_bob],
    ["newest", (a: Visible, b: Visible) => b.created_at.localeCompare(a.created_at)],
  ] as const)(
    "orden %s: la lista sale ordenada y el empate lo resuelve el id (estable)",
    async (sort, cmp) => {
      const page = await listProductsFiltered({ query: q({ sort }), pageSize: 100 });
      const byId = new Map(visible.map((p) => [p.id, p]));
      const rows = page.items.map((i) => byId.get(i.id)!);
      for (let i = 1; i < rows.length; i++)
        expect(cmp(rows[i - 1]!, rows[i]!)).toBeLessThanOrEqual(0);
      const again = await listProductsFiltered({ query: q({ sort }), pageSize: 100 });
      expect(again.items.map((i) => i.id)).toEqual(page.items.map((i) => i.id));
    },
  );

  it("orden por nombre sin acentos ni mayúsculas", async () => {
    const page = await listProductsFiltered({ query: q({ sort: "name" }), pageSize: 100 });
    const names = page.items.map((i) => norm(i.name));
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "es")));
  });

  it("paginar: las páginas juntas son la lista completa, sin repetir ni saltar, y el total no cambia", async () => {
    const size = 7;
    const first = await listProductsFiltered({ query: q({ sort: "price_asc" }), pageSize: size });
    const pages = Math.ceil(first.total / size);
    const joined: string[] = [];
    for (let page = 1; page <= pages; page++) {
      const result = await listProductsFiltered({
        query: q({ sort: "price_asc", page }),
        pageSize: size,
      });
      expect(result.total).toBe(first.total);
      expect(result.items.length).toBe(page < pages ? size : first.total - size * (pages - 1));
      joined.push(...result.items.map((i) => i.id));
    }
    const whole = await listProductsFiltered({ query: q({ sort: "price_asc" }), pageSize: 100 });
    expect(joined).toEqual(whole.items.map((i) => i.id));
    expect(new Set(joined).size).toBe(joined.length);
  });

  it("una página pasada del final devuelve el total (no error 416 como el rango HTTP)", async () => {
    const result = await listProductsFiltered({ query: q({ page: 500 }), pageSize: 24 });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(visible.length);
  });

  it("entradas hostiles no rompen ni filtran de más", async () => {
    for (const color of ["%", "_", "'; drop table products; --", "a".repeat(500)]) {
      const result = await listProductsFiltered({ query: q({ colors: [color] }) });
      expect(result.total, color).toBe(0);
    }
    // un NUL no cabe en un texto de Postgres: la base lo rechaza (la URL ya los descarta antes de llegar aquí)
    await expect(listProductsFiltered({ query: q({ colors: ["a\u0000b"] }) })).rejects.toThrow();
    const injection = await listProductsFiltered({
      scope: { categorySlug: "' or 1=1 --" },
      query: q(),
    });
    expect(injection.total).toBe(0);
  });

  it("facetas: colores, tallas y precios coinciden con el cálculo independiente", async () => {
    const facets = await getListingFacets();
    const distinctColors = new Set(colors.map((c) => norm(c.name)));
    expect(facets.colors.map((c) => norm(c.name)).sort()).toEqual([...distinctColors].sort());
    for (const facet of facets.colors) {
      const productsWith = new Set(
        colors.filter((c) => norm(c.name) === norm(facet.name)).map((c) => c.product_id),
      );
      expect(facet.count, facet.name).toBe(productsWith.size);
    }
    const distinctSizes = new Set(sizes.map((s) => norm(s.label)));
    expect(facets.sizes.map((s) => norm(s.label)).sort()).toEqual([...distinctSizes].sort());
    const prices = visible.map((p) => p.price_bob);
    expect(facets.priceMin).toBe(Math.min(...prices));
    expect(facets.priceMax).toBe(Math.max(...prices));
  });

  it("facetas de una categoría solo cuentan sus productos", async () => {
    const scoped = await getListingFacets({ categorySlug: "sombreros" });
    const ids = expected(q(), "sombreros");
    const onlyHere = new Set(colors.filter((c) => ids.has(c.product_id)).map((c) => norm(c.name)));
    expect(new Set(scoped.colors.map((c) => norm(c.name)))).toEqual(onlyHere);
    expect(await getListingFacets({ categorySlug: "no-existe" })).toEqual({
      colors: [],
      sizes: [],
      priceMin: null,
      priceMax: null,
    });
  });
});

describe("búsqueda tolerante (contra las semillas)", () => {
  /** Primera palabra (sin acentos) de 8+ letras de algún producto visible: permite probar un error de tipeo de verdad. */
  const longWord = () => {
    const word = visible.map((p) => norm(p.name).split(" ")[0]!).find((w) => w.length >= 8);
    expect(word, "las semillas deben tener un producto con una palabra de 8+ letras").toBeDefined();
    return word!;
  };

  it("encuentra por el nombre exacto, sin acentos ni mayúsculas", async () => {
    const target = visible[0]!.name;
    expect((await searchProducts(target)).some((p) => p.name === target)).toBe(true);
    expect((await searchProducts(longWord().toUpperCase())).length).toBeGreaterThan(0);
  });

  it("encuentra aunque falte una letra a mitad de la palabra (error de tipeo)", async () => {
    const word = longWord();
    const mid = Math.floor(word.length / 2);
    const typo = word.slice(0, mid) + word.slice(mid + 1);
    expect(typo).not.toBe(word);
    const found = await searchProducts(typo);
    expect(found.some((p) => norm(p.name).includes(word))).toBe(true);
  });

  it("no devuelve ocultos ni ruido para una consulta sin parecido", async () => {
    expect(await searchProducts("zzzzqqqqxxxx")).toEqual([]);
    const draft = await svcRest("GET", "products?select=name&status=eq.draft&limit=1");
    if (draft.body[0])
      expect(
        (await searchProducts(draft.body[0].name)).some((p) => p.name === draft.body[0].name),
      ).toBe(false);
  });
});

describe("redirección de slugs y funciones de borde (contra la base real)", () => {
  const env = () => {
    const e = localEnv();
    return { SUPABASE_URL: e.url, SUPABASE_ANON_KEY: e.anon, SITE_URL: "https://madeinchola.com" };
  };
  const deps = () => ({ env: env(), fetch });

  it("un slug sin redirección devuelve null", async () => {
    expect(await findSlugRedirect("slug-que-nunca-existio")).toBeNull();
  });

  it("un producto renombrado (era público) redirige: lo ve el servicio y la función de borde", async () => {
    const product = visible[0]!;
    const oldSlug = product.slug;
    const newSlug = `${oldSlug}-renombrado`;
    const rename = await svcRest("PATCH", `products?id=eq.${product.id}`, { slug: newSlug });
    expect(rename.status).toBeLessThan(300);
    try {
      expect(await findSlugRedirect(oldSlug)).toBe(newSlug);
      const response = await handleSeo(
        new Request(`https://madeinchola.com/api/seo?type=product&slug=${oldSlug}`),
        deps(),
      );
      expect(response.status).toBe(301);
      expect(response.headers.get("Location")).toBe(`https://madeinchola.com/producto/${newSlug}`);
    } finally {
      await svcRest("PATCH", `products?id=eq.${product.id}`, { slug: oldSlug });
    }
  });

  it("ficha para bots de un producto real: título, canónico, Open Graph, JSON-LD con su precio", async () => {
    const product = visible.find((p) => !p.sold_out)!;
    const response = await handleSeo(
      new Request(`https://madeinchola.com/api/seo?type=product&slug=${product.slug}`),
      deps(),
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(
      `<link rel="canonical" href="https://madeinchola.com/producto/${product.slug}">`,
    );
    expect(html).toContain('<meta property="og:type" content="product">');
    const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(
      (m) => JSON.parse(m[1]!),
    );
    const offer = ld.find((d) => d["@type"] === "Product").offers;
    expect(offer).toMatchObject({ price: product.price_bob.toFixed(2), priceCurrency: "BOB" });
  });

  it("un borrador o archivado es 404 para los bots (no se filtra que existe)", async () => {
    const hidden = await svcRest(
      "GET",
      "products?select=slug&or=(status.eq.draft,archived_at.not.is.null)&limit=3",
    );
    expect(hidden.body.length).toBeGreaterThan(0);
    for (const row of hidden.body) {
      const response = await handleSeo(
        new Request(`https://madeinchola.com/api/seo?type=product&slug=${row.slug}`),
        deps(),
      );
      expect(response.status, row.slug).toBe(404);
      expect(await response.text()).toContain("noindex");
    }
  });

  it("categoría, colección, tienda y portada responden 200 con su canónico", async () => {
    const category = categories.find((c) => c.parent_id === null)!;
    const checks: [string, string][] = [
      [`type=category&slug=${category.slug}`, `/categoria/${category.slug}`],
      ["type=shop", "/tienda"],
      ["type=home", "/"],
    ];
    for (const [query, path] of checks) {
      const response = await handleSeo(
        new Request(`https://madeinchola.com/api/seo?${query}`),
        deps(),
      );
      expect(response.status, query).toBe(200);
      expect(await response.text()).toContain(
        `rel="canonical" href="https://madeinchola.com${path}"`,
      );
    }
  });

  it("el mapa del sitio lista exactamente los productos visibles", async () => {
    const response = await handleSitemap(
      new Request("https://madeinchola.com/sitemap.xml"),
      deps(),
    );
    expect(response.status).toBe(200);
    const xml = await response.text();
    const products = [
      ...xml.matchAll(/<loc>https:\/\/madeinchola\.com\/producto\/([^<]+)<\/loc>/g),
    ].map((m) => decodeURIComponent(m[1]!));
    expect(new Set(products)).toEqual(new Set(visible.map((p) => p.slug)));
    expect(xml).toContain("<loc>https://madeinchola.com/tienda</loc>");
    const hidden = await svcRest(
      "GET",
      "products?select=slug&or=(status.eq.draft,archived_at.not.is.null)",
    );
    for (const row of hidden.body) expect(xml).not.toContain(`/producto/${row.slug}<`);
  });

  it("robots.txt apunta al mapa del sitio", async () => {
    expect(
      await handleRobots(new Request("https://madeinchola.com/robots.txt"), deps()).text(),
    ).toContain("Sitemap: https://madeinchola.com/sitemap.xml");
  });

  it("la clave anónima NO puede leer tablas internas ni columnas privadas (costo, stock exacto)", async () => {
    for (const table of ["products", "product_prices", "stock_movements", "variant_availability"]) {
      const response = await rest("GET", `${table}?select=*&limit=1`);
      expect(response.status === 200 ? response.body : [], table).toEqual([]);
    }
    const costs = await rest("GET", "products?select=cost_base&limit=1");
    expect(costs.status === 200 ? costs.body : []).toEqual([]);
  });
});
