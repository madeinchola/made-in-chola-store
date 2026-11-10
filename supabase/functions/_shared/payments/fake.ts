import type { PaymentProvider, ProviderPaymentStatus } from "./types.ts";

/**
 * Proveedor FALSO solo para probar el flujo genérico (contrato de `PaymentProvider`): NO está en el registro de producción.
 * Se le puede decir qué estado responde para ejercitar los caminos de pago, fallo y reembolso sin un proveedor real.
 */
export function createFakeProvider(
  state: { status: ProviderPaymentStatus; failCharge?: boolean } = {
    status: "pending",
  },
): PaymentProvider {
  return {
    id: "fake",
    async createCharge(ctx) {
      if (state.failCharge) {
        throw new Error("el proveedor falso falló a propósito");
      }
      return { kind: "fake", reference: `fake-${ctx.order.number}` };
    },
    async handleWebhook(req) {
      const parsed = JSON.parse(req.body) as {
        order_id?: string;
        status?: ProviderPaymentStatus;
      };
      return {
        handled: true,
        order_id: parsed.order_id,
        status: parsed.status ?? state.status,
      };
    },
    async refund(req) {
      return {
        ok: req.amount > 0 && req.amount <= req.order.total,
        manual: false,
        reference: `refund-${req.order.number}`,
      };
    },
    async getStatus() {
      return state.status;
    },
  };
}
