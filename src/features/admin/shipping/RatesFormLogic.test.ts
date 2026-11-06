import { describe, expect, it } from "vitest";
import {
  currencyChoices,
  defaultCurrency,
  DEFAULT_PRIORITY,
  initialRateValues,
  MAX_ORDER_AMOUNT,
  MAX_PRIORITY,
  parseFlatCost,
  parsePriority,
  validateRate,
  type RateFormValues,
} from "./RatesFormLogic";
import { emptyDraft, MAX_COST } from "./tierLogic";
import type { RateRule } from "./types";

const flatValues = (over: Partial<RateFormValues> = {}): RateFormValues => ({
  name: "Tarifa fija",
  kind: "flat",
  draft: emptyDraft(),
  flatCost: "80",
  zoneId: "",
  minOrder: "",
  maxOrder: "",
  validFrom: "",
  validUntil: "",
  priority: "100",
  isActive: true,
  ...over,
});
const distanceValues = (over: Partial<RateFormValues> = {}): RateFormValues =>
  flatValues({
    name: "Por distancia",
    kind: "distance",
    flatCost: "",
    draft: {
      tiers: [
        { upTo: "3", cost: "15" },
        { upTo: "6,5", cost: "20" },
      ],
      extraPerKm: "2,5",
      minCost: "15",
      maxCost: "60",
    },
    ...over,
  });

const rule = (over: Partial<RateRule> = {}): RateRule => ({
  id: "r1",
  methodId: "m1",
  zoneId: "z1",
  name: "Entrega en ciudad",
  kind: "distance",
  params: {
    kind: "distance",
    tiers: [
      { upToKm: 3, cost: 15 },
      { upToKm: 6, cost: 20 },
    ],
    extraPerKm: 3,
    minCost: null,
    maxCost: 60,
  },
  minOrderAmount: 100,
  maxOrderAmount: 500.5,
  currency: "BOB",
  priority: 250,
  isActive: false,
  validFrom: "2026-11-05T12:00:00Z",
  validUntil: "2026-12-31T03:59:00Z",
  archived: false,
  updatedAt: "2026-11-05T10:00:00.123456+00:00",
  ...over,
});

describe("initialRateValues", () => {
  it("al crear: por distancia, un tramo vacío, activa, prioridad 100, sin zona ni límites", () => {
    expect(initialRateValues(null)).toEqual({
      name: "",
      kind: "distance",
      draft: { tiers: [{ upTo: "", cost: "" }], extraPerKm: "", minCost: "", maxCost: "" },
      flatCost: "",
      zoneId: "",
      minOrder: "",
      maxOrder: "",
      validFrom: "",
      validUntil: "",
      priority: String(DEFAULT_PRIORITY),
      isActive: true,
    });
    expect(DEFAULT_PRIORITY).toBe(100);
  });
  it("al editar: copia todo, con las fechas en hora de La Paz", () => {
    expect(initialRateValues(rule())).toEqual({
      name: "Entrega en ciudad",
      kind: "distance",
      draft: {
        tiers: [
          { upTo: "3", cost: "15" },
          { upTo: "6", cost: "20" },
        ],
        extraPerKm: "3",
        minCost: "",
        maxCost: "60",
      },
      flatCost: "",
      zoneId: "z1",
      minOrder: "100",
      maxOrder: "500.5",
      validFrom: "2026-11-05T08:00",
      validUntil: "2026-12-30T23:59",
      priority: "250",
      isActive: false,
    });
  });
  it("una tarifa fija trae su costo", () => {
    const v = initialRateValues(
      rule({ kind: "flat", params: { kind: "flat", cost: 80 }, zoneId: null }),
    );
    expect(v).toMatchObject({ kind: "flat", flatCost: "80", zoneId: "" });
  });
  it("una regla con parámetros ilegibles (null) arranca con el editor vacío, sin romper", () => {
    expect(initialRateValues(rule({ params: null })).draft).toEqual(emptyDraft());
    expect(initialRateValues(rule({ kind: "flat", params: null })).flatCost).toBe("");
  });
});

describe("parseFlatCost", () => {
  it.each([
    ["80", 80],
    ["0", 0],
    ["12,5", 12.5],
    ["12.5", 12.5],
    [" 7 ", 7],
    ["999999.9999", MAX_COST],
  ])("acepta %j como %d", (text, value) =>
    expect(parseFlatCost(text)).toEqual({ ok: true, value }),
  );
  it.each([
    ["", "required"],
    ["  ", "required"],
    ["abc", "number"],
    ["1e3", "number"],
    ["-1", "negative"],
    ["1000000", "too_big"],
    ["999999,99995", "too_big"],
  ])("rechaza %j con %s", (text, problem) =>
    expect(parseFlatCost(text)).toEqual({ ok: false, problem }),
  );
});

describe("parsePriority", () => {
  it.each([
    ["0", 0],
    ["100", 100],
    ["100000", MAX_PRIORITY],
    [" 7 ", 7],
    ["7,0", 7],
  ])("acepta %j como %d", (text, value) =>
    expect(parsePriority(text)).toEqual({ ok: true, value }),
  );
  it.each([
    ["", "required"],
    ["abc", "number"],
    ["1e2", "number"],
    ["10,5", "integer"],
    ["0.5", "integer"],
    ["-1", "range"],
    ["100001", "range"],
  ])("rechaza %j con %s", (text, problem) =>
    expect(parsePriority(text)).toEqual({ ok: false, problem }),
  );
});

describe("validateRate: lo que se envía (forma exacta de RateUpdateInput)", () => {
  it("tarifa fija: params {kind:'flat', cost}, sin zona = zoneId null, límites y fechas null", () => {
    expect(validateRate(flatValues())).toEqual({
      ok: true,
      payload: {
        zoneId: null,
        name: "Tarifa fija",
        params: { kind: "flat", cost: 80 },
        minOrderAmount: null,
        maxOrderAmount: null,
        priority: 100,
        isActive: true,
        validFrom: null,
        validUntil: null,
      },
    });
  });
  it("la coma decimal llega como número: «2,5» → 2.5 (costo fijo, tramos y km adicional)", () => {
    const flat = validateRate(flatValues({ flatCost: "2,5" }));
    expect(flat.ok && flat.payload.params).toEqual({ kind: "flat", cost: 2.5 });
    const dist = validateRate(distanceValues());
    expect(dist.ok && dist.payload.params).toEqual({
      kind: "distance",
      tiers: [
        { upToKm: 3, cost: 15 },
        { upToKm: 6.5, cost: 20 },
      ],
      extraPerKm: 2.5,
      minCost: 15,
      maxCost: 60,
    });
  });
  it("por distancia: params es EXACTAMENTE lo que da validateDistanceDraft (campos vacíos = null)", () => {
    const r = validateRate(
      distanceValues({
        draft: { tiers: [{ upTo: "3", cost: "15" }], extraPerKm: "", minCost: "", maxCost: "" },
      }),
    );
    expect(r.ok && r.payload.params).toEqual({
      kind: "distance",
      tiers: [{ upToKm: 3, cost: 15 }],
      extraPerKm: null,
      minCost: null,
      maxCost: null,
    });
  });
  it("zona, rango de monto, vigencia (La Paz → UTC), prioridad y activa", () => {
    const r = validateRate(
      flatValues({
        name: "  Gratis sobre 500  ",
        flatCost: "0",
        zoneId: "z1",
        minOrder: "500",
        maxOrder: "1000,5",
        validFrom: "2026-11-05T08:00",
        validUntil: "2026-12-30T23:59",
        priority: "900",
        isActive: false,
      }),
    );
    expect(r).toEqual({
      ok: true,
      payload: {
        zoneId: "z1",
        name: "Gratis sobre 500",
        params: { kind: "flat", cost: 0 },
        minOrderAmount: 500,
        maxOrderAmount: 1000.5,
        priority: 900,
        isActive: false,
        validFrom: "2026-11-05T12:00:00.000Z",
        validUntil: "2026-12-31T03:59:00.000Z",
      },
    });
  });
  it("el payload no lleva método, moneda ni tipo (no se cambian al editar)", () => {
    const r = validateRate(flatValues());
    expect(r.ok && Object.keys(r.payload).sort()).toEqual([
      "isActive",
      "maxOrderAmount",
      "minOrderAmount",
      "name",
      "params",
      "priority",
      "validFrom",
      "validUntil",
      "zoneId",
    ]);
  });
});

describe("validateRate: cada validación", () => {
  const errorsOf = (v: RateFormValues) => {
    const r = validateRate(v);
    if (r.ok) throw new Error("debía ser inválido");
    return r.errors;
  };
  it("nombre: obligatorio y hasta 80 caracteres (80 sí)", () => {
    expect(errorsOf(flatValues({ name: "  " }))).toEqual({ name: "required" });
    expect(errorsOf(flatValues({ name: "a".repeat(81) }))).toEqual({ name: "too_long" });
    expect(validateRate(flatValues({ name: "a".repeat(80) })).ok).toBe(true);
  });
  it("costo fijo: vacío, no numérico, negativo y demasiado grande", () => {
    expect(errorsOf(flatValues({ flatCost: "" }))).toEqual({ flatCost: "required" });
    expect(errorsOf(flatValues({ flatCost: "x" }))).toEqual({ flatCost: "number" });
    expect(errorsOf(flatValues({ flatCost: "-5" }))).toEqual({ flatCost: "negative" });
    expect(errorsOf(flatValues({ flatCost: "1000000" }))).toEqual({ flatCost: "too_big" });
  });
  it("el costo fijo vacío NO se revisa en una tarifa por distancia (y al revés)", () => {
    expect(validateRate(distanceValues({ flatCost: "" })).ok).toBe(true);
    expect(validateRate(flatValues({ draft: emptyDraft() })).ok).toBe(true);
  });
  it("por distancia: los problemas del editor de tramos se devuelven tal cual", () => {
    const e = errorsOf(
      distanceValues({
        draft: {
          tiers: [
            { upTo: "5", cost: "10" },
            { upTo: "5", cost: "x" },
          ],
          extraPerKm: "",
          minCost: "70",
          maxCost: "60",
        },
      }),
    );
    expect(e).toEqual({
      distance: {
        rows: [{}, { upTo: "order", cost: "number" }],
        range: "min_gt_max",
      },
    });
  });
  it("por distancia sin ningún tramo", () => {
    expect(errorsOf(distanceValues({ draft: { ...emptyDraft(), tiers: [] } }))).toEqual({
      distance: { rows: [], list: "no_tiers" },
    });
  });
  it("monto del pedido: no numérico, negativo, demasiado grande, y mínimo mayor que máximo", () => {
    expect(errorsOf(flatValues({ minOrder: "x" }))).toEqual({ minOrder: "number" });
    expect(errorsOf(flatValues({ maxOrder: "-1" }))).toEqual({ maxOrder: "negative" });
    expect(errorsOf(flatValues({ maxOrder: "10000000000" }))).toEqual({ maxOrder: "too_big" });
    expect(validateRate(flatValues({ maxOrder: String(MAX_ORDER_AMOUNT) })).ok).toBe(true);
    expect(errorsOf(flatValues({ minOrder: "500,01", maxOrder: "500" }))).toEqual({
      orderRange: "min_gt_max",
    });
  });
  it("monto del pedido: más de 2 decimales se RECHAZA (la base lo redondearía en silencio y movería el límite inclusivo)", () => {
    expect(errorsOf(flatValues({ minOrder: "99,99999" }))).toEqual({ minOrder: "decimals" });
    expect(errorsOf(flatValues({ maxOrder: "1,005" }))).toEqual({ maxOrder: "decimals" });
    // hasta 2 decimales vale, incluidos los que en coma flotante no son exactos
    expect(validateRate(flatValues({ minOrder: "0,07", maxOrder: "1234,56" })).ok).toBe(true);
    expect(validateRate(flatValues({ minOrder: "199,99" })).ok).toBe(true);
  });
  it("monto del pedido: mínimo = máximo vale (ambos inclusivos) y 0 es un valor, no «vacío»", () => {
    const r = validateRate(flatValues({ minOrder: "500", maxOrder: "500" }));
    expect(r.ok && [r.payload.minOrderAmount, r.payload.maxOrderAmount]).toEqual([500, 500]);
    const zero = validateRate(flatValues({ minOrder: "0", maxOrder: "0" }));
    expect(zero.ok && [zero.payload.minOrderAmount, zero.payload.maxOrderAmount]).toEqual([0, 0]);
  });
  it("monto del pedido: solo uno de los dos también vale", () => {
    const r = validateRate(flatValues({ minOrder: "100" }));
    expect(r.ok && [r.payload.minOrderAmount, r.payload.maxOrderAmount]).toEqual([100, null]);
  });
  it("vigencia: fecha ilegible, y «hasta» debe ser POSTERIOR a «desde» (igual no vale)", () => {
    expect(errorsOf(flatValues({ validFrom: "mañana" }))).toEqual({ validFrom: "invalid" });
    expect(errorsOf(flatValues({ validUntil: "2026-13-45T99:99" }))).toEqual({
      validUntil: "invalid",
    });
    expect(
      errorsOf(flatValues({ validFrom: "2026-11-05T08:00", validUntil: "2026-11-05T08:00" })),
    ).toEqual({ validUntil: "before_from" });
    expect(
      errorsOf(flatValues({ validFrom: "2026-11-05T08:00", validUntil: "2026-11-04T08:00" })),
    ).toEqual({ validUntil: "before_from" });
    expect(
      validateRate(flatValues({ validFrom: "2026-11-05T08:00", validUntil: "2026-11-05T08:01" }))
        .ok,
    ).toBe(true);
  });
  it("vigencia: con solo una de las dos no hay comparación", () => {
    expect(validateRate(flatValues({ validUntil: "2000-01-01T00:00" })).ok).toBe(true);
    expect(validateRate(flatValues({ validFrom: "2099-01-01T00:00" })).ok).toBe(true);
  });
  it("prioridad: vacía, no numérica, decimal y fuera de 0–100000", () => {
    expect(errorsOf(flatValues({ priority: "" }))).toEqual({ priority: "required" });
    expect(errorsOf(flatValues({ priority: "alta" }))).toEqual({ priority: "number" });
    expect(errorsOf(flatValues({ priority: "5,5" }))).toEqual({ priority: "integer" });
    expect(errorsOf(flatValues({ priority: "-1" }))).toEqual({ priority: "range" });
    expect(errorsOf(flatValues({ priority: "100001" }))).toEqual({ priority: "range" });
    const edge = validateRate(flatValues({ priority: "0" }));
    expect(edge.ok && edge.payload.priority).toBe(0);
  });
  it("junta todos los problemas a la vez", () => {
    expect(errorsOf(flatValues({ name: "", flatCost: "x", priority: "", minOrder: "x" }))).toEqual({
      name: "required",
      flatCost: "number",
      priority: "required",
      minOrder: "number",
    });
  });
});

describe("monedas", () => {
  it("currencyChoices: las habilitadas sin repetir; sin datos, solo BOB", () => {
    expect(currencyChoices(["BOB", "USD", "BOB"])).toEqual(["BOB", "USD"]);
    expect(currencyChoices([])).toEqual(["BOB"]);
    expect(currencyChoices(undefined)).toEqual(["BOB"]);
  });
  it("defaultCurrency: BOB si está; si no, la primera", () => {
    expect(defaultCurrency(["USD", "BOB"])).toBe("BOB");
    expect(defaultCurrency(["USD", "EUR"])).toBe("USD");
    expect(defaultCurrency([])).toBe("BOB");
  });
});
