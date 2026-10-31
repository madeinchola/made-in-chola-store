import { describe, expect, it } from "vitest";
import { getPageItems, safePageNumber, type PageItem } from "./pagination-range";

const S = "ellipsis-start";
const E = "ellipsis-end";

describe("getPageItems", () => {
  const cases: [string, number, number, PageItem[]][] = [
    ["una página", 1, 1, [1]],
    ["pocas páginas: todas (5 de 5)", 3, 5, [1, 2, 3, 4, 5]],
    ["justo en el umbral (7 de 7): todas", 4, 7, [1, 2, 3, 4, 5, 6, 7]],
    ["10 páginas, en la 1", 1, 10, [1, 2, 3, 4, 5, E, 10]],
    ["10 páginas, en la 3 (aún pegada al inicio)", 3, 10, [1, 2, 3, 4, 5, E, 10]],
    ["10 páginas, en la 4 (se abre el hueco izquierdo)", 4, 10, [1, S, 3, 4, 5, E, 10]],
    ["10 páginas, en la 5", 5, 10, [1, S, 4, 5, 6, E, 10]],
    ["10 páginas, en la 7", 7, 10, [1, S, 6, 7, 8, E, 10]],
    ["10 páginas, en la 8 (pegada al final)", 8, 10, [1, S, 6, 7, 8, 9, 10]],
    ["10 páginas, en la 10", 10, 10, [1, S, 6, 7, 8, 9, 10]],
    ["8 páginas, en la 4", 4, 8, [1, S, 3, 4, 5, E, 8]],
    ["8 páginas, en la 1", 1, 8, [1, 2, 3, 4, 5, E, 8]],
  ];
  it.each(cases)("%s", (_name, page, total, expected) => {
    expect(getPageItems(page, total)).toEqual(expected);
  });

  it("con más de 7 páginas SIEMPRE devuelve 7 elementos (la barra no cambia de ancho)", () => {
    for (let total = 8; total <= 40; total++) {
      for (let page = 1; page <= total; page++) {
        expect(getPageItems(page, total), `página ${page} de ${total}`).toHaveLength(7);
      }
    }
  });
  it("siempre incluye la primera, la última y la actual, sin repetir ni desordenar", () => {
    for (let total = 1; total <= 30; total++) {
      for (let page = 1; page <= total; page++) {
        const numbers = getPageItems(page, total).filter((i): i is number => typeof i === "number");
        expect(numbers[0]).toBe(1);
        expect(numbers.at(-1)).toBe(total);
        expect(numbers).toContain(page);
        expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
        expect(new Set(numbers).size).toBe(numbers.length);
      }
    }
  });
  it("acota una página fuera de rango y tolera totales raros", () => {
    expect(getPageItems(99, 10)).toEqual(getPageItems(10, 10));
    expect(getPageItems(0, 10)).toEqual(getPageItems(1, 10));
    expect(getPageItems(-5, 10)).toEqual(getPageItems(1, 10));
    expect(getPageItems(1, 0)).toEqual([1]);
    expect(getPageItems(1, -3)).toEqual([1]);
    expect(getPageItems(2.9, 3.9)).toEqual([1, 2, 3]);
  });
  it("NaN, undefined e Infinity no producen «NaN» en la barra (p. ej. Math.ceil(undefined / 12) mientras carga)", () => {
    expect(getPageItems(Number.NaN, Number.NaN)).toEqual([1]);
    expect(getPageItems(1, Math.ceil((undefined as unknown as number) / 12))).toEqual([1]);
    expect(getPageItems(Number.NaN, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(getPageItems(2, Number.POSITIVE_INFINITY)).toEqual([1]);
    expect(safePageNumber(Number.NaN)).toBe(1);
    expect(safePageNumber(-4)).toBe(1);
    expect(safePageNumber(7.9)).toBe(7);
  });
  it("con `siblings` mayor muestra más vecinas (2 → 9 elementos)", () => {
    expect(getPageItems(10, 20, 2)).toEqual([1, S, 8, 9, 10, 11, 12, E, 20]);
  });
});
