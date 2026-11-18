import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptAll,
  rejectOptional,
  resetConsentForTests,
  saveConsent,
} from "@/features/consent/consentStore";
import { afterOrderCreated, markPurchaseTracked, resetPurchasesForTests } from "./purchase";

const attribution = vi.hoisted(() => ({
  recordOrderAttribution: vi.fn(async () => undefined),
  sendMetaPurchase: vi.fn(async () => undefined),
}));
vi.mock("./attribution", () => attribution);

beforeEach(() => {
  resetPurchasesForTests();
  resetConsentForTests();
  vi.clearAllMocks();
});

describe("markPurchaseTracked", () => {
  it("la primera vez de cada pedido es true; repetirlo (reintento, recarga) es false", () => {
    expect(markPurchaseTracked("MIC-000123")).toBe(true);
    expect(markPurchaseTracked("MIC-000123")).toBe(false);
    expect(markPurchaseTracked("MIC-000124")).toBe(true);
  });

  it("sobrevive a una recarga de la pestaña (sessionStorage) aunque la memoria se pierda", () => {
    markPurchaseTracked("MIC-000200");
    // otra «carga» de la página: la memoria es nueva, pero el almacenamiento de la pestaña sigue
    expect(JSON.parse(window.sessionStorage.getItem("mic_purchases_tracked")!)).toEqual([
      "MIC-000200",
    ]);
  });

  it("sin almacenamiento sigue contando una vez por pedido (en memoria)", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("cuota");
    });
    expect(markPurchaseTracked("MIC-000300")).toBe(true);
    expect(markPurchaseTracked("MIC-000300")).toBe(false);
    setItem.mockRestore();
  });
});

describe("afterOrderCreated · según lo que la persona aceptó", () => {
  const opts = { token: "tok", metaPixelId: "1234567890123" };

  it("sin decidir NO se anota ni se envía nada", () => {
    afterOrderCreated("MIC-000123", opts);
    expect(attribution.recordOrderAttribution).not.toHaveBeenCalled();
    expect(attribution.sendMetaPurchase).not.toHaveBeenCalled();
  });

  it("rechazó lo opcional: tampoco", () => {
    rejectOptional();
    afterOrderCreated("MIC-000123", opts);
    expect(attribution.recordOrderAttribution).not.toHaveBeenCalled();
    expect(attribution.sendMetaPurchase).not.toHaveBeenCalled();
  });

  it("solo analítica: se anota el origen, pero NO se avisa a Meta", () => {
    saveConsent({ analytics: true, marketing: false });
    afterOrderCreated("MIC-000123", opts);
    expect(attribution.recordOrderAttribution).toHaveBeenCalledWith("MIC-000123");
    expect(attribution.sendMetaPurchase).not.toHaveBeenCalled();
  });

  it("solo marketing: se avisa a Meta con el event_id del pedido, pero NO se anota el origen", () => {
    saveConsent({ analytics: false, marketing: true });
    afterOrderCreated("MIC-000123", opts);
    expect(attribution.sendMetaPurchase).toHaveBeenCalledWith(
      "MIC-000123",
      "purchase.MIC-000123",
      "tok",
    );
    expect(attribution.recordOrderAttribution).not.toHaveBeenCalled();
  });

  it("con marketing pero SIN Pixel configurado o sin sesión, no se llama a Meta", () => {
    acceptAll();
    afterOrderCreated("MIC-000123", { token: "tok", metaPixelId: null });
    afterOrderCreated("MIC-000124", { token: null, metaPixelId: "1234567890123" });
    expect(attribution.sendMetaPurchase).not.toHaveBeenCalled();
  });

  it("un fallo de la red en cualquiera de las dos NO se propaga a la compra", async () => {
    acceptAll();
    attribution.recordOrderAttribution.mockRejectedValueOnce(new Error("x"));
    attribution.sendMetaPurchase.mockRejectedValueOnce(new Error("y"));
    expect(() => afterOrderCreated("MIC-000125", opts)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
