import { describe, expect, it } from "vitest";
import {
  clampLimit,
  cleanText,
  fallbackViewAllPath,
  findHero,
  flattenCategories,
  resolveSectionScope,
  sortItems,
  sortSections,
  splitCollectionTitle,
  tileAspect,
  tileSpanClass,
} from "./homeSections";
import { CATEGORY, COLLECTION, item, section, TREE } from "./home-test-utils";

describe("sortSections / sortItems", () => {
  it("ordena por sortOrder y conserva el orden de llegada en los empates", () => {
    const sections = [
      section({ id: "c", sortOrder: 3 }),
      section({ id: "a1", sortOrder: 1 }),
      section({ id: "b", sortOrder: 2 }),
      section({ id: "a2", sortOrder: 1 }),
    ];
    expect(sortSections(sections).map((s) => s.id)).toEqual(["a1", "a2", "b", "c"]);
  });

  it("no modifica la lista original", () => {
    const sections = [section({ id: "b", sortOrder: 2 }), section({ id: "a", sortOrder: 1 })];
    sortSections(sections);
    expect(sections.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("los elementos también (estable con empates)", () => {
    const items = [
      item({ id: "z", sortOrder: 2 }),
      item({ id: "x", sortOrder: 1 }),
      item({ id: "y", sortOrder: 1 }),
    ];
    expect(sortItems(items).map((i) => i.id)).toEqual(["x", "y", "z"]);
  });
});

describe("findHero / cleanText / clampLimit", () => {
  it("el hero es la PRIMERA sección de ese tipo; sin hero, undefined", () => {
    const sections = [
      section({ id: "r", kind: "product_row" }),
      section({ id: "h1", kind: "hero" }),
      section({ id: "h2", kind: "hero" }),
    ];
    expect(findHero(sections)?.id).toBe("h1");
    expect(findHero([section({ kind: "banner" })])).toBeUndefined();
  });

  it.each([
    [null, null],
    [undefined, null],
    ["", null],
    ["   ", null],
    ["  Hola  ", "Hola"],
  ])("cleanText(%j) → %j", (input, expected) => {
    expect(cleanText(input)).toBe(expected);
  });

  it.each([
    [4, 4],
    [1, 1],
    [24, 24],
    [25, 24],
    [999, 24],
    [0, 1],
    [-3, 1],
    [4.9, 4],
    [Number.NaN, 4],
    [Number.POSITIVE_INFINITY, 4],
  ])("clampLimit(%s) → %i", (input, expected) => {
    expect(clampLimit(input)).toBe(expected);
  });
});

describe("splitCollectionTitle", () => {
  it.each([
    ["Colección NADAS", "Colección", "NADAS"],
    ["colección verano 2027", "colección", "verano 2027"],
    ["COLECCIÓN X", "COLECCIÓN", "X"],
    ["Coleccion Otoño", "Coleccion", "Otoño"],
    ["  Colección   Nadas  ", "Colección", "Nadas"],
  ])("«%s» separa el nombre para ponerlo en cursiva", (title, prefix, name) => {
    expect(splitCollectionTitle(title)).toEqual({ prefix, name });
  });

  it.each([
    "Colección",
    "Colecciones NADAS",
    "Nuestra Colección X",
    "Verano 2027",
    "",
    "Colección  ",
  ])("«%s» no tiene nombre que resaltar → null", (title) => {
    expect(splitCollectionTitle(title)).toBeNull();
  });
});

describe("baldosas de categorías", () => {
  it("las proporciones se reparten alta · casi cuadrada · grande y se repiten", () => {
    expect([0, 1, 2, 3, 4, 5].map(tileAspect)).toEqual([
      "aspect-[5/7]",
      "aspect-[7/6]",
      "aspect-[7/8]",
      "aspect-[5/7]",
      "aspect-[7/6]",
      "aspect-[7/8]",
    ]);
    expect(tileAspect(-1)).toBe("aspect-[7/8]");
  });

  it("con EXACTAMENTE 3 baldosas la última ocupa 2 columnas (1·1·2); con otra cantidad, todas 1", () => {
    expect([0, 1, 2].map((i) => tileSpanClass(i, 3))).toEqual([
      "col-span-1",
      "col-span-1",
      "col-span-2",
    ]);
    expect([0, 1, 2, 3].map((i) => tileSpanClass(i, 4))).toEqual(Array(4).fill("col-span-1"));
    expect([0, 1].map((i) => tileSpanClass(i, 2))).toEqual(Array(2).fill("col-span-1"));
  });
});

describe("flattenCategories", () => {
  it("aplana TODAS las ramas (padres e hijas)", () => {
    expect(flattenCategories(TREE).map((c) => c.slug)).toEqual(["sombreros", "carteras"]);
    expect(flattenCategories([])).toEqual([]);
  });
});

describe("resolveSectionScope", () => {
  const cats = flattenCategories(TREE);
  const src = (over: Partial<ReturnType<typeof section>["source"]>) =>
    section({ source: { type: "none", categoryId: null, collectionId: null, ...over } });

  it("none → sin productos", () => {
    expect(resolveSectionScope(src({ type: "none" }), cats, [COLLECTION])).toEqual({
      status: "none",
    });
  });

  it("latest → toda la tienda, sin esperar a categorías ni colecciones", () => {
    expect(resolveSectionScope(src({ type: "latest" }), undefined, undefined)).toEqual({
      status: "ready",
      scope: {},
    });
  });

  it("category → resuelve el id a su slug", () => {
    expect(
      resolveSectionScope(src({ type: "category", categoryId: "cat-2" }), cats, undefined),
    ).toEqual({
      status: "ready",
      scope: { categorySlug: "carteras" },
    });
  });

  it("category con el árbol aún sin llegar → pending; con id inexistente o sin id → none", () => {
    expect(
      resolveSectionScope(src({ type: "category", categoryId: "cat-1" }), undefined, undefined),
    ).toEqual({ status: "pending" });
    expect(
      resolveSectionScope(src({ type: "category", categoryId: "no-existe" }), cats, undefined),
    ).toEqual({ status: "none" });
    expect(
      resolveSectionScope(src({ type: "category", categoryId: null }), cats, undefined),
    ).toEqual({ status: "none" });
  });

  it("collection → slug de la colección; colección vencida/archivada (no está en la lista) → none", () => {
    expect(
      resolveSectionScope(src({ type: "collection", collectionId: "col-1" }), cats, [COLLECTION]),
    ).toEqual({
      status: "ready",
      scope: { collectionSlug: "nadas" },
    });
    expect(
      resolveSectionScope(src({ type: "collection", collectionId: "col-1" }), cats, []),
    ).toEqual({ status: "none" });
    expect(
      resolveSectionScope(src({ type: "collection", collectionId: "col-1" }), cats, undefined),
    ).toEqual({ status: "pending" });
  });

  it("manual → los productos elegidos, en su orden y sin repetir; sin ninguno → none", () => {
    const manual = section({
      source: { type: "manual", categoryId: null, collectionId: null },
      items: [
        item({ id: "a", sortOrder: 2, productId: "p2" }),
        item({ id: "b", sortOrder: 1, productId: "p1" }),
        item({ id: "c", sortOrder: 3, productId: "p2" }),
        item({ id: "d", sortOrder: 4, productId: null }),
      ],
    });
    expect(resolveSectionScope(manual, cats, [])).toEqual({
      status: "manual",
      productIds: ["p1", "p2"],
    });
    expect(
      resolveSectionScope(
        section({ source: { type: "manual", categoryId: null, collectionId: null } }),
        cats,
        [],
      ),
    ).toEqual({
      status: "none",
    });
  });
});

describe("fallbackViewAllPath", () => {
  const cats = [CATEGORY];
  const src = (over: Partial<ReturnType<typeof section>["source"]>) =>
    section({ source: { type: "none", categoryId: null, collectionId: null, ...over } });

  it("categoría y colección → su página; los más nuevos → /tienda; el resto → null", () => {
    expect(fallbackViewAllPath(src({ type: "category", categoryId: "cat-1" }), cats, [])).toBe(
      "/categoria/sombreros",
    );
    expect(
      fallbackViewAllPath(src({ type: "collection", collectionId: "col-1" }), cats, [COLLECTION]),
    ).toBe("/coleccion/nadas");
    expect(fallbackViewAllPath(src({ type: "latest" }), cats, [])).toBe("/tienda");
    expect(fallbackViewAllPath(src({ type: "manual" }), cats, [])).toBeNull();
    expect(fallbackViewAllPath(src({ type: "category", categoryId: "x" }), cats, [])).toBeNull();
  });

  it("codifica el slug en la ruta", () => {
    const odd = [{ ...CATEGORY, slug: "a b/c" }];
    expect(fallbackViewAllPath(src({ type: "category", categoryId: "cat-1" }), odd, [])).toBe(
      "/categoria/a%20b%2Fc",
    );
  });
});
