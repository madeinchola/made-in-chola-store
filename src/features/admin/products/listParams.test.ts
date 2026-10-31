import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIST_PARAMS,
  applyPatch,
  PAGE_SIZE,
  hasActiveFilters,
  parseListParams,
  toSearchParams,
} from "./listParams";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const parse = (qs: string) => parseListParams(new URLSearchParams(qs));

describe("parseListParams", () => {
  it("sin parámetros: valores por defecto (sin archivados, más recientes, página 1)", () => {
    expect(parse("")).toEqual({ state: "all", sort: "newest", page: 1, pageSize: PAGE_SIZE });
  });

  it("entiende cada parámetro", () => {
    expect(
      parse(
        `q=camisa&estado=borradores&orden=nombre&categoria=${C1}&coleccion=${C2}&stock=critical&pagina=3`,
      ),
    ).toEqual({
      search: "camisa",
      state: "draft",
      sort: "name",
      categoryId: C1,
      collectionId: C2,
      stockLight: "critical",
      page: 3,
      pageSize: PAGE_SIZE,
    });
  });

  it.each([
    ["todos", "all"],
    ["publicados", "active"],
    ["borradores", "draft"],
    ["agotados", "soldout"],
    ["archivados", "archived"],
  ])("estado=%s → %s", (url, state) => {
    expect(parse(`estado=${url}`).state).toBe(state);
  });

  it.each([
    ["recientes", "newest"],
    ["editados", "updated"],
    ["nombre", "name"],
    ["codigo", "code"],
  ])("orden=%s → %s", (url, sort) => {
    expect(parse(`orden=${url}`).sort).toBe(sort);
  });

  it("el filtro de stock admite 'alert' (cualquier alerta, el de la campana)", () => {
    expect(parse("stock=alert").stockLight).toBe("alert");
    for (const light of ["ok", "low", "critical", "out"])
      expect(parse(`stock=${light}`).stockLight).toBe(light);
  });

  it("valores inválidos caen al valor por defecto, sin romper", () => {
    const p = parse("estado=x&orden=y&stock=z&categoria=no-es-uuid&coleccion=123&pagina=abc");
    expect(p).toEqual(DEFAULT_LIST_PARAMS);
  });

  it.each(["0", "-1", "3.5", "abc", "", "1e3", "999999"])("pagina=%s inválida → 1", (page) => {
    expect(parse(`pagina=${page}`).page).toBe(1);
  });

  it("la búsqueda se recorta y se limita a 100 caracteres; vacía = sin búsqueda", () => {
    expect(parse("q=%20%20camisa%20%20").search).toBe("camisa");
    expect(parse(`q=${"a".repeat(300)}`).search).toHaveLength(100);
    expect(parse("q=%20%20").search).toBeUndefined();
  });

  it("un id de categoría con mayúsculas es válido (UUID sin distinguir caja)", () => {
    expect(parse(`categoria=${C1.toUpperCase()}`).categoryId).toBe(C1.toUpperCase());
  });
});

describe("toSearchParams", () => {
  it("los valores por defecto no ensucian la URL", () => {
    expect(toSearchParams(DEFAULT_LIST_PARAMS).toString()).toBe("");
  });

  it("ida y vuelta: lo que se escribe en la URL se lee igual", () => {
    const original = {
      search: "camisa roja",
      state: "soldout" as const,
      sort: "code" as const,
      categoryId: C1,
      collectionId: C2,
      stockLight: "alert" as const,
      page: 4,
      pageSize: PAGE_SIZE,
    };
    expect(parseListParams(toSearchParams(original))).toEqual(original);
  });

  it("la página 1 no se escribe; las siguientes sí", () => {
    expect(toSearchParams({ ...DEFAULT_LIST_PARAMS, page: 1 }).has("pagina")).toBe(false);
    expect(toSearchParams({ ...DEFAULT_LIST_PARAMS, page: 2 }).get("pagina")).toBe("2");
  });

  it("caracteres especiales en la búsqueda sobreviven a la URL (acentos, ñ, &, =)", () => {
    const search = "ñandú & café = 100%";
    const sp = toSearchParams({ ...DEFAULT_LIST_PARAMS, search });
    expect(parseListParams(new URLSearchParams(sp.toString())).search).toBe(search);
  });
});

describe("hasActiveFilters", () => {
  it("ni el orden ni la página cuentan como filtros", () => {
    expect(hasActiveFilters({ ...DEFAULT_LIST_PARAMS, sort: "name", page: 5 })).toBe(false);
  });
  it("búsqueda, estado, categoría, colección o stock sí", () => {
    expect(hasActiveFilters({ ...DEFAULT_LIST_PARAMS, search: "x" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_LIST_PARAMS, state: "draft" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_LIST_PARAMS, categoryId: C1 })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_LIST_PARAMS, collectionId: C1 })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_LIST_PARAMS, stockLight: "low" })).toBe(true);
  });
});

describe("applyPatch", () => {
  const base = { ...DEFAULT_LIST_PARAMS, categoryId: C1, stockLight: "low" as const, page: 4 };

  it("cambiar un filtro vuelve a la página 1 y conserva los demás", () => {
    expect(applyPatch(base, { state: "draft" })).toEqual({
      ...DEFAULT_LIST_PARAMS,
      categoryId: C1,
      stockLight: "low",
      state: "draft",
      page: 1,
    });
  });

  it("un valor undefined QUITA el filtro (elegir 'Todas'), sin tocar los otros", () => {
    const next = applyPatch(base, { categoryId: undefined });
    expect("categoryId" in next).toBe(false);
    expect(next.stockLight).toBe("low");
    expect(next.page).toBe(1);
  });

  it("cambiar de página conserva la página pedida (no la reinicia)", () => {
    expect(applyPatch(base, { page: 5 }).page).toBe(5);
  });

  it("no modifica el objeto recibido", () => {
    const copy = { ...base };
    applyPatch(base, { categoryId: undefined, state: "soldout" });
    expect(base).toEqual(copy);
  });

  it("quitar un filtro y volver a escribir la URL deja de incluirlo", () => {
    const sp = toSearchParams(applyPatch(base, { categoryId: undefined, page: 1 }));
    expect(sp.has("categoria")).toBe(false);
    expect(sp.get("stock")).toBe("low");
  });
});
