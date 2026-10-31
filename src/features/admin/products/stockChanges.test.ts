import { describe, expect, it } from "vitest";
import { MAX_STOCK, changesBreakingReason, computeStockChanges } from "./stockChanges";

const variants = [
  { id: "a", stockOnHand: 10 },
  { id: "b", stockOnHand: 0 },
  { id: "c", stockOnHand: 7 },
];

describe("computeStockChanges", () => {
  it("sin ediciones no hay cambios", () => {
    expect(computeStockChanges(variants, {})).toEqual({ changes: [], problems: {} });
  });

  it("calcula el delta y recuerda el stock que se veía (`expected`): sumar y restar", () => {
    const r = computeStockChanges(variants, { a: "4", b: "25", c: "7" });
    expect(r.changes).toEqual([
      { variantId: "a", delta: -6, newValue: 4, expected: 10 },
      { variantId: "b", delta: 25, newValue: 25, expected: 0 },
    ]);
    expect(r.problems).toEqual({});
  });

  it("un valor igual al actual no genera movimiento (c: 7 → 7)", () => {
    expect(computeStockChanges(variants, { c: "7" }).changes).toEqual([]);
  });

  it("bajar a 0 es válido", () => {
    expect(computeStockChanges(variants, { a: "0" }).changes).toEqual([
      { variantId: "a", delta: -10, newValue: 0, expected: 10 },
    ]);
  });

  it("espacios alrededor se ignoran", () => {
    expect(computeStockChanges(variants, { a: " 12 " }).changes[0]?.newValue).toBe(12);
  });

  it.each(["", "  ", "-1", "1.5", "1,5", "abc", "1e3", "+4", "0x10", "٣"])(
    "«%s» es inválido y NO genera cambio",
    (raw) => {
      const r = computeStockChanges(variants, { a: raw });
      expect(r.problems).toEqual({ a: "invalid" });
      expect(r.changes).toEqual([]);
    },
  );

  it("sobre el máximo permitido es demasiado grande; el máximo exacto vale", () => {
    expect(computeStockChanges(variants, { a: String(MAX_STOCK + 1) }).problems).toEqual({
      a: "too_large",
    });
    expect(computeStockChanges(variants, { a: String(MAX_STOCK) }).changes[0]?.newValue).toBe(
      MAX_STOCK,
    );
  });

  it("un error en una variante no impide ver los cambios válidos de las otras", () => {
    const r = computeStockChanges(variants, { a: "x", b: "3" });
    expect(r.problems).toEqual({ a: "invalid" });
    expect(r.changes).toEqual([{ variantId: "b", delta: 3, newValue: 3, expected: 0 }]);
  });

  it("ids que no son variantes del producto se ignoran", () => {
    expect(computeStockChanges(variants, { zzz: "5" })).toEqual({ changes: [], problems: {} });
  });
});

describe("changesBreakingReason", () => {
  const mixed = [
    { variantId: "a", delta: -6, newValue: 4, expected: 10 },
    { variantId: "b", delta: 25, newValue: 25, expected: 0 },
  ];
  it("'Ajuste' admite sumar y restar", () => {
    expect(changesBreakingReason(mixed, "adjust")).toEqual([]);
  });
  it("'Carga inicial' y 'Devolución' no admiten restar: devuelve las variantes que restan", () => {
    expect(changesBreakingReason(mixed, "import")).toEqual(["a"]);
    expect(changesBreakingReason(mixed, "return")).toEqual(["a"]);
  });
  it("si todo suma, cualquier motivo vale", () => {
    expect(
      changesBreakingReason([{ variantId: "b", delta: 2, newValue: 2, expected: 0 }], "return"),
    ).toEqual([]);
  });
});
