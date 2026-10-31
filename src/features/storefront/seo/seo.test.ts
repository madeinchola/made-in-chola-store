import { afterEach, describe, expect, it } from "vitest";
import { absoluteUrl, canonicalUrl, normalizePath, stripTracking } from "./canonical";
import {
  breadcrumbJsonLd,
  itemListJsonLd,
  organizationJsonLd,
  productJsonLd,
  serializeJsonLd,
  websiteJsonLd,
} from "./jsonld";
import { applyPageMeta } from "./usePageMeta";

describe("canonical", () => {
  it.each([
    ["utm_source=ig&utm_medium=bio&color=rojo", "color=rojo"],
    ["fbclid=abc", ""],
    ["gclid=1&ttclid=2&igshid=3&msclkid=4", ""],
    ["UTM_Campaign=x&pagina=2", "pagina=2"],
    ["ref=home&ref_src=tw&talla=m", "talla=m"],
    ["", ""],
  ])("stripTracking(%s) → %s", (input, expected) => {
    expect(stripTracking(input).toString()).toBe(expected);
  });

  it.each([
    ["/producto/chaqueta/", "/producto/chaqueta"],
    ["//producto///chaqueta", "/producto/chaqueta"],
    ["/", "/"],
    ["", "/"],
    ["/a/./b/../c", "/a/b/c"],
    ["/producto/x?utm_source=a#frag", "/producto/x"],
  ])("normalizePath(%s) → %s", (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });

  it("absoluteUrl no duplica barras", () => {
    expect(absoluteUrl("https://madeinchola.com/", "/tienda")).toBe(
      "https://madeinchola.com/tienda",
    );
    expect(absoluteUrl("https://madeinchola.com", "tienda")).toBe("https://madeinchola.com/tienda");
  });

  it("canonicalUrl: solo los parámetros que se piden; utm/fbclid/filtros desaparecen", () => {
    expect(
      canonicalUrl("https://x.com", "/tienda/", { pagina: 2, utm_source: "ig", color: undefined }),
    ).toBe("https://x.com/tienda?pagina=2&utm_source=ig");
    expect(canonicalUrl("https://x.com", "/tienda", { pagina: null })).toBe("https://x.com/tienda");
    expect(canonicalUrl("https://x.com", "/tienda?utm_source=ig&fbclid=1")).toBe(
      "https://x.com/tienda",
    );
  });
});

describe("JSON-LD", () => {
  it("serializeJsonLd escapa < > & y separadores Unicode: no se puede cerrar el <script>", () => {
    const text = serializeJsonLd({ name: "</script><script>alert(1)</script> &   " });
    expect(text).not.toContain("<");
    expect(text).not.toContain(">");
    expect(text).not.toContain("&");
    expect(text).not.toContain(" ");
    expect(text).not.toContain(" ");
    // y sigue siendo JSON válido que reconstruye el texto original
    expect(JSON.parse(text).name).toBe("</script><script>alert(1)</script> &   ");
  });

  it("producto: Offer con precio en texto de 2 decimales, moneda y disponibilidad schema.org", () => {
    const data = productJsonLd({
      name: "Chaqueta Japandi",
      description: "Cuero vegano",
      url: "https://x.com/producto/chaqueta-japandi",
      images: ["https://x.com/i/1.jpg"],
      sku: "CHQ-001",
      brand: "Made In Chola",
      price: { amount: "560.00", currency: "BOB" },
      availability: "in_stock",
      color: ["Blanco", "Negro"],
    });
    expect(data["@type"]).toBe("Product");
    expect(data.offers).toMatchObject({
      "@type": "Offer",
      price: "560.00",
      priceCurrency: "BOB",
      availability: "https://schema.org/InStock",
      url: "https://x.com/producto/chaqueta-japandi",
    });
    expect(data.brand).toEqual({ "@type": "Brand", name: "Made In Chola" });
    expect(data.color).toBe("Blanco, Negro");
    expect(data.sku).toBe("CHQ-001");
  });

  it.each([
    ["in_stock", "InStock"],
    ["low", "LimitedAvailability"],
    ["out", "OutOfStock"],
  ] as const)("disponibilidad %s → %s", (availability, schema) => {
    const data = productJsonLd({
      name: "x",
      url: "u",
      images: [],
      brand: "b",
      price: { amount: "1.00", currency: "BOB" },
      availability,
    });
    expect((data.offers as { availability: string }).availability).toBe(
      `https://schema.org/${schema}`,
    );
  });

  it("producto sin imágenes, descripción ni sku no escribe esas claves vacías", () => {
    const data = productJsonLd({
      name: "x",
      url: "u",
      images: [],
      brand: "b",
      price: { amount: "1.00", currency: "BOB" },
      availability: "in_stock",
    });
    for (const key of ["image", "description", "sku", "color"]) expect(key in data).toBe(false);
  });

  it("migas de pan: posiciones 1..n y URLs absolutas", () => {
    const data = breadcrumbJsonLd([
      { name: "Inicio", url: "https://x.com/" },
      { name: "Ropa", url: "https://x.com/categoria/ropa" },
    ]);
    expect(data["@type"]).toBe("BreadcrumbList");
    expect(data.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Inicio", item: "https://x.com/" },
      { "@type": "ListItem", position: 2, name: "Ropa", item: "https://x.com/categoria/ropa" },
    ]);
  });

  it("organización: solo incluye lo que existe", () => {
    expect(organizationJsonLd({ name: "MIC", url: "https://x.com" })).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "MIC",
      url: "https://x.com",
    });
    const full = organizationJsonLd({
      name: "MIC",
      url: "https://x.com",
      logo: "https://x.com/l.png",
      sameAs: ["https://instagram.com/mic"],
      email: "a@b.c",
      telephone: "+59170000000",
    });
    expect(full).toMatchObject({
      logo: "https://x.com/l.png",
      sameAs: ["https://instagram.com/mic"],
      email: "a@b.c",
    });
  });

  it("sitio web con búsqueda y lista de productos", () => {
    expect(
      websiteJsonLd({
        name: "MIC",
        url: "https://x.com",
        searchUrlTemplate: "https://x.com/buscar?q={search_term_string}",
      }).potentialAction,
    ).toMatchObject({
      "@type": "SearchAction",
    });
    expect(websiteJsonLd({ name: "MIC", url: "https://x.com" }).potentialAction).toBeUndefined();
    const list = itemListJsonLd([
      { name: "A", url: "u1", image: "i1" },
      { name: "B", url: "u2" },
    ]);
    expect(list.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, url: "u1", name: "A", image: "i1" },
      { "@type": "ListItem", position: 2, url: "u2", name: "B" },
    ]);
  });
});

describe("applyPageMeta", () => {
  let undo: (() => void) | null = null;
  afterEach(() => {
    undo?.();
    undo = null;
    document.head.innerHTML = "";
    document.title = "";
  });

  const metas = (selector: string) => [...document.head.querySelectorAll(selector)];

  it("pone título con el nombre del sitio, canonical, robots y Open Graph", () => {
    undo = applyPageMeta({
      title: "Chaqueta Japandi",
      description: "Cuero vegano",
      canonical: "https://x.com/producto/chaqueta-japandi",
      image: "https://x.com/i/1.jpg",
      type: "product",
    });
    expect(document.title).toBe("Chaqueta Japandi · Made In Chola");
    expect(metas('link[rel="canonical"]').map((l) => l.getAttribute("href"))).toEqual([
      "https://x.com/producto/chaqueta-japandi",
    ]);
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "index,follow",
    );
    expect(document.head.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe(
      "Chaqueta Japandi · Made In Chola",
    );
    expect(document.head.querySelector('meta[property="og:type"]')?.getAttribute("content")).toBe(
      "product",
    );
    expect(document.head.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe(
      "https://x.com/i/1.jpg",
    );
    expect(document.head.querySelector('meta[name="twitter:card"]')?.getAttribute("content")).toBe(
      "summary_large_image",
    );
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      "Cuero vegano",
    );
  });

  it("sin imagen la tarjeta de Twitter es «summary» y no hay og:image", () => {
    undo = applyPageMeta({ title: "Tienda" });
    expect(document.head.querySelector('meta[name="twitter:card"]')?.getAttribute("content")).toBe(
      "summary",
    );
    expect(document.head.querySelector('meta[property="og:image"]')).toBeNull();
  });

  it("el título de la marca no se duplica", () => {
    undo = applyPageMeta({ title: "Made In Chola" });
    expect(document.title).toBe("Made In Chola");
    undo();
    undo = applyPageMeta({ title: "Hecho a mano", bare: true });
    expect(document.title).toBe("Hecho a mano");
  });

  it("robots noindex y enlaces prev/next", () => {
    undo = applyPageMeta({
      title: "Tienda",
      robots: "noindex,follow",
      prev: "https://x.com/tienda",
      next: "https://x.com/tienda?pagina=3",
    });
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "noindex,follow",
    );
    expect(document.head.querySelector('link[rel="prev"]')?.getAttribute("href")).toBe(
      "https://x.com/tienda",
    );
    expect(document.head.querySelector('link[rel="next"]')?.getAttribute("href")).toBe(
      "https://x.com/tienda?pagina=3",
    );
  });

  it("JSON-LD en <script type=application/ld+json> seguro y que reconstruye el dato", () => {
    undo = applyPageMeta({
      title: "x",
      jsonLd: [{ "@context": "https://schema.org", "@type": "Product", name: "</script><b>" }],
    });
    const script = document.head.querySelector('script[type="application/ld+json"]')!;
    expect(script.textContent).not.toContain("</script>");
    expect(JSON.parse(script.textContent!).name).toBe("</script><b>");
  });

  it("al salir deshace TODO (título, etiquetas, scripts) y respeta lo que ya había en el HTML", () => {
    document.head.innerHTML =
      '<meta name="description" content="Original"><link rel="icon" href="/f.svg">';
    document.title = "Antes"; // después de armar el <head>: reemplazarlo antes borraría el <title>
    undo = applyPageMeta({
      title: "Página",
      description: "Nueva",
      canonical: "https://x.com/p",
      jsonLd: [{ a: 1 }],
    });
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      "Nueva",
    );
    expect(metas('meta[name="description"]')).toHaveLength(1); // no se duplica
    undo();
    undo = null;
    expect(document.title).toBe("Antes");
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      "Original",
    );
    expect(document.head.querySelector('link[rel="icon"]')).not.toBeNull();
    expect(metas("[data-seo]")).toHaveLength(0);
  });

  it("las etiquetas Open Graph y Twitter estáticas de index.html se reemplazan EN SU SITIO: nunca dos og:title, y al salir vuelven", () => {
    document.head.innerHTML = [
      '<meta property="og:title" content="Estático">',
      '<meta property="og:type" content="website">',
      '<meta name="twitter:card" content="summary">',
      '<meta name="robots" content="index,follow">',
    ].join("");
    document.title = "Antes";
    undo = applyPageMeta({
      title: "Producto",
      type: "product",
      image: "https://x.com/i.jpg",
      robots: "noindex,follow",
    });
    // un solo og:title, el nuevo; og:type y robots cambiados; twitter:card pasa a imagen grande
    expect(metas('meta[property="og:title"]').map((m) => m.getAttribute("content"))).toEqual([
      "Producto · Made In Chola",
    ]);
    expect(metas('meta[property="og:type"]').map((m) => m.getAttribute("content"))).toEqual([
      "product",
    ]);
    expect(metas('meta[name="twitter:card"]').map((m) => m.getAttribute("content"))).toEqual([
      "summary_large_image",
    ]);
    expect(metas('meta[name="robots"]').map((m) => m.getAttribute("content"))).toEqual([
      "noindex,follow",
    ]);
    // las que NO existían en el HTML sí se crean (con data-seo) y se retiran
    expect(metas('meta[property="og:image"][data-seo]')).toHaveLength(1);
    undo();
    undo = null;
    expect(metas('meta[property="og:title"]').map((m) => m.getAttribute("content"))).toEqual([
      "Estático",
    ]);
    expect(metas('meta[name="twitter:card"]').map((m) => m.getAttribute("content"))).toEqual([
      "summary",
    ]);
    expect(metas('meta[name="robots"]').map((m) => m.getAttribute("content"))).toEqual([
      "index,follow",
    ]);
    expect(metas("[data-seo]")).toHaveLength(0);
  });

  it("dos aplicaciones seguidas (navegación) no acumulan etiquetas", () => {
    const first = applyPageMeta({ title: "Uno", canonical: "https://x.com/1" });
    first();
    undo = applyPageMeta({ title: "Dos", canonical: "https://x.com/2" });
    expect(metas('link[rel="canonical"]').map((l) => l.getAttribute("href"))).toEqual([
      "https://x.com/2",
    ]);
    expect(document.title).toBe("Dos · Made In Chola");
  });
});
