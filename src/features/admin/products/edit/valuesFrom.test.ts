import { describe, expect, it } from "vitest";
import { productDataSchema, toProductPatch } from "../productSchema";
import type { AdminProductData } from "../types";
import { valuesFrom } from "./valuesFrom";

const saved: AdminProductData = {
  id: "p",
  code: "CHQ-001",
  slug: "chaqueta",
  name: "Chaqueta",
  model: null,
  description: "Texto",
  materials: null,
  washcare: "Lavar a mano",
  costBase: "45.5",
  outOfStockBehavior: "hide",
  status: "active",
  isNew: true,
  allowConvertedPrices: true,
  archived: false,
  createdAt: "",
  updatedAt: "2026-10-29T22:17:32.123456+00:00",
};

describe("valuesFrom", () => {
  it("nulos → cadenas vacías (los inputs controlados no admiten null)", () => {
    const v = valuesFrom(saved);
    expect(v.model).toBe("");
    expect(v.materials).toBe("");
    expect(v.washcare).toBe("Lavar a mano");
  });

  it("copia tal cual los campos simples y los booleanos", () => {
    expect(valuesFrom(saved)).toMatchObject({
      name: "Chaqueta",
      code: "CHQ-001",
      slug: "chaqueta",
      description: "Texto",
      outOfStockBehavior: "hide",
      isNew: true,
      allowConvertedPrices: true,
    });
  });

  it("el costo se muestra sin ceros sobrantes; sin costo queda vacío", () => {
    expect(valuesFrom({ ...saved, costBase: "45.50" }).costBase).toBe("45.5");
    expect(valuesFrom({ ...saved, costBase: "100" }).costBase).toBe("100");
    expect(valuesFrom({ ...saved, costBase: null }).costBase).toBe("");
  });

  it("ida y vuelta: abrir y guardar SIN tocar nada reproduce lo guardado (no corrompe datos)", () => {
    const parsed = productDataSchema.parse(valuesFrom(saved));
    expect(toProductPatch(parsed)).toEqual({
      name: "Chaqueta",
      code: "CHQ-001",
      slug: "chaqueta",
      model: null,
      description: "Texto",
      materials: null,
      washcare: "Lavar a mano",
      cost_base: 45.5,
      out_of_stock_behavior: "hide",
      is_new: true,
      allow_converted_prices: true,
    });
  });

  it("un costo de 0 sobrevive a la ida y vuelta (0 no es 'sin costo')", () => {
    const parsed = productDataSchema.parse(valuesFrom({ ...saved, costBase: "0" }));
    expect(toProductPatch(parsed).cost_base).toBe(0);
  });
});
