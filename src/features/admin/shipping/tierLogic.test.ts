import { describe, expect, it } from "vitest";
import {
  draftFromParams,
  emptyDraft,
  MAX_COST,
  MAX_KM,
  MAX_TIERS,
  parseNumber,
  tierSpans,
  validateDistanceDraft,
  type DistanceDraft,
} from "./tierLogic";

const draft = (over: Partial<DistanceDraft> = {}): DistanceDraft => ({
  tiers: [
    { upTo: "3", cost: "15" },
    { upTo: "6", cost: "20" },
    { upTo: "10", cost: "30" },
  ],
  extraPerKm: "3",
  minCost: "15",
  maxCost: "60",
  ...over,
});

describe("parseNumber", () => {
  it.each([
    ["3", 3],
    ["3,5", 3.5],
    ["3.5", 3.5],
    [" 12 ", 12],
    ["0", 0],
    ["0,25", 0.25],
    [",5", 0.5],
    ["-2", -2],
    ["1000000", 1000000],
  ])("lee %j como %d", (input, expected) => expect(parseNumber(input)).toBe(expected));
  it.each([
    "",
    "  ",
    "abc",
    "1e3",
    "3,5,2",
    "3.5.2",
    "+3",
    "∞",
    "NaN",
    "Infinity",
    "3 km",
    "1 000",
    "--1",
    "3,",
  ])("rechaza %j", (input) => expect(parseNumber(input)).toBeNull());
});

describe("validateDistanceDraft", () => {
  it("un borrador bueno da los parámetros exactos (números, no textos), con la coma decimal en español", () => {
    const v = validateDistanceDraft(draft({ extraPerKm: "2,5", minCost: "", maxCost: "60.50" }));
    expect(v.errors).toEqual({ rows: [{}, {}, {}] });
    expect(v.params).toEqual({
      kind: "distance",
      tiers: [
        { upToKm: 3, cost: 15 },
        { upToKm: 6, cost: 20 },
        { upToKm: 10, cost: 30 },
      ],
      extraPerKm: 2.5,
      minCost: null,
      maxCost: 60.5,
    });
  });
  it("los opcionales vacíos quedan en null (no 0)", () => {
    const v = validateDistanceDraft(draft({ extraPerKm: "", minCost: "", maxCost: "" }));
    expect(v.params).toMatchObject({ extraPerKm: null, minCost: null, maxCost: null });
  });
  it("sin tramos o con demasiados se avisa en la lista", () => {
    expect(validateDistanceDraft(draft({ tiers: [] })).errors.list).toBe("no_tiers");
    expect(validateDistanceDraft(draft({ tiers: [] })).params).toBeNull();
    const many = Array.from({ length: MAX_TIERS + 1 }, (_, i) => ({
      upTo: String(i + 1),
      cost: "1",
    }));
    expect(validateDistanceDraft(draft({ tiers: many })).errors.list).toBe("too_many");
    const exact = Array.from({ length: MAX_TIERS }, (_, i) => ({ upTo: String(i + 1), cost: "1" }));
    expect(validateDistanceDraft(draft({ tiers: exact })).errors.list).toBeUndefined();
    expect(validateDistanceDraft(draft({ tiers: exact })).params).not.toBeNull();
  });
  it("cada «hasta» debe ser MAYOR que el anterior: igual o menor se marca en esa fila", () => {
    const v = validateDistanceDraft(
      draft({
        tiers: [
          { upTo: "3", cost: "1" },
          { upTo: "3", cost: "2" },
          { upTo: "2", cost: "3" },
          { upTo: "5", cost: "4" },
        ],
      }),
    );
    expect(v.errors.rows).toEqual([{}, { upTo: "order" }, { upTo: "order" }, {}]);
    expect(v.params).toBeNull();
  });
  it("un tramo mal escrito no arrastra errores de orden a los siguientes", () => {
    const v = validateDistanceDraft(
      draft({
        tiers: [
          { upTo: "abc", cost: "1" },
          { upTo: "2", cost: "2" },
        ],
      }),
    );
    expect(v.errors.rows).toEqual([{ upTo: "number" }, {}]);
  });
  it("explica el problema de cada campo numérico", () => {
    const rows = validateDistanceDraft(
      draft({
        tiers: [
          { upTo: "", cost: "5" },
          { upTo: "0", cost: "5" },
          { upTo: "-1", cost: "5" },
          { upTo: String(MAX_KM + 1), cost: "5" },
          { upTo: "1", cost: "" },
          { upTo: "2", cost: "x" },
          { upTo: "3", cost: "-5" },
          { upTo: "4", cost: String(MAX_COST + 1) },
        ],
      }),
    ).errors.rows;
    expect(rows[0]).toEqual({ upTo: "required" });
    expect(rows[1]).toEqual({ upTo: "zero" });
    expect(rows[2]).toEqual({ upTo: "negative" });
    expect(rows[3]).toEqual({ upTo: "too_big" });
    expect(rows[4]).toEqual({ cost: "required" });
    expect(rows[5]).toEqual({ cost: "number" });
    expect(rows[6]).toEqual({ cost: "negative" });
    expect(rows[7]).toEqual({ cost: "too_big" });
  });
  it("el costo 0 es válido (envío gratis en ese tramo); el «hasta 0» no", () => {
    expect(
      validateDistanceDraft(draft({ tiers: [{ upTo: "3", cost: "0" }] })).params,
    ).not.toBeNull();
    expect(validateDistanceDraft(draft({ tiers: [{ upTo: "0", cost: "1" }] })).params).toBeNull();
  });
  it("los límites exactos (20000 km; 999999,9999) son válidos", () => {
    const v = validateDistanceDraft(
      draft({
        tiers: [{ upTo: String(MAX_KM), cost: String(MAX_COST) }],
        extraPerKm: "",
        minCost: "",
        maxCost: "",
      }),
    );
    expect(v.params).not.toBeNull();
  });
  it("km adicional, mínimo y máximo: se explican por separado y el mínimo no puede superar al máximo", () => {
    const bad = validateDistanceDraft(
      draft({ extraPerKm: "x", minCost: "-1", maxCost: "2000000" }),
    );
    expect(bad.errors).toMatchObject({
      extraPerKm: "number",
      minCost: "negative",
      maxCost: "too_big",
    });
    const range = validateDistanceDraft(draft({ minCost: "50", maxCost: "10" }));
    expect(range.errors.range).toBe("min_gt_max");
    expect(range.params).toBeNull();
    expect(validateDistanceDraft(draft({ minCost: "10", maxCost: "10" })).params).not.toBeNull(); // iguales sí
    // el borde fino: un mínimo apenas mayor que el máximo ya es un error
    expect(validateDistanceDraft(draft({ minCost: "10,5", maxCost: "10" })).errors.range).toBe(
      "min_gt_max",
    );
    expect(validateDistanceDraft(draft({ minCost: "10", maxCost: "10,01" })).params).not.toBeNull();
  });
  it("con cualquier problema los parámetros son null: nunca se guarda a medias", () => {
    for (const bad of [
      draft({ tiers: [] }),
      draft({ extraPerKm: "x" }),
      draft({ minCost: "9", maxCost: "1" }),
    ]) {
      expect(validateDistanceDraft(bad).params).toBeNull();
    }
  });
});

describe("borrador ↔ parámetros", () => {
  it("ida y vuelta sin pérdida", () => {
    const v = validateDistanceDraft(draft());
    const back = draftFromParams(v.params!);
    expect(back).toEqual({
      tiers: [
        { upTo: "3", cost: "15" },
        { upTo: "6", cost: "20" },
        { upTo: "10", cost: "30" },
      ],
      extraPerKm: "3",
      minCost: "15",
      maxCost: "60",
    });
    expect(validateDistanceDraft(back).params).toEqual(v.params);
  });
  it("los opcionales ausentes vuelven como texto vacío", () => {
    const v = validateDistanceDraft(draft({ extraPerKm: "", minCost: "", maxCost: "" }));
    expect(draftFromParams(v.params!)).toMatchObject({ extraPerKm: "", minCost: "", maxCost: "" });
  });
  it("el borrador vacío trae UNA fila en blanco y no es válido", () => {
    expect(emptyDraft().tiers).toHaveLength(1);
    expect(validateDistanceDraft(emptyDraft()).params).toBeNull();
  });
});

describe("tierSpans", () => {
  it("convierte los «hasta» en intervalos 0–3, 3–6, 6–10", () => {
    expect(
      tierSpans([
        { upToKm: 3, cost: 15 },
        { upToKm: 6, cost: 20 },
        { upToKm: 10, cost: 30 },
      ]),
    ).toEqual([
      { fromKm: 0, toKm: 3, cost: 15 },
      { fromKm: 3, toKm: 6, cost: 20 },
      { fromKm: 6, toKm: 10, cost: 30 },
    ]);
    expect(tierSpans([])).toEqual([]);
  });
});
