import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CouponForm } from "./CouponForm";
import {
  FakeCartServer,
  failure,
  flush,
  makeLine,
  makeSnapshot,
  okResponse,
  renderWithCart,
} from "./cart-test-utils";
import { COUPON_REASONS, type CartDiscounts, type CartSnapshot, type CouponReason } from "./types";

// Los textos están escritos A MANO (los del encargo), no leídos del diccionario.
const TEXT: Record<string, string> = {
  invalid_code: "Ese código no es válido. Revísalo e inténtalo de nuevo.",
  expired: "Ese cupón ya venció.",
  wrong_currency: "Ese cupón no vale para la moneda de tu bolsa.",
  login_required: "Inicia sesión para usar este cupón.",
  sold_out: "Ese cupón ya se agotó.",
  already_used: "Ya usaste este cupón.",
  not_first_purchase: "Este cupón es solo para tu primera compra.",
  not_eligible_customer: "Este cupón no está disponible para tu cuenta.",
  not_applicable: "Este cupón no aplica a los productos de tu bolsa.",
  min_not_reached: "Te faltan Bs 50,00 para usar este cupón.",
  not_combinable: "Ya tienes una oferta mejor aplicada: este cupón no se suma.",
  coupon_already_applied: "Ya hay un cupón en tu bolsa. Quítalo para usar otro.",
  unavailable: "No pudimos aplicar el cupón. Inténtalo de nuevo.",
  rate_limited:
    "Hubo demasiados intentos desde tu conexión. Espera unos minutos y vuelve a intentarlo.",
};

/** Una bolsa de una sola unidad de Bs 100 (subtotal 100). */
const bag = () => makeSnapshot([makeLine("a", 1)]);

/** Los cupones que conoce el servidor falso: 10 % sin mínimo, 10 % con mínimo de Bs 500 y 5 % sin mínimo. */
const COUPONS = {
  VERANO10: { percent: 10 },
  GRANDE: { percent: 10, min: 500 },
  OTRO: { percent: 5 },
};

async function setup(snapshot: CartSnapshot = bag(), server?: FakeCartServer) {
  const fake = server ?? new FakeCartServer(snapshot);
  fake.coupons = COUPONS;
  const view = renderWithCart(<CouponForm />, { snapshot, server: fake });
  await flush();
  return { ...view, server: fake };
}

const field = () => screen.getByRole("textbox", { name: "Código de cupón" }) as HTMLInputElement;
const apply = () => screen.getByRole("button", { name: "Aplicar" });
/** La única región viva de «Cupón aplicado…» / «Cupón quitado» (el formulario solo trae esta). */
const live = () => screen.getByRole("status");

/** Un cupón guardado en la bolsa que HOY no baja nada (motivo en la foto del servidor). */
function savedSnapshot(reason: CouponReason, missing: number | null = null, code = "VERANO10") {
  return makeSnapshot([makeLine("a", 1)], {
    discounts: {
      applied: [],
      rejected: [{ code, reason, missing }],
      coupon: { status: "rejected", code, reason, missing },
      free_shipping: false,
    },
  });
}

/** Un cupón aplicado: 2 unidades de Bs 100, 10 % → baja Bs 20 y se paga Bs 180 (números del «servidor»). */
function appliedSnapshot(overrides: Partial<CartDiscounts> = {}) {
  const offer = {
    discount_id: "d1",
    name: "Cupón VERANO10",
    kind: "percent",
    amount: 20,
    coupon: true,
  };
  const line = makeLine("a", 2, { discount: 20, final_total: 180, discount_offers: [offer] });
  return makeSnapshot([line], {
    totals: {
      subtotal: 200,
      item_count: 2,
      line_count: 1,
      shipping: null,
      discount: 20,
      total: 180,
    },
    discounts: {
      applied: [
        {
          discount_id: "d1",
          coupon_id: "c1",
          name: "Cupón VERANO10",
          kind: "percent",
          amount: 20,
          automatic: false,
          free_shipping: false,
        },
      ],
      rejected: [],
      coupon: {
        status: "applied",
        code: "VERANO10",
        reason: null,
        missing: null,
        discount_id: "d1",
        coupon_id: "c1",
        name: "Cupón VERANO10",
        kind: "percent",
      },
      free_shipping: false,
      ...overrides,
    },
  });
}

describe("CouponForm · sin cupón: el formulario", () => {
  it("«¿Tienes un cupón?», campo «Código de cupón» y botón «Aplicar» (deshabilitado mientras esté vacío)", async () => {
    const user = userEvent.setup();
    await setup();
    expect(screen.getByRole("group", { name: "¿Tienes un cupón?" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "¿Tienes un cupón?" }),
    ).toBeInTheDocument();
    expect(field()).toHaveValue("");
    expect(apply()).toBeDisabled();
    await user.type(field(), "   ");
    expect(apply()).toBeDisabled(); // solo espacios = vacío
    await user.clear(field());
    await user.type(field(), "verano10");
    expect(apply()).toBeEnabled();
  });

  it("atributos del campo: 40 caracteres, sin autocompletar, sin corrector, sin revisión ortográfica", async () => {
    await setup();
    expect(field()).toHaveAttribute("maxlength", "40");
    expect(field()).toHaveAttribute("autocomplete", "off");
    expect(field()).toHaveAttribute("autocorrect", "off");
    expect(field()).toHaveAttribute("spellcheck", "false");
    expect(field()).toHaveAttribute("type", "text");
  });

  it("no deja escribir más de 40 caracteres", async () => {
    const user = userEvent.setup();
    await setup();
    await user.type(field(), "A".repeat(45));
    expect(field().value).toBe("A".repeat(40));
  });

  it("la etiqueta está enlazada al campo (clic en la etiqueta enfoca el campo)", async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(screen.getByText("Código de cupón"));
    expect(field()).toHaveFocus();
  });

  it("objetivos táctiles de 44 px (campo y botón) y sin desbordes a 360 px (el campo se encoge, el botón no)", async () => {
    await setup();
    expect(field()).toHaveClass("min-h-11", "h-11", "min-w-0", "flex-1");
    expect(apply()).toHaveClass("min-h-11", "shrink-0");
    expect(field().parentElement).toHaveClass("flex", "gap-2"); // fila: campo flexible + botón fijo
  });

  it("NO llama al servidor con el campo vacío ni con solo espacios (Intro incluido)", async () => {
    const user = userEvent.setup();
    const { server } = await setup();
    await user.click(field());
    await user.keyboard("{Enter}");
    await user.type(field(), "   {Enter}");
    await flush();
    expect(server.callsOf("set_coupon")).toEqual([]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("un envío directo del formulario vacío (sin pasar por el botón) tampoco llama al servidor ni muestra un error", async () => {
    const { server } = await setup();
    const form = field().closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(server.callsOf("set_coupon")).toEqual([]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("dos envíos en el mismo instante (antes de repintar) mandan UNA sola petición", async () => {
    const user = userEvent.setup();
    const { server } = await setup();
    await user.type(field(), "verano10");
    const form = field().closest("form")!;
    const resume = server.pause();
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(server.callsOf("set_coupon")).toHaveLength(1);
    await act(async () => {
      resume();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(server.callsOf("set_coupon")).toHaveLength(1);
  });

  it("una foto vieja (sin `discounts`, anterior a S9) muestra el formulario sin romper nada", async () => {
    const snapshot = bag();
    expect(snapshot.discounts).toBeUndefined();
    await setup(snapshot);
    expect(field()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Quitar/ })).not.toBeInTheDocument();
  });
});

describe("CouponForm · aplicar un cupón", () => {
  it("manda el código tal como se escribió (el servidor lo normaliza), y muestra nombre, código, lo que ahorra y «Quitar»", async () => {
    const user = userEvent.setup();
    const { server } = await setup();
    await user.type(field(), "verano10");
    await user.click(apply());
    await flush();
    expect(server.callsOf("set_coupon")).toEqual([
      { action: "set_coupon", code: "verano10", cart_token: expect.any(String) },
    ]);
    // 1 unidad de Bs 100 con 10 % → baja Bs 10,00
    const card = screen.getByText("Cupón VERANO10");
    expect(card).toBeInTheDocument();
    expect(screen.getByText("Código: VERANO10")).toBeInTheDocument();
    expect(screen.getByText("Ahorras Bs 10,00")).toBeInTheDocument();
    const remove = screen.getByRole("button", { name: "Quitar el cupón VERANO10" });
    expect(remove).toHaveTextContent("Quitar");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Tu cupón" })).toBeInTheDocument();
  });

  it("Intro en el campo también envía", async () => {
    const user = userEvent.setup();
    const { server } = await setup();
    await user.type(field(), "VERANO10{Enter}");
    await flush();
    expect(server.callsOf("set_coupon")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Quitar el cupón VERANO10" })).toBeInTheDocument();
  });

  it("anuncia «Cupón aplicado: …» en una región viva que YA existía (vacía) y mueve el foco a la tarjeta del cupón", async () => {
    const user = userEvent.setup();
    await setup();
    const status = live();
    expect(status).toBeEmptyDOMElement();
    expect(status).toHaveAttribute("aria-live", "polite");
    await user.type(field(), "verano10");
    await user.click(apply());
    await flush();
    expect(live()).toBe(status); // el MISMO nodo: el texto entra en una región existente
    expect(status).toHaveTextContent("Cupón aplicado: Cupón VERANO10");
    // el campo y el botón con foco desaparecieron: el foco no cae al <body>
    expect(screen.getByText("Cupón VERANO10")).toHaveFocus();
  });

  it("mientras el servidor responde: «Aplicar» queda ocupado (aria-busy), el campo de solo lectura y un segundo envío no manda otra petición", async () => {
    const user = userEvent.setup();
    const { server } = await setup();
    const resume = server.pause();
    await user.type(field(), "verano10");
    await user.click(apply());
    expect(apply()).toHaveAttribute("aria-busy", "true");
    expect(apply()).toHaveAttribute("aria-disabled", "true");
    expect(field()).toHaveAttribute("readonly");
    await user.click(apply());
    await user.click(field());
    await user.keyboard("{Enter}");
    expect(server.callsOf("set_coupon")).toHaveLength(1);
    await act(async () => {
      resume();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByRole("button", { name: "Quitar el cupón VERANO10" })).toBeInTheDocument();
    expect(server.callsOf("set_coupon")).toHaveLength(1);
  });

  it("un cupón con mínimo que aún no se alcanza se GUARDA: no es un error, dice cuánto falta y se anuncia como guardado (no como aplicado)", async () => {
    const user = userEvent.setup();
    await setup();
    await user.type(field(), "grande");
    await user.click(apply());
    await flush();
    // subtotal Bs 100, mínimo Bs 500 → faltan Bs 400
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Código: GRANDE")).toBeInTheDocument();
    expect(screen.getByText("Te faltan Bs 400,00 para usar este cupón.")).toBeInTheDocument();
    expect(screen.queryByText(/Ahorras/)).not.toBeInTheDocument();
    expect(live()).toHaveTextContent(
      "Cupón guardado: GRANDE. Te faltan Bs 400,00 para usar este cupón.",
    );
    expect(live()).not.toHaveTextContent("Cupón aplicado");
    expect(screen.getByRole("button", { name: "Quitar el cupón GRANDE" })).toBeInTheDocument();
    expect(screen.getByText("Código: GRANDE")).toHaveFocus();
  });
});

describe("CouponForm · rechazo sin guardar", () => {
  it("«código inexistente»: mensaje junto al campo (role=alert), el texto se CONSERVA, el campo queda inválido y con foco (aunque se pulsó el botón)", async () => {
    const user = userEvent.setup();
    const { server } = await setup();
    await user.type(field(), "NOEXISTE");
    await user.click(apply()); // el foco estaba en el botón
    await flush();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Ese código no es válido. Revísalo e inténtalo de nuevo.");
    expect(field()).toHaveValue("NOEXISTE");
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAccessibleDescription(
      "Ese código no es válido. Revísalo e inténtalo de nuevo.",
    );
    expect(field()).toHaveFocus();
    expect(server.callsOf("set_coupon")).toHaveLength(1);
    expect(live()).toBeEmptyDOMElement(); // un rechazo no se anuncia como éxito
  });

  it.each(COUPON_REASONS)(
    "el motivo «%s» muestra su texto exacto junto al campo",
    async (reason) => {
      const user = userEvent.setup();
      const { server } = await setup();
      server.onSetCoupon = () =>
        okResponse(bag(), {
          outcome: "coupon_rejected",
          reason,
          missing: reason === "min_not_reached" ? 50 : null,
        });
      await user.type(field(), "CODIGO");
      await user.click(apply());
      await flush();
      expect(screen.getByRole("alert")).toHaveTextContent(TEXT[reason]!);
      expect(field()).toHaveValue("CODIGO");
      expect(field()).toHaveFocus();
    },
  );

  it("un motivo que el cliente no conoce se dice como código inválido (nunca un texto vacío ni una clave a la vista)", async () => {
    const user = userEvent.setup();
    const { server } = await setup();
    server.onSetCoupon = () =>
      okResponse(bag(), { outcome: "coupon_rejected", reason: "motivo_nuevo" });
    await user.type(field(), "X");
    await user.click(apply());
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(TEXT.invalid_code!);
  });

  it("sin conexión: «No pudimos aplicar el cupón…», el texto se conserva y NO queda nada guardado", async () => {
    const user = userEvent.setup();
    const { server } = await setup();
    server.forced = failure(0, "network");
    await user.type(field(), "verano10");
    await user.click(apply());
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(TEXT.unavailable!);
    expect(field()).toHaveValue("verano10");
    expect(field()).toHaveFocus();
    expect(screen.queryByRole("button", { name: /^Quitar/ })).not.toBeInTheDocument();
  });

  it("demasiados intentos (429): «Hubo demasiados intentos…»", async () => {
    const user = userEvent.setup();
    const { server } = await setup();
    server.forced = failure(429, "rate_limited", 1);
    await user.type(field(), "verano10");
    await user.click(apply());
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(TEXT.rate_limited!);
    expect(field()).toHaveValue("verano10");
  });

  it("al corregir el texto el rechazo se retira; al enviar de nuevo se pide otra vez y se aplica", async () => {
    const user = userEvent.setup();
    const { server } = await setup();
    await user.type(field(), "NOEXISTE");
    await user.click(apply());
    await flush();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await user.type(field(), "X");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(field()).not.toHaveAttribute("aria-invalid");
    expect(field()).not.toHaveAttribute("aria-describedby");
    await user.clear(field());
    await user.type(field(), "otro{Enter}");
    await flush();
    expect(server.callsOf("set_coupon").map((c) => (c as { code: string }).code)).toEqual([
      "NOEXISTE",
      "otro",
    ]);
    // 5 % de Bs 100 = Bs 5,00
    expect(screen.getByText("Ahorras Bs 5,00")).toBeInTheDocument();
  });

  it("un rechazo con la bolsa ya con otro cupón (carrera entre pestañas) se dice bajo la tarjeta, sin esconder el cupón puesto", async () => {
    const user = userEvent.setup();
    const view = await setup();
    await user.type(field(), "verano10{Enter}");
    await flush();
    await act(async () => {
      await view.cart().store.applyCoupon("otro");
    });
    expect(screen.getByRole("alert")).toHaveTextContent(TEXT.coupon_already_applied!);
    expect(screen.getByRole("button", { name: "Quitar el cupón VERANO10" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("CouponForm · cupón ya aplicado (foto del servidor)", () => {
  it("nombre, código, lo que baja EL CUPÓN y «Quitar» con su nombre accesible", async () => {
    await setup(appliedSnapshot());
    expect(screen.getByText("Cupón VERANO10")).toBeInTheDocument();
    expect(screen.getByText("Código: VERANO10")).toBeInTheDocument();
    expect(screen.getByText("Ahorras Bs 20,00")).toBeInTheDocument();
    const remove = screen.getByRole("button", { name: "Quitar el cupón VERANO10" });
    expect(remove).toHaveTextContent("Quitar");
    expect(remove).toHaveClass("min-h-11");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("con una oferta automática además del cupón, «Ahorras» es lo del cupón (Bs 10), no el descuento total de la bolsa (Bs 25)", async () => {
    const base = appliedSnapshot();
    const snapshot: CartSnapshot = {
      ...base,
      totals: { ...base.totals, discount: 25, total: 175 },
      discounts: {
        ...base.discounts!,
        applied: [
          {
            discount_id: "d0",
            coupon_id: null,
            name: "Oferta de temporada",
            kind: "percent",
            amount: 15,
            automatic: true,
            free_shipping: false,
          },
          { ...base.discounts!.applied[0]!, amount: 10 },
        ],
      },
    };
    await setup(snapshot);
    expect(screen.getByText("Ahorras Bs 10,00")).toBeInTheDocument();
    expect(screen.queryByText(/25,00/)).not.toBeInTheDocument();
  });

  it("un cupón de envío gratis no baja el subtotal: dice «Envío gratis», no un importe", async () => {
    const base = appliedSnapshot();
    const snapshot: CartSnapshot = {
      ...base,
      totals: { ...base.totals, discount: null, total: 200 },
      discounts: {
        ...base.discounts!,
        applied: [{ ...base.discounts!.applied[0]!, free_shipping: true, amount: 0 }],
        free_shipping: true,
      },
    };
    await setup(snapshot);
    expect(screen.getByText("Envío gratis")).toBeInTheDocument();
    expect(screen.queryByText(/Ahorras/)).not.toBeInTheDocument();
  });

  it("quitar: pide `remove_coupon`, vuelve el formulario VACÍO con el foco en el campo y lo anuncia («Cupón quitado»)", async () => {
    const user = userEvent.setup();
    const { server } = await setup(appliedSnapshot());
    const status = live();
    await user.click(screen.getByRole("button", { name: "Quitar el cupón VERANO10" }));
    await flush();
    expect(server.callsOf("remove_coupon")).toEqual([
      { action: "remove_coupon", cart_token: expect.any(String) },
    ]);
    expect(
      screen.getByRole("heading", { level: 3, name: "¿Tienes un cupón?" }),
    ).toBeInTheDocument();
    expect(field()).toHaveValue("");
    expect(field()).toHaveFocus();
    expect(live()).toBe(status);
    expect(status).toHaveTextContent("Cupón quitado");
  });

  it("«Quitar» queda ocupado mientras el servidor responde y un segundo clic no manda otra petición", async () => {
    const user = userEvent.setup();
    const { server } = await setup(appliedSnapshot());
    const resume = server.pause();
    const remove = screen.getByRole("button", { name: "Quitar el cupón VERANO10" });
    await user.click(remove);
    expect(remove).toHaveAttribute("aria-busy", "true");
    expect(remove).toHaveAttribute("aria-disabled", "true");
    await user.click(remove);
    expect(server.callsOf("remove_coupon")).toHaveLength(1);
    await act(async () => {
      resume();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(field()).toBeInTheDocument();
    expect(server.callsOf("remove_coupon")).toHaveLength(1);
  });

  it("dos clics en «Quitar» en el mismo instante (antes de repintar) mandan UNA sola petición", async () => {
    const { server } = await setup(appliedSnapshot());
    const remove = screen.getByRole("button", { name: "Quitar el cupón VERANO10" });
    const resume = server.pause();
    await act(async () => {
      remove.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      remove.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(server.callsOf("remove_coupon")).toHaveLength(1);
    await act(async () => {
      resume();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(server.callsOf("remove_coupon")).toHaveLength(1);
  });

  it("si quitar falla (sin conexión) el cupón sigue puesto, «Quitar» conserva el foco y NO se anuncia «Cupón quitado»", async () => {
    const user = userEvent.setup();
    const { server } = await setup(appliedSnapshot());
    const remove = screen.getByRole("button", { name: "Quitar el cupón VERANO10" });
    server.forced = failure(0, "network");
    await user.click(remove);
    await flush();
    expect(screen.getByRole("button", { name: "Quitar el cupón VERANO10" })).toHaveFocus();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(live()).toBeEmptyDOMElement();
  });

  it("un código largo (40 caracteres) no desborda: se parte en vez de ensanchar la tarjeta (360 px)", async () => {
    const code = "A".repeat(40);
    await setup(savedSnapshot("not_applicable", null, code));
    const label = screen.getByText(`Código: ${code}`);
    expect(label).toHaveClass("break-all");
    expect(label.parentElement).toHaveClass("min-w-0");
    expect(screen.getByRole("button", { name: `Quitar el cupón ${code}` })).toHaveClass("shrink-0");
  });
});

describe("CouponForm · cupón guardado que hoy no baja nada", () => {
  it.each([
    ["not_applicable", TEXT.not_applicable!],
    ["not_combinable", TEXT.not_combinable!],
    // otros motivos que el servidor puede dejar en la foto (venció, se agotó…): igual se explican y se pueden quitar
    ["expired", TEXT.expired!],
    ["sold_out", TEXT.sold_out!],
  ] as const)("«%s»: código, motivo y «Quitar» (sin campo ni alerta)", async (reason, text) => {
    await setup(savedSnapshot(reason));
    expect(screen.getByText("Código: VERANO10")).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar el cupón VERANO10" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/Ahorras/)).not.toBeInTheDocument();
  });

  it("«min_not_reached» dice cuánto falta con el importe del servidor (Bs 1.250,50)", async () => {
    await setup(savedSnapshot("min_not_reached", 1250.5));
    expect(screen.getByText("Te faltan Bs 1.250,50 para usar este cupón.")).toBeInTheDocument();
  });

  it("«min_not_reached» sin importe no inventa una cifra", async () => {
    await setup(savedSnapshot("min_not_reached", null));
    expect(
      screen.getByText("Todavía no llegas al mínimo de compra de este cupón."),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("{missing}");
  });

  it("«Quitar» un cupón guardado devuelve el formulario", async () => {
    const user = userEvent.setup();
    const { server } = await setup(savedSnapshot("min_not_reached", 400, "GRANDE"));
    await user.click(screen.getByRole("button", { name: "Quitar el cupón GRANDE" }));
    await flush();
    expect(server.callsOf("remove_coupon")).toHaveLength(1);
    expect(field()).toHaveFocus();
    expect(within(screen.getByRole("group")).queryByText(/Te faltan/)).not.toBeInTheDocument();
  });
});
