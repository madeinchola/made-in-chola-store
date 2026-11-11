import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { asCustomer, customerProfile, WithAuth } from "@/test/auth-test-utils";
import { money } from "@/lib/money";
import { parsePaymentView } from "@/features/payments/paymentsMapping";
import { OrderDetailPage, OrderDetailView } from "./OrderDetailPage";
import type { OrderRow } from "./ordersApi";
import type { OrderDetail } from "./types";

const getOrderById = vi.hoisted(() => vi.fn());
vi.mock("./ordersApi", async (original) => ({
  ...(await original<typeof import("./ordersApi")>()),
  getOrderById,
}));
const getPaymentView = vi.hoisted(() => vi.fn());
vi.mock("@/features/payments/paymentsApi", () => ({
  getPaymentView,
  qrImageUrl: (path: string) => `https://cdn.test/${path}`,
  uploadProof: vi.fn(),
  retryPayment: vi.fn(),
  listOrderLines: vi.fn(),
}));
const PAYMENT_VIEW = {
  outcome: "ok",
  server_now: new Date().toISOString(),
  order: {
    id: "11111111-2222-4333-8444-666666666666",
    number: "MIC-000124",
    status: "pending_payment",
    total: 255,
    currency: "BOB",
    payment_expires_at: null,
  },
  payment: {
    id: "p-1",
    status: "pending",
    provider: "manual_qr",
    method: "qr_manual",
    reference: "MIC-000124",
    amount: 255,
    currency: "BOB",
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    paid_at: null,
    under_review: false,
  },
  method: {
    code: "qr_manual",
    name: "Pago con QR",
    description: null,
    account_details: "Banco Ejemplo",
    qr_image_path: "qr/x.png",
  },
  proof: null,
  can_upload: true,
  can_retry: false,
};

const ORDER: OrderDetail = {
  id: "o-1",
  number: "MIC-000123",
  createdAt: "2026-10-30T15:30:00Z",
  status: "shipped",
  total: money(25100, "BOB"),
  items: [
    {
      id: "l-1",
      name: "Chaqueta de lana",
      variant: "Negro · M",
      quantity: 2,
      total: money(20000, "BOB"),
    },
    { id: "l-2", name: "Sombrero", variant: null, quantity: 1, total: money(5100, "BOB") },
  ],
  shipping: { label: "Entrega a domicilio", address: "Calle Uno 123, La Paz" },
  payment: { label: "Transferencia bancaria" },
};

const UUID = "11111111-2222-4333-8444-555555555555";
const parsedView = () => parsePaymentView(PAYMENT_VIEW);
const UUID_QR = "11111111-2222-4333-8444-666666666666";

const ROW: OrderRow = {
  id: UUID,
  number: "MIC-000123",
  status: "pending_payment",
  currency: "BOB",
  subtotal: 240,
  discount_total: 24,
  shipping_cost: 15,
  shipping_discount: 0,
  total: 231,
  contact_name: "Ana Pérez",
  shipping_method: { code: "delivery", name: "Entrega a domicilio", kind: "delivery" },
  shipping_address: { line1: "Calle 1", line2: null, city: "La Paz" },
  delivery_slot: { date: "2026-12-01", start: "10:00", end: "12:00" },
  payment_method: "whatsapp",
  coupon_code: "VERANO20",
  created_at: "2026-11-09T15:30:00Z",
  order_items: [
    {
      id: "i2",
      line_no: 2,
      product_name: "Gorro",
      color_name: null,
      size_label: null,
      qty: 1,
      unit_price: 40,
      final_total: 36,
    },
    {
      id: "i1",
      line_no: 1,
      product_name: "Camisa",
      color_name: "Celeste",
      size_label: "S",
      qty: 2,
      unit_price: 100,
      final_total: 180,
    },
  ],
  order_status_history: [
    { id: 1, to_status: "pending_payment", created_at: "2026-11-09T15:30:00Z" },
  ],
};

const renderAt = (path: string, ui: React.ReactElement = <OrderDetailPage />) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <WithAuth value={asCustomer()}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/cuenta/pedidos/:orderId" element={ui} />
          </Routes>
        </MemoryRouter>
      </WithAuth>
    </QueryClientProvider>,
  );

describe("OrderDetailPage (S10: pedido real)", () => {
  beforeEach(() => getOrderById.mockReset());

  it("lee el pedido de la clienta por el id de la URL y muestra el desglose del servidor", async () => {
    getOrderById.mockResolvedValue(ROW);
    renderAt(`/cuenta/pedidos/${UUID}`);
    expect(await screen.findByRole("heading", { name: "Pedido MIC-000123" })).toBeInTheDocument();
    expect(getOrderById).toHaveBeenCalledWith(customerProfile.id, UUID);
    // líneas en el orden del pedido (no el de llegada), variante y precio por unidad
    const items = screen
      .getAllByRole("listitem")
      .filter((li) => li.textContent?.includes("Cantidad"));
    expect(items.map((li) => li.querySelector("p")?.textContent)).toEqual(["Camisa", "Gorro"]);
    expect(items[0]).toHaveTextContent("Celeste · S");
    expect(items[0]).toHaveTextContent("Bs 100,00 c/u");
    expect(items[0]).toHaveTextContent("Bs 180,00");
    // desglose: subtotal 240 − descuento 24 + envío 15 = 231
    expect(screen.getByText("Subtotal").nextElementSibling).toHaveTextContent("Bs 240,00");
    expect(screen.getByText(/^Descuento/).nextElementSibling).toHaveTextContent("−Bs 24,00");
    expect(screen.getByText(/Cupón: VERANO20/)).toBeInTheDocument();
    expect(screen.getAllByText("Envío")[1]!.nextElementSibling).toHaveTextContent("Bs 15,00");
    expect(screen.getByText("Total", { selector: "dt" }).nextElementSibling).toHaveTextContent(
      "Bs 231,00",
    );
    expect(screen.getByText("Entrega a domicilio")).toBeInTheDocument();
    expect(screen.getByText("Calle 1, La Paz")).toBeInTheDocument();
    expect(screen.getByText("Fecha y franja: mar 1 dic, 10:00 a 12:00")).toBeInTheDocument();
    expect(screen.getByText("Pedido por WhatsApp")).toBeInTheDocument();
  });

  it("el envío gratis (descuento de envío = costo) se muestra «Gratis», no 0,00", async () => {
    getOrderById.mockResolvedValue({ ...ROW, shipping_discount: 15, total: 216 });
    renderAt(`/cuenta/pedidos/${UUID}`);
    await screen.findByRole("heading", { name: "Pedido MIC-000123" });
    expect(screen.getAllByText("Envío")[1]!.nextElementSibling).toHaveTextContent("Gratis");
  });

  it("muestra el seguimiento con el paso actual marcado", async () => {
    getOrderById.mockResolvedValue({
      ...ROW,
      status: "shipped",
      order_status_history: [
        { id: 3, to_status: "shipped", created_at: "2026-11-11T10:00:00Z" },
        { id: 1, to_status: "pending_payment", created_at: "2026-11-09T15:30:00Z" },
        { id: 2, to_status: "paid", created_at: "2026-11-10T09:00:00Z" },
      ],
    });
    renderAt(`/cuenta/pedidos/${UUID}`);
    const timeline = await screen.findByRole("list", { name: "Seguimiento" });
    const steps = within(timeline).getAllByRole("listitem");
    expect(steps.map((li) => li.querySelector("p")?.textContent)).toEqual([
      "Pedido recibido",
      "Pedido confirmado",
      "Enviado",
    ]);
    expect(steps[2]).toHaveAttribute("aria-current", "step");
    expect(steps[0]).not.toHaveAttribute("aria-current");
  });

  it("«Cancelar el pedido» solo aparece mientras se puede (antes de «preparing»)", async () => {
    getOrderById.mockResolvedValue(ROW);
    const { unmount } = renderAt(`/cuenta/pedidos/${UUID}`);
    expect(await screen.findByRole("button", { name: "Cancelar el pedido" })).toBeInTheDocument();
    unmount();
    for (const status of [
      "preparing",
      "shipped",
      "delivered",
      "completed",
      "cancelled",
      "refunded",
    ]) {
      getOrderById.mockResolvedValue({ ...ROW, status });
      const view = renderAt(`/cuenta/pedidos/${UUID}`);
      await screen.findByRole("heading", { name: "Pedido MIC-000123" });
      expect(
        screen.queryByRole("button", { name: "Cancelar el pedido" }),
        status,
      ).not.toBeInTheDocument();
      view.unmount();
    }
    getOrderById.mockResolvedValue({ ...ROW, status: "paid" });
    renderAt(`/cuenta/pedidos/${UUID}`);
    expect(await screen.findByRole("button", { name: "Cancelar el pedido" })).toBeInTheDocument();
  });

  it("el botón abre la confirmación y NO cancela hasta confirmar", async () => {
    getOrderById.mockResolvedValue(ROW);
    renderAt(`/cuenta/pedidos/${UUID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar el pedido" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Cancelar el pedido MIC-000123?" });
    expect(within(dialog).getByRole("button", { name: "No, conservar" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Sí, cancelar pedido" })).toBeInTheDocument();
  });

  it("un pedido que no existe o no es de la clienta es «Pedido no encontrado», con camino de vuelta", async () => {
    getOrderById.mockResolvedValue(null);
    renderAt(`/cuenta/pedidos/${UUID}`);
    expect(await screen.findByText("Pedido no encontrado")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a mis pedidos" })).toHaveAttribute(
      "href",
      "/cuenta/pedidos",
    );
  });

  it("no repite el id de la URL en la pantalla cuando no existe", async () => {
    getOrderById.mockResolvedValue(null);
    renderAt("/cuenta/pedidos/secreto-123");
    await screen.findByText("Pedido no encontrado");
    expect(document.body).not.toHaveTextContent("secreto-123");
  });

  it("un fallo de lectura ofrece reintentar (no dice que el pedido no existe)", async () => {
    getOrderById.mockRejectedValueOnce(new Error("sin red")).mockResolvedValueOnce(ROW);
    renderAt(`/cuenta/pedidos/${UUID}`);
    expect(await screen.findByText("No pudimos cargar tus pedidos")).toBeInTheDocument();
    expect(screen.queryByText("Pedido no encontrado")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(await screen.findByRole("heading", { name: "Pedido MIC-000123" })).toBeInTheDocument();
  });

  it("tiene migas: Mi cuenta › Mis pedidos › (página actual)", async () => {
    getOrderById.mockResolvedValue(null);
    renderAt(`/cuenta/pedidos/${UUID}`);
    const nav = await screen.findByRole("navigation", { name: "Ruta de tu pedido" });
    expect(within(nav).getByRole("link", { name: "Mi cuenta" })).toHaveAttribute("href", "/cuenta");
    expect(within(nav).getByRole("link", { name: "Mis pedidos" })).toHaveAttribute(
      "href",
      "/cuenta/pedidos",
    );
    expect(within(nav).getByText("Detalle del pedido")).toHaveAttribute("aria-current", "page");
  });
});

describe("OrderDetailPage · pago con QR (S11)", () => {
  const QR_ROW = {
    ...ROW,
    id: UUID_QR,
    number: "MIC-000124",
    payment_method: "qr_manual",
    total: 255,
  };
  beforeEach(() => {
    getOrderById.mockReset();
    getPaymentView.mockReset();
  });

  it("un pedido por QR muestra la pantalla de pago ENCIMA del detalle, y las dos aparecen a la vez", async () => {
    getOrderById.mockResolvedValue(QR_ROW);
    getPaymentView.mockResolvedValue(parsedView());
    renderAt(`/cuenta/pedidos/${UUID_QR}`);
    expect(await screen.findByRole("heading", { name: "Paga con QR" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pedido MIC-000124" })).toBeInTheDocument();
    expect(screen.getByText("Pago con QR", { selector: "p" })).toBeInTheDocument();
  });

  it("hasta tener el pago NO pinta el detalle (si llegara después, lo empujaría hacia abajo)", async () => {
    getOrderById.mockResolvedValue(QR_ROW);
    let finish: (value: unknown) => void = () => {};
    getPaymentView.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderAt(`/cuenta/pedidos/${UUID_QR}`);
    await waitFor(() => expect(getPaymentView).toHaveBeenCalledWith(UUID_QR));
    expect(screen.queryByRole("heading", { name: "Pedido MIC-000124" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando tus pedidos…");
    finish(parsedView());
    expect(await screen.findByRole("heading", { name: "Pedido MIC-000124" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Paga con QR" })).toBeInTheDocument();
  });

  it("un pedido que NO es por QR no pide nada del pago", async () => {
    getOrderById.mockResolvedValue(ROW);
    renderAt(`/cuenta/pedidos/${UUID}`);
    expect(await screen.findByRole("heading", { name: "Pedido MIC-000123" })).toBeInTheDocument();
    expect(getPaymentView).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Paga con QR" })).not.toBeInTheDocument();
  });
});

describe("OrderDetailView (presentacional)", () => {
  it("cabecera: número, estado con texto y fecha", () => {
    renderAt("/cuenta/pedidos/o-1", <OrderDetailView order={ORDER} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Pedido MIC-000123" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Enviado")).toBeInTheDocument();
    expect(screen.getByText(/Realizado el/)).toHaveTextContent(/30.*oct.*2026/i);
  });

  it("migas con la página actual marcada", () => {
    renderAt("/cuenta/pedidos/o-1", <OrderDetailView order={ORDER} />);
    const nav = screen.getByRole("navigation", { name: "Ruta de tu pedido" });
    expect(within(nav).getByText("Pedido MIC-000123")).toHaveAttribute("aria-current", "page");
  });

  it("artículos con variante, cantidad y total; envío; pago; y el total del pedido", () => {
    renderAt("/cuenta/pedidos/o-1", <OrderDetailView order={ORDER} />);
    const items = screen
      .getAllByRole("listitem")
      .filter((li) => li.closest("ul") && li.textContent?.includes("Cantidad"));
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Chaqueta de lana");
    expect(items[0]).toHaveTextContent("Negro · M");
    expect(items[0]).toHaveTextContent("Cantidad: 2");
    expect(items[0]).toHaveTextContent("Bs 200,00");
    expect(items[1]).toHaveTextContent("Sombrero");
    expect(items[1]).toHaveTextContent("Bs 51,00");
    expect(screen.getByText("Entrega a domicilio")).toBeInTheDocument();
    expect(screen.getByText("Calle Uno 123, La Paz")).toBeInTheDocument();
    expect(screen.getByText("Transferencia bancaria")).toBeInTheDocument();
    expect(screen.getByText("Total").parentElement).toHaveTextContent("Bs 251,00");
  });

  it("secciones sin datos dicen que no hay información (no quedan vacías)", () => {
    renderAt(
      "/cuenta/pedidos/o-1",
      <OrderDetailView order={{ ...ORDER, items: [], shipping: null, payment: null }} />,
    );
    expect(screen.getByText("Este pedido no tiene artículos.")).toBeInTheDocument();
    expect(screen.getByText("Sin información de envío.")).toBeInTheDocument();
    expect(screen.getByText("Sin información de pago.")).toBeInTheDocument();
  });

  it("envío sin dirección no deja un hueco", () => {
    renderAt(
      "/cuenta/pedidos/o-1",
      <OrderDetailView
        order={{ ...ORDER, shipping: { label: "Recojo en tienda", address: null } }}
      />,
    );
    expect(screen.getByText("Recojo en tienda")).toBeInTheDocument();
    expect(screen.queryByText("Calle Uno 123, La Paz")).not.toBeInTheDocument();
  });
});
