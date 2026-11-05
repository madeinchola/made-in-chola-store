import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MiniCartDrawer } from "./MiniCartDrawer";
import { UndoNotice } from "./UndoNotice";
import { useCart } from "./cart-context";
import {
  FakeCartServer,
  NOW,
  flush,
  makeLine,
  makeSnapshot,
  renderWithCart,
  signedIn,
} from "./cart-test-utils";
import type { CartSnapshot } from "./types";

vi.mock("@/features/catalog/mediaUrl", () => ({
  productImageUrl: (path: string) => `https://cdn.test/${path}`,
}));

/** El botón que abre el cajón (como «Agregar a la bolsa»): si cierra bien, el foco vuelve aquí. */
function Opener() {
  const { setOpen } = useCart();
  return (
    <button type="button" onClick={() => setOpen(true)}>
      Abrir bolsa
    </button>
  );
}

async function setup(
  snapshot: CartSnapshot | null,
  options: Parameters<typeof renderWithCart>[1] = {},
) {
  const view = renderWithCart(
    <>
      <Opener />
      <MiniCartDrawer />
    </>,
    { snapshot, path: "/tienda", ...options },
  );
  await flush();
  return view;
}

const opener = () => screen.getByRole("button", { name: "Abrir bolsa" });
async function openDrawer() {
  const user = userEvent.setup();
  await user.click(opener());
  // el contenido pesado llega con carga diferida
  const dialog = await screen.findByRole("dialog", { name: "Tu bolsa" });
  await within(dialog).findByRole("link", { name: "Ver bolsa" });
  return { user, dialog };
}

describe("MiniCartDrawer", () => {
  it("cerrado no pinta nada; fuera de CartProvider tampoco", async () => {
    await setup(makeSnapshot([makeLine("a", 1)]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("al abrirlo: título «Tu bolsa», líneas compactas, cuenta regresiva, subtotal del servidor y los botones «Pagar» y «Ver bolsa»", async () => {
    await setup(
      makeSnapshot([makeLine("a", 2, { name: "Falda" }), makeLine("b", 1, { name: "Blusa" })], {
        reservation: { state: "held", expires_at: new Date(Date.now() + 600_000).toISOString() },
      }),
      { auth: signedIn() },
    );
    const { dialog } = await openDrawer();
    expect(within(dialog).getByRole("heading", { name: "Tu bolsa" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Falda" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Blusa" })).toBeInTheDocument();
    expect(within(dialog).getByText(/Reservamos tus productos durante/)).toBeInTheDocument();
    expect(within(dialog).getByText("Subtotal").parentElement).toHaveTextContent("Bs 300,00");
    expect(within(dialog).getByRole("link", { name: "Ver bolsa" })).toHaveAttribute(
      "href",
      "/carrito",
    );
    expect(within(dialog).getByRole("link", { name: "Pagar" })).toHaveAttribute(
      "href",
      "/checkout",
    );
  });

  it("Esc lo cierra y el foco vuelve al botón que lo abrió", async () => {
    await setup(makeSnapshot([makeLine("a", 1)]));
    const { user } = await openDrawer();
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener()).toHaveFocus();
  });

  it("el botón de cerrar existe y mide al menos 44 px", async () => {
    await setup(makeSnapshot([makeLine("a", 1)]));
    const { user, dialog } = await openDrawer();
    const close = within(dialog).getByRole("button", { name: "Cerrar" });
    expect(close).toHaveClass("h-11", "w-11");
    await user.click(close);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("«Ver bolsa» navega a /carrito y cierra el cajón", async () => {
    await setup(makeSnapshot([makeLine("a", 1)]));
    const { user, dialog } = await openDrawer();
    await user.click(within(dialog).getByRole("link", { name: "Ver bolsa" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/carrito");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("el enlace al producto cierra el cajón aunque ya se esté en esa ficha", async () => {
    await setup(makeSnapshot([makeLine("a", 1, { name: "Falda", slug: "falda" })]), {
      path: "/producto/falda?color=negro",
    });
    const { user, dialog } = await openDrawer();
    await user.click(within(dialog).getByRole("link", { name: "Falda" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("se cierra solo al navegar a otra página (p. ej. con el botón atrás)", async () => {
    const goto: { current: ((to: string) => void) | null } = { current: null };
    function Navigator() {
      goto.current = useNavigate();
      return null;
    }
    renderWithCart(
      <>
        <Opener />
        <MiniCartDrawer />
        <Navigator />
      </>,
      { snapshot: makeSnapshot([makeLine("a", 1)]), path: "/tienda" },
    );
    await flush();
    await openDrawer();
    act(() => goto.current?.("/coleccion/verano"));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("location")).toHaveTextContent("/coleccion/verano");
  });

  it("bolsa vacía: mensaje amable y enlace a la tienda, sin subtotal ni botones de pago", async () => {
    await setup(makeSnapshot([]));
    const user = userEvent.setup();
    await user.click(opener());
    const dialog = await screen.findByRole("dialog", { name: "Tu bolsa" });
    expect(await within(dialog).findByText("Tu bolsa está vacía")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Ir a la tienda" })).toHaveAttribute(
      "href",
      "/tienda",
    );
    expect(within(dialog).queryByText("Subtotal")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: "Pagar" })).not.toBeInTheDocument();
  });

  it("un producto recién agregado que el servidor aún no confirma NO parpadea como «vacía»", async () => {
    const server = new FakeCartServer(makeSnapshot([]));
    const { cart } = await setup(makeSnapshot([]), { server });
    const resume = server.pause();
    act(() => {
      cart().store.setQty("nuevo", 1);
      cart().setOpen(true);
    });
    const dialog = await screen.findByRole("dialog", { name: "Tu bolsa" });
    expect(await within(dialog).findByText("Agregando a tu bolsa…")).toBeInTheDocument();
    expect(within(dialog).queryByText("Tu bolsa está vacía")).not.toBeInTheDocument();
    await act(async () => {
      resume();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(await within(dialog).findByRole("link", { name: "Chaqueta nuevo" })).toBeInTheDocument();
  });

  it("quitar dentro del cajón muestra «Deshacer» dentro del cajón (un toast quedaría fuera del diálogo modal)", async () => {
    await setup(makeSnapshot([makeLine("a", 2, { name: "Falda" })]));
    const { user, dialog } = await openDrawer();
    await user.click(within(dialog).getByRole("button", { name: "Quitar Falda de la bolsa" }));
    expect(within(dialog).getByText("Quitaste «Falda» de la bolsa")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Deshacer" }));
    await flush();
    expect(within(dialog).getByRole("link", { name: "Falda" })).toBeInTheDocument();
    expect(within(dialog).queryByText(/Quitaste/)).not.toBeInTheDocument();
  });

  it("un alta que no cabe se explica dentro del cajón", async () => {
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 1)]));
    server.onSetItem = () => ({
      ok: true,
      data: {
        token_state: "ok",
        server_time: new Date(NOW).toISOString(),
        cart: server.snapshot,
        outcome: "out_of_stock",
        requested: 1,
        applied: 0,
      },
    });
    const { cart } = await setup(makeSnapshot([makeLine("a", 1)]), { server });
    act(() => {
      cart().store.setQty("otra", 1);
      cart().setOpen(true);
    });
    const dialog = await screen.findByRole("dialog", { name: "Tu bolsa" });
    expect(
      await within(dialog).findByText("No pudimos agregar ese producto: se agotó."),
    ).toBeInTheDocument();
  });

  it("sin conexión muestra el aviso dentro del cajón", async () => {
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 1)]));
    const { cart } = await setup(makeSnapshot([makeLine("a", 1)]), { server });
    server.forced = { ok: false, status: 0, code: "network", message: "network" };
    act(() => cart().store.setQty("a", 2));
    await flush();
    act(() => cart().setOpen(true));
    const dialog = await screen.findByRole("dialog", { name: "Tu bolsa" });
    expect(
      await within(dialog).findByText(
        "Sin conexión. Mantén esta pestaña abierta: enviaremos tus cambios cuando vuelva la conexión.",
      ),
    ).toBeInTheDocument();
  });
});

describe("UndoNotice", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("desaparece solo a los 8 segundos (y entonces ya no se puede deshacer)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // con `setTimeout` falso, las promesas del servidor falso avanzan con el reloj falso
    const advance = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    const snapshot = makeSnapshot([makeLine("a", 1, { name: "Falda" })]);
    const { cart } = renderWithCart(<UndoNotice />, { snapshot });
    await advance(0);
    act(() => cart().store.remove("a"));
    await advance(0);
    expect(screen.getByText("Quitaste «Falda» de la bolsa")).toBeInTheDocument();
    await advance(7999);
    expect(screen.getByText("Quitaste «Falda» de la bolsa")).toBeInTheDocument();
    await advance(1);
    expect(screen.queryByText(/Quitaste/)).not.toBeInTheDocument();
    expect(cart().state.lastRemoved).toBeNull();
  });
});

describe("MiniCartDrawer · la bolsa no se pudo leer", () => {
  it("con sesión y sin red dice que no se pudo cargar (no «Tu bolsa está vacía») y deja reintentar", async () => {
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 3)]));
    server.forced = { ok: false, status: 0, code: "network", message: "network" };
    renderWithCart(
      <>
        <Opener />
        <MiniCartDrawer />
      </>,
      { server, auth: signedIn(), path: "/tienda" },
    );
    await flush();
    const user = userEvent.setup();
    await user.click(opener());
    const dialog = await screen.findByRole("dialog", { name: "Tu bolsa" });
    expect(await within(dialog).findByText("No pudimos cargar tu bolsa")).toBeInTheDocument();
    expect(within(dialog).queryByText("Tu bolsa está vacía")).not.toBeInTheDocument();
    server.forced = null;
    await user.click(within(dialog).getByRole("button", { name: "Reintentar" }));
    await flush();
    expect(await within(dialog).findByRole("link", { name: "Pagar" })).toBeInTheDocument();
  });

  it("quitar una línea deja el subtotal atenuado mientras el servidor no confirma", async () => {
    const server = new FakeCartServer(
      makeSnapshot([makeLine("a", 1, { name: "Falda" }), makeLine("b", 1, { name: "Blusa" })]),
    );
    await setup(
      makeSnapshot([makeLine("a", 1, { name: "Falda" }), makeLine("b", 1, { name: "Blusa" })]),
      { server },
    );
    const { user, dialog } = await openDrawer();
    const resume = server.pause();
    await user.click(within(dialog).getByRole("button", { name: "Quitar Falda de la bolsa" }));
    const subtotal = within(dialog).getByText("Subtotal").closest("p");
    expect(subtotal).toHaveClass("opacity-60");
    expect(subtotal).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      resume();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(subtotal).not.toHaveClass("opacity-60");
  });
});
