import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RefundWizard, type RefundPreset } from "./RefundWizard";
import type { OrderDetail } from "./types";

const api = vi.hoisted(() => ({ refundOrder: vi.fn(), listRefunds: vi.fn() }));
vi.mock("./api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const order: OrderDetail = {
  id: "o-1",
  number: "MIC-000123",
  status: "paid",
  channel: "web",
  contactName: "Ana Pérez",
  contactPhone: "+59171234567",
  total: 303,
  currency: "BOB",
  paymentMethod: "whatsapp",
  paymentProvider: "whatsapp",
  createdAt: "2026-11-10T12:00:00Z",
  updatedAt: "2026-11-10T12:00:00Z",
  profileId: "p-1",
  subtotal: 320,
  discountTotal: 32,
  shippingCost: 15,
  shippingDiscount: 0,
  contactEmail: null,
  shippingKind: "delivery",
  shippingName: "A domicilio",
  address: null,
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
      colorName: null,
      sizeLabel: null,
      sku: null,
      imagePath: null,
      qty: 2,
      unitPrice: 100,
      lineTotal: 200,
      discount: 20,
      finalTotal: 180,
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
      qty: 3,
      unitPrice: 40,
      lineTotal: 120,
      discount: 12,
      finalTotal: 108,
    },
  ],
};

const preview = (over: Record<string, unknown> = {}) => ({
  outcome: "preview",
  cancel: true,
  status_after: "refunded",
  restock: [
    { name: "Camiseta", qty: 2, variant_id: "v-1" },
    { name: "Gorra", qty: 3, variant_id: "v-2" },
  ],
  coupon_release: true,
  refund: { ok: true, amount: 303, paid: 303, left_after: 0, lines: [], warnings: [] },
  ...over,
});

function renderWizard(preset: RefundPreset = { cancel: true, mode: "all" }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const onDone = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <RefundWizard order={order} preset={preset} onOpenChange={onOpenChange} onDone={onDone} />
    </QueryClientProvider>,
  );
  return { onOpenChange, onDone };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listRefunds.mockResolvedValue([]);
  api.refundOrder.mockResolvedValue(preview());
});

const reason = () => screen.getByLabelText("Motivo");

describe("RefundWizard · cancelar y reembolsar", () => {
  it("pide el motivo antes de calcular y no llama a la base sin él", async () => {
    renderWizard();
    expect(
      screen.getByRole("heading", { name: "Cancelar y reembolsar el pedido MIC-000123" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Calcular impacto" }));
    expect(await screen.findByText("Escribe el motivo.")).toBeInTheDocument();
    expect(api.refundOrder).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancelar y reembolsar" })).toBeDisabled();
  });

  it("calcula el impacto con la MISMA cuenta de la base (vista previa) y lo muestra", async () => {
    renderWizard();
    await userEvent.type(reason(), "La clienta ya no lo quiere");
    await userEvent.click(screen.getByRole("button", { name: "Calcular impacto" }));
    await waitFor(() => expect(api.refundOrder).toHaveBeenCalledTimes(1));
    expect(api.refundOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "o-1",
        mode: "all",
        cancel: true,
        dryRun: true,
        markProcessed: false,
        reason: "La clienta ya no lo quiere",
        method: "bank_transfer",
      }),
    );
    const impact = await screen.findByRole("region", { name: "Impacto" });
    expect(
      within(impact).getByText(
        /Se devuelven Bs 303,00 de Bs 303,00 pagados; quedan Bs 0,00 por devolver\./,
      ),
    ).toBeInTheDocument();
    expect(
      within(impact).getByText("Vuelven al stock: Camiseta × 2, Gorra × 3."),
    ).toBeInTheDocument();
    expect(
      within(impact).getByText("Se devuelve el uso del cupón o descuento."),
    ).toBeInTheDocument();
    expect(within(impact).getByText("El pedido quedará «Reembolsado».")).toBeInTheDocument();
  });

  it("confirmar aplica con la MISMA llave de idempotencia que la vista previa y avisa al terminar", async () => {
    const { onDone, onOpenChange } = renderWizard();
    await userEvent.type(reason(), "Error de precio");
    await userEvent.click(screen.getByRole("button", { name: "Calcular impacto" }));
    await screen.findByRole("region", { name: "Impacto" });
    api.refundOrder.mockResolvedValueOnce({ outcome: "refunded", refund_id: "r-1", amount: 303 });
    await userEvent.click(screen.getByRole("button", { name: "Cancelar y reembolsar" }));
    await waitFor(() => expect(api.refundOrder).toHaveBeenCalledTimes(2));
    const [dry, real] = api.refundOrder.mock.calls.map((c) => c[0]);
    expect(dry.dryRun).toBe(true);
    expect(real.dryRun).toBe(false);
    expect(real.key).toBe(dry.key);
    expect(real.key).toMatch(/^rf-[0-9a-f]{24}$/);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("Reembolso registrado y devuelto."));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("cambiar cualquier dato invalida la vista previa y estrena otra llave (un doble clic nunca duplica, un cambio no reutiliza)", async () => {
    renderWizard();
    await userEvent.type(reason(), "Motivo");
    await userEvent.click(screen.getByRole("button", { name: "Calcular impacto" }));
    await screen.findByRole("region", { name: "Impacto" });
    const keyBefore = api.refundOrder.mock.calls[0]![0].key;
    expect(screen.getByRole("button", { name: "Cancelar y reembolsar" })).toBeEnabled();
    await userEvent.type(reason(), " otra vez");
    expect(screen.getByRole("button", { name: "Cancelar y reembolsar" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Calcular impacto" }));
    await waitFor(() => expect(api.refundOrder).toHaveBeenCalledTimes(2));
    expect(api.refundOrder.mock.calls[1]![0].key).not.toBe(keyBefore);
  });

  it("«ya devolví el dinero» manda markProcessed y la referencia", async () => {
    renderWizard();
    await userEvent.type(reason(), "Devuelto");
    await userEvent.click(screen.getByLabelText(/Sí, ya lo devolví/));
    await userEvent.type(
      screen.getByLabelText("Referencia de la devolución (opcional)"),
      "TRX-778899",
    );
    await userEvent.click(screen.getByRole("button", { name: "Calcular impacto" }));
    await waitFor(() => expect(api.refundOrder).toHaveBeenCalled());
    expect(api.refundOrder.mock.calls[0]![0]).toMatchObject({
      markProcessed: true,
      externalRef: "TRX-778899",
    });
  });

  it("si la base rechaza (más de lo pagado), lo explica y no deja confirmar", async () => {
    api.refundOrder.mockResolvedValue({
      outcome: "rejected",
      errors: [{ code: "exceeds_paid" }],
      refund: { ok: false, errors: [{ code: "exceeds_paid", left: 123 }] },
    });
    renderWizard();
    await userEvent.type(reason(), "Motivo");
    await userEvent.click(screen.getByRole("button", { name: "Calcular impacto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se puede devolver más de lo pagado",
    );
    expect(screen.getByRole("button", { name: "Cancelar y reembolsar" })).toBeDisabled();
  });

  it("un fallo al confirmar deja el asistente abierto con el mensaje", async () => {
    const { onOpenChange } = renderWizard();
    await userEvent.type(reason(), "Motivo");
    await userEvent.click(screen.getByRole("button", { name: "Calcular impacto" }));
    await screen.findByRole("region", { name: "Impacto" });
    api.refundOrder.mockResolvedValueOnce({
      outcome: "rejected",
      errors: [{ code: "invalid_transition" }],
    });
    await userEvent.click(screen.getByRole("button", { name: "Cancelar y reembolsar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/ya no está en un estado/);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("RefundWizard · reembolsar sin cancelar", () => {
  it("por productos: manda solo las unidades elegidas y el envío si se marca", async () => {
    renderWizard({ cancel: false, mode: "items" });
    expect(
      screen.getByRole("heading", { name: "Reembolsar el pedido MIC-000123" }),
    ).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Unidades de Camiseta"));
    await userEvent.type(screen.getByLabelText("Unidades de Camiseta"), "1");
    await userEvent.click(
      screen.getByRole("checkbox", { name: /Devolver también el envío pagado \(Bs 15,00\)/ }),
    );
    await userEvent.type(reason(), "Devolvió una prenda");
    await userEvent.click(screen.getByRole("button", { name: "Calcular impacto" }));
    await waitFor(() => expect(api.refundOrder).toHaveBeenCalled());
    expect(api.refundOrder.mock.calls[0]![0]).toMatchObject({
      mode: "items",
      items: [{ item_id: "i-1", qty: 1 }],
      includeShipping: true,
      cancel: false,
    });
  });

  it("sin unidades ni envío no calcula", async () => {
    renderWizard({ cancel: false, mode: "items" });
    await userEvent.type(reason(), "x");
    await userEvent.click(screen.getByRole("button", { name: "Calcular impacto" }));
    expect(await screen.findByText("Elige al menos una unidad o el envío.")).toBeInTheDocument();
    expect(api.refundOrder).not.toHaveBeenCalled();
  });

  it("la retención es estricta (2 decimales)", async () => {
    renderWizard({ cancel: false, mode: "items", qty: { "i-1": 1 } });
    await userEvent.type(screen.getByLabelText("Retención (opcional)"), "1,005");
    await userEvent.type(reason(), "x");
    await userEvent.click(screen.getByRole("button", { name: "Calcular impacto" }));
    expect(await screen.findByText("Usa como máximo 2 decimales.")).toBeInTheDocument();
    expect(api.refundOrder).not.toHaveBeenCalled();
  });

  it("monto libre: manda el número y exige un importe válido", async () => {
    renderWizard({ cancel: false, mode: "amount" });
    await userEvent.type(reason(), "Diferencia por la edición");
    await userEvent.click(screen.getByRole("button", { name: "Calcular impacto" }));
    expect(
      await screen.findByText("Escribe un importe válido (por ejemplo 25 o 25,50)."),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Monto a devolver"), "100,50");
    await userEvent.click(screen.getByRole("button", { name: "Calcular impacto" }));
    await waitFor(() => expect(api.refundOrder).toHaveBeenCalled());
    expect(api.refundOrder.mock.calls[0]![0]).toMatchObject({
      mode: "amount",
      amount: 100.5,
      items: null,
    });
  });

  it("desde una devolución: lleva su id y sus unidades ya elegidas", async () => {
    renderWizard({ cancel: false, mode: "items", returnId: "ret-1", qty: { "i-2": 2 } });
    expect(screen.getByLabelText("Unidades de Gorra")).toHaveValue("2");
    await userEvent.type(reason(), "Devolución aprobada");
    await userEvent.click(screen.getByRole("button", { name: "Calcular impacto" }));
    await waitFor(() => expect(api.refundOrder).toHaveBeenCalled());
    expect(api.refundOrder.mock.calls[0]![0]).toMatchObject({
      returnId: "ret-1",
      items: [{ item_id: "i-2", qty: 2 }],
    });
  });

  it("avisa de lo que ya está comprometido en reembolsos anteriores", async () => {
    api.listRefunds.mockResolvedValue([
      { id: "r1", status: "processed", amount: 90 },
      { id: "r2", status: "rejected", amount: 500 },
    ]);
    renderWizard({ cancel: false, mode: "all" });
    await userEvent.type(reason(), "x");
    await userEvent.click(screen.getByRole("button", { name: "Calcular impacto" }));
    expect(
      await screen.findByText("Ya comprometido en reembolsos anteriores: Bs 90,00."),
    ).toBeInTheDocument();
  });
});
