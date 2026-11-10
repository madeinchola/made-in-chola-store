import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { CancelOrderDialog } from "@/features/account/orders/CancelOrderDialog";

const api = vi.hoisted(() => ({ cancelOrder: vi.fn() }));
vi.mock("./checkoutApi", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ORDER = { id: "o-1", number: "MIC-000123" };

function setup() {
  const onOpenChange = vi.fn();
  const onDone = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CancelOrderDialog order={ORDER} open onOpenChange={onOpenChange} onDone={onDone} />
    </QueryClientProvider>,
  );
  return { onOpenChange, onDone };
}

beforeEach(() => vi.clearAllMocks());

describe("CancelOrderDialog", () => {
  it("cancela con el motivo escrito, avisa y cierra", async () => {
    api.cancelOrder.mockResolvedValue({ ok: true, data: { ok: true, outcome: "transitioned" } });
    const { onOpenChange, onDone } = setup();
    await userEvent.type(screen.getByLabelText("Motivo (opcional)"), "Me equivoqué de talla");
    await userEvent.click(screen.getByRole("button", { name: "Sí, cancelar pedido" }));
    expect(api.cancelOrder).toHaveBeenCalledWith("o-1", "Me equivoqué de talla");
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("Pedido cancelado.");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("sin motivo no manda uno vacío", async () => {
    api.cancelOrder.mockResolvedValue({ ok: true, data: { ok: true, outcome: "transitioned" } });
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Sí, cancelar pedido" }));
    expect(api.cancelOrder).toHaveBeenCalledWith("o-1", undefined);
  });

  it("si el pedido ya pasó a preparación, el servidor lo dice y se explica sin cerrar", async () => {
    api.cancelOrder.mockResolvedValue({
      ok: true,
      data: { ok: false, outcome: "invalid_transition" },
    });
    const { onOpenChange, onDone } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Sí, cancelar pedido" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ya está en preparación");
    expect(onDone).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("un fallo de red o del servidor se avisa y permite reintentar", async () => {
    api.cancelOrder.mockResolvedValueOnce({
      ok: false,
      status: 0,
      code: "network",
      message: "network",
    });
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Sí, cancelar pedido" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cancelar el pedido");
    api.cancelOrder.mockResolvedValueOnce({
      ok: true,
      data: { ok: true, outcome: "transitioned" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Sí, cancelar pedido" }));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(api.cancelOrder).toHaveBeenCalledTimes(2);
  });

  it("«No, conservar» cierra sin llamar al servidor", async () => {
    const { onOpenChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: "No, conservar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(api.cancelOrder).not.toHaveBeenCalled();
  });
});
