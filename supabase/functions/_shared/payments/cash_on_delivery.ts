import type { PaymentProvider } from "./types.ts";

/** Efectivo contra entrega (BR-PAY-01): se paga al recibir. El pedido nace `pending_payment` y lo confirma el admin (S-05). */
export const cashOnDeliveryProvider: PaymentProvider = {
  id: "cash_on_delivery",
  async createCharge() {
    return { kind: "cash_on_delivery" };
  },
  async handleWebhook() {
    return { handled: false };
  },
  async refund() {
    return { ok: true, manual: true };
  },
  async getStatus(_order, known) {
    return known;
  },
};
