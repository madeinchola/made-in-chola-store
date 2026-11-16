import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as apiModule from "./api";
import { AttentionPage } from "./AttentionPage";
import { BlacklistPage } from "./BlacklistPage";
import { IncidentsPage } from "./IncidentsPage";
import { OrdersLayout } from "./OrdersLayout";
import type { AttentionItem, BlacklistRow, IncidentRow } from "./types";

vi.mock("./api", async () => (await import("./apiMock")).createApiMock());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const api = vi.mocked(apiModule);

function mount(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

const item = (over: Partial<AttentionItem> = {}): AttentionItem => ({
  kind: "refund_due",
  orderId: "o-1",
  number: "MIC-000123",
  status: "cancelled",
  contactName: "Ana",
  total: 255,
  currency: "BOB",
  createdAt: "2026-11-10T12:00:00Z",
  since: "2026-11-11T12:00:00Z",
  detail: { amount: 90 },
  ...over,
});

describe("AttentionPage", () => {
  it("agrupa por categoría, con su cuenta, su ayuda y un enlace a cada pedido", async () => {
    api.attentionOrders.mockResolvedValue([
      item(),
      item({ orderId: "o-2", number: "MIC-000124", detail: { amount: 10 } }),
      item({
        kind: "stale_pending",
        orderId: "o-3",
        number: "MIC-000125",
        status: "pending_payment",
        detail: {},
      }),
    ]);
    mount(<AttentionPage />);
    const due = await screen.findByRole("heading", { name: "Dinero por devolver (2)" });
    expect(due).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Pedidos sin confirmar hace tiempo (1)" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/WhatsApp y contra entrega no vencen solos/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "MIC-000123" })).toHaveAttribute(
      "href",
      "/admin/pedidos/o-1",
    );
    expect(screen.getByText("Bs 90,00")).toBeInTheDocument();
    // las categorías sin filas no aparecen
    expect(screen.queryByRole("heading", { name: /Contracargos/ })).not.toBeInTheDocument();
  });

  it("sin nada pendiente lo dice", async () => {
    api.attentionOrders.mockResolvedValue([]);
    mount(<AttentionPage />);
    expect(await screen.findByText(/Nada pide atención ahora mismo/)).toBeInTheDocument();
  });

  it("un error de carga ofrece reintentar", async () => {
    api.attentionOrders.mockRejectedValue(new Error("boom"));
    mount(<AttentionPage />);
    expect(await screen.findByRole("button", { name: /Reintentar/ })).toBeInTheDocument();
  });
});

describe("OrdersLayout", () => {
  it("la pestaña de atención lleva el contador de pedidos y hay acceso al pedido manual", async () => {
    api.attentionSummary.mockResolvedValue({ orders: 5 });
    mount(<OrdersLayout />);
    expect(await screen.findByLabelText("5 pedidos piden atención")).toHaveTextContent("5");
    expect(screen.getByRole("link", { name: "Nuevo pedido" })).toHaveAttribute(
      "href",
      "/admin/pedidos/nuevo",
    );
    const tabs = screen.getByRole("navigation", { name: "Secciones de Pedidos" });
    expect(
      within(tabs)
        .getAllByRole("link")
        .map((l) => l.textContent?.replace(/\d+$/, "")),
    ).toEqual(["Pedidos", "Atención requerida", "Incidencias", "Lista negra"]);
  });

  it("sin pendientes no muestra contador; con más de 99 dice 99+", async () => {
    api.attentionSummary.mockResolvedValue({ orders: 0 });
    const { unmount } = mount(<OrdersLayout />);
    await waitFor(() => expect(api.attentionSummary).toHaveBeenCalled());
    expect(screen.queryByLabelText(/piden atención/)).not.toBeInTheDocument();
    unmount();
    api.attentionSummary.mockResolvedValue({ orders: 250 });
    mount(<OrdersLayout />);
    expect(await screen.findByLabelText("250 pedidos piden atención")).toHaveTextContent("99+");
  });
});

const incident = (over: Partial<IncidentRow> = {}): IncidentRow => ({
  id: "inc-1",
  orderId: "o-1",
  orderNumber: "MIC-000123",
  contactName: "Ana",
  type: "lost",
  status: "open",
  description: null,
  costAssumed: 25,
  costBorneBy: "carrier",
  resolution: null,
  openedAt: "2026-11-10T12:00:00Z",
  resolvedAt: null,
  ...over,
});

describe("IncidentsPage", () => {
  beforeEach(() => {
    api.listIncidents.mockResolvedValue([
      incident(),
      incident({
        id: "inc-2",
        orderNumber: "MIC-000124",
        type: "damaged",
        status: "resolved",
        costAssumed: 0,
        resolution: "ok",
        resolvedAt: "2026-11-12T00:00:00Z",
      }),
      incident({
        id: "inc-3",
        orderNumber: "MIC-000125",
        type: "absent",
        status: "investigating",
        costAssumed: 0,
      }),
    ]);
  });

  it("por omisión muestra solo las abiertas y en seguimiento", async () => {
    mount(<IncidentsPage />);
    const table = await screen.findByRole("table", { name: "Incidencias de entrega" });
    expect(within(table).getByText("MIC-000123")).toBeInTheDocument();
    expect(within(table).getByText("MIC-000125")).toBeInTheDocument();
    expect(within(table).queryByText("MIC-000124")).not.toBeInTheDocument();
    expect(within(table).getByText("Bs 25,00 · El transportista")).toBeInTheDocument();
  });

  it("«Todas» y «Resuelta» cambian la lista", async () => {
    mount(<IncidentsPage />);
    await screen.findByRole("table", { name: "Incidencias de entrega" });
    await userEvent.selectOptions(screen.getByLabelText("Mostrar"), "all");
    expect(screen.getByText("MIC-000124")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Mostrar"), "resolved");
    expect(screen.queryByText("MIC-000123")).not.toBeInTheDocument();
    expect(screen.getByText("MIC-000124")).toBeInTheDocument();
  });

  it("una resuelta no ofrece seguimiento; una abierta sí, y abre el diálogo", async () => {
    mount(<IncidentsPage />);
    await userEvent.selectOptions(await screen.findByLabelText("Mostrar"), "all");
    const rows = screen.getAllByRole("row").slice(1);
    expect(
      within(rows[1] as HTMLElement).queryByRole("button", { name: "Dar seguimiento" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      within(rows[0] as HTMLElement).getByRole("button", { name: "Dar seguimiento" }),
    );
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Seguimiento de la incidencia · MIC-000123",
    );
  });
});

const entry = (over: Partial<BlacklistRow> = {}): BlacklistRow => ({
  id: "b-1",
  kind: "profile",
  profileId: "p-1",
  profileName: "Ana Pérez",
  phone: null,
  email: null,
  reason: "Rechazó dos paquetes",
  isActive: true,
  sourceOrderId: "o-1",
  createdAt: "2026-11-10T12:00:00Z",
  liftedAt: null,
  liftReason: null,
  ...over,
});

describe("BlacklistPage", () => {
  beforeEach(() => {
    api.listBlacklist.mockResolvedValue([
      entry(),
      entry({
        id: "b-2",
        kind: "phone",
        profileId: null,
        profileName: null,
        phone: "+59170000005",
        reason: "Evasión",
        sourceOrderId: null,
      }),
      entry({
        id: "b-3",
        kind: "email",
        profileId: null,
        profileName: null,
        email: "x@test.com",
        isActive: false,
        liftedAt: "2026-11-12T00:00:00Z",
        liftReason: "Pagó",
      }),
    ]);
  });

  it("muestra los bloqueos activos con quién, por qué y el pedido de origen", async () => {
    mount(<BlacklistPage />);
    const table = await screen.findByRole("table", { name: "Lista negra" });
    expect(within(table).getByText("Ana Pérez")).toBeInTheDocument();
    expect(within(table).getByText("+59170000005")).toBeInTheDocument();
    expect(within(table).getByText("Rechazó dos paquetes")).toBeInTheDocument();
    expect(within(table).getByRole("link", { name: "Ver pedido" })).toHaveAttribute(
      "href",
      "/admin/pedidos/o-1",
    );
    expect(within(table).queryByText("x@test.com")).not.toBeInTheDocument();
  });

  it("«mostrar levantados» incluye el historial, sin botón de levantar en ellos", async () => {
    mount(<BlacklistPage />);
    await screen.findByRole("table", { name: "Lista negra" });
    await userEvent.click(screen.getByLabelText("Mostrar también los bloqueos levantados"));
    expect(screen.getByText("x@test.com")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Levantar el bloqueo de/ })).toHaveLength(2);
  });

  it("levantar pide el motivo y lo manda", async () => {
    api.blacklistLift.mockResolvedValue({ outcome: "lifted" });
    mount(<BlacklistPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Levantar el bloqueo de Ana Pérez" }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Por qué se levanta"), "Se resolvió");
    await userEvent.click(within(dialog).getByRole("button", { name: "Levantar" }));
    await waitFor(() => expect(api.blacklistLift).toHaveBeenCalledWith("b-1", "Se resolvió"));
  });

  it("bloquear un teléfono suelto desde aquí", async () => {
    api.blacklistAdd.mockResolvedValue({ outcome: "added" });
    mount(<BlacklistPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Bloquear…" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Teléfono"), "71234567");
    await userEvent.type(within(dialog).getByLabelText("Motivo"), "Contracargos");
    await userEvent.click(within(dialog).getByRole("button", { name: "Bloquear" }));
    await waitFor(() =>
      expect(api.blacklistAdd).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "phone", phone: "+59171234567", reason: "Contracargos" }),
      ),
    );
  });

  it("vacía lo dice", async () => {
    api.listBlacklist.mockResolvedValue([]);
    mount(<BlacklistPage />);
    expect(await screen.findByText("No hay nadie en la lista negra.")).toBeInTheDocument();
  });
});
