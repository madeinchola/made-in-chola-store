import { describe, expect, it } from "vitest";
import { computePriceChanges, type PriceRowInfo } from "./priceChanges";

const BOB: PriceRowInfo = { code: "BOB", name: "Boliviano", symbol: "Bs", decimals: 2 };
const USD: PriceRowInfo = { code: "USD", name: "Dólar", symbol: "$", decimals: 2 };
const CLP: PriceRowInfo = { code: "CLP", name: "Peso chileno", symbol: "CLP$", decimals: 0 };
const draft = { published: false };
const published = { published: true };

describe("computePriceChanges", () => {
  it("sin ediciones no hay cambios ni errores", () => {
    expect(computePriceChanges([BOB], { BOB: "100" }, {}, draft)).toEqual({
      changes: [],
      errors: {},
    });
  });

  it("un precio nuevo en una moneda sin precio se inserta (normalizado)", () => {
    expect(computePriceChanges([BOB, USD], { BOB: "100" }, { USD: "14,5" }, draft).changes).toEqual(
      [{ currency: "USD", amount: "14.5" }],
    );
  });

  it("cambiar un precio existente genera una actualización; dejarlo igual (aunque se reescriba) no", () => {
    expect(computePriceChanges([BOB], { BOB: "100" }, { BOB: "120" }, draft).changes).toEqual([
      { currency: "BOB", amount: "120" },
    ]);
    expect(computePriceChanges([BOB], { BOB: "100" }, { BOB: "100" }, draft).changes).toEqual([]);
    expect(computePriceChanges([BOB], { BOB: "100" }, { BOB: " 100 " }, draft).changes).toEqual([]);
  });

  it("vaciar una moneda con precio la QUITA (amount null)", () => {
    expect(
      computePriceChanges([BOB, USD], { BOB: "100", USD: "14" }, { USD: "" }, draft).changes,
    ).toEqual([{ currency: "USD", amount: null }]);
  });

  it("vaciar una moneda que no tenía precio no hace nada", () => {
    expect(computePriceChanges([BOB, USD], { BOB: "100" }, { USD: "" }, draft)).toEqual({
      changes: [],
      errors: {},
    });
  });

  it("quitar el precio en BOB de un producto PUBLICADO es un error; en un borrador, se permite", () => {
    const blocked = computePriceChanges([BOB], { BOB: "100" }, { BOB: "" }, published);
    expect(blocked.changes).toEqual([]);
    expect(blocked.errors.BOB).toBe(
      "No se puede quitar el precio en bolivianos de un producto publicado.",
    );
    expect(computePriceChanges([BOB], { BOB: "100" }, { BOB: "" }, draft).changes).toEqual([
      { currency: "BOB", amount: null },
    ]);
  });

  it("valida con los decimales de CADA moneda: BOB admite 2, CLP ninguno", () => {
    expect(computePriceChanges([BOB], {}, { BOB: "10.999" }, draft).errors.BOB).toBe(
      "Máximo 2 decimales.",
    );
    expect(computePriceChanges([CLP], {}, { CLP: "1500.5" }, draft).errors.CLP).toBe(
      "Máximo 0 decimales.",
    );
    expect(computePriceChanges([CLP], {}, { CLP: "1500" }, draft).changes).toEqual([
      { currency: "CLP", amount: "1500" },
    ]);
  });

  it("precio 0, negativo o texto: error, sin cambio", () => {
    for (const bad of ["0", "-5", "abc"]) {
      const r = computePriceChanges([BOB], {}, { BOB: bad }, draft);
      expect(r.changes).toEqual([]);
      expect(Object.keys(r.errors)).toEqual(["BOB"]);
    }
  });

  it("un error en una moneda no oculta los cambios válidos de otra", () => {
    const r = computePriceChanges([BOB, USD], { BOB: "100" }, { BOB: "abc", USD: "9" }, draft);
    expect(r.errors).toEqual({
      BOB: "Escribe un número como 120 o 120,50 (sin separador de miles).",
    });
    expect(r.changes).toEqual([{ currency: "USD", amount: "9" }]);
  });
});
