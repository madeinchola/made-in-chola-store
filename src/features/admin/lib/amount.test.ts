import { describe, expect, it } from "vitest";
import { amountToInput, parseAmount } from "./amount";

const bob = { decimals: 2 };

describe("parseAmount", () => {
  it.each([
    ["12", "12"],
    ["12.5", "12.5"],
    ["12,5", "12.5"],
    ["12.50", "12.50"],
    ["  99,99 ", "99.99"],
    ["007.10", "7.10"],
    ["0.01", "0.01"],
    ["999999999.99", "999999999.99"],
  ])("«%s» es válido y se normaliza a %s", (raw, expected) => {
    expect(parseAmount(raw, bob)).toEqual({ ok: true, value: expected });
  });

  it("vacío o solo espacios → empty", () => {
    expect(parseAmount("", bob)).toEqual({ ok: false, problem: "empty" });
    expect(parseAmount("   ", bob)).toEqual({ ok: false, problem: "empty" });
  });

  it.each([
    "abc",
    "12.5.3",
    "1,234.50",
    "1.234,50",
    "-5",
    "+5",
    "1e3",
    "12.",
    ".5",
    "12 50",
    "Bs 12",
  ])("«%s» → formato inválido", (raw) => {
    expect(parseAmount(raw, bob)).toEqual({ ok: false, problem: "format" });
  });

  it("más decimales de los que admite la moneda se RECHAZAN, no se redondean", () => {
    expect(parseAmount("10.999", bob)).toEqual({ ok: false, problem: "decimals" });
    expect(parseAmount("10,001", bob)).toEqual({ ok: false, problem: "decimals" });
    expect(parseAmount("10.5", { decimals: 0 })).toEqual({ ok: false, problem: "decimals" });
    expect(parseAmount("10", { decimals: 0 })).toEqual({ ok: true, value: "10" });
  });

  it("un precio no puede ser 0 (cualquier forma de cero), pero el costo sí", () => {
    for (const zero of ["0", "0.00", "000", "0,0"]) {
      expect(parseAmount(zero, bob)).toEqual({ ok: false, problem: "not_positive" });
      expect(parseAmount(zero, { ...bob, allowZero: true }).ok).toBe(true);
    }
  });

  it("el límite de la base: hasta 999 999 999.99; con 10 dígitos enteros es demasiado grande", () => {
    expect(parseAmount("1000000000", bob)).toEqual({ ok: false, problem: "too_large" });
    expect(parseAmount("1234567890.5", bob)).toEqual({ ok: false, problem: "too_large" });
  });

  it("los ceros a la izquierda no cuentan para el límite", () => {
    expect(parseAmount("0000000012", bob)).toEqual({ ok: true, value: "12" });
  });
});

describe("amountToInput", () => {
  it("quita ceros sobrantes de la base (numeric devuelve '45.50' o 100)", () => {
    expect(amountToInput("45.50")).toBe("45.5");
    expect(amountToInput("100.00")).toBe("100");
    expect(amountToInput(100)).toBe("100");
    expect(amountToInput(7.25)).toBe("7.25");
  });
  it("nulos y vacíos → campo vacío", () => {
    expect(amountToInput(null)).toBe("");
    expect(amountToInput(undefined)).toBe("");
    expect(amountToInput("")).toBe("");
  });
  it("no toca enteros con ceros al final (100 sigue siendo 100)", () => {
    expect(amountToInput("1000")).toBe("1000");
    expect(amountToInput(1000)).toBe("1000");
  });
});
