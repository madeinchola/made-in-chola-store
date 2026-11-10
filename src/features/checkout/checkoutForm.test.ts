import { describe, expect, it } from "vitest";
import {
  canSubmit,
  choicesKey,
  defaultPaymentMethod,
  errorMessage,
  firstInvalidField,
  submitLabelKey,
  toErrorLines,
  validateContact,
} from "./checkoutForm";
import type { CheckoutPreview, PaymentMethodOption } from "./types";

const method = (code: string, available = true): PaymentMethodOption => ({
  code,
  provider: code,
  name: code,
  description: null,
  available,
  reason: null,
  max_amount: null,
  window_minutes: null,
});

describe("validateContact", () => {
  it("acepta un contacto completo y normaliza el teléfono a E.164 y el correo a minúsculas", () => {
    const result = validateContact({
      name: "  Ana   Pérez ",
      email: " ANA@Example.COM ",
      phone: "7123 4567",
    });
    expect(result).toEqual({
      ok: true,
      value: { name: "Ana Pérez", email: "ana@example.com", phone: "+59171234567" },
    });
  });

  it("el correo es opcional: vacío viaja como null", () => {
    const result = validateContact({ name: "Ana", email: "   ", phone: "+59171234567" });
    expect(result).toEqual({
      ok: true,
      value: { name: "Ana", email: null, phone: "+59171234567" },
    });
  });

  it("explica cada campo malo junto al campo", () => {
    const result = validateContact({ name: " ", email: "sin-arroba", phone: "123" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["email", "name", "phone"]);
    expect(result.errors.name).toBe("Escribe tu nombre.");
    expect(result.errors.email).toBe("Revisa el correo: parece incompleto.");
    expect(result.errors.phone).toBe(
      "Escribe el teléfono con código de país, por ejemplo +591 71234567.",
    );
  });

  it("un teléfono vacío pide el teléfono (no dice «inválido»)", () => {
    const result = validateContact({ name: "Ana", email: "", phone: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.phone).toBe("Escribe tu teléfono.");
  });

  it("acepta teléfonos internacionales con +", () => {
    const result = validateContact({ name: "Ana", email: "", phone: "+54 9 11 2233-4455" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.phone).toBe("+5491122334455");
  });

  it("un nombre de más de 120 caracteres no pasa (el servidor lo rechazaría)", () => {
    expect(validateContact({ name: "a".repeat(121), email: "", phone: "71234567" }).ok).toBe(false);
    expect(validateContact({ name: "a".repeat(120), email: "", phone: "71234567" }).ok).toBe(true);
  });

  it("firstInvalidField respeta el orden de la pantalla", () => {
    expect(firstInvalidField({ phone: "x", email: "y" })).toBe("email");
    expect(firstInvalidField({ phone: "x" })).toBe("phone");
    expect(firstInvalidField({ name: "n", phone: "x" })).toBe("name");
    expect(firstInvalidField({})).toBeNull();
  });
});

describe("errores del servidor", () => {
  it("los códigos propios y los de envío tienen texto; uno desconocido, mensaje genérico", () => {
    expect(errorMessage({ code: "address_required" })).toBe("Elige una dirección de entrega.");
    // un código de envío usa el texto de S8 (no una clave sin traducir, que se vería como «shipping.errors.slot_full»)
    for (const code of ["slot_full", "location_required", "out_of_coverage", "date_past"]) {
      const text = errorMessage({ code });
      expect(text, code).not.toMatch(/^(shipping|checkout)\./);
      expect(text.length, code).toBeGreaterThan(10);
      expect(text, code).not.toBe(errorMessage({ code: "algo_nuevo_que_no_existe" }));
    }
    expect(errorMessage({ code: "algo_nuevo_que_no_existe" })).toBe(
      "No pudimos crear tu pedido. Inténtalo de nuevo.",
    );
  });

  it("«payment_unavailable» distingue el tope de monto", () => {
    expect(errorMessage({ code: "payment_unavailable", reason: "over_max_amount" })).toBe(
      "No disponible para pedidos de este monto",
    );
    expect(errorMessage({ code: "payment_unavailable", reason: "not_available" })).toBe(
      "Esa forma de pago no está disponible para este pedido. Elige otra.",
    );
  });

  it("cada error va a la sección que lo corrige y no se repite", () => {
    const lines = toErrorLines([
      { code: "location_required", field: "location" },
      { code: "slot_full", field: "slot" },
      { code: "slot_full", field: "slot" },
      { code: "tax_profile_invalid" },
      { code: "payment_unavailable", reason: "not_available" },
      { code: "cart_empty" },
    ]);
    expect(lines.map((l) => `${l.code}→${l.section}`)).toEqual([
      "location_required→delivery",
      "slot_full→schedule",
      "tax_profile_invalid→tax",
      "payment_unavailable→payment",
      "cart_empty→general",
    ]);
  });
});

describe("método de pago y botón", () => {
  it("conserva el elegido si sigue disponible; si no, el primero disponible; si ninguno, undefined", () => {
    const methods = [method("whatsapp"), method("cash_on_delivery"), method("qr", false)];
    expect(defaultPaymentMethod(methods, "cash_on_delivery")).toBe("cash_on_delivery");
    expect(defaultPaymentMethod(methods, "qr")).toBe("whatsapp");
    expect(defaultPaymentMethod(methods, undefined)).toBe("whatsapp");
    expect(defaultPaymentMethod([method("qr", false)], undefined)).toBeUndefined();
    expect(defaultPaymentMethod([], "whatsapp")).toBeUndefined();
  });

  it("el botón dice «Enviar pedido por WhatsApp» solo con WhatsApp", () => {
    expect(submitLabelKey("whatsapp")).toBe("checkout.submit.whatsapp");
    expect(submitLabelKey("cash_on_delivery")).toBe("checkout.submit.generic");
    expect(submitLabelKey(undefined)).toBe("checkout.submit.generic");
  });

  it("choicesKey cambia con CUALQUIER elección que cambie el cálculo", () => {
    const base = { shippingMethod: "delivery", addressId: "a", paymentMethod: "whatsapp" };
    const keys = new Set([
      choicesKey(base),
      choicesKey({ ...base, shippingMethod: "recojo" }),
      choicesKey({ ...base, addressId: "b" }),
      choicesKey({ ...base, taxProfileId: "t" }),
      choicesKey({ ...base, slotId: "s", deliveryDate: "2026-12-01" }),
      choicesKey({ ...base, deliveryDate: "2026-12-01" }),
      choicesKey({ ...base, paymentMethod: "cash_on_delivery" }),
    ]);
    expect(keys.size).toBe(7);
  });
});

describe("canSubmit", () => {
  const preview = (over: Partial<CheckoutPreview>): CheckoutPreview =>
    ({
      ok: true,
      errors: [],
      currency: "BOB",
      decimals: 2,
      can_checkout: true,
      lines: [],
      totals: { subtotal: 100, discount: 0, shipping: 15, shipping_discount: 0, total: 115 },
      discounts: { applied: [], coupon: null, free_shipping: false },
      shipping: { method: null, quote: null, address: null, slot: null },
      payment: { methods: [], chosen: null },
      ...over,
    }) as CheckoutPreview;

  it("solo con vista previa sin errores, bolsa pagable y total conocido", () => {
    expect(canSubmit(preview({}))).toBe(true);
    expect(canSubmit(undefined)).toBe(false);
    expect(canSubmit(preview({ ok: false }))).toBe(false);
    expect(canSubmit(preview({ can_checkout: false }))).toBe(false);
    expect(
      canSubmit(
        preview({
          totals: { subtotal: 100, discount: 0, shipping: null, shipping_discount: 0, total: null },
        }),
      ),
    ).toBe(false);
  });
});
