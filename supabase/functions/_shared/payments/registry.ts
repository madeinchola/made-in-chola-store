import { cashOnDeliveryProvider } from "./cash_on_delivery.ts";
import { manualQrProvider } from "./manual_qr.ts";
import { qrApiProvider } from "./qr_api.ts";
import type { PaymentProvider } from "./types.ts";
import { whatsappProvider } from "./whatsapp.ts";

export interface PaymentRegistry {
  /** El proveedor con ese id, o null si no está implementado. */
  get(id: string): PaymentProvider | null;
  ids(): string[];
}

export function createRegistry(providers: readonly PaymentProvider[]): PaymentRegistry {
  const byId = new Map<string, PaymentProvider>();
  for (const provider of providers) {
    if (byId.has(provider.id)) {
      throw new Error(`proveedor de pago repetido: ${provider.id}`);
    }
    byId.set(provider.id, provider);
  }
  return {
    get: (id) => byId.get(id) ?? null,
    ids: () => [...byId.keys()].sort(),
  };
}

/** Los proveedores de producción. Un adaptador de CobraFácil se suma aquí cuando exista; S18, las pasarelas internacionales. */
export const defaultRegistry = (): PaymentRegistry =>
  createRegistry([whatsappProvider, cashOnDeliveryProvider, manualQrProvider, qrApiProvider]);
