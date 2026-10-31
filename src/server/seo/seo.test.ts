import { describe, expect, it, vi } from "vitest";
import { escapeHtml, excerpt } from "./escape";
import { handleRobots, handleSeo, handleSitemap } from "./handlers";
import { isSlug, type SeoDeps } from "./supabaseRest";

const SUPABASE = "https://abc.supabase.co";
const env = {
  SUPABASE_URL: SUPABASE,
  SUPABASE_ANON_KEY: "anon-key",
  SITE_URL: "https://madeinchola.com",
};

type Table = Record<string, unknown>[];
/** Supabase REST falso: responde por tabla y aplica `slug=eq.`, `old_slug=eq.`, `product_id=eq.`, `key=eq.`, `limit` y `offset`. */
function fakeRest(tables: Record<string, Table>, opts: { fail?: boolean } = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const rpcCalls: Record<string, string | number | null>[] = [];
  const fetchFake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    if (opts.fail) return new Response("boom", { status: 500 });
    if (url.pathname.endsWith("/rpc/public_list_products")) {
      // Réplica mínima de la función: ámbito por categoría (con su árbol) o colección; el orden lo prueba pgTAP.
      const args = JSON.parse(String(init?.body ?? "{}")) as Record<string, string | number | null>;
      rpcCalls.push(args);
      const categories = tables.public_categories ?? [];
      const ids = new Set<string>();
      if (args.p_category_slug) {
        const root = categories.find((c) => c.slug === args.p_category_slug);
        if (root) ids.add(String(root.id));
        for (let grew = true; grew;) {
          grew = false;
          for (const c of categories)
            if (c.parent_id && ids.has(String(c.parent_id)) && !ids.has(String(c.id))) {
              ids.add(String(c.id));
              grew = true;
            }
        }
      }
      const collection = (tables.public_collections ?? []).find(
        (c) => c.slug === args.p_collection_slug,
      );
      let rows = [...(tables.public_products ?? [])];
      if (args.p_category_slug) {
        const inScope = new Set(
          (tables.public_product_categories ?? [])
            .filter((l) => ids.has(String(l.category_id)))
            .map((l) => String(l.product_id)),
        );
        rows = rows.filter((r) => inScope.has(String(r.id)));
      }
      if (args.p_collection_slug) {
        const inScope = new Set(
          collection
            ? (tables.public_product_collections ?? [])
                .filter((l) => l.collection_id === collection.id)
                .map((l) => String(l.product_id))
            : [],
        );
        rows = rows.filter((r) => inScope.has(String(r.id)));
      }
      const limit = Number(args.p_limit ?? 24);
      return new Response(JSON.stringify({ total: rows.length, items: rows.slice(0, limit) }), {
        status: 200,
      });
    }
    const table = decodeURIComponent(url.pathname.replace("/rest/v1/", ""));
    let rows = [...(tables[table] ?? [])];
    for (const [key, raw] of url.searchParams) {
      if (raw.startsWith("eq."))
        rows = rows.filter((r) => String(r[key]) === decodeURIComponent(raw.slice(3)));
      if (raw.startsWith("in.(")) {
        const set = raw.slice(4, -1).split(",").map(decodeURIComponent);
        rows = rows.filter((r) => set.includes(String(r[key])));
      }
    }
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 1000);
    return new Response(JSON.stringify(rows.slice(offset, offset + limit)), { status: 200 });
  });
  const deps: SeoDeps = { env, fetch: fetchFake as unknown as typeof fetch };
  return { deps, calls, fetchFake, rpcCalls };
}

const product = {
  id: "p1",
  slug: "chaqueta-japandi",
  name: "Chaqueta Japandi",
  price_bob: 560,
  description: "Chaqueta de cuero vegano.\nCorte holgado.",
  model: "Japandi",
  sold_out: false,
  cover_path: "products/p1/a.jpg",
  cover_alt: null,
};
const TABLES: Record<string, Table> = {
  public_product_detail: [
    product,
    { ...product, id: "p2", slug: "agotada", name: "Agotada", sold_out: true },
  ],
  public_product_images: [
    { product_id: "p1", path: "products/p1/a.jpg", sort_order: 1 },
    { product_id: "p1", path: "products/p1/b ñ.jpg", sort_order: 2 },
  ],
  public_product_colors: [
    { product_id: "p1", name: "Blanco", sort_order: 1 },
    { product_id: "p1", name: "Negro", sort_order: 2 },
  ],
  public_product_variants: [
    { product_id: "p1", stock_status: "out" },
    { product_id: "p1", stock_status: "in_stock" },
    { product_id: "p2", stock_status: "out" },
  ],
  public_product_slug_redirects: [{ old_slug: "chaqueta-vieja", current_slug: "chaqueta-japandi" }],
  public_store_settings: [{ key: "business_name", value: "Made In Chola" }],
  public_categories: [
    {
      id: "c1",
      parent_id: null,
      slug: "ropa",
      name: "Ropa",
      description: "Prendas hechas a mano.",
    },
    { id: "c2", parent_id: "c1", slug: "chaquetas", name: "Chaquetas", description: null },
  ],
  public_collections: [{ id: "k1", slug: "verano", name: "Verano", description: null }],
  public_product_categories: [{ product_id: "p1", category_id: "c2" }],
  public_product_collections: [{ product_id: "p1", collection_id: "k1" }],
  public_products: [product, { ...product, id: "p2", slug: "agotada", name: "Agotada" }],
};

const get = (type: string, slug?: string, extra = "") =>
  new Request(
    `https://madeinchola.com/api/seo?type=${type}${slug ? `&slug=${encodeURIComponent(slug)}` : ""}${extra}`,
  );

describe("helpers", () => {
  it("escapeHtml neutraliza & < > comillas", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;",
    );
  });
  it.each([
    ["corto", "corto"],
    ["a  b\n\nc", "a b c"],
  ])("excerpt(%j) colapsa espacios", (input, out) => {
    expect(excerpt(input)).toBe(out);
  });
  it("excerpt corta en límite de palabra con «…» y respeta el máximo", () => {
    const text = "palabra ".repeat(60);
    const out = excerpt(text, 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/palab…$/);
  });
  it("excerpt no parte un emoji por la mitad al cortar (sin sustitutos sueltos)", () => {
    // 153 «a» + emoji (2 unidades UTF-16, 1 carácter) + resto: el corte cae justo sobre el emoji
    const out = excerpt(`${"a".repeat(153)}😀 resto del texto largo`, 155);
    expect(out).toBe(`${"a".repeat(153)}😀…`);
    expect(out).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(excerpt("😀".repeat(200), 10)).toBe(`${"😀".repeat(9)}…`);
  });
  it.each([
    ["chaqueta-japandi", true],
    ["a", true],
    ["a1-b2", true],
    ["", false],
    ["Chaqueta", false],
    ["a--b", false],
    ["-a", false],
    ["a-", false],
    ["a b", false],
    ["a/b", false],
    ["a'b", false],
    ["a;drop", false],
    ["x".repeat(121), false],
  ])("isSlug(%j) → %s", (value, ok) => {
    expect(isSlug(value)).toBe(ok);
  });
});

describe("handleSeo · producto", () => {
  it("devuelve HTML con título, descripción, canónico, Open Graph con imagen y precio, y JSON-LD Product", async () => {
    const { deps } = fakeRest(TABLES);
    const response = await handleSeo(get("product", "chaqueta-japandi"), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const html = await response.text();
    expect(html).toContain("<title>Chaqueta Japandi · Made In Chola</title>");
    expect(html).toContain(
      '<link rel="canonical" href="https://madeinchola.com/producto/chaqueta-japandi">',
    );
    expect(html).toContain('<meta property="og:type" content="product">');
    expect(html).toContain(
      `<meta property="og:image" content="${SUPABASE}/storage/v1/object/public/product-images/products/p1/a.jpg">`,
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain("Bs 560,00");
    expect(html).toContain('<meta name="robots" content="index,follow">');
    const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(
      (m) => JSON.parse(m[1]!),
    );
    const productLd = ld.find((d) => d["@type"] === "Product");
    expect(productLd.offers).toMatchObject({
      price: "560.00",
      priceCurrency: "BOB",
      availability: "https://schema.org/InStock",
    });
    expect(productLd.image).toEqual([
      `${SUPABASE}/storage/v1/object/public/product-images/products/p1/a.jpg`,
      `${SUPABASE}/storage/v1/object/public/product-images/products/p1/b%20%C3%B1.jpg`,
    ]);
    expect(productLd.color).toBe("Blanco, Negro");
    expect(ld.find((d) => d["@type"] === "BreadcrumbList").itemListElement).toHaveLength(3);
  });

  it("agotado: disponibilidad OutOfStock y el texto «Agotado»", async () => {
    const { deps } = fakeRest({ ...TABLES, public_product_images: [], public_product_colors: [] });
    const html = await (await handleSeo(get("product", "agotada"), deps)).text();
    expect(html).toContain("https://schema.org/OutOfStock");
    expect(html).toContain("Agotado");
  });

  it("un nombre con HTML no inyecta código ni cierra el script del JSON-LD", async () => {
    const evil = {
      ...product,
      name: "</script><script>alert(1)</script><img src=x onerror=alert(1)>",
      description: '"><svg onload=alert(1)>',
    };
    const { deps } = fakeRest({ ...TABLES, public_product_detail: [evil] });
    const html = await (await handleSeo(get("product", "chaqueta-japandi"), deps)).text();
    expect(html).not.toMatch(/<script>alert\(1\)/);
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<svg onload");
    // el único <script> es el de JSON-LD, y cada uno se cierra una sola vez
    expect((html.match(/<script/g) ?? []).length).toBe((html.match(/<\/script>/g) ?? []).length);
    const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(
      (m) => JSON.parse(m[1]!),
    );
    expect(ld[0].name).toBe(evil.name);
  });

  it("slug renombrado → 301 permanente al slug actual (en la URL canónica)", async () => {
    const { deps } = fakeRest(TABLES);
    const response = await handleSeo(get("product", "chaqueta-vieja"), deps);
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe(
      "https://madeinchola.com/producto/chaqueta-japandi",
    );
  });

  it("slug inexistente, oculto o archivado → 404 con noindex (nunca 200 con contenido vacío)", async () => {
    const { deps } = fakeRest(TABLES);
    const response = await handleSeo(get("product", "no-existe"), deps);
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain('<meta name="robots" content="noindex,follow">');
    expect(html).toContain("Página no encontrada");
  });

  it("mayúsculas en el slug → 301 a la versión en minúsculas", async () => {
    const { deps, fetchFake } = fakeRest(TABLES);
    const response = await handleSeo(get("product", "Chaqueta-Japandi"), deps);
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe(
      "https://madeinchola.com/producto/chaqueta-japandi",
    );
    expect(fetchFake).not.toHaveBeenCalled();
  });

  it.each(["", "a b", "x'; drop table products; --", "../../etc/passwd", "a".repeat(200), "%00"])(
    "slug inválido %j → 404 sin tocar la base",
    async (slug) => {
      const { deps, fetchFake } = fakeRest(TABLES);
      const response = await handleSeo(get("product", slug), deps);
      expect(response.status).toBe(404);
      expect(fetchFake).not.toHaveBeenCalled();
    },
  );

  it("solo usa la clave anónima y vistas públicas (nunca tablas internas)", async () => {
    const { deps, calls } = fakeRest(TABLES);
    await handleSeo(get("product", "chaqueta-japandi"), deps);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.headers.apikey).toBe("anon-key");
      expect(call.headers.Authorization).toBe("Bearer anon-key");
      expect(new URL(call.url).pathname).toMatch(/^\/rest\/v1\/public_[a-z_]+$/);
    }
  });

  it("la respuesta de bots NO se cachea en el CDN (misma URL que ve una persona) y declara Vary", async () => {
    const { deps } = fakeRest(TABLES);
    const response = await handleSeo(get("product", "chaqueta-japandi"), deps);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("User-Agent");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("si Supabase falla responde 502 sin filtrar detalles; sin configuración, 503", async () => {
    const failing = fakeRest(TABLES, { fail: true });
    const bad = await handleSeo(get("product", "chaqueta-japandi"), failing.deps);
    expect(bad.status).toBe(502);
    expect(await bad.text()).toBe("Servicio no disponible");
    const noConfig = await handleSeo(get("product", "chaqueta-japandi"), {
      env: {},
      fetch: vi.fn() as unknown as typeof fetch,
    });
    expect(noConfig.status).toBe(503);
  });

  it("solo atiende GET y HEAD", async () => {
    const { deps } = fakeRest(TABLES);
    expect(
      (await handleSeo(new Request("https://x.com/api/seo?type=shop", { method: "POST" }), deps))
        .status,
    ).toBe(405);
    expect(
      (await handleSeo(new Request("https://x.com/api/seo?type=home", { method: "HEAD" }), deps))
        .status,
    ).toBe(200);
  });

  it("un tipo desconocido es 404", async () => {
    const { deps } = fakeRest(TABLES);
    expect((await handleSeo(get("admin", "x"), deps)).status).toBe(404);
    expect((await handleSeo(new Request("https://x.com/api/seo"), deps)).status).toBe(404);
  });
});

describe("handleSeo · tienda, categoría, colección y portada", () => {
  it("categoría: título, canónico, ItemList con URLs absolutas e incluye productos de las subcategorías", async () => {
    const { deps } = fakeRest(TABLES);
    const response = await handleSeo(get("category", "ropa"), deps);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("<title>Ropa · Made In Chola</title>");
    expect(html).toContain('<link rel="canonical" href="https://madeinchola.com/categoria/ropa">');
    expect(html).toContain('href="https://madeinchola.com/producto/chaqueta-japandi"');
  });

  it("categoría: los productos salen de public_list_products (la misma lógica de la tienda), con el árbol y solo 24", async () => {
    const { deps, rpcCalls } = fakeRest(TABLES);
    const html = await (await handleSeo(get("category", "ropa"), deps)).text();
    expect(rpcCalls).toEqual([
      {
        p_category_slug: "ropa",
        p_collection_slug: null,
        p_sort: "newest",
        p_limit: 24,
        p_offset: 0,
      },
    ]);
    // p1 está en «chaquetas», hija de «ropa»; p2 no está en ninguna categoría: no debe salir.
    expect(html).toContain("Chaqueta Japandi");
    expect(html).not.toContain("Agotada");
  });

  it("colección: pide solo su ámbito y no mezcla productos de otras", async () => {
    const { deps, rpcCalls } = fakeRest(TABLES);
    const html = await (await handleSeo(get("collection", "verano"), deps)).text();
    expect(rpcCalls[0]).toMatchObject({ p_collection_slug: "verano", p_category_slug: null });
    expect(html).toContain("Chaqueta Japandi");
    expect(html).not.toContain("Agotada");
  });

  it("tienda: sin ámbito (ni categoría ni colección)", async () => {
    const { deps, rpcCalls } = fakeRest(TABLES);
    await handleSeo(get("shop"), deps);
    expect(rpcCalls[0]).toMatchObject({ p_category_slug: null, p_collection_slug: null });
  });

  it("un fallo de la función de listado no filtra detalles: 502 genérico", async () => {
    const { deps } = fakeRest(TABLES, { fail: true });
    const response = await handleSeo(get("category", "ropa"), deps);
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Servicio no disponible");
  });

  it("categoría y colección inexistentes → 404 noindex", async () => {
    const { deps } = fakeRest(TABLES);
    for (const [type, slug] of [
      ["category", "nada"],
      ["collection", "nada"],
    ] as const) {
      const response = await handleSeo(get(type, slug), deps);
      expect(response.status).toBe(404);
      expect(await response.text()).toContain("noindex");
    }
  });

  it("colección y tienda", async () => {
    const { deps } = fakeRest(TABLES);
    const collection = await (await handleSeo(get("collection", "verano"), deps)).text();
    expect(collection).toContain("<title>Colección Verano · Made In Chola</title>");
    const shop = await (await handleSeo(get("shop"), deps)).text();
    expect(shop).toContain('<link rel="canonical" href="https://madeinchola.com/tienda">');
    expect(shop).toContain("Chaqueta Japandi");
  });

  it("portada: Organization con las redes https del admin y WebSite con búsqueda", async () => {
    const { deps } = fakeRest({
      ...TABLES,
      public_store_settings: [
        { key: "business_name", value: "Made In Chola" },
        { key: "social_instagram", value: "https://www.instagram.com/madeinchola/" },
        { key: "social_tiktok", value: "javascript:alert(1)" },
        { key: "social_facebook", value: "http://inseguro.com" },
      ],
    });
    const html = await (await handleSeo(get("home"), deps)).text();
    const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(
      (m) => JSON.parse(m[1]!),
    );
    expect(ld.find((d) => d["@type"] === "Organization").sameAs).toEqual([
      "https://www.instagram.com/madeinchola/",
    ]);
    expect(ld.find((d) => d["@type"] === "WebSite").potentialAction.target.urlTemplate).toBe(
      "https://madeinchola.com/buscar?q={search_term_string}",
    );
  });

  it("tipos raros (constructor, __proto__, toString) dan 404 y nunca una redirección con basura", async () => {
    const { deps } = fakeRest(TABLES);
    for (const type of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      const response = await handleSeo(get(type, "Abc"), deps);
      expect(response.status, type).toBe(404);
      expect(response.headers.get("location"), type).toBeNull();
    }
  });

  it("slug con MAYÚSCULAS: 301 permanente a la URL en minúsculas con el dominio oficial", async () => {
    const { deps } = fakeRest(TABLES);
    for (const [type, prefix] of [
      ["product", "producto"],
      ["category", "categoria"],
      ["collection", "coleccion"],
    ] as const) {
      const response = await handleSeo(get(type, "Abc-Def"), deps);
      expect(response.status, type).toBe(301);
      expect(response.headers.get("location"), type).toBe(
        `https://madeinchola.com/${prefix}/abc-def`,
      );
    }
  });

  it("sin SITE_URL usa el dominio de la petición (previews de Vercel)", async () => {
    const { deps } = fakeRest(TABLES);
    const html = await (
      await handleSeo(get("product", "chaqueta-japandi"), {
        ...deps,
        env: { ...env, SITE_URL: undefined },
      })
    ).text();
    expect(html).toContain('href="https://madeinchola.com/producto/chaqueta-japandi"');
  });
});

describe("sitemap y robots", () => {
  it("el mapa del sitio lista portada, tienda, categorías, colecciones y productos visibles, con URLs absolutas escapadas", async () => {
    const { deps } = fakeRest({
      ...TABLES,
      public_products: [{ slug: "chaqueta-japandi" }, { slug: "a&b" }],
    });
    const response = await handleSitemap(new Request("https://madeinchola.com/sitemap.xml"), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=3600");
    const xml = await response.text();
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    for (const loc of [
      "https://madeinchola.com/",
      "https://madeinchola.com/tienda",
      "https://madeinchola.com/categoria/ropa",
      "https://madeinchola.com/coleccion/verano",
      "https://madeinchola.com/producto/chaqueta-japandi",
      "https://madeinchola.com/producto/a%26b",
    ]) {
      expect(xml).toContain(`<loc>${loc}</loc>`);
    }
    expect(xml).not.toContain("&b<"); // el & crudo no puede aparecer sin escapar
  });

  it("pagina por bloques de 1000: 2 500 productos salen completos y sin repetidos", async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({
      slug: `p-${String(i).padStart(4, "0")}`,
    }));
    const { deps } = fakeRest({
      ...TABLES,
      public_products: many,
      public_categories: [],
      public_collections: [],
    });
    const xml = await (
      await handleSitemap(new Request("https://madeinchola.com/sitemap.xml"), deps)
    ).text();
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
    expect(locs.filter((l) => l?.includes("/producto/"))).toHaveLength(2500);
    expect(new Set(locs).size).toBe(locs.length);
  });

  it("si la base falla responde 502 (no un mapa vacío que borraría el índice de Google)", async () => {
    const { deps } = fakeRest(TABLES, { fail: true });
    expect(
      (await handleSitemap(new Request("https://madeinchola.com/sitemap.xml"), deps)).status,
    ).toBe(502);
  });

  it("robots.txt: cierra lo privado y las búsquedas, deja el resto abierto y apunta al mapa del sitio", async () => {
    const response = handleRobots(new Request("https://madeinchola.com/robots.txt"), {
      env,
      fetch,
    });
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    const text = await response.text();
    expect(text).toContain("User-agent: *");
    expect(text).toContain("Allow: /\n");
    for (const path of ["/admin", "/cuenta", "/login", "/registro", "/carrito", "/buscar"]) {
      expect(text).toContain(`Disallow: ${path}\n`);
    }
    expect(text).not.toMatch(/Disallow: \/\s*$/m);
    expect(text).toContain("Sitemap: https://madeinchola.com/sitemap.xml");
  });
});
