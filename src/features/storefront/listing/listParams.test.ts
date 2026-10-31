import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  DEFAULT_QUERY,
  isFiltered,
  listingSeo,
  MAX_FILTER_VALUES,
  parseListingQuery,
  toSearchParams,
  withChange,
  type ListingQuery,
} from "./listParams";

const q = (over: Partial<ListingQuery> = {}): ListingQuery => ({ ...DEFAULT_QUERY, ...over });

describe("parseListingQuery", () => {
  it("URL vacía = valores por defecto", () => {
    expect(parseListingQuery("")).toEqual(DEFAULT_QUERY);
  });

  it("lee todos los filtros, el orden y la página", () => {
    expect(
      parseListingQuery(
        "color=Rojo&color=azul&talla=M&min=100&max=250.5&disponibles=1&orden=precio-desc&pagina=3",
      ),
    ).toEqual(
      q({
        colors: ["Rojo", "azul"],
        sizes: ["M"],
        minPrice: 100,
        maxPrice: 250.5,
        inStockOnly: true,
        sort: "price_desc",
        page: 3,
      }),
    );
  });

  it("acepta un URLSearchParams ya armado", () => {
    expect(parseListingQuery(new URLSearchParams({ talla: "S" })).sizes).toEqual(["S"]);
  });

  it.each([
    ["nuevos", "newest"],
    ["precio-asc", "price_asc"],
    ["precio-desc", "price_desc"],
    ["nombre", "name"],
  ])("orden «%s» → %s", (param, sort) => {
    expect(parseListingQuery(`orden=${param}`).sort).toBe(sort);
  });

  it.each(["", "x", "PRECIO-ASC", "price_asc", "'; drop table", "constructor", "__proto__"])(
    "orden desconocido «%s» cae al orden por defecto (nunca lanza)",
    (value) => {
      expect(parseListingQuery(new URLSearchParams({ orden: value })).sort).toBe("newest");
    },
  );

  it.each([
    ["0", 1],
    ["-3", 1],
    ["abc", 1],
    ["1.5", 1],
    ["1e3", 1],
    ["99999999", 1],
    ["10001", 1],
    ["10000", 10000],
    ["2", 2],
    [" 7 ", 7],
  ])("página «%s» → %i", (raw, page) => {
    expect(parseListingQuery(new URLSearchParams({ pagina: raw })).page).toBe(page);
  });

  it.each([
    ["100", 100],
    ["100.5", 100.5],
    ["0", 0],
    ["0.99", 0.99],
    ["-5", null],
    ["1e3", null],
    ["1,5", null],
    ["12.345", null],
    ["abc", null],
    ["", null],
    ["9999999999", null],
    ["Infinity", null],
    ["NaN", null],
  ])("precio mínimo «%s» → %s", (raw, expected) => {
    expect(parseListingQuery(new URLSearchParams({ min: raw })).minPrice).toBe(expected);
  });

  it("un rango invertido (min > max) se corrige intercambiándolos, no se pierde la intención", () => {
    const parsed = parseListingQuery("min=300&max=100");
    expect([parsed.minPrice, parsed.maxPrice]).toEqual([100, 300]);
  });

  it("solo «disponibles=1» activa el filtro (true, yes, on… no)", () => {
    for (const v of ["true", "yes", "on", "0", "2", ""]) {
      expect(parseListingQuery(new URLSearchParams({ disponibles: v })).inStockOnly).toBe(false);
    }
    expect(parseListingQuery("disponibles=1").inStockOnly).toBe(true);
  });

  it("colores y tallas: recorta espacios, descarta vacíos, repetidos (aun con otras mayúsculas) y los demasiado largos", () => {
    const parsed = parseListingQuery(
      new URLSearchParams([
        ["color", "  Rojo  "],
        ["color", "rojo"],
        ["color", "ROJO"],
        ["color", ""],
        ["color", "   "],
        ["color", "a".repeat(41)],
        ["color", "a".repeat(40)],
        ["talla", "  M "],
        ["talla", "m"],
      ]),
    );
    expect(parsed.colors).toEqual(["Rojo", "a".repeat(40)]);
    expect(parsed.sizes).toEqual(["M"]);
  });

  it("colapsa espacios internos y quita caracteres de control", () => {
    const parsed = parseListingQuery(
      new URLSearchParams([["color", "Azul\u0000   \tmarino\u001f"]]),
    );
    expect(parsed.colors).toEqual(["Azul marino"]);
  });

  it(`acota la cantidad de valores a ${MAX_FILTER_VALUES}`, () => {
    const many = new URLSearchParams(Array.from({ length: 50 }, (_, i) => ["color", `c${i}`]));
    const parsed = parseListingQuery(many);
    expect(parsed.colors).toHaveLength(MAX_FILTER_VALUES);
    expect(parsed.colors[0]).toBe("c0");
  });

  it("valores con caracteres peligrosos se conservan como texto (la base los trata como datos)", () => {
    const parsed = parseListingQuery(
      new URLSearchParams([["color", "'; drop table products; --"]]),
    );
    expect(parsed.colors).toEqual(["'; drop table products; --"]);
  });

  it("parámetros desconocidos se ignoran", () => {
    expect(parseListingQuery("utm_source=x&fbclid=y&foo=bar")).toEqual(DEFAULT_QUERY);
  });
});

describe("toSearchParams", () => {
  it("el estado por defecto no escribe nada (URL limpia)", () => {
    expect(toSearchParams(DEFAULT_QUERY).toString()).toBe("");
  });

  it("escribe solo lo que no es valor por defecto", () => {
    expect(toSearchParams(q({ sort: "price_asc", page: 2 })).toString()).toBe(
      "orden=precio-asc&pagina=2",
    );
    expect(toSearchParams(q({ page: 1, sort: "newest" })).toString()).toBe("");
  });

  it("colores y tallas repetidos con el mismo nombre de parámetro", () => {
    expect(toSearchParams(q({ colors: ["Rojo", "Azul"], sizes: ["M"] })).toString()).toBe(
      "color=Rojo&color=Azul&talla=M",
    );
  });

  it("codifica lo que lo necesita (acentos, espacios, &)", () => {
    const text = toSearchParams(q({ colors: ["Azúl & verde"] })).toString();
    expect(text).toBe("color=Az%C3%BAl+%26+verde");
    expect(parseListingQuery(text).colors).toEqual(["Azúl & verde"]);
  });

  it("ida y vuelta: parse(toSearchParams(x)) == x para estados válidos", () => {
    const samples: ListingQuery[] = [
      DEFAULT_QUERY,
      q({ colors: ["Rojo"], page: 4 }),
      q({ sizes: ["XL", "M"], minPrice: 10, maxPrice: 99.99, inStockOnly: true }),
      q({ sort: "name", colors: ["Azúl", "Crudo"], sizes: ["S"], minPrice: 0, page: 10_000 }),
      q({ sort: "price_desc", maxPrice: 1 }),
    ];
    for (const sample of samples) {
      expect(parseListingQuery(toSearchParams(sample))).toEqual(sample);
    }
  });
});

describe("filtros activos", () => {
  it("isFiltered ignora orden y página", () => {
    expect(isFiltered(q({ sort: "price_asc", page: 5 }))).toBe(false);
    expect(isFiltered(q({ colors: ["Rojo"] }))).toBe(true);
    expect(isFiltered(q({ minPrice: 0 }))).toBe(true);
    expect(isFiltered(q({ inStockOnly: true }))).toBe(true);
  });

  it("activeFilterCount: cada color y talla cuenta; el rango de precio cuenta UNA vez", () => {
    expect(activeFilterCount(DEFAULT_QUERY)).toBe(0);
    expect(
      activeFilterCount(
        q({ colors: ["a", "b"], sizes: ["M"], minPrice: 1, maxPrice: 9, inStockOnly: true }),
      ),
    ).toBe(5);
    expect(activeFilterCount(q({ maxPrice: 9 }))).toBe(1);
  });

  it("withChange vuelve a la página 1 salvo que se pida otra", () => {
    expect(withChange(q({ page: 4 }), { colors: ["Rojo"] }).page).toBe(1);
    expect(withChange(q({ page: 4 }), { sort: "name" }).page).toBe(1);
    expect(withChange(q({ page: 4 }), { page: 5 }).page).toBe(5);
  });
});

describe("listingSeo", () => {
  it("la primera página sin filtros se indexa y su canónico es la ruta limpia", () => {
    expect(listingSeo("/categoria/ropa", DEFAULT_QUERY, 3)).toEqual({
      canonicalPath: "/categoria/ropa",
      robots: "index,follow",
      prevPath: null,
      nextPath: "/categoria/ropa?pagina=2",
    });
  });

  it("páginas intermedias: canónico a sí misma y enlaces prev/next", () => {
    expect(listingSeo("/tienda", q({ page: 2 }), 3)).toEqual({
      canonicalPath: "/tienda?pagina=2",
      robots: "index,follow",
      prevPath: "/tienda",
      nextPath: "/tienda?pagina=3",
    });
  });

  it("última página: sin «siguiente»", () => {
    expect(listingSeo("/tienda", q({ page: 3 }), 3).nextPath).toBeNull();
  });

  it("filtros u orden NO se indexan y el canónico apunta al listado limpio (sin variaciones infinitas)", () => {
    for (const query of [
      q({ colors: ["Rojo"] }),
      q({ sort: "price_asc" }),
      q({ inStockOnly: true, page: 1 }),
    ]) {
      const seo = listingSeo("/categoria/ropa", query, 5);
      expect(seo.robots).toBe("noindex,follow");
      expect(seo.canonicalPath).toBe("/categoria/ropa");
    }
  });

  it("una página fuera de rango se acota a la última real", () => {
    expect(listingSeo("/tienda", q({ page: 99 }), 3).canonicalPath).toBe("/tienda?pagina=3");
    expect(listingSeo("/tienda", q({ page: 5 }), 0).canonicalPath).toBe("/tienda");
  });
});
