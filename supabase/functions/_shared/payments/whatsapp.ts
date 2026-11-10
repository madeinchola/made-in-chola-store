import type { PaymentProvider } from "./types.ts";

/**
 * Pedido por WhatsApp (BR-CHK-02, Bolivia): el pedido se crea `pending_payment` y la clienta lo envía por WhatsApp; el pago y la
 * entrega se acuerdan por ahí y el admin lo confirma (S-05). No hay dinero que mover desde aquí: devuelve el número al que abrir
 * el chat. El mensaje lo arma la pantalla con los datos del pedido (solo lo necesario, sin datos sensibles).
 */
export const whatsappProvider: PaymentProvider = {
  id: "whatsapp",
  async createCharge(ctx) {
    return {
      kind: "whatsapp",
      phone_e164: await ctx.setting("whatsapp_orders"),
    };
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
