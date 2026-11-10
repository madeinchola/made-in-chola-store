import { describe, expect, it } from "vitest";
import { resolveMessage } from "@/i18n";
import { COUPON_REASON_KEYS, couponReasonText } from "./couponReasons";
import { COUPON_REASONS } from "./types";

// Los textos están escritos A MANO aquí (los del encargo): si alguien cambia una frase en el diccionario, esta prueba lo nota.
const EXPECTED: Record<string, string> = {
  invalid_code: "Ese código no es válido. Revísalo e inténtalo de nuevo.",
  expired: "Ese cupón ya venció.",
  wrong_currency: "Ese cupón no vale para la moneda de tu bolsa.",
  login_required: "Inicia sesión para usar este cupón.",
  sold_out: "Ese cupón ya se agotó.",
  already_used: "Ya usaste este cupón.",
  not_first_purchase: "Este cupón es solo para tu primera compra.",
  not_eligible_customer: "Este cupón no está disponible para tu cuenta.",
  not_applicable: "Este cupón no aplica a los productos de tu bolsa.",
  min_not_reached: "Te faltan Bs 50,00 para usar este cupón.",
  not_combinable: "Ya tienes una oferta mejor aplicada: este cupón no se suma.",
  coupon_already_applied: "Ya hay un cupón en tu bolsa. Quítalo para usar otro.",
  unavailable: "No pudimos aplicar el cupón. Inténtalo de nuevo.",
  rate_limited:
    "Hubo demasiados intentos desde tu conexión. Espera unos minutos y vuelve a intentarlo.",
};

describe("couponReasons · un texto para CADA motivo", () => {
  it.each(COUPON_REASONS)(
    "el motivo «%s» del servidor tiene entrada y su clave resuelve a un texto",
    (reason) => {
      const key = COUPON_REASON_KEYS[reason];
      expect(key, `falta la entrada de «${reason}» en COUPON_REASON_KEYS`).toBeDefined();
      const text = resolveMessage(key);
      expect(text, `la clave «${String(key)}» no resuelve a un texto`).toBeTruthy();
      expect(text!.trim().length).toBeGreaterThan(0);
    },
  );

  it.each(["unavailable", "rate_limited"] as const)(
    "el motivo del cliente «%s» tiene entrada y texto",
    (reason) => {
      expect(resolveMessage(COUPON_REASON_KEYS[reason])).toBeTruthy();
    },
  );

  it("el mapa tiene EXACTAMENTE los motivos del servidor y los dos del cliente (ni de más ni de menos)", () => {
    expect(Object.keys(COUPON_REASON_KEYS).sort()).toEqual(
      [...COUPON_REASONS, "unavailable", "rate_limited"].sort(),
    );
  });

  it("cada motivo apunta a una clave DISTINTA (nadie comparte el texto de otro por descuido)", () => {
    const keys = Object.values(COUPON_REASON_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(Object.entries(EXPECTED))("«%s» dice exactamente lo del encargo", (reason, text) => {
    expect(couponReasonText(reason as keyof typeof COUPON_REASON_KEYS, 50, "BOB")).toBe(text);
  });
});

describe("couponReasonText · casos límite", () => {
  it("«min_not_reached» da formato al importe que falta con la moneda de la bolsa (1.250,5 → Bs 1.250,50)", () => {
    expect(couponReasonText("min_not_reached", 1250.5, "BOB")).toBe(
      "Te faltan Bs 1.250,50 para usar este cupón.",
    );
  });

  it.each([null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    "«min_not_reached» sin un importe válido (%s) no inventa una cifra ni deja «{missing}» a la vista",
    (missing) => {
      const text = couponReasonText("min_not_reached", missing, "BOB");
      expect(text).toBe("Todavía no llegas al mínimo de compra de este cupón.");
      expect(text).not.toContain("{");
    },
  );

  it("los demás motivos ignoran `missing`", () => {
    expect(couponReasonText("expired", 50, "BOB")).toBe("Ese cupón ya venció.");
  });

  it("un motivo que este código no conoce (servidor más nuevo) o ausente se lee como «no pudimos aplicar el cupón»", () => {
    expect(couponReasonText("motivo_nuevo" as never, null, "BOB")).toBe(
      "No pudimos aplicar el cupón. Inténtalo de nuevo.",
    );
    expect(couponReasonText(null, null, "BOB")).toBe(
      "No pudimos aplicar el cupón. Inténtalo de nuevo.",
    );
  });
});
