import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptAll,
  CONSENT_KEY,
  CONSENT_VERSION,
  hasConsent,
  isDecided,
  readConsent,
  rejectOptional,
  resetConsentForTests,
  saveConsent,
  subscribeConsent,
} from "./consentStore";

beforeEach(() => resetConsentForTests());
afterEach(() => {
  vi.restoreAllMocks();
  resetConsentForTests();
});

describe("consentStore", () => {
  it("sin decidir NO hay consentimiento de nada (la opción por omisión es no)", () => {
    expect(isDecided()).toBe(false);
    expect(readConsent()).toBeNull();
    expect(hasConsent("analytics")).toBe(false);
    expect(hasConsent("marketing")).toBe(false);
  });

  it("aceptar todo y rechazar lo opcional guardan la elección con su fecha", () => {
    const accepted = acceptAll();
    expect(accepted).toMatchObject({ v: CONSENT_VERSION, analytics: true, marketing: true });
    expect(Number.isNaN(Date.parse(accepted.decidedAt))).toBe(false);
    expect(hasConsent("analytics") && hasConsent("marketing")).toBe(true);
    rejectOptional();
    expect(isDecided()).toBe(true);
    expect(hasConsent("analytics") || hasConsent("marketing")).toBe(false);
  });

  it("se puede aceptar una categoría y no la otra", () => {
    saveConsent({ analytics: true, marketing: false });
    expect(hasConsent("analytics")).toBe(true);
    expect(hasConsent("marketing")).toBe(false);
  });

  it("la elección sobrevive en el almacenamiento (una recarga la lee)", () => {
    saveConsent({ analytics: false, marketing: true });
    const raw = window.localStorage.getItem(CONSENT_KEY)!;
    expect(JSON.parse(raw)).toMatchObject({ analytics: false, marketing: true });
    expect(readConsent()).toMatchObject({ analytics: false, marketing: true });
  });

  it.each([
    ["JSON roto", "{no es json"],
    [
      "una versión que ya no existe",
      JSON.stringify({
        v: 999,
        analytics: true,
        marketing: true,
        decidedAt: "2026-01-01T00:00:00Z",
      }),
    ],
    [
      "valores que no son booleanos",
      JSON.stringify({
        v: CONSENT_VERSION,
        analytics: "sí",
        marketing: 1,
        decidedAt: "2026-01-01T00:00:00Z",
      }),
    ],
    ["sin fecha", JSON.stringify({ v: CONSENT_VERSION, analytics: true, marketing: true })],
    ["un valor que no es objeto", "true"],
  ])("un valor guardado con %s se trata como «sin decidir» (vuelve a preguntar)", (_label, raw) => {
    window.localStorage.setItem(CONSENT_KEY, raw);
    expect(readConsent()).toBeNull();
    expect(hasConsent("analytics")).toBe(false);
  });

  it("no deja pasar nada que alguien haya escrito a mano en el almacenamiento con datos de más", () => {
    window.localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({
        v: CONSENT_VERSION,
        analytics: true,
        marketing: false,
        decidedAt: "2026-01-01T00:00:00Z",
        extra: "x",
      }),
    );
    expect(readConsent()).toEqual({
      v: CONSENT_VERSION,
      analytics: true,
      marketing: false,
      decidedAt: "2026-01-01T00:00:00Z",
    });
  });

  it("avisa a quien escucha en cada cambio, y dejar de escuchar funciona", () => {
    const listener = vi.fn();
    const off = subscribeConsent(listener);
    acceptAll();
    rejectOptional();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1]![0]).toMatchObject({ analytics: false, marketing: false });
    off();
    acceptAll();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("un oyente que falla NO impide que los demás se enteren (sobre todo de un retiro)", () => {
    const good = vi.fn();
    const offs = [
      subscribeConsent(() => {
        throw new Error("proveedor roto");
      }),
      subscribeConsent(good),
    ];
    expect(() => rejectOptional()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    for (const off of offs) off();
  });

  it("si el almacenamiento no deja escribir ni leer, la elección dura en memoria (esta pestaña) y no lanza", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("cuota");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(() => acceptAll()).not.toThrow();
    expect(hasConsent("analytics")).toBe(true);
    rejectOptional();
    expect(hasConsent("analytics")).toBe(false);
  });

  it("si OTRA pestaña retira el consentimiento, esta se entera (y los proveedores se detienen aquí también)", () => {
    acceptAll();
    const listener = vi.fn();
    const off = subscribeConsent(listener);
    // la otra pestaña escribió el retiro en el almacenamiento compartido
    window.localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({
        v: CONSENT_VERSION,
        analytics: false,
        marketing: false,
        decidedAt: "2026-11-17T00:00:00Z",
      }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: CONSENT_KEY }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(hasConsent("analytics") || hasConsent("marketing")).toBe(false);
    off();
  });

  it("devuelve el MISMO objeto mientras nada cambie (React se suscribe con eso)", () => {
    acceptAll();
    expect(readConsent()).toBe(readConsent());
  });
});
