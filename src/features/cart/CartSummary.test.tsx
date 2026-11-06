import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BagList } from "./BagList";
import { CartSummary } from "./CartSummary";
import {
  FakeCartServer,
  failure,
  flush,
  makeLine,
  makeSnapshot,
  renderWithCart,
  signedIn,
} from "./cart-test-utils";
import type { CartSnapshot } from "./types";

// Habilitado es un enlace; bloqueado es un BOTÓN sin href (un enlace `aria-disabled` se abre igual con el botón medio o con
// «abrir en una pestaña nueva»).
const pay = () =>
  screen.queryByRole("link", { name: "Pagar" }) ?? screen.getByRole("button", { name: "Pagar" });
const location = () => screen.getByTestId("location");

async function setup(snapshot: CartSnapshot, options: Parameters<typeof renderWithCart>[1] = {}) {
  const view = renderWithCart(
    <>
      <BagList />
      <CartSummary />
    </>,
    { snapshot, ...options },
  );
  await flush();
  return view;
}

describe("CartSummary · importes del servidor", () => {
  it("subtotal, envío («se calcula al elegir tu dirección») y total; sin fila de descuento mientras sea null", async () => {
    await setup(
      makeSnapshot([makeLine("a", 2, { unit_price: 560, line_total: 1120 }), makeLine("b", 1)]),
    );
    const summary = screen.getByRole("region", { name: "Resumen" });
    expect(within(summary).getByText("Subtotal (3 productos)")).toBeInTheDocument();
    const rows = Array.from(summary.querySelectorAll("dl > div")).map((r) => r.textContent);
    expect(rows).toEqual([
      "Subtotal (3 productos)Bs 1.220,00",
      "EnvíoSe calcula al elegir tu dirección",
      "TotalBs 1.220,00",
    ]);
    expect(within(summary).queryByText("Descuento")).not.toBeInTheDocument();
  });

  it("«Subtotal (n productos)» cuenta lo que se COBRA, no las unidades agotadas (que suman 0 al importe)", async () => {
    // a: 2 sanas · b: 3 agotadas (cobra 0) · c: pidió 4 y solo hay 2 (cobra 2) → se cobran 2 + 0 + 2 = 4 unidades
    await setup(
      makeSnapshot([
        makeLine("a", 2),
        makeLine("b", 3, {
          status: "out_of_stock",
          blocking: true,
          available: 0,
          billable_qty: 0,
          line_total: 0,
        }),
        makeLine("c", 4, {
          status: "low_stock",
          blocking: true,
          available: 2,
          billable_qty: 2,
          line_total: 200,
        }),
      ]),
    );
    const summary = screen.getByRole("region", { name: "Resumen" });
    // el servidor cuenta 9 unidades en la bolsa (2 + 3 + 4) y el importe son 4 × Bs 100
    expect(within(summary).getByText("Subtotal (4 productos)")).toBeInTheDocument();
    expect(within(summary).getByText("Subtotal (4 productos)").nextSibling).toHaveTextContent(
      "Bs 400,00",
    );
  });

  it("si lo único que se cobra es una unidad lo dice en singular, aunque haya más cosas en la bolsa", async () => {
    await setup(
      makeSnapshot([
        makeLine("a", 1),
        makeLine("b", 5, {
          status: "unavailable",
          blocking: true,
          available: 0,
          billable_qty: 0,
          line_total: 0,
        }),
      ]),
    );
    expect(screen.getByText("Subtotal (1 producto)")).toBeInTheDocument();
  });

  it("un solo producto lo dice en singular", async () => {
    await setup(makeSnapshot([makeLine("a", 1)]));
    expect(screen.getByText("Subtotal (1 producto)")).toBeInTheDocument();
  });

  it("envío y descuento, cuando el servidor los llene (S8/S9), se muestran tal cual; el total NO se recalcula", async () => {
    const base = makeSnapshot([makeLine("a", 1)]);
    await setup({
      ...base,
      totals: { ...base.totals, shipping: 20, discount: 15, total: 999.99 },
    });
    const summary = screen.getByRole("region", { name: "Resumen" });
    const rows = Array.from(summary.querySelectorAll("dl > div")).map((r) => r.textContent);
    expect(rows).toEqual([
      "Subtotal (1 producto)Bs 100,00",
      "EnvíoBs 20,00",
      "Descuento-Bs 15,00",
      "TotalBs 999,99",
    ]);
  });

  it("mientras hay un cambio sin confirmar, el resumen se atenúa y lo dice con una región viva que YA existía (sin aria-busy)", async () => {
    const user = userEvent.setup();
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 1)]));
    await setup(makeSnapshot([makeLine("a", 1)]), { server });
    const summary = screen.getByRole("region", { name: "Resumen" });
    // la región viva de la CABECERA del resumen (el estimador de envío trae las suyas, más abajo)
    const headerStatus = () =>
      within(within(summary).getByRole("heading", { level: 2 }).parentElement!).getByRole("status");
    const status = headerStatus();
    expect(summary).not.toHaveAttribute("aria-busy");
    expect(status).toBeEmptyDOMElement(); // existe vacía, esperando
    const resume = server.pause();
    await user.click(screen.getByRole("button", { name: /^Aumentar la cantidad de / }));
    // `aria-busy` haría que algunos lectores de pantalla no anuncien lo que hay dentro (la propia región viva)
    expect(summary).not.toHaveAttribute("aria-busy");
    expect(headerStatus()).toBe(status); // el MISMO nodo: el texto entra en una región existente
    expect(status).toHaveTextContent("Actualizando…");
    expect(summary.querySelector("dl")).toHaveClass("opacity-60");
    await act(async () => {
      resume();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(summary).not.toHaveAttribute("aria-busy");
    expect(status).toBeEmptyDOMElement();
    expect(within(summary).getByText("Total").nextSibling).toHaveTextContent("Bs 200,00");
  });

  it("enlace «Seguir comprando» a la tienda", async () => {
    await setup(makeSnapshot([makeLine("a", 1)]));
    expect(screen.getByRole("link", { name: "Seguir comprando" })).toHaveAttribute(
      "href",
      "/tienda",
    );
  });
});

describe("botón Pagar · con y sin sesión", () => {
  it("con sesión y todo en orden: enlace habilitado a /checkout, sin explicación", async () => {
    const user = userEvent.setup();
    await setup(makeSnapshot([makeLine("a", 1)]), { auth: signedIn() });
    expect(pay()).toHaveAttribute("href", "/checkout");
    expect(pay()).not.toHaveAttribute("aria-disabled");
    expect(pay()).not.toHaveAttribute("aria-describedby");
    await user.click(pay());
    expect(location()).toHaveTextContent("/checkout");
  });

  it("sin sesión: lleva a iniciar sesión recordando que se vuelve a /carrito (la cuenta se pide al pagar)", async () => {
    const user = userEvent.setup();
    await setup(makeSnapshot([makeLine("a", 1)]));
    expect(pay()).toHaveAttribute("href", "/login");
    expect(pay()).not.toHaveAttribute("aria-disabled");
    await user.click(pay());
    expect(location()).toHaveTextContent("/login");
    expect(JSON.parse(location().getAttribute("data-state")!)).toEqual({ from: "/carrito" });
  });
});

describe("botón Pagar · bloqueado y por qué", () => {
  /** Comprueba el contrato de accesibilidad del botón bloqueado y devuelve su razón. */
  async function expectBlocked(reason: string) {
    const user = userEvent.setup();
    expect(pay()).toHaveAttribute("aria-disabled", "true");
    expect(pay().tagName).toBe("BUTTON");
    expect(pay()).not.toHaveAttribute("href"); // nada que abrir en otra pestaña ni con el botón medio
    expect(pay()).toHaveAccessibleDescription(reason);
    // sigue en el orden de tabulación…
    pay().focus();
    expect(pay()).toHaveFocus();
    // …y no navega ni con clic ni con Intro
    await user.click(pay());
    await user.keyboard("{Enter}");
    expect(location()).toHaveTextContent("/carrito");
  }

  it("bolsa vacía", async () => {
    await setup(makeSnapshot([]), { auth: signedIn() });
    await expectBlocked("Tu bolsa está vacía: agrega un producto para pagar.");
  });

  it("hay cambios por confirmar (mientras el servidor responde) y se habilita al confirmarse", async () => {
    const user = userEvent.setup();
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 1)]));
    await setup(makeSnapshot([makeLine("a", 1)]), { server, auth: signedIn() });
    expect(pay()).not.toHaveAttribute("aria-disabled");
    const resume = server.pause();
    await user.click(screen.getByRole("button", { name: /^Aumentar la cantidad de / }));
    await expectBlocked("Estamos confirmando tus cambios. Espera un momento para pagar.");
    await act(async () => {
      resume();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(pay()).not.toHaveAttribute("aria-disabled");
    expect(pay()).not.toHaveAttribute("aria-describedby");
  });

  it("líneas con problemas (agotado)", async () => {
    await setup(
      makeSnapshot([makeLine("a", 1, { status: "out_of_stock", blocking: true, available: 0 })]),
      { auth: signedIn() },
    );
    await expectBlocked("Algunos productos tienen problemas: resuélvelos para pagar.");
  });

  it("precio subido sin aceptar", async () => {
    await setup(
      makeSnapshot([
        makeLine("a", 1, {
          status: "price_changed",
          price_notice: "expired_raised",
          blocking: true,
          unit_price: 120,
          current_price: 120,
        }),
      ]),
      { auth: signedIn() },
    );
    await expectBlocked("Hay cambios de precio por confirmar: acepta el nuevo precio para pagar.");
  });

  it("sin conexión", async () => {
    const user = userEvent.setup();
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 1)]));
    await setup(makeSnapshot([makeLine("a", 1)]), { server, auth: signedIn() });
    server.forced = failure(0, "network");
    await user.click(screen.getByRole("button", { name: /^Aumentar la cantidad de / }));
    await flush();
    await expectBlocked("Sin conexión: espera a que vuelva para pagar.");
  });

  it("también bloqueado el servidor dice que no se puede pagar (can_checkout falso)", async () => {
    await setup(makeSnapshot([makeLine("a", 1)], { can_checkout: false }), { auth: signedIn() });
    await expectBlocked("Todavía no puedes pagar. Revisa los avisos de tu bolsa.");
  });

  it("sin sesión también explica el bloqueo (y no manda a iniciar sesión)", async () => {
    await setup(makeSnapshot([]));
    await expectBlocked("Tu bolsa está vacía: agrega un producto para pagar.");
  });
});
