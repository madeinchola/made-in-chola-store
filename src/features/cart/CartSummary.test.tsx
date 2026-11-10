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
import type { AppliedDiscount, CartDiscounts, CartSnapshot } from "./types";

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

// ── Descuentos y cupón (S9) ────────────────────────────────────────────────────────────────

const applied = (
  id: string,
  name: string,
  amount: number,
  extra: Partial<AppliedDiscount> = {},
): AppliedDiscount => ({
  discount_id: id,
  coupon_id: null,
  name,
  kind: "percent",
  amount,
  automatic: true,
  free_shipping: false,
  ...extra,
});

const discountsOf = (
  list: AppliedDiscount[],
  extra: Partial<CartDiscounts> = {},
): CartDiscounts => ({
  applied: list,
  rejected: [],
  coupon: { status: "none", code: null, reason: null, missing: null },
  free_shipping: false,
  ...extra,
});

/** Dos unidades de Bs 100 (subtotal 200) con los totales que mandaría el servidor. */
function discountedSnapshot(discount: number | null, total: number, discounts: CartDiscounts) {
  return makeSnapshot([makeLine("a", 2, { unit_price: 100, line_total: 200 })], {
    totals: { subtotal: 200, item_count: 2, line_count: 1, shipping: null, discount, total },
    discounts,
  });
}

const summaryRows = () =>
  Array.from(screen.getByRole("region", { name: "Resumen" }).querySelectorAll("dl > div")).map(
    (r) => r.textContent,
  );

describe("CartSummary · descuentos (S9)", () => {
  it("la fila «Descuento» trae debajo el desglose de lo aplicado (oferta automática y cupón) y el total es el del servidor", async () => {
    await setup(
      discountedSnapshot(
        30,
        170,
        discountsOf([
          applied("d1", "Oferta de temporada", 20),
          applied("d2", "Cupón VERANO10", 10, { coupon_id: "c1", automatic: false }),
        ]),
      ),
    );
    expect(summaryRows()).toEqual([
      "Subtotal (2 productos)Bs 200,00",
      "EnvíoSe calcula al elegir tu dirección",
      "Descuento-Bs 30,00Oferta de temporada: −Bs 20,00Cupón VERANO10: −Bs 10,00",
      "TotalBs 170,00",
    ]);
  });

  it("el envío gratis NO entra en el desglose (no baja el subtotal): ni su nombre ni un importe", async () => {
    await setup(
      discountedSnapshot(
        20,
        180,
        discountsOf(
          [
            applied("d1", "Oferta de temporada", 20),
            applied("d3", "Envío gratis desde Bs 150", 0, { free_shipping: true }),
          ],
          { free_shipping: true },
        ),
      ),
    );
    expect(summaryRows()).toEqual([
      "Subtotal (2 productos)Bs 200,00",
      "EnvíoSe calcula al elegir tu direcciónTienes envío gratis",
      "Descuento-Bs 20,00Oferta de temporada: −Bs 20,00",
      "TotalBs 180,00",
    ]);
    expect(screen.queryByText(/Envío gratis desde/)).not.toBeInTheDocument();
  });

  it("solo envío gratis (nada baja el subtotal): sin fila de descuento, con la nota bajo «Envío», y UN solo total", async () => {
    await setup(
      discountedSnapshot(
        null,
        200,
        discountsOf([applied("d3", "Envío gratis", 0, { free_shipping: true })], {
          free_shipping: true,
        }),
      ),
    );
    expect(summaryRows()).toEqual([
      "Subtotal (2 productos)Bs 200,00",
      "EnvíoSe calcula al elegir tu direcciónTienes envío gratis",
      "TotalBs 200,00",
    ]);
    expect(screen.queryByText("Descuento")).not.toBeInTheDocument();
  });

  it("sin envío gratis no hay nota", async () => {
    await setup(discountedSnapshot(20, 180, discountsOf([applied("d1", "Oferta", 20)])));
    expect(screen.queryByText("Tienes envío gratis")).not.toBeInTheDocument();
  });

  it("el desglose no desborda a 360 px: el nombre se parte (break-words) y la fila puede envolver", async () => {
    const longName = "Oferta de temporada de verano en prendas seleccionadas de la colección";
    await setup(discountedSnapshot(20, 180, discountsOf([applied("d1", longName, 20)])));
    const entry = screen.getByText(`${longName}: −Bs 20,00`);
    expect(entry).toHaveClass("break-words");
    expect(entry.closest("dd")).toHaveClass("basis-full");
    expect(entry.closest("div")).toHaveClass("flex-wrap");
  });

  it("una foto vieja (con `totals.discount` pero sin `discounts`) no muestra desglose ni nota y no rompe nada", async () => {
    const base = makeSnapshot([makeLine("a", 1)]);
    await setup({ ...base, totals: { ...base.totals, discount: 15, total: 85 } });
    expect(summaryRows()).toEqual([
      "Subtotal (1 producto)Bs 100,00",
      "EnvíoSe calcula al elegir tu dirección",
      "Descuento-Bs 15,00",
      "TotalBs 85,00",
    ]);
  });

  it("el resumen incluye el bloque «¿Tienes un cupón?»", async () => {
    await setup(makeSnapshot([makeLine("a", 1)]));
    const summary = screen.getByRole("region", { name: "Resumen" });
    expect(within(summary).getByRole("group", { name: "¿Tienes un cupón?" })).toBeInTheDocument();
    expect(within(summary).getByRole("textbox", { name: "Código de cupón" })).toBeInTheDocument();
  });

  it("de punta a punta: aplicar un cupón baja el total y muestra el desglose y la línea con el importe tachado; quitarlo lo deshace", async () => {
    const user = userEvent.setup();
    const server = new FakeCartServer(makeSnapshot([makeLine("a", 2)]));
    server.coupons = { VERANO10: { percent: 10 } };
    await setup(makeSnapshot([makeLine("a", 2)]), { server });
    expect(summaryRows()).toEqual([
      "Subtotal (2 productos)Bs 200,00",
      "EnvíoSe calcula al elegir tu dirección",
      "TotalBs 200,00",
    ]);
    await user.type(screen.getByRole("textbox", { name: "Código de cupón" }), "verano10{Enter}");
    await flush();
    // 10 % de Bs 200 = Bs 20 → se paga Bs 180
    expect(summaryRows()).toEqual([
      "Subtotal (2 productos)Bs 200,00",
      "EnvíoSe calcula al elegir tu dirección",
      "Descuento-Bs 20,00Cupón VERANO10: −Bs 20,00",
      "TotalBs 180,00",
    ]);
    expect(screen.getByText(/Total de la línea:/)).toHaveTextContent(
      "Total de la línea: Bs 180,00, antes Bs 200,00",
    );
    await user.click(screen.getByRole("button", { name: "Quitar el cupón VERANO10" }));
    await flush();
    expect(summaryRows()).toEqual([
      "Subtotal (2 productos)Bs 200,00",
      "EnvíoSe calcula al elegir tu dirección",
      "TotalBs 200,00",
    ]);
    expect(screen.getByText(/Total de la línea:/).parentElement).toHaveTextContent("Bs 200,00");
    expect(document.querySelector("s")).toBeNull();
  });
});
