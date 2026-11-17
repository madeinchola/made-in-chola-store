import { describe, expect, it } from "vitest";
import {
  addDays,
  bucketLabel,
  bucketTitle,
  daysInRange,
  formatAmount,
  formatDelta,
  formatInt,
  formatPercent,
  granularityFor,
  hasSales,
  isIsoDate,
  laPazToday,
  marginState,
  percentChange,
  pickCurrency,
  presetRange,
  rangeProblem,
  shareOf,
} from "./logic";
import type { Kpis, SalesSummary } from "./types";

const kpis = (over: Partial<Kpis> = {}): Kpis => ({
  orders: 5,
  units: 14,
  gross: 814.99,
  discounts: 30,
  shipping: 45,
  refunds: 40,
  net: 774.99,
  avg_ticket: 154.998,
  product_revenue: 729.99,
  margin_revenue: 529.99,
  margin: 259.99,
  margin_pct: 49.1,
  costed_orders: 4,
  cost_coverage_pct: 80,
  incident_cost: 12,
  profit: 247.99,
  ...over,
});

describe("laPazToday", () => {
  it("usa la fecha de La Paz (UTC−4), no la del reloj UTC", () => {
    // 01:30 UTC del 5 de marzo = 21:30 del 4 de marzo en La Paz
    expect(laPazToday(new Date("2020-03-05T01:30:00Z"))).toBe("2020-03-04");
    expect(laPazToday(new Date("2020-03-05T04:00:00Z"))).toBe("2020-03-05");
    expect(laPazToday(new Date("2020-03-05T03:59:59Z"))).toBe("2020-03-04");
  });
});

describe("fechas", () => {
  it("addDays cruza meses y años, también bisiestos", () => {
    expect(addDays("2020-02-28", 1)).toBe("2020-02-29");
    expect(addDays("2020-02-29", 1)).toBe("2020-03-01");
    expect(addDays("2019-12-31", 1)).toBe("2020-01-01");
    expect(addDays("2020-03-01", -1)).toBe("2020-02-29");
  });
  it("isIsoDate rechaza lo que no es una fecha real", () => {
    expect(isIsoDate("2020-02-30")).toBe(false);
    expect(isIsoDate("2020-2-3")).toBe(false);
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate("2020-02-29")).toBe(true);
    expect(isIsoDate("2021-02-29")).toBe(false);
  });
  it("daysInRange cuenta los dos extremos", () => {
    expect(daysInRange({ from: "2020-03-01", to: "2020-03-07" })).toBe(7);
    expect(daysInRange({ from: "2020-03-01", to: "2020-03-01" })).toBe(1);
    expect(daysInRange({ from: "2018-03-01", to: "2020-02-29" })).toBe(731);
  });
});

describe("presetRange (hoy = 2020-03-15)", () => {
  const today = "2020-03-15";
  it("hoy, 7 y 30 días terminan hoy y cuentan hoy", () => {
    expect(presetRange("today", today)).toEqual({ from: today, to: today });
    expect(presetRange("7d", today)).toEqual({ from: "2020-03-09", to: today });
    expect(presetRange("30d", today)).toEqual({ from: "2020-02-15", to: today });
  });
  it("este mes arranca el día 1; el mes pasado es el mes completo anterior", () => {
    expect(presetRange("month", today)).toEqual({ from: "2020-03-01", to: today });
    expect(presetRange("last_month", today)).toEqual({ from: "2020-02-01", to: "2020-02-29" });
    expect(presetRange("last_month", "2020-01-10")).toEqual({
      from: "2019-12-01",
      to: "2019-12-31",
    });
  });
  it("el día 1 de un mes, «este mes» es un solo día", () => {
    expect(presetRange("month", "2020-03-01")).toEqual({ from: "2020-03-01", to: "2020-03-01" });
  });
});

describe("rangeProblem", () => {
  it("acepta el rango normal y el tope de 731 días", () => {
    expect(rangeProblem({ from: "2020-03-01", to: "2020-03-07" })).toBeNull();
    expect(rangeProblem({ from: "2018-03-01", to: "2020-02-29" })).toBeNull();
  });
  it("rechaza fechas inválidas, al revés y demasiado largas", () => {
    expect(rangeProblem({ from: "", to: "2020-03-07" })).toBe("invalid");
    expect(rangeProblem({ from: "2020-03-08", to: "2020-03-07" })).toBe("order");
    expect(rangeProblem({ from: "2018-02-28", to: "2020-02-29" })).toBe("too_long");
  });
});

describe("granularityFor", () => {
  it("día hasta 31 días, semana hasta 180 y mes después", () => {
    expect(granularityFor({ from: "2020-03-01", to: "2020-03-31" })).toBe("day");
    expect(granularityFor({ from: "2020-03-01", to: "2020-04-01" })).toBe("week");
    expect(granularityFor({ from: "2020-01-01", to: "2020-06-28" })).toBe("week");
    expect(granularityFor({ from: "2020-01-01", to: "2020-06-29" })).toBe("month");
  });
});

describe("percentChange", () => {
  it("calcula el cambio con un decimal", () => {
    expect(percentChange(110, 100)).toBe(10);
    expect(percentChange(90, 100)).toBe(-10);
    expect(percentChange(774.99, 100)).toBe(675);
    expect(percentChange(1, 3)).toBe(-66.7);
  });
  it("sin período anterior o con anterior en cero no inventa un porcentaje", () => {
    expect(percentChange(50, undefined)).toBeNull();
    expect(percentChange(50, null)).toBeNull();
    expect(percentChange(50, 0)).toBeNull();
    expect(percentChange(0, 0)).toBe(0);
  });
  it("con un anterior negativo el signo sigue al sentido del cambio", () => {
    expect(percentChange(-50, -100)).toBe(50);
  });
});

describe("formato", () => {
  it("importes en su moneda con coma decimal", () => {
    expect(formatAmount(1234.5, "BOB")).toBe("Bs 1.234,50");
    expect(formatAmount(154.998, "BOB")).toBe("Bs 155,00");
    expect(formatAmount(0, "BOB")).toBe("Bs 0,00");
    expect(formatAmount(25, "USD")).toBe("$ 25,00");
  });
  it("porcentajes, enteros y cambios", () => {
    expect(formatPercent(49.1)).toBe("49,1 %");
    expect(formatPercent(80)).toBe("80,0 %");
    expect(formatInt(1234567)).toMatch(/^1.234.567$|^1 234 567$|^1\.234\.567$/);
    expect(formatDelta(12.5)).toBe("+12,5 %");
    expect(formatDelta(-3)).toBe("−3,0 %");
    expect(formatDelta(0)).toBe("0,0 %");
  });
});

describe("etiquetas de la serie", () => {
  it("un cubo es una fecha sin hora: no salta de día por la zona del navegador", () => {
    expect(bucketLabel("2020-03-02", "day")).toMatch(/2.*mar/);
    expect(bucketLabel("2020-03-01", "month")).toMatch(/mar.*2020/);
    expect(bucketTitle("2020-03-02", "week")).toMatch(/^Semana del 2.*mar/);
    expect(bucketLabel("no-es-fecha", "day")).toBe("no-es-fecha");
  });
});

describe("marginState", () => {
  it("distingue sin pedidos, desconocido, parcial y completo (nunca un 100 % falso)", () => {
    expect(marginState(kpis({ orders: 0, costed_orders: 0 }))).toBe("none");
    expect(marginState(kpis({ orders: 3, costed_orders: 0 }))).toBe("unknown");
    expect(marginState(kpis({ orders: 5, costed_orders: 4 }))).toBe("partial");
    expect(marginState(kpis({ orders: 5, costed_orders: 5 }))).toBe("full");
  });
});

describe("resumen", () => {
  const summary = (list: { currency: string; orders: number }[]): SalesSummary => ({
    range: { from: "2020-03-01", to: "2020-03-07", days: 7, timezone: "America/La_Paz" },
    previous: { from: "2020-02-23", to: "2020-02-29" },
    granularity: "day",
    currencies: list.map((c) => ({
      currency: c.currency,
      current: kpis({ orders: c.orders }),
      previous: {},
      series: [],
    })),
    consolidated: {
      currency: "BOB",
      current: { orders: 0, gross: 0, net: 0 },
      previous: { orders: 0, gross: 0, net: 0 },
    },
    other: { cancelled: 0, refunded_full: 0, pending: 0 },
  });
  it("hasSales es falso sin monedas y sin pedidos", () => {
    expect(hasSales(undefined)).toBe(false);
    expect(hasSales(summary([]))).toBe(false);
    expect(hasSales(summary([{ currency: "BOB", orders: 0 }]))).toBe(false);
    expect(hasSales(summary([{ currency: "BOB", orders: 2 }]))).toBe(true);
  });
  it("pickCurrency respeta la elegida y, si no, toma la que más pedidos tiene", () => {
    const s = summary([
      { currency: "USD", orders: 1 },
      { currency: "BOB", orders: 5 },
    ]);
    expect(pickCurrency(s, "USD")?.currency).toBe("USD");
    expect(pickCurrency(s, null)?.currency).toBe("BOB");
    expect(pickCurrency(s, "EUR")?.currency).toBe("BOB");
    expect(pickCurrency(undefined, "BOB")).toBeUndefined();
  });
  it("shareOf nunca divide entre cero", () => {
    expect(shareOf(1, 4)).toBe(25);
    expect(shareOf(1, 3)).toBe(33.3);
    expect(shareOf(5, 0)).toBe(0);
  });
});
