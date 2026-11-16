import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as apiModule from "./api";
import { ManualOrderPage } from "./ManualOrderPage";

vi.mock("./api", async () => (await import("./apiMock")).createApiMock());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const api = vi.mocked(apiModule);

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/pedidos/nuevo"]}>
        <Routes>
          <Route path="/admin/pedidos/nuevo" element={<ManualOrderPage />} />
          <Route path="/admin/pedidos/:id" element={<p>detalle del pedido</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const preview = {
  outcome: "preview",
  currency: "BOB",
  lines: [{ line_no: 1, name: "Camiseta", qty: 2, unit_price: 100, line_total: 200, discount: 0 }],
  totals: { subtotal: 200, discount: 0, shipping: 15, total: 215 },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.searchCustomers.mockResolvedValue([
    {
      id: "p-1",
      fullName: "Ana Pérez",
      email: "ana@test.com",
      phone: "+59171234567",
      isActive: true,
    },
    { id: "p-2", fullName: "Ana Inactiva", email: null, phone: "+59170000000", isActive: false },
  ]);
  api.searchVariants.mockResolvedValue([
    { id: "v-1", productName: "Camiseta", colorName: "Rojo", sizeLabel: "M", sku: null, stock: 8 },
  ]);
  api.listPaymentMethodsLite.mockResolvedValue([
    { code: "whatsapp", name: "WhatsApp", provider: "whatsapp" },
    { code: "cash_on_delivery", name: "Contra entrega", provider: "cash_on_delivery" },
  ]);
  api.listShippingMethodsLite.mockResolvedValue([
    { code: "delivery", name: "A domicilio", kind: "delivery" },
    { code: "recojo", name: "Recojo en el taller", kind: "pickup" },
  ]);
  api.createManualOrder.mockResolvedValue(preview);
});

async function pickCustomer() {
  await userEvent.type(screen.getByLabelText("Buscar clienta"), "Ana");
  await userEvent.click((await screen.findAllByRole("button", { name: "Elegir" }))[0]!);
}
async function addProduct(qty = "2") {
  await userEvent.type(screen.getByLabelText("Buscar producto"), "Cam");
  await userEvent.click(await screen.findByRole("button", { name: "Agregar" }));
  const input = screen.getByLabelText("Cantidad");
  await userEvent.clear(input);
  await userEvent.type(input, qty);
}
async function fillAddress() {
  await userEvent.type(screen.getByLabelText("Recibe"), "Rosa");
  await userEvent.type(screen.getByLabelText("Teléfono de quien recibe"), "72223333");
  await userEvent.type(screen.getByLabelText("Calle y número"), "Av. Arce 100");
}

describe("ManualOrderPage", () => {
  it("una clienta inactiva se ve pero no se puede elegir", async () => {
    mount();
    await userEvent.type(screen.getByLabelText("Buscar clienta"), "Ana");
    expect(await screen.findByRole("button", { name: "Desactivada" })).toBeDisabled();
  });

  it("sin clienta ni productos no calcula y dice qué falta", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Calcular" }));
    expect(await screen.findByText("Elige la clienta del pedido.")).toBeInTheDocument();
    expect(screen.getByText("Agrega al menos un producto.")).toBeInTheDocument();
    expect(api.createManualOrder).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Crear pedido" })).toBeDisabled();
  });

  it("flujo completo: elige clienta y productos, calcula (sin llave) y crea (con llave) navegando al pedido", async () => {
    mount();
    await pickCustomer();
    await addProduct("2");
    await fillAddress();
    await userEvent.click(screen.getByRole("button", { name: "Calcular" }));
    await waitFor(() => expect(api.createManualOrder).toHaveBeenCalledTimes(1));
    expect(api.createManualOrder.mock.calls[0]![0]).toMatchObject({
      profileId: "p-1",
      items: [{ variant_id: "v-1", qty: 2 }],
      channel: "whatsapp",
      paymentMethod: "whatsapp",
      shippingMethod: "delivery",
      dryRun: true,
      key: null,
      markPaid: false,
      discount: 0,
    });
    expect(api.createManualOrder.mock.calls[0]![0].address).toMatchObject({
      recipient: "Rosa",
      phone_e164: "+59172223333",
      line1: "Av. Arce 100",
      city: "La Paz",
      country: "BO",
    });
    const summary = await screen.findByRole("region", { name: "Resumen" });
    expect(within(summary).getByText("Camiseta × 2")).toBeInTheDocument();
    expect(within(summary).getByText("Bs 215,00")).toBeInTheDocument();

    api.createManualOrder.mockResolvedValueOnce({
      outcome: "created",
      order_id: "o-9",
      number: "MIC-000900",
    });
    await userEvent.click(screen.getByRole("button", { name: "Crear pedido" }));
    await waitFor(() => expect(api.createManualOrder).toHaveBeenCalledTimes(2));
    const real = api.createManualOrder.mock.calls[1]![0];
    expect(real.dryRun).toBe(false);
    expect(real.key).toMatch(/^mo-[0-9a-f]{24}$/);
    expect(await screen.findByText("detalle del pedido")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Pedido MIC-000900 creado.");
  });

  it("una cuenta SIN teléfono obliga a escribir uno de contacto (si no, el servidor rechazaría el pedido)", async () => {
    api.searchCustomers.mockResolvedValue([
      {
        id: "p-3",
        fullName: "Ana Sin Teléfono",
        email: "ana@test.com",
        phone: null,
        isActive: true,
      },
    ]);
    mount();
    await pickCustomer();
    await addProduct("1");
    await fillAddress();
    expect(screen.getByLabelText("Teléfono de contacto")).toBeInTheDocument();
    expect(
      screen.getByText("Esta cuenta no tiene teléfono: es obligatorio para crear el pedido."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Calcular" }));
    expect(
      await screen.findByText("Esta cuenta no tiene teléfono: escribe uno de contacto."),
    ).toBeInTheDocument();
    expect(api.createManualOrder).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Teléfono de contacto"), "71234567");
    await userEvent.click(screen.getByRole("button", { name: "Calcular" }));
    await waitFor(() => expect(api.createManualOrder).toHaveBeenCalled());
    expect(api.createManualOrder.mock.calls[0]![0]).toMatchObject({ contactPhone: "+59171234567" });
  });

  it("con teléfono en la cuenta, el de contacto sigue siendo opcional", async () => {
    mount();
    await pickCustomer();
    expect(screen.getByLabelText("Teléfono de contacto (opcional)")).toBeInTheDocument();
  });

  it("recojo: no pide dirección y la manda vacía", async () => {
    mount();
    await pickCustomer();
    await addProduct("1");
    await userEvent.selectOptions(screen.getByLabelText("Forma de entrega"), "recojo");
    expect(screen.queryByLabelText("Calle y número")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Calcular" }));
    await waitFor(() => expect(api.createManualOrder).toHaveBeenCalled());
    expect(api.createManualOrder.mock.calls[0]![0]).toMatchObject({
      shippingMethod: "recojo",
      address: null,
    });
  });

  it("descuento manual, precio fijado a mano, costo de envío y «ya pagó» viajan al servidor", async () => {
    mount();
    await pickCustomer();
    await userEvent.type(screen.getByLabelText("Buscar producto"), "Cam");
    await userEvent.click(await screen.findByRole("button", { name: "Agregar" }));
    await userEvent.type(screen.getByLabelText("Precio (opcional)"), "80");
    await fillAddress();
    await userEvent.type(screen.getByLabelText("Costo de envío (opcional)"), "30");
    await userEvent.type(screen.getByLabelText("Descuento manual (opcional)"), "25");
    await userEvent.type(screen.getByLabelText("Motivo del descuento"), "Cliente frecuente");
    await userEvent.click(screen.getByLabelText(/Ya recibí el pago/));
    await userEvent.selectOptions(screen.getByLabelText("Canal"), "manual");
    await userEvent.type(screen.getByLabelText("Nota interna (opcional)"), "Pidió por WhatsApp");
    await userEvent.click(screen.getByRole("button", { name: "Calcular" }));
    await waitFor(() => expect(api.createManualOrder).toHaveBeenCalled());
    expect(api.createManualOrder.mock.calls[0]![0]).toMatchObject({
      items: [{ variant_id: "v-1", qty: 1, unit_price: 80 }],
      shippingCost: 30,
      discount: 25,
      discountReason: "Cliente frecuente",
      markPaid: true,
      channel: "manual",
      note: "Pidió por WhatsApp",
    });
  });

  it("un descuento sin motivo se rechaza antes de llamar", async () => {
    mount();
    await pickCustomer();
    await addProduct("1");
    await fillAddress();
    await userEvent.type(screen.getByLabelText("Descuento manual (opcional)"), "10");
    await userEvent.click(screen.getByRole("button", { name: "Calcular" }));
    expect(await screen.findByText("Un descuento necesita su motivo.")).toBeInTheDocument();
    expect(api.createManualOrder).not.toHaveBeenCalled();
  });

  it("los rechazos de la base se explican: lista negra y falta de stock con el detalle", async () => {
    mount();
    await pickCustomer();
    await addProduct("1");
    await fillAddress();
    api.createManualOrder.mockResolvedValueOnce({ outcome: "blacklisted" });
    await userEvent.click(screen.getByRole("button", { name: "Calcular" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La cuenta está en la lista negra");
    api.createManualOrder.mockResolvedValueOnce({
      outcome: "unavailable",
      lines: [{ name: "Camiseta", requested: 5, available: 2 }],
    });
    await userEvent.click(screen.getByRole("button", { name: "Calcular" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Camiseta (2/5)"));
    expect(screen.getByRole("button", { name: "Crear pedido" })).toBeDisabled();
  });

  it("cambiar cualquier dato después de calcular invalida el resumen y estrena otra llave", async () => {
    mount();
    await pickCustomer();
    await addProduct("1");
    await fillAddress();
    await userEvent.click(screen.getByRole("button", { name: "Calcular" }));
    await screen.findByRole("region", { name: "Resumen" });
    expect(screen.getByRole("button", { name: "Crear pedido" })).toBeEnabled();
    await userEvent.type(screen.getByLabelText("Nota interna (opcional)"), "x");
    expect(screen.getByRole("button", { name: "Crear pedido" })).toBeDisabled();
  });

  it("quitar un producto lo saca de la lista", async () => {
    mount();
    await pickCustomer();
    await addProduct("1");
    await userEvent.click(screen.getByRole("button", { name: "Quitar Camiseta" }));
    expect(screen.queryByLabelText("Cantidad")).not.toBeInTheDocument();
  });
});
