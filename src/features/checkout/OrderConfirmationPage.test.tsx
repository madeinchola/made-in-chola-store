import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asCustomer, WithAuth } from "@/test/auth-test-utils";
import { makeOrder, makeRow } from "./checkout-test-utils";
import { OrderConfirmationPage } from "./OrderConfirmationPage";

const orders = vi.hoisted(() => ({ getOrderByNumber: vi.fn() }));
vi.mock("@/features/account/orders/ordersApi", async (original) => ({
  ...(await original<typeof import("@/features/account/orders/ordersApi")>()),
  ...orders,
}));
const api = vi.hoisted(() => ({ cancelOrder: vi.fn() }));
vi.mock("./checkoutApi", () => api);
const settings = vi.hoisted(() => ({
  data: { whatsapp_orders: "+59167528677" } as Record<string, string> | undefined,
}));
vi.mock("@/features/catalog/hooks", () => ({ useStoreSettings: () => ({ data: settings.data }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const open = vi.fn();

function renderAt(
  state: unknown = {
    justCreated: true,
    instruction: { kind: "whatsapp", phone_e164: "+59167528677" },
  },
  number = "MIC-000123",
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WithAuth value={asCustomer()}>
        <MemoryRouter initialEntries={[{ pathname: `/pedido/${number}`, state }]}>
          <Routes>
            <Route path="/pedido/:numero" element={<OrderConfirmationPage />} />
          </Routes>
        </MemoryRouter>
      </WithAuth>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  vi.stubGlobal("open", open);
  settings.data = { whatsapp_orders: "+59167528677" };
  orders.getOrderByNumber.mockResolvedValue(makeRow());
});
afterEach(() => vi.unstubAllGlobals());

describe("OrderConfirmationPage", () => {
  it("confirma el pedido con su número y ofrece enviarlo por WhatsApp con el mensaje armado", async () => {
    renderAt();
    expect(
      await screen.findByRole("heading", { level: 1, name: "¡Recibimos tu pedido!" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("MIC-000123");
    const link = screen.getByRole("link", { name: "Enviar el pedido por WhatsApp" });
    const href = link.getAttribute("href")!;
    expect(href.startsWith("https://wa.me/59167528677?text=")).toBe(true);
    const text = decodeURIComponent(href.split("?text=")[1]!);
    expect(text).toContain("MIC-000123");
    expect(text).toContain("• 2 × Chaqueta v1 (Negro · M) — Bs 200,00");
    expect(text).toContain("Total: Bs 215,00");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // el detalle del pedido se ve debajo
    expect(screen.getByText("Calle 1, La Paz")).toBeInTheDocument();
  });

  it("al llegar recién creado intenta abrir WhatsApp UNA vez (con noopener) y no insiste al recargar", async () => {
    const first = renderAt();
    await screen.findByRole("link", { name: "Enviar el pedido por WhatsApp" });
    expect(open).toHaveBeenCalledTimes(1);
    const [url, target, features] = open.mock.calls[0]!;
    expect(String(url)).toContain("https://wa.me/59167528677?text=");
    expect(target).toBe("_blank");
    expect(features).toContain("noopener");
    first.unmount();
    renderAt(); // «recarga»: el mismo pedido, misma pestaña
    await screen.findByRole("link", { name: "Enviar el pedido por WhatsApp" });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("si el navegador bloquea la ventana, el botón sigue ahí para reintentar", async () => {
    open.mockReturnValue(null);
    renderAt();
    expect(
      await screen.findByRole("link", { name: "Enviar el pedido por WhatsApp" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Si no se abrió WhatsApp, toca el botón/)).toBeInTheDocument();
  });

  it("al volver más tarde NO abre WhatsApp solo y el botón dice «Volver a enviar»", async () => {
    renderAt(null);
    expect(
      await screen.findByRole("link", { name: "Volver a enviar por WhatsApp" }),
    ).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it("sin número de WhatsApp de la tienda no inventa un enlace: explica y da el número de pedido", async () => {
    settings.data = {};
    renderAt({ justCreated: true, instruction: { kind: "whatsapp", phone_e164: null } });
    expect(await screen.findByText(/No pudimos preparar el enlace de WhatsApp/)).toHaveTextContent(
      "MIC-000123",
    );
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it("contra entrega: explica el pago al recibir y no ofrece WhatsApp", async () => {
    orders.getOrderByNumber.mockResolvedValue(makeRow({ payment_method: "cash_on_delivery" }));
    renderAt({ justCreated: true, instruction: { kind: "cash_on_delivery" } });
    expect(await screen.findByText(/Pagas en efectivo cuando lo recibas/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it("un pedido que ya no está pendiente no ofrece enviarlo por WhatsApp otra vez", async () => {
    orders.getOrderByNumber.mockResolvedValue(makeRow({ status: "paid" }));
    renderAt(null);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).not.toBeInTheDocument();
  });

  it("un fallo del proveedor de pago se avisa, sin perder el pedido", async () => {
    renderAt({ justCreated: true, paymentError: "provider_failed", instruction: null });
    expect(await screen.findByRole("alert")).toHaveTextContent("no pudimos preparar el pago");
    expect(screen.getByRole("alert")).toHaveTextContent("MIC-000123");
  });

  it("un pedido que no existe o es de otra persona: «No encontramos ese pedido», sin repetir el número de la URL", async () => {
    orders.getOrderByNumber.mockResolvedValue(null);
    renderAt(null, "MIC-999999");
    expect(await screen.findByText("No encontramos ese pedido")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a mis pedidos" })).toHaveAttribute(
      "href",
      "/cuenta/pedidos",
    );
    expect(document.body).not.toHaveTextContent("MIC-999999");
  });

  it("un fallo de lectura ofrece reintentar y NO dice que el pedido no existe", async () => {
    orders.getOrderByNumber
      .mockRejectedValueOnce(new Error("sin red"))
      .mockResolvedValueOnce(makeRow());
    renderAt(null);
    expect(await screen.findByText("No pudimos cargar tu pedido")).toBeInTheDocument();
    expect(screen.queryByText("No encontramos ese pedido")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Tu pedido está pendiente de confirmar",
      }),
    ).toBeInTheDocument();
  });

  it("B1: recién creado abre WhatsApp con el pedido que llegó en la navegación, SIN esperar la consulta a la base", async () => {
    orders.getOrderByNumber.mockReturnValue(new Promise(() => undefined)); // la lectura nunca responde
    renderAt({
      justCreated: true,
      instruction: { kind: "whatsapp", phone_e164: "+59167528677" },
      order: makeOrder({ number: "MIC-000123" }),
    });
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    const url = String(open.mock.calls[0]![0]);
    expect(url.startsWith("https://wa.me/59167528677?text=")).toBe(true);
    expect(decodeURIComponent(url.split("?text=")[1]!)).toContain("MIC-000123");
  });

  it("B1: un pedido en la navegación de OTRO número se ignora (no abre WhatsApp con datos ajenos)", async () => {
    orders.getOrderByNumber.mockReturnValue(new Promise(() => undefined));
    renderAt(
      {
        justCreated: true,
        instruction: { kind: "whatsapp", phone_e164: "+59167528677" },
        order: makeOrder({ number: "MIC-000999" }),
      },
      "MIC-000123",
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    ["pending_payment", "Tu pedido está pendiente de confirmar"],
    ["paid", "Pedido confirmado"],
    ["preparing", "Estamos preparando tu pedido"],
    ["shipped", "Tu pedido va en camino"],
    ["delivered", "Tu pedido fue entregado"],
    ["completed", "Pedido completado"],
    ["cancelled", "Pedido cancelado"],
    ["refunded", "Pedido reembolsado"],
  ])(
    "B5: al volver, un pedido «%s» se titula «%s» (no «¡Recibimos tu pedido!»)",
    async (status, title) => {
      orders.getOrderByNumber.mockResolvedValue(makeRow({ status }));
      renderAt(null);
      expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
      expect(screen.queryByText("¡Recibimos tu pedido!")).not.toBeInTheDocument();
    },
  );

  it("B5: un pedido cancelado no dice «te confirmamos el pago» sino que fue cancelado", async () => {
    orders.getOrderByNumber.mockResolvedValue(makeRow({ status: "cancelled" }));
    renderAt(null);
    await screen.findByRole("heading", { level: 1, name: "Pedido cancelado" });
    expect(screen.getByRole("status")).toHaveTextContent("fue cancelado");
    expect(screen.getByRole("status")).not.toHaveTextContent("Te confirmamos el pago");
  });

  it("permite cancelar mientras está pendiente (abre la confirmación)", async () => {
    renderAt(null);
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar el pedido" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "¿Cancelar el pedido MIC-000123?" }),
    ).toBeInTheDocument();
  });
});
