import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrdersPage } from "./OrdersPage";
import type { OrderRow } from "./types";

const api = vi.hoisted(() => ({
  listOrders: vi.fn(),
  listOrdersForExport: vi.fn(),
  statusCounts: vi.fn(),
  listPaymentMethodsLite: vi.fn(),
  transitionOrder: vi.fn(),
}));
vi.mock("./api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const row = (over: Partial<OrderRow> = {}): OrderRow => ({
  id: "o-1",
  number: "MIC-000123",
  status: "paid",
  channel: "web",
  contactName: "Ana Pérez",
  contactPhone: "+59171234567",
  total: 255,
  currency: "BOB",
  paymentMethod: "whatsapp",
  paymentProvider: "whatsapp",
  createdAt: "2026-11-10T12:00:00Z",
  updatedAt: "2026-11-10T12:00:00Z",
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OrdersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const lastFilters = () => api.listOrders.mock.calls.at(-1)?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  api.listOrders.mockResolvedValue({
    rows: [
      row(),
      row({
        id: "o-2",
        number: "MIC-000124",
        status: "pending_payment",
        contactName: "Bia",
        total: 80.5,
      }),
      row({ id: "o-3", number: "MIC-000125", status: "completed", channel: "whatsapp" }),
    ],
    total: 3,
  });
  api.statusCounts.mockResolvedValue({ paid: 4, pending_payment: 2, completed: 7 });
  api.listPaymentMethodsLite.mockResolvedValue([
    { code: "whatsapp", name: "WhatsApp", provider: "whatsapp" },
    { code: "cash_on_delivery", name: "Contra entrega", provider: "cash_on_delivery" },
  ]);
  api.transitionOrder.mockResolvedValue({ ok: true, outcome: "transitioned" });
});

describe("OrdersPage · bandeja", () => {
  it("lista los pedidos con su estado, cliente y total", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Pedidos" });
    expect(within(table).getByRole("link", { name: "MIC-000123" })).toHaveAttribute(
      "href",
      "/admin/pedidos/o-1",
    );
    expect(within(table).getByText("Bia")).toBeInTheDocument();
    expect(within(table).getByText("Bs 80,50")).toBeInTheDocument();
    expect(within(table).getByText("Pendiente de pago")).toBeInTheDocument();
    expect(within(table).getByText("WhatsApp (manual)")).toBeInTheDocument();
  });

  it("muestra el contador de cada estado y el total", async () => {
    renderPage();
    await screen.findByRole("table", { name: "Pedidos" });
    const group = screen.getByRole("group", { name: "Filtrar por estado" });
    expect(within(group).getByRole("button", { name: /Pagado\s*4/ })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: /Completado\s*7/ })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: /Todos\s*13/ })).toBeInTheDocument();
  });

  it("filtrar por estado pide solo ese estado y vuelve a la primera página", async () => {
    renderPage();
    await screen.findByRole("table", { name: "Pedidos" });
    await userEvent.click(screen.getByRole("button", { name: /Pagado/ }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ status: "paid", page: 0 }));
    expect(screen.getByRole("button", { name: /Pagado/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("cambiar un filtro estando en otra página vuelve a la primera (no deja una página que ya no existe)", async () => {
    api.listOrders.mockResolvedValue({ rows: [row()], total: 60 });
    renderPage();
    await screen.findByRole("table", { name: "Pedidos" });
    await userEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ page: 1 }));
    await userEvent.click(screen.getByRole("button", { name: /Pagado/ }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ status: "paid", page: 0 }));
  });

  it("busca por texto y filtra por método, canal y fechas", async () => {
    renderPage();
    await screen.findByRole("table", { name: "Pedidos" });
    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar" }), "Ana");
    await userEvent.selectOptions(screen.getByLabelText("Método de pago"), "cash_on_delivery");
    await userEvent.selectOptions(screen.getByLabelText("Canal"), "whatsapp");
    await userEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() =>
      expect(lastFilters()).toMatchObject({
        search: "Ana",
        method: "cash_on_delivery",
        channel: "whatsapp",
      }),
    );
  });

  it("«Limpiar filtros» vuelve a todo", async () => {
    renderPage();
    await screen.findByRole("table", { name: "Pedidos" });
    await userEvent.click(screen.getByRole("button", { name: /Completado/ }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ status: "completed" }));
    await userEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    await waitFor(() =>
      expect(lastFilters()).toMatchObject({ status: "all", search: "", method: "all" }),
    );
  });

  it("avanza un pedido con confirmación mandando el estado que se VIO (bloqueo optimista)", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Pedidos" });
    await userEvent.click(
      within(table).getByRole("button", { name: "Pasar a preparación · MIC-000123" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/ya no puede cancelarlo/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Nota (opcional)"), "Listo para empacar");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }));
    await waitFor(() =>
      expect(api.transitionOrder).toHaveBeenCalledWith(
        "o-1",
        "preparing",
        "Listo para empacar",
        "paid",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("si otro administrador ya movió el pedido, lo cuenta y deja el diálogo abierto", async () => {
    api.transitionOrder.mockResolvedValue({ ok: false, outcome: "stale", current: "preparing" });
    renderPage();
    const table = await screen.findByRole("table", { name: "Pedidos" });
    await userEvent.click(
      within(table).getByRole("button", { name: "Pasar a preparación · MIC-000123" }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /Otro administrador cambió este pedido/,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("un pedido completado no ofrece avanzar, y uno pendiente ofrece «Confirmar pago»", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Pedidos" });
    expect(within(table).queryByRole("button", { name: /MIC-000125/ })).not.toBeInTheDocument();
    expect(
      within(table).getByRole("button", { name: "Confirmar pago · MIC-000124" }),
    ).toBeInTheDocument();
  });

  it("marcar preparando a varios: solo pasan los «pagados»; los demás se omiten y se cuentan", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Pedidos" });
    await userEvent.click(
      within(table).getByRole("checkbox", { name: "Seleccionar el pedido MIC-000123" }),
    );
    await userEvent.click(
      within(table).getByRole("checkbox", { name: "Seleccionar el pedido MIC-000124" }),
    );
    expect(screen.getByText("2 seleccionados")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Marcar preparando" }));
    await waitFor(() => expect(api.transitionOrder).toHaveBeenCalledTimes(1));
    expect(api.transitionOrder).toHaveBeenCalledWith("o-1", "preparing", null, "paid");
    expect(
      await screen.findByText(
        /Pasaron a preparación: 1\. Con problema: 0\. Omitidos \(no estaban pagados\): 1\./,
      ),
    ).toBeInTheDocument();
  });

  it("si uno de los seleccionados falla, los demás siguen y se informa el fallo", async () => {
    api.listOrders.mockResolvedValue({
      rows: [row(), row({ id: "o-4", number: "MIC-000126" })],
      total: 2,
    });
    api.transitionOrder
      .mockResolvedValueOnce({ ok: false, outcome: "stale" })
      .mockResolvedValueOnce({ ok: true });
    renderPage();
    const table = await screen.findByRole("table", { name: "Pedidos" });
    await userEvent.click(
      within(table).getByRole("checkbox", { name: "Seleccionar todos los pedidos de esta página" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Marcar preparando" }));
    await waitFor(() => expect(api.transitionOrder).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(/Pasaron a preparación: 1\. Con problema: 1\./),
    ).toBeInTheDocument();
  });

  it("sin ninguno «pagado» seleccionado, no manda nada", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Pedidos" });
    await userEvent.click(
      within(table).getByRole("checkbox", { name: "Seleccionar el pedido MIC-000124" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Marcar preparando" }));
    expect(api.transitionOrder).not.toHaveBeenCalled();
  });

  it("exporta lo filtrado a CSV (todos los que cumplen, no solo la página)", async () => {
    api.listOrdersForExport.mockResolvedValue([row(), row({ id: "o-9", number: "MIC-000999" })]);
    const click = vi.fn();
    const create = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
    const anchor = document.createElement("a");
    anchor.click = click;
    const original = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
      tag === "a" ? anchor : original(tag),
    );
    renderPage();
    await screen.findByRole("table", { name: "Pedidos" });
    await userEvent.click(screen.getByRole("button", { name: "Exportar lo filtrado (CSV)" }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(api.listOrdersForExport).toHaveBeenCalledWith(
      expect.objectContaining({ status: "all" }),
    );
    expect(anchor.download).toMatch(/^pedidos-\d{4}-\d{2}-\d{2}\.csv$/);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sin resultados muestra el mensaje vacío; con error ofrece reintentar", async () => {
    api.listOrders.mockResolvedValueOnce({ rows: [], total: 0 });
    const { unmount } = renderPage();
    expect(await screen.findByText("Ningún pedido coincide con los filtros.")).toBeInTheDocument();
    unmount();
    api.listOrders.mockRejectedValueOnce(new Error("boom"));
    renderPage();
    expect(await screen.findByRole("button", { name: /Reintentar/ })).toBeInTheDocument();
  });
});
