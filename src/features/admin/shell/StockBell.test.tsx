import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StockBell } from "./StockBell";

const api = vi.hoisted(() => ({ getStockAlertSummary: vi.fn(), listStockAlertVariants: vi.fn() }));
vi.mock("../stock/api", () => ({ ALERT_LIGHTS: ["out", "critical", "low"], ...api }));

const renderBell = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <StockBell />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => vi.clearAllMocks());

describe("StockBell", () => {
  it("con alertas muestra el número y lleva al listado de PUBLICADOS con alerta (la campana solo cuenta publicados)", async () => {
    api.getStockAlertSummary.mockResolvedValue({ low: 2, critical: 1, out: 4, total: 7 });
    renderBell();
    const link = await screen.findByRole("link", { name: /7 productos con stock bajo o agotado/ });
    expect(link).toHaveAttribute("href", "/admin/productos?estado=publicados&stock=alert");
    expect(link).toHaveTextContent("7");
  });

  it("sin alertas no muestra número y lo dice en su nombre accesible", async () => {
    api.getStockAlertSummary.mockResolvedValue({ low: 0, critical: 0, out: 0, total: 0 });
    renderBell();
    const link = await screen.findByRole("link", { name: /Sin alertas de stock/ });
    expect(link).not.toHaveTextContent(/\d/);
  });

  it("más de 99 se muestra como 99+", async () => {
    api.getStockAlertSummary.mockResolvedValue({ low: 100, critical: 0, out: 20, total: 120 });
    renderBell();
    expect(await screen.findByText("99+")).toBeInTheDocument();
  });
});
