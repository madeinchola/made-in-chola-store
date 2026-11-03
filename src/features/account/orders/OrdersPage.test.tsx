import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { money } from "@/lib/money";
import { OrdersPage, OrdersView } from "./OrdersPage";
import type { OrderSummary } from "./types";

// «SIN consultar ninguna tabla todavía»: si algo pidiera el cliente de Supabase, el test falla.
const getSupabase = vi.hoisted(() => vi.fn(() => ({ from: () => ({ select: () => ({}) }) })));
vi.mock("@/lib/supabase", () => ({ getSupabase }));

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

describe("OrdersPage (hoy, vacío hasta S10)", () => {
  it("estado vacío amable con enlace a la tienda, sin consultar nada", () => {
    renderView(<OrdersPage />);
    expect(screen.getByRole("heading", { level: 2, name: "Mis pedidos" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Aún no tienes pedidos");
    expect(screen.getByRole("link", { name: "Ir a la tienda" })).toHaveAttribute("href", "/tienda");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(getSupabase).not.toHaveBeenCalled();
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
