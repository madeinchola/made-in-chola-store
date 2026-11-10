import { describe, expect, it, vi } from "vitest";
import type { FunctionResult } from "@/lib/functions";
import { type CartApi, type CartEvent, CartStore } from "./cartStore";
import { memoryCartStorage, PENDING_TTL_MS, type PersistedPending } from "./storage";
import type { CartLine, CartRequestBody, CartResponse, CartSnapshot } from "./types";

const TOKEN = `ct_${"A".repeat(43)}`;
const NEW_TOKEN = `ct_${"B".repeat(43)}`;
const NOW = Date.parse("2026-11-03T12:00:00.000Z");

function line(variantId: string, qty: number, extra: Partial<CartLine> = {}): CartLine {
  return {
    variant_id: variantId,
    product_id: `p-${variantId}`,
    name: `Producto ${variantId}`,
    slug: `producto-${variantId}`,
    sku: null,
    color_name: null,
    color_hex: null,
    size_label: null,
    image_path: null,
    qty,
    billable_qty: qty,
    available: 10,
    status: "ok",
    blocking: false,
    price_notice: null,
    unit_price: 100,
    price_at_add: 100,
    current_price: 100,
    price_locked_until: "2026-11-10T12:00:00.000Z",
    line_total: 100 * qty,
    reserved_qty: qty,
    reservation_expires_at: "2026-11-03T12:10:00.000Z",
    ...extra,
  };
}

function snapshot(lines: CartLine[], extra: Partial<CartSnapshot> = {}): CartSnapshot {
  const items = lines.reduce((n, l) => n + l.qty, 0);
  const subtotal = lines.reduce((n, l) => n + l.line_total, 0);
  return {
    cart_id: "cart-1",
    status: "active",
    currency: "BOB",
    reserve_on_add: true,
    ttl_seconds: 600,
    guarantee_days: 7,
    limits: { max_qty_per_variant: 10, max_lines: 30, max_units: 30 },
    lines,
    totals: {
      subtotal,
      item_count: items,
      line_count: lines.length,
      shipping: null,
      discount: null,
      total: subtotal,
    },
    reservation: {
      state: lines.length ? "held" : "none",
      expires_at: lines.length ? "2026-11-03T12:10:00.000Z" : null,
    },
    can_checkout: lines.length > 0,
    ...extra,
  };
}

function ok(
  cart: CartSnapshot | null,
  extra: Partial<CartResponse> = {},
): FunctionResult<CartResponse> {
  return {
    ok: true,
    data: {
      token_state: cart ? "ok" : "none",
      server_time: new Date(NOW).toISOString(),
      cart,
      ...extra,
    },
  };
}
const fail = (status: number, code = "x", retryAfter?: number): FunctionResult<CartResponse> => ({
  ok: false,
  status,
  code,
  message: code,
  ...(retryAfter ? { retryAfter } : {}),
});

function fakeApi() {
  const calls: { body: CartRequestBody; resolve: (r: FunctionResult<CartResponse>) => void }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const api: CartApi = {
    request(body) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) =>
        calls.push({
          body,
          resolve: (r) => {
            inFlight--;
            resolve(r);
          },
        }),
      );
    },
  };
  return { api, calls, maxInFlight: () => maxInFlight };
}

function fakeTimers() {
  const timers: { fn: () => void; ms: number; id: number; live: boolean }[] = [];
  return {
    setTimer: (fn: () => void, ms: number) => {
      const t = { fn, ms, id: timers.length, live: true };
      timers.push(t);
      return t.id;
    },
    clearTimer: (h: unknown) => {
      const t = timers[h as number];
      if (t) t.live = false;
    },
    live: () => timers.filter((t) => t.live),
    runNext() {
      const t = timers.find((x) => x.live);
      if (!t) throw new Error("no hay temporizador");
      t.live = false;
      t.fn();
    },
  };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Responde a TODAS las peticiones, también a las que se van encolando detrás (el almacén manda una a la vez: una segunda
 * no sale hasta que la primera se resuelve). Sin esto, contar peticiones no distingue «se evitó» de «aún no salió».
 */
async function drain(
  calls: { body: CartRequestBody; resolve: (r: FunctionResult<CartResponse>) => void }[],
  respond: (body: CartRequestBody) => FunctionResult<CartResponse>,
): Promise<void> {
  let i = 0;
  while (i < 40) {
    await tick(); // deja correr las promesas: la siguiente petición encolada sale AHORA
    const call = calls[i];
    if (!call) break;
    call.resolve(respond(call.body));
    i++;
  }
  await tick();
}
const refreshes = (calls: { body: CartRequestBody }[]) =>
  calls.filter((c) => c.body.action === "refresh").length;

function setup(
  opts: {
    mirror?: boolean;
    events?: CartEvent[];
    saved?: PersistedPending;
    /** Reutiliza un almacenamiento (simula recargar la página: otro almacén, mismo navegador). */
    storage?: ReturnType<typeof memoryCartStorage>;
  } = {},
) {
  const f = fakeApi();
  const timers = fakeTimers();
  const storage =
    opts.storage ??
    memoryCartStorage(
      opts.mirror ? { token: TOKEN, snapshot: snapshot([line("a", 1)]), savedAt: 1 } : null,
      opts.saved ?? null,
    );
  const channel = { posted: 0, handler: null as null | (() => void) };
  const store = new CartStore({
    api: f.api,
    storage,
    now: () => NOW,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onEvent: (e) => opts.events?.push(e),
    channel: {
      post: () => {
        channel.posted++;
      },
      subscribe: (h) => {
        channel.handler = h;
        return () => {
          channel.handler = null;
        };
      },
    },
  });
  return { ...f, timers, storage, store, channel };
}

describe("identidad", () => {
  it("invitado sin token: carga vacía al instante y NO hace ninguna petición", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "guest" });
    await tick();
    expect(store.getState().loaded).toBe(true);
    expect(store.getState().snapshot).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("invitado sin token: volver a «leer» no cambia nada ni avisa a la pantalla (no se repinta por no hacer nada)", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "guest" });
    const before = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);
    await store.refetch();
    await tick();
    expect(listener).not.toHaveBeenCalled();
    expect(store.getState()).toBe(before); // ni siquiera un objeto de estado nuevo
    expect(calls).toHaveLength(0);
  });

  it("invitado con espejo local: lo pinta al instante y luego el servidor lo reemplaza", async () => {
    const { store, calls } = setup({ mirror: true });
    store.setIdentity({ kind: "guest" });
    expect(store.getState().snapshot?.lines.map((l) => l.variant_id)).toEqual(["a"]);
    await tick();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ action: "get", cart_token: TOKEN });
    calls[0]?.resolve(ok(snapshot([line("a", 1), line("b", 2)])));
    await tick();
    expect(store.getState().snapshot?.lines.map((l) => l.variant_id)).toEqual(["a", "b"]);
  });

  it("un usuario con sesión consulta sin token, no usa el espejo y no guarda nada en el equipo", async () => {
    const { store, calls, storage } = setup({ mirror: true });
    store.setIdentity({ kind: "user", userId: "u1" });
    expect(store.getState().snapshot).toBeNull(); // no hereda el espejo del invitado
    expect(store.getState().loaded).toBe(false);
    await tick();
    expect(calls[0]?.body).toEqual({ action: "get" }); // sin cart_token
    const before = storage.read();
    calls[0]?.resolve(ok(snapshot([line("z", 1)])));
    await tick();
    expect(storage.read()).toEqual(before); // el equipo no guarda el carrito del usuario
    expect(store.getState().snapshot?.lines[0]?.variant_id).toBe("z");
  });

  it("cambiar de identidad descarta la respuesta que volvía tarde (sin contaminar la nueva)", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    expect(calls).toHaveLength(1);
    store.setIdentity({ kind: "user", userId: "u2" }); // otro usuario en el mismo equipo
    expect(store.getState().snapshot).toBeNull();
    calls[0]?.resolve(ok(snapshot([line("de-u1", 3)]))); // llega tarde la respuesta del usuario 1
    await tick();
    expect(store.getState().snapshot).toBeNull();
    expect(store.getState().loaded).toBe(false);
  });

  it("la misma identidad dos veces no repite nada", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    expect(calls).toHaveLength(1);
  });
});

describe("cantidades", () => {
  it("el cambio se ve al instante (pendiente) y el servidor lo confirma y reemplaza la foto", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([line("a", 1)])));
    await tick();
    store.setQty("a", 4);
    expect(store.getState().pending).toEqual({ a: 4 });
    await tick();
    expect(calls[1]?.body).toEqual({ action: "set_item", variant_id: "a", qty: 4 });
    calls[1]?.resolve(ok(snapshot([line("a", 4)]), { outcome: "ok", requested: 4, applied: 4 }));
    await tick();
    expect(store.getState().pending).toEqual({});
    expect(store.getState().snapshot?.lines[0]?.qty).toBe(4);
    expect(store.getState().snapshot?.totals.subtotal).toBe(400);
  });

  it("diez clics seguidos son UNA petición con la cantidad final", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([])));
    await tick();
    for (let n = 1; n <= 10; n++) store.setQty("a", n);
    await tick();
    const writes = calls.filter((c) => c.body.action === "set_item");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body).toMatchObject({ qty: 10 });
  });

  it("un clic mientras vuela la petición: se envía otra con el valor nuevo y al final no queda nada pendiente", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([])));
    await tick();
    store.setQty("a", 2);
    await tick(); // la petición con 2 está en vuelo
    store.setQty("a", 3);
    expect(store.getState().pending).toEqual({ a: 3 });
    calls[1]?.resolve(ok(snapshot([line("a", 2)])));
    await tick();
    expect(store.getState().pending).toEqual({ a: 3 }); // sigue pendiente: el servidor aún no sabe del 3
    expect(calls[2]?.body).toMatchObject({ action: "set_item", qty: 3 });
    calls[2]?.resolve(ok(snapshot([line("a", 3)])));
    await tick();
    expect(store.getState().pending).toEqual({});
    expect(store.getState().snapshot?.lines[0]?.qty).toBe(3);
  });

  it("nunca hay dos peticiones a la vez, aunque se mezclen lecturas y escrituras de varias variantes", async () => {
    const f = setup();
    f.store.setIdentity({ kind: "user", userId: "u1" });
    f.store.setQty("a", 1);
    f.store.setQty("b", 2);
    void f.store.refetch(); // se funde con la lectura inicial que aún espera su turno (no se pide dos veces)
    void f.store.acceptPrices();
    await drain(f.calls, () => ok(snapshot([])));
    void f.store.refetch(); // ya no hay ninguna en cola: esta sí es una lectura nueva
    await drain(f.calls, () => ok(snapshot([])));
    expect(f.maxInFlight()).toBe(1);
    // Orden: la lectura inicial, luego a, luego b, luego aceptar precios y al final la lectura nueva.
    expect(f.calls.map((c) => c.body.action)).toEqual([
      "get",
      "set_item",
      "set_item",
      "accept_prices",
      "get",
    ]);
    expect(
      f.calls
        .filter((c) => c.body.action === "set_item")
        .map((c) => (c.body as { variant_id: string }).variant_id),
    ).toEqual(["a", "b"]);
  });

  it("limita la cantidad a 0–1000 y a enteros (NaN y negativos cuentan 0, 2,7 es 2)", () => {
    const { store } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    store.setQty("a", -5);
    expect(store.getState().pending.a).toBe(0);
    store.setQty("a", 5000);
    expect(store.getState().pending.a).toBe(1000);
    store.setQty("a", Number.NaN);
    expect(store.getState().pending.a).toBe(0);
    store.setQty("a", 2.7);
    expect(store.getState().pending.a).toBe(2);
  });

  it("avisa cuando el servidor ajusta la cantidad y lo quita en cuanto es 'ok' o se vuelve a cambiar", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([])));
    await tick();
    store.setQty("a", 5);
    await tick();
    calls[1]?.resolve(
      ok(snapshot([line("a", 3)]), { outcome: "adjusted", requested: 5, applied: 3 }),
    );
    await tick();
    expect(store.getState().results.a).toEqual({ outcome: "adjusted", requested: 5, applied: 3 });
    store.setQty("a", 2); // cambiar de nuevo limpia el aviso anterior
    expect(store.getState().results.a).toBeUndefined();
    await tick();
    calls[2]?.resolve(ok(snapshot([line("a", 2)]), { outcome: "ok", requested: 2, applied: 2 }));
    await tick();
    expect(store.getState().results.a).toBeUndefined();
  });

  it("agotado: el aviso queda y la línea no aparece", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([])));
    await tick();
    store.setQty("a", 1);
    await tick();
    calls[1]?.resolve(ok(snapshot([]), { outcome: "out_of_stock", requested: 1, applied: 0 }));
    await tick();
    expect(store.getState().results.a?.outcome).toBe("out_of_stock");
    expect(store.getState().snapshot?.lines).toEqual([]);
    expect(store.getState().pending).toEqual({});
  });
});

describe("token de invitado", () => {
  it("guarda el token que emite el servidor y lo manda en las siguientes peticiones", async () => {
    const { store, calls, storage } = setup();
    store.setIdentity({ kind: "guest" });
    store.setQty("a", 1);
    await tick();
    expect(calls[0]?.body).toEqual({ action: "set_item", variant_id: "a", qty: 1 }); // aún sin token
    calls[0]?.resolve(
      ok(snapshot([line("a", 1)]), { cart_token: NEW_TOKEN, token_minted: true, outcome: "ok" }),
    );
    await tick();
    expect(storage.read()?.token).toBe(NEW_TOKEN);
    expect(storage.read()?.snapshot?.lines).toHaveLength(1);
    store.setQty("a", 2);
    await tick();
    expect(calls[1]?.body).toEqual({
      action: "set_item",
      variant_id: "a",
      qty: 2,
      cart_token: NEW_TOKEN,
    });
  });

  it("un token ya fusionado o abandonado ('retired') se borra del equipo y el carrito queda vacío", async () => {
    const { store, calls, storage } = setup({ mirror: true });
    store.setIdentity({ kind: "guest" });
    await tick();
    calls[0]?.resolve({
      ok: true,
      data: { token_state: "retired", server_time: new Date(NOW).toISOString(), cart: null },
    });
    await tick();
    expect(storage.read()).toBeNull();
    expect(store.getState().snapshot).toBeNull();
  });
});

describe("sin conexión y errores", () => {
  it("sin red conserva lo pendiente, avisa y reintenta con espera creciente (2 s, 4 s … tope 30 s)", async () => {
    const { store, calls, timers } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([])));
    await tick();
    store.setQty("a", 2);
    await tick();
    calls[1]?.resolve(fail(0, "network"));
    await tick();
    expect(store.getState().sync.state).toBe("offline");
    expect(store.getState().pending).toEqual({ a: 2 });
    expect(timers.live().map((t) => t.ms)).toEqual([2000]);

    timers.runNext(); // reintento 1 → falla otra vez
    await tick();
    calls[2]?.resolve(fail(0, "network"));
    await tick();
    expect(timers.live().map((t) => t.ms)).toEqual([4000]);

    timers.runNext(); // reintento 2 → ahora sí
    await tick();
    expect(calls[3]?.body).toMatchObject({ action: "set_item", qty: 2 });
    calls[3]?.resolve(ok(snapshot([line("a", 2)]), { outcome: "ok" }));
    await tick();
    expect(store.getState().pending).toEqual({});
    expect(store.getState().sync.state).toBe("idle");
  });

  it("la espera crece 2, 4, 8, 16 y se detiene en 30 s", async () => {
    const { store, calls, timers } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([])));
    await tick();
    store.setQty("a", 1);
    const waits: number[] = [];
    for (let i = 1; i <= 6; i++) {
      await tick();
      calls[i]?.resolve(fail(0, "network"));
      await tick();
      waits.push(timers.live()[0]?.ms ?? -1);
      timers.runNext();
    }
    expect(waits).toEqual([2000, 4000, 8000, 16000, 30000, 30000]); // 32 s se recorta a 30 s
  });

  it("'retryNow' (vuelve la red) reintenta sin esperar y reinicia la espera", async () => {
    const { store, calls, timers } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([])));
    await tick();
    store.setQty("a", 1);
    await tick();
    calls[1]?.resolve(fail(0, "network"));
    await tick();
    expect(timers.live()).toHaveLength(1);
    store.retryNow();
    expect(timers.live()).toHaveLength(0); // se canceló la espera
    await tick();
    expect(calls.filter((c) => c.body.action === "set_item")).toHaveLength(2);
  });

  it("límite de tasa (429): espera lo que dice el servidor, no menos", async () => {
    const { store, calls, timers } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([])));
    await tick();
    store.setQty("a", 1);
    await tick();
    calls[1]?.resolve(fail(429, "rate_limited", 45));
    await tick();
    expect(store.getState().sync).toMatchObject({
      state: "error",
      code: "rate_limited",
      retryAfter: 45,
    });
    expect(timers.live().map((t) => t.ms)).toEqual([45_000]);
    expect(store.getState().pending).toEqual({ a: 1 });
  });

  it("sesión vencida (401): se conserva lo pendiente y NO se reintenta en bucle", async () => {
    const { store, calls, timers } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([])));
    await tick();
    store.setQty("a", 1);
    await tick();
    calls[1]?.resolve(fail(401, "invalid_session"));
    await tick();
    expect(store.getState().sync).toMatchObject({ state: "error", code: "session" });
    expect(store.getState().pending).toEqual({ a: 1 });
    expect(timers.live()).toHaveLength(0);
  });

  it("un error sin remedio (400) descarta ESE cambio y sigue con los demás", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([])));
    await tick();
    store.setQty("a", 1);
    store.setQty("b", 2);
    await tick();
    calls[1]?.resolve(fail(400, "invalid_request")); // a es inválido
    await tick();
    expect(calls[2]?.body).toMatchObject({ action: "set_item", variant_id: "b", qty: 2 });
    calls[2]?.resolve(ok(snapshot([line("b", 2)]), { outcome: "ok" }));
    await tick();
    expect(store.getState().pending).toEqual({});
    expect(store.getState().snapshot?.lines.map((l) => l.variant_id)).toEqual(["b"]);
  });
});

describe("quitar y deshacer", () => {
  it("quitar deja la cantidad en 0 al instante, recuerda qué se quitó y emite el evento", async () => {
    const events: CartEvent[] = [];
    const { store, calls } = setup({ events });
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([line("a", 3)])));
    await tick();
    store.remove("a");
    expect(store.getState().pending).toEqual({ a: 0 });
    expect(store.getState().lastRemoved).toEqual({ variantId: "a", qty: 3, name: "Producto a" });
    expect(events).toEqual([
      {
        type: "removed",
        line: expect.objectContaining({ variant_id: "a" }),
        quantity: 3,
        currency: "BOB",
      },
    ]);
  });

  it("deshacer devuelve la cantidad original y sobrevive a tocar OTRAS líneas; cambiar la MISMA línea lo invalida", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([line("a", 3), line("b", 1), line("c", 1)])));
    await tick();
    store.remove("a");
    store.undoRemove();
    expect(store.getState().pending).toEqual({ a: 3 });
    expect(store.getState().lastRemoved).toBeNull();
    // Se quita b y luego se cambia c (otra línea): el «Deshacer» de b sigue disponible.
    store.remove("b");
    store.setQty("c", 4);
    expect(store.getState().lastRemoved).toMatchObject({ variantId: "b", qty: 1 });
    // Cambiar la propia b (la que se podía deshacer) lo invalida.
    store.setQty("b", 2);
    expect(store.getState().lastRemoved).toBeNull();
    // Quitar otra línea REEMPLAZA lo deshacible (un solo nivel de deshacer).
    store.remove("c");
    expect(store.getState().lastRemoved).toMatchObject({ variantId: "c" });
  });

  it("quitar algo que no está en el carrito no hace nada", () => {
    const { store } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    store.remove("fantasma");
    expect(store.getState().pending).toEqual({});
    expect(store.getState().lastRemoved).toBeNull();
  });

  it("vaciar limpia lo pendiente y pide vaciar al servidor", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([line("a", 1)])));
    await tick();
    void store.clear();
    expect(store.getState().pending).toEqual({});
    await tick();
    expect(calls[1]?.body).toEqual({ action: "clear" });
    calls[1]?.resolve(ok(snapshot([])));
    await tick();
    expect(store.getState().snapshot?.lines).toEqual([]);
  });
});

describe("fusión al iniciar sesión", () => {
  it("manda el token UNA vez, deja el equipo limpio, avisa lo fusionado y vuelve a leer el carrito del usuario", async () => {
    const { store, calls, storage } = setup({ mirror: true });
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([]))); // la lectura inicial del usuario
    await tick();
    void store.mergeGuest("u1");
    await tick();
    expect(calls[1]?.body).toEqual({ action: "merge", cart_token: TOKEN });
    calls[1]?.resolve({
      ok: true,
      data: {
        token_state: "merged",
        server_time: new Date(NOW).toISOString(),
        cart: snapshot([line("a", 1), line("b", 2)]),
        merged: true,
        merged_lines: 2,
        adjusted_lines: 1,
        skipped_lines: 0,
      },
    });
    await tick();
    expect(storage.read()).toBeNull(); // sin token ni espejo del invitado
    expect(store.getState().mergeReport).toEqual({ merged: 2, adjusted: 1, skipped: 0 });
    await tick();
    expect(calls[2]?.body).toEqual({ action: "get" }); // relectura final, sin token
    calls[2]?.resolve(ok(snapshot([line("a", 1), line("b", 2)])));
    await tick();
    expect(store.getState().snapshot?.totals.item_count).toBe(3);
  });

  it("sin carrito de invitado no hace ninguna petición de fusión (idempotente)", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([])));
    await tick();
    await store.mergeGuest("u1");
    await tick();
    expect(calls.filter((c) => c.body.action === "merge")).toHaveLength(0);
  });

  it("si la fusión falla por falta de red, el token se conserva para reintentar luego", async () => {
    const { store, calls, storage } = setup({ mirror: true });
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([])));
    await tick();
    void store.mergeGuest("u1");
    await tick();
    calls[1]?.resolve(fail(0, "network"));
    await tick();
    expect(storage.read()?.token).toBe(TOKEN);
    expect(store.getState().mergeReport).toBeNull();
  });

  it("una respuesta de fusión que no es del carrito se trata como error: el token se CONSERVA para reintentar", async () => {
    const { store, calls, storage } = setup({ mirror: true });
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([])));
    await tick();
    void store.mergeGuest("u1");
    await tick();
    expect(calls[1]?.body).toEqual({ action: "merge", cart_token: TOKEN });
    calls[1]?.resolve({ ok: true, data: null as unknown as CartResponse });
    await tick();
    expect(storage.read()?.token).toBe(TOKEN); // no se borró: la fusión no se confirmó
    expect(store.getState().mergeReport).toBeNull();
    expect(store.getState().sync.state).toBe("error");
  });

  it("sin bolsa de invitado NO espera a la lectura en vuelo: el inicio de sesión no se retrasa por una función lenta", async () => {
    const { store } = setup(); // sin espejo: no hay token de invitado
    store.setIdentity({ kind: "user", userId: "u1" }); // la lectura de su bolsa sale y NO se contesta (función lenta)
    await tick();
    const outcome = await Promise.race([
      store.mergeGuest("u1").then(() => "resuelta"),
      new Promise<string>((resolve) => setTimeout(() => resolve("bloqueada"), 50)),
    ]);
    expect(outcome).toBe("resuelta");
  });

  it("fusionar para otro usuario distinto del actual no hace nada", async () => {
    const { store, calls } = setup({ mirror: true });
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([])));
    await tick();
    await store.mergeGuest("otro");
    await tick();
    expect(calls.filter((c) => c.body.action === "merge")).toHaveLength(0);
  });

  it("no avisa de nada si no se fusionó ninguna línea", async () => {
    const { store, calls } = setup({ mirror: true });
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([])));
    await tick();
    void store.mergeGuest("u1");
    await tick();
    calls[1]?.resolve({
      ok: true,
      data: {
        token_state: "merged",
        server_time: new Date(NOW).toISOString(),
        cart: snapshot([]),
        merged: true,
        merged_lines: 0,
        adjusted_lines: 0,
        skipped_lines: 0,
      },
    });
    await tick();
    expect(store.getState().mergeReport).toBeNull();
  });
});

describe("retención, reloj y otras pestañas", () => {
  it("al vencer la retención reintenta UNA vez por vencimiento", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([line("a", 1)])));
    await tick();
    // La retención renovada que devuelve el servidor tiene OTRA hora de vencimiento (12:20).
    const renewed = snapshot([line("a", 1)], {
      reservation: { state: "held", expires_at: "2026-11-03T12:20:00.000Z" },
    });
    void store.reservationExpired();
    void store.reservationExpired();
    void store.reservationExpired();
    await drain(calls, () => ok(renewed));
    expect(refreshes(calls)).toBe(1); // tres avisos del mismo vencimiento = una sola petición
    // Al vencer la retención NUEVA (otra hora) sí vuelve a intentarlo, también una sola vez.
    void store.reservationExpired();
    void store.reservationExpired();
    await drain(calls, () => ok(renewed));
    expect(refreshes(calls)).toBe(2);
  });

  it("calcula el desfase con el reloj del servidor (servidor 10 s por delante → +10000 ms)", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve({
      ok: true,
      data: {
        token_state: "ok",
        server_time: new Date(NOW + 10_000).toISOString(),
        cart: snapshot([]),
      },
    });
    await tick();
    expect(store.getState().clockOffsetMs).toBe(10_000);
  });

  it("avisa a las otras pestañas tras una escritura (no tras una lectura) y relee cuando otra avisa", async () => {
    const { store, calls, channel } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([])));
    await tick();
    expect(channel.posted).toBe(0); // una lectura no avisa
    store.setQty("a", 1);
    await tick();
    calls[1]?.resolve(ok(snapshot([line("a", 1)]), { outcome: "ok" }));
    await tick();
    expect(channel.posted).toBe(1);
    channel.handler?.(); // otra pestaña cambió algo
    await tick();
    expect(calls[2]?.body).toEqual({ action: "get" });
  });

  it("'refetchIfStale' no repite la consulta si se hizo hace poco", async () => {
    const f = fakeApi();
    let now = NOW;
    const store = new CartStore({ api: f.api, storage: memoryCartStorage(), now: () => now });
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    f.calls[0]?.resolve(ok(snapshot([])));
    await tick();
    store.refetchIfStale();
    await tick();
    expect(f.calls).toHaveLength(1);
    now += 31_000;
    store.refetchIfStale();
    await tick();
    expect(f.calls).toHaveLength(2);
  });

  it("'destroy' no deja temporizadores ni suscripciones", () => {
    const { store, channel, timers } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    const listener = vi.fn();
    store.subscribe(listener);
    store.destroy();
    expect(channel.handler).toBeNull();
    expect(timers.live()).toHaveLength(0);
  });
});

describe("reintentar la reserva a mano", () => {
  it("el clic de la persona pide la reserva CADA vez; la llamada automática al vencer, una sola por vencimiento", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    // Retención incompleta (parcial): sin hora de vencimiento, así que la clave del almacén es siempre la misma.
    const partial = snapshot([line("a", 3)], {
      reservation: { state: "expired", expires_at: null },
    });
    calls[0]?.resolve(ok(partial));
    await tick();
    void store.retryReservation();
    void store.retryReservation();
    void store.retryReservation();
    await drain(calls, () => ok(partial));
    expect(refreshes(calls)).toBe(3); // tres clics = tres peticiones (la guarda no las come)
    // La automática, en cambio, no se repite con el mismo vencimiento.
    void store.reservationExpired();
    void store.reservationExpired();
    await drain(calls, () => ok(partial));
    expect(refreshes(calls)).toBe(4);
  });
});

describe("lo pendiente sobrevive a una recarga (guardado en el navegador)", () => {
  const saved = (
    pending: Record<string, number>,
    owner = "user:u1",
    savedAt = NOW - 1000,
  ): PersistedPending => ({ owner, pending, savedAt });

  it("cada cambio se guarda con su dueño y la hora, y al confirmarlo el servidor se borra", async () => {
    const { store, calls, storage } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([])));
    await tick();
    store.setQty("a", 2);
    expect(storage.readPending()).toEqual({ owner: "user:u1", pending: { a: 2 }, savedAt: NOW });
    await tick();
    expect(calls[1]?.body).toMatchObject({ action: "set_item", variant_id: "a", qty: 2 });
    calls[1]?.resolve(ok(snapshot([line("a", 2)])));
    await tick();
    expect(store.getState().pending).toEqual({});
    expect(storage.readPending()).toBeNull();
  });

  it("el invitado guarda con el dueño «guest»", async () => {
    const { store, storage } = setup();
    store.setIdentity({ kind: "guest" });
    store.setQty("b", 4);
    expect(storage.readPending()).toEqual({ owner: "guest", pending: { b: 4 }, savedAt: NOW });
  });

  it("mientras no se sabe quién es (identidad desconocida) no se guarda nada", () => {
    const { store, storage } = setup();
    store.setQty("a", 1);
    expect(storage.readPending()).toBeNull();
  });

  it("tras recargar sin conexión, lo pendiente reaparece y se envía DESPUÉS de leer la bolsa", async () => {
    const first = setup();
    first.store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    first.calls[0]?.resolve(fail(0, "network")); // la lectura inicial ya falló: sin conexión
    await tick();
    first.store.setQty("a", 3);
    await tick();
    first.calls[1]?.resolve(fail(0, "network")); // y el envío también
    await tick();
    expect(first.storage.readPending()?.pending).toEqual({ a: 3 });

    // «Recarga»: otro almacén, el mismo navegador.
    const second = setup({ storage: first.storage });
    second.store.setIdentity({ kind: "user", userId: "u1" });
    expect(second.store.getState().pending).toEqual({ a: 3 }); // se ve al instante
    await tick();
    expect(second.calls.map((c) => c.body.action)).toEqual(["get"]); // la lectura va primero en la cola
    second.calls[0]?.resolve(ok(snapshot([])));
    await tick();
    expect(second.calls.map((c) => c.body.action)).toEqual(["get", "set_item"]);
    expect(second.calls[1]?.body).toMatchObject({ variant_id: "a", qty: 3 });
    second.calls[1]?.resolve(ok(snapshot([line("a", 3)])));
    await tick();
    expect(second.store.getState().pending).toEqual({});
    expect(second.storage.readPending()).toBeNull();
    expect(second.store.getState().snapshot?.lines[0]?.qty).toBe(3);
  });

  it("un invitado sin token (su primer «agregar» no llegó) lo reenvía sin leer nada antes", async () => {
    const { store, calls } = setup({ saved: saved({ a: 1 }, "guest") });
    store.setIdentity({ kind: "guest" });
    expect(store.getState().pending).toEqual({ a: 1 });
    await tick();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ action: "set_item", variant_id: "a", qty: 1 });
  });

  it("lo guardado por OTRO dueño no se restaura y se borra (otro usuario, o invitado vs. usuario)", async () => {
    for (const owner of ["user:u2", "guest"]) {
      const { store, calls, storage } = setup({ saved: saved({ a: 3 }, owner) });
      store.setIdentity({ kind: "user", userId: "u1" });
      expect(store.getState().pending, owner).toEqual({});
      expect(storage.readPending(), owner).toBeNull();
      await tick();
      expect(calls.map((c) => c.body.action)).toEqual(["get"]); // solo lee: no reenvía lo ajeno
    }
    const asGuest = setup({ saved: saved({ a: 3 }, "user:u1") });
    asGuest.store.setIdentity({ kind: "guest" });
    expect(asGuest.store.getState().pending).toEqual({});
    expect(asGuest.storage.readPending()).toBeNull();
  });

  it("vigencia: 24 h exactas todavía valen; un milisegundo más, no; el futuro lejano tampoco", async () => {
    const exactly = setup({ saved: saved({ a: 2 }, "user:u1", NOW - PENDING_TTL_MS) });
    exactly.store.setIdentity({ kind: "user", userId: "u1" });
    expect(exactly.store.getState().pending).toEqual({ a: 2 });

    const stale = setup({ saved: saved({ a: 2 }, "user:u1", NOW - PENDING_TTL_MS - 1) });
    stale.store.setIdentity({ kind: "user", userId: "u1" });
    expect(stale.store.getState().pending).toEqual({});
    expect(stale.storage.readPending()).toBeNull();

    const future = setup({ saved: saved({ a: 2 }, "user:u1", NOW + 3_600_000) });
    future.store.setIdentity({ kind: "user", userId: "u1" });
    expect(future.store.getState().pending).toEqual({});
  });

  it("cerrar sesión (usuario → invitado) borra lo pendiente del usuario: el equipo queda limpio", async () => {
    const { store, storage } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    store.setQty("a", 2);
    expect(storage.readPending()?.owner).toBe("user:u1");
    store.setIdentity({ kind: "guest" });
    expect(store.getState().pending).toEqual({});
    expect(storage.readPending()).toBeNull();
  });

  it("un error sin remedio (400) descarta ese cambio también de lo guardado", async () => {
    const { store, calls, storage } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([])));
    await tick();
    store.setQty("a", 2);
    await tick();
    calls[1]?.resolve(fail(400, "validation"));
    await tick();
    expect(store.getState().pending).toEqual({});
    expect(storage.readPending()).toBeNull();
  });

  it("con la sesión vencida (401) o sin red, lo pendiente se CONSERVA guardado", async () => {
    for (const status of [401, 0]) {
      const { store, calls, storage } = setup();
      store.setIdentity({ kind: "user", userId: "u1" });
      await tick();
      calls[0]?.resolve(ok(snapshot([])));
      await tick();
      store.setQty("a", 2);
      await tick();
      calls[1]?.resolve(fail(status, "x"));
      await tick();
      expect(storage.readPending()?.pending, String(status)).toEqual({ a: 2 });
    }
  });

  it("vaciar la bolsa borra lo guardado", async () => {
    const { store, storage } = setup();
    store.setIdentity({ kind: "guest" });
    store.setQty("a", 2);
    expect(storage.readPending()).not.toBeNull();
    void store.clear();
    expect(storage.readPending()).toBeNull();
  });

  it("varias variantes y una cantidad cero (quitar) se guardan tal cual", () => {
    const { store, storage } = setup();
    store.setIdentity({ kind: "guest" });
    store.setQty("a", 0);
    store.setQty("b", 5);
    expect(storage.readPending()?.pending).toEqual({ a: 0, b: 5 });
  });
});

describe("«reservando de nuevo» (reserving)", () => {
  async function loaded() {
    const f = setup();
    f.store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    f.calls[0]?.resolve(ok(snapshot([line("a", 1)])));
    await tick();
    return f;
  }

  it("está activo desde que se pide hasta que el servidor contesta, y se apaga al contestar", async () => {
    const { store, calls } = await loaded();
    expect(store.getState().reserving).toBe(false);
    void store.reservationExpired();
    expect(store.getState().reserving).toBe(true); // ya al encolar: no hay un instante «sin reservar ni reservando»
    await tick();
    expect(refreshes(calls)).toBe(1);
    expect(store.getState().reserving).toBe(true); // sigue mientras la petición vuela
    calls[1]?.resolve(ok(snapshot([line("a", 1)])));
    await tick();
    expect(store.getState().reserving).toBe(false);
  });

  it("también se apaga si la petición falla (sin red): no se queda «reservando» para siempre", async () => {
    const { store, calls } = await loaded();
    void store.retryReservation();
    await tick();
    calls[1]?.resolve(fail(0, "network"));
    await tick();
    expect(store.getState().reserving).toBe(false);
  });

  it("con dos pedidas seguidas sigue activo hasta que termina la ÚLTIMA", async () => {
    const { store, calls } = await loaded();
    void store.retryReservation();
    void store.retryReservation();
    await tick();
    calls[1]?.resolve(ok(snapshot([line("a", 1)])));
    await tick();
    expect(store.getState().reserving).toBe(true);
    calls[2]?.resolve(ok(snapshot([line("a", 1)])));
    await tick();
    expect(store.getState().reserving).toBe(false);
  });

  it("si cambia la identidad mientras vuela, la identidad nueva no hereda «reservando»", async () => {
    const { store, calls } = await loaded();
    void store.retryReservation();
    await tick();
    store.setIdentity({ kind: "user", userId: "u2" });
    expect(store.getState().reserving).toBe(false);
    calls[1]?.resolve(ok(snapshot([line("a", 1)]))); // respuesta tardía de la identidad anterior
    await tick();
    expect(store.getState().reserving).toBe(false);
    expect(store.getState().snapshot).toBeNull(); // y tampoco contamina la foto
  });

  it("tras disconnect()/connect() (StrictMode) no queda atascado en «reservando»", async () => {
    const { store, calls } = await loaded();
    void store.retryReservation();
    await tick();
    store.disconnect();
    calls[1]?.resolve(ok(snapshot([line("a", 1)])));
    await tick();
    store.connect();
    await tick();
    expect(store.getState().reserving).toBe(false);
  });
});

describe("errores del servidor y respuestas raras", () => {
  async function withPending() {
    const f = setup();
    f.store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    f.calls[0]?.resolve(ok(snapshot([])));
    await tick();
    f.store.setQty("a", 2);
    await tick();
    return f;
  }

  it("un 503 pasajero conserva el cambio y lo reintenta con espera creciente hasta que sale", async () => {
    const { store, calls, timers } = await withPending();
    calls[1]?.resolve(fail(503, "unavailable"));
    await tick();
    expect(store.getState().pending).toEqual({ a: 2 }); // no se pierde el «+» de la persona
    expect(store.getState().sync).toMatchObject({ state: "error", code: "unavailable" });
    expect(timers.live().map((t) => t.ms)).toEqual([2000]);
    timers.runNext();
    await tick();
    expect(calls[2]?.body).toMatchObject({ action: "set_item", variant_id: "a", qty: 2 });
    calls[2]?.resolve(ok(snapshot([line("a", 2)]), { outcome: "ok" }));
    await tick();
    expect(store.getState().pending).toEqual({});
    expect(store.getState().sync.state).toBe("idle");
    expect(store.getState().snapshot?.lines[0]?.qty).toBe(2);
  });

  it("un 500 y un 408 también se reintentan; un 400 NO (se descarta ese cambio)", async () => {
    for (const status of [500, 408]) {
      const { store, calls, timers } = await withPending();
      calls[1]?.resolve(fail(status, "x"));
      await tick();
      expect(store.getState().pending, `status ${status}`).toEqual({ a: 2 });
      expect(timers.live()).toHaveLength(1);
    }
    const { store, calls, timers } = await withPending();
    calls[1]?.resolve(fail(400, "invalid_request"));
    await tick();
    expect(store.getState().pending).toEqual({});
    expect(timers.live()).toHaveLength(0);
  });

  it("si el servidor insiste (5 reintentos seguidos con 503) deja de reintentar solo pero CONSERVA el cambio; «Reintentar» lo reenvía", async () => {
    const { store, calls, timers } = await withPending();
    calls[1]?.resolve(fail(503)); // intento 1 → reintento 1
    for (let n = 2; n <= 6; n++) {
      await tick();
      timers.runNext();
      await tick();
      calls[n]?.resolve(fail(503));
    }
    await tick();
    // 1 envío + 5 reintentos = 6 peticiones; tras la 6.ª ya no se agenda otra espera…
    expect(calls.filter((c) => c.body.action === "set_item")).toHaveLength(6);
    expect(timers.live()).toHaveLength(0);
    expect(store.getState().sync).toMatchObject({ state: "error", code: "x" });
    // …pero el cambio de la persona NO se perdió: sigue pendiente.
    expect(store.getState().pending).toEqual({ a: 2 });
    // «Reintentar» (retryNow) reinicia la cuenta y lo vuelve a enviar.
    store.retryNow();
    await drain(calls, () => ok(snapshot([line("a", 2)]), { outcome: "ok" }));
    expect(calls.filter((c) => c.body.action === "set_item")).toHaveLength(7);
    expect(store.getState().pending).toEqual({});
    expect(store.getState().snapshot?.lines[0]?.qty).toBe(2);
  });

  it("si la persona pide otra cantidad mientras vuela una petición que falla sin remedio, el valor NUEVO se conserva", async () => {
    const { store, calls } = await withPending(); // en vuelo: a = 2
    store.setQty("a", 5);
    calls[1]?.resolve(fail(400, "invalid_request")); // la de 2 falla definitivamente
    await tick();
    expect(store.getState().pending).toEqual({ a: 5 }); // el 5 no se pierde con el 2
    await tick();
    expect(calls[2]?.body).toMatchObject({ action: "set_item", qty: 5 });
  });

  it("un 200 con un cuerpo que no es del carrito no deja el estado «sincronizando» ni rompe: se trata como error del servidor", async () => {
    const { store, calls, timers } = await withPending();
    calls[1]?.resolve({ ok: true, data: null as unknown as CartResponse });
    await tick();
    expect(store.getState().sync.state).toBe("error");
    expect(store.getState().pending).toEqual({ a: 2 }); // se conserva y se reintenta
    expect(timers.live()).toHaveLength(1);
    expect(store.getState().snapshot?.lines).toEqual([]); // la foto no se corrompió
  });

  it("tras un 401 se reintenta solo cuando la sesión se renueva (y no antes)", async () => {
    const { store, calls, timers } = await withPending();
    calls[1]?.resolve(fail(401, "invalid_session"));
    await tick();
    expect(store.getState().sync).toMatchObject({ state: "error", code: "session" });
    expect(timers.live()).toHaveLength(0);
    store.sessionRefreshed();
    await drain(calls, () => ok(snapshot([line("a", 2)]), { outcome: "ok" }));
    expect(calls.filter((c) => c.body.action === "set_item")).toHaveLength(2); // el cambio se reenvió
    expect(calls[2]?.body).toMatchObject({ action: "set_item", qty: 2 });
    expect(store.getState().pending).toEqual({});
    // Sin un 401 pendiente, renovar la sesión NO dispara nada (ni lecturas ni escrituras).
    const before = calls.length;
    store.sessionRefreshed();
    await drain(calls, () => ok(snapshot([line("a", 2)])));
    expect(calls).toHaveLength(before);
  });
});

describe("aceptar precios", () => {
  it("con una variante manda el precio vigente que la persona está viendo (para que el servidor no acepte otro)", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([line("a", 2, { current_price: 120 })])));
    await tick();
    void store.acceptPrices("a");
    await tick();
    expect(calls[1]?.body).toEqual({
      action: "accept_prices",
      variant_id: "a",
      expected_price: 120,
    });
  });

  it("sin variante (aceptar todo) no manda precio esperado, y si el vigente es desconocido tampoco", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([line("a", 2, { current_price: null })])));
    await tick();
    void store.acceptPrices();
    await tick();
    expect(calls[1]?.body).toEqual({ action: "accept_prices" });
    calls[1]?.resolve(ok(snapshot([line("a", 2, { current_price: null })])));
    await tick();
    void store.acceptPrices("a");
    await tick();
    expect(calls[2]?.body).toEqual({ action: "accept_prices", variant_id: "a" });
  });
});

describe("lectura inicial y ciclo de vida", () => {
  it("si la primera lectura falla, la bolsa NO queda «cargada» (no se pinta como vacía)", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(fail(0, "network"));
    await tick();
    expect(store.getState().loaded).toBe(false);
    expect(store.getState().snapshot).toBeNull();
    expect(store.getState().sync.state).toBe("offline");
  });

  it("dos lecturas pedidas seguidas se funden en una sola petición", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    void store.refetch();
    void store.refetch();
    void store.refetch();
    await drain(calls, () => ok(snapshot([])));
    expect(calls.filter((c) => c.body.action === "get")).toHaveLength(1);
  });

  it("disconnect + connect (lo que hace React en desarrollo) NO deja sin cargar a quien tiene sesión", async () => {
    const { store, calls, channel } = setup();
    store.setIdentity({ kind: "user", userId: "u1" }); // lectura inicial en cola…
    store.disconnect(); // …React desmonta (StrictMode) y la descarta
    expect(channel.handler).toBeNull();
    await tick();
    expect(calls).toHaveLength(0);
    store.connect(); // …y vuelve a montar: debe leer la bolsa
    expect(channel.handler).not.toBeNull();
    await drain(calls, () => ok(snapshot([line("a", 2)])));
    expect(calls.filter((c) => c.body.action === "get")).toHaveLength(1);
    expect(store.getState().snapshot?.lines).toHaveLength(1);
    expect(store.getState().loaded).toBe(true);
  });

  it("connect reenvía lo pendiente que un disconnect dejó sin enviar", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await drain(calls, () => ok(snapshot([])));
    store.setQty("a", 3);
    store.disconnect();
    await tick();
    expect(calls.filter((c) => c.body.action === "set_item")).toHaveLength(0);
    store.connect();
    await drain(calls, () => ok(snapshot([line("a", 3)]), { outcome: "ok" }));
    expect(calls.filter((c) => c.body.action === "set_item")).toHaveLength(1);
    expect(store.getState().pending).toEqual({});
  });
});

describe("agregar a la bolsa (addOne)", () => {
  it("con la bolsa cargada suma UNA a lo que hay (3 + 1 = 4) y dos clics seguidos suman 2", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([line("a", 3)])));
    await tick();
    void store.addOne("a");
    expect(store.getState().pending).toEqual({ a: 4 });
    void store.addOne("a");
    expect(store.getState().pending).toEqual({ a: 5 });
  });

  it("una variante que aún no está en la bolsa entra con 1", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([line("a", 3)])));
    await tick();
    void store.addOne("nueva");
    expect(store.getState().pending).toEqual({ nueva: 1 });
  });

  it("si la bolsa NO se ha leído, ESPERA a leerla en vez de adivinar 0 (no deja en 1 una bolsa de 3)", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" }); // la lectura inicial sigue en vuelo
    const done = store.addOne("a"); // se pide agregar antes de que llegue
    await tick();
    expect(store.getState().pending).toEqual({}); // todavía no se envía nada
    calls[0]?.resolve(ok(snapshot([line("a", 3)]))); // llega: había 3
    await done;
    expect(store.getState().pending).toEqual({ a: 4 }); // 3 + 1, no 1
  });

  it("si la bolsa no se puede leer (sin red), NO envía nada: no hay cantidad que sumar", async () => {
    const { store, calls } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(fail(0, "network")); // la lectura inicial falla
    await tick();
    const done = store.addOne("a");
    await drain(calls, () => fail(0, "network")); // el reintento de lectura también falla
    await done;
    expect(store.getState().pending).toEqual({});
    expect(calls.filter((c) => c.body.action === "set_item")).toHaveLength(0);
  });

  it("antes de saber quién es la persona (Auth cargando) espera a la identidad", async () => {
    const { store, calls } = setup();
    const done = store.addOne("a");
    await tick();
    expect(calls).toHaveLength(0);
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([line("a", 2)])));
    await done;
    expect(store.getState().pending).toEqual({ a: 3 });
  });
});

describe("caducidad del «Deshacer» (la decide el almacén)", () => {
  it("caduca a los 8 s aunque ningún componente lo esté mostrando, y una quitada nueva reinicia el plazo", async () => {
    const { store, calls, timers } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([line("a", 1), line("b", 1)])));
    await tick();
    store.remove("a");
    expect(store.getState().lastRemoved).toMatchObject({ variantId: "a" });
    expect(timers.live().map((t) => t.ms)).toContain(8000);
    store.remove("b"); // otra quitada: reemplaza lo deshacible y reinicia los 8 s
    expect(store.getState().lastRemoved).toMatchObject({ variantId: "b" });
    expect(timers.live().filter((t) => t.ms === 8000)).toHaveLength(1); // el plazo viejo se canceló
    const undoTimer = timers.live().find((t) => t.ms === 8000);
    expect(undoTimer).toBeDefined();
    timers.runNext(); // venció el plazo
    expect(store.getState().lastRemoved).toBeNull();
  });

  it("deshacer, cambiar la misma línea o cambiar de identidad cancelan el plazo (no queda un temporizador suelto)", async () => {
    const { store, calls, timers } = setup();
    store.setIdentity({ kind: "user", userId: "u1" });
    await tick();
    calls[0]?.resolve(ok(snapshot([line("a", 2)])));
    await tick();
    store.remove("a");
    store.undoRemove();
    expect(timers.live().filter((t) => t.ms === 8000)).toHaveLength(0);
    store.remove("a");
    store.setIdentity({ kind: "user", userId: "u2" });
    expect(store.getState().lastRemoved).toBeNull();
    expect(timers.live().filter((t) => t.ms === 8000)).toHaveLength(0);
  });
});

describe("cupón (S9)", () => {
  const withCoupon = (extra: Partial<CartSnapshot["discounts"] & object> = {}): CartSnapshot =>
    snapshot([line("a", 2)], {
      totals: {
        subtotal: 200,
        item_count: 2,
        line_count: 1,
        shipping: null,
        discount: 20,
        total: 180,
      },
      discounts: {
        applied: [],
        rejected: [],
        coupon: { status: "applied", code: "VERANO10", reason: null, missing: null },
        free_shipping: false,
        ...extra,
      },
    });

  async function loaded(identity: "user" | "guest" = "user") {
    const h = setup(identity === "guest" ? { mirror: true } : {});
    h.store.setIdentity(identity === "guest" ? { kind: "guest" } : { kind: "user", userId: "u1" });
    await tick();
    h.calls[0]?.resolve(ok(snapshot([line("a", 2)])));
    await tick();
    return h;
  }

  it("aplicar: manda el código tal cual lo escribió (sin espacios al borde) y la foto trae el descuento", async () => {
    const { store, calls } = await loaded();
    const done = store.applyCoupon("  verano-10 ");
    expect(store.getState().coupon).toEqual({ busy: true, notice: null });
    await tick();
    expect(calls[1]?.body).toEqual({ action: "set_coupon", code: "verano-10" });
    calls[1]?.resolve(ok(withCoupon(), { outcome: "coupon_set" }));
    await done;
    expect(store.getState().snapshot?.totals.discount).toBe(20);
    expect(store.getState().coupon).toEqual({ busy: false, notice: null });
  });

  it("un código en blanco ni siquiera sale: avisa «inválido» al instante", async () => {
    const { store, calls } = await loaded();
    await store.applyCoupon("   ");
    expect(calls).toHaveLength(1);
    expect(store.getState().coupon.notice).toEqual({
      code: "",
      reason: "invalid_code",
      missing: null,
    });
    expect(store.getState().coupon.busy).toBe(false);
  });

  it("un código larguísimo se recorta a 40 caracteres antes de salir", async () => {
    const { store, calls } = await loaded();
    void store.applyCoupon("x".repeat(100));
    await tick();
    expect((calls[1]?.body as { code: string }).code).toHaveLength(40);
  });

  it("rechazado (no se guarda): deja el aviso con lo que escribió, el motivo y lo que falta, y NO cambia la foto", async () => {
    const { store, calls } = await loaded();
    const before = store.getState().snapshot;
    const done = store.applyCoupon("Nada");
    await tick();
    calls[1]?.resolve(ok(before, { outcome: "coupon_rejected", reason: "expired" }));
    await done;
    expect(store.getState().coupon).toEqual({
      busy: false,
      notice: { code: "Nada", reason: "expired", missing: null },
    });
    expect(store.getState().snapshot).toEqual(before);
  });

  it("rechazado por mínimo: el aviso lleva cuánto falta", async () => {
    const { store, calls } = await loaded();
    const done = store.applyCoupon("MIN500");
    await tick();
    calls[1]?.resolve(
      ok(snapshot([line("a", 2)]), {
        outcome: "coupon_rejected",
        reason: "min_not_reached",
        missing: 300,
      }),
    );
    await done;
    expect(store.getState().coupon.notice).toEqual({
      code: "MIN500",
      reason: "min_not_reached",
      missing: 300,
    });
  });

  it("un motivo raro del servidor nunca se inventa: se lee como «código inválido»", async () => {
    const { store, calls } = await loaded();
    const done = store.applyCoupon("X1");
    await tick();
    calls[1]?.resolve(
      ok(snapshot([line("a", 2)]), { outcome: "coupon_rejected", reason: "inventado" }),
    );
    await done;
    expect(store.getState().coupon.notice?.reason).toBe("invalid_code");
  });

  it("guardado aunque hoy no baje nada (mínimo): no hay aviso; el motivo se lee de la foto", async () => {
    const { store, calls } = await loaded();
    const done = store.applyCoupon("MIN500");
    await tick();
    calls[1]?.resolve(
      ok(
        withCoupon({
          coupon: { status: "rejected", code: "MIN500", reason: "min_not_reached", missing: 300 },
        }),
        { outcome: "coupon_set", reason: "min_not_reached", missing: 300 },
      ),
    );
    await done;
    expect(store.getState().coupon.notice).toBeNull();
    expect(store.getState().snapshot?.discounts?.coupon.reason).toBe("min_not_reached");
  });

  it("poner un cupón con éxito borra el aviso del intento anterior", async () => {
    const { store, calls } = await loaded();
    let done = store.applyCoupon("MAL");
    await tick();
    calls[1]?.resolve(
      ok(snapshot([line("a", 2)]), { outcome: "coupon_rejected", reason: "invalid_code" }),
    );
    await done;
    expect(store.getState().coupon.notice).not.toBeNull();
    done = store.applyCoupon("BIEN");
    expect(store.getState().coupon.notice).toBeNull(); // se limpia al empezar otro intento
    await tick();
    calls[2]?.resolve(ok(withCoupon(), { outcome: "coupon_set" }));
    await done;
    expect(store.getState().coupon.notice).toBeNull();
  });

  it("quitar: pide remove_coupon, borra el aviso y la foto vuelve sin descuento", async () => {
    const { store, calls } = await loaded();
    const done = store.removeCoupon();
    expect(store.getState().coupon.busy).toBe(true);
    await tick();
    expect(calls[1]?.body).toEqual({ action: "remove_coupon" });
    calls[1]?.resolve(ok(snapshot([line("a", 2)]), { outcome: "coupon_removed" }));
    await done;
    expect(store.getState().snapshot?.totals.discount).toBeNull();
    expect(store.getState().coupon).toEqual({ busy: false, notice: null });
  });

  it("invitado: la petición lleva su token", async () => {
    const { store, calls } = await loaded("guest");
    void store.applyCoupon("VERANO10");
    await tick();
    const body = calls.at(-1)?.body as { action: string; cart_token?: string };
    expect(body.action).toBe("set_coupon");
    expect(body.cart_token).toBe(TOKEN);
  });

  it("sin red: avisa «unavailable», NO guarda nada y NO se reintenta solo (cada intento cuenta contra el tope)", async () => {
    const { store, calls, timers } = await loaded();
    const done = store.applyCoupon("VERANO10");
    await tick();
    calls[1]?.resolve(fail(0, "network"));
    await done;
    expect(store.getState().coupon).toEqual({
      busy: false,
      notice: { code: "VERANO10", reason: "unavailable", missing: null },
    });
    // el único reintento programado es el de la lectura de la bolsa (sin cambios pendientes): jamás vuelve a mandar el cupón
    const before = calls.length;
    while (timers.live().length > 0 && calls.length < before + 3) {
      timers.runNext();
      await tick();
      for (const c of calls.slice(before)) c.resolve(ok(snapshot([line("a", 2)])));
      await tick();
    }
    expect(calls.filter((c) => c.body.action === "set_coupon")).toHaveLength(1);
  });

  it("demasiados intentos (429): avisa «rate_limited»", async () => {
    const { store, calls } = await loaded();
    const done = store.applyCoupon("PRUEBA1");
    await tick();
    calls[1]?.resolve(fail(429, "rate_limited", 600));
    await done;
    expect(store.getState().coupon.notice).toEqual({
      code: "PRUEBA1",
      reason: "rate_limited",
      missing: null,
    });
  });

  it("error del servidor (500): «unavailable»", async () => {
    const { store, calls } = await loaded();
    const done = store.applyCoupon("PRUEBA1");
    await tick();
    calls[1]?.resolve(fail(500, "boom"));
    await done;
    expect(store.getState().coupon.notice?.reason).toBe("unavailable");
  });

  it("sin bolsa en el servidor (no_cart): avisa SIN culpar al código y no inventa un descuento", async () => {
    const { store, calls } = await loaded();
    const done = store.applyCoupon("VERANO10");
    await tick();
    calls[1]?.resolve(ok(null, { outcome: "no_cart", reason: null }));
    await done;
    expect(store.getState().coupon.notice?.reason).toBe("unavailable"); // antes: «ese código no es válido»
    expect(store.getState().snapshot).toBeNull();
  });

  it("si la identidad cambia mientras vuela la petición, el aviso y el estado «ocupado» se descartan", async () => {
    const { store, calls } = await loaded();
    const done = store.applyCoupon("VERANO10");
    await tick();
    store.setIdentity({ kind: "user", userId: "u2" });
    expect(store.getState().coupon).toEqual({ busy: false, notice: null });
    calls[1]?.resolve(ok(withCoupon(), { outcome: "coupon_set" }));
    await done;
    expect(store.getState().coupon).toEqual({ busy: false, notice: null });
    expect(store.getState().snapshot?.totals.discount ?? null).toBeNull(); // la respuesta tardía no contamina a la otra persona
  });

  it("cerrar el aviso lo borra", async () => {
    const { store, calls } = await loaded();
    const done = store.applyCoupon("MAL");
    await tick();
    calls[1]?.resolve(
      ok(snapshot([line("a", 2)]), { outcome: "coupon_rejected", reason: "invalid_code" }),
    );
    await done;
    store.dismissCouponNotice();
    expect(store.getState().coupon.notice).toBeNull();
    store.dismissCouponNotice(); // sin aviso: no hace nada
    expect(store.getState().coupon.notice).toBeNull();
  });

  it("cerrar un aviso que no existe NO avisa a nadie (si no, cada repintado haría trabajo de más)", async () => {
    const { store } = await loaded();
    let notified = 0;
    store.subscribe(() => notified++);
    store.dismissCouponNotice();
    expect(notified).toBe(0);
  });

  it("quitar el cupón borra el aviso AL EMPEZAR (no espera a la respuesta: sin red tampoco debe quedar un rechazo viejo)", async () => {
    const { store, calls } = await loaded();
    let done = store.applyCoupon("MAL");
    await tick();
    calls[1]?.resolve(
      ok(snapshot([line("a", 2)]), { outcome: "coupon_rejected", reason: "expired" }),
    );
    await done;
    expect(store.getState().coupon.notice?.reason).toBe("expired");
    done = store.removeCoupon();
    expect(store.getState().coupon.notice).toBeNull(); // ya, sin esperar la respuesta
    await tick();
    calls[2]?.resolve(fail(0, "network"));
    await done;
    expect(store.getState().coupon.notice).toBeNull();
  });

  it("las peticiones de cupón y de cantidades no se pisan: sale una a la vez", async () => {
    const { store, calls, maxInFlight } = await loaded();
    void store.applyCoupon("VERANO10");
    store.setQty("a", 3);
    await tick();
    expect(maxInFlight()).toBe(1);
    await drain(calls.slice(1), () => ok(withCoupon(), { outcome: "coupon_set" }));
    expect(maxInFlight()).toBe(1);
  });
});
