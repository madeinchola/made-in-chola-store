import { describe, expect, it } from "vitest";
import {
  browserCartStorage,
  GUEST_CART_KEY,
  isPendingFresh,
  memoryCartStorage,
  parseGuestMirror,
  parsePersistedPending,
  PENDING_KEY,
  PENDING_TTL_MS,
} from "./storage";
import type { CartLine, CartSnapshot } from "./types";

const TOKEN = `ct_${"A".repeat(43)}`;

const line: CartLine = {
  variant_id: "v1",
  product_id: "p1",
  name: "Falda",
  slug: "falda",
  sku: null,
  color_name: null,
  color_hex: null,
  size_label: null,
  image_path: null,
  qty: 2,
  billable_qty: 2,
  available: 10,
  status: "ok",
  blocking: false,
  price_notice: null,
  unit_price: 100,
  price_at_add: 100,
  current_price: 100,
  price_locked_until: "2026-11-10T12:00:00.000Z",
  line_total: 200,
  reserved_qty: 2,
  reservation_expires_at: null,
};

const snapshot: CartSnapshot = {
  cart_id: "c1",
  status: "active",
  currency: "BOB",
  reserve_on_add: true,
  ttl_seconds: 600,
  guarantee_days: 7,
  limits: { max_qty_per_variant: 10, max_lines: 30, max_units: 30 },
  lines: [line],
  totals: {
    subtotal: 200,
    item_count: 2,
    line_count: 1,
    shipping: null,
    discount: null,
    total: 200,
  },
  reservation: { state: "held", expires_at: "2026-11-03T12:10:00.000Z" },
  can_checkout: true,
};

const raw = (value: unknown) => JSON.stringify(value);
const mirror = (snap: unknown) => raw({ token: TOKEN, snapshot: snap, savedAt: 5 });

describe("parseGuestMirror", () => {
  it("acepta un espejo bien formado y lo devuelve tal cual", () => {
    expect(parseGuestMirror(mirror(snapshot))).toEqual({ token: TOKEN, snapshot, savedAt: 5 });
  });

  it("sin nada guardado, o con JSON roto o que no es un objeto → null", () => {
    expect(parseGuestMirror(null)).toBeNull();
    expect(parseGuestMirror("")).toBeNull();
    expect(parseGuestMirror("{no es json")).toBeNull();
    expect(parseGuestMirror("42")).toBeNull();
    expect(parseGuestMirror("null")).toBeNull();
    expect(parseGuestMirror("[]")).toBeNull();
  });

  it("un token que no tiene la forma «ct_» + 43 base64url se descarta con todo el espejo", () => {
    for (const token of ["", "ct_corto", `ct_${"A".repeat(44)}`, `xx_${"A".repeat(43)}`, 7, null]) {
      expect(
        parseGuestMirror(raw({ token, snapshot, savedAt: 1 })),
        JSON.stringify(token),
      ).toBeNull();
    }
  });

  // Casos que, sin esta validación, tumbaban TODA la tienda al pintar (displayLines / reservationRemainingMs lanzaban)
  it("una línea que es null o no es un objeto invalida la foto (pero se conserva el token)", () => {
    for (const lines of [
      [null],
      [42],
      ["x"],
      [[]],
      [{}],
      [{ ...line, qty: "2" }],
      [{ ...line, variant_id: 7 }],
    ]) {
      const parsed = parseGuestMirror(mirror({ ...snapshot, lines }));
      expect(parsed?.token, JSON.stringify(lines)).toBe(TOKEN);
      expect(parsed?.snapshot, JSON.stringify(lines)).toBeNull();
    }
  });

  it("un número que JSON.parse convierte en Infinity (1e999) también invalida la foto", () => {
    const text = mirror(snapshot).replace('"unit_price":100', '"unit_price":1e999');
    expect(text).toContain("1e999");
    expect(parseGuestMirror(text)?.snapshot).toBeNull();
    expect(parseGuestMirror(text)?.token).toBe(TOKEN);
  });

  it("una línea con un número que no es finito (NaN, Infinity serializados como null) invalida la foto", () => {
    for (const field of [
      "qty",
      "unit_price",
      "line_total",
      "available",
      "reserved_qty",
      "billable_qty",
    ] as const) {
      const parsed = parseGuestMirror(mirror({ ...snapshot, lines: [{ ...line, [field]: null }] }));
      expect(parsed?.snapshot, field).toBeNull();
    }
    expect(
      parseGuestMirror(mirror({ ...snapshot, lines: [{ ...line, blocking: "no" }] }))?.snapshot,
    ).toBeNull();
  });

  it("un snapshot al que le falta una parte que la pantalla lee (retención, totales, límites…) se descarta", () => {
    const without = (key: keyof CartSnapshot) => {
      const { [key]: _omit, ...rest } = snapshot;
      void _omit;
      return rest;
    };
    for (const key of [
      "reservation",
      "totals",
      "limits",
      "lines",
      "cart_id",
      "currency",
      "can_checkout",
    ] as const) {
      expect(parseGuestMirror(mirror(without(key)))?.snapshot, key).toBeNull();
    }
    expect(parseGuestMirror(mirror({ ...snapshot, reservation: null }))?.snapshot).toBeNull();
    expect(
      parseGuestMirror(mirror({ ...snapshot, reservation: { expires_at: null } }))?.snapshot,
    ).toBeNull();
    expect(
      parseGuestMirror(mirror({ ...snapshot, totals: { subtotal: "200" } }))?.snapshot,
    ).toBeNull();
    expect(parseGuestMirror(mirror({ ...snapshot, limits: {} }))?.snapshot).toBeNull();
    expect(parseGuestMirror(mirror({ ...snapshot, lines: "no" }))?.snapshot).toBeNull();
  });

  it("un carrito vacío (sin líneas) es válido", () => {
    const empty = {
      ...snapshot,
      lines: [],
      totals: { ...snapshot.totals, line_count: 0, item_count: 0, subtotal: 0, total: 0 },
    };
    expect(parseGuestMirror(mirror(empty))?.snapshot).toEqual(empty);
  });
});

describe("almacenamiento del navegador", () => {
  it("escribe y lee con la clave versionada, y lo manipulado se descarta al leer", () => {
    localStorage.clear();
    const storage = browserCartStorage();
    storage.write({ token: TOKEN, snapshot, savedAt: 9 });
    expect(localStorage.getItem(GUEST_CART_KEY)).not.toBeNull();
    expect(storage.read()?.token).toBe(TOKEN);
    localStorage.setItem(GUEST_CART_KEY, mirror({ ...snapshot, lines: [null] }));
    expect(storage.read()?.snapshot).toBeNull();
    storage.clear();
    expect(localStorage.getItem(GUEST_CART_KEY)).toBeNull();
    expect(storage.read()).toBeNull();
  });

  it("si localStorage lanza (modo privado, datos bloqueados) no rompe nada: degrada a «sin espejo»", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("bloqueado");
      },
    });
    try {
      const storage = browserCartStorage();
      expect(storage.read()).toBeNull();
      expect(() => storage.write({ token: TOKEN, snapshot: null, savedAt: 1 })).not.toThrow();
      expect(() => storage.clear()).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });

  it("la memoria de prueba guarda y borra", () => {
    const storage = memoryCartStorage();
    expect(storage.read()).toBeNull();
    storage.write({ token: TOKEN, snapshot: null, savedAt: 1 });
    expect(storage.read()?.token).toBe(TOKEN);
    storage.clear();
    expect(storage.read()).toBeNull();
  });
});

describe("parsePersistedPending (lo pendiente guardado)", () => {
  const good = { owner: "guest", pending: { a: 2, b: 0 }, savedAt: 5 };

  it("acepta lo bien formado, con cantidad 0 (quitar) y el tope 1000", () => {
    expect(parsePersistedPending(raw(good))).toEqual(good);
    expect(
      parsePersistedPending(raw({ ...good, owner: "user:3f2c-AA-9", pending: { v: 1000 } })),
    ).toEqual({ owner: "user:3f2c-AA-9", pending: { v: 1000 }, savedAt: 5 });
  });

  it("sin nada, JSON roto o algo que no es un objeto → null", () => {
    for (const value of [null, "", "{roto", "42", "null", "[]", '"texto"']) {
      expect(parsePersistedPending(value), String(value)).toBeNull();
    }
  });

  it("el dueño debe ser «guest» o «user:<id>» (sin espacios, sin vacío, de hasta 64 caracteres)", () => {
    for (const owner of [
      "",
      "admin",
      "user:",
      "user:a b",
      `user:${"x".repeat(65)}`,
      "Guest",
      7,
      null,
    ]) {
      expect(parsePersistedPending(raw({ ...good, owner })), JSON.stringify(owner)).toBeNull();
    }
    expect(
      parsePersistedPending(raw({ ...good, owner: `user:${"x".repeat(64)}` }))?.owner,
    ).toHaveLength(69);
  });

  it("una cantidad negativa, decimal, mayor de 1000 o que no es número descarta TODO", () => {
    for (const qty of [-1, 1.5, 1001, "2", null, true, [], {}]) {
      expect(
        parsePersistedPending(raw({ ...good, pending: { a: 2, b: qty } })),
        JSON.stringify(qty),
      ).toBeNull();
    }
    // un número que JSON.parse convierte en Infinity (1e999) tampoco pasa
    expect(parsePersistedPending('{"owner":"guest","pending":{"a":1e999},"savedAt":5}')).toBeNull();
  });

  it("claves inválidas (vacía, con espacios, demasiado larga, «__proto__») descartan todo", () => {
    for (const key of ["", "a b", "x".repeat(65), "a/b"]) {
      expect(
        parsePersistedPending(raw({ ...good, pending: { [key]: 1 } })),
        JSON.stringify(key),
      ).toBeNull();
    }
    expect(
      parsePersistedPending('{"owner":"guest","pending":{"__proto__":1},"savedAt":5}'),
    ).toBeNull();
    // 64 caracteres sí
    expect(
      parsePersistedPending(raw({ ...good, pending: { ["x".repeat(64)]: 1 } }))?.pending,
    ).toEqual({ ["x".repeat(64)]: 1 });
  });

  it("vacío o con más de 100 variantes → null; con 100 exactas, sí", () => {
    const many = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`v${i}`, 1]));
    expect(parsePersistedPending(raw({ ...good, pending: {} }))).toBeNull();
    expect(parsePersistedPending(raw({ ...good, pending: [] }))).toBeNull();
    expect(parsePersistedPending(raw({ ...good, pending: many(101) }))).toBeNull();
    expect(
      Object.keys(parsePersistedPending(raw({ ...good, pending: many(100) }))!.pending),
    ).toHaveLength(100);
  });

  it("la hora debe ser un número", () => {
    for (const savedAt of ["5", null, undefined, {}, [1]]) {
      expect(parsePersistedPending(raw({ ...good, savedAt })), String(savedAt)).toBeNull();
    }
    const { savedAt: _omit, ...withoutTime } = good;
    void _omit;
    expect(parsePersistedPending(raw(withoutTime))).toBeNull();
  });
});

describe("isPendingFresh", () => {
  const now = 10_000_000;
  it("vale hasta 24 h exactas y ni un milisegundo más", () => {
    expect(PENDING_TTL_MS).toBe(86_400_000);
    expect(isPendingFresh(now - 86_400_000, now)).toBe(true);
    expect(isPendingFresh(now - 86_400_001, now)).toBe(false);
    expect(isPendingFresh(now, now)).toBe(true);
  });
  it("tolera un reloj adelantado hasta 60 s; más allá se descarta", () => {
    expect(isPendingFresh(now + 60_000, now)).toBe(true);
    expect(isPendingFresh(now + 60_001, now)).toBe(false);
  });
});

describe("almacenamiento de lo pendiente", () => {
  it("el navegador escribe y lee con su clave versionada, borra, y lo manipulado se descarta al leer", () => {
    localStorage.clear();
    const storage = browserCartStorage();
    const value = { owner: "user:u1", pending: { a: 3 }, savedAt: 9 };
    expect(storage.readPending()).toBeNull();
    storage.writePending(value);
    expect(localStorage.getItem(PENDING_KEY)).toBe(JSON.stringify(value));
    expect(storage.readPending()).toEqual(value);
    localStorage.setItem(PENDING_KEY, JSON.stringify({ ...value, pending: { a: -3 } }));
    expect(storage.readPending()).toBeNull();
    storage.writePending(value);
    storage.clearPending();
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    // el espejo del invitado y lo pendiente viven en claves distintas y no se pisan
    storage.write({ token: TOKEN, snapshot: null, savedAt: 1 });
    storage.writePending(value);
    storage.clear();
    expect(storage.readPending()).toEqual(value);
    expect(localStorage.getItem(GUEST_CART_KEY)).toBeNull();
  });

  it("si localStorage lanza (modo privado, datos bloqueados) no rompe nada", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("bloqueado");
      },
    });
    try {
      const storage = browserCartStorage();
      expect(storage.readPending()).toBeNull();
      expect(() =>
        storage.writePending({ owner: "guest", pending: { a: 1 }, savedAt: 1 }),
      ).not.toThrow();
      expect(() => storage.clearPending()).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });

  it("la memoria de prueba guarda una COPIA (cambiar el original después no altera lo guardado) y borra", () => {
    const storage = memoryCartStorage();
    const pending = { a: 1 };
    storage.writePending({ owner: "guest", pending, savedAt: 1 });
    pending.a = 99;
    expect(storage.readPending()?.pending).toEqual({ a: 1 });
    storage.clearPending();
    expect(storage.readPending()).toBeNull();
    expect(
      memoryCartStorage(null, { owner: "guest", pending: { z: 2 }, savedAt: 1 }).readPending()
        ?.pending,
    ).toEqual({ z: 2 });
  });
});
