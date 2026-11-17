import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as apiModule from "./api";
import { SalesSection } from "./SalesSection";
import type { Kpis, SalesSummary } from "./types";

vi.mock("./api", () => ({
  fetchSalesSummary: vi.fn(),
  fetchTopProducts: vi.fn(),
  fetchBreakdown: vi.fn(),
  fetchPaymentMix: vi.fn(),
  fetchFunnel: vi.fn(),
  fetchInventorySummary: vi.fn(),
  fetchSlowMovers: vi.fn(),
  fetchCoverage: vi.fn(),
}));
const api = vi.mocked(apiModule);

function mount(initial = "/admin") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <SalesSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Las cifras del dataset de pgTAP (1–7 de marzo de 2020), calculadas a mano.
const bob: Kpis = {
  orders: 5,
  units: 14,
  gross: 814.99,
  discounts: 30,
  shipping: 45,
  refunds: 40,
  net: 774.99,
  avg_ticket: 154.998,
  product_revenue: 729.99,
  margin_revenue: 529.99,
  margin: 259.99,
  margin_pct: 49.1,
  costed_orders: 4,
  cost_coverage_pct: 80,
  incident_cost: 12,
  profit: 247.99,
};

const summary = (over: Partial<SalesSummary> = {}): SalesSummary => ({
  range: { from: "2020-03-01", to: "2020-03-07", days: 7, timezone: "America/La_Paz" },
  previous: { from: "2020-02-23", to: "2020-02-29" },
  granularity: "day",
  currencies: [
    {
      currency: "BOB",
      current: bob,
      previous: { ...bob, orders: 1, net: 100, gross: 100, margin: 40, profit: null },
      series: [
        { bucket: "2020-03-01", orders: 0, gross: 0, net: 0, margin: null },
        { bucket: "2020-03-02", orders: 2, gross: 344.99, net: 344.99, margin: 164.99 },
      ],
    },
  ],
  consolidated: {
    currency: "BOB",
    current: { orders: 5, gross: 814.99, net: 774.99 },
    previous: { orders: 1, gross: 100, net: 100 },
  },
  other: { cancelled: 2, refunded_full: 1, pending: 1 },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchSalesSummary.mockResolvedValue(summary());
  api.fetchTopProducts.mockResolvedValue([
    {
      productId: "p1",
      name: "Blusa Rojo",
      code: "BL-1",
      archived: false,
      units: 4,
      revenue: 390,
      orders: 3,
      currency: "BOB",
    },
    {
      productId: "p2",
      name: "Falda vieja",
      code: "FA-2",
      archived: true,
      units: 4,
      revenue: 145,
      orders: 2,
      currency: "BOB",
    },
  ]);
  api.fetchPaymentMix.mockResolvedValue([
    { currency: "BOB", paymentMethod: "whatsapp", orders: 2, gross: 445, net: 445 },
    { currency: "BOB", paymentMethod: "qr_manual", orders: 2, gross: 270, net: 230 },
    { currency: "USD", paymentMethod: "whatsapp", orders: 1, gross: 25, net: 25 },
  ]);
  api.fetchFunnel.mockResolvedValue({ carts: 3, carts_with_items: 2, orders: 10, paid: 6 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SalesSection: las cifras del período", () => {
  it("muestra los indicadores con el formato de la tienda y su cambio contra el período anterior", async () => {
    mount();
    const kpis = await screen.findByTestId("kpis");
    expect(within(kpis).getByText("Bs 774,99")).toBeInTheDocument();
    // neto 774,99 contra 100 = +675,0 %
    expect(
      within(kpis).getAllByText(/\+675,0 % frente al período anterior/).length,
    ).toBeGreaterThan(0);
    expect(within(kpis).getByText("Bs 814,99")).toBeInTheDocument();
    expect(within(kpis).getByText("Bs 259,99")).toBeInTheDocument();
    expect(within(kpis).getByText(/49,1 % de las ventas con costo/)).toBeInTheDocument();
    expect(within(kpis).getByText("Bs 247,99")).toBeInTheDocument();
    expect(within(kpis).getByText(/Margen menos Bs 12,00 de incidencias/)).toBeInTheDocument();
  });

  it("avisa que el margen cubre solo una parte cuando a algunos pedidos les falta el costo (nunca un 100 % falso)", async () => {
    mount();
    expect(await screen.findByText(/Solo 4 de 5 pedidos tienen costo/)).toBeInTheDocument();
  });

  it("si ningún pedido tiene costo, el margen y la utilidad son «Desconocido», no cero", async () => {
    api.fetchSalesSummary.mockResolvedValue(
      summary({
        currencies: [
          {
            currency: "BOB",
            current: {
              ...bob,
              costed_orders: 0,
              margin: null,
              margin_pct: null,
              margin_revenue: null,
              profit: null,
              cost_coverage_pct: 0,
            },
            previous: {},
            series: [],
          },
        ],
      }),
    );
    mount();
    const kpis = await screen.findByTestId("kpis");
    expect(within(kpis).getByText("Desconocido")).toBeInTheDocument();
    expect(within(kpis).getByText("Desconocida")).toBeInTheDocument();
    expect(within(kpis).getAllByText("Sin datos del período anterior").length).toBeGreaterThan(0);
  });

  it("explica el período y con qué se compara", async () => {
    mount();
    expect(await screen.findByTestId("range-summary")).toHaveTextContent(
      /1 mar 2020.*7 mar 2020.*7 días.*23 feb 2020.*29 feb 2020/,
    );
  });

  it("la serie trae su tabla de datos (el gráfico no es la única forma de leerla)", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("kpis");
    await user.click(screen.getByText("Ver los datos del gráfico"));
    const table = screen.getByRole("table", { name: "Ventas en el tiempo" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText("Bs 344,99")).toBeInTheDocument();
    expect(within(table).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("lo más vendido se puede ordenar por ingresos o por unidades", async () => {
    const user = userEvent.setup();
    mount();
    const top = await screen.findByRole("region", { name: "Lo más vendido" });
    expect(await within(top).findByText("Blusa Rojo")).toBeInTheDocument();
    expect(within(top).getByText("Falda vieja (archivado)")).toBeInTheDocument();
    expect(api.fetchTopProducts).toHaveBeenLastCalledWith(
      expect.anything(),
      "BOB",
      "revenue",
      "desc",
      5,
    );
    await user.click(within(top).getByRole("button", { name: "Por unidades" }));
    await waitFor(() =>
      expect(api.fetchTopProducts).toHaveBeenLastCalledWith(
        expect.anything(),
        "BOB",
        "units",
        "desc",
        5,
      ),
    );
  });

  it("la mezcla de pagos solo cuenta la moneda elegida y dice el porcentaje en texto", async () => {
    mount();
    const card = await screen.findByRole("region", { name: "Cómo pagan" });
    expect(await within(card).findByText("WhatsApp")).toBeInTheDocument();
    expect(within(card).getByText("QR (comprobante)")).toBeInTheDocument();
    // 445 de 675 = 65,9 %; el USD no entra
    expect(within(card).getByText(/65,9 %/)).toBeInTheDocument();
    expect(within(card).queryByText(/Bs 25,00/)).not.toBeInTheDocument();
  });

  it("el embudo dice cuántos pasan de un paso al siguiente", async () => {
    mount();
    const card = await screen.findByRole("region", { name: "Del carrito al pago" });
    expect(await within(card).findByText("Carritos creados")).toBeInTheDocument();
    expect(within(card).getByText(/66,7 % del paso anterior/)).toBeInTheDocument();
  });

  it("lo que no es venta se cuenta aparte", async () => {
    mount();
    const card = await screen.findByRole("region", { name: "Lo que no es venta" });
    expect(within(card).getByText("Cancelados").nextSibling).toHaveTextContent("2");
    expect(within(card).getByText("Reembolsados por completo").nextSibling).toHaveTextContent("1");
  });
});

describe("SalesSection: varias monedas", () => {
  it("nunca las suma: hay un selector, un resumen aparte y el margen en otra moneda es desconocido", async () => {
    const user = userEvent.setup();
    api.fetchSalesSummary.mockResolvedValue(
      summary({
        currencies: [
          ...summary().currencies,
          {
            currency: "USD",
            current: {
              ...bob,
              orders: 1,
              units: 1,
              gross: 25,
              net: 25,
              avg_ticket: 25,
              margin: null,
              margin_pct: null,
              margin_revenue: null,
              costed_orders: 0,
              profit: null,
              discounts: 0,
              refunds: 0,
              incident_cost: 0,
            },
            previous: {},
            series: [],
          },
        ],
        consolidated: {
          currency: "BOB",
          current: { orders: 6, gross: 1014.99, net: 974.99 },
          previous: { orders: 1, gross: 100, net: 100 },
        },
      }),
    );
    mount();
    expect(await screen.findByText(/Todas las monedas, en BOB/)).toBeInTheDocument();
    expect(screen.getByText(/Bs 974,99 netos en 6 pedidos/)).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Moneda" }), "USD");
    const kpis = screen.getByTestId("kpis");
    // 25 USD de neto, bruto y ticket: la moneda elegida manda y los Bs ya no aparecen
    expect(within(kpis).getAllByText("$ 25,00")).toHaveLength(3);
    expect(within(kpis).queryByText("Bs 774,99")).not.toBeInTheDocument();
    expect(within(kpis).getByText("Desconocido")).toBeInTheDocument();
  });
});

describe("SalesSection: sin ventas, con error y con períodos a medida", () => {
  it("sin ventas explica por qué y cuenta lo que no es venta", async () => {
    api.fetchSalesSummary.mockResolvedValue(summary({ currencies: [] }));
    mount();
    expect(await screen.findByText("Todavía no hay ventas en este período")).toBeInTheDocument();
    expect(
      screen.getByText(/2 cancelados, 1 pendientes de pago y 1 reembolsados por completo/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("kpis")).not.toBeInTheDocument();
  });

  it("si falla, lo dice y deja reintentar", async () => {
    const user = userEvent.setup();
    api.fetchSalesSummary.mockRejectedValueOnce(new Error("boom"));
    mount();
    expect(
      await screen.findByText("No se pudieron cargar las cifras de ventas."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByTestId("kpis")).toBeInTheDocument();
  });

  it("«Hoy» pide solo el día de hoy en La Paz (no el del reloj UTC)", async () => {
    const user = userEvent.setup();
    // 02:00 UTC del 16 de noviembre = 22:00 del 15 en La Paz
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T02:00:00Z"));
    mount();
    await screen.findByTestId("kpis");
    await user.click(screen.getByRole("button", { name: "Hoy" }));
    await waitFor(() =>
      expect(api.fetchSalesSummary).toHaveBeenLastCalledWith(
        { from: "2026-11-15", to: "2026-11-15" },
        "day",
      ),
    );
  });

  it("por omisión son los últimos 30 días y la semana o el mes se eligen solos en períodos largos", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T15:00:00Z"));
    mount();
    await screen.findByTestId("kpis");
    expect(api.fetchSalesSummary).toHaveBeenCalledWith(
      { from: "2026-10-18", to: "2026-11-16" },
      "day",
    );
  });

  it("un período a medida inválido se señala y NO se pide a la base", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("kpis");
    api.fetchSalesSummary.mockClear();
    await user.click(screen.getByRole("button", { name: "Otro período" }));
    await user.clear(screen.getByLabelText("Desde"));
    await user.type(screen.getByLabelText("Desde"), "2020-03-08");
    await user.clear(screen.getByLabelText("Hasta"));
    await user.type(screen.getByLabelText("Hasta"), "2020-03-01");
    await user.click(screen.getByRole("button", { name: "Ver" }));
    expect(
      await screen.findByText("«Desde» no puede ser posterior a «Hasta»."),
    ).toBeInTheDocument();
    expect(api.fetchSalesSummary).not.toHaveBeenCalled();
  });

  it("un período a medida válido se pide y queda en la dirección", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("kpis");
    await user.click(screen.getByRole("button", { name: "Otro período" }));
    await user.clear(screen.getByLabelText("Desde"));
    await user.type(screen.getByLabelText("Desde"), "2020-03-01");
    await user.clear(screen.getByLabelText("Hasta"));
    await user.type(screen.getByLabelText("Hasta"), "2020-03-07");
    await user.click(screen.getByRole("button", { name: "Ver" }));
    await waitFor(() =>
      expect(api.fetchSalesSummary).toHaveBeenLastCalledWith(
        { from: "2020-03-01", to: "2020-03-07" },
        "day",
      ),
    );
  });

  it("recuerda el período de la dirección (recargar no lo pierde)", async () => {
    mount("/admin?p=custom&desde=2020-03-01&hasta=2020-03-07");
    await screen.findByTestId("kpis");
    expect(api.fetchSalesSummary).toHaveBeenCalledWith(
      { from: "2020-03-01", to: "2020-03-07" },
      "day",
    );
    expect(screen.getByRole("button", { name: "Otro período" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
