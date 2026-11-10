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
/** La región viva sr-only del cajón («Agregando…», «Tu bolsa está vacía»): un `<p role="status" class="sr-only">` fuera de las líneas. */
const spoken = (dialog: HTMLElement) =>
  within(dialog)
    .getAllByRole("status")
    .find((el) => el.tagName === "P" && el.classList.contains("sr-only") && !el.closest("li"))!;
/** La región viva de AVISOS del cajón: la primera región educada que no es de una línea (va antes que la cuenta regresiva). */
const noticeRegion = (dialog: HTMLElement) =>
  Array.from(
    dialog.querySelectorAll<HTMLElement>(
      '[role="status"][aria-live="polite"][aria-atomic="false"]',
    ),
  ).find((el) => !el.closest("li"))!;
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
    // la fila provisional lo dice con texto y la región viva sr-only (que existía antes) también
    expect(await within(dialog).findByRole("listitem")).toHaveTextContent("Agregando a tu bolsa…");
    expect(spoken(dialog)).toHaveTextContent("Agregando a tu bolsa…");
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
        "Sin conexión. Enviaremos tus cambios cuando vuelva la conexión.",
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
    // sin `aria-busy` (algunos lectores no leen un contenedor ocupado y el subtotal es justo lo que se quiere oír); lo dice
    // la región viva sr-only, que ya existía (pasa de «Actualizando…» a vacía)
    expect(subtotal).not.toHaveAttribute("aria-busy");
    expect(subtotal!.closest("[aria-busy]")).toBeNull();
    const updating = subtotal!.nextElementSibling as HTMLElement; // la región viva sr-only que acompaña al subtotal
    expect(updating).toHaveAttribute("role", "status");
    expect(updating).toHaveTextContent("Actualizando…");
    await act(async () => {
      resume();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(subtotal).not.toHaveClass("opacity-60");
    expect(subtotal!.nextElementSibling).toBe(updating); // el mismo nodo: cambió su texto, no se recreó
    expect(updating).toBeEmptyDOMElement();
  });
});

describe("MiniCartDrawer · regiones vivas dentro del diálogo y foco", () => {
  it("la región de avisos vive DENTRO del cajón (lo de fuera es inerte), existe vacía y «Deshacer» entra en ese nodo", async () => {
    await setup(makeSnapshot([makeLine("a", 2, { name: "Falda" })]));
    const { user, dialog } = await openDrawer();
    const region = noticeRegion(dialog);
    expect(region).toBeInTheDocument();
    expect(dialog).toContainElement(region);
    expect(region).toBeEmptyDOMElement();

    await user.click(within(dialog).getByRole("button", { name: "Quitar Falda de la bolsa" }));
    expect(noticeRegion(dialog)).toBe(region);
    expect(region).toContainElement(within(dialog).getByRole("button", { name: "Deshacer" }));
    expect(region.querySelectorAll("[role]")).toHaveLength(0);
  });

  it("quitar la última línea con el cajón abierto lo DICE (región sr-only que ya existía); abrirlo ya vacío no lo repite", async () => {
    // abierto ya vacío: el texto visible basta, la región sr-only no lo duplica
    const emptyView = await setup(makeSnapshot([]));
    const first = userEvent.setup();
    await first.click(opener());
    const emptyDialog = await screen.findByRole("dialog", { name: "Tu bolsa" });
    expect(await within(emptyDialog).findByText("Tu bolsa está vacía")).toBeInTheDocument();
    expect(spoken(emptyDialog)).toBeEmptyDOMElement();
    await first.keyboard("{Escape}");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    emptyView.unmount();

    // se vacía con el cajón abierto: la MISMA región pasa de vacía a «Tu bolsa está vacía»
    await setup(makeSnapshot([makeLine("a", 1, { name: "Falda" })]));
    const { user, dialog } = await openDrawer();
    const region = spoken(dialog);
    expect(region).toBeEmptyDOMElement();
    await user.click(within(dialog).getByRole("button", { name: "Quitar Falda de la bolsa" }));
    await flush();
    expect(spoken(dialog)).toBe(region);
    expect(region).toHaveTextContent("Tu bolsa está vacía");
  });

  it("cerrar un aviso dentro del cajón no deja el foco en el <body>: queda dentro del diálogo, en su título", async () => {
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
    const close = await within(dialog).findByRole("button", { name: "Cerrar aviso" });
    const user = userEvent.setup();
    await user.click(close);
    expect(close).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(within(dialog).getByRole("heading", { name: "Tu bolsa" })).toHaveFocus();
  });

  it("«Deshacer» dentro del cajón: el aviso se va y el foco sigue dentro del diálogo", async () => {
    await setup(makeSnapshot([makeLine("a", 2, { name: "Falda" })]));
    const { user, dialog } = await openDrawer();
    await user.click(within(dialog).getByRole("button", { name: "Quitar Falda de la bolsa" }));
    await user.click(within(dialog).getByRole("button", { name: "Deshacer" }));
    await flush();
    expect(within(dialog).queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("«Reintentar» de «No pudimos cargar tu bolsa»: al cargar, el foco queda dentro del diálogo (no en el <body>)", async () => {
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
    const retry = await within(dialog).findByRole("button", { name: "Reintentar" });
    server.forced = null;
    await user.click(retry);
    await flush();
    expect(await within(dialog).findByRole("link", { name: "Pagar" })).toBeInTheDocument();
    expect(retry).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });
});

describe("MiniCartDrawer · carga y foco con otra página detrás", () => {
  it("mientras la bolsa se lee, el cajón lo dice con la región sr-only y el esqueleto NO es aria-busy", async () => {
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 1, { name: "Falda" })]));
    const resume = server.pause();
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
    await vi.waitFor(() => expect(spoken(dialog)).toHaveTextContent("Cargando tu bolsa…"));
    expect(dialog.querySelector("[aria-busy]")).toBeNull();
    const region = spoken(dialog);
    await act(async () => {
      resume();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await within(dialog).findByRole("link", { name: "Falda" })).toBeInTheDocument();
    expect(spoken(dialog)).not.toBe(region); // otra rama de la vista (cargada): su propia región, ya sin «Cargando…»
    expect(spoken(dialog)).toBeEmptyDOMElement();
  });

  it("con la página de la bolsa detrás, el foco rescatado va al título DEL CAJÓN, no al de la página", async () => {
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
    const view = renderWithCart(
      <>
        <h1 tabIndex={-1} data-cart-heading="">
          Título de la página
        </h1>
        <Opener />
        <MiniCartDrawer />
      </>,
      { snapshot: makeSnapshot([makeLine("a", 1)]), server, path: "/tienda" },
    );
    await flush();
    act(() => {
      view.cart().store.setQty("otra", 1);
      view.cart().setOpen(true);
    });
    const dialog = await screen.findByRole("dialog", { name: "Tu bolsa" });
    const user = userEvent.setup();
    await user.click(await within(dialog).findByRole("button", { name: "Cerrar aviso" }));
    expect(within(dialog).getByRole("heading", { name: "Tu bolsa" })).toHaveFocus();
    expect(screen.getByText("Título de la página")).not.toHaveFocus();
  });
});

describe("MiniCartDrawer · descuentos (S9)", () => {
  /** Dos unidades de Bs 100 con un descuento de Bs 30 → se paga Bs 170 (números del «servidor»). */
  const discounted = () =>
    makeSnapshot(
      [
        makeLine("a", 2, {
          name: "Falda",
          unit_price: 100,
          line_total: 200,
          discount: 30,
          final_total: 170,
          discount_offers: [
            {
              discount_id: "d1",
              name: "Oferta de temporada",
              kind: "percent",
              amount: 30,
              coupon: false,
            },
          ],
        }),
      ],
      {
        totals: {
          subtotal: 200,
          item_count: 2,
          line_count: 1,
          shipping: null,
          discount: 30,
          total: 170,
        },
      },
    );

  it("las líneas compactas muestran el total tachado y el final, y el pie agrega «Descuento» y el total del servidor (ya neto)", async () => {
    await setup(discounted());
    const { dialog } = await openDrawer();
    expect(within(dialog).getByText(/Total de la línea:/)).toHaveTextContent(
      "Total de la línea: Bs 170,00, antes Bs 200,00",
    );
    expect(within(dialog).getByText("Oferta de temporada −Bs 30,00")).toBeInTheDocument();
    expect(within(dialog).getByText("Subtotal").parentElement).toHaveTextContent("Bs 200,00");
    expect(within(dialog).getByText("Descuento").parentElement).toHaveTextContent("-Bs 30,00");
    expect(within(dialog).getByText("Total").parentElement).toHaveTextContent("Bs 170,00");
  });

  it("las filas del descuento se atenúan junto con el subtotal mientras hay un cambio sin confirmar", async () => {
    const server = new FakeCartServer(discounted());
    await setup(discounted(), { server });
    const { user, dialog } = await openDrawer();
    const resume = server.pause();
    await user.click(within(dialog).getByRole("button", { name: /^Aumentar la cantidad de / }));
    expect(within(dialog).getByText("Descuento").closest("div")).toHaveClass("opacity-60");
    await act(async () => {
      resume();
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("sin descuento el pie es el de siempre (solo «Subtotal», sin «Descuento» ni «Total»)", async () => {
    await setup(makeSnapshot([makeLine("a", 2)]));
    const { dialog } = await openDrawer();
    expect(within(dialog).getByText("Subtotal").parentElement).toHaveTextContent("Bs 200,00");
    expect(within(dialog).queryByText("Descuento")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Total")).not.toBeInTheDocument();
  });

  it("el cupón se pone en la bolsa, no en el cajón: el cajón no lleva el formulario", async () => {
    await setup(discounted());
    const { dialog } = await openDrawer();
    expect(
      within(dialog).queryByRole("textbox", { name: "Código de cupón" }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText("¿Tienes un cupón?")).not.toBeInTheDocument();
  });

  it("una foto vieja (sin campos S9) no rompe el cajón", async () => {
    await setup(makeSnapshot([makeLine("a", 1)]));
    const { dialog } = await openDrawer();
    expect(within(dialog).getByText(/Total de la línea:/).parentElement).toHaveTextContent(
      "Bs 100,00",
    );
  });
});
