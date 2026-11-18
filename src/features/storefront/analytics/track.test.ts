import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptAll,
  rejectOptional,
  resetConsentForTests,
  saveConsent,
} from "@/features/consent/consentStore";
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

describe("track · consentimiento (S15)", () => {
  const cleanups: (() => void)[] = [];
  beforeEach(() => resetConsentForTests());
  afterEach(() => {
    for (const off of cleanups.splice(0)) off();
    resetConsentForTests();
  });

  it("un proveedor de analítica NO recibe nada hasta que la persona acepta esa categoría", () => {
    const ga = vi.fn();
    cleanups.push(subscribeToTracking(ga, "analytics"));
    track(searchEvent); // sin decidir
    expect(ga).not.toHaveBeenCalled();
    rejectOptional();
    track(searchEvent); // rechazó
    expect(ga).not.toHaveBeenCalled();
    acceptAll();
    track(searchEvent);
    expect(ga).toHaveBeenCalledTimes(1);
  });

  it("cada categoría es independiente: aceptar solo analítica no activa marketing", () => {
    const ga = vi.fn();
    const meta = vi.fn();
    cleanups.push(subscribeToTracking(ga, "analytics"), subscribeToTracking(meta, "marketing"));
    saveConsent({ analytics: true, marketing: false });
    track(searchEvent);
    expect(ga).toHaveBeenCalledTimes(1);
    expect(meta).not.toHaveBeenCalled();
  });

  it("retirar el consentimiento DETIENE los eventos de inmediato", () => {
    const meta = vi.fn();
    cleanups.push(subscribeToTracking(meta, "marketing"));
    acceptAll();
    track(searchEvent);
    expect(meta).toHaveBeenCalledTimes(1);
    rejectOptional();
    track(searchEvent);
    track(searchEvent);
    expect(meta).toHaveBeenCalledTimes(1);
  });

  it("un suscriptor sin categoría (propio, sin terceros) recibe todo, con o sin decisión", () => {
    const own = vi.fn();
    cleanups.push(subscribeToTracking(own));
    track(searchEvent);
    expect(own).toHaveBeenCalledTimes(1);
  });
});
