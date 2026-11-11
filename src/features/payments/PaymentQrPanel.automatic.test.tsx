import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSnapshot, renderWithCart, signedIn } from "@/features/cart/cart-test-utils";
import { PaymentQrPanel } from "./PaymentQrPanel";

/**
 * Con el interruptor ENCENDIDO (`AUTOMATIC_QR_IN_UI = true`): la pantalla de la clienta dice que el pago se confirma solo.
 * `PaymentQrPanel.test.tsx` cubre el apagado (lo que se ve hoy).
 */
vi.mock("./automaticQr", () => ({ AUTOMATIC_QR_IN_UI: true }));

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
    provider: "qr_api",
    method: "qr_auto",
    reference: "MIC-000123",
    amount: 255,
    currency: "BOB",
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    paid_at: null,
    under_review: false,
  },
  method: {
    code: "qr_auto",
    name: "Pago con QR",
    description: null,
    account_details: "Banco Ejemplo\nCuenta 123-456",
    qr_image_path: "qr/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.png",
  },
  proof: null,
  can_upload: true,
  can_retry: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.qrImageUrl.mockImplementation((path: string) => `https://cdn.test/${path}`);
  api.getPaymentView.mockImplementation(async () => {
    const { parsePaymentView } = await import("./paymentsMapping");
    return parsePaymentView(RAW);
  });
});

describe("PaymentQrPanel · con el QR automático encendido", () => {
  it("un cobro qr_api dice que se confirma solo, pero deja subir comprobante", async () => {
    renderWithCart(<PaymentQrPanel orderId="o-1" />, {
      snapshot: makeSnapshot([]),
      auth: signedIn({ profile: { id: "user-1" } as never }),
      path: "/pedido/MIC-000123",
    });
    expect(await screen.findByText(/Tu pago se confirma solo/)).toBeInTheDocument();
    expect(screen.queryByText(/Toma una captura o foto del comprobante/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sube tu comprobante" })).toBeInTheDocument();
  });
});
