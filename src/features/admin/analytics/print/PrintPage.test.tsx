import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ordersApi from "../../orders/api";
import { PrintPage } from "./PrintPage";
import type { OrderDetail } from "../../orders/types";

vi.mock("../../orders/api", () => ({ getOrder: vi.fn() }));
const api = vi.mocked(ordersApi);

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

function mount(search: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/admin/pedidos/imprimir${search}`]}>
        <PrintPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const order = (id: string, number: string, over: Partial<OrderDetail> = {}): OrderDetail =>
  ({
    id,
    number,
    status: "preparing",
    channel: "web",
    contactName: "Ana Pérez",
    contactPhone: "+59171234567",
    total: 245,
    currency: "BOB",
    paymentMethod: "whatsapp",
    paymentProvider: "whatsapp",
    createdAt: "",
    updatedAt: "",
    profileId: "p",
    subtotal: 240,
    discountTotal: 0,
    shippingCost: 5,
    shippingDiscount: 0,
    contactEmail: null,
    shippingKind: "delivery",
    shippingName: "A domicilio",
    address: {
      recipient: "Ana Pérez",
      phone: "+59171234567",
      line1: "Av. Arce 123",
      line2: "Edif. Sol",
      city: "La Paz",
      department: "La Paz",
      country: "BO",
      reference: "frente a la farmacia",
      lat: null,
      lng: null,
    },
    slot: { date: "2026-11-20", start: "10:00:00", end: "12:00:00" },
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
        id: `${id}-1`,
        lineNo: 1,
        variantId: "v1",
        productId: "p1",
        name: "Blusa bordada",
        colorName: "Rojo",
        sizeLabel: "M",
        sku: "BLU-1-R-M",
        imagePath: null,
        qty: 2,
        unitPrice: 100,
        lineTotal: 200,
        discount: 0,
        finalTotal: 200,
      },
      {
        id: `${id}-2`,
        lineNo: 2,
        variantId: "v2",
        productId: "p2",
        name: "Falda",
        colorName: "Azul",
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
  }) as OrderDetail;

beforeEach(() => {
  vi.clearAllMocks();
  api.getOrder.mockImplementation(async (id) => {
    if (id === A) return order(A, "MIC-000001");
    if (id === B)
      return order(B, "MIC-000002", {
        paymentMethod: "cash_on_delivery",
        slot: { date: "2026-11-19", start: "09:00:00", end: null },
      });
    if (id === C)
      return order(C, "MIC-000003", {
        shippingKind: "pickup",
        shippingName: "Recojo",
        address: null,
        slot: null,
      });
    return null;
  });
});

afterEach(() => vi.restoreAllMocks());

const style = () => document.querySelector("style")?.textContent ?? "";

describe("PrintPage: etiquetas", () => {
  it("una etiqueta por pedido, cada una en su hoja (salto de página entre una y otra)", async () => {
    mount(`?ids=${A},${B}&doc=label`);
    const area = await screen.findByTestId("print-area");
    const sheets = area.querySelectorAll("section.print-page");
    expect(sheets).toHaveLength(2);
    expect(within(sheets[0] as HTMLElement).getByText("MIC-000001")).toBeInTheDocument();
    expect(within(sheets[1] as HTMLElement).getByText("MIC-000002")).toBeInTheDocument();
    expect(style()).toContain("break-after: page");
  });

  it("lleva la dirección completa, el teléfono, la franja y las unidades", async () => {
    mount(`?ids=${A}&doc=label`);
    const sheet = (await screen.findByTestId("print-area")).querySelector("section") as HTMLElement;
    expect(within(sheet).getByText("Ana Pérez")).toBeInTheDocument();
    expect(within(sheet).getByText(/Tel\. \+59171234567/)).toBeInTheDocument();
    expect(within(sheet).getByText("Av. Arce 123")).toBeInTheDocument();
    expect(within(sheet).getByText("La Paz, La Paz")).toBeInTheDocument();
    expect(within(sheet).getByText("Ref.: frente a la farmacia")).toBeInTheDocument();
    expect(within(sheet).getByText(/2026-11-20, 10:00–12:00/)).toBeInTheDocument();
    expect(within(sheet).getByText(/Unidades:/).parentElement).toHaveTextContent("Unidades: 3");
  });

  it("un contra entrega dice cuánto cobrar; uno que no lo es, no", async () => {
    mount(`?ids=${A},${B}&doc=label`);
    const sheets = (await screen.findByTestId("print-area")).querySelectorAll("section");
    expect(
      within(sheets[0] as HTMLElement).queryByText(/COBRAR AL ENTREGAR/),
    ).not.toBeInTheDocument();
    expect(
      within(sheets[1] as HTMLElement).getByText("COBRAR AL ENTREGAR: Bs 245,00"),
    ).toBeInTheDocument();
  });

  it("los pedidos de recojo no llevan etiqueta de envío y se avisa", async () => {
    mount(`?ids=${A},${C}&doc=label`);
    const area = await screen.findByTestId("print-area");
    expect(area.querySelectorAll("section")).toHaveLength(1);
    expect(
      screen.getByText("1 pedidos son de recojo y no llevan etiqueta de envío."),
    ).toBeInTheDocument();
  });

  it("si todos son de recojo lo dice en vez de imprimir hojas vacías", async () => {
    mount(`?ids=${C}&doc=label`);
    expect(
      await screen.findByText(/Ninguno de los pedidos elegidos necesita etiqueta/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("print-area")).not.toBeInTheDocument();
  });

  it("una dirección larguísima y con caracteres especiales no rompe la etiqueta: se achica y se parte en líneas", async () => {
    const long = "Calle Ñandú ".repeat(30) + '<b>#</b> & "comillas"';
    api.getOrder.mockResolvedValue(
      order(A, "MIC-000001", {
        address: {
          recipient: "María José de los Ángeles Fernández-Quispe",
          phone: "+59171234567",
          line1: long,
          line2: null,
          city: "La Paz",
          department: null,
          country: "BO",
          reference: null,
          lat: null,
          lng: null,
        },
      }),
    );
    mount(`?ids=${A}&doc=label&formato=label`);
    const sheet = (await screen.findByTestId("print-area")).querySelector("section") as HTMLElement;
    expect(within(sheet).getByText(/Calle Ñandú/)).toBeInTheDocument();
    expect(within(sheet).getByText(/<b>#<\/b> & "comillas"/)).toBeInTheDocument(); // texto, no HTML
    expect(sheet.querySelector("b")).toBeNull();
    expect(sheet.querySelector(".print-text")).toHaveStyle({ fontSize: "8pt" }); // 12 − 4 para 260+ caracteres
  });
});

describe("PrintPage: guía de despacho y lista de empaque", () => {
  it("la guía es UNA hoja con todos los pedidos en el orden de la ruta (la franja más temprana primero) y sus totales", async () => {
    mount(`?ids=${A},${B}&doc=dispatch&formato=a4`);
    const area = await screen.findByTestId("print-area");
    expect(area.querySelectorAll("section.print-page")).toHaveLength(1);
    const rows = within(area).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getByText("MIC-000002")).toBeInTheDocument(); // 19-nov antes que 20-nov
    expect(within(rows[2] as HTMLElement).getByText("MIC-000001")).toBeInTheDocument();
    expect(within(area).getByText("2 pedidos · 6 unidades")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("Bs 245,00")).toBeInTheDocument();
    expect(style()).toContain("@page { size: A4 landscape; margin: 12mm; }");
  });

  it("la guía marca los pedidos de recojo en vez de inventarles una dirección", async () => {
    mount(`?ids=${C}&doc=dispatch`);
    expect(await screen.findByText("Recojo en el taller")).toBeInTheDocument();
    expect(screen.getByText("Sin franja")).toBeInTheDocument();
  });

  it("la lista de empaque es una hoja por pedido con sus líneas, SKU, color, talla y cantidad", async () => {
    mount(`?ids=${A},${B}&doc=packing&formato=letter`);
    const area = await screen.findByTestId("print-area");
    const sheets = area.querySelectorAll("section.print-page");
    expect(sheets).toHaveLength(2);
    const first = within(sheets[0] as HTMLElement);
    expect(first.getByText("BLU-1-R-M")).toBeInTheDocument();
    expect(first.getByText("Blusa bordada")).toBeInTheDocument();
    expect(first.getByText("3 unidades")).toBeInTheDocument();
    expect(first.getAllByText("—").length).toBeGreaterThan(0); // la falda no tiene SKU ni talla
    expect(first.getAllByText("☐")).toHaveLength(2);
    expect(style()).toContain("@page { size: letter; margin: 12mm; }");
  });
});

describe("PrintPage: formato y controles", () => {
  it("el formato «etiqueta» fija la página en 10 × 15 cm y por omisión la etiqueta usa ese formato", async () => {
    mount(`?ids=${A}&doc=label`);
    await screen.findByTestId("print-area");
    expect(style()).toContain("@page { size: 100mm 150mm; margin: 4mm; }");
    expect(screen.getByLabelText("Tamaño del papel")).toHaveValue("label");
  });

  it("cambiar el documento o el papel cambia la hoja sin recargar los pedidos", async () => {
    const user = userEvent.setup();
    mount(`?ids=${A}&doc=label`);
    await screen.findByTestId("print-area");
    await user.selectOptions(screen.getByLabelText("Documento"), "packing");
    await user.selectOptions(screen.getByLabelText("Tamaño del papel"), "a4");
    await waitFor(() => expect(style()).toContain("@page { size: A4; margin: 12mm; }"));
    expect(screen.getByText("3 unidades")).toBeInTheDocument();
    expect(api.getOrder).toHaveBeenCalledTimes(1);
  });

  it("imprimir llama al cuadro de impresión del navegador", async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    mount(`?ids=${A}`);
    await screen.findByTestId("print-area");
    await user.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("sin pedidos en la dirección lo dice y no deja imprimir; los identificadores falsos se ignoran", async () => {
    mount(`?ids=no-es-id,"><script>`);
    expect(await screen.findByText(/No hay pedidos para imprimir/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimir" })).toBeDisabled();
    expect(api.getOrder).not.toHaveBeenCalled();
  });

  it("un pedido que no existe se avisa y no tumba a los demás", async () => {
    mount(`?ids=${A},44444444-4444-4444-8444-444444444444&doc=label`);
    const area = await screen.findByTestId("print-area");
    expect(area.querySelectorAll("section")).toHaveLength(1);
    expect(screen.getByText("1 pedidos no se encontraron y no se imprimen.")).toBeInTheDocument();
  });

  it("si falla la carga lo dice y deja reintentar", async () => {
    api.getOrder.mockRejectedValue(new Error("x"));
    mount(`?ids=${A}`);
    expect(await screen.findByText("No se pudieron cargar los pedidos.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("los controles no se imprimen (clase «no-print») y solo la hoja queda visible al imprimir", async () => {
    mount(`?ids=${A}&doc=label`);
    await screen.findByTestId("print-area");
    expect(screen.getByRole("button", { name: "Imprimir" }).closest(".no-print")).not.toBeNull();
    expect(style()).toContain("@media print");
    expect(style()).toContain(".no-print { display: none");
  });
});
