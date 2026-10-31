import { describe, expect, it } from "vitest";
import { product } from "./listing-test-utils";
import { buildListingMeta, pathToCanonical, type ListingMetaInput } from "./listingMeta";
import { DEFAULT_QUERY } from "./listParams";

const base = (over: Partial<ListingMetaInput> = {}): ListingMetaInput => ({
  siteUrl: "https://tienda.test",
  path: "/categoria/ropa",
  title: "Ropa",
  description: "Prendas hechas a mano.",
  query: DEFAULT_QUERY,
  total: 50,
  products: [product(1), product(2)],
  breadcrumb: [
    { name: "Inicio", path: "/" },
    { name: "Tienda", path: "/tienda" },
    { name: "Ropa", path: "/categoria/ropa" },
  ],
  imageUrl: (path) => `https://img.test/${path}`,
  ...over,
});

describe("pathToCanonical", () => {
  it.each([
    ["/tienda", "https://tienda.test/tienda"],
    ["/tienda?pagina=2", "https://tienda.test/tienda?pagina=2"],
    ["/categoria/ropa/?pagina=3&utm_source=x", "https://tienda.test/categoria/ropa?pagina=3"],
  ])("%s → %s", (input, expected) => {
    expect(pathToCanonical("https://tienda.test", input)).toBe(expected);
  });
});

describe("buildListingMeta", () => {
  it("primera página: título, canónico limpio, se indexa, sin «anterior» y con «siguiente»", () => {
    const meta = buildListingMeta(base());
    expect(meta).toMatchObject({
      title: "Ropa",
      description: "Prendas hechas a mano.",
      canonical: "https://tienda.test/categoria/ropa",
      robots: "index,follow",
      prev: null,
      next: "https://tienda.test/categoria/ropa?pagina=2",
      image: "https://img.test/c/1.jpg",
    });
  });

  it("desde la página 2 el título lleva «página N» y hay enlaces anterior/siguiente", () => {
    const meta = buildListingMeta(base({ query: { ...DEFAULT_QUERY, page: 2 } }));
    expect(meta.title).toBe("Ropa · página 2");
    expect(meta.canonical).toBe("https://tienda.test/categoria/ropa?pagina=2");
    expect(meta.prev).toBe("https://tienda.test/categoria/ropa");
    expect(meta.next).toBe("https://tienda.test/categoria/ropa?pagina=3");
  });

  it("con filtros u orden NO se indexa y el canónico es el listado limpio", () => {
    for (const query of [
      { ...DEFAULT_QUERY, colors: ["Rojo"] },
      { ...DEFAULT_QUERY, sort: "price_asc" as const },
    ]) {
      const meta = buildListingMeta(base({ query }));
      expect(meta.robots).toBe("noindex,follow");
      expect(meta.canonical).toBe("https://tienda.test/categoria/ropa");
    }
  });

  it("migas de pan con URLs absolutas y lista de productos con URL de ficha e imagen", () => {
    const [breadcrumb, itemList] = buildListingMeta(base()).jsonLd ?? [];
    expect(breadcrumb).toMatchObject({ "@type": "BreadcrumbList" });
    expect(
      (breadcrumb?.itemListElement as { item: string; position: number }[]).map((i) => [
        i.position,
        i.item,
      ]),
    ).toEqual([
      [1, "https://tienda.test/"],
      [2, "https://tienda.test/tienda"],
      [3, "https://tienda.test/categoria/ropa"],
    ]);
    expect(itemList).toMatchObject({ "@type": "ItemList" });
    expect(itemList?.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        url: "https://tienda.test/producto/p-1",
        name: "Producto 1",
        image: "https://img.test/c/1.jpg",
      },
      {
        "@type": "ListItem",
        position: 2,
        url: "https://tienda.test/producto/p-2",
        name: "Producto 2",
        image: "https://img.test/c/2.jpg",
      },
    ]);
  });

  it("sin productos: solo migas, sin imagen ni lista", () => {
    const meta = buildListingMeta(base({ products: [], total: 0 }));
    expect(meta.jsonLd).toHaveLength(1);
    expect(meta.image).toBeNull();
    expect(meta.next).toBeNull();
  });

  it("un producto sin foto no trae image (ni en la lista ni como imagen de la página)", () => {
    const meta = buildListingMeta(base({ products: [product(1, { coverPath: null })] }));
    expect(meta.image).toBeNull();
    const item = (meta.jsonLd?.[1]?.itemListElement as Record<string, unknown>[])[0];
    expect(item && "image" in item).toBe(false);
  });

  it("una página fuera de rango se acota a la última real", () => {
    const meta = buildListingMeta(base({ query: { ...DEFAULT_QUERY, page: 99 } }));
    expect(meta.canonical).toBe("https://tienda.test/categoria/ropa?pagina=3");
    expect(meta.next).toBeNull();
  });
});
