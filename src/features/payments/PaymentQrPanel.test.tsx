import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSnapshot, renderWithCart, signedIn } from "@/features/cart/cart-test-utils";
import { PaymentQrPanel } from "./PaymentQrPanel";

const api = vi.hoisted(() => ({
  getPaymentView: vi.fn(),
  qrImageUrl: vi.fn((path: string) => `https://cdn.test/${path}`),
  uploadProof: vi.fn(),
  retryPayment: vi.fn(),
  listOrderLines: vi.fn(),
}));
vi.mock("./paymentsApi", () => api);

const RAW = {
  outcome: "ok",
  server_now: new Date().toISOString(),
  order: {
    id: "o-1",
    number: "MIC-000123",
    status: "pending_payment",
    total: 255,
    currency: "BOB",
    payment_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  },
  payment: {
    id: "p-1",
    status: "pending",
    provider: "manual_qr",
    method: "qr_manual",
    reference: "MIC-000123",
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
    account_details: "Banco Ejemplo\nCuenta 123-456",
    qr_image_path: "qr/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.png",
  },
  proof: null,
  can_upload: true,
  can_retry: false,
};
const proof = (status: string, reason: string | null = null) => ({
  status,
  reason,
  created_at: "2026-11-10T12:00:00Z",
  reviewed_at: null,
  mime: "image/jpeg",
});

function setView(over: Record<string, unknown> = {}) {
  api.getPaymentView.mockImplementation(async () => {
    const { parsePaymentView } = await import("./paymentsMapping");
    return parsePaymentView({ ...RAW, ...over });
  });
}
const auth = () => signedIn({ profile: { id: "user-1" } as never });
const renderPanel = () =>
  renderWithCart(<PaymentQrPanel orderId="o-1" />, {
    snapshot: makeSnapshot([]),
    auth: auth(),
    path: "/pedido/MIC-000123",
  });

beforeEach(() => {
  vi.clearAllMocks();
  api.qrImageUrl.mockImplementation((path: string) => `https://cdn.test/${path}`);
});

describe("PaymentQrPanel · esperando el pago", () => {
  it("muestra el QR, el monto exacto, la referencia, la cuenta, la cuenta regresiva y la subida del comprobante", async () => {
    setView();
    renderPanel();
    expect(await screen.findByRole("heading", { name: "Paga con QR" })).toBeInTheDocument();
    expect(screen.getByText("Falta tu pago")).toBeInTheDocument();
    expect(screen.getByAltText("Código QR para pagar el pedido MIC-000123")).toHaveAttribute(
      "src",
      "https://cdn.test/qr/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.png",
    );
    expect(screen.getByTestId("payment-amount")).toHaveTextContent("Bs 255,00");
    expect(screen.getByTestId("payment-reference")).toHaveTextContent("MIC-000123");
    expect(screen.getByText(/Banco Ejemplo/)).toBeInTheDocument();
    expect(screen.getByTestId("payment-countdown")).toHaveTextContent(/^2[34]:\d\d:\d\d$/);
    expect(screen.getByRole("heading", { name: "Sube tu comprobante" })).toBeInTheDocument();
    expect(screen.getByText(/Toma una captura o foto del comprobante/)).toBeInTheDocument();
  });

  it("un cobro de tipo automático (qr_api) NO promete «se confirma solo»: la interfaz solo explica el pago manual", async () => {
    setView({ payment: { ...RAW.payment, provider: "qr_api" } });
    renderPanel();
    expect(await screen.findByText(/Toma una captura o foto del comprobante/)).toBeInTheDocument();
    expect(screen.queryByText(/se confirma solo/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sube tu comprobante" })).toBeInTheDocument();
  });

  it("copiar la referencia la deja en el portapapeles y lo avisa", async () => {
    setView();
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    renderPanel();
    await user.click(
      await screen.findByRole("button", { name: "Copiar la referencia MIC-000123" }),
    );
    expect(writeText).toHaveBeenCalledWith("MIC-000123");
    expect(await screen.findByRole("button", { name: "Copiada" })).toBeInTheDocument();
  });

  it("sin imagen de QR configurada avisa en vez de mostrar una imagen rota", async () => {
    setView({ method: { ...RAW.method, qr_image_path: null } });
    renderPanel();
    expect(await screen.findByText(/Todavía no hay un código QR disponible/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("PaymentQrPanel · estados del pago", () => {
  it("comprobante en revisión: lo dice y NO deja subir otro", async () => {
    setView({ proof: proof("pending"), can_upload: false });
    renderPanel();
    expect(await screen.findByText("Recibimos tu comprobante")).toBeInTheDocument();
    expect(screen.getByText(/Tu pedido sigue reservado/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sube tu comprobante" })).not.toBeInTheDocument();
  });

  it("comprobante rechazado: muestra el motivo y deja subir otro", async () => {
    setView({ proof: proof("rejected", "No se ve el monto") });
    renderPanel();
    expect(await screen.findByText("No pudimos aceptar tu comprobante")).toBeInTheDocument();
    expect(screen.getByText(/Motivo: No se ve el monto — puedes subir otro/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sube tu comprobante" })).toBeInTheDocument();
  });

  it("pago en revisión (monto distinto): tranquiliza y no pide nada", async () => {
    setView({ payment: { ...RAW.payment, under_review: true }, can_upload: false });
    renderPanel();
    expect(await screen.findByText("Estamos revisando tu pago")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enviar comprobante/ })).not.toBeInTheDocument();
  });

  it("pago confirmado: sin QR ni subida", async () => {
    setView({
      order: { ...RAW.order, status: "paid" },
      payment: { ...RAW.payment, status: "paid" },
      can_upload: false,
    });
    renderPanel();
    expect(await screen.findByText("Pago confirmado")).toBeInTheDocument();
    expect(screen.getByText("Gracias. Ya estamos con tu pedido MIC-000123.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-countdown")).not.toBeInTheDocument();
  });

  it("pedido vencido: explica y ofrece «Volver a pedir»", async () => {
    setView({
      order: { ...RAW.order, status: "cancelled" },
      payment: { ...RAW.payment, status: "expired" },
      can_upload: false,
    });
    renderPanel();
    expect(await screen.findByText("El tiempo para pagar terminó")).toBeInTheDocument();
    expect(screen.getByText(/devolvimos los productos al inventario/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver a pedir" })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("pago que llegó con el pedido cancelado: dice que se está revisando y que no pague otra vez", async () => {
    setView({
      order: { ...RAW.order, status: "cancelled" },
      payment: { ...RAW.payment, status: "paid", under_review: true },
      can_upload: false,
    });
    renderPanel();
    expect(
      await screen.findByText(/Recibimos un pago de un pedido que ya estaba cancelado/),
    ).toBeInTheDocument();
    expect(screen.getByText(/No hagas otro pago/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Volver a pedir" })).not.toBeInTheDocument();
  });

  it("…y cuando el administrador ya lo resolvió deja de decir «lo estamos revisando»", async () => {
    setView({
      order: { ...RAW.order, status: "cancelled" },
      payment: { ...RAW.payment, status: "paid", under_review: false },
      can_upload: false,
    });
    renderPanel();
    expect(
      await screen.findByText("Resolvimos tu pago de un pedido cancelado"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Lo estamos revisando/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No hagas otro pago/)).not.toBeInTheDocument();
  });

  it("contracargo: no se ofrece reintentar", async () => {
    setView({ payment: { ...RAW.payment, status: "disputed" }, can_upload: false });
    renderPanel();
    expect(await screen.findByText("Hay un reclamo sobre este pago")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Intentar pagar de nuevo" }),
    ).not.toBeInTheDocument();
  });

  it("cobro fallido con permiso de reintento: pide un cobro nuevo y vuelve a leer", async () => {
    setView({ payment: { ...RAW.payment, status: "failed" }, can_upload: false, can_retry: true });
    api.retryPayment.mockResolvedValue({ ok: true });
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Intentar pagar de nuevo" }));
    await waitFor(() => expect(api.retryPayment).toHaveBeenCalledWith("o-1"));
    await waitFor(() => expect(api.getPaymentView.mock.calls.length).toBeGreaterThan(1));
  });

  it("cobro fallido sin permiso de reintento: no hay botón", async () => {
    setView({ payment: { ...RAW.payment, status: "failed" }, can_upload: false, can_retry: false });
    renderPanel();
    expect(await screen.findByText("No se pudo completar el pago")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Intentar pagar de nuevo" }),
    ).not.toBeInTheDocument();
  });

  it("si el reintento falla, lo explica", async () => {
    setView({ payment: { ...RAW.payment, status: "failed" }, can_upload: false, can_retry: true });
    api.retryPayment.mockResolvedValue({ ok: false, problem: "too_many_attempts" });
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Intentar pagar de nuevo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("máximo de intentos");
  });
});

describe("PaymentQrPanel · lo que no pinta", () => {
  it("un pedido que no se paga con QR no muestra nada", async () => {
    setView({ method: null, payment: { ...RAW.payment, provider: "whatsapp" }, can_upload: false });
    const { container } = renderPanel();
    await waitFor(() => expect(api.getPaymentView).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        within(container).queryByText("Cargando los datos de tu pago…"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { name: "Paga con QR" })).not.toBeInTheDocument();
  });

  it("un pedido que no existe o no es suyo no muestra nada", async () => {
    api.getPaymentView.mockResolvedValue(null);
    renderPanel();
    await waitFor(() => expect(api.getPaymentView).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { name: "Paga con QR" })).not.toBeInTheDocument();
  });

  it("si la lectura falla ofrece reintentar (no se queda en blanco)", async () => {
    api.getPaymentView.mockRejectedValueOnce(new Error("sin red"));
    setView();
    api.getPaymentView.mockRejectedValueOnce(new Error("sin red"));
    renderPanel();
    expect(await screen.findByText("No pudimos cargar los datos de tu pago")).toBeInTheDocument();
  });
});
