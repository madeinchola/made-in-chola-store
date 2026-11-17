import { describe, expect, it, vi } from "vitest";
import { CHUNK_SIZE } from "./chunks";
import { applyImport, countOutcomes, previewImport, type ImportDeps } from "./runImport";
import { buildImportReport } from "./importReport";
import { explainProblem } from "./importMessages";
import type { ParsedFile, ParsedRow, RowResult } from "./types";

const row = (
  n: number,
  values: Record<string, string>,
  problems: ParsedRow["problems"] = [],
): ParsedRow => ({ row: n, values, problems });
const file = (rows: ParsedRow[], kind: ParsedFile["kind"] = "stock"): ParsedFile => ({
  kind,
  fileName: "conteo.csv",
  rows,
  ignoredColumns: [],
  encoding: "utf-8",
  delimiter: ",",
});

function deps(over: Partial<ImportDeps> = {}) {
  const validate = vi.fn(async (_k: string, rows: readonly ParsedRow[]): Promise<RowResult[]> =>
    rows.map((r) => ({
      row: r.row,
      action: r.values.sku === "BAD" ? "error" : "update",
      key: r.values.sku ?? null,
      errors: r.values.sku === "BAD" ? [{ field: "sku", code: "sku_not_found" }] : [],
    })),
  );
  const start = vi.fn(async () => "batch-1");
  const apply = vi.fn(async (_b: string, rows: readonly ParsedRow[]): Promise<RowResult[]> =>
    rows.map((r) => ({
      row: r.row,
      action: "update" as const,
      key: r.values.sku ?? null,
      errors: [],
    })),
  );
  const finish = vi.fn(async () => undefined);
  const base = { validate, start, apply, finish };
  return { ...base, ...over } as typeof base;
}

describe("previewImport", () => {
  it("pregunta a la base solo por las filas sin problemas locales y suma las descartadas por el navegador, en orden de fila", async () => {
    const d = deps();
    const f = file([
      row(2, { sku: "A" }),
      row(3, { sku: "A" }, [{ field: "sku", code: "duplicate_in_file" }]),
      row(4, { sku: "BAD" }),
      row(5, { sku: "C" }),
    ]);
    const out = await previewImport(f, d);
    expect(out.status).toBe("done");
    if (out.status !== "done") return;
    expect(d.validate).toHaveBeenCalledTimes(1);
    expect((d.validate.mock.calls[0]?.[1] ?? []).map((r) => r.row)).toEqual([2, 4, 5]);
    expect(out.outcomes.map((o) => [o.row, o.action, o.local])).toEqual([
      [2, "update", false],
      [3, "error", true],
      [4, "error", false],
      [5, "update", false],
    ]);
    expect(out.counts).toEqual({ create: 0, update: 2, skip: 0, error: 2 });
  });
  it("no manda NADA a escribir (solo valida) y avisa del progreso por bloque", async () => {
    const d = deps();
    const progress: number[] = [];
    const total = CHUNK_SIZE * 2 + 50;
    const rows = Array.from({ length: total }, (_, i) => row(i + 2, { sku: `S${i}` }));
    await previewImport(file(rows), d, { onProgress: (p) => progress.push(p.done) });
    expect(d.start).not.toHaveBeenCalled();
    expect(d.apply).not.toHaveBeenCalled();
    expect(d.validate).toHaveBeenCalledTimes(3);
    expect(progress).toEqual([0, CHUNK_SIZE, CHUNK_SIZE * 2, total]);
  });
  it("cancelar a mitad devuelve «cancelado» y no sigue preguntando", async () => {
    const d = deps();
    let calls = 0;
    const rows = Array.from({ length: CHUNK_SIZE * 2 + 50 }, (_, i) =>
      row(i + 2, { sku: `S${i}` }),
    );
    const out = await previewImport(file(rows), d, { shouldCancel: () => calls++ >= 1 });
    expect(out).toEqual({ status: "cancelled" });
    expect(d.validate).toHaveBeenCalledTimes(1);
  });
  it("si la base falla, el error sube (no se muestra una vista previa a medias)", async () => {
    const d = deps({ validate: vi.fn().mockRejectedValue(new Error("timeout")) });
    await expect(previewImport(file([row(2, { sku: "A" })]), d)).rejects.toThrow("timeout");
  });
});

describe("applyImport", () => {
  it("abre un lote con las filas que SÍ se envían, aplica por bloques y lo cierra", async () => {
    const d = deps();
    const f = file([
      row(2, { sku: "A" }),
      row(3, { sku: "B" }, [{ field: "stock", code: "formula" }]),
      row(4, { sku: "C" }),
    ]);
    const out = await applyImport(f, d);
    expect(d.start).toHaveBeenCalledWith("stock", "conteo.csv", 2);
    expect(d.apply).toHaveBeenCalledTimes(1);
    expect(d.finish).toHaveBeenCalledWith("batch-1");
    expect(out.status).toBe("done");
    expect(out.counts).toEqual({ create: 0, update: 2, skip: 0, error: 1 });
    expect(out.outcomes.map((o) => o.row)).toEqual([2, 3, 4]);
  });
  it("las filas que la revisión ya marcó con error NO se envían, pero salen en el informe", async () => {
    const d = deps();
    const f = file([row(2, { sku: "A" }), row(3, { sku: "BAD" }), row(4, { sku: "C" })]);
    const reviewed = [
      {
        row: 3,
        action: "error" as const,
        key: "BAD",
        errors: [{ field: "sku", code: "sku_not_found" }],
        local: false,
      },
    ];
    const out = await applyImport(f, d, {}, reviewed);
    expect(d.start).toHaveBeenCalledWith("stock", "conteo.csv", 2);
    expect((d.apply.mock.calls[0]?.[1] ?? []).map((r) => r.row)).toEqual([2, 4]);
    expect(out.outcomes.map((o) => [o.row, o.action])).toEqual([
      [2, "update"],
      [3, "error"],
      [4, "update"],
    ]);
    expect(out.counts).toEqual({ create: 0, update: 2, skip: 0, error: 1 });
  });
  it("cancelar deja el lote ABIERTO (en curso): no se cierra y lo aplicado queda aplicado", async () => {
    const d = deps();
    let calls = 0;
    const rows = Array.from({ length: CHUNK_SIZE * 2 + 50 }, (_, i) =>
      row(i + 2, { sku: `S${i}` }),
    );
    const out = await applyImport(file(rows), d, { shouldCancel: () => calls++ >= 1 });
    expect(out.status).toBe("cancelled");
    expect(d.apply).toHaveBeenCalledTimes(1);
    expect(d.finish).not.toHaveBeenCalled();
    expect(out.batchId).toBe("batch-1");
    expect(out.counts.update).toBe(CHUNK_SIZE);
  });
  it("si un bloque falla (red), el error sube y el lote NO se cierra", async () => {
    const d = deps({ apply: vi.fn().mockRejectedValue(new Error("red")) });
    await expect(applyImport(file([row(2, { sku: "A" })]), d)).rejects.toThrow("red");
    expect(d.finish).not.toHaveBeenCalled();
  });
});

describe("countOutcomes e informe", () => {
  it("cuenta por acción", () => {
    expect(
      countOutcomes([
        { row: 2, action: "create", key: null, errors: [], local: false },
        { row: 3, action: "skip", key: null, errors: [], local: false },
        { row: 4, action: "error", key: null, errors: [], local: true },
      ]),
    ).toEqual({ create: 1, update: 0, skip: 1, error: 1 });
  });
  it("el informe lleva fila, clave, qué pasó y por qué, en palabras", () => {
    const rows = buildImportReport(
      [
        { row: 2, action: "create", key: "BLU-1-R-M", errors: [], local: false },
        {
          row: 3,
          action: "error",
          key: "BLU-1-R-L",
          errors: [{ field: "stock", code: "below_reserved" }],
          local: false,
        },
      ],
      "final",
    );
    expect(rows[0]).toEqual(["Fila", "Clave", "Qué pasa", "Detalle"]);
    expect(rows[1]).toEqual(["2", "BLU-1-R-M", "Creada", ""]);
    expect(rows[2]).toEqual([
      "3",
      "BLU-1-R-L",
      "Error",
      "El stock no puede ser menor que lo reservado por pedidos.",
    ]);
    expect(
      buildImportReport(
        [{ row: 2, action: "create", key: "x", errors: [], local: false }],
        "preview",
      )[1]?.[2],
    ).toBe("Se crea");
  });
  it("explainProblem usa el nombre del campo en palabras y no inventa nada para un código desconocido", () => {
    expect(explainProblem({ field: "sku", code: "required" })).toBe("Falta «SKU».");
    expect(explainProblem({ field: "color_hex", code: "invalid_format" })).toBe(
      "«Tono del color» no tiene un formato válido.",
    );
    expect(explainProblem({ field: "x", code: "algo_raro" })).toBe(
      "No se pudo procesar esta fila.",
    );
    expect(explainProblem({ field: "stock", code: "number_ambiguous" })).toContain("ambiguo");
  });
});
