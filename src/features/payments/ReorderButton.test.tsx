import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeLine, makeSnapshot, renderWithCart, signedIn } from "@/features/cart/cart-test-utils";
import { ReorderButton } from "./ReorderButton";

const api = vi.hoisted(() => ({ listOrderLines: vi.fn() }));
vi.mock("./paymentsApi", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const render = (inBag: [string, number][] = []) =>
  renderWithCart(<ReorderButton orderId="o-1" />, {
    snapshot: makeSnapshot(inBag.map(([variant, qty]) => makeLine(variant, qty))),
    auth: signedIn(),
    path: "/pedido/MIC-000123",
  });

beforeEach(() => vi.clearAllMocks());

describe("ReorderButton", () => {
  it("vuelve a poner cada producto del pedido en la bolsa y lleva a la bolsa", async () => {
    api.listOrderLines.mockResolvedValue([
      { variantId: "v1", qty: 2 },
      { variantId: "v2", qty: 1 },
    ]);
    const view = render();
    const spy = vi.spyOn(view.cart().store, "setQty");
    await userEvent.click(screen.getByRole("button", { name: "Volver a pedir" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy).toHaveBeenNthCalledWith(1, "v1", 2);
    expect(spy).toHaveBeenNthCalledWith(2, "v2", 1);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/carrito"));
  });

  it("no rebaja lo que la clienta ya llevaba en la bolsa: queda el mayor (antes lo pisaba con la cantidad del pedido viejo)", async () => {
    api.listOrderLines.mockResolvedValue([
      { variantId: "v1", qty: 2 }, // ya llevaba 5: se queda en 5
      { variantId: "v2", qty: 3 }, // ya llevaba 1: sube a 3
      { variantId: "v3", qty: 1 }, // no estaba: entra con 1
    ]);
    const view = render([
      ["v1", 5],
      ["v2", 1],
    ]);
    const spy = vi.spyOn(view.cart().store, "setQty");
    await userEvent.click(screen.getByRole("button", { name: "Volver a pedir" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(3));
    expect(spy).toHaveBeenNthCalledWith(1, "v1", 5);
    expect(spy).toHaveBeenNthCalledWith(2, "v2", 3);
    expect(spy).toHaveBeenNthCalledWith(3, "v3", 1);
  });

  it("un pedido sin productos lo dice y no navega", async () => {
    api.listOrderLines.mockResolvedValue([]);
    render();
    await userEvent.click(screen.getByRole("button", { name: "Volver a pedir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no tiene productos");
    expect(screen.getByTestId("location")).toHaveTextContent("/pedido/MIC-000123");
  });

  it("si no se pueden leer las líneas lo dice y deja reintentar", async () => {
    api.listOrderLines
      .mockRejectedValueOnce(new Error("sin red"))
      .mockResolvedValueOnce([{ variantId: "v1", qty: 1 }]);
    render();
    await userEvent.click(screen.getByRole("button", { name: "Volver a pedir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos volver a poner");
    await userEvent.click(screen.getByRole("button", { name: "Volver a pedir" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/carrito"));
  });

  it("mientras trabaja bloquea el botón (un doble clic no pide dos veces)", async () => {
    let finish: (value: unknown) => void = () => {};
    api.listOrderLines.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render();
    await userEvent.click(screen.getByRole("button", { name: "Volver a pedir" }));
    const busy = await screen.findByRole("button", { name: "Preparando tu bolsa…" });
    expect(busy).toBeDisabled();
    await userEvent.click(busy);
    expect(api.listOrderLines).toHaveBeenCalledTimes(1);
    finish([{ variantId: "v1", qty: 1 }]);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/carrito"));
  });
});
