import { parseSignedGenericEvent } from "./webhook.ts";
import type { PaymentProvider } from "./types.ts";

/**
 * QR con confirmación automática (S11), genérico por CONTRATO: la clienta paga el mismo QR con el monto y la referencia y el
 * banco o el proveedor avisa con un webhook firmado (`webhook.ts`). El adaptador de un proveedor concreto (p. ej. CobraFácil) se
 * escribe sobre esta misma interfaz cuando haya documentación, sandbox y credenciales: hoy NO existe y no se inventa su API.
 * Sin API de consulta, `getStatus` no puede conciliar: devuelve lo que la base ya sabe.
 */
export const qrApiProvider: PaymentProvider = {
  id: "qr_api",
  async createCharge() {
    return { kind: "qr_api" };
  },
  parseWebhook: parseSignedGenericEvent,
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
