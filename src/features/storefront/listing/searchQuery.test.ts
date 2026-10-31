import { describe, expect, it } from "vitest";
import { MAX_SEARCH_LENGTH, isSearchable, normalizeSearchQuery } from "./searchQuery";

describe("normalizeSearchQuery", () => {
  it.each([
    [null, ""],
    [undefined, ""],
    ["", ""],
    ["   ", ""],
    ["chaqueta", "chaqueta"],
    ["  chaqueta  ", "chaqueta"],
    ["vestido     rojo", "vestido rojo"],
    ["vestido\t\n rojo", "vestido rojo"],
    ["a\u0000b\u001fc\u007fd", "a b c d"],
    ["ÑANDÚ  Ábaco", "ÑANDÚ Ábaco"],
  ])("%j → %j", (raw, expected) => {
    expect(normalizeSearchQuery(raw)).toBe(expected);
  });

  it(`corta a ${MAX_SEARCH_LENGTH} caracteres`, () => {
    const out = normalizeSearchQuery("a".repeat(500));
    expect(out).toHaveLength(MAX_SEARCH_LENGTH);
  });

  it("al cortar no deja un espacio colgando", () => {
    const text = `${"a".repeat(79)} ${"b".repeat(10)}`;
    expect(normalizeSearchQuery(text)).toBe("a".repeat(79));
  });

  it("no parte un emoji por la mitad al cortar", () => {
    const out = normalizeSearchQuery("😀".repeat(100));
    expect(Array.from(out)).toHaveLength(MAX_SEARCH_LENGTH);
    expect(out.endsWith("😀")).toBe(true);
    expect(out).not.toMatch(/[\ud800-\udbff]$/);
  });

  it("los comodines y comillas se conservan como texto (la base los escapa)", () => {
    expect(normalizeSearchQuery("100% 'lana' _x_")).toBe("100% 'lana' _x_");
  });
});

describe("isSearchable", () => {
  it.each([
    ["", false],
    ["a", false],
    ["ab", true],
    ["😀", false],
    ["😀😀", true],
    ["ñu", true],
  ])("%j → %s (cuenta caracteres completos)", (query, expected) => {
    expect(isSearchable(query)).toBe(expected);
  });
});
