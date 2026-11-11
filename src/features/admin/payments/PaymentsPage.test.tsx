import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentsPage } from "./PaymentsPage";
import type { PaymentEvent, PaymentRow, ProofHistoryRow } from "./types";

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
  provider: "manual_qr",
  method: "qr_manual",
  status: "pending",
  amount: 255,
  currency: "BOB",
  reference: "MIC-000123",
  attempt: 1,
  createdAt: "2026-11-10T12:00:00Z",
  expiresAt: "2026-11-11T12:00:00Z",
  paidAt: null,
  receivedAmount: null,
  externalId: null,
  ...over,
});
const event = (over: Partial<PaymentEvent> = {}): PaymentEvent => ({
  id: 1,
  provider: "qr_api",
  eventId: "evt-1",
  outcome: "applied",
  error: null,
  attempts: 1,
  receivedAt: "2026-11-10T13:00:00Z",
  signatureValid: true,
  ...over,
});
const proofRow = (over: Partial<ProofHistoryRow> = {}): ProofHistoryRow => ({
  id: "pr-1",
  status: "rejected",
  reason: "Borroso",
  createdAt: "2026-11-10T12:30:00Z",
  reviewedAt: "2026-11-10T12:40:00Z",
  mime: "image/jpeg",
  filePath: "u/o/f.jpg",
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
  api.listPayments.mockResolvedValue({
    rows: [
      row(),
      row({
        id: "pay-2",
        orderNumber: "MIC-000124",
        reference: "MIC-000124",
        status: "paid",
        contactName: "Bia",
      }),
    ],
    total: 2,
  });
  api.listPaymentEvents.mockResolvedValue([event()]);
  api.listProofHistory.mockResolvedValue([proofRow()]);
  api.signedProofUrl.mockResolvedValue("https://signed.test/f.jpg");
});

describe("PaymentsPage · lista", () => {
  it("lista los cobros con su estado, monto y referencia", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Cobros" });
    expect(within(table).getByText("MIC-000123", { selector: "p" })).toBeInTheDocument();
    expect(within(table).getAllByText("Bs 255,00").length).toBe(2);
    expect(within(table).getByText("Pendiente")).toBeInTheDocument();
    expect(within(table).getByText("Pagado")).toBeInTheDocument();
    expect(within(table).getAllByText("QR manual").length).toBe(2);
  });

  it("filtra por estado y por método y vuelve a la primera página (aunque se esté en la segunda)", async () => {
    api.listPayments.mockResolvedValue({ rows: [row()], total: 60 });
    renderPage();
    await screen.findByRole("table", { name: "Cobros" });
    await userEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() =>
      expect(api.listPayments).toHaveBeenLastCalledWith({
        status: "all",
        provider: "all",
        page: 1,
      }),
    );
    await userEvent.selectOptions(screen.getByLabelText("Estado"), "paid");
    await waitFor(() =>
      expect(api.listPayments).toHaveBeenLastCalledWith({
        status: "paid",
        provider: "all",
        page: 0,
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() =>
      expect(api.listPayments).toHaveBeenLastCalledWith({
        status: "paid",
        provider: "all",
        page: 1,
      }),
    );
    await userEvent.selectOptions(screen.getByLabelText("Método"), "whatsapp");
    await waitFor(() =>
      expect(api.listPayments).toHaveBeenLastCalledWith({
        status: "paid",
        provider: "whatsapp",
        page: 0,
      }),
    );
  });

  it("sin resultados lo dice", async () => {
    api.listPayments.mockResolvedValue({ rows: [], total: 0 });
    renderPage();
    expect(await screen.findByText("No hay cobros con esos filtros.")).toBeInTheDocument();
  });

  it("pagina de 25 en 25", async () => {
    api.listPayments.mockResolvedValue({ rows: [row()], total: 60 });
    renderPage();
    await screen.findByRole("table", { name: "Cobros" });
    await userEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() =>
      expect(api.listPayments).toHaveBeenLastCalledWith({
        status: "all",
        provider: "all",
        page: 1,
      }),
    );
  });

  it("si falla la lectura ofrece reintentar", async () => {
    api.listPayments.mockRejectedValueOnce(new Error("sin red"));
    renderPage();
    const retry = await screen.findByRole("button", { name: "Reintentar" });
    await userEvent.click(retry);
    expect(await screen.findByRole("table", { name: "Cobros" })).toBeInTheDocument();
  });
});

describe("PaymentsPage · detalle", () => {
  const open = async () => {
    renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: "Ver detalle del cobro MIC-000123" }),
    );
    return screen.findByRole("dialog", { name: "Cobro MIC-000123" });
  };

  it("muestra los datos del cobro, los avisos recibidos y los comprobantes con su motivo", async () => {
    const dialog = within(await open());
    expect(dialog.getByText("Pedido MIC-000123 · Ana Pérez")).toBeInTheDocument();
    expect(await dialog.findByText("evt-1")).toBeInTheDocument();
    expect(dialog.getByText("Aplicado")).toBeInTheDocument();
    expect(await dialog.findByText("Motivo: Borroso")).toBeInTheDocument();
    expect(dialog.getByText("Rechazado")).toBeInTheDocument();
    expect(api.listPaymentEvents).toHaveBeenCalledWith("pay-1");
    expect(api.listProofHistory).toHaveBeenCalledWith("pay-1");
  });

  it("un aviso repetido muestra cuántas veces llegó; sin avisos lo dice", async () => {
    api.listPaymentEvents.mockResolvedValue([event({ attempts: 3, outcome: "duplicate" })]);
    const dialog = within(await open());
    expect(await dialog.findByText(/Repetido · Veces recibido: 3/)).toBeInTheDocument();
  });
  it("sin avisos ni comprobantes lo dice", async () => {
    api.listPaymentEvents.mockResolvedValue([]);
    api.listProofHistory.mockResolvedValue([]);
    const dialog = within(await open());
    expect(await dialog.findByText("No llegó ningún aviso para este cobro.")).toBeInTheDocument();
    expect(await dialog.findByText("No subió ningún comprobante.")).toBeInTheDocument();
  });

  it("confirmar a mano solo se ofrece en un cobro que se puede confirmar (no en uno pagado)", async () => {
    renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: "Ver detalle del cobro MIC-000124" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Cobro MIC-000124" });
    expect(
      within(dialog).queryByRole("button", { name: "Confirmar el pago a mano" }),
    ).not.toBeInTheDocument();
  });

  it("confirmar a mano: pide monto opcional y nota, llama al servidor y avisa", async () => {
    api.confirmPaymentManually.mockResolvedValue({ outcome: "applied" });
    const dialog = within(await open());
    await userEvent.click(dialog.getByRole("button", { name: "Confirmar el pago a mano" }));
    const form = await screen.findByRole("dialog", { name: "Confirmar el pago MIC-000123 a mano" });
    await userEvent.type(within(form).getByLabelText(/Nota/), "Lo vi en el banco");
    await userEvent.click(within(form).getByRole("button", { name: "Confirmar el pago" }));
    await waitFor(() =>
      expect(api.confirmPaymentManually).toHaveBeenCalledWith("pay-1", null, "Lo vi en el banco"),
    );
    expect(toast.success).toHaveBeenCalledWith("Pago confirmado: el pedido quedó pagado.");
  });

  it("confirmar con otro monto lo manda; un monto mal escrito no llama al servidor", async () => {
    api.confirmPaymentManually.mockResolvedValue({ outcome: "review" });
    const dialog = within(await open());
    await userEvent.click(dialog.getByRole("button", { name: "Confirmar el pago a mano" }));
    const form = await screen.findByRole("dialog", { name: "Confirmar el pago MIC-000123 a mano" });
    await userEvent.type(within(form).getByLabelText(/Monto que viste/), "abc");
    await userEvent.click(within(form).getByRole("button", { name: "Confirmar el pago" }));
    expect(
      await within(form).findByText("Escribe un monto válido, por ejemplo 255,00."),
    ).toBeInTheDocument();
    expect(api.confirmPaymentManually).not.toHaveBeenCalled();
    await userEvent.clear(within(form).getByLabelText(/Monto que viste/));
    await userEvent.type(within(form).getByLabelText(/Monto que viste/), "200");
    await userEvent.click(within(form).getByRole("button", { name: "Confirmar el pago" }));
    await waitFor(() =>
      expect(api.confirmPaymentManually).toHaveBeenCalledWith("pay-1", 200, null),
    );
    expect(toast.success).toHaveBeenCalledWith("El monto no coincide: el pago quedó en revisión.");
  });

  it("un cobro que ya estaba pagado se dice tal cual", async () => {
    api.confirmPaymentManually.mockResolvedValue({ outcome: "already_paid" });
    const dialog = within(await open());
    await userEvent.click(dialog.getByRole("button", { name: "Confirmar el pago a mano" }));
    const form = await screen.findByRole("dialog", { name: "Confirmar el pago MIC-000123 a mano" });
    await userEvent.click(within(form).getByRole("button", { name: "Confirmar el pago" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Este cobro ya estaba pagado: no se cambió nada."),
    );
  });

  it("repetir un monto que ya se registró NO dice que el pago esté confirmado (antes lo afirmaba aunque siguiera pendiente)", async () => {
    api.confirmPaymentManually.mockResolvedValue({ outcome: "duplicate" });
    const dialog = within(await open());
    await userEvent.click(dialog.getByRole("button", { name: "Confirmar el pago a mano" }));
    const form = await screen.findByRole("dialog", { name: "Confirmar el pago MIC-000123 a mano" });
    await userEvent.click(within(form).getByRole("button", { name: "Confirmar el pago" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Ya registraste ese mismo monto y el cobro sigue sin confirmarse. Si viste otro monto en tu banco, escríbelo.",
      ),
    );
    expect(toast.success).not.toHaveBeenCalledWith("Este pago ya estaba confirmado.");
  });
});

describe("PaymentsPage · solo QR manual en la interfaz", () => {
  it("no ofrece «Conciliar ahora» (le pregunta a un proveedor automático, que aún no hay)", async () => {
    renderPage();
    await screen.findByRole("table", { name: "Cobros" });
    expect(screen.queryByRole("button", { name: "Conciliar ahora" })).not.toBeInTheDocument();
    expect(api.reconcileNow).not.toHaveBeenCalled();
  });

  it("el filtro de método no ofrece el QR automático, y sí los demás", async () => {
    renderPage();
    await screen.findByRole("table", { name: "Cobros" });
    const options = within(screen.getByLabelText("Método"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["Todos", "QR manual", "WhatsApp", "Contra entrega"]);
  });

  it("el detalle no muestra el «Id del proveedor»", async () => {
    api.listPayments.mockResolvedValue({ rows: [row({ externalId: "ext-1" })], total: 1 });
    renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: "Ver detalle del cobro MIC-000123" }),
    );
    const dialog = within(await screen.findByRole("dialog", { name: "Cobro MIC-000123" }));
    expect(dialog.getByText("Método")).toBeInTheDocument();
    expect(dialog.queryByText("Id del proveedor")).not.toBeInTheDocument();
    expect(dialog.queryByText("ext-1")).not.toBeInTheDocument();
  });

  it("un cobro suelto de tipo automático (no debería existir) se ve como «QR», sin decir «automático»", async () => {
    api.listPayments.mockResolvedValue({ rows: [row({ provider: "qr_api" })], total: 1 });
    renderPage();
    const table = await screen.findByRole("table", { name: "Cobros" });
    expect(within(table).getByText("QR")).toBeInTheDocument();
    expect(screen.queryByText(/autom/i)).not.toBeInTheDocument();
  });
});
