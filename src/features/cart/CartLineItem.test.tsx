import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BagList } from "./BagList";
import { FakeCartServer, flush, makeLine, makeSnapshot, renderWithCart } from "./cart-test-utils";

vi.mock("@/features/catalog/mediaUrl", () => ({
  productImageUrl: (path: string) => `https://cdn.test/${path}`,
}));

async function setup(lines = [makeLine("a", 2)], server?: FakeCartServer) {
  const snapshot = makeSnapshot(lines);
  const view = renderWithCart(<BagList />, { snapshot, ...(server ? { server } : {}) });
  await flush();
  return view;
}

const plus = () => screen.getByRole("button", { name: /^Aumentar la cantidad de / });
const minus = () => screen.getByRole("button", { name: /^Disminuir la cantidad de / });
const field = () => screen.getByRole("textbox", { name: /^Cantidad de / }) as HTMLInputElement;

describe("CartLineItem · contenido", () => {
  it("nombre enlazado a la ficha (con su color), color y talla, precio por unidad y total de la línea", async () => {
    await setup([
      makeLine("a", 2, {
        unit_price: 560,
        line_total: 1120,
        name: "Chaqueta Japandi",
        slug: "chaqueta-japandi",
      }),
    ]);
    const link = screen.getByRole("link", { name: "Chaqueta Japandi" });
    expect(link).toHaveAttribute("href", "/producto/chaqueta-japandi?color=negro");
    expect(screen.getByText("Color: Negro · Talla: M")).toBeInTheDocument();
    expect(screen.getByText(/Precio por unidad:/).parentElement).toHaveTextContent("Bs 560,00");
    expect(screen.getByText(/Total de la línea:/).parentElement).toHaveTextContent("Bs 1.120,00");
    expect(screen.getByRole("list", { name: "Productos en tu bolsa" })).toBeInTheDocument();
  });

  it("un producto sin color ni talla no inventa etiquetas", async () => {
    await setup([makeLine("a", 1, { color_name: null, size_label: null })]);
    expect(screen.queryByText(/Color:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Talla:/)).not.toBeInTheDocument();
  });

  it("sin fotografía muestra el marcador provisional; con fotografía, la imagen sin texto alternativo (el nombre ya está al lado)", async () => {
    const { container, unmount } = await setup([makeLine("a", 1)]);
    expect(container.querySelector("[data-placeholder]")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    unmount();
    const view = await setup([makeLine("a", 1, { image_path: "products/p1/a.jpg" })]);
    const img = view.container.querySelector("img");
    expect(img).toHaveAttribute("src", "https://cdn.test/products/p1/a.jpg");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("width", "500");
  });

  it("una imagen rota cae al marcador", async () => {
    const { container } = await setup([makeLine("a", 1, { image_path: "rota.jpg" })]);
    const img = container.querySelector("img")!;
    act(() => {
      img.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-placeholder]")).not.toBeNull();
  });

  it("el enlace de la foto es decorativo: no duplica el enlace del nombre en el orden de tabulación", async () => {
    const { container } = await setup([makeLine("a", 1)]);
    const links = Array.from(container.querySelectorAll("a"));
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("tabindex", "-1");
    expect(links[0]).toHaveAttribute("aria-hidden", "true");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("con aviso de precio muestra tachado el precio con el que se agregó, SOLO si difiere", async () => {
    const { unmount } = await setup([
      makeLine("a", 1, {
        status: "price_changed",
        price_notice: "dropped",
        unit_price: 90,
        price_at_add: 100,
        line_total: 90,
      }),
    ]);
    const struck = document.querySelector("s")!;
    expect(struck).toHaveTextContent("Bs 100,00");
    expect(struck).toHaveTextContent("Precio al agregar:");
    unmount();
    await setup([
      makeLine("a", 1, { price_notice: "guaranteed", unit_price: 100, price_at_add: 100 }),
    ]);
    expect(document.querySelector("s")).toBeNull();
  });

  it("los importes se muestran tal cual los entrega el servidor, aunque no cuadren con cantidad × precio", async () => {
    await setup([makeLine("a", 3, { unit_price: 100, line_total: 123.45 })]);
    expect(screen.getByText(/Total de la línea:/).parentElement).toHaveTextContent("Bs 123,45");
  });
});

describe("CartLineItem · cantidad", () => {
  it("«+» pide la cantidad ABSOLUTA (no «sumar uno») y el servidor la confirma", async () => {
    const user = userEvent.setup();
    const { server } = await setup([makeLine("a", 2)]);
    await user.click(plus());
    await flush();
    expect(server.callsOf("set_item")).toEqual([
      { action: "set_item", variant_id: "a", qty: 3, cart_token: expect.any(String) },
    ]);
    expect(field().value).toBe("3");
    expect(screen.getByText(/Total de la línea:/).parentElement).toHaveTextContent("Bs 300,00");
  });

  it("el cambio se ve al instante y mientras el servidor no responde la línea dice que se está actualizando (región viva existente, sin aria-busy)", async () => {
    const user = userEvent.setup();
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 2)]));
    await setup([makeLine("a", 2)], server);
    const item = screen.getByRole("listitem");
    // la región viva «Actualizando…» (sr-only) existe desde el principio, vacía
    const status = within(item)
      .getAllByRole("status")
      .find((el) => el.classList.contains("sr-only"))!;
    expect(status).toBeEmptyDOMElement();
    const resume = server.pause();
    await user.click(plus());
    // ya muestra 3 aunque el servidor no ha contestado; el total sigue siendo el del servidor, atenuado
    expect(field().value).toBe("3");
    const total = screen.getByText(/Total de la línea:/).parentElement!;
    expect(total).toHaveTextContent("Bs 200,00");
    expect(total).toHaveClass("opacity-60");
    // `aria-busy` haría que algunos lectores de pantalla no anuncien lo que hay dentro (la propia región viva)
    expect(item).not.toHaveAttribute("aria-busy");
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent("Actualizando…"); // el texto entró en el MISMO nodo que ya estaba
    await act(async () => {
      resume();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByText("Actualizando…")).not.toBeInTheDocument();
    expect(status).toBeEmptyDOMElement();
    expect(item).not.toHaveAttribute("aria-busy");
    expect(screen.getByText(/Total de la línea:/).parentElement).toHaveTextContent("Bs 300,00");
    expect(screen.getByText(/Total de la línea:/).parentElement).not.toHaveClass("opacity-60");
  });

  it("varios clics seguidos son UNA petición con la cantidad final", async () => {
    const user = userEvent.setup();
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 1)]));
    await setup([makeLine("a", 1)], server);
    const resume = server.pause();
    await user.click(plus());
    await user.click(plus());
    await user.click(plus());
    expect(field().value).toBe("4");
    await act(async () => {
      resume();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const qtys = server.callsOf("set_item").map((c) => (c as { qty: number }).qty);
    expect(qtys.at(-1)).toBe(4);
    expect(field().value).toBe("4");
  });

  it("en el mínimo (1) «−» queda aria-disabled y no quita la línea", async () => {
    const user = userEvent.setup();
    const { server } = await setup([makeLine("a", 1)]);
    expect(minus()).toHaveAttribute("aria-disabled", "true");
    expect(minus()).toBeEnabled();
    await user.click(minus());
    expect(server.callsOf("set_item")).toHaveLength(0);
  });

  it("el tope es lo menor entre el máximo por producto y lo disponible: por stock", async () => {
    const user = userEvent.setup();
    const { server } = await setup([makeLine("a", 3, { available: 3 })]);
    expect(plus()).toHaveAttribute("aria-disabled", "true");
    expect(plus()).toBeEnabled(); // aria-disabled, no disabled: sigue enfocable
    expect(plus()).toHaveAccessibleDescription("No hay más unidades disponibles.");
    await user.click(plus());
    expect(server.callsOf("set_item")).toHaveLength(0);
    expect(field().value).toBe("3");
  });

  it("el tope por máximo por producto explica cuál es", async () => {
    const snapshot = makeSnapshot([makeLine("a", 5, { available: 9 })], {
      limits: { max_qty_per_variant: 5, max_lines: 30, max_units: 30 },
    });
    renderWithCart(<BagList />, { snapshot });
    await flush();
    expect(plus()).toHaveAttribute("aria-disabled", "true");
    expect(plus()).toHaveAccessibleDescription("Máximo 5 por producto.");
  });

  it("lejos del tope no hay explicación enlazada", async () => {
    await setup([makeLine("a", 2, { available: 9 })]);
    expect(plus()).not.toHaveAttribute("aria-disabled");
    expect(plus()).not.toHaveAttribute("aria-describedby");
  });

  it("llegar al tope con el teclado no suelta el foco", async () => {
    const user = userEvent.setup();
    await setup([makeLine("a", 2, { available: 3 })]);
    plus().focus();
    await user.keyboard("{Enter}");
    await flush();
    expect(field().value).toBe("3");
    expect(plus()).toHaveFocus();
    expect(plus()).toHaveAttribute("aria-disabled", "true");
  });

  it("si hay más en la bolsa de lo que queda, el campo muestra la cantidad REAL (no la recorta)", async () => {
    await setup([
      makeLine("a", 5, { status: "low_stock", blocking: true, available: 3, billable_qty: 3 }),
    ]);
    expect(field().value).toBe("5");
    expect(plus()).toHaveAttribute("aria-disabled", "true");
  });
});

describe("CartLineItem · quitar", () => {
  it("«Quitar» (con el nombre del producto para lectores) manda cantidad 0 y la línea desaparece al instante", async () => {
    const user = userEvent.setup();
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 2, { name: "Falda Roja" })]));
    const { cart } = await setup([makeLine("a", 2, { name: "Falda Roja" })], server);
    const resume = server.pause();
    await user.click(screen.getByRole("button", { name: "Quitar Falda Roja de la bolsa" }));
    expect(screen.queryByRole("link", { name: "Falda Roja" })).not.toBeInTheDocument();
    expect(cart().state.lastRemoved).toMatchObject({ variantId: "a", qty: 2, name: "Falda Roja" });
    await act(async () => {
      resume();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(server.callsOf("set_item").at(-1)).toMatchObject({ variant_id: "a", qty: 0 });
  });

  it("el foco pasa al ENLACE de la línea vecina al quitar (el botón pulsado desaparece)", async () => {
    const user = userEvent.setup();
    await setup([makeLine("a", 1, { name: "Falda" }), makeLine("b", 1, { name: "Blusa" })]);
    await user.click(screen.getByRole("button", { name: "Quitar Falda de la bolsa" }));
    // El foco va al ENLACE con el nombre de la vecina, nunca a su botón «Quitar»: un segundo Intro, la repetición de la
    // tecla o un doble toque habría quitado también esa línea.
    const focused = document.activeElement as HTMLElement;
    expect(focused.tagName).toBe("A");
    expect(focused).toHaveTextContent("Blusa");
    expect(screen.getByRole("button", { name: "Quitar Blusa de la bolsa" })).not.toHaveFocus();
  });

  it("al quitar la última, el foco va al título de la bolsa si lo hay", async () => {
    const user = userEvent.setup();
    const snapshot = makeSnapshot([makeLine("a", 1, { name: "Falda" })]);
    renderWithCart(
      <>
        <h1 tabIndex={-1} data-cart-heading="">
          Tu bolsa
        </h1>
        <BagList />
      </>,
      { snapshot },
    );
    await flush();
    await user.click(screen.getByRole("button", { name: "Quitar Falda de la bolsa" }));
    expect(screen.getByRole("heading", { name: "Tu bolsa" })).toHaveFocus();
  });

  it("«Deshacer» (store.undoRemove) devuelve la línea con su cantidad", async () => {
    const user = userEvent.setup();
    const { cart } = await setup([makeLine("a", 3, { name: "Falda" })]);
    await user.click(screen.getByRole("button", { name: "Quitar Falda de la bolsa" }));
    await flush();
    expect(screen.queryByText("Falda")).not.toBeInTheDocument();
    act(() => cart().store.undoRemove());
    await flush();
    expect(screen.getByRole("link", { name: "Falda" })).toBeInTheDocument();
    expect(field().value).toBe("3");
  });
});

describe("CartLineItem · variante compacta", () => {
  it("usa la foto más pequeña y la misma información", async () => {
    renderWithCart(<BagList variant="compact" />, { snapshot: makeSnapshot([makeLine("a", 1)]) });
    await flush();
    const photo = screen.getAllByRole("listitem")[0]!.querySelector("a")!;
    expect(photo).toHaveClass("w-16");
    expect(screen.getByRole("link", { name: "Chaqueta a" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Aumentar la cantidad de / })).toBeInTheDocument();
  });
});

describe("BagList · altas pendientes", () => {
  it("un producto recién agregado que el servidor aún no confirma se ve como fila «Agregando…»", async () => {
    const server = new FakeCartServer(null);
    const { cart } = renderWithCart(<BagList />, { server });
    await flush();
    const resume = server.pause();
    act(() => cart().store.setQty("nuevo", 1));
    expect(screen.getByText("Agregando a tu bolsa…")).toBeInTheDocument();
    // la fila no es `aria-busy` ni nace con su `role="status"`: lo que se oye lo dice la región viva de la página o el cajón
    const row = screen.getByText("Agregando a tu bolsa…").closest("li")!;
    expect(row).not.toHaveAttribute("aria-busy");
    expect(row.querySelector("[role], [aria-busy]")).toBeNull();
    await act(async () => {
      resume();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByText("Agregando a tu bolsa…")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Chaqueta nuevo" })).toBeInTheDocument();
  });
});
