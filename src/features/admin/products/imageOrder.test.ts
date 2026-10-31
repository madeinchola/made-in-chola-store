import { describe, expect, it } from "vitest";
import { moveToFront, nextSortOrder, reorderChanges } from "./imageOrder";

describe("reorderChanges", () => {
  it("ya en orden: cero escrituras", () => {
    expect(
      reorderChanges([
        { id: "a", sortOrder: 1 },
        { id: "b", sortOrder: 2 },
        { id: "c", sortOrder: 3 },
      ]),
    ).toEqual([]);
  });

  it("intercambiar las dos últimas: solo esas dos filas cambian", () => {
    // orden deseado: a, c, b  (sort_order actuales: 1, 3, 2)
    expect(
      reorderChanges([
        { id: "a", sortOrder: 1 },
        { id: "c", sortOrder: 3 },
        { id: "b", sortOrder: 2 },
      ]),
    ).toEqual([
      { id: "c", sortOrder: 2 },
      { id: "b", sortOrder: 3 },
    ]);
  });

  it("normaliza huecos y duplicados (sort_order 5, 5, 9 → 1, 2, 3)", () => {
    expect(
      reorderChanges([
        { id: "x", sortOrder: 5 },
        { id: "y", sortOrder: 5 },
        { id: "z", sortOrder: 9 },
      ]),
    ).toEqual([
      { id: "x", sortOrder: 1 },
      { id: "y", sortOrder: 2 },
      { id: "z", sortOrder: 3 },
    ]);
  });

  it("lista vacía: nada que hacer", () => {
    expect(reorderChanges([])).toEqual([]);
  });
});

describe("moveToFront", () => {
  it("mueve un elemento del medio al principio conservando el orden de los demás", () => {
    expect(moveToFront(["a", "b", "c", "d"], "c")).toEqual(["c", "a", "b", "d"]);
  });
  it("el último pasa al primer lugar", () => {
    expect(moveToFront(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });
  it("si ya es el primero, o no existe, devuelve una copia igual", () => {
    const original = ["a", "b"];
    expect(moveToFront(original, "a")).toEqual(["a", "b"]);
    expect(moveToFront(original, "zzz")).toEqual(["a", "b"]);
    expect(moveToFront(original, "a")).not.toBe(original);
  });
  it("no modifica el arreglo recibido", () => {
    const original = ["a", "b", "c"];
    moveToFront(original, "c");
    expect(original).toEqual(["a", "b", "c"]);
  });
});

describe("nextSortOrder", () => {
  it("sin imágenes empieza en 1", () => {
    expect(nextSortOrder([])).toBe(1);
  });
  it("va al final: máximo + 1, aunque haya huecos", () => {
    expect(nextSortOrder([{ sortOrder: 1 }, { sortOrder: 7 }, { sortOrder: 3 }])).toBe(8);
  });
});
