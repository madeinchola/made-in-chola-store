import { describe, expect, it } from "vitest";
import type { CartState } from "./cartStore";
import { makeLine, makeSnapshot, NOW } from "./cart-test-utils";
import {
  blockingLines,
  canCheckout,
  displayCount,
  displayLines,
  reservationRemainingMs,
} from "./selectors";

const base: CartState = {
  identity: { kind: "user", userId: "u1" },
  loaded: true,
  snapshot: null,
  pending: {},
  results: {},
  lastRemoved: null,
  sync: { state: "idle" },
  clockOffsetMs: 0,
  mergeReport: null,
  reserving: false,
  coupon: { busy: false, notice: null },
};
const withState = (patch: Partial<CartState>): CartState => ({ ...base, ...patch });

describe("displayLines", () => {
  const snapshot = makeSnapshot([makeLine("a", 3), makeLine("b", 1)]);

  it("sin cambios pendientes, las líneas del servidor tal cual y sin «sincronizando»", () => {
    const lines = displayLines(withState({ snapshot }));
    expect(lines.map((l) => [l.variant_id, l.shownQty, l.syncing])).toEqual([
      ["a", 3, false],
      ["b", 1, false],
    ]);
  });

  it("una cantidad pendiente se ve ya (shownQty) y marca la línea como sincronizando; las demás no", () => {
    const lines = displayLines(withState({ snapshot, pending: { a: 5 } }));
    expect(lines.map((l) => [l.variant_id, l.shownQty, l.syncing])).toEqual([
      ["a", 5, true],
      ["b", 1, false],
    ]);
  });

  it("una línea pendiente de quitar (cantidad 0) deja de verse", () => {
    const lines = displayLines(withState({ snapshot, pending: { a: 0 } }));
    expect(lines.map((l) => l.variant_id)).toEqual(["b"]);
  });

  it("sin foto del servidor no hay líneas (aunque haya altas pendientes)", () => {
    expect(displayLines(withState({ pending: { a: 2 } }))).toEqual([]);
  });
});

describe("displayCount (el número de la bolsa)", () => {
  const snapshot = makeSnapshot([makeLine("a", 3), makeLine("b", 1)]);

  it("suma las unidades del servidor: 3 + 1 = 4", () => {
    expect(displayCount(withState({ snapshot }))).toBe(4);
  });

  it("aplica lo pendiente a lo conocido: a pasa de 3 a 5 → 5 + 1 = 6", () => {
    expect(displayCount(withState({ snapshot, pending: { a: 5 } }))).toBe(6);
  });

  it("cuenta las altas pendientes de productos que el servidor aún no confirmó: 4 + 2 = 6", () => {
    // Sin esto, agregar el primer producto dejaba la bolsa en (0) hasta que el servidor respondiera.
    expect(displayCount(withState({ snapshot, pending: { nuevo: 2 } }))).toBe(6);
    expect(displayCount(withState({ pending: { nuevo: 2 } }))).toBe(2);
  });

  it("quitar (pendiente 0) resta; una cantidad pendiente negativa no resta de más (se queda en 0)", () => {
    expect(displayCount(withState({ snapshot, pending: { a: 0 } }))).toBe(1);
    expect(displayCount(withState({ snapshot, pending: { a: -4 } }))).toBe(1);
    expect(displayCount(withState({ pending: { nuevo: -1 } }))).toBe(0);
  });

  it("sin nada, 0", () => {
    expect(displayCount(base)).toBe(0);
  });
});

describe("canCheckout (nunca con algo sin confirmar)", () => {
  const ok = makeSnapshot([makeLine("a", 1)]); // can_checkout = true

  it("solo si el servidor lo permite, no hay cambios pendientes y hay conexión", () => {
    expect(canCheckout(withState({ snapshot: ok }))).toBe(true);
  });

  it("con un cambio pendiente NO (podría cobrar otra cosa de la que se ve)", () => {
    expect(canCheckout(withState({ snapshot: ok, pending: { a: 2 } }))).toBe(false);
  });

  it("sin conexión NO (aunque el servidor lo permitiera hace un momento)", () => {
    expect(canCheckout(withState({ snapshot: ok, sync: { state: "offline" } }))).toBe(false);
  });

  it("si el servidor dice que no, NO; sin foto, NO; con error de otro tipo sí puede seguir mandando el servidor", () => {
    expect(canCheckout(withState({ snapshot: { ...ok, can_checkout: false } }))).toBe(false);
    expect(canCheckout(base)).toBe(false);
    expect(canCheckout(withState({ snapshot: ok, sync: { state: "error", code: "x" } }))).toBe(
      true,
    );
  });
});

describe("blockingLines", () => {
  it("devuelve solo las líneas que impiden pagar", () => {
    const snapshot = makeSnapshot([
      makeLine("a", 1),
      makeLine("b", 1, { status: "out_of_stock", blocking: true }),
    ]);
    expect(blockingLines(withState({ snapshot })).map((l) => l.variant_id)).toEqual(["b"]);
  });
});

describe("reservationRemainingMs (con la hora del SERVIDOR)", () => {
  // La retención vence a las 12:10:00; el «ahora» del dispositivo es 12:00:00 → faltan 10 min = 600 000 ms
  const held = makeSnapshot([makeLine("a", 1)], {
    reservation: { state: "held", expires_at: "2026-11-03T12:10:00.000Z" },
  });

  it("sin desfase: 600 000 ms", () => {
    expect(reservationRemainingMs(withState({ snapshot: held }), NOW)).toBe(600_000);
  });

  it("servidor 2 min ADELANTADO: ya pasaron 2 min para él → faltan 8 min = 480 000 ms", () => {
    expect(reservationRemainingMs(withState({ snapshot: held, clockOffsetMs: 120_000 }), NOW)).toBe(
      480_000,
    );
  });

  it("servidor 1 min ATRASADO: faltan 11 min = 660 000 ms", () => {
    expect(reservationRemainingMs(withState({ snapshot: held, clockOffsetMs: -60_000 }), NOW)).toBe(
      660_000,
    );
  });

  it("ya vencida: 0 (nunca negativo)", () => {
    expect(reservationRemainingMs(withState({ snapshot: held }), NOW + 20 * 60_000)).toBe(0);
  });

  it("sin retención vigente (expired, none o fecha inválida) → null", () => {
    const res = (reservation: { state: "none" | "held" | "expired"; expires_at: string | null }) =>
      reservationRemainingMs(
        withState({ snapshot: makeSnapshot([makeLine("a", 1)], { reservation }) }),
        NOW,
      );
    expect(res({ state: "expired", expires_at: null })).toBeNull();
    expect(res({ state: "none", expires_at: null })).toBeNull();
    expect(res({ state: "held", expires_at: null })).toBeNull();
    expect(res({ state: "held", expires_at: "no es una fecha" })).toBeNull();
    expect(reservationRemainingMs(base, NOW)).toBeNull();
  });
});
