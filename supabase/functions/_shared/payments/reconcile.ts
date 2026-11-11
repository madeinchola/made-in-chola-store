import type { PaymentProvider, ProviderPaymentStatus } from "./types.ts";
import type { PaymentRegistry } from "./registry.ts";

/** Un cobro abierto que merece preguntarle al proveedor cómo va (próximo a vencer o recién vencido). */
export interface ReconcilePayment {
  id: string;
  provider: string;
  status: ProviderPaymentStatus | "initiated";
  reference: string;
  amount: number;
  currency: string;
  order: { id: string; number: string; method: string };
}

export interface ReconcileDeps {
  registry: PaymentRegistry;
  /** Aplica un aviso de pago por el MISMO camino idempotente que un webhook (`payment_apply_event`). */
  apply(event: {
    provider: string;
    eventId: string;
    type: "paid" | "failed" | "refunded" | "disputed";
    reference: string;
    amount: number | null;
    currency: string;
  }): Promise<{ outcome?: string } | null>;
}

export interface ReconcileReport {
  checked: number;
  changed: number;
  errors: number;
  /** Proveedores que no pueden consultarse (no tienen API de estado): hoy ninguno de producción. */
  unsupported: number;
}

const APPLY: Partial<Record<ProviderPaymentStatus, "paid" | "failed" | "refunded">> = {
  paid: "paid",
  failed: "failed",
  refunded: "refunded",
};

/**
 * Conciliación (BR-DAT-03, criterio 3): cuando un webhook se pierde, se le pregunta al proveedor y se aplica lo que dice por
 * el mismo camino idempotente. El identificador del evento es estable por cobro y estado, así que correrla cien veces tiene un
 * solo efecto. Un proveedor que falla no detiene a los demás. Un «pagado» sin monto va a revisión (ver `amount` abajo).
 */
export async function reconcilePayments(
  payments: readonly ReconcilePayment[],
  deps: ReconcileDeps,
): Promise<ReconcileReport> {
  const report: ReconcileReport = { checked: 0, changed: 0, errors: 0, unsupported: 0 };
  for (const payment of payments) {
    const provider: PaymentProvider | null = deps.registry.get(payment.provider);
    if (!provider) {
      report.unsupported++;
      continue;
    }
    report.checked++;
    try {
      const known: ProviderPaymentStatus =
        payment.status === "initiated" ? "pending" : payment.status;
      const reported = await provider.getStatus(
        {
          id: payment.order.id,
          number: payment.order.number,
          total: payment.amount,
          currency: payment.currency,
          method: payment.order.method,
        },
        known,
      );
      const type = APPLY[reported];
      if (!type || reported === known) continue;
      const result = await deps.apply({
        provider: payment.provider,
        eventId: `reconcile:${payment.id}:${reported}`,
        type,
        reference: payment.reference,
        // NUNCA se inventa el monto: `getStatus` solo dice «pagado» (no cuánto). Con el monto esperado un pago de otro importe se
        // confirmaría como exacto y se saltaría S-06. Sin monto, la base lo manda a revisión del administrador (que lo ve en su
        // banco). Cuando un proveedor consultable informe el monto, `getStatus` lo devolverá y aquí se usará.
        amount: null,
        currency: payment.currency,
      });
      if (result && result.outcome && result.outcome !== "duplicate") report.changed++;
    } catch {
      report.errors++;
    }
  }
  return report;
}
