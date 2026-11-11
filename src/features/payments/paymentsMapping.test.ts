import { describe, expect, it } from "vitest";
import {
  formatClock,
  isQrPayment,
  parsePaymentView,
  paymentStage,
  secondsLeft,
  spokenRemaining,
} from "./paymentsMapping";
import type { PaymentView } from "./types";

const RAW = {
  outcome: "ok",
  server_now: "2026-11-10T12:00:00Z",
  order: {
    id: "o-1",
    number: "MIC-000123",
    status: "pending_payment",
    total: 255,
    currency: "BOB",
    payment_expires_at: "2026-11-11T12:00:00Z",
  },
  payment: {
    id: "p-1",
    status: "pending",
    provider: "manual_qr",
    method: "qr_manual",
    reference: "MIC-000123",
    amount: 255,
    currency: "BOB",
    expires_at: "2026-11-11T12:00:00Z",
    paid_at: null,
    under_review: false,
  },
  method: {
    code: "qr_manual",
    name: "Pago con QR",
    description: null,
    account_details: "Banco Ejemplo",
    qr_image_path: "qr/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.png",
  },
  proof: null,
  can_upload: true,
  can_retry: false,
};

const view = (over: Record<string, unknown> = {}): PaymentView => {
  const parsed = parsePaymentView({ ...RAW, ...over });
  if (!parsed) throw new Error("la vista de prueba debe ser válida");
  return parsed;
};
const withOrder = (status: string) => ({ order: { ...RAW.order, status } });
const withPayment = (over: Record<string, unknown>) => ({ payment: { ...RAW.payment, ...over } });
const withProof = (status: string, reason: string | null = null) => ({
  proof: {
    status,
    reason,
    created_at: "2026-11-10T12:00:00Z",
    reviewed_at: null,
    mime: "image/jpeg",
  },
});

describe("parsePaymentView", () => {
  it("lee una respuesta completa", () => {
    const parsed = parsePaymentView(RAW)!;
    expect(parsed.order).toEqual({
      id: "o-1",
      number: "MIC-000123",
      status: "pending_payment",
      total: 255,
      currency: "BOB",
      paymentExpiresAt: "2026-11-11T12:00:00Z",
    });
    expect(parsed.payment?.reference).toBe("MIC-000123");
    expect(parsed.payment?.underReview).toBe(false);
    expect(parsed.method?.accountDetails).toBe("Banco Ejemplo");
    expect(parsed.method?.qrImagePath).toBe("qr/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1.png");
    expect(parsed.proof).toBeNull();
    expect(parsed.canUpload).toBe(true);
    expect(parsed.canRetry).toBe(false);
    expect(parsed.serverNow).toBe("2026-11-10T12:00:00Z");
  });

  it("un pedido que no existe o no es suyo (o basura) es null: no se inventan datos de pago", () => {
    expect(parsePaymentView({ outcome: "not_found" })).toBeNull();
    expect(parsePaymentView(null)).toBeNull();
    expect(parsePaymentView("ok")).toBeNull();
    expect(parsePaymentView([])).toBeNull();
    expect(parsePaymentView({ ...RAW, order: null })).toBeNull();
    expect(parsePaymentView({ ...RAW, order: { ...RAW.order, total: "255" } })).toBeNull();
    expect(parsePaymentView({ ...RAW, server_now: "no es una fecha" })).toBeNull();
    expect(parsePaymentView({ ...RAW, server_now: undefined })).toBeNull();
  });

  it("un cobro con un estado desconocido se descarta (no se pinta algo que no se entiende)", () => {
    const parsed = parsePaymentView({ ...RAW, ...withPayment({ status: "inventado" }) })!;
    expect(parsed.payment).toBeNull();
    expect(isQrPayment(parsed)).toBe(false);
  });

  it("un comprobante con estado desconocido se descarta; los permisos solo valen si son exactamente true", () => {
    expect(parsePaymentView({ ...RAW, ...withProof("raro") })!.proof).toBeNull();
    expect(parsePaymentView({ ...RAW, can_upload: "true", can_retry: 1 })!.canUpload).toBe(false);
    expect(parsePaymentView({ ...RAW, can_upload: "true", can_retry: 1 })!.canRetry).toBe(false);
  });

  it("sin datos del método (WhatsApp) no hay QR", () => {
    const parsed = parsePaymentView({
      ...RAW,
      method: null,
      ...withPayment({ provider: "whatsapp" }),
    })!;
    expect(parsed.method).toBeNull();
    expect(isQrPayment(parsed)).toBe(false);
  });

  it("solo los dos proveedores QR son pago con QR", () => {
    expect(isQrPayment(view())).toBe(true);
    expect(isQrPayment(view(withPayment({ provider: "qr_api" })))).toBe(true);
    expect(isQrPayment(view(withPayment({ provider: "cash_on_delivery" })))).toBe(false);
  });
});

describe("paymentStage", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["recién creado: falta pagar", {}, "awaiting"],
    ["comprobante esperando revisión", withProof("pending"), "proof_pending"],
    ["comprobante rechazado: puede subir otro", withProof("rejected", "borroso"), "proof_rejected"],
    ["monto distinto o duplicado: en revisión", withPayment({ under_review: true }), "in_review"],
    [
      "la revisión manda sobre el comprobante pendiente",
      { ...withPayment({ under_review: true }), ...withProof("pending") },
      "in_review",
    ],
    ["pedido pagado", withOrder("paid"), "paid"],
    ["pedido enviado (el pago ya estaba)", withOrder("shipped"), "paid"],
    [
      "cobro pagado con el pedido pendiente (justo entre dos pasos)",
      withPayment({ status: "paid" }),
      "paid",
    ],
    ["cobro fallido", withPayment({ status: "failed" }), "failed"],
    [
      "cobro vencido con el pedido todavía pendiente",
      withPayment({ status: "expired" }),
      "expired",
    ],
    [
      "pedido vencido: cancelado por el tiempo",
      { ...withOrder("cancelled"), ...withPayment({ status: "expired" }) },
      "expired",
    ],
    [
      "pedido cancelado por la clienta",
      { ...withOrder("cancelled"), ...withPayment({ status: "cancelled" }) },
      "cancelled",
    ],
    [
      "pago que llegó con el pedido ya cancelado, con su revisión abierta",
      { ...withOrder("cancelled"), ...withPayment({ status: "paid", under_review: true }) },
      "late",
    ],
    [
      "…y ya resuelta por el administrador: deja de decir «lo estamos revisando»",
      { ...withOrder("cancelled"), ...withPayment({ status: "paid", under_review: false }) },
      "late_done",
    ],
    ["contracargo", withPayment({ status: "disputed" }), "disputed"],
    ["reembolsado", withPayment({ status: "refunded" }), "refunded"],
  ];
  it.each(cases)("%s", (_name, over, expected) => {
    expect(paymentStage(view(over))).toBe(expected);
  });

  it("un contracargo gana sobre cualquier otra cosa", () => {
    expect(
      paymentStage(view({ ...withOrder("paid"), ...withPayment({ status: "disputed" }) })),
    ).toBe("disputed");
  });
  it("sin cobro no hay nada que pagar", () => {
    expect(paymentStage(view({ payment: null }))).toBe("cancelled");
  });
});

describe("secondsLeft (hora del servidor)", () => {
  const SERVER = "2026-11-10T12:00:00Z";
  const EXPIRES = "2026-11-11T12:00:00Z"; // 24 h después
  const serverMs = Date.parse(SERVER);

  it("24 h exactas al llegar la respuesta", () => {
    expect(secondsLeft(EXPIRES, SERVER, serverMs, serverMs)).toBe(86_400);
  });
  it("90 segundos después, 86 310", () => {
    expect(secondsLeft(EXPIRES, SERVER, serverMs, serverMs + 90_000)).toBe(86_310);
  });
  it("un aparato con el reloj ATRASADO una hora ve LA MISMA cuenta", () => {
    const deviceAtFetch = serverMs - 3_600_000;
    expect(secondsLeft(EXPIRES, SERVER, deviceAtFetch, deviceAtFetch)).toBe(86_400);
    expect(secondsLeft(EXPIRES, SERVER, deviceAtFetch, deviceAtFetch + 90_000)).toBe(86_310);
  });
  it("y uno ADELANTADO tres horas también", () => {
    const deviceAtFetch = serverMs + 3 * 3_600_000;
    expect(secondsLeft(EXPIRES, SERVER, deviceAtFetch, deviceAtFetch + 1000)).toBe(86_399);
  });
  it("redondea hacia arriba (0,2 s que quedan es 1) y nunca baja de 0", () => {
    expect(secondsLeft(EXPIRES, SERVER, serverMs, Date.parse(EXPIRES) - 200)).toBe(1);
    expect(secondsLeft(EXPIRES, SERVER, serverMs, Date.parse(EXPIRES))).toBe(0);
    expect(secondsLeft(EXPIRES, SERVER, serverMs, Date.parse(EXPIRES) + 99_000)).toBe(0);
  });
  it("sin vencimiento o con fechas rotas no hay cuenta", () => {
    expect(secondsLeft(null, SERVER, serverMs, serverMs)).toBeNull();
    expect(secondsLeft("mañana", SERVER, serverMs, serverMs)).toBeNull();
    expect(secondsLeft(EXPIRES, "ayer", serverMs, serverMs)).toBeNull();
  });
});

describe("formatClock y spokenRemaining", () => {
  it.each([
    [86_400, "24:00:00"],
    [3_661, "01:01:01"],
    [3_600, "01:00:00"],
    [3_599, "59:59"],
    [600, "10:00"],
    [59, "00:59"],
    [1, "00:01"],
    [0, "00:00"],
    [-5, "00:00"],
    [61.9, "01:01"],
  ])("%s s → %s", (seconds, text) => {
    expect(formatClock(seconds)).toBe(text);
  });
  it("horas y minutos para leer en voz alta", () => {
    expect(spokenRemaining(86_399)).toEqual({ hours: 23, minutes: 59 });
    expect(spokenRemaining(59)).toEqual({ hours: 0, minutes: 0 });
    expect(spokenRemaining(-1)).toEqual({ hours: 0, minutes: 0 });
  });
});
