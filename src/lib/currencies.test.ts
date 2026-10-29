import { describe, expect, it } from "vitest";
import { COUNTRIES, getCountry } from "./countries";
import { CURRENCIES, getCurrency, isSupportedCurrency } from "./currencies";

describe("catálogo de monedas y países", () => {
  it("BOB, USD, EUR y ARS (requeridas por el negocio) están soportadas", () => {
    for (const code of ["BOB", "USD", "EUR", "ARS"]) expect(isSupportedCurrency(code)).toBe(true);
  });
  it("sin códigos duplicados y con decimales válidos", () => {
    expect(new Set(CURRENCIES.map((c) => c.code)).size).toBe(CURRENCIES.length);
    expect(CURRENCIES.every((c) => [0, 2].includes(c.decimals))).toBe(true);
  });
  it("cada país referencia una moneda que existe (integridad referencial)", () => {
    for (const c of COUNTRIES) expect(isSupportedCurrency(c.currency), c.code).toBe(true);
  });
  it("códigos de país únicos y prefijo con +", () => {
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
    expect(COUNTRIES.every((c) => /^\+\d{1,3}$/.test(c.dial))).toBe(true);
  });
  it("Bolivia → BOB → +591", () => {
    expect(getCountry("BO")).toMatchObject({ currency: "BOB", dial: "+591" });
    expect(getCurrency("BOB").decimals).toBe(2);
  });
  it("lanza con códigos desconocidos", () => {
    expect(() => getCountry("ZZ")).toThrow();
    expect(() => getCurrency("ZZZ")).toThrow();
  });
});
