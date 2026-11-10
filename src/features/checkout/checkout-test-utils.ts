/* Utilidades SOLO de pruebas del checkout: arman respuestas del servidor con valores escritos a mano. */
import type { Address } from "@/features/account/addresses/types";
import type { OrderRow } from "@/features/account/orders/ordersApi";
import type { ShippingMethodOption } from "./checkoutHooks";
import type {
  CheckoutChoices,
  CheckoutPreview,
  CreateResponse,
  OrderSnapshot,
  PaymentMethodOption,
} from "./types";

export const ADDRESS: Address = {
  id: "ad-1",
  profileId: "user-1",
  label: "Casa",
  recipient: "Ana Pérez",
  phone: "+59171234567",
  line1: "Calle 1",
  line2: null,
  city: "La Paz",
  department: null,
  country: "BO",
  referenceText: null,
  lat: -16.52,
  lng: -68.15,
  isDefault: true,
  forShipping: true,
  forBilling: false,
  archivedAt: null,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
};

export const METHODS: ShippingMethodOption[] = [
  {
    code: "delivery",
    name: "Entrega a domicilio",
    kind: "delivery",
    description: null,
    etaMin: 1,
    etaMax: 2,
    pickupName: null,
    pickupAddress: null,
    pickupCity: null,
    pickupHours: null,
  },
  {
    code: "recojo",
    name: "Recojo en el taller",
    kind: "pickup",
    description: null,
    etaMin: null,
    etaMax: null,
    pickupName: "Taller",
    pickupAddress: "Calle Ejemplo 1",
    pickupCity: "La Paz",
    pickupHours: "Lun a vie 9:00 a 18:00",
  },
];

export const PAYMENT: PaymentMethodOption[] = [
  {
    code: "whatsapp",
    provider: "whatsapp",
    name: "Pedir por WhatsApp",
    description: "Envías tu pedido por WhatsApp.",
    available: true,
    reason: null,
    max_amount: null,
    window_minutes: null,
  },
  {
    code: "cash_on_delivery",
    provider: "cash_on_delivery",
    name: "Efectivo contra entrega",
    description: "Pagas al recibir.",
    available: true,
    reason: null,
    max_amount: null,
    window_minutes: null,
  },
];

/** La cotización cruda de `quote_shipping` (lo que viaja en `shipping.quote`). */
export const rawQuote = (over: Record<string, unknown> = {}) => ({
  ok: true,
  cost: 15,
  currency: "BOB",
  method: {
    code: "delivery",
    name: "Entrega a domicilio",
    kind: "delivery",
    description: null,
    eta_min_days: 1,
    eta_max_days: 2,
  },
  distance_km: 2.89,
  breakdown: {},
  slots: [],
  selected: null,
  errors: [],
  ...over,
});

/**
 * Lo que respondería el servidor para esta bolsa (2 × 100,00): con domicilio y dirección, envío 15,00 → total 215,00; con
 * recojo, envío 0 → 200,00; con domicilio sin dirección, no hay envío ni total. (La lógica real está en pgTAP e integración.)
 */
export function previewFor(
  choices: CheckoutChoices,
  over: Partial<CheckoutPreview> = {},
  methods: PaymentMethodOption[] = PAYMENT,
): CheckoutPreview {
  const pickup = choices.shippingMethod === "recojo";
  const hasAddress = pickup || Boolean(choices.addressId);
  const shipping = !hasAddress ? null : pickup ? 0 : 15;
  const total = shipping === null ? null : 200 + shipping;
  return {
    ok: hasAddress,
    errors: hasAddress ? [] : [{ code: "address_required", field: "address" }],
    currency: "BOB",
    decimals: 2,
    can_checkout: true,
    lines: [
      {
        variant_id: "v1",
        product_id: "p-v1",
        name: "Chaqueta v1",
        slug: "chaqueta-v1",
        sku: null,
        color_name: "Negro",
        color_hex: "#1F1F1F",
        size_label: "M",
        image_path: null,
        qty: 2,
        billable_qty: 2,
        available: 10,
        status: "ok",
        blocking: false,
        price_notice: null,
        unit_price: 100,
        line_total: 200,
        discount: 0,
        final_total: 200,
      },
    ],
    totals: { subtotal: 200, discount: 0, shipping, shipping_discount: 0, total },
    discounts: { applied: [], coupon: null, free_shipping: false },
    shipping: {
      method: pickup
        ? {
            code: "recojo",
            name: "Recojo en el taller",
            kind: "pickup",
            description: null,
            eta_min_days: null,
            eta_max_days: null,
          }
        : {
            code: "delivery",
            name: "Entrega a domicilio",
            kind: "delivery",
            description: null,
            eta_min_days: 1,
            eta_max_days: 2,
          },
      quote: pickup ? rawQuote({ cost: 0 }) : rawQuote(),
      address: null,
      slot: null,
    },
    payment: {
      methods,
      chosen: methods.find((m) => m.code === choices.paymentMethod) ?? null,
    },
    ...over,
  };
}

export function makeOrder(over: Partial<OrderSnapshot> = {}): OrderSnapshot {
  return {
    id: "o-1",
    number: "MIC-000123",
    status: "pending_payment",
    currency: "BOB",
    country: "BO",
    subtotal: 200,
    discount_total: 0,
    shipping_cost: 15,
    shipping_discount: 0,
    total: 215,
    contact_name: "Ana Pérez",
    contact_email: "ana@test.com",
    contact_phone: "+59171234567",
    shipping_method: { code: "delivery", name: "Entrega a domicilio", kind: "delivery" },
    shipping_address: { recipient: "Ana Pérez", line1: "Calle 1", line2: null, city: "La Paz" },
    delivery_slot: null,
    payment_method: "whatsapp",
    payment_provider: "whatsapp",
    coupon_code: null,
    created_at: "2026-11-09T15:30:00Z",
    items: [
      {
        id: "i1",
        line_no: 1,
        variant_id: "v1",
        product_id: "p-v1",
        product_name: "Chaqueta v1",
        color_name: "Negro",
        color_hex: null,
        size_label: "M",
        sku: null,
        image_path: null,
        qty: 2,
        unit_price: 100,
        line_total: 200,
        discount: 0,
        final_total: 200,
      },
    ],
    ...over,
  };
}

export const createdResponse = (over: Partial<OrderSnapshot> = {}): CreateResponse => ({
  outcome: "created",
  order: makeOrder(over),
  payment_instruction: { kind: "whatsapp", phone_e164: "+59167528677" },
  payment_error: null,
});

/** Un pedido como lo lee «Mis pedidos» de la base (fila de `orders` con sus líneas y su historial). */
export function makeRow(over: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    number: "MIC-000123",
    status: "pending_payment",
    currency: "BOB",
    subtotal: 200,
    discount_total: 0,
    shipping_cost: 15,
    shipping_discount: 0,
    total: 215,
    contact_name: "Ana Pérez",
    shipping_method: { code: "delivery", name: "Entrega a domicilio", kind: "delivery" },
    shipping_address: { line1: "Calle 1", line2: null, city: "La Paz" },
    delivery_slot: null,
    payment_method: "whatsapp",
    coupon_code: null,
    created_at: "2026-11-09T15:30:00Z",
    order_items: [
      {
        id: "i1",
        line_no: 1,
        product_name: "Chaqueta v1",
        color_name: "Negro",
        size_label: "M",
        qty: 2,
        unit_price: 100,
        final_total: 200,
      },
    ],
    order_status_history: [
      { id: 1, to_status: "pending_payment", created_at: "2026-11-09T15:30:00Z" },
    ],
    ...over,
  };
}
