import { describe, expect, it } from "vitest";
import { convert, fromDecimal, toDecimalString } from "@/lib/money";
import {
  changePercentLabel,
  confirmationReasons,
  convertAmount,
  currentRate,
  parseRate,
  type RateRow,
} from "./rates";

describe("parseRate (numeric(18,8), > 0)", () => {
  it.each([
    ["6.96", "6.96"],
    ["6,96", "6.96"],
    ["0.145", "0.145"],
    ["0.00000001", "0.00000001"],
    ["007.5", "7.5"],
    ["130", "130"],
    ["9999999999.99999999", "9999999999.99999999"],
    ["  1,5 ", "1.5"],
  ])("«%s» es válida → %s", (raw, expected) => {
    expect(parseRate(raw)).toEqual({ ok: true, value: expected });
  });

  it("vacía y con formato inválido", () => {
    expect(parseRate("")).toEqual({ ok: false, problem: "empty" });
    for (const bad of ["abc", "1.2.3", "1,234.5", "-1", "+1", "1e3", ".5", "5.", "1 2"]) {
      expect(parseRate(bad), bad).toEqual({ ok: false, problem: "format" });
    }
  });
  it("9 decimales NO caben (el máximo de la base es 8)", () => {
    expect(parseRate("0.123456789")).toEqual({ ok: false, problem: "decimals" });
    expect(parseRate("0.12345678").ok).toBe(true);
  });
  it("11 dígitos enteros NO caben (numeric(18,8) admite 10)", () => {
    expect(parseRate("10000000000")).toEqual({ ok: false, problem: "too_large" });
    expect(parseRate("9999999999").ok).toBe(true);
  });
  it("cero, en cualquier forma, no es una tasa válida (CHECK rate > 0)", () => {
    for (const z of ["0", "0.0", "000", "0,00000000"])
      expect(parseRate(z), z).toEqual({ ok: false, problem: "not_positive" });
  });
});

describe("convertAmount = round(base × tasa, decimales) de Postgres (verificado contra la base)", () => {
  // Valores de referencia: resultado de `select round(a * r, d)` en la base local, comprobados a mano.
  it.each([
    ["10.05", "0.5", 2, "5.03"], // 5.025: la mitad se aleja de cero (el redondeo bancario daría 5.02)
    ["125.50", "0.145", 2, "18.20"], // 18.1975
    ["1.00", "0.5", 0, "1"], // 0.50 → 1
    ["2.50", "0.5", 0, "1"], // 1.25 → 1
    ["3.00", "0.5", 0, "2"], // 1.50 → 2
    ["99.99", "0.14367816", 2, "14.37"], // 14.3663792184
    ["0.01", "0.5", 2, "0.01"], // 0.005 → 0.01
    ["0.01", "0.49", 2, "0.00"], // 0.0049 → 0.00
    ["250.00", "130.5", 0, "32625"],
    ["1234.56", "0.00000001", 2, "0.00"],
    ["999999999.99", "1", 2, "999999999.99"],
  ])("%s × %s con %i decimales = %s", (base, rate, decimals, expected) => {
    expect(convertAmount(base, rate, decimals)).toBe(expected);
  });

  it("siempre devuelve exactamente `decimals` decimales (relleno con ceros)", () => {
    expect(convertAmount("10", "2", 2)).toBe("20.00");
    expect(convertAmount("10", "2", 4)).toBe("20.0000");
    expect(convertAmount("10", "2", 0)).toBe("20");
  });

  it("coincide con `convert` de lib/money en una cuadrícula de precios y tasas", () => {
    const bases = ["0.01", "0.05", "1.00", "10.05", "99.99", "125.50", "1234.56", "9999.99"];
    const rates = ["0.5", "0.145", "0.14367816", "6.96", "130.5", "0.00725", "1.5", "0.333"];
    const targets: [string, number][] = [
      ["USD", 2],
      ["EUR", 2],
      ["CLP", 0],
      ["PYG", 0],
    ];
    let n = 0;
    for (const base of bases) {
      for (const rate of rates) {
        for (const [code, decimals] of targets) {
          const reference = toDecimalString(convert(fromDecimal(base, "BOB"), code, rate));
          expect(convertAmount(base, rate, decimals), `${base} × ${rate} → ${code}`).toBe(
            reference,
          );
          n++;
        }
      }
    }
    expect(n).toBe(256);
  });
});

describe("currentRate (misma regla que current_rate en SQL)", () => {
  const r = (id: number, validFrom: string, over: Partial<RateRow> = {}): RateRow => ({
    id,
    fromCurrency: "BOB",
    toCurrency: "USD",
    rate: String(id),
    mode: "fixed",
    validFrom,
    ...over,
  });
  const NOW = new Date("2026-10-30T12:00:00Z");

  it("sin filas vigentes: null", () => {
    expect(currentRate([], "BOB", "USD", NOW)).toBeNull();
    expect(currentRate([r(1, "2026-11-01T00:00:00Z")], "BOB", "USD", NOW)).toBeNull();
  });
  it("elige la de valid_from más reciente entre las ya vigentes", () => {
    const rows = [
      r(1, "2026-01-01T00:00:00Z"),
      r(2, "2026-10-01T00:00:00Z"),
      r(3, "2026-05-01T00:00:00Z"),
    ];
    expect(currentRate(rows, "BOB", "USD", NOW)?.id).toBe(2);
  });
  it("una tasa futura NO se usa todavía, aunque sea la más reciente", () => {
    const rows = [r(1, "2026-01-01T00:00:00Z"), r(2, "2026-12-01T00:00:00Z")];
    expect(currentRate(rows, "BOB", "USD", NOW)?.id).toBe(1);
  });
  it("límite: valid_from == ahora ya es vigente (valid_from <= now)", () => {
    expect(currentRate([r(1, "2026-10-30T12:00:00Z")], "BOB", "USD", NOW)?.id).toBe(1);
  });
  it("con el mismo valid_from gana el id mayor", () => {
    const rows = [
      r(5, "2026-10-01T00:00:00Z"),
      r(9, "2026-10-01T00:00:00Z"),
      r(7, "2026-10-01T00:00:00Z"),
    ];
    expect(currentRate(rows, "BOB", "USD", NOW)?.id).toBe(9);
  });
  it("solo cuenta la pareja pedida (no mezcla monedas ni sentidos)", () => {
    const rows = [
      r(1, "2026-10-01T00:00:00Z", { toCurrency: "EUR" }),
      r(2, "2026-10-02T00:00:00Z", { fromCurrency: "USD", toCurrency: "BOB" }),
    ];
    expect(currentRate(rows, "BOB", "USD", NOW)).toBeNull();
    expect(currentRate(rows, "BOB", "EUR", NOW)?.id).toBe(1);
  });
  it("no depende del orden de entrada", () => {
    const a = r(1, "2026-02-01T00:00:00Z");
    const b = r(2, "2026-03-01T00:00:00Z");
    expect(currentRate([a, b], "BOB", "USD", NOW)?.id).toBe(
      currentRate([b, a], "BOB", "USD", NOW)?.id,
    );
  });
});

describe("confirmationReasons (libro inmutable)", () => {
  const NOW = new Date("2026-10-30T12:00:00Z");
  const reasons = (
    previousRate: string | null,
    nextRate: string,
    validFrom: string | null = null,
  ) => confirmationReasons({ previousRate, nextRate, validFrom, now: NOW });

  it("sin tasa anterior ni fecha: nunca pide confirmación (no hay con qué comparar)", () => {
    expect(reasons(null, "999")).toEqual([]);
  });
  it("una variación de exactamente 25 % NO pide confirmación; un poco más, sí", () => {
    expect(reasons("100", "125")).toEqual([]); // +25 %
    expect(reasons("100", "75")).toEqual([]); // −25 %
    expect(reasons("100", "125.00000001")).toEqual(["big_change"]);
    expect(reasons("100", "74.99999999")).toEqual(["big_change"]);
  });
  it("el error de tipeo típico (6.96 → 69.6, o → 0.696) se detecta", () => {
    expect(reasons("6.96", "69.6")).toEqual(["big_change"]);
    expect(reasons("6.96", "0.696")).toEqual(["big_change"]);
    expect(reasons("6.96", "6.97")).toEqual([]);
  });
  it("compara con decimales exactos (sin errores de coma flotante)", () => {
    expect(reasons("0.1", "0.125")).toEqual([]); // justo +25 %
    expect(reasons("0.3", "0.375")).toEqual([]); // justo +25 % (0.3 * 1.25 no es exacto en floats)
    expect(reasons("0.3", "0.3750001")).toEqual(["big_change"]);
  });
  it("fecha a exactamente 7 días no pide confirmación; un milisegundo más, sí (pasado o futuro)", () => {
    const week = 7 * 86_400_000;
    expect(reasons(null, "1", new Date(NOW.getTime() + week).toISOString())).toEqual([]);
    expect(reasons(null, "1", new Date(NOW.getTime() - week).toISOString())).toEqual([]);
    expect(reasons(null, "1", new Date(NOW.getTime() + week + 1).toISOString())).toEqual([
      "far_date",
    ]);
    expect(reasons(null, "1", new Date(NOW.getTime() - week - 1).toISOString())).toEqual([
      "far_date",
    ]);
  });
  it("pueden darse las dos razones a la vez", () => {
    expect(reasons("6.96", "69.6", "2027-01-01T00:00:00Z")).toEqual(["big_change", "far_date"]);
  });
});

describe("changePercentLabel", () => {
  it.each([
    ["100", "125", "+25.0"],
    ["100", "75", "-25.0"],
    ["6.96", "69.6", "+900.0"],
    ["6.96", "6.97", "+0.1"],
    ["100", "100", "+0.0"],
    ["3", "4", "+33.3"],
    ["0.3", "0.375", "+25.0"],
  ])("%s → %s = %s", (prev, next, expected) => {
    expect(changePercentLabel(prev, next)).toBe(expected);
  });
});
