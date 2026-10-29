import { describe, expect, it } from "vitest";
import {
  add,
  allocate,
  compare,
  convert,
  equals,
  formatMoney,
  fromDecimal,
  isZero,
  money,
  multiply,
  multiplyByRate,
  negate,
  percentage,
  subtract,
  sum,
  toDecimalString,
  zero,
} from "./money";

// Los valores esperados están calculados a mano (aritmética decimal), no con la propia función bajo prueba.

describe("construcción", () => {
  it("rechaza montos no enteros (centavos fraccionarios)", () => {
    expect(() => money(1.5, "BOB")).toThrow(RangeError);
  });
  it("rechaza NaN, Infinity y valores fuera del rango seguro", () => {
    expect(() => money(NaN, "BOB")).toThrow(RangeError);
    expect(() => money(Infinity, "BOB")).toThrow(RangeError);
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, "BOB")).toThrow(RangeError);
  });
  it("rechaza monedas no soportadas en vez de asumir un default", () => {
    expect(() => money(100, "XXX")).toThrow(/no soportada/);
  });
  it("normaliza -0 a 0", () => {
    expect(Object.is(money(-0, "BOB").amount, 0)).toBe(true);
    expect(Object.is(negate(zero("BOB")).amount, 0)).toBe(true);
  });
});

describe("fromDecimal", () => {
  it("0.1 + 0.2 es exactamente 0.30 (el clásico error de floats)", () => {
    const total = add(fromDecimal("0.1", "BOB"), fromDecimal("0.2", "BOB"));
    expect(total.amount).toBe(30);
    expect(toDecimalString(total)).toBe("0.30");
    expect(0.1 + 0.2).not.toBe(0.3); // el control: los floats SÍ fallan aquí
  });
  it("también con números: 0.1 y 0.2 como number", () => {
    expect(add(fromDecimal(0.1, "USD"), fromDecimal(0.2, "USD")).amount).toBe(30);
  });
  it("redondea mitades alejándose de cero: 1.005 → 1.01 (Math.round(1.005*100) daría 100)", () => {
    expect(fromDecimal("1.005", "BOB").amount).toBe(101);
    expect(fromDecimal(1.005, "BOB").amount).toBe(101);
    expect(Math.round(1.005 * 100)).toBe(100);
  });
  it("redondea negativos simétricamente", () => {
    expect(fromDecimal("-1.005", "BOB").amount).toBe(-101);
    expect(fromDecimal("-2.674", "BOB").amount).toBe(-267);
  });
  it("2.675 → 2.68 y 2.674 → 2.67", () => {
    expect(fromDecimal("2.675", "EUR").amount).toBe(268);
    expect(fromDecimal("2.674", "EUR").amount).toBe(267);
  });
  it("acepta enteros y un solo decimal", () => {
    expect(fromDecimal("12", "BOB").amount).toBe(1200);
    expect(fromDecimal("12.5", "BOB").amount).toBe(1250);
  });
  it("monedas sin decimales (CLP): 1500.5 → 1501", () => {
    expect(fromDecimal("1500.5", "CLP").amount).toBe(1501);
    expect(toDecimalString(money(1501, "CLP"))).toBe("1501");
  });
  it("números en notación exponencial", () => {
    expect(fromDecimal(1e-7, "BOB").amount).toBe(0);
    expect(fromDecimal(1.5e3, "BOB").amount).toBe(150000);
  });
  it("rechaza entradas inválidas", () => {
    for (const bad of ["", "abc", "1e5", "1,5", "--1", "1.", ".5", "1 2"]) {
      expect(() => fromDecimal(bad, "BOB"), `"${bad}"`).toThrow(SyntaxError);
    }
    expect(() => fromDecimal(NaN, "BOB")).toThrow(RangeError);
    expect(() => fromDecimal(Infinity, "BOB")).toThrow(RangeError);
    expect(() => fromDecimal("999999999999999999", "BOB")).toThrow(RangeError);
  });
  it("tolera espacios alrededor y signo +", () => {
    expect(fromDecimal(" +3.10 ", "BOB").amount).toBe(310);
  });
});

describe("aritmética", () => {
  const a = fromDecimal("100.10", "BOB");
  const b = fromDecimal("0.20", "BOB");
  it("suma y resta exactas", () => {
    expect(toDecimalString(add(a, b))).toBe("100.30");
    expect(toDecimalString(subtract(a, b))).toBe("99.90");
    expect(toDecimalString(subtract(b, a))).toBe("-99.90");
  });
  it("no mezcla monedas", () => {
    expect(() => add(a, money(1, "USD"))).toThrow(TypeError);
    expect(() => subtract(a, money(1, "USD"))).toThrow(TypeError);
    expect(() => compare(a, money(1, "USD"))).toThrow(TypeError);
  });
  it("multiply por cantidad entera", () => {
    expect(toDecimalString(multiply(fromDecimal("19.99", "BOB"), 3))).toBe("59.97");
    expect(multiply(a, 0).amount).toBe(0);
    expect(() => multiply(a, 1.5)).toThrow(RangeError);
  });
  it("sum de lista (incluida la vacía)", () => {
    expect(toDecimalString(sum([a, b, b], "BOB"))).toBe("100.50");
    expect(sum([], "BOB").amount).toBe(0);
  });
  it("overflow se detecta, no se corrompe silenciosamente", () => {
    const big = money(Number.MAX_SAFE_INTEGER, "BOB");
    expect(() => add(big, money(1, "BOB"))).toThrow(RangeError);
  });
  it("comparación e igualdad", () => {
    expect(compare(a, b)).toBe(1);
    expect(compare(b, a)).toBe(-1);
    expect(compare(a, a)).toBe(0);
    expect(equals(a, fromDecimal("100.1", "BOB"))).toBe(true);
    expect(equals(money(100, "BOB"), money(100, "USD"))).toBe(false);
    expect(isZero(zero("BOB"))).toBe(true);
  });
});

describe("porcentaje y tipo de cambio", () => {
  it("15 % de Bs 99.99 = 14.9985 → Bs 15.00", () => {
    expect(toDecimalString(percentage(fromDecimal("99.99", "BOB"), "15"))).toBe("15.00");
  });
  it("12.5 % de Bs 10.00 = Bs 1.25", () => {
    expect(toDecimalString(percentage(fromDecimal("10", "BOB"), "12.5"))).toBe("1.25");
  });
  it("porcentaje de un monto negativo (descuento como resta)", () => {
    expect(toDecimalString(percentage(fromDecimal("-10", "BOB"), "10"))).toBe("-1.00");
  });
  it("multiplyByRate: 100 × 6.96 = 696", () => {
    expect(toDecimalString(multiplyByRate(fromDecimal("100", "BOB"), "6.96"))).toBe("696.00");
  });
  it("convert USD → BOB a 6.96: $10 = Bs 69.60", () => {
    expect(toDecimalString(convert(fromDecimal("10", "USD"), "BOB", "6.96"))).toBe("69.60");
  });
  it("convert redondea al destino: $1 × 6.965 = Bs 6.97 (mitad hacia arriba)", () => {
    expect(toDecimalString(convert(fromDecimal("1", "USD"), "BOB", "6.965"))).toBe("6.97");
  });
  it("convert a moneda sin decimales: Bs 100 × 130.5 = CLP 13050", () => {
    expect(toDecimalString(convert(fromDecimal("100", "BOB"), "CLP", "130.5"))).toBe("13050");
  });
  it("convert desde moneda sin decimales: CLP 13050 × 0.01 = Bs 130.50", () => {
    expect(toDecimalString(convert(money(13050, "CLP"), "BOB", "0.01"))).toBe("130.50");
  });
  it("convert con tasa inversa aproximada: CLP 13050 × 0.0076628 = 99.99954 → Bs 100.00", () => {
    expect(toDecimalString(convert(money(13050, "CLP"), "BOB", "0.0076628"))).toBe("100.00");
  });
  it("rechaza tasas inválidas", () => {
    expect(() => multiplyByRate(money(1, "BOB"), "abc")).toThrow(SyntaxError);
  });
});

describe("allocate (reparto sin perder centavos)", () => {
  it("Bs 100.00 en 3 partes iguales: 33.34 / 33.33 / 33.33", () => {
    expect(allocate(fromDecimal("100", "BOB"), [1, 1, 1]).map(toDecimalString)).toEqual([
      "33.34",
      "33.33",
      "33.33",
    ]);
  });
  it("empate de restos: el centavo sobrante va al primero", () => {
    expect(allocate(money(5, "BOB"), [3, 7]).map((m) => m.amount)).toEqual([2, 3]);
  });
  it("montos negativos", () => {
    expect(allocate(money(-1000, "BOB"), [1, 1, 1]).map((m) => m.amount)).toEqual([
      -334, -333, -333,
    ]);
  });
  it("proporción 0 recibe 0", () => {
    expect(allocate(money(1000, "BOB"), [0, 1]).map((m) => m.amount)).toEqual([0, 1000]);
  });
  it("entradas inválidas", () => {
    expect(() => allocate(money(100, "BOB"), [])).toThrow(RangeError);
    expect(() => allocate(money(100, "BOB"), [0, 0])).toThrow(RangeError);
    expect(() => allocate(money(100, "BOB"), [-1, 2])).toThrow(RangeError);
    expect(() => allocate(money(100, "BOB"), [1.5, 2])).toThrow(RangeError);
  });
});

describe("formatMoney", () => {
  it("es: separador de miles con punto y decimales con coma", () => {
    expect(formatMoney(fromDecimal("1234567.89", "BOB"))).toBe("Bs 1.234.567,89");
  });
  it("en: invertido", () => {
    expect(formatMoney(fromDecimal("1234567.89", "BOB"), "en")).toBe("Bs 1,234,567.89");
  });
  it("siempre muestra 2 decimales y símbolo por moneda", () => {
    expect(formatMoney(fromDecimal("5", "USD"))).toBe("$ 5,00");
    expect(formatMoney(fromDecimal("5", "EUR"))).toBe("€ 5,00");
    expect(formatMoney(fromDecimal("5", "ARS"))).toBe("AR$ 5,00");
  });
  it("centavos pequeños y cero", () => {
    expect(formatMoney(money(5, "BOB"))).toBe("Bs 0,05");
    expect(formatMoney(zero("BOB"))).toBe("Bs 0,00");
  });
  it("negativos", () => {
    expect(formatMoney(fromDecimal("-5.5", "BOB"))).toBe("-Bs 5,50");
    expect(formatMoney(fromDecimal("-1234.5", "BOB"), "en")).toBe("-Bs 1,234.50");
  });
  it("CLP sin decimales", () => {
    expect(formatMoney(money(1234567, "CLP"))).toBe("CLP$ 1.234.567");
  });
  it("millones exactos en el límite seguro no pierden dígitos", () => {
    expect(formatMoney(money(Number.MAX_SAFE_INTEGER, "BOB"), "en")).toBe(
      "Bs 90,071,992,547,409.91",
    );
  });
});

describe("propiedades (aleatorias, semilla fija)", () => {
  // PRNG determinista (mulberry32) para que un fallo sea reproducible.
  function rng(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = rng(20261022);
  const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;

  it("toDecimalString → fromDecimal es identidad (1000 casos, 4 monedas)", () => {
    for (let i = 0; i < 1000; i++) {
      const cur = ["BOB", "USD", "CLP", "EUR"][randInt(0, 3)]!;
      const m = money(randInt(-9_000_000_000_000, 9_000_000_000_000), cur);
      expect(equals(fromDecimal(toDecimalString(m), cur), m)).toBe(true);
    }
  });
  it("allocate: la suma de partes es exactamente el total y ninguna parte se desvía más de 1 centavo del ideal", () => {
    for (let i = 0; i < 1000; i++) {
      const total = money(randInt(-1_000_000, 1_000_000), "BOB");
      const ratios = Array.from({ length: randInt(1, 6) }, () => randInt(0, 10));
      if (!ratios.some((r) => r > 0)) ratios[0] = 1;
      const parts = allocate(total, ratios);
      expect(sum(parts, "BOB").amount).toBe(total.amount);
      const ratioSum = ratios.reduce((a, b) => a + b, 0);
      parts.forEach((p, idx) => {
        const ideal = (total.amount * ratios[idx]!) / ratioSum;
        expect(Math.abs(p.amount - ideal)).toBeLessThan(1);
      });
    }
  });
  it("(a + b) − b = a y a + b = b + a", () => {
    for (let i = 0; i < 500; i++) {
      const a = money(randInt(-1e9, 1e9), "BOB");
      const b = money(randInt(-1e9, 1e9), "BOB");
      expect(equals(subtract(add(a, b), b), a)).toBe(true);
      expect(equals(add(a, b), add(b, a))).toBe(true);
    }
  });
  it("sumar N veces 0.10 da exactamente N × 0.10 (sin deriva)", () => {
    let acc = zero("BOB");
    for (let i = 0; i < 10_000; i++) acc = add(acc, fromDecimal("0.10", "BOB"));
    expect(toDecimalString(acc)).toBe("1000.00");
    let floatAcc = 0;
    for (let i = 0; i < 10_000; i++) floatAcc += 0.1;
    expect(floatAcc).not.toBe(1000); // control: con floats sí deriva
  });
});
