import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { asCustomer, customerProfile, WithAuth } from "@/test/auth-test-utils";
import { money } from "@/lib/money";
import { OrdersPage, OrdersView } from "./OrdersPage";
import type { OrderRow } from "./ordersApi";
import type { OrderSummary } from "./types";

// La lectura se simula (la RLS se prueba en la base): aquí se verifica QUÉ se pide y cómo se pinta.
const listOrders = vi.hoisted(() => vi.fn());
vi.mock("./ordersApi", async (original) => ({
  ...(await original<typeof import("./ordersApi")>()),
  listOrders,
}));

const SAMPLE: OrderSummary[] = [
  {
    id: "o-2",
    number: "MIC-000124",
    createdAt: "2026-11-01T14:00:00Z",
    status: "shipped",
    total: money(8000, "BOB"),
  },
  {
    id: "o-1",
    number: "MIC-000123",
    createdAt: "2026-10-30T15:30:00Z",
    status: "completed",
    total: money(12550, "BOB"),
  },
];

const renderView = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

const row = (over: Partial<OrderRow> = {}): OrderRow =>
  ({
    id: "o-1",
    number: "MIC-000123",
    status: "pending_payment",
    currency: "BOB",
    total: 255,
    created_at: "2026-11-09T15:30:00Z",
    ...over,
  }) as OrderRow;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WithAuth value={asCustomer()}>
        <MemoryRouter>
          <OrdersPage />
        </MemoryRouter>
      </WithAuth>
    </QueryClientProvider>,
  );
}

describe("OrdersPage (S10: pedidos reales)", () => {
  beforeEach(() => listOrders.mockReset());

  it("pide los pedidos de la clienta que inició sesión (y de nadie más)", async () => {
    listOrders.mockResolvedValue([]);
    renderPage();
    await screen.findByText("Aún no tienes pedidos");
    expect(listOrders).toHaveBeenCalledWith(customerProfile.id);
  });

  it("lista cada pedido con su número, estado y total ya calculado por el servidor", async () => {
    listOrders.mockResolvedValue([
      row({ id: "o-2", number: "MIC-000124", status: "shipped", total: 80 }),
      row({ id: "o-1", number: "MIC-000123", status: "pending_payment", total: 255.5 }),
    ]);
    renderPage();
    const list = await screen.findByRole("list", { name: "Lista de pedidos" });
    const links = Array.from(list.querySelectorAll("a")).map((a) => a.textContent);
    expect(links).toEqual(["Pedido MIC-000124", "Pedido MIC-000123"]);
    expect(list).toHaveTextContent("Bs 255,50");
    expect(list).toHaveTextContent("Bs 80,00");
    expect(list).toHaveTextContent("Pendiente de pago");
    expect(list).toHaveTextContent("Enviado");
    expect(screen.getByRole("link", { name: "Pedido MIC-000123" })).toHaveAttribute(
      "href",
      "/cuenta/pedidos/o-1",
    );
  });

  it("sin pedidos: estado vacío amable con enlace a la tienda", async () => {
    listOrders.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("Aún no tienes pedidos")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a la tienda" })).toHaveAttribute("href", "/tienda");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("mientras carga lo anuncia, y si falla ofrece reintentar (y reintenta de verdad)", async () => {
    listOrders.mockRejectedValueOnce(new Error("sin red")).mockResolvedValueOnce([row()]);
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando tus pedidos…");
    expect(await screen.findByText("No pudimos cargar tus pedidos")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(await screen.findByRole("link", { name: "Pedido MIC-000123" })).toBeInTheDocument();
    expect(listOrders).toHaveBeenCalledTimes(2);
  });
});

describe("OrdersView", () => {
  it("con pedidos: una lista etiquetada con una fila por pedido, en el orden recibido", () => {
    renderView(<OrdersView orders={SAMPLE} />);
    const list = screen.getByRole("list", { name: "Lista de pedidos" });
    const links = Array.from(list.querySelectorAll("a")).map((a) => a.textContent);
    expect(links).toEqual(["Pedido MIC-000124", "Pedido MIC-000123"]);
    expect(screen.queryByText("Aún no tienes pedidos")).not.toBeInTheDocument();
  });

  it("cargando: se anuncia a los lectores y no se pinta ni el vacío ni la lista", () => {
    renderView(<OrdersView orders={[]} isLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando tus pedidos…");
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByText("Aún no tienes pedidos")).not.toBeInTheDocument();
  });

  it("error: aviso con «Reintentar» que llama a onRetry", async () => {
    const onRetry = vi.fn();
    renderView(<OrdersView orders={[]} isError onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar tus pedidos");
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Aún no tienes pedidos")).not.toBeInTheDocument();
  });

  it("error sin onRetry no ofrece un botón que no hace nada", () => {
    renderView(<OrdersView orders={[]} isError />);
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });

  it("la lista vacía NO es lo mismo que cargar: sin carga ni error, vacío", () => {
    renderView(<OrdersView orders={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Aún no tienes pedidos");
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
