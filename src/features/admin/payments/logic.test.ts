import { describe, expect, it } from "vitest";
import {
  canConfirmManually,
  formatBytes,
  formatDateTime,
  formatMoney,
  isQrProvider,
  methodFormFrom,
  qrExtension,
  reasonLabel,
  reviewSummary,
  statusLabel,
  statusTone,
  validateMethodForm,
  validateNote,
  validateReason,
  validateReceived,
  windowText,
  type MethodForm,
} from "./logic";
import { PAYMENT_STATUSES, type MethodRow, type PaymentStatus } from "./types";

const method = (over: Partial<MethodRow> = {}): MethodRow => ({
  id: "m1",
  country: "BO",
  code: "qr_manual",
  provider: "manual_qr",
  name: "Pago con QR",
  description: null,
  isActive: false,
  sortOrder: 5,
  maxAmount: null,
  windowMinutes: 1440,
  blockedForBlacklisted: false,
  accountDetails: null,
  qrImagePath: null,
  archivedAt: null,
  updatedAt: "2026-11-10T10:00:00+00:00",
  ...over,
});
const form = (over: Partial<MethodForm> = {}): MethodForm => ({
  ...methodFormFrom(method()),
  name: "Pago con QR",
  windowMinutes: "1440",
  ...over,
});

describe("formato", () => {
  it("importes con coma decimal, sin float de por medio", () => {
    expect(formatMoney(255, "BOB")).toBe("Bs 255,00");
    expect(formatMoney(1234.5, "BOB")).toMatch(/^Bs 1\D?234,50$/);
    expect(formatMoney(0.1 + 0.2, "BOB")).toBe("Bs 0,30");
    expect(formatMoney(10, "USD")).toBe("USD 10,00");
  });
  it("fechas y tamaños; lo roto es un guion", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("no es fecha")).toBe("—");
    expect(formatDateTime("2026-11-10T12:00:00Z")).not.toBe("—");
    expect(formatBytes(500)).toBe("1 KB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
  it("cada estado tiene tono y texto", () => {
    for (const status of PAYMENT_STATUSES) {
      expect(statusLabel(status)).not.toMatch(/^admin\./);
      expect(["success", "info", "warning", "danger", "neutral"]).toContain(statusTone(status));
    }
    expect(statusTone("paid")).toBe("success");
    expect(statusTone("disputed")).toBe("danger");
    expect(statusTone("failed")).toBe("danger");
    expect(statusLabel("paid")).toBe("Pagado");
  });
});

describe("canConfirmManually", () => {
  const cases: [PaymentStatus, boolean][] = [
    ["initiated", true],
    ["pending", true],
    ["failed", true],
    ["expired", true],
    ["cancelled", true],
    ["paid", false],
    ["refunded", false],
    ["disputed", false],
  ];
  it.each(cases)("%s → %s", (status, expected) =>
    expect(canConfirmManually(status)).toBe(expected),
  );
});

describe("reviewSummary", () => {
  it("monto distinto: dice cuánto se esperaba y cuánto llegó", () => {
    expect(reviewSummary("amount_mismatch", { expected: 150, received: 140 }, "BOB")).toBe(
      "Se esperaba Bs 150,00 y llegó Bs 140,00. El pedido sigue pendiente de pago.",
    );
  });
  it("tardío: dice el monto y el estado del pedido", () => {
    expect(reviewSummary("late", { amount: 90, order_status: "cancelled" }, "BOB")).toContain(
      "Bs 90,00",
    );
    expect(reviewSummary("late", { amount: 90, order_status: "cancelled" }, "BOB")).toContain(
      "«cancelled»",
    );
  });
  it("pedido cancelado con dinero: dice qué hacer según la causa (no inventa un pago «tardío»)", () => {
    const paid = reviewSummary("late", { cause: "cancelled_after_payment" }, "BOB");
    expect(paid).toContain("se canceló DESPUÉS de que su pago quedó confirmado");
    expect(paid).not.toContain("Bs");
    const proof = reviewSummary("late", { cause: "proof_pending_at_cancel" }, "BOB");
    expect(proof).toContain("comprobante sin revisar");
    expect(proof).not.toContain("{");
    expect(reasonLabel("late")).toBe("Pedido cancelado con dinero");
  });
  it("sin detalle usa la frase general del motivo", () => {
    expect(reviewSummary("duplicate", {}, "BOB")).toContain("más de una vez");
    expect(reviewSummary("disputed", {}, "BOB")).toContain("contracargo");
    expect(reviewSummary("provider_refund", {}, "BOB")).toContain("reembolso");
    // un monto distinto sin cifras en el detalle no inventa números
    expect(reviewSummary("amount_mismatch", {}, "BOB")).toBe(
      "El monto recibido no coincide con el del pedido. El pedido sigue pendiente de pago.",
    );
  });
});

describe("validateReason / validateNote", () => {
  it("el motivo es obligatorio, se compacta y tiene tope de 300", () => {
    expect(validateReason("   ")).toEqual({ ok: false, problem: "required" });
    expect(validateReason("  No   se ve\nel monto ")).toEqual({
      ok: true,
      value: "No se ve el monto",
    });
    expect(validateReason("a".repeat(300)).ok).toBe(true);
    expect(validateReason("a".repeat(301))).toEqual({ ok: false, problem: "too_long" });
  });
  it("la nota tiene tope de 500", () => {
    expect(validateNote("")).toEqual({ ok: false, problem: "required" });
    expect(validateNote("a".repeat(500)).ok).toBe(true);
    expect(validateNote("a".repeat(501))).toEqual({ ok: false, problem: "too_long" });
  });
});

describe("validateReceived (monto que vio el admin)", () => {
  it("vacío = el esperado", () => {
    expect(validateReceived("")).toEqual({ ok: true, value: null });
    expect(validateReceived("   ")).toEqual({ ok: true, value: null });
  });
  it("acepta coma o punto y hasta 2 decimales", () => {
    expect(validateReceived("255,00")).toEqual({ ok: true, value: 255 });
    expect(validateReceived("80.5")).toEqual({ ok: true, value: 80.5 });
    expect(validateReceived("007,10")).toEqual({ ok: true, value: 7.1 });
  });
  it("rechaza lo que la base rechazaría, sin redondear en silencio", () => {
    expect(validateReceived("255,005")).toEqual({ ok: false, problem: "decimals" });
    expect(validateReceived("abc")).toEqual({ ok: false, problem: "format" });
    expect(validateReceived("-5")).toEqual({ ok: false, problem: "format" });
    expect(validateReceived("0")).toEqual({ ok: false, problem: "not_positive" });
    expect(validateReceived("1.000.000.000")).toEqual({ ok: false, problem: "format" });
    expect(validateReceived("1000000000")).toEqual({ ok: false, problem: "too_large" });
  });
});

describe("validateMethodForm", () => {
  it("un método QR apagado no necesita QR ni cuenta todavía", () => {
    const result = validateMethodForm(form(), { provider: "manual_qr", qrImagePath: null });
    expect(result.ok).toBe(true);
  });
  it("encenderlo exige la imagen del QR y los datos de la cuenta (como la base)", () => {
    const result = validateMethodForm(form({ isActive: true }), {
      provider: "manual_qr",
      qrImagePath: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.qr).toBe("admin.payments.methods.errors.qrRequired");
      expect(result.errors.accountDetails).toBe("admin.payments.methods.errors.accountRequired");
    }
  });
  it("con imagen y cuenta, encendido es válido y el parche sale limpio", () => {
    const result = validateMethodForm(
      form({
        isActive: true,
        accountDetails: "  Banco Ejemplo  ",
        name: "  Pago   con QR ",
        description: "",
        maxAmount: "1500",
      }),
      { provider: "manual_qr", qrImagePath: "qr/a.png" },
    );
    expect(result).toEqual({
      ok: true,
      patch: {
        name: "Pago con QR",
        description: null,
        account_details: "Banco Ejemplo",
        window_minutes: 1440,
        max_amount: 1500,
        is_active: true,
        blocked_for_blacklisted: false,
      },
    });
  });
  it("la ventana: 1 a 1440 minutos, obligatoria en un QR", () => {
    const ok = (minutes: string) =>
      validateMethodForm(form({ windowMinutes: minutes }), {
        provider: "manual_qr",
        qrImagePath: null,
      });
    expect(ok("1").ok).toBe(true);
    expect(ok("1440").ok).toBe(true);
    for (const bad of ["0", "1441", "abc", "-5", "1.5", "12345"]) {
      const result = ok(bad);
      expect(result.ok, bad).toBe(false);
      if (!result.ok)
        expect(result.errors.windowMinutes).toBe("admin.payments.methods.errors.windowRange");
    }
    const empty = ok("");
    expect(empty.ok).toBe(false);
    if (!empty.ok)
      expect(empty.errors.windowMinutes).toBe("admin.payments.methods.errors.windowRequired");
  });
  it("WhatsApp y contra entrega no necesitan ventana ni QR", () => {
    const result = validateMethodForm(form({ windowMinutes: "", isActive: true }), {
      provider: "whatsapp",
      qrImagePath: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patch.window_minutes).toBeNull();
  });
  it("un método SIN QR nunca manda ventana, aunque el formulario traiga un valor (le haría vencer los pedidos solos)", () => {
    for (const provider of ["whatsapp", "cash_on_delivery"]) {
      const result = validateMethodForm(form({ windowMinutes: "60" }), {
        provider,
        qrImagePath: null,
      });
      expect(result.ok, provider).toBe(true);
      if (result.ok) expect(result.patch.window_minutes, provider).toBeNull();
    }
    // y un valor absurdo en un campo que ni se muestra no bloquea el guardado
    const absurd = validateMethodForm(form({ windowMinutes: "abc" }), {
      provider: "whatsapp",
      qrImagePath: null,
    });
    expect(absurd.ok).toBe(true);
  });
  it("nombre, descripción, cuenta y monto máximo con los topes de la base", () => {
    const base = { provider: "manual_qr", qrImagePath: null } as const;
    const err = (over: Partial<MethodForm>) => {
      const r = validateMethodForm(form(over), base);
      return r.ok ? null : r.errors;
    };
    expect(err({ name: " " })?.name).toBe("admin.payments.methods.errors.nameRequired");
    expect(err({ name: "a".repeat(81) })?.name).toBe("admin.payments.methods.errors.nameTooLong");
    expect(err({ name: "a".repeat(80) })).toBeNull();
    expect(err({ description: "a".repeat(301) })?.description).toBe(
      "admin.payments.methods.errors.descriptionTooLong",
    );
    expect(err({ accountDetails: "a".repeat(501) })?.accountDetails).toBe(
      "admin.payments.methods.errors.accountTooLong",
    );
    expect(err({ maxAmount: "12,345" })?.maxAmount).toBe("admin.payments.methods.errors.maxAmount");
    expect(err({ maxAmount: "abc" })?.maxAmount).toBe("admin.payments.methods.errors.maxAmount");
    expect(err({ maxAmount: "" })).toBeNull();
  });
});

describe("otros", () => {
  it("los dos proveedores QR", () => {
    expect(isQrProvider("manual_qr")).toBe(true);
    expect(isQrProvider("qr_api")).toBe(true);
    expect(isQrProvider("whatsapp")).toBe(false);
  });
  it("ventana en palabras", () => {
    expect(windowText(1440)).toBe("24 horas");
    expect(windowText(60)).toBe("1 hora");
    expect(windowText(120)).toBe("2 horas");
    expect(windowText(90)).toBe("90 minutos");
    expect(windowText(null)).toBe("Sin límite");
  });
  it("el formulario parte de lo guardado", () => {
    expect(
      methodFormFrom(
        method({ windowMinutes: null, maxAmount: 200, description: "x", accountDetails: "y" }),
      ),
    ).toEqual({
      name: "Pago con QR",
      description: "x",
      accountDetails: "y",
      windowMinutes: "",
      maxAmount: "200",
      isActive: false,
      blockedForBlacklisted: false,
    });
  });
  it("el tipo del QR decide su extensión; SVG y otros no", () => {
    expect(qrExtension("image/png")).toBe("png");
    expect(qrExtension("image/jpeg")).toBe("jpg");
    expect(qrExtension("image/webp")).toBe("webp");
    expect(qrExtension("image/svg+xml")).toBeNull();
    expect(qrExtension("application/pdf")).toBeNull();
  });
});
