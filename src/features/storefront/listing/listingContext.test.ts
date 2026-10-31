import { describe, expect, it } from "vitest";
import { CATEGORIES } from "./listing-test-utils";
import { categoryTrail, findCategory, totalPagesOf } from "./listingContext";

describe("findCategory / categoryTrail", () => {
  it("encuentra una raíz y una hija, a cualquier nivel", () => {
    expect(findCategory(CATEGORIES, "ropa")?.name).toBe("Ropa");
    expect(findCategory(CATEGORIES, "chaquetas")?.name).toBe("Chaquetas");
  });

  it("slug inexistente (o con otras mayúsculas) → null / vacío", () => {
    expect(findCategory(CATEGORIES, "nada")).toBeNull();
    expect(findCategory(CATEGORIES, "Ropa")).toBeNull();
    expect(categoryTrail(CATEGORIES, "nada")).toEqual([]);
    expect(findCategory([], "ropa")).toBeNull();
  });

  it("el camino va de la raíz a la categoría", () => {
    expect(categoryTrail(CATEGORIES, "chaquetas").map((c) => c.slug)).toEqual([
      "ropa",
      "chaquetas",
    ]);
    expect(categoryTrail(CATEGORIES, "sombreros").map((c) => c.slug)).toEqual(["sombreros"]);
  });
});

describe("totalPagesOf", () => {
  it.each([
    [0, 1],
    [-4, 1],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
    [1, 1],
    [24, 1],
    [25, 2],
    [48, 2],
    [49, 3],
    [50, 3],
    [240, 10],
  ])("total %s con 24 por página → %s páginas", (total, pages) => {
    expect(totalPagesOf(total)).toBe(pages);
  });
  it("otro tamaño de página", () => {
    expect(totalPagesOf(25, 10)).toBe(3);
  });
});
