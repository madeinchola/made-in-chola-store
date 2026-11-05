import { describe, expect, it } from "vitest";
import { CartStore, type CartState } from "./cartStore";
import { makeLine, makeSnapshot } from "./cart-test-utils";
import { memoryCartStorage } from "./storage";
import { checkoutBlockReason, pendingAdds } from "./viewState";

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
