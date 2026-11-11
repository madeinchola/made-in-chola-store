/**
 * Capa de pagos (BR-PAY-02): el flujo del checkout NO conoce a los proveedores. Cada método de pago (tabla `payment_methods`)
 * nombra un `provider`; aquí se resuelve la implementación. Añadir un proveedor (QR manual, CobraFácil, Stripe…) es escribir una
 * clase y registrarla: ni el checkout ni la base cambian.
 *
 * S10 implementa `whatsapp` y `cash_on_delivery` (no mueven dinero: son instrucciones). S11 añade los proveedores con webhooks
 * (`handleWebhook`) y S12 los reembolsos (`refund`); por eso la interfaz ya los declara.
 */
export interface PaymentOrder {
  id: string;
  number: string;
  total: number;
  currency: string;
  /** Código del método elegido (`payment_methods.code`), p. ej. «whatsapp». */
  method: string;
}

export interface ChargeContext {
  order: PaymentOrder;
  /** Lee un ajuste de la tienda (p. ej. el WhatsApp de pedidos). */
  setting: (key: string) => Promise<string | null>;
}

/** Lo que la pantalla debe mostrar o hacer para completar el pago. Es una unión abierta: cada proveedor suma su `kind`. */
export type PaymentInstruction =
  | { kind: "whatsapp"; phone_e164: string | null }
  | { kind: "cash_on_delivery" }
  // QR (S11): la pantalla trae el QR, la cuenta, el monto y la referencia con `customer_payment_view`; aquí no viaja nada.
  | { kind: "manual_qr" }
  | { kind: "qr_api" }
  | { kind: "fake"; reference: string };

export type ProviderPaymentStatus = "pending" | "paid" | "failed" | "cancelled" | "refunded";

export interface WebhookRequest {
  headers: Record<string, string>;
  /** El cuerpo CRUDO, tal como llegó (la firma se calcula sobre estos bytes, no sobre un JSON re-serializado). */
  body: string;
}

/** Lo que un aviso de pago le dice al sistema, ya en términos internos. */
export interface PaymentEvent {
  eventId: string;
  type: "paid" | "failed" | "disputed" | "refunded";
  reference: string;
  amount: number | null;
  currency: string | null;
  externalId: string | null;
}
export type ParsedWebhook =
  { ok: true; event: PaymentEvent } | { ok: false; reason: string; status: 400 | 401 | 503 };
export interface WebhookResult {
  handled: boolean;
  order_id?: string;
  status?: ProviderPaymentStatus;
}
export interface RefundRequest {
  order: PaymentOrder;
  amount: number;
  reason?: string;
}
export interface RefundResult {
  ok: boolean;
  /** true = el dinero se devuelve a mano (no hay proveedor que lo haga). */
  manual: boolean;
  reference?: string;
}

export interface PaymentProvider {
  readonly id: string;
  createCharge(ctx: ChargeContext): Promise<PaymentInstruction>;
  /**
   * Verifica la firma y entiende un aviso de pago. Solo los proveedores que avisan por webhook lo implementan. Nunca lanza:
   * un aviso malo es un resultado (`ok: false`) para que quede registrado.
   */
  parseWebhook?(
    req: WebhookRequest,
    ctx: { secret: string | null; nowSeconds: number },
  ): Promise<ParsedWebhook>;
  handleWebhook(req: WebhookRequest): Promise<WebhookResult>;
  refund(req: RefundRequest): Promise<RefundResult>;
  /** Estado según el proveedor; los que no tienen proveedor externo devuelven el que ya conoce la base. */
  getStatus(order: PaymentOrder, known: ProviderPaymentStatus): Promise<ProviderPaymentStatus>;
}
