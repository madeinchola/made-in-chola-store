import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BagList } from "./BagList";
import { OrphanNotices } from "./LineNotice";
import { NoticeRegion } from "./NoticeRegion";
import { FakeCartServer, flush, makeLine, makeSnapshot, renderWithCart } from "./cart-test-utils";
import type { CartLine } from "./types";

async function setup(lines: CartLine[], server?: FakeCartServer) {
  const snapshot = makeSnapshot(lines);
  const view = renderWithCart(
    <>
      {/* Como en la página y el cajón: los avisos sin línea entran en la región viva persistente. */}
      <NoticeRegion>
        <OrphanNotices />
      </NoticeRegion>
      <BagList />
    </>,
    { snapshot, ...(server ? { server } : {}) },
  );
  await flush();
  return view;
}

describe("LineNotice · estados de la línea", () => {
  it("Se agotó: alerta que bloquea, sin stepper (cantidad en texto) y con Quitar", async () => {
    const user = userEvent.setup();
    const { server } = await setup([
      makeLine("a", 2, {
        name: "Falda",
        status: "out_of_stock",
        blocking: true,
        available: 0,
        billable_qty: 0,
        line_total: 0,
      }),
    ]);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Se agotó");
    expect(screen.queryByRole("textbox", { name: /^Cantidad de / })).not.toBeInTheDocument();
    expect(screen.getByText("Cantidad: 2")).toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: /^Quitar .* de la bolsa$/ }));
    await flush();
    expect(server.callsOf("set_item").at(-1)).toMatchObject({ variant_id: "a", qty: 0 });
  });

  it("Ya no está disponible: alerta con Quitar", async () => {
    await setup([
      makeLine("a", 1, {
        status: "unavailable",
        blocking: true,
        available: 0,
        billable_qty: 0,
        line_total: 0,
      }),
    ]);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Ya no está disponible");
    expect(
      within(alert).getByRole("button", { name: /^Quitar .* de la bolsa$/ }),
    ).toBeInTheDocument();
  });

  it("Solo quedan N: «Ajustar a N» pide ESA cantidad al servidor y el foco vuelve al nombre", async () => {
    const user = userEvent.setup();
    const { server } = await setup([
      makeLine("a", 5, {
        name: "Falda",
        status: "low_stock",
        blocking: true,
        available: 3,
        billable_qty: 3,
        line_total: 300,
      }),
    ]);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Solo quedan 3");
    await user.click(within(alert).getByRole("button", { name: /^Ajustar a 3 unidades: / }));
    await flush();
    expect(server.callsOf("set_item").at(-1)).toMatchObject({ variant_id: "a", qty: 3 });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Falda" })).toHaveFocus();
  });

  it("las acciones se alcanzan y se activan con el teclado", async () => {
    const user = userEvent.setup();
    const { server } = await setup([
      makeLine("a", 5, { status: "low_stock", blocking: true, available: 3, billable_qty: 3 }),
    ]);
    const button = screen.getByRole("button", { name: /^Ajustar a 3 unidades: / });
    button.focus();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    await flush();
    expect(server.callsOf("set_item").at(-1)).toMatchObject({ qty: 3 });
  });
});

describe("LineNotice · avisos de precio", () => {
  const priced = (notice: CartLine["price_notice"], extra: Partial<CartLine> = {}) =>
    makeLine("a", 1, {
      name: "Falda",
      status: "price_changed",
      price_notice: notice,
      unit_price: 90,
      price_at_add: 100,
      current_price: 90,
      line_total: 90,
      ...extra,
    });

  it("dropped: informativo (status), no bloquea, sin botón", async () => {
    await setup([priced("dropped")]);
    const status = screen
      .getAllByRole("status")
      .find((el) => el.textContent?.includes("Bajó de precio"))!;
    expect(status).toHaveTextContent("Bajó de precio: pagas Bs 90,00");
    expect(within(status).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("guaranteed: informativo, no bloquea", async () => {
    await setup([priced("guaranteed", { unit_price: 100, current_price: 120 })]);
    // price_locked_until de `makeLine` = 2026-11-10T12:00Z = 10 de noviembre en La Paz
    expect(
      screen.getByText("Te respetamos el precio con el que lo agregaste hasta el 10 de noviembre"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("expired_raised: BLOQUEA (alerta) y «Aceptar nuevo precio» llama a accept_prices de ESA variante", async () => {
    const user = userEvent.setup();
    const { server } = await setup([
      priced("expired_raised", {
        unit_price: 120,
        current_price: 120,
        blocking: true,
        line_total: 120,
      }),
    ]);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("El precio cambió a Bs 120,00");
    await user.click(within(alert).getByRole("button", { name: /^Aceptar nuevo precio de / }));
    await flush();
    expect(server.callsOf("accept_prices")).toEqual([
      expect.objectContaining({ action: "accept_prices", variant_id: "a" }),
    ]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Falda" })).toHaveFocus();
  });

  it("expired_dropped: informativo y también ofrece aceptar", async () => {
    const user = userEvent.setup();
    const { server } = await setup([
      priced("expired_dropped", { current_price: 80, unit_price: 80 }),
    ]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Aceptar nuevo precio de / }));
    await flush();
    expect(server.callsOf("accept_prices")).toHaveLength(1);
  });
});

describe("LineNotice · avisos del último cambio", () => {
  it("el servidor ajusta la cantidad: «Solo había N unidades; ajustamos tu pedido», cerrable", async () => {
    const user = userEvent.setup();
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 2)]));
    server.onSetItem = () => {
      server.snapshot = makeSnapshot([makeLine("a", 3, { available: 3 })]);
      return {
        ok: true,
        data: {
          token_state: "ok",
          server_time: new Date().toISOString(),
          cart: server.snapshot,
          outcome: "adjusted",
          requested: 6,
          applied: 3,
        },
      };
    };
    await setup([makeLine("a", 2)], server);
    await user.click(screen.getByRole("button", { name: /^Aumentar la cantidad de / }));
    await flush();
    const status = screen
      .getAllByRole("status")
      .find((el) => el.textContent?.includes("ajustamos tu pedido"))!;
    expect(status).toHaveTextContent("Solo había 3 unidades; ajustamos tu pedido.");
    await user.click(within(status).getByRole("button", { name: "Cerrar aviso" }));
    expect(screen.queryByText(/ajustamos tu pedido/)).not.toBeInTheDocument();
  });

  it.each([
    [
      "capped_variant",
      15,
      10,
      "Puedes llevar hasta 10 unidades de este producto; ajustamos tu pedido.",
    ],
    [
      "capped_units",
      5,
      2,
      "Tu bolsa admite hasta 30 unidades en total; dejamos 2 de este producto.",
    ],
  ] as const)("%s → texto propio y se puede cerrar", async (outcome, requested, applied, text) => {
    const user = userEvent.setup();
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 2)]));
    server.onSetItem = () => {
      server.snapshot = makeSnapshot([makeLine("a", applied)]);
      return {
        ok: true,
        data: {
          token_state: "ok",
          server_time: new Date().toISOString(),
          cart: server.snapshot,
          outcome,
          requested,
          applied,
        },
      };
    };
    await setup([makeLine("a", 2)], server);
    await user.click(screen.getByRole("button", { name: /^Aumentar la cantidad de / }));
    await flush();
    expect(screen.getByText(text)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    expect(screen.queryByText(text)).not.toBeInTheDocument();
  });

  it("un alta que no cabe (tope de productos) no deja ninguna línea: el aviso va arriba, genérico y cerrable", async () => {
    const user = userEvent.setup();
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 1)]));
    server.onSetItem = () => ({
      ok: true,
      data: {
        token_state: "ok",
        server_time: new Date().toISOString(),
        cart: server.snapshot,
        outcome: "limit_lines",
        requested: 1,
        applied: 0,
      },
    });
    const { cart } = await setup([makeLine("a", 1)], server);
    act(() => cart().store.setQty("otra", 1));
    await flush();
    expect(
      screen.getByText(
        "No pudimos agregar ese producto: tu bolsa admite hasta 30 productos distintos.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    expect(screen.queryByText(/No pudimos agregar/)).not.toBeInTheDocument();
    expect(cart().state.results).toEqual({});
  });
});

/** La región viva propia de la línea (`NoticeRegion`): la única con `aria-atomic="false"` dentro del `<li>`. */
const lineRegion = (item: HTMLElement) =>
  item.querySelector<HTMLElement>('[role="status"][aria-live="polite"][aria-atomic="false"]');

function adjustingServer(lineName: string) {
  const server = new FakeCartServer(makeSnapshot([makeLine("a", 2, { name: lineName })]));
  server.onSetItem = () => {
    server.snapshot = makeSnapshot([makeLine("a", 3, { name: lineName, available: 3 })]);
    return {
      ok: true,
      data: {
        token_state: "ok",
        server_time: new Date().toISOString(),
        cart: server.snapshot,
        outcome: "adjusted",
        requested: 6,
        applied: 3,
      },
    };
  };
  return server;
}

describe("LineNotice · región viva persistente", () => {
  it("la región existe VACÍA antes del aviso y el aviso entra en ESE MISMO nodo (no nace con su role)", async () => {
    const user = userEvent.setup();
    await setup([makeLine("a", 2, { name: "Falda" })], adjustingServer("Falda"));
    const item = screen.getByRole("listitem");
    const before = lineRegion(item);
    expect(before).not.toBeNull();
    expect(before).toBeEmptyDOMElement();

    await user.click(screen.getByRole("button", { name: /^Aumentar la cantidad de / }));
    await flush();

    // el mismo nodo, ahora con el aviso dentro; el aviso no trae un `role` propio (lo anuncia la región)
    expect(lineRegion(item)).toBe(before);
    expect(before).toHaveTextContent("Solo había 3 unidades; ajustamos tu pedido.");
    expect(before!.querySelectorAll("[role]")).toHaveLength(0);
  });

  it("un aviso que BLOQUEA no entra en la región educada: es una alerta aparte", async () => {
    await setup([
      makeLine("a", 1, { name: "Falda", status: "out_of_stock", blocking: true, available: 0 }),
    ]);
    const item = screen.getByRole("listitem");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Se agotó");
    const region = lineRegion(item)!;
    expect(region).toBeEmptyDOMElement();
    expect(region.contains(alert)).toBe(false);
  });

  it("sin avisos la región no ocupa sitio (la línea se ve igual que antes)", async () => {
    await setup([makeLine("a", 1)]);
    const region = lineRegion(screen.getByRole("listitem"))!;
    // `empty:!mt-0` anula el margen que `space-y-3` le daría al hueco
    expect(region).toHaveClass("empty:!mt-0");
    expect(region).toBeEmptyDOMElement();
  });
});

describe("LineNotice · el foco no cae al <body> al cerrar un aviso", () => {
  it("cerrar el aviso de una línea deja el foco en el nombre de SU producto", async () => {
    const user = userEvent.setup();
    await setup([makeLine("a", 2, { name: "Falda" })], adjustingServer("Falda"));
    await user.click(screen.getByRole("button", { name: /^Aumentar la cantidad de / }));
    await flush();
    const close = screen.getByRole("button", { name: "Cerrar aviso" });
    await user.click(close);
    expect(screen.queryByText(/ajustamos tu pedido/)).not.toBeInTheDocument();
    expect(close).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole("link", { name: "Falda" })).toHaveFocus();
  });

  it("cerrar un aviso SIN línea (no se pudo agregar) lleva el foco al título de la bolsa", async () => {
    const user = userEvent.setup();
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 1)]));
    server.onSetItem = () => ({
      ok: true,
      data: {
        token_state: "ok",
        server_time: new Date().toISOString(),
        cart: server.snapshot,
        outcome: "out_of_stock",
        requested: 1,
        applied: 0,
      },
    });
    const view = renderWithCart(
      <>
        <h1 tabIndex={-1} data-cart-heading="">
          Tu bolsa
        </h1>
        <NoticeRegion>
          <OrphanNotices />
        </NoticeRegion>
        <BagList />
      </>,
      { snapshot: makeSnapshot([makeLine("a", 1)]), server },
    );
    await flush();
    act(() => view.cart().store.setQty("otra", 1));
    await flush();
    await user.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    expect(screen.queryByText(/No pudimos agregar/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tu bolsa" })).toHaveFocus();
  });

  it("no ROBA el foco: si estaba en otra parte cuando el aviso se va, ahí se queda", async () => {
    const user = userEvent.setup();
    const view = await setup([makeLine("a", 2, { name: "Falda" })], adjustingServer("Falda"));
    await user.click(screen.getByRole("button", { name: /^Aumentar la cantidad de / }));
    await flush();
    // un elemento ajeno a la bolsa, que ningún componente del carrito gestiona. (react-dom ya devuelve el foco al elemento que
    // lo tenía antes de un commit si sigue en el documento; este test fija el contrato por si el rescate dejara de apoyarse en eso.)
    const other = document.createElement("button");
    document.body.append(other);
    try {
      other.focus();
      expect(other).toHaveFocus();
      act(() => view.cart().store.dismissResult("a")); // se cierra por otra vía, sin tocar el botón del aviso
      expect(screen.queryByText(/ajustamos tu pedido/)).not.toBeInTheDocument();
      expect(other).toHaveFocus();
    } finally {
      other.remove();
    }
  });
});
