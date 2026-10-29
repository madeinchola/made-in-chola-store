import { describe, expect, it } from "vitest";
import { catalogKeys } from "./queryKeys";

describe("catalogKeys", () => {
  it("toda clave cuelga de ['catalog'] (invalidar 'all' limpia todo)", () => {
    const keys = [
      catalogKeys.products(),
      catalogKeys.productList({ categorySlug: "ropa" }),
      catalogKeys.product("x"),
      catalogKeys.search("chaq"),
      catalogKeys.categories(),
      catalogKeys.collections(),
      catalogKeys.banner(),
      catalogKeys.settings(),
      catalogKeys.home(),
      catalogKeys.adminStock(),
      catalogKeys.adminProductStock(),
    ];
    for (const k of keys) expect(k[0]).toBe("catalog");
  });

  it("los mismos parámetros dan la misma clave, sin importar el orden de las propiedades", () => {
    const a = catalogKeys.productList({ categorySlug: "ropa", sort: "name", limit: 12 });
    const b = catalogKeys.productList({ limit: 12, sort: "name", categorySlug: "ropa" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("los valores por defecto se normalizan: {} equivale a los defaults explícitos", () => {
    expect(JSON.stringify(catalogKeys.productList())).toBe(
      JSON.stringify(catalogKeys.productList({ sort: "newest", limit: 24, offset: 0 })),
    );
  });

  it("parámetros distintos dan claves distintas (página 2 ≠ página 1; otra categoría ≠)", () => {
    const base = JSON.stringify(catalogKeys.productList({ categorySlug: "ropa" }));
    expect(JSON.stringify(catalogKeys.productList({ categorySlug: "ropa", offset: 24 }))).not.toBe(
      base,
    );
    expect(JSON.stringify(catalogKeys.productList({ categorySlug: "sombreros" }))).not.toBe(base);
    expect(
      JSON.stringify(catalogKeys.productList({ categorySlug: "ropa", sort: "price_asc" })),
    ).not.toBe(base);
  });

  it("la búsqueda ignora mayúsculas y espacios de los bordes", () => {
    expect(JSON.stringify(catalogKeys.search("  CHAQ "))).toBe(
      JSON.stringify(catalogKeys.search("chaq")),
    );
  });

  it("el stock de admin distingue 'todos' de un producto concreto", () => {
    expect(JSON.stringify(catalogKeys.adminStock())).not.toBe(
      JSON.stringify(catalogKeys.adminStock("p1")),
    );
  });
});
