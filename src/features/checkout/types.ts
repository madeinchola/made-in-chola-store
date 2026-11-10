/**
 * Contrato del checkout (S10): lo que contesta la función `checkout`. Todo importe viene ya calculado por el servidor
 * (decimales en unidades mayores): la pantalla solo les da formato, jamás suma ni recalcula.
 */

/** Qué debe hacer la pantalla para completar el pago (proveedor de pago, BR-PAY-02). Unión abierta: S11 suma `kind`. */
export type PaymentInstruction =
  { kind: "whatsapp"; phone_e164: string | null } | { kind: "cash_on_delivery" } | { kind: string };

export interface CheckoutError {
  code: string;
  field?: string;
  /** Solo en `payment_unavailable`: por qué no se puede usar ese método. */
  reason?: string | null;
}

/** Una línea de la bolsa tal como la calcula el servidor (precios vigentes, descuento y estado). */
export interface CheckoutLine {
  variant_id: string;
  product_id: string;
  name: string;
  slug: string | null;
  sku: string | null;
  color_name: string | null;
  color_hex: string | null;
  size_label: string | null;
  image_path: string | null;
  qty: number;
  billable_qty: number;
  available: number;
  status: "ok" | "price_changed" | "low_stock" | "out_of_stock" | "unavailable";
  blocking: boolean;
  price_notice: "dropped" | "guaranteed" | "expired_raised" | "expired_dropped" | null;
  unit_price: number;
  line_total: number;
  discount: number;
  final_total: number;
}

export interface PaymentMethodOption {
  code: string;
  provider: string;
  name: string;
  description: string | null;
  available: boolean;
  /** `not_available` | `over_max_amount` | null. */
  reason: string | null;
  max_amount: number | null;
  window_minutes: number | null;
}

export interface CheckoutTotals {
  subtotal: number;
  discount: number;
  /** null hasta que haya un envío cotizable. */
  shipping: number | null;
  shipping_discount: number;
  /** null mientras falte el envío: no hay total honesto sin él. */
  total: number | null;
}

export interface CheckoutPreview {
  ok: boolean;
  errors: CheckoutError[];
  currency: string;
  decimals: number;
  can_checkout: boolean;
  lines: CheckoutLine[];
  totals: CheckoutTotals;
  discounts: {
    applied: {
      discount_id: string;
      name: string;
      kind: string;
      amount: number;
      automatic: boolean;
    }[];
    coupon: { status: string; code: string | null; reason: string | null } | null;
    free_shipping: boolean;
  };
  shipping: {
    method: {
      code: string;
      name: string;
      kind: "delivery" | "pickup";
      description: string | null;
      eta_min_days: number | null;
      eta_max_days: number | null;
    } | null;
    /** Cotización cruda de `quote_shipping` (se lee con `parseQuote`). */
    quote: unknown;
    address: Record<string, unknown> | null;
    slot: { date: string; slot_id: string | null; start: string | null; end: string | null } | null;
  };
  payment: { methods: PaymentMethodOption[]; chosen: PaymentMethodOption | null };
}

export type PreviewResponse =
  { outcome: "preview"; checkout: CheckoutPreview } | { outcome: "no_cart" };

export interface OrderItemSnapshot {
  id: string;
  line_no: number;
  variant_id: string;
  product_id: string;
  product_name: string;
  color_name: string | null;
  color_hex: string | null;
  size_label: string | null;
  sku: string | null;
  image_path: string | null;
  qty: number;
  unit_price: number;
  line_total: number;
  discount: number;
  final_total: number;
}

/** El pedido recién creado, como lo guarda el servidor (instantánea, BR-ORD-06). */
export interface OrderSnapshot {
  id: string;
  number: string;
  status: string;
  currency: string;
  country: string;
  subtotal: number;
  discount_total: number;
  shipping_cost: number;
  shipping_discount: number;
  total: number;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string;
  shipping_method: { code: string; name: string; kind: "delivery" | "pickup" };
  shipping_address: {
    recipient?: string;
    line1?: string;
    line2?: string | null;
    city?: string;
    department?: string | null;
    reference_text?: string | null;
  } | null;
  delivery_slot: {
    date: string;
    slot_id: string | null;
    start: string | null;
    end: string | null;
  } | null;
  payment_method: string;
  payment_provider: string;
  coupon_code: string | null;
  created_at: string;
  items: OrderItemSnapshot[];
}

interface OrderCreatedFields {
  order: OrderSnapshot;
  payment_instruction: PaymentInstruction | null;
  payment_error: string | null;
}

export type CreateResponse =
  | ({ outcome: "created" } & OrderCreatedFields)
  // Un reintento con la misma llave de idempotencia: el mismo pedido, sin crear nada nuevo.
  | ({ outcome: "existing" } & OrderCreatedFields)
  | {
      outcome: "changed";
      reason: "total" | "price" | "discount";
      lines?: CheckoutLine[];
      totals?: CheckoutTotals;
      expected_total?: number;
      actual_total?: number;
      failed?: { reason: string }[];
    }
  | { outcome: "unavailable"; lines: CheckoutLine[]; totals?: CheckoutTotals }
  | { outcome: "rejected"; errors: CheckoutError[] };

export interface CancelResponse {
  ok: boolean;
  outcome: "transitioned" | "invalid_transition" | "not_found";
}

/** Lo que la persona eligió en el formulario (todo lo que cambia el cálculo). */
export interface CheckoutChoices {
  addressId?: string;
  taxProfileId?: string;
  shippingMethod: string;
  slotId?: string;
  deliveryDate?: string;
  paymentMethod?: string;
}
