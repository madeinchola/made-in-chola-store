import { describe, expect, it, vi } from "vitest";
import { EXPORT_PAGE, MAX_EXPORT_ROWS, buildCsvRows, exportReport } from "./exportReport";
import { reportById } from "./reports";
import type { ReportPageArgs, ReportPageResult, ReportRow } from "./reportTypes";

const BOM = "﻿";
const filters = { from: "2020-03-01", to: "2020-03-07", currency: "BOB" };

const saleRow = (n: number, over: Partial<ReportRow> = {}): ReportRow => ({
  id: `o${n}`,
  number: `MIC-9140${String(n).padStart(2, "0")}`,
  soldAt: "2020-03-05T22:00:00+00:00",
  status: "completed",
  payment: "qr_manual",
  channel: "web",
  customer: `Clienta ${n}`,
  currency: "BOB",
  units: 4,
  gross: 155,
  discount: 20,
  shipping: 15,
  refunded: 30,
  net: 125,
  margin: 65,
  ...over,
});

function pager(total: number, make: (n: number) => ReportRow = saleRow) {
  const calls: ReportPageArgs[] = [];
  const fetchPage = vi.fn(async (_id: string, args: ReportPageArgs): Promise<ReportPageResult> => {
    calls.push(args);
    const rows: ReportRow[] = [];
    for (let i = args.offset; i < Math.min(total, args.offset + args.limit); i++)
      rows.push(make(i + 1));
    return { rows, total };
  });
  return { fetchPage, calls };
}

describe("buildCsvRows", () => {
  it("el encabezado va en español y cada celda con el formato de su columna", () => {
    const rows = buildCsvRows(reportById("ventas"), [saleRow(4)], "BOB", "excel");
    expect(rows[0]).toEqual([
      "Pedido",
      "Fecha de venta",
      "Estado",
      "Pago",
      "Canal",
      "Clienta",
      "Unidades",
      "Ventas brutas",
      "Descuentos",
      "Envío cobrado",
      "Reembolsado",
      "Ventas netas",
      "Margen",
    ]);
    expect(rows[1]).toEqual([
      "MIC-914004",
      "2020-03-05 18:00",
      "Completado",
      "QR (comprobante)",
      "Tienda web",
      "Clienta 4",
      "4",
      "155,00",
      "20,00",
      "15,00",
      "30,00",
      "125,00",
      "65,00",
    ]);
  });
  it("el margen desconocido queda como celda vacía, no como cero", () => {
    expect(
      buildCsvRows(reportById("ventas"), [saleRow(3, { margin: null })], "BOB", "excel")[1]?.[12],
    ).toBe("");
  });
  it("cada fila usa la moneda de SU renglón (descuentos, pagos, devoluciones)", () => {
    const rows = buildCsvRows(
      reportById("pagos"),
      [
        {
          id: "p1",
          createdAt: "2020-03-04T15:00:00+00:00",
          orderNumber: "MIC-914010",
          provider: "whatsapp",
          method: "whatsapp",
          status: "paid",
          currency: "CLP",
          amount: 1000,
          received: null,
          paidAt: null,
        },
      ],
      "BOB",
      "standard",
    );
    expect(rows[1]?.[5]).toBe("1000");
  });
});

describe("exportReport", () => {
  it("pide el reporte COMPLETO por páginas (no solo lo que se ve) y descarga un solo archivo", async () => {
    const { fetchPage, calls } = pager(EXPORT_PAGE * 2 + 5);
    const download = vi.fn();
    const progress: number[] = [];
    const outcome = await exportReport(
      {
        report: reportById("ventas"),
        filters,
        currency: "BOB",
        format: "excel",
        onProgress: (p) => progress.push(p.done),
      },
      { fetchPage, download, now: new Date("2026-11-16T15:00:00Z") },
    );
    expect(outcome).toEqual({ status: "done", rows: EXPORT_PAGE * 2 + 5, truncated: false });
    expect(calls.map((c) => c.offset)).toEqual([0, EXPORT_PAGE, EXPORT_PAGE * 2]);
    expect(calls.every((c) => c.limit === EXPORT_PAGE && c.currency === "BOB")).toBe(true);
    expect(progress).toEqual([EXPORT_PAGE, EXPORT_PAGE * 2, EXPORT_PAGE * 2 + 5]);
    expect(download).toHaveBeenCalledTimes(1);
    const [name, csv] = download.mock.calls[0] as [string, string];
    expect(name).toBe("reporte-ventas-2026-11-16.csv");
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.split("\r\n").length).toBe(EXPORT_PAGE * 2 + 5 + 2); // encabezado + filas + el cierre vacío
  });

  it("con «Excel en español» separa con punto y coma; con «estándar», con coma", async () => {
    const one = pager(1);
    const excel = vi.fn();
    await exportReport(
      { report: reportById("ventas"), filters, currency: "BOB", format: "excel" },
      { fetchPage: one.fetchPage, download: excel },
    );
    expect((excel.mock.calls[0] as [string, string])[1].split("\r\n")[1]).toContain(";");
    const standard = vi.fn();
    await exportReport(
      { report: reportById("ventas"), filters, currency: "BOB", format: "standard" },
      { fetchPage: one.fetchPage, download: standard },
    );
    const line = (standard.mock.calls[0] as [string, string])[1].split("\r\n")[1] ?? "";
    expect(line).toContain("155.00");
    expect(line).not.toContain(";");
  });

  it("neutraliza una fórmula escrita en el nombre de una clienta (inyección de fórmulas)", async () => {
    const { fetchPage } = pager(1, (n) => saleRow(n, { customer: '=HYPERLINK("http://malo")' }));
    const download = vi.fn();
    await exportReport(
      { report: reportById("ventas"), filters, currency: "BOB", format: "excel" },
      { fetchPage, download },
    );
    const csv = (download.mock.calls[0] as [string, string])[1];
    expect(csv).toContain('"\'=HYPERLINK(""http://malo"")"');
    expect(csv).not.toMatch(/;=HYPERLINK/);
  });

  it("un nombre con comillas, punto y coma o saltos de línea no rompe el archivo", async () => {
    const { fetchPage } = pager(1, (n) => saleRow(n, { customer: 'Ana "la Chola"; Pérez\ny Ñ' }));
    const download = vi.fn();
    await exportReport(
      { report: reportById("ventas"), filters, currency: "BOB", format: "excel" },
      { fetchPage, download },
    );
    expect((download.mock.calls[0] as [string, string])[1]).toContain(
      '"Ana ""la Chola""; Pérez\ny Ñ"',
    );
  });

  it("sin filas no descarga un archivo vacío", async () => {
    const { fetchPage } = pager(0);
    const download = vi.fn();
    expect(
      await exportReport(
        { report: reportById("ventas"), filters, currency: "BOB", format: "excel" },
        { fetchPage, download },
      ),
    ).toEqual({ status: "empty" });
    expect(download).not.toHaveBeenCalled();
  });

  it("cancelar a mitad no guarda NADA", async () => {
    const { fetchPage } = pager(EXPORT_PAGE * 3);
    const download = vi.fn();
    let pages = 0;
    const outcome = await exportReport(
      {
        report: reportById("ventas"),
        filters,
        currency: "BOB",
        format: "excel",
        onProgress: () => (pages += 1),
        shouldCancel: () => pages >= 1,
      },
      { fetchPage, download },
    );
    expect(outcome).toEqual({ status: "cancelled" });
    expect(download).not.toHaveBeenCalled();
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("más de 50 000 filas: el archivo trae las primeras 50 000 y lo dice (no se cuelga)", async () => {
    const big = MAX_EXPORT_ROWS + 3000;
    const { fetchPage } = pager(big, (n) => saleRow(n, { customer: "x" }));
    const download = vi.fn();
    const outcome = await exportReport(
      { report: reportById("ventas"), filters, currency: "BOB", format: "standard" },
      { fetchPage, download },
    );
    expect(outcome).toEqual({ status: "done", rows: MAX_EXPORT_ROWS, truncated: true });
    expect((download.mock.calls[0] as [string, string])[1].split("\r\n").length).toBe(
      MAX_EXPORT_ROWS + 2,
    );
  });

  it("si una página falla, el error sube (no se descarga un archivo a medias)", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        rows: Array.from({ length: EXPORT_PAGE }, (_, i) => saleRow(i + 1)),
        total: EXPORT_PAGE * 2,
      })
      .mockRejectedValueOnce(new Error("timeout"));
    const download = vi.fn();
    await expect(
      exportReport(
        { report: reportById("ventas"), filters, currency: "BOB", format: "excel" },
        { fetchPage, download },
      ),
    ).rejects.toThrow("timeout");
    expect(download).not.toHaveBeenCalled();
  });
});
