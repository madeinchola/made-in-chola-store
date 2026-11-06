import { describe, expect, it } from "vitest";
import { CartStore, type CartState } from "./cartStore";
import { makeLine, makeSnapshot, NOW } from "./cart-test-utils";
import { memoryCartStorage } from "./storage";
import { checkoutBlockReason, pendingAdds, reservationView } from "./viewState";

function stateWith(extra: Partial<CartState>): CartState {
  const store = new CartStore({
    api: { request: () => new Promise(() => {}) },
    storage: memoryCartStorage(),
  });
  return { ...store.getState(), loaded: true, ...extra };
}

describe("pendingAdds", () => {
  it("solo cuenta altas pendientes de variantes que el servidor aún no devolvió", () => {
    const snapshot = makeSnapshot([makeLine("a", 1), makeLine("b", 1)]);
    const state = stateWith({ snapshot, pending: { a: 3, b: 0, c: 1, d: 0 } });
    expect(pendingAdds(state)).toEqual(["c"]);
  });

  it("sin foto del servidor, toda cantidad pendiente es un alta", () => {
    expect(pendingAdds(stateWith({ pending: { x: 2 } }))).toEqual(["x"]);
  });
});

describe("checkoutBlockReason", () => {
  const ok = makeSnapshot([makeLine("a", 1)]);

  it("se puede pagar → sin razón", () => {
    expect(checkoutBlockReason(stateWith({ snapshot: ok }))).toBeNull();
  });

  it("cargando", () => {
    expect(checkoutBlockReason(stateWith({ loaded: false, snapshot: null }))).toBe("loading");
  });

  it("sin conexión (aunque haya cambios pendientes)", () => {
    expect(
      checkoutBlockReason(
        stateWith({ snapshot: ok, pending: { a: 2 }, sync: { state: "offline", code: "network" } }),
      ),
    ).toBe("offline");
  });

  it("cambios por confirmar, también al agregar el primer producto", () => {
    expect(checkoutBlockReason(stateWith({ snapshot: ok, pending: { a: 2 } }))).toBe("pending");
    expect(checkoutBlockReason(stateWith({ snapshot: null, pending: { z: 1 } }))).toBe("pending");
  });

  it("bolsa vacía", () => {
    expect(checkoutBlockReason(stateWith({ snapshot: makeSnapshot([]) }))).toBe("empty");
    expect(checkoutBlockReason(stateWith({ snapshot: null }))).toBe("empty");
  });

  it("solo precios por aceptar → «prices»; cualquier otro problema → «blocking»", () => {
    const raised = makeLine("a", 1, {
      status: "price_changed",
      price_notice: "expired_raised",
      blocking: true,
    });
    const soldOut = makeLine("b", 1, { status: "out_of_stock", blocking: true });
    expect(checkoutBlockReason(stateWith({ snapshot: makeSnapshot([raised]) }))).toBe("prices");
    expect(checkoutBlockReason(stateWith({ snapshot: makeSnapshot([raised, soldOut]) }))).toBe(
      "blocking",
    );
    expect(checkoutBlockReason(stateWith({ snapshot: makeSnapshot([soldOut]) }))).toBe("blocking");
  });

  it("el servidor dice que no, sin causa visible → «unknown»", () => {
    expect(
      checkoutBlockReason(
        stateWith({ snapshot: makeSnapshot([makeLine("a", 1)], { can_checkout: false }) }),
      ),
    ).toBe("unknown");
  });
});

describe("reservationView (qué muestra la cuenta regresiva)", () => {
  // `makeSnapshot` retiene hasta 2026-11-03T12:10:00Z; NOW = 12:00:00Z → quedan exactamente 10 min = 600 000 ms
  const EXPIRY = "2026-11-03T12:10:00.000Z";
  const EXPIRY_MS = Date.parse(EXPIRY);
  const held = (extra: Partial<CartState> = {}) =>
    stateWith({ snapshot: makeSnapshot([makeLine("a", 1)]), ...extra });
  const withReservation = (reservation: {
    state: "held" | "expired" | "none";
    expires_at: string | null;
  }) => stateWith({ snapshot: makeSnapshot([makeLine("a", 1)], { reservation }) });

  it("sin foto, sin retención o con la reserva desactivada: nada", () => {
    expect(reservationView(stateWith({ snapshot: null }), NOW, null)).toEqual({ kind: "none" });
    expect(reservationView(stateWith({ snapshot: makeSnapshot([]) }), NOW, null)).toEqual({
      kind: "none",
    });
    const off = stateWith({
      snapshot: makeSnapshot([makeLine("a", 1)], { reserve_on_add: false }),
    });
    expect(reservationView(off, NOW, null)).toEqual({ kind: "none" });
  });

  it("vigente: cuenta lo que falta según el servidor (10 min = 600 000 ms; 1 ms antes de vencer sigue contando)", () => {
    expect(reservationView(held(), NOW, null)).toEqual({ kind: "counting", remainingMs: 600_000 });
    expect(reservationView(held(), EXPIRY_MS - 1, null)).toEqual({
      kind: "counting",
      remainingMs: 1,
    });
  });

  it("el reloj del servidor manda: con el servidor 9 min adelantado faltan 60 s; con 10 min adelantado ya venció", () => {
    // faltan 600 000 − (0 + 540 000) = 60 000 con 9 min de desfase; con 10 min de desfase faltan 0
    expect(reservationView(held({ clockOffsetMs: 540_000 }), NOW, null)).toEqual({
      kind: "counting",
      remainingMs: 60_000,
    });
    expect(reservationView(held({ clockOffsetMs: 600_000 }), NOW, null)).toEqual({
      kind: "reserving",
    });
  });

  it("llegó a 0 y aún NO se pidió reservar de nuevo: «reservando» (jamás «ya no reservamos» en el primer pintado)", () => {
    expect(reservationView(held(), EXPIRY_MS, null)).toEqual({ kind: "reserving" });
    // ya se pidió para OTRO vencimiento (uno anterior): para este todavía no
    expect(reservationView(held(), EXPIRY_MS, "2026-11-03T11:50:00.000Z")).toEqual({
      kind: "reserving",
    });
  });

  it("llegó a 0, se pidió y está en vuelo: «reservando»; terminó sin éxito: «ya no reservamos»", () => {
    expect(reservationView(held({ reserving: true }), EXPIRY_MS, EXPIRY)).toEqual({
      kind: "reserving",
    });
    expect(reservationView(held({ reserving: false }), EXPIRY_MS, EXPIRY)).toEqual({
      kind: "expired",
    });
  });

  it("el servidor dijo «vencida»: ya no reservamos, SALVO que se esté reintentando", () => {
    const expired = withReservation({ state: "expired", expires_at: null });
    expect(reservationView(expired, NOW, null)).toEqual({ kind: "expired" });
    expect(reservationView({ ...expired, reserving: true }, NOW, null)).toEqual({
      kind: "reserving",
    });
  });
});
