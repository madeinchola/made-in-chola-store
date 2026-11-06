import { describe, expect, it } from "vitest";
import type { QuoteBreakdown, QuoteParams, QuoteSlot } from "@/features/shipping/types";
import {
  breakdownRows,
  buildQuoteParams,
  etaParts,
  formatNumber,
  formatServerMoney,
  groupSlotsByDate,
  parseAmount,
  sameQuoteParams,
  type SimulatorValues,
} from "./SimulatorLogic";

const delivery: SimulatorValues = {
  methodCode: "delivery",
  kind: "delivery",
  pin: { lat: "-16.5", lng: "-68.15" },
  city: "La Paz",
  amount: "250",
  date: "2026-11-10",
  slotId: "slot-1",
};

describe("parseAmount", () => {
  it("acepta enteros y hasta 2 decimales, con coma o con punto", () => {
    expect(parseAmount("0")).toEqual({ ok: true, value: 0 });
    expect(parseAmount("250")).toEqual({ ok: true, value: 250 });
    expect(parseAmount("250,50")).toEqual({ ok: true, value: 250.5 });
    expect(parseAmount("250.5")).toEqual({ ok: true, value: 250.5 });
    expect(parseAmount("  12 ")).toEqual({ ok: true, value: 12 });
    expect(parseAmount("0,05")).toEqual({ ok: true, value: 0.05 });
  });
  it("vacío es «required»", () => {
    expect(parseAmount("")).toEqual({ ok: false, problem: "required" });
    expect(parseAmount("   ")).toEqual({ ok: false, problem: "required" });
  });
  it("negativos, exponentes, texto, más de 2 decimales o coma suelta son «invalid»", () => {
    for (const bad of ["-5", "1e3", "12.345", "abc", "12,", ",5", "1 000", "Bs 5", "1,2,3"]) {
      expect(parseAmount(bad), bad).toEqual({ ok: false, problem: "invalid" });
    }
  });
  it("BORDE: 15 dígitos pasan y 16 no", () => {
    expect(parseAmount("9".repeat(15)).ok).toBe(true);
    expect(parseAmount("9".repeat(16))).toEqual({ ok: false, problem: "invalid" });
  });
});

describe("buildQuoteParams: domicilio", () => {
  it("arma EXACTAMENTE los parámetros de la cotización (y ninguno más)", () => {
    expect(buildQuoteParams(delivery)).toStrictEqual({
      ok: true,
      params: {
        methodCode: "delivery",
        lat: -16.5,
        lng: -68.15,
        city: "La Paz",
        orderAmount: 250,
        deliveryDate: "2026-11-10",
        slotId: "slot-1",
      },
    });
  });
  it("ciudad, fecha y franja vacías se mandan como null", () => {
    const result = buildQuoteParams({ ...delivery, city: "   ", date: "", slotId: "" });
    expect(result.ok && result.params).toStrictEqual({
      methodCode: "delivery",
      lat: -16.5,
      lng: -68.15,
      city: null,
      orderAmount: 250,
      deliveryDate: null,
      slotId: null,
    });
  });
  it("recorta la ciudad, acepta coma decimal en el pin y redondea a los 6 decimales de la base", () => {
    const result = buildQuoteParams({
      ...delivery,
      city: "  El Alto ",
      pin: { lat: "-16,5", lng: "-68.1234567" },
    });
    expect(result.ok && result.params.city).toBe("El Alto");
    expect(result.ok && result.params.lat).toBe(-16.5);
    expect(result.ok && result.params.lng).toBe(-68.123457);
  });
  it("sin pin se manda lat/lng null (el servidor responde «marca tu dirección», algo que se quiere probar)", () => {
    const result = buildQuoteParams({ ...delivery, pin: { lat: "", lng: "" } });
    expect(result.ok && [result.params.lat, result.params.lng]).toEqual([null, null]);
  });
  it("un pin a medias o mal escrito se rechaza con el problema de cada campo", () => {
    expect(buildQuoteParams({ ...delivery, pin: { lat: "-16.5", lng: "" } })).toEqual({
      ok: false,
      errors: { lng: "missing" },
    });
    expect(buildQuoteParams({ ...delivery, pin: { lat: "abc", lng: "-68" } })).toEqual({
      ok: false,
      errors: { lat: "format" },
    });
    expect(buildQuoteParams({ ...delivery, pin: { lat: "91", lng: "181" } })).toEqual({
      ok: false,
      errors: { lat: "range", lng: "range" },
    });
  });
  it("el monto inválido o vacío se rechaza, y se juntan con los errores del pin", () => {
    expect(buildQuoteParams({ ...delivery, amount: "" })).toEqual({
      ok: false,
      errors: { amount: "required" },
    });
    expect(buildQuoteParams({ ...delivery, amount: "-1", pin: { lat: "x", lng: "" } })).toEqual({
      ok: false,
      errors: { amount: "invalid", lat: "format", lng: "missing" },
    });
  });
});

describe("buildQuoteParams: recojo en tienda", () => {
  const pickup: SimulatorValues = { ...delivery, methodCode: "pickup", kind: "pickup" };
  it("solo manda método y monto: no hay dirección, ciudad, fecha ni franja", () => {
    expect(buildQuoteParams(pickup)).toStrictEqual({
      ok: true,
      params: { methodCode: "pickup", orderAmount: 250 },
    });
  });
  it("un pin inválido NO estorba (el recojo no usa dirección); el monto sí se valida", () => {
    expect(buildQuoteParams({ ...pickup, pin: { lat: "zzz", lng: "" } }).ok).toBe(true);
    expect(buildQuoteParams({ ...pickup, amount: "abc" })).toEqual({
      ok: false,
      errors: { amount: "invalid" },
    });
  });
});

describe("sameQuoteParams", () => {
  const base: QuoteParams = {
    methodCode: "delivery",
    lat: -16.5,
    lng: -68.15,
    city: "La Paz",
    orderAmount: 250,
    deliveryDate: "2026-11-10",
    slotId: "slot-1",
  };
  it("las mismas preguntas son iguales", () => {
    expect(sameQuoteParams(base, { ...base })).toBe(true);
  });
  it("un campo ausente y uno null son lo mismo", () => {
    const { city: _city, ...withoutCity } = base;
    expect(sameQuoteParams(withoutCity, { ...base, city: null })).toBe(true);
  });
  it("CUALQUIER campo distinto es otra pregunta", () => {
    const changes: Partial<QuoteParams>[] = [
      { methodCode: "pickup" },
      { lat: -16.500001 },
      { lng: -68.150001 },
      { city: "El Alto" },
      { city: null },
      { orderAmount: 250.01 },
      { deliveryDate: "2026-11-11" },
      { deliveryDate: null },
      { slotId: "slot-2" },
      { slotId: null },
      { currency: "USD" },
      { listDays: 7 },
    ];
    for (const change of changes) {
      expect(sameQuoteParams(base, { ...base, ...change }), JSON.stringify(change)).toBe(false);
    }
  });
});

describe("groupSlotsByDate", () => {
  const s = (slotId: string, date: string, start: string, end = "23:00"): QuoteSlot => ({
    slotId,
    date,
    start,
    end,
    capacity: 5,
    remaining: 2,
    available: true,
  });
  it("agrupa por fecha en orden cronológico y, dentro del día, por hora (aunque lleguen desordenadas)", () => {
    const groups = groupSlotsByDate([
      s("d", "2026-11-17", "09:00"),
      s("b", "2026-11-10", "14:00"),
      s("a", "2026-11-10", "09:00"),
      s("c", "2026-11-12", "10:00"),
    ]);
    expect(groups.map((g) => [g.date, g.slots.map((x) => x.slotId)])).toEqual([
      ["2026-11-10", ["a", "b"]],
      ["2026-11-12", ["c"]],
      ["2026-11-17", ["d"]],
    ]);
  });
  it("no pierde ni duplica franjas, conserva los cupos del servidor y no toca la lista original", () => {
    const input = [s("x", "2026-11-10", "09:00"), s("y", "2026-11-10", "10:00")];
    input[1] = { ...input[1], capacity: 7, remaining: 0, available: false } as QuoteSlot;
    const groups = groupSlotsByDate(input);
    expect(groups[0]?.slots).toHaveLength(2);
    expect(groups[0]?.slots[1]).toMatchObject({ capacity: 7, remaining: 0, available: false });
    expect(input.map((x) => x.slotId)).toEqual(["x", "y"]);
  });
  it("sin franjas: sin grupos", () => {
    expect(groupSlotsByDate([])).toEqual([]);
  });
});

describe("etaParts", () => {
  it("rango, igual, solo mínimo, solo máximo y sin dato", () => {
    expect(etaParts(2, 3)).toEqual({ kind: "range", min: 2, max: 3 });
    expect(etaParts(2, 2)).toEqual({ kind: "exact", days: 2 });
    expect(etaParts(0, 0)).toEqual({ kind: "exact", days: 0 });
    expect(etaParts(1, null)).toEqual({ kind: "from", days: 1 });
    expect(etaParts(null, 5)).toEqual({ kind: "upTo", days: 5 });
    expect(etaParts(null, null)).toEqual({ kind: "none" });
  });
});

describe("breakdownRows", () => {
  const empty: QuoteBreakdown = {
    rule: null,
    straightKm: null,
    routeKm: null,
    routeFactor: null,
    tier: null,
    extraKm: null,
    minApplied: false,
    maxApplied: false,
    pickup: false,
  };
  it("tarifa por distancia en un tramo: regla, km recta y de ruta, factor, tramo y mínimo/máximo, con los números del servidor", () => {
    const rows = breakdownRows({
      ...empty,
      rule: { id: "r1", name: "Zona centro", kind: "distance", priority: 10 },
      straightKm: 7.5,
      routeKm: 9.75,
      routeFactor: 1.3,
      tier: 2,
    });
    expect(rows).toEqual([
      { id: "rule", name: "Zona centro", kind: "distance", priority: 10 },
      { id: "straightKm", km: 7.5 },
      { id: "routeKm", km: 9.75 },
      { id: "routeFactor", factor: 1.3 },
      { id: "tier", tier: 2 },
      { id: "minApplied", applied: false },
      { id: "maxApplied", applied: false },
    ]);
  });
  it("pasado el último tramo: muestra los km adicionales (no un tramo) y si se aplicó el mínimo/máximo", () => {
    const rows = breakdownRows({
      ...empty,
      rule: { id: "r1", name: "Por km", kind: "distance", priority: 5 },
      straightKm: 20,
      routeKm: 26,
      routeFactor: 1.3,
      tier: null,
      extraKm: 6.5,
      minApplied: false,
      maxApplied: true,
    });
    expect(rows.map((r) => r.id)).toEqual([
      "rule",
      "straightKm",
      "routeKm",
      "routeFactor",
      "extraKm",
      "minApplied",
      "maxApplied",
    ]);
    expect(rows.find((r) => r.id === "extraKm")).toEqual({ id: "extraKm", km: 6.5 });
    expect(rows.find((r) => r.id === "maxApplied")).toEqual({ id: "maxApplied", applied: true });
    expect(rows.find((r) => r.id === "minApplied")).toEqual({ id: "minApplied", applied: false });
  });
  it("el mínimo aplicado se informa como aplicado", () => {
    const rows = breakdownRows({
      ...empty,
      rule: { id: "r1", name: "Por km", kind: "distance", priority: 5 },
      tier: 1,
      minApplied: true,
    });
    expect(rows.find((r) => r.id === "minApplied")).toEqual({ id: "minApplied", applied: true });
  });
  it("tarifa plana: sin tramo ni mínimo/máximo; dice que es tarifa plana", () => {
    const rows = breakdownRows({
      ...empty,
      rule: { id: "r2", name: "Plana", kind: "flat", priority: 1 },
      straightKm: 3,
      routeKm: 3.9,
      routeFactor: 1.3,
    });
    expect(rows.map((r) => r.id)).toEqual([
      "rule",
      "straightKm",
      "routeKm",
      "routeFactor",
      "flatRate",
    ]);
  });
  it("recojo en tienda: una sola fila", () => {
    expect(breakdownRows({ ...empty, pickup: true })).toEqual([{ id: "pickup" }]);
  });
  it("lo que el servidor no informó no se inventa: desglose vacío = sin filas", () => {
    expect(breakdownRows(empty)).toEqual([]);
  });
  it("conserva 0 como un valor real (0 km adicionales, tramo 1)", () => {
    const rows = breakdownRows({
      ...empty,
      rule: { id: "r1", name: "R", kind: "distance", priority: 0 },
      straightKm: 0,
      routeKm: 0,
      routeFactor: 1,
      tier: 1,
    });
    expect(rows).toContainEqual({ id: "straightKm", km: 0 });
    expect(rows).toContainEqual({ id: "routeKm", km: 0 });
    expect(rows).toContainEqual({ id: "rule", name: "R", kind: "distance", priority: 0 });
  });
});

describe("formatNumber / formatServerMoney (solo formato)", () => {
  it("números con coma decimal, sin ceros de sobra y hasta 2 decimales", () => {
    expect(formatNumber(9.75)).toBe("9,75");
    expect(formatNumber(7)).toBe("7");
    expect(formatNumber(1.3)).toBe("1,3");
    expect(formatNumber(0)).toBe("0");
  });
  it("dinero: «Bs 15,00», «Bs 12,50», «Bs 0,00», con miles", () => {
    expect(formatServerMoney(15, "BOB")).toBe("Bs 15,00");
    expect(formatServerMoney(12.5, "BOB")).toBe("Bs 12,50");
    expect(formatServerMoney(0, "BOB")).toBe("Bs 0,00");
    expect(formatServerMoney(1234.5, "BOB")).toBe("Bs 1.234,50");
  });
  it("una moneda desconocida no rompe: muestra el valor tal cual", () => {
    expect(formatServerMoney(15, "XXX")).toBe("XXX 15");
  });
});
