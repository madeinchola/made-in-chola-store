import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as csv from "@/lib/csv";
import * as reportsApi from "./reportsApi";
import { ReportPage } from "./ReportPage";
import type { ReportId, ReportRow } from "./reportTypes";

vi.mock("./reportsApi", () => ({ fetchReportPage: vi.fn() }));
vi.mock("@/lib/csv", async (original) => ({
  ...(await original<typeof csv>()),
  downloadCsv: vi.fn(),
}));
vi.mock("../config/hooks", () => ({
  useCurrencies: () => ({ data: [{ code: "BOB" }, { code: "USD" }] }),
}));
const api = vi.mocked(reportsApi);

function mount(
  id: ReportId,
  initial = "/admin/reportes?p=custom&desde=2020-03-01&hasta=2020-03-07",
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <ReportPage id={id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sale = (n: number, over: Partial<ReportRow> = {}): ReportRow => ({
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

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchReportPage.mockResolvedValue({ rows: [sale(4), sale(3, { margin: null })], total: 2 });
});

describe("ReportPage: ventas", () => {
  it("muestra una fila por pedido con importes, fechas de La Paz y el margen desconocido como «—»", async () => {
    mount("ventas");
    const table = await screen.findByRole("table", { name: "Ventas" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText("MIC-914004")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("2020-03-05 18:00")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Completado")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("QR (comprobante)")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Bs 155,00")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Bs 65,00")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("—")).toBeInTheDocument();
    expect(screen.getByText("2 resultados")).toBeInTheDocument();
  });

  it("pide la primera página de 50 con el período y la moneda del filtro", async () => {
    mount("ventas");
    await screen.findByRole("table", { name: "Ventas" });
    expect(api.fetchReportPage).toHaveBeenCalledWith("ventas", {
      from: "2020-03-01",
      to: "2020-03-07",
      currency: "BOB",
      offset: 0,
      limit: 50,
    });
  });

  it("la paginación pide la siguiente página al servidor", async () => {
    const user = userEvent.setup();
    api.fetchReportPage.mockResolvedValue({ rows: [sale(1)], total: 120 });
    mount("ventas");
    await screen.findByText("120 resultados");
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() =>
      expect(api.fetchReportPage).toHaveBeenLastCalledWith(
        "ventas",
        expect.objectContaining({ offset: 50 }),
      ),
    );
    expect(await screen.findByText("Página 2 de 3")).toBeInTheDocument();
  });

  it("cambiar la moneda vuelve a la primera página y pide la otra moneda", async () => {
    const user = userEvent.setup();
    api.fetchReportPage.mockResolvedValue({ rows: [sale(1)], total: 120 });
    mount("ventas", "/admin/reportes?p=custom&desde=2020-03-01&hasta=2020-03-07&pagina=3");
    await screen.findByText("Página 3 de 3");
    await user.selectOptions(screen.getByRole("combobox", { name: "Moneda" }), "USD");
    await waitFor(() =>
      expect(api.fetchReportPage).toHaveBeenLastCalledWith(
        "ventas",
        expect.objectContaining({ currency: "USD", offset: 0 }),
      ),
    );
  });

  it("sin filas lo dice (no una tabla vacía) y no deja descargar", async () => {
    api.fetchReportPage.mockResolvedValue({ rows: [], total: 0 });
    mount("ventas");
    expect(await screen.findByText("No hay nada que mostrar con este filtro.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descargar CSV" })).toBeDisabled();
  });

  it("si falla, lo dice y deja reintentar", async () => {
    const user = userEvent.setup();
    api.fetchReportPage.mockRejectedValueOnce(new Error("boom"));
    mount("ventas");
    await user.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("table", { name: "Ventas" })).toBeInTheDocument();
  });

  it("un período a medida inválido se explica y no se pide nada", async () => {
    mount("ventas", "/admin/reportes?p=custom&desde=2020-03-08&hasta=2020-03-01");
    expect(
      await screen.findByText("«Desde» no puede ser posterior a «Hasta».", { selector: "div p" }),
    ).toBeInTheDocument();
    expect(api.fetchReportPage).not.toHaveBeenCalled();
  });
});

describe("ReportPage: otros reportes", () => {
  it("el inventario no depende del período ni de la moneda: no muestra esos filtros", async () => {
    api.fetchReportPage.mockResolvedValue({
      rows: [
        {
          id: "v1",
          product: "Blusa",
          code: "BL-1",
          sku: "BL-1-R-M",
          color: "Rojo",
          size: "M",
          productStatus: "active",
          onHand: 20,
          reserved: 0,
          available: 20,
          light: "ok",
          cost: 60,
          value: 1200,
        },
        {
          id: "v2",
          product: "Falda",
          code: "FA-2",
          sku: null,
          color: "Azul",
          size: null,
          productStatus: "active",
          onHand: 8,
          reserved: 1,
          available: 7,
          light: "low",
          cost: null,
          value: null,
        },
      ],
      total: 2,
    });
    mount("inventario", "/admin/reportes/inventario");
    const table = await screen.findByRole("table", { name: "Inventario" });
    expect(screen.queryByRole("group", { name: "Período" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Moneda" })).not.toBeInTheDocument();
    expect(within(table).getByText("Bs 1.200,00")).toBeInTheDocument();
    expect(within(table).getByText("Bajo")).toBeInTheDocument();
    // la variante sin costo no inventa un valor: «—»
    expect(
      within(within(table).getAllByRole("row")[2]!).getAllByText("—").length,
    ).toBeGreaterThanOrEqual(3);
    expect(api.fetchReportPage).toHaveBeenCalledWith(
      "inventario",
      expect.objectContaining({ from: expect.any(String), currency: null }),
    );
  });

  it("clientas muestra el resumen de nuevas y recurrentes", async () => {
    api.fetchReportPage.mockResolvedValue({
      rows: [
        {
          id: "p1",
          name: "Clienta Uno",
          email: "uno@correo.test",
          currency: "BOB",
          orders: 3,
          net: 449.99,
          firstSale: "2020-02-27T16:00:00+00:00",
          segment: "recurring",
        },
      ],
      total: 1,
      summary: { customers: 2, new_customers: 1, recurring_customers: 1, new_accounts: 1 },
    });
    mount("clientas");
    expect(await screen.findByTestId("report-summary")).toHaveTextContent(
      "2 clientas compraron: 1 nuevas y 1 recurrentes. 1 cuentas se crearon en el período.",
    );
    expect(screen.getByText("Recurrente")).toBeInTheDocument();
    expect(screen.getByText("2020-02-27")).toBeInTheDocument();
  });

  it("devoluciones: el importe de cada fila va en su moneda y lo que no aplica es «—»", async () => {
    api.fetchReportPage.mockResolvedValue({
      rows: [
        {
          createdAt: "2020-03-06T16:00:00+00:00",
          kind: "refund",
          orderNumber: "MIC-914006",
          status: "processed",
          currency: "BOB",
          amount: 115,
          shippingAmount: 15,
          deduction: 0,
          method: "cash",
          reason: "cancelado",
        },
        {
          createdAt: "2020-03-06T14:00:00+00:00",
          kind: "return",
          orderNumber: "MIC-914004",
          status: "open",
          currency: "BOB",
          amount: null,
          shippingAmount: null,
          deduction: null,
          method: null,
          reason: "la talla no era",
        },
      ],
      total: 2,
    });
    mount(
      "devoluciones",
      "/admin/reportes/devoluciones?p=custom&desde=2020-03-01&hasta=2020-03-07",
    );
    const table = await screen.findByRole("table", { name: "Devoluciones" });
    expect(within(table).getByText("Reembolso")).toBeInTheDocument();
    expect(within(table).getByText("Devolución")).toBeInTheDocument();
    expect(within(table).getByText("Bs 115,00")).toBeInTheDocument();
    expect(within(table).getByText("Efectivo")).toBeInTheDocument();
  });
});

describe("ReportPage: descarga", () => {
  it("descarga el reporte completo del filtro con el formato elegido y avisa cómo terminó", async () => {
    const user = userEvent.setup();
    mount("ventas");
    await screen.findByRole("table", { name: "Ventas" });
    api.fetchReportPage.mockClear();
    await user.click(screen.getByRole("button", { name: "Descargar CSV" }));
    expect(await screen.findByText("Archivo descargado: 2 filas.")).toBeInTheDocument();
    expect(api.fetchReportPage).toHaveBeenCalledWith(
      "ventas",
      expect.objectContaining({ offset: 0, limit: 2000, currency: "BOB" }),
    );
    const download = vi.mocked(csv.downloadCsv);
    expect(download).toHaveBeenCalledTimes(1);
    const [name, content] = download.mock.calls[0] as [string, string];
    expect(name).toMatch(/^reporte-ventas-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(content).toContain("Pedido;Fecha de venta;Estado");
    expect(content).toContain(
      "MIC-914004;2020-03-05 18:00;Completado;QR (comprobante);Tienda web;Clienta 4;4;155,00;20,00;15,00;30,00;125,00;65,00",
    );
  });

  it("con el formato estándar usa coma y punto decimal", async () => {
    const user = userEvent.setup();
    mount("ventas");
    await screen.findByRole("table", { name: "Ventas" });
    await user.selectOptions(screen.getByLabelText("Formato de números"), "standard");
    await user.click(screen.getByRole("button", { name: "Descargar CSV" }));
    await screen.findByText("Archivo descargado: 2 filas.");
    const content = (vi.mocked(csv.downloadCsv).mock.calls[0] as [string, string])[1];
    expect(content).toContain("Pedido,Fecha de venta,Estado");
    expect(content).toContain("155.00,20.00,15.00,30.00,125.00,65.00");
  });

  it("si la descarga falla, lo dice y no guarda nada", async () => {
    const user = userEvent.setup();
    mount("ventas");
    await screen.findByRole("table", { name: "Ventas" });
    api.fetchReportPage.mockRejectedValue(new Error("timeout"));
    await user.click(screen.getByRole("button", { name: "Descargar CSV" }));
    expect(
      await screen.findByText("No se pudo preparar el archivo. Intenta de nuevo."),
    ).toBeInTheDocument();
    expect(csv.downloadCsv).not.toHaveBeenCalled();
  });
});
