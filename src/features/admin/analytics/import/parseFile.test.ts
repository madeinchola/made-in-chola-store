import { describe, expect, it } from "vitest";
import { decodeBytes, MAX_CATEGORY_ROWS, MAX_FILE_BYTES, parseImportFile } from "./parseFile";
import type { ParsedFile } from "./types";

const enc = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;
const latin1 = (text: string): ArrayBuffer =>
  Uint8Array.from(Array.from(text).map((c) => c.charCodeAt(0))).buffer as ArrayBuffer;

function file(outcome: ReturnType<typeof parseImportFile>): ParsedFile {
  if (!outcome.ok)
    throw new Error(`falló: ${outcome.failure.code} ${outcome.failure.detail ?? ""}`);
  return outcome.file;
}

describe("parseImportFile: encabezados y separadores", () => {
  it("reconoce los encabezados en español con tildes y mayúsculas, y con su nombre técnico", () => {
    const f = file(parseImportFile("stock", "s.csv", enc("SKU,Existencias\nA-1,5\n")));
    expect(f.rows[0]?.values).toEqual({ sku: "A-1", stock: "5" });
    const g = file(
      parseImportFile("prices", "p.csv", enc("Código,Moneda,Precio\nBLU-1,BOB,120\n")),
    );
    expect(g.rows[0]?.values).toEqual({ code: "BLU-1", currency: "BOB", price: "120" });
  });
  it("detecta coma, punto y coma, tabulador y barra", () => {
    for (const [sep, name] of [
      [",", ","],
      [";", ";"],
      ["\t", "\t"],
      ["|", "|"],
    ] as const) {
      const f = file(
        parseImportFile("stock", "s.csv", enc(`sku${sep}stock\nA-1${sep}5\nA-2${sep}6\n`)),
      );
      expect(f.delimiter, name).toBe(sep);
      expect(f.rows.map((r) => r.values.sku)).toEqual(["A-1", "A-2"]);
    }
  });
  it("un salto de línea dentro de una celda entre comillas no parte la fila", () => {
    const f = file(
      parseImportFile(
        "categories",
        "c.csv",
        enc('nombre,descripcion\n"Blusas","línea 1\nlínea 2"\nFaldas,\n'),
      ),
    );
    expect(f.rows).toHaveLength(2);
    expect(f.rows[0]?.values.description).toBe("línea 1\nlínea 2");
  });
  it("avisa de las columnas que no son de la plantilla y las ignora", () => {
    const f = file(
      parseImportFile(
        "stock",
        "s.csv",
        enc("sku,stock,observaciones,color favorito\nA-1,5,hola,rojo\n"),
      ),
    );
    expect(f.ignoredColumns).toEqual(["observaciones", "color favorito"]);
    expect(f.rows[0]?.values).toEqual({ sku: "A-1", stock: "5" });
  });
  it("si falta una columna obligatoria, dice cuál", () => {
    const out = parseImportFile("stock", "s.csv", enc("sku,cantidad_x\nA-1,5\n"));
    expect(out).toEqual({ ok: false, failure: { code: "missing_columns", detail: "stock" } });
    const prods = parseImportFile("products", "p.csv", enc("codigo,nombre\nB-1,Blusa\n"));
    expect(prods.ok).toBe(false);
    if (!prods.ok) expect(prods.failure.detail).toBe("color, sku");
  });
});

describe("parseImportFile: codificación", () => {
  it("lee UTF-8 con y sin BOM sin que el BOM se pegue al primer encabezado", () => {
    const withBom = file(parseImportFile("stock", "s.csv", enc("﻿sku,stock\nA-1,5\n")));
    expect(withBom.rows[0]?.values.sku).toBe("A-1");
    expect(withBom.encoding).toBe("utf-8");
  });
  it("lee Windows-1252 (Excel antiguo) con tildes y eñes bien", () => {
    const f = file(
      parseImportFile("categories", "c.csv", latin1("nombre;descripcion\nCamisón;Ñandú rápido\n")),
    );
    expect(f.encoding).toBe("windows-1252");
    expect(f.rows[0]?.values).toEqual({ name: "Camisón", description: "Ñandú rápido" });
  });
  it("UTF-8 con acentos y emojis queda intacto", () => {
    const f = file(parseImportFile("categories", "c.csv", enc("nombre\nÑandú 🧵 café\n")));
    expect(f.rows[0]?.values.name).toBe("Ñandú 🧵 café");
  });
  it("decodeBytes elige la codificación por lo que el archivo ES, no por la extensión", () => {
    expect(decodeBytes(new Uint8Array([0x63, 0x61, 0x66, 0xe9])).encoding).toBe("windows-1252");
    expect(decodeBytes(new TextEncoder().encode("café")).encoding).toBe("utf-8");
  });
});

describe("parseImportFile: números, vacíos y casos raros", () => {
  it("normaliza «1.234,56» y «1,234.56» y avisa del ambiguo (sin enviarlo adivinado)", () => {
    const f = file(
      parseImportFile(
        "prices",
        "p.csv",
        enc('codigo;precio\nA;1.234,56\nB;"1,234.56"\nC;12,500\nD;abc\nE;\n'),
      ),
    );
    expect(f.rows.map((r) => r.values.price)).toEqual(["1234.56", "1234.56", "12,500", "abc", ""]);
    expect(f.rows[2]?.problems).toEqual([{ field: "price", code: "number_ambiguous" }]);
    expect(f.rows[3]?.problems).toEqual([]); // el texto lo rechaza la base con su motivo
  });
  it("las celdas vacías llegan vacías (la base decide si eran obligatorias)", () => {
    const f = file(
      parseImportFile(
        "products",
        "p.csv",
        enc("codigo,nombre,color,sku,talla,stock\nB-1,Blusa,Rojo,B-1-R,,\n"),
      ),
    );
    expect(f.rows[0]?.values).toMatchObject({
      code: "B-1",
      color: "Rojo",
      sku: "B-1-R",
      size: "",
      stock: "",
    });
  });
  it("una fórmula en una celda se marca (un CSV con «=SUMA(...)» sin calcular no es un dato)", () => {
    const f = file(parseImportFile("stock", "s.csv", enc("sku,stock\nA-1,=SUMA(A1:A2)\n")));
    expect(f.rows[0]?.problems).toEqual([{ field: "stock", code: "formula" }]);
  });
  it("los SKU repetidos dentro del archivo se marcan desde la SEGUNDA vez, sin importar mayúsculas", () => {
    const f = file(
      parseImportFile("stock", "s.csv", enc("sku,stock\nA-1,5\na-1,6\nB-2,1\nA-1,7\n")),
    );
    expect(f.rows.map((r) => r.problems.map((p) => p.code))).toEqual([
      [],
      ["duplicate_in_file"],
      [],
      ["duplicate_in_file"],
    ]);
  });
  it("precios: el mismo código con otra moneda NO es repetido", () => {
    const f = file(
      parseImportFile("prices", "p.csv", enc("codigo,moneda,precio\nA,BOB,1\nA,USD,2\na,bob,3\n")),
    );
    expect(f.rows.map((r) => r.problems.length)).toEqual([0, 0, 1]);
  });
  it("categorías: dos nombres que dan el mismo identificador se marcan", () => {
    const f = file(
      parseImportFile("categories", "c.csv", enc("nombre\nBlusas\nBLUSAS\nÑandú\nNandu\n")),
    );
    expect(f.rows.map((r) => r.problems.length)).toEqual([0, 1, 0, 1]);
  });
  it("el número de fila es el de la hoja de cálculo (el encabezado es la fila 1) aunque haya filas vacías", () => {
    const f = file(parseImportFile("stock", "s.csv", enc("sku,stock\nA-1,5\n\n,\nB-2,6\n")));
    expect(f.rows.map((r) => r.row)).toEqual([2, 5]);
  });
  it("saltos de línea de Windows y filas finales vacías", () => {
    const f = file(parseImportFile("stock", "s.csv", enc("sku,stock\r\nA-1,5\r\nA-2,6\r\n\r\n")));
    expect(f.rows).toHaveLength(2);
  });
});

describe("parseImportFile: lo que se rechaza de entrada", () => {
  it("un archivo de Excel o de otra hoja de cálculo se rechaza con instrucciones (no se intenta leer)", () => {
    expect(parseImportFile("stock", "inventario.xlsx", enc("sku,stock\n"))).toEqual({
      ok: false,
      failure: { code: "not_csv" },
    });
    expect(parseImportFile("stock", "inventario.xls", enc("sku,stock\n"))).toEqual({
      ok: false,
      failure: { code: "not_csv" },
    });
    // aunque lo renombren a .csv, un .xlsx empieza con «PK»
    expect(
      parseImportFile(
        "stock",
        "inventario.csv",
        Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0]).buffer as ArrayBuffer,
      ),
    ).toEqual({ ok: false, failure: { code: "not_csv" } });
  });
  it("vacío, solo encabezado y solo líneas en blanco", () => {
    expect(parseImportFile("stock", "s.csv", new ArrayBuffer(0))).toEqual({
      ok: false,
      failure: { code: "empty" },
    });
    expect(parseImportFile("stock", "s.csv", enc("\n\n  \n"))).toEqual({
      ok: false,
      failure: { code: "empty" },
    });
    expect(parseImportFile("stock", "s.csv", enc("sku,stock\n"))).toEqual({
      ok: false,
      failure: { code: "empty" },
    });
  });
  it("más de 5 MB se rechaza", () => {
    expect(parseImportFile("stock", "s.csv", new ArrayBuffer(MAX_FILE_BYTES + 1))).toEqual({
      ok: false,
      failure: { code: "too_big" },
    });
  });
  it("más de 10 000 filas se rechaza; las categorías, más de 500", () => {
    const many = (n: number, head: string, row: (i: number) => string) =>
      enc(head + "\n" + Array.from({ length: n }, (_, i) => row(i)).join("\n"));
    expect(
      parseImportFile(
        "stock",
        "s.csv",
        many(10_001, "sku,stock", (i) => `S${i},1`),
      ),
    ).toEqual({ ok: false, failure: { code: "too_many_rows", detail: "10000" } });
    expect(
      parseImportFile(
        "stock",
        "s.csv",
        many(10_000, "sku,stock", (i) => `S${i},1`),
      ).ok,
    ).toBe(true);
    expect(
      parseImportFile(
        "categories",
        "c.csv",
        many(MAX_CATEGORY_ROWS + 1, "nombre", (i) => `C${i}`),
      ),
    ).toEqual({ ok: false, failure: { code: "too_many_rows", detail: "500" } });
  });
});
