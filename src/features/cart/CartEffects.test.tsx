import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BagList } from "./BagList";
import { CartEffects } from "./CartEffects";
import { mergeDescription } from "./mergeMessage";
import {
  FakeCartServer,
  TOKEN,
  flush,
  makeLine,
  makeSnapshot,
  renderWithCart,
  signedIn,
} from "./cart-test-utils";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => {
  toast.mockClear();
  toast.dismiss.mockClear();
});

describe("mergeDescription", () => {
  it.each([
    [0, 0, undefined],
    [1, 0, "Ajustamos 1 producto por disponibilidad o por el máximo permitido."],
    [3, 0, "Ajustamos 3 productos por disponibilidad o por el máximo permitido."],
    [0, 1, "1 producto no se pudo juntar."],
    [0, 2, "2 productos no se pudieron juntar."],
    [
      2,
      1,
      "Ajustamos 2 productos por disponibilidad o por el máximo permitido. 1 producto no se pudo juntar.",
    ],
  ])("ajustadas %i, omitidas %i", (adjusted, skipped, expected) => {
    expect(mergeDescription(adjusted, skipped)).toBe(expected);
  });
});

describe("CartEffects · fusión al iniciar sesión", () => {
  /** Una persona con sesión cuyo equipo aún guardaba una bolsa de invitado: el proveedor la fusiona al montarse. */
  async function mergeWith(result: object) {
    const guest = makeSnapshot([makeLine("a", 1)]);
    const server = new FakeCartServer(guest);
    server.mergeResult = { merged: true, ...result };
    const view = renderWithCart(<CartEffects />, { snapshot: guest, server, auth: signedIn() });
    await flush();
    await flush();
    return { ...view, server };
  }

  it("avisa «Juntamos tu bolsa de invitado con tu cuenta» y descarta el informe (no se repite)", async () => {
    const { cart, server } = await mergeWith({
      merged_lines: 2,
      adjusted_lines: 0,
      skipped_lines: 0,
    });
    expect(server.callsOf("merge")).toEqual([{ action: "merge", cart_token: TOKEN }]);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith("Juntamos tu bolsa de invitado con tu cuenta", {});
    expect(cart().state.mergeReport).toBeNull();
  });

  it("dice cuántas líneas se ajustaron u omitieron", async () => {
    await mergeWith({ merged_lines: 3, adjusted_lines: 2, skipped_lines: 1 });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith("Juntamos tu bolsa de invitado con tu cuenta", {
      description:
        "Ajustamos 2 productos por disponibilidad o por el máximo permitido. 1 producto no se pudo juntar.",
    });
  });

  it("si no había nada que juntar, no avisa de nada", async () => {
    await mergeWith({ merged: true, merged_lines: 0, adjusted_lines: 0, skipped_lines: 0 });
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("CartEffects · ya no hay toast de «Deshacer»", () => {
  it("quitar una línea NO lanza ningún toast: el aviso va EN LÍNEA (página y cajón), alcanzable con el teclado", async () => {
    const user = userEvent.setup();
    const snapshot = makeSnapshot([makeLine("a", 3, { name: "Falda" })]);
    renderWithCart(
      <>
        <CartEffects />
        <BagList />
      </>,
      { snapshot },
    );
    await flush();
    toast.mockClear();
    await user.click(screen.getByRole("button", { name: "Quitar Falda de la bolsa" }));
    await flush();
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("CartEffects · sin carrito", () => {
  it("fuera de CartProvider no hace nada", () => {
    render(<CartEffects />);
    expect(toast).not.toHaveBeenCalled();
  });
});
