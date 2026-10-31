import { describe, expect, it } from "vitest";
import {
  activeFilters,
  applyDraft,
  draftFromQuery,
  includesValue,
  mergeListingParams,
  normalizeKey,
  parsePriceInput,
  removeValue,
  toggleValue,
  withoutFilter,
  withoutFilters,
  type FilterDraft,
} from "./filterDraft";
import { DEFAULT_QUERY, MAX_FILTER_VALUES, toSearchParams, type ListingQuery } from "./listParams";

const q = (over: Partial<ListingQuery> = {}): ListingQuery => ({ ...DEFAULT_QUERY, ...over });
const draft = (over: Partial<FilterDraft> = {}): FilterDraft => ({
  colors: [],
  sizes: [],
  min: "",
  max: "",
  inStockOnly: false,
  ...over,
});

describe("normalizeKey / includesValue", () => {
  it.each([
    ["Rójo", "rojo"],
    ["  AZUL   Marino ", "azul marino"],
    ["Ñandú", "nandu"],
    ["", ""],
  ])("normalizeKey(%j) = %j", (input, expected) => {
    expect(normalizeKey(input)).toBe(expected);
  });

  it("includesValue ignora mayúsculas, acentos y espacios sobrantes", () => {
    expect(includesValue(["Rojo"], "rójo ")).toBe(true);
    expect(includesValue(["Rojo"], "azul")).toBe(false);
    expect(includesValue([], "rojo")).toBe(false);
  });
});

describe("toggleValue / removeValue", () => {
  it("añade si no está y quita si está (aunque cambie el acento o la mayúscula)", () => {
    expect(toggleValue([], "Rojo")).toEqual(["Rojo"]);
    expect(toggleValue(["Rojo"], "rójo")).toEqual([]);
    expect(toggleValue(["Rojo"], "Azul")).toEqual(["Rojo", "Azul"]);
  });
  it("no pasa del tope de valores de la URL", () => {
    const full = Array.from({ length: MAX_FILTER_VALUES }, (_, i) => `c${i}`);
    expect(toggleValue(full, "extra")).toHaveLength(MAX_FILTER_VALUES);
    expect(toggleValue(full, "extra")).not.toContain("extra");
  });
  it("removeValue deja el resto en su orden", () => {
    expect(removeValue(["a", "B", "c"], "b")).toEqual(["a", "c"]);
  });
});

describe("parsePriceInput", () => {
  it.each([
    ["", null],
    ["   ", null],
    ["100", 100],
    ["100.5", 100.5],
    ["100,50", 100.5],
    ["0", 0],
    [" 12 ", 12],
    ["0,99", 0.99],
  ])("«%s» es válido → %s", (text, value) => {
    expect(parsePriceInput(text)).toEqual({ ok: true, value });
  });

  it.each([
    "abc",
    "-5",
    "+5",
    "1e3",
    "1.2.3",
    "100,555",
    "1.000,50",
    "1 000",
    "12345678901",
    ".5",
    "5.",
    "Infinity",
    "NaN",
    "٣",
  ])("«%s» no es válido", (text) => {
    expect(parsePriceInput(text)).toEqual({ ok: false });
  });
});

describe("applyDraft", () => {
  it("aplica todo y vuelve a la página 1, conservando el orden", () => {
    const result = applyDraft(
      q({ page: 4, sort: "price_desc" }),
      draft({ colors: ["Rojo"], sizes: ["M"], min: "10", max: "99,5", inStockOnly: true }),
    );
    expect(result).toEqual({
      ok: true,
      query: q({
        colors: ["Rojo"],
        sizes: ["M"],
        minPrice: 10,
        maxPrice: 99.5,
        inStockOnly: true,
        sort: "price_desc",
        page: 1,
      }),
    });
  });

  it("un mínimo mayor que el máximo se corrige intercambiándolos", () => {
    const result = applyDraft(q(), draft({ min: "300", max: "100" }));
    expect(result).toMatchObject({ ok: true, query: { minPrice: 100, maxPrice: 300 } });
  });

  it("precio vacío = sin límite", () => {
    expect(applyDraft(q({ minPrice: 5 }), draft({ max: "50" }))).toMatchObject({
      ok: true,
      query: { minPrice: null, maxPrice: 50 },
    });
  });

  it("un precio inválido NO aplica nada e indica cuál campo falló", () => {
    expect(applyDraft(q(), draft({ min: "abc", max: "10" }))).toEqual({
      ok: false,
      errors: { min: true, max: false },
    });
    expect(applyDraft(q(), draft({ min: "1", max: "-2" }))).toEqual({
      ok: false,
      errors: { min: false, max: true },
    });
    expect(applyDraft(q(), draft({ min: "x", max: "y" }))).toEqual({
      ok: false,
      errors: { min: true, max: true },
    });
  });

  it("draftFromQuery y applyDraft son inversos", () => {
    const query = q({
      colors: ["Rojo"],
      sizes: ["S", "M"],
      minPrice: 10,
      maxPrice: 99.5,
      inStockOnly: true,
    });
    expect(applyDraft(q(), draftFromQuery(query))).toEqual({ ok: true, query });
    expect(draftFromQuery(DEFAULT_QUERY)).toEqual(draft());
  });
});

describe("filtros activos", () => {
  const query = q({
    colors: ["Rojo", "Azul"],
    sizes: ["M"],
    minPrice: 1,
    maxPrice: 9,
    inStockOnly: true,
    sort: "name",
    page: 3,
  });

  it("activeFilters: cada color y talla, UN precio y disponibilidad; en ese orden", () => {
    expect(activeFilters(query)).toEqual([
      { kind: "color", value: "Rojo" },
      { kind: "color", value: "Azul" },
      { kind: "size", value: "M" },
      { kind: "price" },
      { kind: "stock" },
    ]);
    expect(activeFilters(DEFAULT_QUERY)).toEqual([]);
    expect(activeFilters(q({ maxPrice: 5 }))).toEqual([{ kind: "price" }]);
  });

  it("withoutFilter quita solo ese filtro y vuelve a la página 1 (conserva el orden)", () => {
    expect(withoutFilter(query, { kind: "color", value: "rojo" })).toMatchObject({
      colors: ["Azul"],
      page: 1,
      sort: "name",
      sizes: ["M"],
    });
    expect(withoutFilter(query, { kind: "size", value: "M" })).toMatchObject({
      sizes: [],
      colors: ["Rojo", "Azul"],
    });
    expect(withoutFilter(query, { kind: "price" })).toMatchObject({
      minPrice: null,
      maxPrice: null,
      inStockOnly: true,
    });
    expect(withoutFilter(query, { kind: "stock" })).toMatchObject({
      inStockOnly: false,
      minPrice: 1,
    });
  });

  it("withoutFilters quita todos los filtros, conserva el orden y vuelve a la página 1", () => {
    expect(withoutFilters(query)).toEqual(q({ sort: "name" }));
  });
});

describe("mergeListingParams", () => {
  it("reescribe los parámetros del listado y CONSERVA los ajenos (utm, fbclid, q)", () => {
    const current = new URLSearchParams(
      "utm_source=ig&color=Viejo&pagina=3&fbclid=abc&q=hola&orden=nombre",
    );
    const merged = mergeListingParams(current, toSearchParams(q({ colors: ["Rojo"], page: 2 })));
    expect(merged.get("utm_source")).toBe("ig");
    expect(merged.get("fbclid")).toBe("abc");
    expect(merged.get("q")).toBe("hola");
    expect(merged.getAll("color")).toEqual(["Rojo"]);
    expect(merged.get("pagina")).toBe("2");
    expect(merged.has("orden")).toBe(false);
  });

  it("sin filtros nuevos borra los del listado", () => {
    const merged = mergeListingParams(
      new URLSearchParams("color=Rojo&min=5&disponibles=1"),
      toSearchParams(DEFAULT_QUERY),
    );
    expect(merged.toString()).toBe("");
  });

  it("no modifica el objeto original", () => {
    const current = new URLSearchParams("color=Rojo");
    mergeListingParams(current, new URLSearchParams());
    expect(current.toString()).toBe("color=Rojo");
  });
});
