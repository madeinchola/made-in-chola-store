import { describe, expect, it } from "vitest";
import { CHUNK_MAX, CHUNK_SIZE, chunkRows } from "./chunks";
import type { ParsedRow } from "./types";

const row = (n: number, code = ""): ParsedRow => ({
  row: n,
  values: code ? { code } : { sku: `S${n}` },
  problems: [],
});

describe("chunkRows", () => {
  it("stock y precios: bloques de CHUNK_SIZE en el orden del archivo, sin perder ni repetir filas", () => {
    const rows = Array.from({ length: CHUNK_SIZE * 2 + 50 }, (_, i) => row(i + 2));
    const chunks = chunkRows("stock", rows);
    expect(chunks.map((c) => c.length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 50]);
    expect(chunks.flat().map((r) => r.row)).toEqual(rows.map((r) => r.row));
  });
  it("productos: las filas de un mismo producto van JUNTAS aunque estén separadas en el archivo", () => {
    const rows = [row(2, "A"), row(3, "B"), row(4, "A"), row(5, "C"), row(6, "B")];
    const [only] = chunkRows("products", rows);
    expect(only?.map((r) => r.values.code)).toEqual(["A", "A", "B", "B", "C"]);
    expect(only?.map((r) => r.row)).toEqual([2, 4, 3, 6, 5]);
  });
  it("productos: un bloque nunca parte un producto (se cierra antes y el producto abre el siguiente)", () => {
    // 199 filas del producto «P» + 3 de «Q»: «Q» no cabe en el primer bloque
    const rows = [
      ...Array.from({ length: 199 }, (_, i) => row(i + 2, "P")),
      ...Array.from({ length: 3 }, (_, i) => row(300 + i, "Q")),
    ];
    const chunks = chunkRows("products", rows);
    expect(chunks.map((c) => c.length)).toEqual([199, 3]);
    expect(new Set(chunks[0]?.map((r) => r.values.code))).toEqual(new Set(["P"]));
  });
  it("productos: un producto con más de 500 variantes se parte (la base no acepta más por bloque)", () => {
    const rows = Array.from({ length: 1200 }, (_, i) => row(i + 2, "GRANDE"));
    const chunks = chunkRows("products", rows);
    expect(chunks.map((c) => c.length)).toEqual([CHUNK_MAX, CHUNK_MAX, 200]);
  });
  it("categorías: se conserva el orden del archivo (una hija puede venir después de su madre)", () => {
    const rows = [row(2), row(3), row(4)];
    expect(chunkRows("categories", rows)[0]?.map((r) => r.row)).toEqual([2, 3, 4]);
  });
  it("sin filas no hay bloques; con el tamaño por omisión", () => {
    expect(chunkRows("stock", [])).toEqual([]);
    expect(CHUNK_SIZE).toBeLessThanOrEqual(CHUNK_MAX);
  });
});
