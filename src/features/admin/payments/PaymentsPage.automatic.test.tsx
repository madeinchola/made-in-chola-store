import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentsPage } from "./PaymentsPage";
import type { PaymentRow } from "./types";

/**
 * Con el interruptor ENCENDIDO (`AUTOMATIC_QR_IN_UI = true`): lo que hoy la interfaz esconde. Prueba que el cobro QR automático sigue
 * soportado por el código y que bastará con encenderlo cuando haya proveedor. Las pruebas de `PaymentsPage.test.tsx` cubren el apagado.
 */
vi.mock("@/features/payments/automaticQr", () => ({ AUTOMATIC_QR_IN_UI: true }));

const api = vi.hoisted(() => ({
  listPayments: vi.fn(),
  listPaymentEvents: vi.fn(),
  listProofHistory: vi.fn(),
  signedProofUrl: vi.fn(),
  confirmPaymentManually: vi.fn(),
  reconcileNow: vi.fn(),
}));
vi.mock("./api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const row = (over: Partial<PaymentRow> = {}): PaymentRow => ({
  id: "pay-1",
  orderId: "o-1",
  orderNumber: "MIC-000123",
  orderStatus: "pending_payment",
  contactName: "Ana Pérez",
  provider: "qr_api",
  method: "qr_auto",
  status: "pending",
  amount: 255,
  currency: "BOB",
  reference: "MIC-000123",
  attempt: 1,
  createdAt: "2026-11-10T12:00:00Z",
  expiresAt: "2026-11-11T12:00:00Z",
  paidAt: null,
  receivedAmount: null,
  externalId: "ext-1",
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PaymentsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listPayments.mockResolvedValue({ rows: [row()], total: 1 });
  api.listPaymentEvents.mockResolvedValue([]);
  api.listProofHistory.mockResolvedValue([]);
  api.signedProofUrl.mockResolvedValue("https://signed.test/f.jpg");
});

describe("PaymentsPage · con el QR automático encendido", () => {
  it("el cobro automático se ve como «QR automático» y el filtro lo ofrece y lo manda", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Cobros" });
    expect(within(table).getByText("QR automático")).toBeInTheDocument();
    const options = within(screen.getByLabelText("Método"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["Todos", "QR manual", "QR automático", "WhatsApp", "Contra entrega"]);
    await userEvent.selectOptions(screen.getByLabelText("Método"), "qr_api");
    await waitFor(() =>
      expect(api.listPayments).toHaveBeenLastCalledWith({
        status: "all",
        provider: "qr_api",
        page: 0,
      }),
    );
  });

  it("el detalle muestra el «Id del proveedor»", async () => {
    renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: "Ver detalle del cobro MIC-000123" }),
    );
    const dialog = within(await screen.findByRole("dialog", { name: "Cobro MIC-000123" }));
    expect(dialog.getByText("Id del proveedor")).toBeInTheDocument();
    expect(dialog.getByText("ext-1")).toBeInTheDocument();
  });

  it("«Conciliar ahora» avisa cuántos cobros revisó y cuántos cambiaron", async () => {
    api.reconcileNow.mockResolvedValue({ checked: 4, changed: 1, errors: 0, unsupported: 0 });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Conciliar ahora" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Revisamos 4 cobros y cambiaron 1."),
    );
  });

  it("sin nada que revisar lo dice con claridad", async () => {
    api.reconcileNow.mockResolvedValue({ checked: 0, changed: 0, errors: 0, unsupported: 0 });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Conciliar ahora" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("hoy ninguno lo permite")),
    );
  });

  it("si falla, lo dice y deja reintentar", async () => {
    api.reconcileNow.mockRejectedValue(new Error("boom"));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Conciliar ahora" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Conciliar ahora" })).toBeEnabled();
  });
});
