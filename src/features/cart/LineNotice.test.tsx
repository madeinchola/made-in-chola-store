import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BagList } from "./BagList";
import { OrphanNotices } from "./LineNotice";
import { FakeCartServer, flush, makeLine, makeSnapshot, renderWithCart } from "./cart-test-utils";
import type { CartLine } from "./types";

async function setup(lines: CartLine[], server?: FakeCartServer) {
  const snapshot = makeSnapshot(lines);
  const view = renderWithCart(
    <>
      <OrphanNotices />
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
    expect(screen.getByText("Te respetamos el precio con el que lo agregaste")).toBeInTheDocument();
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
