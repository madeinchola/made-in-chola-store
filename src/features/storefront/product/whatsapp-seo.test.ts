import { describe, expect, it, vi } from "vitest";
import { whatsappHref, whatsappMessage } from "./whatsapp";
import { buildProductSeo, DESCRIPTION_MAX, metaDescription } from "./productSeo";
import { productFixture } from "./product-test-utils";

vi.mock("@/features/catalog/mediaUrl", () => ({
  productImageUrl: (path: string) => `https://cdn.test/storage/${path}`,
}));

describe("whatsappMessage", () => {
  it("lleva producto, color, talla, precio y enlace, una cosa por línea", () => {
    expect(
      whatsappMessage({
        name: "Chaqueta Japandi",
        price: "Bs 560,00",
        color: "Blanco",
        size: "M",
        url: "https://madeinchola.com/producto/chaqueta-japandi",
      }),
    ).toBe(
      [
        "Hola, quiero consultar por este producto:",
        "Chaqueta Japandi",
        "Color: Blanco",
        "Talla: M",
        "Precio: Bs 560,00",
        "https://madeinchola.com/producto/chaqueta-japandi",
      ].join("\n"),
    );
  });

  it("sin color o sin talla esas líneas no aparecen", () => {
    const text = whatsappMessage({ name: "Cartera", price: "Bs 300,00", url: "https://x.com/p" });
    expect(text.split("\n")).toEqual([
      "Hola, quiero consultar por este producto:",
      "Cartera",
      "Precio: Bs 300,00",
      "https://x.com/p",
    ]);
  });

  it("un nombre con saltos o símbolos se conserva como texto (la codificación lo protege)", () => {
    const text = whatsappMessage({
      name: "Gorro & «Alpaca»\n100%",
      price: "Bs 1,00",
      url: "https://x.com",
    });
    expect(text).toContain("Gorro & «Alpaca»\n100%");
  });
});

describe("whatsappHref", () => {
  const base = "https://wa.me/59167528677";

  it("añade el texto codificado: saltos de línea, tildes, & y %", () => {
    const href = whatsappHref(base, "Hola\nChaqueta & más 100%")!;
    expect(href).toBe(`${base}?text=Hola%0AChaqueta%20%26%20m%C3%A1s%20100%25`);
    expect(new URL(href).searchParams.get("text")).toBe("Hola\nChaqueta & más 100%");
  });

  it("el texto de la URL se lee de vuelta idéntico al mensaje original", () => {
    const message = whatsappMessage({
      name: "Camisa #1 (lino)",
      price: "Bs 1.234,50",
      color: "Azúl",
      size: "L",
      url: "https://x.com/p?a=b&c=d",
    });
    expect(new URL(whatsappHref(base, message)!).searchParams.get("text")).toBe(message);
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["59167528677"],
    ["http://wa.me/59167528677"],
    ["https://wa.me/+59167528677"],
    ["https://wa.me/591675"],
    ["https://wa.me/0123456789"],
    ["https://wa.me/59167528677?text=x"],
    ["https://wa.me/59167528677/otra"],
    ["https://evil.com/59167528677"],
    ["https://wa.me.evil.com/59167528677"],
    ["https://evil.com/https://wa.me/59167528677"], // anclado al inicio
    ["x https://wa.me/59167528677"],
    [" https://wa.me/59167528677"],
    ["javascript:alert(1)"],
    ["https://wa.me/591675286771234567"],
  ])("una base inválida (%j) NO produce enlace", (value) => {
    expect(whatsappHref(value, "hola")).toBeNull();
  });
});

describe("metaDescription", () => {
  it("texto corto: tal cual, sin saltos de línea ni espacios dobles", () => {
    expect(metaDescription("Chaqueta   de cuero\nvegano.\n\nCorte holgado.")).toBe(
      "Chaqueta de cuero vegano. Corte holgado.",
    );
  });
  it.each([null, undefined, "", "   \n  "])("vacío (%j) → cadena vacía", (value) => {
    expect(metaDescription(value)).toBe("");
  });
  it(`un texto largo se corta en una palabra entera, con «…», en ${DESCRIPTION_MAX} caracteres como máximo`, () => {
    const long = "palabra ".repeat(60);
    const out = metaDescription(long);
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(out.endsWith("…")).toBe(true);
    expect(out.slice(0, -1).endsWith("palabra")).toBe(true);
  });
  it("justo en el límite no se corta", () => {
    const exact = "a".repeat(DESCRIPTION_MAX);
    expect(metaDescription(exact)).toBe(exact);
    expect(metaDescription(exact + "b").endsWith("…")).toBe(true);
  });
  it("una «palabra» larguísima sin espacios se corta en seco y no deja basura", () => {
    const out = metaDescription("x".repeat(400));
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(out.endsWith("…")).toBe(true);
  });
  it("no deja puntuación colgando antes de los puntos suspensivos", () => {
    const out = metaDescription(`${"hola ".repeat(30)}fin, ${"mundo ".repeat(10)}`, 40);
    expect(out).not.toMatch(/[,;:.-]…$/);
  });
  it("respeta emojis y acentos", () => {
    expect(metaDescription("Chaqueta 🧥 ñandú")).toBe("Chaqueta 🧥 ñandú");
  });
  it("al cortar sobre un emoji no deja un sustituto suelto (saldría como «�» en la vista previa)", () => {
    // 153 «a» + emoji + resto: el corte (154 caracteres) cae justo sobre el emoji
    const out = metaDescription(`${"a".repeat(153)}🧥 resto del texto largo`);
    expect(out).toBe(`${"a".repeat(153)}🧥…`);
    expect(out).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    // y se cuentan caracteres, no unidades UTF-16: 154 emojis caben (154 < 155) sin cortarse
    expect(metaDescription("🧥".repeat(DESCRIPTION_MAX))).toBe("🧥".repeat(DESCRIPTION_MAX));
  });
});

describe("buildProductSeo", () => {
  const detail = productFixture();
  const meta = buildProductSeo({
    detail,
    slug: "chaqueta-japandi",
    siteUrl: "https://madeinchola.com/",
    brand: "Made In Chola",
  });

  it("título, descripción, canónico limpio, tipo producto e imagen absoluta de la primera foto", () => {
    expect(meta.title).toBe("Chaqueta Japandi");
    expect(meta.description).toBe("Chaqueta de cuero vegano. Corte holgado.");
    expect(meta.canonical).toBe("https://madeinchola.com/producto/chaqueta-japandi");
    expect(meta.type).toBe("product");
    // color por defecto = Blanco → sus fotos primero (b1)
    expect(meta.image).toBe("https://cdn.test/storage/products/p1/b1.jpg");
  });

  it("JSON-LD lleva la descripción más larga (hasta 500) mientras la meta se queda en 155", () => {
    const long = `${"palabra ".repeat(60)}fin`; // 423 letras
    const out = buildProductSeo({
      detail: productFixture({}, { description: long }),
      slug: "x",
      siteUrl: "https://a.com",
      brand: "MIC",
    });
    expect(out.description!.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    const ld = (out.jsonLd![0] as { description: string }).description;
    expect(ld).toBe(long);
  });

  it("sin descripción usa un texto de respaldo con el nombre", () => {
    const empty = buildProductSeo({
      detail: productFixture({}, { description: "" }),
      slug: "x",
      siteUrl: "https://a.com",
      brand: "MIC",
    });
    expect(empty.description).toBe("Chaqueta Japandi de Made In Chola, hecho a mano en Bolivia.");
  });

  it("sin imágenes no hay imagen OG", () => {
    expect(
      buildProductSeo({
        detail: productFixture({ images: [] }),
        slug: "x",
        siteUrl: "https://a.com",
        brand: "MIC",
      }).image,
    ).toBeNull();
  });

  it("JSON-LD de producto: precio con 2 decimales, BOB, disponibilidad agregada, marca y colores", () => {
    const product = meta.jsonLd![0] as Record<string, unknown>;
    expect(product["@type"]).toBe("Product");
    expect(product.name).toBe("Chaqueta Japandi");
    expect(product.brand).toEqual({ "@type": "Brand", name: "Made In Chola" });
    expect(product.color).toBe("Blanco, Negro, Rojo");
    expect(product.offers).toMatchObject({
      price: "560.00",
      priceCurrency: "BOB",
      availability: "https://schema.org/InStock",
      url: "https://madeinchola.com/producto/chaqueta-japandi",
    });
    expect(product.image).toEqual([
      "https://cdn.test/storage/products/p1/b1.jpg",
      "https://cdn.test/storage/products/p1/b2.jpg",
      "https://cdn.test/storage/products/p1/g1.jpg",
    ]);
  });

  it("JSON-LD de migas: Inicio › Tienda › producto con URLs absolutas", () => {
    const crumbs = meta.jsonLd![1] as {
      itemListElement: { position: number; name: string; item: string }[];
    };
    expect(crumbs.itemListElement.map((c) => [c.position, c.name, c.item])).toEqual([
      [1, "Inicio", "https://madeinchola.com/"],
      [2, "Tienda", "https://madeinchola.com/tienda"],
      [3, "Chaqueta Japandi", "https://madeinchola.com/producto/chaqueta-japandi"],
    ]);
  });

  it("agotado → OutOfStock en la oferta", () => {
    const out = buildProductSeo({
      detail: productFixture({ variants: [] }),
      slug: "x",
      siteUrl: "https://a.com",
      brand: "MIC",
    });
    expect((out.jsonLd![0] as { offers: { availability: string } }).offers.availability).toBe(
      "https://schema.org/OutOfStock",
    );
  });

  it("el canónico no depende de utm ni de parámetros: solo dominio + slug", () => {
    const c = buildProductSeo({
      detail,
      slug: "chaqueta-japandi",
      siteUrl: "https://madeinchola.com",
      brand: "MIC",
    }).canonical;
    expect(c).not.toContain("?");
  });
});
