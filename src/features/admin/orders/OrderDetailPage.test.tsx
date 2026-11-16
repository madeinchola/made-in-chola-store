import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import * as apiModule from "./api";
import { OrderDetailPage } from "./OrderDetailPage";
import type { HistoryEntry, OrderDetail, OrderPayment, RefundRow } from "./types";

vi.mock("./api", async () => (await import("./apiMock")).createApiMock());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const api = vi.mocked(apiModule);

const order = (over: Partial<OrderDetail> = {}): OrderDetail => ({
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
  profileId: "p-1",
  subtotal: 240,
  discountTotal: 0,
  shippingCost: 15,
  shippingDiscount: 0,
  contactEmail: "ana@test.com",
  shippingKind: "delivery",
  shippingName: "A domicilio",
  address: {
    recipient: "Ana",
    phone: "+59171234567",
    line1: "Calle 1 #23",
    line2: null,
    city: "La Paz",
    department: null,
    country: "BO",
    reference: "Portón verde",
    lat: -16.5,
    lng: -68.15,
  },
  slot: null,
  couponCode: null,
  paymentExpiresAt: null,
  paidAt: null,
  cancelledAt: null,
  cancelReason: null,
  cancelledBy: null,
  editCount: 0,
  editedAt: null,
  items: [
    {
      id: "i-1",
      lineNo: 1,
      variantId: "v-1",
      productId: "p1",
      name: "Camiseta",
      colorName: "Rojo",
      sizeLabel: "M",
      sku: "CAM-R-M",
      imagePath: null,
      qty: 2,
      unitPrice: 100,
      lineTotal: 200,
      discount: 0,
      finalTotal: 200,
    },
    {
      id: "i-2",
      lineNo: 2,
      variantId: "v-2",
      productId: "p2",
      name: "Gorra",
      colorName: null,
      sizeLabel: null,
      sku: null,
      imagePath: null,
      qty: 1,
      unitPrice: 40,
      lineTotal: 40,
      discount: 0,
      finalTotal: 40,
    },
  ],
  ...over,
});
const payment = (over: Partial<OrderPayment> = {}): OrderPayment => ({
  id: "pay-1",
  provider: "whatsapp",
  method: "whatsapp",
  status: "paid",
  amount: 255,
  receivedAmount: null,
  currency: "BOB",
  reference: "MIC-000123",
  attempt: 1,
  paidAt: null,
  collectedAt: null,
  ...over,
});
const step = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: 2,
  fromStatus: "pending_payment",
  toStatus: "paid",
  actorKind: "admin",
  actorName: "Natalia",
  reason: "Confirmado por WhatsApp",
  createdAt: "2026-11-10T12:30:00Z",
  ...over,
});

interface Extras {
  payments?: OrderPayment[];
  history?: HistoryEntry[];
  refunds?: RefundRow[];
  blacklist?: Awaited<ReturnType<typeof apiModule.listBlacklist>>;
  attention?: Awaited<ReturnType<typeof apiModule.attentionOrders>>;
}

function setup(o: OrderDetail | null, extras: Extras = {}) {
  vi.clearAllMocks();
  api.getOrder.mockResolvedValue(o);
  api.listPayments.mockResolvedValue(extras.payments ?? [payment()]);
  api.listProofs.mockResolvedValue([]);
  api.listRefunds.mockResolvedValue(extras.refunds ?? []);
  api.listReturns.mockResolvedValue([]);
  api.listIncidents.mockResolvedValue([]);
  api.listNotes.mockResolvedValue([]);
  api.listEdits.mockResolvedValue([]);
  api.listBlacklist.mockResolvedValue(extras.blacklist ?? []);
  api.blacklistMatches.mockResolvedValue([]);
  api.attentionOrders.mockResolvedValue(extras.attention ?? []);
  api.attentionSummary.mockResolvedValue({});
  api.getHistory.mockResolvedValue(
    extras.history ?? [
      {
        ...step({
          id: 1,
          fromStatus: null,
          toStatus: "pending_payment",
          actorKind: "customer",
          actorName: null,
          reason: "created",
        }),
      },
      step(),
    ],
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/pedidos/o-1"]}>
        <Routes>
          <Route path="/admin/pedidos/:id" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const group = () => screen.findByRole("group", { name: "Acciones del pedido" });
const hasButton = async (name: string | RegExp) =>
  within(await group()).queryByRole("button", { name });

describe("OrderDetailPage · contenido", () => {
  it("muestra el pedido completo: cabecera, cliente, entrega, productos, totales, pagos e historial", async () => {
    setup(order());
    expect(
      await screen.findByRole("heading", { name: "MIC-000123", level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText(/Calle 1 #23, La Paz/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ver en el mapa/ })).toHaveAttribute(
      "href",
      expect.stringContaining("openstreetmap.org"),
    );
    const items = screen.getByRole("table", { name: "Productos del pedido" });
    expect(within(items).getByText("Camiseta")).toBeInTheDocument();
    expect(within(items).getByText("Rojo · M · CAM-R-M")).toBeInTheDocument();
    expect(screen.getAllByText("Bs 255,00").length).toBeGreaterThan(0);
    expect(await screen.findByText("De «Pendiente de pago» a «Pagado»")).toBeInTheDocument();
    expect(screen.getByText(/Natalia/)).toBeInTheDocument();
    expect(screen.getByText("Motivo: Confirmado por WhatsApp")).toBeInTheDocument();
  });

  it("un pedido inexistente lo dice y ofrece volver", async () => {
    setup(null);
    expect(await screen.findByText("No encontramos ese pedido.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Volver a pedidos" })).toHaveAttribute(
      "href",
      "/admin/pedidos",
    );
  });

  it("recojo en tienda: no muestra dirección", async () => {
    setup(order({ shippingKind: "pickup", shippingName: "Recojo", address: null }));
    expect(await screen.findByText("Recojo en tienda (sin dirección)")).toBeInTheDocument();
  });
});

describe("OrderDetailPage · acciones según el estado", () => {
  it("pagado: avanzar, editar, cancelar y reembolsar, reembolsar, incidencia y lista negra (sin devolución ni contra entrega)", async () => {
    setup(order());
    expect(await screen.findByRole("button", { name: "Pasar a preparación" })).toBeInTheDocument();
    for (const name of [
      "Editar pedido",
      "Cancelar y reembolsar",
      "Reembolsar",
      "Registrar incidencia",
      "Añadir a la lista negra",
    ]) {
      expect(await hasButton(name)).toBeInTheDocument();
    }
    for (const name of ["Registrar devolución", /Registrar cobro/, /Rechazado en la entrega/]) {
      expect(await hasButton(name)).not.toBeInTheDocument();
    }
  });

  it("entregado: se devuelve (no se edita ni se cancela) y se completa", async () => {
    setup(order({ status: "delivered" }));
    expect(await screen.findByRole("button", { name: "Completar pedido" })).toBeInTheDocument();
    expect(await hasButton("Registrar devolución")).toBeInTheDocument();
    expect(await hasButton("Reembolsar")).toBeInTheDocument();
    expect(await hasButton("Editar pedido")).not.toBeInTheDocument();
    expect(await hasButton("Cancelar y reembolsar")).not.toBeInTheDocument();
  });

  it("completado y reembolsado: sin botón de avanzar", async () => {
    setup(order({ status: "completed" }));
    await group();
    expect(
      screen.queryByRole("button", { name: /Completar pedido|Pasar a|Marcar/ }),
    ).not.toBeInTheDocument();
  });

  it("cancelado con dinero: solo «Reembolsar» (no se edita ni se cancela otra vez)", async () => {
    setup(order({ status: "cancelled" }));
    expect(await hasButton("Reembolsar")).toBeInTheDocument();
    expect(await hasButton("Editar pedido")).not.toBeInTheDocument();
    expect(await hasButton("Cancelar y reembolsar")).not.toBeInTheDocument();
  });

  it("contra entrega enviada y sin cobrar: ofrece registrar el cobro o el rechazo", async () => {
    setup(
      order({
        status: "shipped",
        paymentProvider: "cash_on_delivery",
        paymentMethod: "cash_on_delivery",
      }),
      {
        payments: [payment({ provider: "cash_on_delivery", method: "cash_on_delivery" })],
      },
    );
    expect(await hasButton("Registrar cobro (contra entrega)")).toBeInTheDocument();
    expect(await hasButton("Rechazado en la entrega")).toBeInTheDocument();
  });

  it("contra entrega ya entregada: solo el cobro (el rechazo es solo mientras va en camino)", async () => {
    setup(order({ status: "delivered", paymentProvider: "cash_on_delivery" }), {
      payments: [payment({ provider: "cash_on_delivery", method: "cash_on_delivery" })],
    });
    expect(await hasButton("Registrar cobro (contra entrega)")).toBeInTheDocument();
    expect(await hasButton("Rechazado en la entrega")).not.toBeInTheDocument();
  });

  it("contra entrega ya cobrada: ninguna de las dos", async () => {
    setup(order({ status: "shipped", paymentProvider: "cash_on_delivery" }), {
      payments: [
        payment({
          provider: "cash_on_delivery",
          method: "cash_on_delivery",
          collectedAt: "2026-11-10T20:00:00Z",
        }),
      ],
    });
    await group();
    expect(await hasButton("Registrar cobro (contra entrega)")).not.toBeInTheDocument();
    expect(await hasButton("Rechazado en la entrega")).not.toBeInTheDocument();
  });

  it("una cuenta ya bloqueada avisa y no ofrece bloquear de nuevo", async () => {
    setup(order(), {
      blacklist: [
        {
          id: "b1",
          kind: "phone",
          profileId: null,
          profileName: null,
          phone: "+59171234567",
          email: null,
          reason: "x",
          isActive: true,
          sourceOrderId: null,
          createdAt: "2026-11-01T00:00:00Z",
          liftedAt: null,
          liftReason: null,
        },
      ],
    });
    expect(await screen.findByText(/está en la lista negra/)).toBeInTheDocument();
    expect(await hasButton("Añadir a la lista negra")).not.toBeInTheDocument();
  });

  it("un bloqueo ya levantado no cuenta", async () => {
    setup(order(), {
      blacklist: [
        {
          id: "b1",
          kind: "profile",
          profileId: "p-1",
          profileName: "Ana",
          phone: null,
          email: null,
          reason: "x",
          isActive: false,
          sourceOrderId: null,
          createdAt: "2026-11-01T00:00:00Z",
          liftedAt: "2026-11-05T00:00:00Z",
          liftReason: "ok",
        },
      ],
    });
    expect(await hasButton("Añadir a la lista negra")).toBeInTheDocument();
    expect(screen.queryByText(/está en la lista negra/)).not.toBeInTheDocument();
  });

  it("lista lo que pide atención de ESTE pedido", async () => {
    setup(order(), {
      attention: [
        {
          kind: "refund_due",
          orderId: "o-1",
          number: "MIC-000123",
          status: "paid",
          contactName: "Ana",
          total: 255,
          currency: "BOB",
          createdAt: "x",
          since: "x",
          detail: { amount: 90 },
        },
        {
          kind: "refund_due",
          orderId: "otro",
          number: "MIC-9",
          status: "paid",
          contactName: "Z",
          total: 1,
          currency: "BOB",
          createdAt: "x",
          since: "x",
          detail: { amount: 1 },
        },
      ],
    });
    const banner = await screen.findByRole("region", { name: "Este pedido pide atención" });
    expect(within(banner).getByText(/Dinero por devolver · Bs 90,00/)).toBeInTheDocument();
    expect(within(banner).getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("OrderDetailPage · deshacer", () => {
  const preparing = [
    step({
      id: 1,
      fromStatus: null,
      toStatus: "pending_payment",
      actorKind: "customer",
      reason: "created",
    }),
    step({ id: 2, fromStatus: "paid", toStatus: "preparing", reason: null }),
  ];

  it("se ofrece si el último paso lo hizo un administrador y lo manda con el estado que se ve", async () => {
    api.undoTransition.mockResolvedValue({ ok: true, outcome: "undone" });
    setup(order({ status: "preparing" }), { history: preparing });
    api.undoTransition.mockResolvedValue({ ok: true, outcome: "undone" });
    await userEvent.click(await screen.findByRole("button", { name: "Deshacer último paso" }));
    await waitFor(() => expect(api.undoTransition).toHaveBeenCalledWith("o-1", "preparing"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Se deshizo el último paso."));
  });

  it("no se ofrece si el último paso lo dio la clienta o el sistema (aunque el estado admita deshacer)", async () => {
    // «En preparación» sí es un estado que se puede deshacer: lo que lo impide aquí es QUIÉN dio el último paso.
    setup(order({ status: "preparing" }), {
      history: [
        step({
          id: 1,
          fromStatus: null,
          toStatus: "pending_payment",
          actorKind: "customer",
          reason: "created",
        }),
        step({
          id: 2,
          fromStatus: "paid",
          toStatus: "preparing",
          actorKind: "system",
          actorName: null,
          reason: null,
        }),
      ],
    });
    await group();
    expect(screen.queryByRole("button", { name: "Deshacer último paso" })).not.toBeInTheDocument();
  });

  it("tampoco si el último paso registrado no es el del estado actual", async () => {
    setup(order({ status: "preparing" }), {
      history: [step({ id: 1, fromStatus: "pending_payment", toStatus: "paid" })],
    });
    await group();
    expect(screen.queryByRole("button", { name: "Deshacer último paso" })).not.toBeInTheDocument();
  });

  it("no se ofrece en estados que mueven stock o dinero (pagado)", async () => {
    setup(order({ status: "paid" }), {
      history: [step({ id: 1, fromStatus: "pending_payment", toStatus: "paid" })],
    });
    await group();
    expect(screen.queryByRole("button", { name: "Deshacer último paso" })).not.toBeInTheDocument();
  });

  it("no se ofrece en estados que mueven stock o dinero (pagado, cancelado)", async () => {
    setup(order({ status: "cancelled" }), {
      history: [step({ id: 2, fromStatus: "paid", toStatus: "cancelled" })],
    });
    await group();
    expect(screen.queryByRole("button", { name: "Deshacer último paso" })).not.toBeInTheDocument();
  });

  it("si ya pasó la ventana, la base lo dice y se muestra", async () => {
    setup(order({ status: "preparing" }), { history: preparing });
    api.undoTransition.mockResolvedValue({ ok: false, outcome: "window_expired" });
    await userEvent.click(await screen.findByRole("button", { name: "Deshacer último paso" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Pasó el tiempo para deshacer este cambio."),
    );
  });
});

describe("OrderDetailPage · reembolsos solicitados", () => {
  it("un reembolso solicitado se puede marcar como devuelto o descartar", async () => {
    const refund: RefundRow = {
      id: "r-1",
      orderId: "o-1",
      kind: "items",
      amount: 90,
      shippingAmount: 0,
      deduction: 0,
      currency: "BOB",
      reason: "Devolvió una prenda",
      status: "requested",
      method: "bank_transfer",
      destination: null,
      externalRef: null,
      returnId: null,
      createdAt: "2026-11-11T10:00:00Z",
      processedAt: null,
      decisionNote: null,
    };
    setup(order(), { refunds: [refund] });
    api.processRefund.mockResolvedValue({ outcome: "processed" });
    expect(await screen.findByText("Devolvió una prenda")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descartar" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Marcar como devuelto" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Confirma que ya devolviste Bs 90,00/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Referencia de la devolución/), "TRX-1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Marcar como devuelto" }));
    await waitFor(() => expect(api.processRefund).toHaveBeenCalledWith("r-1", "TRX-1", null));
  });

  it("uno ya devuelto no ofrece acciones", async () => {
    const done: RefundRow = {
      id: "r-2",
      orderId: "o-1",
      kind: "cancel",
      amount: 255,
      shippingAmount: 15,
      deduction: 0,
      currency: "BOB",
      reason: "Cancelado",
      status: "processed",
      method: "cash",
      destination: null,
      externalRef: "TRX-9",
      returnId: null,
      createdAt: "2026-11-11T10:00:00Z",
      processedAt: "2026-11-11T11:00:00Z",
      decisionNote: null,
    };
    setup(order(), { refunds: [done] });
    expect(await screen.findByText("Devuelto")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Descartar" })).not.toBeInTheDocument();
  });
});
