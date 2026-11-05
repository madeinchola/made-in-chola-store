import { describe, expect, it } from "vitest";
import { lineNotices, orphanNotice } from "./lineNotices";
import { makeLine } from "./cart-test-utils";
import type { DisplayLine } from "./selectors";
import type { CartLimits, CartLine, ItemResult } from "./types";

const limits: CartLimits = { max_qty_per_variant: 10, max_lines: 30, max_units: 40 };

const show = (extra: Partial<CartLine>): DisplayLine => {
  const line = makeLine("a", 2, extra);
  return { ...line, shownQty: line.qty, syncing: false };
};
const result = (outcome: ItemResult["outcome"], requested = 5, applied = 3): ItemResult => ({
  outcome,
  requested,
  applied,
});

describe("avisos de estado", () => {
  it("una línea sana no tiene avisos", () => {
    expect(lineNotices(show({}), undefined, "BOB", limits)).toEqual([]);
  });

  it("se agotó: bloquea y ofrece Quitar", () => {
    const [notice, ...rest] = lineNotices(
      show({ status: "out_of_stock", blocking: true, available: 0 }),
      undefined,
      "BOB",
      limits,
    );
    expect(rest).toEqual([]);
    expect(notice).toMatchObject({
      tone: "danger",
      blocking: true,
      message: "Se agotó",
      action: { kind: "remove", label: "Quitar" },
    });
  });

  it("ya no está disponible: bloquea y ofrece Quitar", () => {
    const [notice] = lineNotices(
      show({ status: "unavailable", blocking: true, available: 0 }),
      undefined,
      "BOB",
      limits,
    );
    expect(notice).toMatchObject({
      blocking: true,
      message: "Ya no está disponible",
      action: { kind: "remove" },
    });
  });

  it("pocas unidades: «Solo quedan N» y «Ajustar a N»", () => {
    const [notice] = lineNotices(
      show({ qty: 5, status: "low_stock", blocking: true, available: 3 }),
      undefined,
      "BOB",
      limits,
    );
    expect(notice).toMatchObject({
      tone: "warning",
      blocking: true,
      message: "Solo quedan 3",
      action: { kind: "adjust", label: "Ajustar a 3" },
    });
  });

  it("pocas unidades sin ninguna disponible: no se puede ajustar a 0, se ofrece Quitar", () => {
    const [notice] = lineNotices(
      show({ status: "low_stock", blocking: true, available: 0 }),
      undefined,
      "BOB",
      limits,
    );
    expect(notice?.action?.kind).toBe("remove");
  });
});

describe("avisos de precio (los cuatro price_notice)", () => {
  const priced = (extra: Partial<CartLine>) =>
    lineNotices(
      show({
        status: "price_changed",
        unit_price: 90,
        price_at_add: 100,
        current_price: 90,
        ...extra,
      }),
      undefined,
      "BOB",
      limits,
    );

  it("dropped: informativo, no bloquea, dice cuánto se paga", () => {
    const [notice] = priced({ price_notice: "dropped" });
    expect(notice).toMatchObject({
      tone: "info",
      blocking: false,
      message: "Bajó de precio: pagas Bs 90,00",
    });
    expect(notice?.action).toBeUndefined();
  });

  it("guaranteed: informativo, no bloquea", () => {
    const [notice] = priced({ price_notice: "guaranteed", unit_price: 100, current_price: 120 });
    expect(notice).toMatchObject({
      tone: "info",
      blocking: false,
      message: "Te respetamos el precio con el que lo agregaste",
    });
    expect(notice?.action).toBeUndefined();
  });

  it("expired_raised: BLOQUEA y pide aceptar el precio nuevo", () => {
    const [notice] = priced({
      price_notice: "expired_raised",
      unit_price: 120,
      current_price: 120,
      blocking: true,
    });
    expect(notice).toMatchObject({
      tone: "warning",
      blocking: true,
      message: "El precio cambió a Bs 120,00",
      action: { kind: "accept", label: "Aceptar nuevo precio" },
    });
  });

  it("expired_dropped: informativo (no bloquea) pero con «aceptar»", () => {
    const [notice] = priced({ price_notice: "expired_dropped", current_price: 80, unit_price: 80 });
    expect(notice).toMatchObject({
      blocking: false,
      message: "El precio bajó a Bs 80,00",
      action: { kind: "accept" },
    });
  });

  it("si falta current_price se usa el precio efectivo", () => {
    const [notice] = priced({
      price_notice: "expired_raised",
      current_price: null,
      unit_price: 130,
    });
    expect(notice?.message).toBe("El precio cambió a Bs 130,00");
  });

  it("pocas unidades Y precio subido: ambos avisos, estado primero", () => {
    const specs = lineNotices(
      show({
        status: "low_stock",
        blocking: true,
        available: 1,
        price_notice: "expired_raised",
        current_price: 130,
      }),
      undefined,
      "BOB",
      limits,
    );
    expect(specs.map((s) => s.key)).toEqual(["status", "price"]);
  });

  it("agotado con aviso de precio: solo se dice que se agotó", () => {
    const specs = lineNotices(
      show({ status: "out_of_stock", blocking: true, price_notice: "dropped" }),
      undefined,
      "BOB",
      limits,
    );
    expect(specs).toHaveLength(1);
  });
});

describe("avisos del último cambio (state.results)", () => {
  const notice = (outcome: ItemResult["outcome"], extra: Partial<CartLine> = {}, applied = 3) =>
    lineNotices(show(extra), result(outcome, 5, applied), "BOB", limits)[0];

  it.each([
    ["adjusted", 3, "Solo había 3 unidades; ajustamos tu pedido."],
    ["adjusted", 1, "Solo había 1 unidad; ajustamos tu pedido."],
    [
      "capped_variant",
      10,
      "Puedes llevar hasta 10 unidades de este producto; ajustamos tu pedido.",
    ],
    ["capped_units", 2, "Tu bolsa admite hasta 40 unidades en total; dejamos 2 de este producto."],
    ["limit_lines", 0, "Tu bolsa admite hasta 30 productos distintos."],
    ["limit_units", 0, "Tu bolsa ya tiene el máximo de 40 unidades."],
    ["out_of_stock", 0, "Ese producto se agotó mientras lo agregabas."],
    ["unavailable", 0, "Ese producto ya no está disponible."],
  ] as const)("%s (aplicado %i) → «%s», cerrable y sin bloquear", (outcome, applied, message) => {
    expect(notice(outcome, {}, applied)).toMatchObject({
      tone: "warning",
      blocking: false,
      message,
      dismissible: true,
    });
  });

  it("ok y removed no dicen nada", () => {
    expect(notice("ok")).toBeUndefined();
    expect(notice("removed")).toBeUndefined();
  });

  it("no repite «Se agotó» / «Ya no está disponible» si la línea ya lo muestra", () => {
    expect(
      lineNotices(
        show({ status: "out_of_stock", blocking: true }),
        result("out_of_stock"),
        "BOB",
        limits,
      ),
    ).toHaveLength(1);
    expect(
      lineNotices(
        show({ status: "unavailable", blocking: true }),
        result("unavailable"),
        "BOB",
        limits,
      ),
    ).toHaveLength(1);
  });
});

describe("avisos sin línea (no se pudo agregar)", () => {
  it.each([
    ["out_of_stock", "No pudimos agregar ese producto: se agotó."],
    ["unavailable", "No pudimos agregar ese producto: ya no está disponible."],
    [
      "limit_lines",
      "No pudimos agregar ese producto: tu bolsa admite hasta 30 productos distintos.",
    ],
    ["limit_units", "No pudimos agregar ese producto: tu bolsa admite hasta 40 unidades en total."],
    [
      "capped_units",
      "No pudimos agregar ese producto: tu bolsa admite hasta 40 unidades en total.",
    ],
    ["adjusted", "No pudimos agregar ese producto: inténtalo de nuevo."],
  ] as const)("%s → «%s»", (outcome, message) => {
    expect(orphanNotice(result(outcome, 1, 0), limits)).toMatchObject({
      message,
      dismissible: true,
    });
  });

  it("sin la foto del carrito no inventa límites", () => {
    expect(orphanNotice(result("limit_lines"), null)?.message).toBe(
      "No pudimos agregar ese producto: inténtalo de nuevo.",
    );
  });

  it("una bolsa de invitado que ya no existe lo dice", () => {
    expect(orphanNotice(result("token_retired"), null)?.message).toBe(
      "Tu bolsa anterior ya no existe. Vuelve a agregar tus productos.",
    );
  });

  it("ok y removed no dicen nada", () => {
    expect(orphanNotice(result("ok"), limits)).toBeNull();
    expect(orphanNotice(result("removed"), limits)).toBeNull();
  });
});
