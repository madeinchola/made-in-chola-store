import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeToTracking, track, type TrackEvent } from "./track";

const searchEvent: TrackEvent = { name: "search", query: "chaqueta", results: 3 };

describe("track", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const off of cleanups.splice(0)) off();
  });

  it("sin proveedores no pasa nada y no lanza", () => {
    expect(() => track(searchEvent)).not.toThrow();
  });

  it("entrega el evento a cada proveedor suscrito", () => {
    const a = vi.fn();
    const b = vi.fn();
    cleanups.push(subscribeToTracking(a), subscribeToTracking(b));
    track(searchEvent);
    expect(a).toHaveBeenCalledWith(searchEvent);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("darse de baja detiene los eventos", () => {
    const listener = vi.fn();
    const off = subscribeToTracking(listener);
    track(searchEvent);
    off();
    track(searchEvent);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("un proveedor que falla no impide que los demás reciban el evento ni rompe la pantalla", () => {
    const good = vi.fn();
    cleanups.push(
      subscribeToTracking(() => {
        throw new Error("proveedor caído");
      }),
      subscribeToTracking(good),
    );
    expect(() => track(searchEvent)).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("el mismo proveedor suscrito dos veces recibe una sola copia", () => {
    const listener = vi.fn();
    cleanups.push(subscribeToTracking(listener), subscribeToTracking(listener));
    track(searchEvent);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
