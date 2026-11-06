import { describe, expect, it } from "vitest";
import type { Destination } from "./destination";
import {
  buildQuoteParams,
  canQuote,
  errorView,
  estimatedTotal,
  formatEta,
  freshestSlots,
  quoteView,
  scheduleView,
  shippingRow,
  type QuoteView,
} from "./estimate";
import { quoteResult, rejectedQuote } from "./shipping-test-utils";
import { SHIPPING_ERROR_CODES, type QuoteSlot } from "./types";

const rejected = rejectedQuote;

const destination: Destination = {
  lat: -16.5,
  lng: -68.15,
  city: "La Paz",
  label: "Casa",
  addressId: "addr-1",
};

describe("canQuote", () => {
  it.each([
    [1, 100, true],
    [3, 0.01, true],
    [0, 100, false], // sin líneas
    [1, 0, false], // nada cobrable (todo agotado)
    [1, -5, false],
    [1, Number.NaN, false],
    [1, Number.POSITIVE_INFINITY, false],
  ])("%i líneas, subtotal %f → %s", (lineCount, subtotal, expected) => {
    expect(canQuote({ lineCount, subtotal })).toBe(expected);
  });
});

describe("buildQuoteParams", () => {
  it("destino + subtotal del servidor + moneda; NADA más (ni nombre ni id de dirección, ni claves undefined)", () => {
    const params = buildQuoteParams(destination, 100, "BOB");
    expect(params).toStrictEqual({
      lat: -16.5,
      lng: -68.15,
      city: "La Paz",
      orderAmount: 100,
      currency: "BOB",
    });
    expect(Object.keys(params)).toEqual(["lat", "lng", "city", "orderAmount", "currency"]);
  });

  it("con una franja elegida agrega deliveryDate y slotId", () => {
    expect(
      buildQuoteParams(destination, 250.5, "BOB", { date: "2026-11-09", slotId: "slot-1" }),
    ).toStrictEqual({
      lat: -16.5,
      lng: -68.15,
      city: "La Paz",
      orderAmount: 250.5,
      currency: "BOB",
      deliveryDate: "2026-11-09",
      slotId: "slot-1",
    });
  });

  it("sin franja (null) no manda deliveryDate ni slotId", () => {
    const params = buildQuoteParams(destination, 100, "BOB", null);
    expect("deliveryDate" in params).toBe(false);
    expect("slotId" in params).toBe(false);
  });
});

describe("estimatedTotal · subtotal + envío, en la unidad menor de la moneda", () => {
  it("100 + 15 = 115", () => {
    expect(estimatedTotal(100, 15, "BOB")).toBe(115);
  });
  it("sin errores de coma flotante: 0,1 + 0,2 = 0,3", () => {
    expect(estimatedTotal(0.1, 0.2, "BOB")).toBe(0.3);
    expect(0.1 + 0.2).not.toBe(0.3); // la suma ingenua SÍ falla
  });
  it("envío gratis: el total es el subtotal", () => {
    expect(estimatedTotal(250.5, 0, "BOB")).toBe(250.5);
  });
  it("centavos: 99,99 + 0,01 = 100", () => {
    expect(estimatedTotal(99.99, 0.01, "BOB")).toBe(100);
  });
  it("una moneda sin decimales suma enteros", () => {
    expect(estimatedTotal(1000, 250, "CLP")).toBe(1250);
  });
  it("una moneda desconocida o un número inválido no dan un total inventado", () => {
    expect(estimatedTotal(100, 15, "XXX")).toBeNull();
    expect(estimatedTotal(Number.NaN, 15, "BOB")).toBeNull();
    expect(estimatedTotal(100, Number.POSITIVE_INFINITY, "BOB")).toBeNull();
  });
});

describe("errorView · cada código del contrato tiene mensaje y acción", () => {
  it.each([...SHIPPING_ERROR_CODES, "unknown" as const])(
    "%s → mensaje traducido no vacío",
    (code) => {
      const view = errorView([{ code, field: "system" }]);
      expect(view.code).toBe(code);
      expect(view.message.trim().length).toBeGreaterThan(0);
      // `t` devuelve la clave si no existe: un mensaje que empieza por «shipping.» es un texto que falta
      expect(view.message).not.toMatch(/^shipping\./);
    },
  );

  it("los mensajes son los de shipping.errors (no se redactan aquí)", () => {
    expect(errorView([{ code: "out_of_coverage", field: "location" }]).message).toBe(
      "Todavía no entregamos en esa dirección.",
    );
    expect(errorView([{ code: "slot_full", field: "slot" }]).message).toBe(
      "Esa franja se llenó. Elige otra.",
    );
    expect(errorView([{ code: "unknown", field: "system" }]).message).toBe(
      "No pudimos calcular el envío. Inténtalo de nuevo.",
    );
  });

  it.each([
    ["location_required", "location"],
    ["invalid_coordinates", "location"],
    ["blocked_zone", "location"],
    ["out_of_coverage", "location"],
    ["no_rate", "location"],
    ["no_origin", "retry"],
    ["coverage_not_configured", "retry"],
    ["method_inactive", "retry"],
    ["unknown", "retry"],
    ["currency_unsupported", "none"],
    ["invalid_order_amount", "none"],
    ["slot_full", "schedule"],
    ["date_too_soon", "schedule"],
    ["date_required", "schedule"],
  ] as const)("%s → acción «%s»", (code, action) => {
    expect(errorView([{ code, field: "system" }]).action).toBe(action);
  });

  it("solo los errores de cobertura traen una frase de ayuda", () => {
    const withHelp = SHIPPING_ERROR_CODES.filter(
      (code) => errorView([{ code, field: "system" }]).help !== null,
    );
    expect(withHelp).toEqual(["blocked_zone", "out_of_coverage", "no_rate"]);
    expect(errorView([{ code: "out_of_coverage", field: "location" }]).help).toBe(
      "Prueba con otra dirección o escríbenos por WhatsApp y vemos cómo ayudarte.",
    );
  });

  it("usa el PRIMER error; sin errores (no debería pasar) es «unknown»", () => {
    expect(
      errorView([
        { code: "slot_full", field: "slot" },
        { code: "out_of_coverage", field: "location" },
      ]).code,
    ).toBe("slot_full");
    expect(errorView([]).code).toBe("unknown");
  });
});

describe("formatEta", () => {
  it.each([
    [1, 2, "Entrega estimada en 1 a 2 días"],
    [2, 5, "Entrega estimada en 2 a 5 días"],
    [3, 3, "Entrega estimada en 3 días"],
    [1, 1, "Entrega estimada en 1 día"],
    [0, 0, "Entrega estimada: el mismo día"],
    [0, 2, "Entrega estimada: hasta 2 días"],
    [null, 1, "Entrega estimada: hasta 1 día"],
    [null, 4, "Entrega estimada: hasta 4 días"],
    [2, null, "Entrega estimada: 2 días o más"],
    [1, null, "Entrega estimada: 1 día o más"],
  ] as const)("%s a %s → «%s»", (min, max, expected) => {
    expect(formatEta(min, max)).toBe(expected);
  });

  it("sin plazo, o con números que no sirven, no dice nada", () => {
    expect(formatEta(null, null)).toBeNull();
    expect(formatEta(-1, null)).toBeNull();
    expect(formatEta(1.5, 2.5)).toBeNull();
    expect(formatEta(Number.NaN, Number.NaN)).toBeNull();
  });

  it("un extremo inválido se ignora y se usa el otro", () => {
    expect(formatEta(-1, 3)).toBe("Entrega estimada: hasta 3 días");
    expect(formatEta(2, 1.5)).toBe("Entrega estimada: 2 días o más");
  });
});

describe("quoteView · qué se muestra de la cotización", () => {
  const base = { asked: true, currency: "BOB", failed: false };

  it("sin preguntar es «idle» (aunque haya una respuesta vieja a mano)", () => {
    expect(quoteView({ ...base, asked: false, data: quoteResult() })).toEqual({ kind: "idle" });
  });

  it("preguntada y sin respuesta: «loading»; con fallo de red: «failed»", () => {
    expect(quoteView({ ...base, data: undefined })).toEqual({ kind: "loading" });
    expect(quoteView({ ...base, data: undefined, failed: true })).toEqual({ kind: "failed" });
  });

  it("una respuesta buena: costo, plazo y franjas del servidor", () => {
    const slots: QuoteSlot[] = [
      {
        slotId: "s",
        date: "2026-11-09",
        start: "09:00",
        end: "11:00",
        capacity: 2,
        remaining: 1,
        available: true,
      },
    ];
    expect(quoteView({ ...base, data: quoteResult({ cost: 15, slots }) })).toEqual({
      kind: "ok",
      cost: 15,
      currency: "BOB",
      eta: "Entrega estimada en 1 a 2 días",
      slots,
    });
  });

  it("sin plazo en el método: eta null", () => {
    const view = quoteView({ ...base, data: quoteResult({ method: null }) });
    expect(view.kind === "ok" && view.eta).toBeNull();
  });

  it("costo 0 con `ok` es un costo REAL (envío gratis), no «sin costo»", () => {
    expect(quoteView({ ...base, data: quoteResult({ cost: 0 }) })).toMatchObject({
      kind: "ok",
      cost: 0,
    });
  });

  it("`ok` falso: error y NUNCA costo, aunque el objeto trajera uno", () => {
    const view = quoteView({
      ...base,
      data: { ...rejected("out_of_coverage"), cost: 15 },
    });
    expect(view.kind).toBe("rejected");
    expect(view).not.toHaveProperty("cost");
  });

  it("`ok` con costo null no es un costo", () => {
    expect(quoteView({ ...base, data: quoteResult({ cost: null }) }).kind).toBe("rejected");
  });

  it("una respuesta en otra moneda que la de la bolsa no se muestra como costo", () => {
    const view = quoteView({ ...base, data: quoteResult({ currency: "USD" }) });
    expect(view).toMatchObject({ kind: "rejected", error: { code: "unknown" } });
  });

  it("moneda null en la respuesta: se acepta la de la bolsa", () => {
    expect(quoteView({ ...base, data: quoteResult({ currency: null }) }).kind).toBe("ok");
  });

  it("el error que se muestra es el primero, con su acción", () => {
    expect(quoteView({ ...base, data: rejected("blocked_zone") })).toMatchObject({
      kind: "rejected",
      error: { code: "blocked_zone", action: "location" },
    });
  });
});

describe("shippingRow · la fila «Envío» del resumen", () => {
  const cases: [QuoteView, unknown][] = [
    [{ kind: "idle" }, { kind: "later" }],
    [{ kind: "loading" }, { kind: "calculating" }],
    [{ kind: "failed" }, { kind: "unavailable" }],
    [
      { kind: "rejected", error: errorView([{ code: "no_rate", field: "location" }]) },
      { kind: "unavailable" },
    ],
    [{ kind: "ok", cost: 0, currency: "BOB", eta: null, slots: [] }, { kind: "free" }],
    [
      { kind: "ok", cost: 15, currency: "BOB", eta: null, slots: [] },
      { kind: "cost", cost: 15 },
    ],
  ];
  it.each(cases)("%j → %j", (quote, expected) => {
    expect(shippingRow(quote)).toEqual(expected);
  });
});

describe("scheduleView · la franja elegida", () => {
  const choice = { date: "2026-11-09", slotId: "slot-1" };
  const confirmed = quoteResult({
    selected: { date: "2026-11-09", slotId: "slot-1", start: "09:00", end: "11:00" },
  });

  it("sin elección, o sin cotización válida detrás, no hay nada que decir", () => {
    expect(scheduleView({ choice: null, asked: true, data: confirmed, failed: false })).toEqual({
      kind: "none",
    });
    expect(scheduleView({ choice, asked: false, data: confirmed, failed: false })).toEqual({
      kind: "none",
    });
  });

  it("validando y con fallo de red", () => {
    expect(scheduleView({ choice, asked: true, data: undefined, failed: false }).kind).toBe(
      "checking",
    );
    expect(scheduleView({ choice, asked: true, data: undefined, failed: true }).kind).toBe(
      "failed",
    );
  });

  it("confirmada: solo si el servidor devuelve la MISMA fecha y franja", () => {
    expect(scheduleView({ choice, asked: true, data: confirmed, failed: false })).toEqual({
      kind: "confirmed",
      date: "2026-11-09",
      slotId: "slot-1",
      start: "09:00",
      end: "11:00",
    });
  });

  it("una confirmación de OTRA franja o de otro día no se da por buena", () => {
    const otherSlot = quoteResult({
      selected: { date: "2026-11-09", slotId: "slot-2", start: "09:00", end: "11:00" },
    });
    const otherDay = quoteResult({
      selected: { date: "2026-11-10", slotId: "slot-1", start: "09:00", end: "11:00" },
    });
    for (const data of [otherSlot, otherDay, quoteResult({ selected: null })]) {
      expect(scheduleView({ choice, asked: true, data, failed: false })).toMatchObject({
        kind: "rejected",
        error: { code: "unknown" },
      });
    }
  });

  it("el error del servidor (slot_full, date_too_soon…) se muestra tal cual", () => {
    expect(
      scheduleView({ choice, asked: true, data: rejected("slot_full", "slot"), failed: false }),
    ).toMatchObject({ kind: "rejected", error: { code: "slot_full", action: "schedule" } });
  });
});

describe("freshestSlots", () => {
  const slot = (id: string): QuoteSlot => ({
    slotId: id,
    date: "2026-11-09",
    start: "09:00",
    end: "11:00",
    capacity: 1,
    remaining: 1,
    available: true,
  });
  it("prefiere las de la validación (más recientes); si no hay, las de la cotización", () => {
    expect(freshestSlots([slot("base")], quoteResult({ slots: [slot("fresh")] }))).toEqual([
      slot("fresh"),
    ]);
    expect(freshestSlots([slot("base")], quoteResult({ slots: [] }))).toEqual([slot("base")]);
    expect(freshestSlots([slot("base")], undefined)).toEqual([slot("base")]);
  });
});
