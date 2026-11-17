import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as csv from "@/lib/csv";
import * as importApi from "./importApi";
import { ImportPage } from "./ImportPage";
import type { ImportBatch, RowResult } from "./types";

vi.mock("./importApi", () => ({
  validateChunk: vi.fn(),
  startBatch: vi.fn(),
  applyChunk: vi.fn(),
  finishBatch: vi.fn(),
  rollbackBatch: vi.fn(),
  listBatches: vi.fn(),
}));
vi.mock("@/lib/csv", async (original) => ({
  ...(await original<typeof csv>()),
  downloadCsv: vi.fn(),
}));
const api = vi.mocked(importApi);

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ImportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** jsdom no trae Blob.arrayBuffer en todas las versiones: se lee con FileReader. */
function csvFile(content: string, name = "conteo.csv"): File {
  const file = new File([content], name, { type: "text/csv" });
  if (typeof file.arrayBuffer !== "function") {
    Object.defineProperty(file, "arrayBuffer", {
      value: () =>
        new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(file);
        }),
    });
  }
  return file;
}

const batch = (over: Partial<ImportBatch> = {}): ImportBatch => ({
  id: "b1",
  kind: "stock",
  filename: "conteo.csv",
  status: "done",
  totalRows: 3,
  createdCount: 0,
  updatedCount: 2,
  skippedCount: 1,
  errorCount: 0,
  createdAt: "2026-11-16T15:00:00Z",
  finishedAt: "2026-11-16T15:00:05Z",
  rolledBackAt: null,
  ...over,
});

const results = (
  rows: { row: number; sku: string; action: RowResult["action"]; code?: string; field?: string }[],
): RowResult[] =>
  rows.map((r) => ({
    row: r.row,
    action: r.action,
    key: r.sku,
    errors: r.code ? [{ field: r.field ?? "sku", code: r.code }] : [],
  }));

beforeEach(() => {
  vi.clearAllMocks();
  api.listBatches.mockResolvedValue([]);
  api.startBatch.mockResolvedValue("batch-9");
  api.finishBatch.mockResolvedValue(undefined);
});

async function chooseStock(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("radio", { name: /Stock \(conteo\)/ }));
}

describe("ImportPage: plantilla y archivo", () => {
  it("descarga la plantilla del tipo elegido, con sus columnas en español y separada por «;»", async () => {
    const user = userEvent.setup();
    mount();
    await chooseStock(user);
    await user.click(screen.getByRole("button", { name: "Descargar la plantilla" }));
    const [name, content] = vi.mocked(csv.downloadCsv).mock.calls[0] as [string, string];
    expect(name).toMatch(/^plantilla-stock-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(content).toContain("sku;stock");
    expect(content).toContain("BLU-001-ROJ-M;12");
  });

  it("explica cada columna y si es obligatoria", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByText("Columnas de la plantilla", { selector: "summary" }));
    const table = screen.getByRole("table", { name: "Columnas de la plantilla" });
    expect(within(table).getByText("sku")).toBeInTheDocument();
    expect(within(table).getAllByText("obligatoria").length).toBeGreaterThanOrEqual(3);
  });

  it("rechaza un .xlsx con instrucciones para guardarlo como CSV", async () => {
    const user = userEvent.setup();
    mount();
    await chooseStock(user);
    await user.upload(
      screen.getByLabelText(/Archivo CSV/),
      csvFile("sku,stock\nA,1\n", "inventario.xlsx"),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /archivo de Excel, no un CSV.*CSV UTF-8/,
    );
    expect(screen.queryByRole("button", { name: "Revisar el archivo" })).not.toBeInTheDocument();
  });

  it("dice qué columna obligatoria falta", async () => {
    const user = userEvent.setup();
    mount();
    await chooseStock(user);
    await user.upload(screen.getByLabelText(/Archivo CSV/), csvFile("sku,cantidad_total\nA,1\n"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Faltan columnas obligatorias: stock",
    );
  });

  it("lee el archivo, cuenta las filas y avisa de las columnas ignoradas", async () => {
    const user = userEvent.setup();
    mount();
    await chooseStock(user);
    await user.upload(
      screen.getByLabelText(/Archivo CSV/),
      csvFile("sku;stock;nota\nA-1;5;hola\nA-2;6;chao\n"),
    );
    expect(await screen.findByText("2 filas leídas de «conteo.csv».")).toBeInTheDocument();
    expect(screen.getByText(/Se ignoran estas columnas.*nota/)).toBeInTheDocument();
  });
});

describe("ImportPage: revisar y confirmar", () => {
  async function upload(user: ReturnType<typeof userEvent.setup>, content: string) {
    await chooseStock(user);
    await user.upload(screen.getByLabelText(/Archivo CSV/), csvFile(content));
    await screen.findByRole("button", { name: "Revisar el archivo" });
  }

  it("la revisión NO guarda nada: solo valida, y cuenta lo que pasaría con cada fila", async () => {
    const user = userEvent.setup();
    api.validateChunk.mockResolvedValue(
      results([
        { row: 2, sku: "A-1", action: "update" },
        { row: 3, sku: "A-2", action: "skip" },
        { row: 4, sku: "NOPE", action: "error", code: "sku_not_found" },
      ]),
    );
    mount();
    await upload(user, "sku,stock\nA-1,5\nA-2,6\nNOPE,1\n");
    await user.click(screen.getByRole("button", { name: "Revisar el archivo" }));
    const counts = await screen.findByTestId("import-counts");
    expect(within(counts).getByText("Se actualizarían").nextSibling).toHaveTextContent("1");
    expect(within(counts).getByText("Sin cambios").nextSibling).toHaveTextContent("1");
    expect(within(counts).getByText("Con error").nextSibling).toHaveTextContent("1");
    expect(api.startBatch).not.toHaveBeenCalled();
    expect(api.applyChunk).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Esto es lo que pasaría con las 3 filas del archivo. Todavía no se guardó nada.",
      ),
    ).toBeInTheDocument();
  });

  it("cada error se explica en palabras, con su fila y su clave, y se puede ver solo lo que falla", async () => {
    const user = userEvent.setup();
    api.validateChunk.mockResolvedValue(
      results([
        { row: 2, sku: "A-1", action: "update" },
        { row: 3, sku: "NOPE", action: "error", code: "sku_not_found" },
        { row: 4, sku: "B-2", action: "error", code: "below_reserved", field: "stock" },
      ]),
    );
    mount();
    await upload(user, "sku,stock\nA-1,5\nNOPE,1\nB-2,0\n");
    await user.click(screen.getByRole("button", { name: "Revisar el archivo" }));
    await screen.findByTestId("import-counts");
    await user.click(screen.getByRole("button", { name: "Ver solo las filas con error" }));
    const table = screen.getByRole("table", { name: "3. Revisa antes de guardar" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText("No hay ninguna variante con ese SKU.")).toBeInTheDocument();
    expect(
      within(table).getByText("El stock no puede ser menor que lo reservado por pedidos."),
    ).toBeInTheDocument();
    expect(within(table).queryByText("A-1")).not.toBeInTheDocument();
  });

  it("lo que el navegador descarta (SKU repetido, fórmula) se informa sin mandarlo a la base", async () => {
    const user = userEvent.setup();
    api.validateChunk.mockImplementation(async (_k, rows) =>
      rows.map((r) => ({
        row: r.row,
        action: "update" as const,
        key: r.values.sku ?? null,
        errors: [],
      })),
    );
    mount();
    await upload(user, "sku,stock\nA-1,5\na-1,6\nB-2,=SUMA(A1)\n");
    await user.click(screen.getByRole("button", { name: "Revisar el archivo" }));
    await screen.findByTestId("import-counts");
    expect((api.validateChunk.mock.calls[0]?.[1] ?? []).map((r) => r.row)).toEqual([2]);
    await user.click(screen.getByRole("button", { name: "Ver solo las filas con error" }));
    expect(screen.getByText("«SKU» está repetido en el archivo.")).toBeInTheDocument();
    expect(screen.getByText(/«Stock» empieza con «=»/)).toBeInTheDocument();
  });

  it("el botón de importar cuenta TAMBIÉN las filas sin cambios (se importan, simplemente no cambian nada)", async () => {
    const user = userEvent.setup();
    api.validateChunk.mockResolvedValue(
      results([
        { row: 2, sku: "A-1", action: "update" },
        { row: 3, sku: "A-2", action: "skip" },
        { row: 4, sku: "A-3", action: "create" },
      ]),
    );
    mount();
    await upload(user, "sku,stock\nA-1,5\nA-2,6\nA-3,7\n");
    await user.click(screen.getByRole("button", { name: "Revisar el archivo" }));
    expect(await screen.findByRole("button", { name: "Importar 3 filas" })).toBeInTheDocument();
  });

  it("confirmar abre un lote, aplica y dice cómo terminó; las filas con error se omiten y se avisa", async () => {
    const user = userEvent.setup();
    api.validateChunk.mockResolvedValue(
      results([
        { row: 2, sku: "A-1", action: "update" },
        { row: 3, sku: "NOPE", action: "error", code: "sku_not_found" },
      ]),
    );
    api.applyChunk.mockResolvedValue(results([{ row: 2, sku: "A-1", action: "update" }]));
    mount();
    await upload(user, "sku,stock\nA-1,5\nNOPE,1\n");
    await user.click(screen.getByRole("button", { name: "Revisar el archivo" }));
    expect(
      await screen.findByText(
        "Las 1 filas con error NO se importan (quedan en el informe para que las corrijas).",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Importar 1 filas" }));
    expect(
      await screen.findByText("Listo: 0 creadas, 1 actualizadas, 0 sin cambios y 1 con error."),
    ).toBeInTheDocument();
    // solo viaja la fila que la revisión dejó pasar (la de SKU inexistente ya se sabe que falla)
    expect(api.startBatch).toHaveBeenCalledWith("stock", "conteo.csv", 1);
    expect(api.applyChunk).toHaveBeenCalledWith("batch-9", expect.any(Array));
    expect(api.finishBatch).toHaveBeenCalledWith("batch-9");
  });

  it("si la importación se corta, lo dice y recuerda que lo aplicado se puede revertir", async () => {
    const user = userEvent.setup();
    api.validateChunk.mockResolvedValue(results([{ row: 2, sku: "A-1", action: "update" }]));
    api.applyChunk.mockRejectedValue(new Error("red"));
    mount();
    await upload(user, "sku,stock\nA-1,5\n");
    await user.click(screen.getByRole("button", { name: "Revisar el archivo" }));
    await user.click(await screen.findByRole("button", { name: "Importar 1 filas" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Se cortó la importación.*se puede revertir/,
    );
    expect(api.finishBatch).not.toHaveBeenCalled();
  });

  it("si la revisión falla, lo dice y deja reintentar", async () => {
    const user = userEvent.setup();
    api.validateChunk.mockRejectedValueOnce(new Error("timeout"));
    mount();
    await upload(user, "sku,stock\nA-1,5\n");
    await user.click(screen.getByRole("button", { name: "Revisar el archivo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo revisar el archivo. Intenta de nuevo.",
    );
    expect(screen.getByRole("button", { name: "Revisar el archivo" })).toBeInTheDocument();
  });

  it("descarga el informe con todas las filas", async () => {
    const user = userEvent.setup();
    api.validateChunk.mockResolvedValue(
      results([
        { row: 2, sku: "A-1", action: "update" },
        { row: 3, sku: "NOPE", action: "error", code: "sku_not_found" },
      ]),
    );
    mount();
    await upload(user, "sku,stock\nA-1,5\nNOPE,1\n");
    await user.click(screen.getByRole("button", { name: "Revisar el archivo" }));
    await screen.findByTestId("import-counts");
    await user.click(screen.getByRole("button", { name: "Descargar el informe (CSV)" }));
    const content = (vi.mocked(csv.downloadCsv).mock.calls[0] as [string, string])[1];
    expect(content).toContain("Fila;Clave;Qué pasa;Detalle");
    expect(content).toContain("2;A-1;Se actualiza;");
    expect(content).toContain("3;NOPE;Error;No hay ninguna variante con ese SKU.");
  });
});

describe("ImportPage: cargas anteriores", () => {
  it("lista las cargas con su resultado y estado, y revierte con confirmación", async () => {
    const user = userEvent.setup();
    api.listBatches.mockResolvedValue([batch()]);
    api.rollbackBatch.mockResolvedValue({ reverted: 2, total: 2, conflicts: [] });
    mount();
    const table = await screen.findByRole("table", { name: "Cargas anteriores" });
    expect(within(table).getByText("conteo.csv")).toBeInTheDocument();
    expect(
      within(table).getByText("0 creadas · 2 actualizadas · 1 sin cambios · 0 con error"),
    ).toBeInTheDocument();
    expect(within(table).getByText("Terminada")).toBeInTheDocument();
    await user.click(within(table).getByRole("button", { name: /Revertir: conteo.csv/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Lo que la carga creó se archiva");
    expect(api.rollbackBatch).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Sí, revertir" }));
    await waitFor(() => expect(api.rollbackBatch).toHaveBeenCalledWith("b1"));
    expect(await screen.findByText("Revertido: 2 de 2 cambios.")).toBeInTheDocument();
  });

  it("un conflicto al revertir se cuenta con su motivo (no se pisa lo que cambió después)", async () => {
    const user = userEvent.setup();
    api.listBatches.mockResolvedValue([batch({ status: "applying" })]);
    api.rollbackBatch.mockResolvedValue({
      reverted: 1,
      total: 2,
      conflicts: [{ row: 2, entity: "stock", key: "A-1", reason: "stock_changed" }],
    });
    mount();
    await user.click(await screen.findByRole("button", { name: /Revertir/ }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Sí, revertir" }),
    );
    expect(await screen.findByText("Revertido: 1 de 2 cambios.")).toBeInTheDocument();
    expect(
      screen.getByText("Fila 2 (A-1): el stock cambió después de la carga"),
    ).toBeInTheDocument();
  });

  it("una carga ya revertida no ofrece revertir otra vez", async () => {
    api.listBatches.mockResolvedValue([batch({ status: "rolled_back" })]);
    mount();
    const table = await screen.findByRole("table", { name: "Cargas anteriores" });
    expect(within(table).queryByRole("button", { name: /Revertir/ })).not.toBeInTheDocument();
    expect(within(table).getByText("Revertida")).toBeInTheDocument();
  });

  it("sin cargas lo dice", async () => {
    mount();
    expect(await screen.findByText("Todavía no hiciste ninguna importación.")).toBeInTheDocument();
  });

  it("si falla al revertir, lo dice", async () => {
    const user = userEvent.setup();
    api.listBatches.mockResolvedValue([batch()]);
    api.rollbackBatch.mockRejectedValue(new Error("x"));
    mount();
    await user.click(await screen.findByRole("button", { name: /Revertir/ }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Sí, revertir" }),
    );
    expect(await screen.findByText("No se pudo revertir.")).toBeInTheDocument();
  });
});
