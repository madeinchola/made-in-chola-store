import type { PaymentProvider } from "./types.ts";

/**
 * QR manual (S11): la tienda tiene UN QR de su banco; la clienta lo escanea, paga el monto exacto, sube la foto del
 * comprobante y el administrador la aprueba o la rechaza. No hay proveedor externo: no avisa, no reembolsa por sí mismo.
 */
export const manualQrProvider: PaymentProvider = {
  id: "manual_qr",
  async createCharge() {
    return { kind: "manual_qr" };
  },
  async handleWebhook() {
    return { handled: false };
  },
  async refund() {
    // El dinero se devuelve a mano desde el banco (lo registra S12).
    return { ok: true, manual: true };
  },
  async getStatus(_order, known) {
    return known;
  },
};
