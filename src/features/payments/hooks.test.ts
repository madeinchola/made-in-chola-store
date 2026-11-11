import { describe, expect, it } from "vitest";
import { POLL_MS, shouldPoll } from "./hooks";
import { parsePaymentView } from "./paymentsMapping";

const view = (over: Record<string, unknown> = {}) =>
  parsePaymentView({
    outcome: "ok",
    server_now: "2026-11-10T12:00:00Z",
    order: {
      id: "o",
      number: "MIC-000001",
      status: "pending_payment",
      total: 10,
      currency: "BOB",
      payment_expires_at: null,
    },
    payment: {
      id: "p",
      status: "pending",
      provider: "manual_qr",
      method: "qr_manual",
      reference: "MIC-000001",
      amount: 10,
      currency: "BOB",
      expires_at: null,
      paid_at: null,
      under_review: false,
    },
    method: null,
    proof: null,
    can_upload: false,
    can_retry: false,
    ...over,
  });
const proof = (status: string) => ({
  status,
  reason: null,
  created_at: "2026-11-10T12:00:00Z",
  reviewed_at: null,
  mime: "image/png",
});

describe("shouldPoll (cuándo se sigue preguntando por el pago)", () => {
  it("se pregunta cada 10 s", () => expect(POLL_MS).toBe(10_000));

  it.each([
    ["esperando el pago", {}, true],
    ["comprobante en revisión", { proof: proof("pending") }, true],
    ["comprobante rechazado (puede subir otro)", { proof: proof("rejected") }, true],
    [
      "pago en revisión por el administrador",
      {
        payment: {
          id: "p",
          status: "pending",
          provider: "manual_qr",
          method: "qr_manual",
          reference: "MIC-000001",
          amount: 10,
          currency: "BOB",
          expires_at: null,
          paid_at: null,
          under_review: true,
        },
      },
      true,
    ],
    [
      "pedido pagado: ya no hay nada que esperar",
      {
        order: {
          id: "o",
          number: "MIC-000001",
          status: "paid",
          total: 10,
          currency: "BOB",
          payment_expires_at: null,
        },
      },
      false,
    ],
    [
      "pedido cancelado",
      {
        order: {
          id: "o",
          number: "MIC-000001",
          status: "cancelled",
          total: 10,
          currency: "BOB",
          payment_expires_at: null,
        },
      },
      false,
    ],
    [
      "cobro fallido (la clienta decide si reintenta)",
      {
        payment: {
          id: "p",
          status: "failed",
          provider: "manual_qr",
          method: "qr_manual",
          reference: "MIC-000001",
          amount: 10,
          currency: "BOB",
          expires_at: null,
          paid_at: null,
          under_review: false,
        },
      },
      false,
    ],
  ])("%s → %s", (_name, over, expected) => {
    expect(shouldPoll(view(over))).toBe(expected);
  });

  it("sin datos o sin cobro no se pregunta", () => {
    expect(shouldPoll(null)).toBe(false);
    expect(shouldPoll(undefined)).toBe(false);
    expect(shouldPoll(view({ payment: null }))).toBe(false);
  });
});
