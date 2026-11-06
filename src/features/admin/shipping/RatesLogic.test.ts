import { describe, expect, it } from "vitest";
import {
  currencySymbol,
  formatAmount,
  isLastLiveRule,
  orderRangeText,
  rateStatus,
  rateZoneOptions,
  ruleSummary,
  ruleZoneLabel,
  ruleZoneState,
  sortRates,
  validityText,
} from "./RatesLogic";
import type { RateParams, RateRule, ShippingZone } from "./types";

const zone = (over: Partial<ShippingZone> = {}): ShippingZone => ({
  id: "z1",
  name: "Centro",
  kind: "city",
  cities: ["La Paz"],
  centerLat: null,
  centerLng: null,
  radiusKm: null,
  allowed: true,
  isActive: true,
  archived: false,
  updatedAt: "2026-11-05T10:00:00+00:00",
  ...over,
});
const rate = (over: Partial<RateRule> = {}): RateRule => ({
  id: "r1",
  methodId: "m1",
  zoneId: null,
  name: "Regla",
  kind: "flat",
  params: { kind: "flat", cost: 10 },
  minOrderAmount: null,
  maxOrderAmount: null,
  currency: "BOB",
  priority: 100,
  isActive: true,
  validFrom: null,
  validUntil: null,
  archived: false,
  updatedAt: "2026-11-05T10:00:00+00:00",
  ...over,
});

describe("formatAmount", () => {
  it.each([
    [15, "BOB", "Bs 15"],
    [0, "BOB", "Bs 0"],
    [15.5, "BOB", "Bs 15,50"],
    [1234.5, "BOB", "Bs 1.234,50"],
    [1000, "BOB", "Bs 1.000"],
    [100, "BOB", "Bs 100"],
    [1500, "CLP", "CLP$ 1.500"],
    [3, "XXX", "XXX 3"],
  ])("%d %s → %s", (value, currency, expected) =>
    expect(formatAmount(value, currency)).toBe(expected),
  );
});

describe("currencySymbol", () => {
  it("el símbolo de la moneda, o su código si no se conoce", () => {
    expect(currencySymbol("BOB")).toBe("Bs");
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("XXX")).toBe("XXX");
  });
});

describe("ruleSummary", () => {
  const distance: Extract<RateParams, { kind: "distance" }> = {
    kind: "distance",
    tiers: [
      { upToKm: 3, cost: 15 },
      { upToKm: 6, cost: 20 },
      { upToKm: 10, cost: 30 },
    ],
    extraPerKm: 3,
    minCost: 15,
    maxCost: 60,
  };
  it("una regla de distancia completa", () => {
    expect(ruleSummary(distance, "BOB")).toBe(
      "Hasta 3 km: Bs 15 · 3–6 km: Bs 20 · 6–10 km: Bs 30 · Más allá: Bs 3 por km adicional · Mínimo Bs 15 · Máximo Bs 60",
    );
  });
  it("sin km adicional dice hasta dónde llega; sin mínimo ni máximo no los menciona", () => {
    expect(
      ruleSummary({ ...distance, extraPerKm: null, minCost: null, maxCost: null }, "BOB"),
    ).toBe("Hasta 3 km: Bs 15 · 3–6 km: Bs 20 · 6–10 km: Bs 30 · No cubre más de 10 km");
    // Un km adicional de 0 es lo mismo que no tenerlo (el servidor lo trata igual).
    expect(
      ruleSummary({ ...distance, extraPerKm: 0, minCost: null, maxCost: null }, "BOB"),
    ).toContain("No cubre más de 10 km");
  });
  it("un mínimo o máximo de 0 SÍ se menciona (0 no es «sin límite»)", () => {
    const s = ruleSummary({ ...distance, minCost: 0, maxCost: 0 }, "BOB");
    expect(s).toContain("Mínimo Bs 0");
    expect(s).toContain("Máximo Bs 0");
  });
  it("con más de 3 tramos resume el resto (1 o varios) y con todos (maxTiers) los lista", () => {
    const four = { ...distance, tiers: [...distance.tiers, { upToKm: 15.5, cost: 40 }] };
    expect(ruleSummary(four, "BOB")).toBe(
      "Hasta 3 km: Bs 15 · 3–6 km: Bs 20 · 6–10 km: Bs 30 · 1 tramo más · Más allá: Bs 3 por km adicional · Mínimo Bs 15 · Máximo Bs 60",
    );
    const five = { ...four, tiers: [...four.tiers, { upToKm: 20, cost: 50 }] };
    expect(ruleSummary(five, "BOB")).toContain("· 2 tramos más ·");
    expect(ruleSummary(five, "BOB", Infinity)).toContain("10–15,5 km: Bs 40 · 15,5–20 km: Bs 50");
    expect(ruleSummary(five, "BOB", Infinity)).not.toContain("más ·");
  });
  it("usa coma decimal en los km y el formato de la moneda de la regla", () => {
    const s = ruleSummary(
      {
        kind: "distance",
        tiers: [{ upToKm: 2.5, cost: 7.5 }],
        extraPerKm: null,
        minCost: null,
        maxCost: null,
      },
      "USD",
    );
    expect(s).toBe("Hasta 2,5 km: $ 7,50 · No cubre más de 2,5 km");
  });
  it("tarifa fija: «Bs 80 fijo» y con costo 0, «Envío gratis»", () => {
    expect(ruleSummary({ kind: "flat", cost: 80 }, "BOB")).toBe("Bs 80 fijo");
    expect(ruleSummary({ kind: "flat", cost: 12.5 }, "BOB")).toBe("Bs 12,50 fijo");
    expect(ruleSummary({ kind: "flat", cost: 0 }, "BOB")).toBe("Envío gratis");
  });
  it("una regla de distancia sin tramos (dato ilegible) no rompe", () => {
    expect(
      ruleSummary(
        { kind: "distance", tiers: [], extraPerKm: null, minCost: null, maxCost: null },
        "BOB",
      ),
    ).toBe("Sin tramos");
  });
});

describe("orderRangeText", () => {
  it("cada combinación de extremos", () => {
    expect(orderRangeText(null, null, "BOB")).toBe("Cualquier monto");
    expect(orderRangeText(100, null, "BOB")).toBe("Desde Bs 100");
    expect(orderRangeText(null, 500, "BOB")).toBe("Hasta Bs 500");
    expect(orderRangeText(100, 500.5, "BOB")).toBe("De Bs 100 a Bs 500,50");
    // 0 es un extremo real, no «sin límite».
    expect(orderRangeText(0, null, "BOB")).toBe("Desde Bs 0");
    expect(orderRangeText(null, 0, "BOB")).toBe("Hasta Bs 0");
  });
});

describe("validityText (hora de La Paz, UTC−4)", () => {
  it("siempre, desde, hasta y rango", () => {
    expect(validityText(null, null)).toBe("Siempre");
    expect(validityText("2026-11-05T12:00:00Z", null)).toBe("Desde 5/11/26, 08:00");
    expect(validityText(null, "2026-12-31T03:59:00Z")).toBe("Hasta 30/12/26, 23:59");
    expect(validityText("2026-11-05T12:00:00Z", "2026-12-31T03:59:00Z")).toBe(
      "Del 5/11/26, 08:00 al 30/12/26, 23:59",
    );
  });
  it("una fecha ilegible se muestra tal cual en vez de romper", () => {
    expect(validityText("no-es-fecha", null)).toBe("Desde no-es-fecha");
  });
});

describe("rateStatus (mismas reglas que quote_shipping)", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  const live = { archived: false, isActive: true, validFrom: null, validUntil: null };
  it("vigente, inactiva y archivada (la archivada gana a todo)", () => {
    expect(rateStatus(live, now)).toBe("live");
    expect(rateStatus({ ...live, isActive: false }, now)).toBe("inactive");
    expect(rateStatus({ ...live, archived: true }, now)).toBe("archived");
    expect(rateStatus({ ...live, archived: true, isActive: false }, now)).toBe("archived");
  });
  it("programada: valid_from > ahora; justo en el instante ya rige (valid_from <= ahora)", () => {
    expect(rateStatus({ ...live, validFrom: "2026-11-05T12:00:01Z" }, now)).toBe("scheduled");
    expect(rateStatus({ ...live, validFrom: "2026-11-05T12:00:00Z" }, now)).toBe("live");
  });
  it("vencida: valid_until <= ahora; un instante antes todavía rige (valid_until > ahora)", () => {
    expect(rateStatus({ ...live, validUntil: "2026-11-05T12:00:00Z" }, now)).toBe("expired");
    expect(rateStatus({ ...live, validUntil: "2026-11-05T12:00:01Z" }, now)).toBe("live");
  });
  it("una inactiva sigue inactiva aunque esté vencida o programada", () => {
    expect(rateStatus({ ...live, isActive: false, validUntil: "2000-01-01T00:00:00Z" }, now)).toBe(
      "inactive",
    );
    expect(rateStatus({ ...live, isActive: false, validFrom: "2099-01-01T00:00:00Z" }, now)).toBe(
      "inactive",
    );
  });
});

describe("sortRates (orden de evaluación del servidor)", () => {
  const ids = (list: RateRule[]) => sortRates(list).map((r) => r.id);
  it("mayor prioridad primero", () => {
    expect(
      ids([
        rate({ id: "a", priority: 10 }),
        rate({ id: "b", priority: 300 }),
        rate({ id: "c", priority: 50 }),
      ]),
    ).toEqual(["b", "c", "a"]);
  });
  it("a igualdad, la que tiene zona; a igualdad, la de menor id", () => {
    expect(
      ids([
        rate({ id: "c", priority: 100 }),
        rate({ id: "z", priority: 100, zoneId: "z1" }),
        rate({ id: "a", priority: 100 }),
        rate({ id: "b", priority: 100, zoneId: "z1" }),
      ]),
    ).toEqual(["b", "z", "a", "c"]);
  });
  it("las archivadas van al final aunque tengan más prioridad", () => {
    expect(
      ids([rate({ id: "a", priority: 999, archived: true }), rate({ id: "b", priority: 1 })]),
    ).toEqual(["b", "a"]);
  });
  it("no modifica la lista recibida", () => {
    const list = [rate({ id: "a", priority: 1 }), rate({ id: "b", priority: 2 })];
    sortRates(list);
    expect(list.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("zonas de una regla", () => {
  const zones = [
    zone({ id: "ok", name: "Centro" }),
    zone({ id: "arch", name: "Vieja", archived: true }),
    zone({ id: "off", name: "Apagada", isActive: false }),
    zone({ id: "block", name: "Prohibida", allowed: false }),
  ];
  const byId = new Map(zones.map((z) => [z.id, z]));
  it("ruleZoneState: precedencia archivada, sin servicio, inactiva", () => {
    expect(ruleZoneState(null, byId)).toBe("any");
    expect(ruleZoneState("nope", byId)).toBe("unknown");
    expect(ruleZoneState("ok", byId)).toBe("ok");
    expect(ruleZoneState("arch", byId)).toBe("archived");
    expect(ruleZoneState("off", byId)).toBe("inactive");
    expect(ruleZoneState("block", byId)).toBe("blocked");
    const both = new Map([["x", zone({ id: "x", archived: true, allowed: false })]]);
    expect(ruleZoneState("x", both)).toBe("archived");
  });
  it("ruleZoneLabel: el nombre, con su nota si no sirve", () => {
    expect(ruleZoneLabel(null, byId)).toBe("Cualquier zona cubierta");
    expect(ruleZoneLabel("nope", byId)).toBe("Zona no encontrada");
    expect(ruleZoneLabel("ok", byId)).toBe("Centro");
    expect(ruleZoneLabel("arch", byId)).toBe("Vieja (archivada)");
    expect(ruleZoneLabel("off", byId)).toBe("Apagada (inactiva)");
    expect(ruleZoneLabel("block", byId)).toBe("Prohibida (sin servicio)");
  });
  it("rateZoneOptions: «cualquier zona» y solo las zonas con servicio no archivadas", () => {
    expect(rateZoneOptions(zones, null)).toEqual([
      { value: "", label: "Cualquier zona cubierta" },
      { value: "ok", label: "Centro" },
      { value: "off", label: "Apagada (inactiva)" },
    ]);
  });
  it("rateZoneOptions: la zona actual de la regla siempre aparece, con su nota", () => {
    expect(rateZoneOptions(zones, "arch").map((o) => [o.value, o.label])).toEqual([
      ["", "Cualquier zona cubierta"],
      ["ok", "Centro"],
      ["off", "Apagada (inactiva)"],
      ["arch", "Vieja (archivada)"],
    ]);
    expect(rateZoneOptions(zones, "block").at(-1)).toEqual({
      value: "block",
      label: "Prohibida (sin servicio)",
    });
    // Si ni siquiera se pudo leer la lista de zonas, la opción actual sigue ahí.
    expect(rateZoneOptions([], "z9")).toEqual([
      { value: "", label: "Cualquier zona cubierta" },
      { value: "z9", label: "Zona actual (no se pudo leer su nombre)" },
    ]);
    // Sin duplicarla cuando ya está entre las ofrecidas.
    expect(rateZoneOptions(zones, "ok").filter((o) => o.value === "ok")).toHaveLength(1);
  });
});

describe("isLastLiveRule", () => {
  it("solo si es la única activa y no archivada de ese método", () => {
    const a = rate({ id: "a" });
    expect(isLastLiveRule(a, [a])).toBe(true);
    expect(isLastLiveRule(a, [a, rate({ id: "b" })])).toBe(false);
    // Las otras no cuentan si están inactivas, archivadas o son de otro método.
    expect(isLastLiveRule(a, [a, rate({ id: "b", isActive: false })])).toBe(true);
    expect(isLastLiveRule(a, [a, rate({ id: "b", archived: true })])).toBe(true);
    expect(isLastLiveRule(a, [a, rate({ id: "b", methodId: "m2" })])).toBe(true);
    // Si ella misma no está activa, archivarla no deja a nadie sin tarifa.
    const off = rate({ id: "o", isActive: false });
    expect(isLastLiveRule(off, [off])).toBe(false);
  });
});
