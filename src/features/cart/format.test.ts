import { describe, expect, it } from "vitest";
import { formatCartMoney, formatCountdown, limitReason, maxQtyFor, productHref } from "./format";

const limits = { max_qty_per_variant: 10, max_lines: 30, max_units: 30 };

describe("formatCartMoney (solo da formato a lo que dijo el servidor)", () => {
  it.each([
    [560, "BOB", "Bs 560,00"],
    [1234.5, "BOB", "Bs 1.234,50"],
    [0.9, "BOB", "Bs 0,90"],
    [0, "BOB", "Bs 0,00"],
    [-12.5, "BOB", "-Bs 12,50"],
  ])("%j %s → %s", (value, currency, expected) => {
    expect(formatCartMoney(value, currency)).toBe(expected);
  });

  it("un valor imposible o una moneda desconocida no rompen la pantalla", () => {
    expect(formatCartMoney(Number.NaN, "BOB")).toBe("BOB NaN");
    expect(formatCartMoney(5, "ZZZ")).toBe("ZZZ 5");
  });
});

describe("formatCountdown", () => {
  it.each([
    [600_000, "10:00"],
    [90_000, "01:30"],
    [61_000, "01:01"],
    [60_000, "01:00"],
    [59_001, "01:00"], // redondea hacia arriba: «00:59» solo cuando quedan 59 s o menos
    [59_000, "00:59"],
    [1_000, "00:01"],
    [1, "00:01"],
    [0, "00:00"],
    [-5_000, "00:00"],
    [3_725_000, "62:05"],
  ])("%j ms → %s", (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected);
  });
});

describe("tope de cantidad", () => {
  it("es lo menor entre el máximo por producto y lo disponible, y nunca baja de 0", () => {
    expect(maxQtyFor({ available: 25 }, limits)).toBe(10);
    expect(maxQtyFor({ available: 4 }, limits)).toBe(4);
    expect(maxQtyFor({ available: 0 }, limits)).toBe(0);
    expect(maxQtyFor({ available: -3 }, limits)).toBe(0);
  });

  it("dice qué limita: el stock si hay menos que el máximo; si no, el máximo por producto", () => {
    expect(limitReason({ available: 4 }, limits)).toBe("stock");
    expect(limitReason({ available: 10 }, limits)).toBe("variant");
    expect(limitReason({ available: 99 }, limits)).toBe("variant");
  });
});

describe("productHref", () => {
  it("enlaza a la ficha con el color como lo espera la ficha (sin acentos, minúsculas, guiones)", () => {
    expect(productHref({ slug: "chaqueta-japandi", color_name: "Azul Marino" })).toBe(
      "/producto/chaqueta-japandi?color=azul-marino",
    );
    expect(productHref({ slug: "x", color_name: "Café" })).toBe("/producto/x?color=cafe");
  });

  it("sin color (o sin letras en el nombre) enlaza solo al producto", () => {
    expect(productHref({ slug: "x", color_name: null })).toBe("/producto/x");
    expect(productHref({ slug: "x", color_name: "🙂" })).toBe("/producto/x");
  });
});
