import type { PaymentRegistry } from "./registry.ts";
import type { PaymentInstruction, PaymentOrder } from "./types.ts";

/** El pedido que se acaba de crear (o recuperar por un reintento), tal como lo devuelve `create_order`. */
export interface ChargeableOrder extends PaymentOrder {
  /** Proveedor del método de pago elegido (`payment_methods.provider`). */
  provider: string;
}

export type ChargeProblem = "provider_unavailable" | "provider_failed";

export interface ChargeOutcome {
  /** Lo que la pantalla debe hacer para completar el pago; null si no se pudo preparar. */
  instruction: PaymentInstruction | null;
  /** null si todo salió bien. */
  problem: ChargeProblem | null;
  /** Texto técnico del fallo, solo para el registro del servidor (nunca para el cliente). */
  cause?: string;
}

/**
 * Pide al proveedor del método de pago la instrucción para completar el pedido. NUNCA lanza: el pedido YA existe cuando se
 * llega aquí, así que un proveedor ausente (método configurado con un proveedor que no está implementado) o que falla se
 * convierte en un `problem` que la pantalla avisa sin perder el pedido.
 */
export async function completeCharge(
  registry: PaymentRegistry,
  order: ChargeableOrder,
  setting: (key: string) => Promise<string | null>,
): Promise<ChargeOutcome> {
  const provider = registry.get(order.provider);
  if (!provider) {
    return {
      instruction: null,
      problem: "provider_unavailable",
      cause: order.provider,
    };
  }
  try {
    const instruction = await provider.createCharge({
      order: {
        id: order.id,
        number: order.number,
        total: order.total,
        currency: order.currency,
        method: order.method,
      },
      setting,
    });
    return { instruction, problem: null };
  } catch (error) {
    return {
      instruction: null,
      problem: "provider_failed",
      cause: String(error),
    };
  }
}
