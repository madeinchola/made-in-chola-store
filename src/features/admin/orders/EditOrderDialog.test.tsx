import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as apiModule from "./api";
import { EditOrderDialog } from "./EditOrderDialog";
import type { OrderDetail } from "./types";

vi.mock("./api", async () => (await import("./apiMock")).createApiMock());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const api = vi.mocked(apiModule);

const order = {
  id: "o-1",
  number: "MIC-000123",
  status: "pending_payment",
  currency: "BOB",
  total: 255,
  shippingCost: 15,
  shippingDiscount: 0,
  contactName: "Ana Pérez",
  contactEmail: "ana@test.com",
  contactPhone: "+59171234567",
  shippingKind: "delivery",
  updatedAt: "2026-11-10T12:00:00+00:00",
  address: {
    recipient: "Ana",
    phone: "+59171234567",
    line1: "Calle 1",
    line2: null,
    city: "La Paz",
    department: null,
    country: "BO",
    reference: null,
    lat: -16.5,
    lng: -68.15,
  },
  items: [
    { id: "i-1", name: "Camiseta", qty: 2 },
    { id: "i-2", name: "Gorra", qty: 1 },
  ],
} as unknown as OrderDetail;

function mount(o: OrderDetail = order) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const onDone = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <EditOrderDialog order={o} onOpenChange={onOpenChange} onDone={onDone} />
    </QueryClientProvider>,
  );
  return { onOpenChange, onDone };
}

const previewResult = {
  outcome: "preview",
  before: { total: 255 },
  after: { total: 355 },
  diff: {
    items: [{ op: "changed", name: "Camiseta", qty_before: 2, qty_after: 3 }],
    stock: [{ name: "Camiseta", net: 1 }],
    payment: "amount_updated",
  },
  balance: 0,
  suggested_shipping: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.searchVariants.mockResolvedValue([]);
  api.editOrder.mockResolvedValue(previewResult);
});

const calculate = () => userEvent.click(screen.getByRole("button", { name: "Calcular" }));
const setReason = (text: string) =>
  userEvent.type(screen.getByLabelText("Motivo del cambio"), text);

describe("EditOrderDialog", () => {
  it("el motivo es obligatorio y sin él no se llama a la base", async () => {
    mount();
    await calculate();
    expect(
      await screen.findByText("Escribe el motivo (hasta 300 caracteres)."),
    ).toBeInTheDocument();
    expect(api.editOrder).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Confirmar cambios" })).toBeDisabled();
  });

  it("calcula mandando SOLO lo que cambió y la versión del pedido que se vio (bloqueo optimista)", async () => {
    mount();
    const qty = screen.getByLabelText("Cantidad de Camiseta");
    await userEvent.clear(qty);
    await userEvent.type(qty, "3");
    await setReason("La clienta pidió una más");
    await calculate();
    await waitFor(() => expect(api.editOrder).toHaveBeenCalledTimes(1));
    expect(api.editOrder).toHaveBeenCalledWith({
      orderId: "o-1",
      expectedUpdatedAt: "2026-11-10T12:00:00+00:00",
      items: [{ item_id: "i-1", qty: 3 }],
      contact: null,
      address: null,
      shippingCost: null,
      extraDiscount: 0,
      reason: "La clienta pidió una más",
      dryRun: true,
    });
  });

  it("muestra el impacto (total, líneas, stock y cobro) y solo entonces deja confirmar", async () => {
    mount();
    await userEvent.clear(screen.getByLabelText("Cantidad de Camiseta"));
    await userEvent.type(screen.getByLabelText("Cantidad de Camiseta"), "3");
    await setReason("Pidió más");
    await calculate();
    const impact = await screen.findByRole("region", { name: "Impacto del cambio" });
    expect(within(impact).getByText("Total: Bs 255,00 → Bs 355,00")).toBeInTheDocument();
    expect(within(impact).getByText("Camiseta: 2 → 3 unidades")).toBeInTheDocument();
    expect(
      within(impact).getByText("Camiseta: salen 1 unidades más del stock"),
    ).toBeInTheDocument();
    expect(
      within(impact).getByText("El cobro abierto pasa a cobrar Bs 355,00."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar cambios" })).toBeEnabled();
  });

  it("confirmar aplica (dryRun false) y cierra avisando", async () => {
    const { onDone, onOpenChange } = mount();
    await userEvent.clear(screen.getByLabelText("Cantidad de Camiseta"));
    await userEvent.type(screen.getByLabelText("Cantidad de Camiseta"), "3");
    await setReason("Pidió más");
    await calculate();
    await screen.findByRole("region", { name: "Impacto del cambio" });
    api.editOrder.mockResolvedValueOnce({ outcome: "edited" });
    await userEvent.click(screen.getByRole("button", { name: "Confirmar cambios" }));
    await waitFor(() => expect(api.editOrder).toHaveBeenCalledTimes(2));
    expect(api.editOrder.mock.calls[1]![0]).toMatchObject({
      dryRun: false,
      items: [{ item_id: "i-1", qty: 3 }],
    });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("Pedido MIC-000123 actualizado."));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("quitar una línea (cantidad 0) y sumar un producto nuevo", async () => {
    api.searchVariants.mockResolvedValue([
      { id: "v-9", productName: "Polera", colorName: "Azul", sizeLabel: "L", sku: null, stock: 5 },
    ]);
    mount();
    await userEvent.clear(screen.getByLabelText("Cantidad de Gorra"));
    await userEvent.type(screen.getByLabelText("Cantidad de Gorra"), "0");
    await userEvent.type(screen.getByLabelText("Agregar un producto"), "Pol");
    await userEvent.click(await screen.findByRole("button", { name: "Agregar" }));
    const qty = screen.getByLabelText("Cantidad de Polera");
    await userEvent.clear(qty);
    await userEvent.type(qty, "2");
    await setReason("Cambio de producto");
    await calculate();
    await waitFor(() => expect(api.editOrder).toHaveBeenCalled());
    expect(api.editOrder.mock.calls[0]![0].items).toEqual([
      { item_id: "i-2", qty: 0 },
      { variant_id: "v-9", qty: 2 },
    ]);
  });

  it("un producto agregado se puede quitar antes de calcular", async () => {
    api.searchVariants.mockResolvedValue([
      { id: "v-9", productName: "Polera", colorName: null, sizeLabel: null, sku: null, stock: 5 },
    ]);
    mount();
    await userEvent.type(screen.getByLabelText("Agregar un producto"), "Pol");
    await userEvent.click(await screen.findByRole("button", { name: "Agregar" }));
    await userEvent.click(screen.getByRole("button", { name: "Quitar Polera" }));
    expect(screen.queryByLabelText("Cantidad de Polera")).not.toBeInTheDocument();
  });

  it("contacto, dirección y envío: manda solo los campos cambiados, con el teléfono en E.164", async () => {
    mount();
    await userEvent.clear(screen.getByLabelText("Teléfono"));
    await userEvent.type(screen.getByLabelText("Teléfono"), "71112222");
    await userEvent.clear(screen.getByLabelText("Calle y número"));
    await userEvent.type(screen.getByLabelText("Calle y número"), "Av. Nueva 123");
    await userEvent.type(screen.getByLabelText("Costo de envío nuevo (opcional)"), "20");
    await userEvent.type(screen.getByLabelText("Descuento extra (opcional)"), "5,50");
    await setReason("Se mudó");
    await calculate();
    await waitFor(() => expect(api.editOrder).toHaveBeenCalled());
    const args = api.editOrder.mock.calls[0]![0];
    expect(args.contact).toEqual({ phone: "+59171112222" });
    expect(args.address).toMatchObject({
      line1: "Av. Nueva 123",
      city: "La Paz",
      country: "BO",
      phone_e164: "+59171234567",
      lat: -16.5,
      lng: -68.15,
    });
    expect(args.shippingCost).toBe(20);
    expect(args.extraDiscount).toBe(5.5);
  });

  it("valida el teléfono, el costo y el descuento antes de llamar", async () => {
    mount();
    await userEvent.clear(screen.getByLabelText("Teléfono"));
    await userEvent.type(screen.getByLabelText("Teléfono"), "123");
    await userEvent.type(screen.getByLabelText("Costo de envío nuevo (opcional)"), "1,005");
    await userEvent.type(screen.getByLabelText("Descuento extra (opcional)"), "abc");
    await setReason("x");
    await calculate();
    expect(await screen.findByText(/El teléfono no es válido/)).toBeInTheDocument();
    expect(screen.getByText("Usa como máximo 2 decimales.")).toBeInTheDocument();
    expect(
      screen.getByText("Escribe un importe válido (por ejemplo 25 o 25,50)."),
    ).toBeInTheDocument();
    expect(api.editOrder).not.toHaveBeenCalled();
  });

  it("una cantidad vacía o con basura se rechaza", async () => {
    mount();
    await userEvent.clear(screen.getByLabelText("Cantidad de Camiseta"));
    await setReason("x");
    await calculate();
    expect(
      await screen.findByText("Alguna cantidad no es un número entero (0 o más)."),
    ).toBeInTheDocument();
    expect(api.editOrder).not.toHaveBeenCalled();
  });

  it("si otro administrador cambió el pedido (stale), se explica y se puede cerrar", async () => {
    api.editOrder.mockResolvedValue({ outcome: "stale", updated_at: "x" });
    mount();
    await setReason("x");
    await calculate();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Otro administrador cambió este pedido",
    );
  });

  it("sin stock: lo dice con el nombre del producto de la base", async () => {
    api.editOrder.mockResolvedValue({
      outcome: "unavailable",
      lines: [{ name: "Camiseta", requested: 2, available: 0 }],
    });
    mount();
    await setReason("x");
    await calculate();
    expect(await screen.findByRole("alert")).toHaveTextContent("No hay stock suficiente");
  });

  it("cualquier cambio después de calcular invalida la vista previa (hay que recalcular)", async () => {
    mount();
    await setReason("Pidió más");
    await calculate();
    await screen.findByRole("region", { name: "Impacto del cambio" });
    expect(screen.getByRole("button", { name: "Confirmar cambios" })).toBeEnabled();
    await userEvent.type(screen.getByLabelText("Motivo del cambio"), " y más");
    expect(screen.getByRole("button", { name: "Confirmar cambios" })).toBeDisabled();
  });

  it("un pedido de recojo no muestra dirección", () => {
    mount({ ...order, shippingKind: "pickup", address: null } as OrderDetail);
    expect(screen.queryByText("Dirección de entrega")).not.toBeInTheDocument();
  });

  it("avisa de un saldo por cobrar o por devolver en un pedido ya pagado, y de la cotización sugerida", async () => {
    api.editOrder.mockResolvedValue({
      ...previewResult,
      diff: { ...previewResult.diff, payment: "refund_due" },
      balance: -100,
      suggested_shipping: { ok: true, cost: 18 },
    });
    mount();
    await setReason("Bajó");
    await calculate();
    const impact = await screen.findByRole("region", { name: "Impacto del cambio" });
    expect(
      within(impact).getByText("Habrá que devolver Bs 100,00: el pedido ya estaba pagado."),
    ).toBeInTheDocument();
    expect(
      within(impact).getByText(/Cotización sugerida para la dirección nueva: Bs 18,00/),
    ).toBeInTheDocument();
  });
});
