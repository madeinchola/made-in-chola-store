import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewPage } from "./ReviewPage";
import type { OpenReview, PendingProof } from "./types";

const api = vi.hoisted(() => ({
  listPendingProofs: vi.fn(),
  listOpenReviews: vi.fn(),
  signedProofUrl: vi.fn(),
  reviewProof: vi.fn(),
  resolveReview: vi.fn(),
  confirmPaymentManually: vi.fn(),
}));
vi.mock("./api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const proof = (over: Partial<PendingProof> = {}): PendingProof => ({
  id: "pr-1",
  paymentId: "pay-1",
  orderId: "o-1",
  filePath: "u/o/f.jpg",
  fileHash: "a".repeat(64),
  mime: "image/jpeg",
  sizeBytes: 150_000,
  duplicateOf: null,
  createdAt: "2026-11-10T12:00:00Z",
  reference: "MIC-000123",
  amount: 255,
  currency: "BOB",
  orderNumber: "MIC-000123",
  contactName: "Ana Pérez",
  contactPhone: "+59171234567",
  ...over,
});
const review = (over: Partial<OpenReview> = {}): OpenReview => ({
  id: "rv-1",
  paymentId: "pay-2",
  reason: "amount_mismatch",
  detail: { expected: 150, received: 140 },
  openedAt: "2026-11-10T13:00:00Z",
  reference: "MIC-000200",
  amount: 150,
  receivedAmount: 140,
  currency: "BOB",
  paymentStatus: "pending",
  orderNumber: "MIC-000200",
  orderStatus: "pending_payment",
  contactName: "Bia Soto",
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReviewPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listPendingProofs.mockResolvedValue([proof()]);
  api.listOpenReviews.mockResolvedValue([review()]);
  api.signedProofUrl.mockResolvedValue("https://signed.test/f.jpg?token=1");
});

const card = (number: string) =>
  screen.getByRole("heading", { name: `Pedido ${number}` }).closest("li") as HTMLElement;

describe("ReviewPage · comprobantes", () => {
  it("muestra cada comprobante con la clienta, el monto esperado, la referencia y el archivo (URL firmada)", async () => {
    renderPage();
    const c = within(
      await screen
        .findByRole("heading", { name: "Pedido MIC-000123" })
        .then((h) => h.closest("li") as HTMLElement),
    );
    expect(c.getByText(/Ana Pérez · \+59171234567/)).toBeInTheDocument();
    expect(c.getAllByText("Bs 255,00").length).toBeGreaterThan(0);
    expect(c.getByText("MIC-000123", { selector: "dd" })).toBeInTheDocument();
    expect(await c.findByAltText("Comprobante de pago de la clienta")).toHaveAttribute(
      "src",
      "https://signed.test/f.jpg?token=1",
    );
    expect(api.signedProofUrl).toHaveBeenCalledWith("u/o/f.jpg");
    expect(c.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("un PDF se abre en una pestaña nueva con noopener (no se incrusta)", async () => {
    api.listPendingProofs.mockResolvedValue([
      proof({ mime: "application/pdf", filePath: "u/o/f.pdf" }),
    ]);
    renderPage();
    const link = await screen.findByRole("link", { name: "Abrir el PDF en una pestaña nueva" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("un archivo ya usado en otro cobro se marca como posible reutilización", async () => {
    api.listPendingProofs.mockResolvedValue([proof({ duplicateOf: "pr-0" })]);
    renderPage();
    expect(
      await screen.findByText(/Este mismo archivo ya se subió para otro cobro/),
    ).toBeInTheDocument();
  });

  it("si no se puede firmar la URL lo dice y deja reintentar", async () => {
    api.signedProofUrl
      .mockRejectedValueOnce(new Error("sin red"))
      .mockRejectedValueOnce(new Error("sin red"));
    renderPage();
    const c = within(
      await screen
        .findByRole("heading", { name: "Pedido MIC-000123" })
        .then((h) => h.closest("li") as HTMLElement),
    );
    // el visor reintenta UNA vez por su cuenta (≈1 s) antes de rendirse
    expect(
      await c.findByText("No pudimos abrir el archivo. Inténtalo de nuevo.", {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    api.signedProofUrl.mockResolvedValue("https://signed.test/otra");
    await userEvent.click(c.getByRole("button", { name: "Reintentar" }));
    expect(await c.findByAltText("Comprobante de pago de la clienta")).toBeInTheDocument();
  });

  it("aprobar sin escribir monto manda null (el esperado) y avisa", async () => {
    api.reviewProof.mockResolvedValue({ outcome: "approved", payment: { outcome: "applied" } });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Aprobar" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Aprobar el comprobante del pedido MIC-000123",
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Aprobar y confirmar el pago" }),
    );
    await waitFor(() =>
      expect(api.reviewProof).toHaveBeenCalledWith("pr-1", "approve", null, null),
    );
    expect(toast.success).toHaveBeenCalledWith("Comprobante aprobado: el pedido quedó pagado.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // y vuelve a leer todo (otra persona pudo decidir)
    await waitFor(() => expect(api.listPendingProofs.mock.calls.length).toBeGreaterThan(1));
  });

  it("aprobar con otro monto lo manda, y si no coincide lo avisa (quedó en revisión)", async () => {
    api.reviewProof.mockResolvedValue({
      outcome: "approved",
      payment: { outcome: "review", review: "amount_mismatch" },
    });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Aprobar" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/Monto que viste/), "80,50");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Aprobar y confirmar el pago" }),
    );
    await waitFor(() =>
      expect(api.reviewProof).toHaveBeenCalledWith("pr-1", "approve", null, 80.5),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Comprobante aprobado, pero el monto no coincide: el pago quedó en revisión.",
    );
  });

  it("un monto mal escrito se explica junto al campo y NO llama al servidor", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Aprobar" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/Monto que viste/), "255,005");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Aprobar y confirmar el pago" }),
    );
    expect(await within(dialog).findByText("Usa como máximo 2 decimales.")).toBeInTheDocument();
    expect(api.reviewProof).not.toHaveBeenCalled();
  });

  it("si otra persona ya lo revisó, lo dice (gana la primera decisión)", async () => {
    api.reviewProof.mockResolvedValue({ outcome: "already_reviewed", status: "approved" });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Aprobar" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Aprobar y confirmar el pago" }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Otra persona ya revisó este comprobante."),
    );
  });

  it("rechazar exige un motivo (junto al campo) y lo manda compactado", async () => {
    api.reviewProof.mockResolvedValue({ outcome: "rejected" });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Rechazar" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Rechazar el comprobante del pedido MIC-000123",
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Rechazar comprobante" }));
    expect(await within(dialog).findByText("Escribe el motivo del rechazo.")).toBeInTheDocument();
    expect(api.reviewProof).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), "  No se ve   el monto ");
    await userEvent.click(within(dialog).getByRole("button", { name: "Rechazar comprobante" }));
    await waitFor(() =>
      expect(api.reviewProof).toHaveBeenCalledWith("pr-1", "reject", "No se ve el monto", null),
    );
    expect(toast.success).toHaveBeenCalledWith("Comprobante rechazado. Le avisamos a la clienta.");
  });

  it("un error del servidor se muestra en el diálogo y NO lo cierra", async () => {
    api.reviewProof.mockRejectedValue(new Error("boom"));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Aprobar" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Aprobar y confirmar el pago" }),
    );
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("mientras guarda bloquea el botón (un doble clic no decide dos veces)", async () => {
    let finish: (v: unknown) => void = () => {};
    api.reviewProof.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Aprobar" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Aprobar y confirmar el pago" }),
    );
    const busy = await within(dialog).findByRole("button", { name: "Aprobando…" });
    await userEvent.click(busy);
    expect(api.reviewProof).toHaveBeenCalledTimes(1);
    finish({ outcome: "approved", payment: { outcome: "applied" } });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("ReviewPage · pagos que necesitan una decisión", () => {
  it("cada revisión dice qué pasó con los números del servidor", async () => {
    renderPage();
    const c = within(
      await screen
        .findByRole("heading", { name: "Pedido MIC-000200" })
        .then(() => card("MIC-000200")),
    );
    expect(c.getByText("Monto distinto")).toBeInTheDocument();
    expect(
      c.getByText("Se esperaba Bs 150,00 y llegó Bs 140,00. El pedido sigue pendiente de pago."),
    ).toBeInTheDocument();
    expect(c.getByText("Bs 140,00")).toBeInTheDocument();
  });

  it("un contracargo se marca como peligro y un pago tardío dice que el dinero no se perdió", async () => {
    api.listOpenReviews.mockResolvedValue([
      review({ id: "a", reason: "disputed", detail: {}, orderNumber: "MIC-000300" }),
      review({
        id: "b",
        reason: "late",
        detail: { amount: 90, order_status: "cancelled" },
        orderNumber: "MIC-000301",
      }),
    ]);
    renderPage();
    expect(await screen.findByText("Contracargo")).toBeInTheDocument();
    expect(screen.getByText(/El dinero está recibido y no se perdió/)).toBeInTheDocument();
  });

  it("resolver exige una nota y la manda; avisa al terminar", async () => {
    api.resolveReview.mockResolvedValue({ outcome: "resolved" });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Marcar como resuelta" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Resolver la revisión del pedido MIC-000200",
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Marcar como resuelta" }));
    expect(await within(dialog).findByText("Escribe qué hiciste.")).toBeInTheDocument();
    expect(api.resolveReview).not.toHaveBeenCalled();
    await userEvent.type(
      within(dialog).getByLabelText(/Qué hiciste/),
      "Devolví el dinero por transferencia",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Marcar como resuelta" }));
    await waitFor(() =>
      expect(api.resolveReview).toHaveBeenCalledWith("rv-1", "Devolví el dinero por transferencia"),
    );
    expect(toast.success).toHaveBeenCalledWith("Revisión resuelta.");
  });

  it("si otra persona ya la resolvió, lo dice", async () => {
    api.resolveReview.mockResolvedValue({ outcome: "already_resolved" });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Marcar como resuelta" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/Qué hiciste/), "listo");
    await userEvent.click(within(dialog).getByRole("button", { name: "Marcar como resuelta" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Otra persona ya la resolvió."));
  });
});

describe("ReviewPage · estados vacíos y de error", () => {
  it("sin nada pendiente lo dice (no una pantalla en blanco)", async () => {
    api.listPendingProofs.mockResolvedValue([]);
    api.listOpenReviews.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("No hay comprobantes esperando revisión.")).toBeInTheDocument();
    expect(screen.getByText("No hay pagos pendientes de revisión.")).toBeInTheDocument();
  });

  it("si falla la lectura ofrece reintentar", async () => {
    api.listPendingProofs.mockRejectedValueOnce(new Error("sin red"));
    renderPage();
    const retry = await screen.findByRole("button", { name: "Reintentar" });
    api.listPendingProofs.mockResolvedValue([]);
    await userEvent.click(retry);
    expect(await screen.findByText("No hay comprobantes esperando revisión.")).toBeInTheDocument();
  });
});
