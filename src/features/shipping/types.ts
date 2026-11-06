/**
 * Contrato de `quote_shipping` (S8). La respuesta del servidor es el ÚNICO lugar donde se calcula un costo de envío: el cliente
 * solo la muestra. Los códigos de error son estables (los traduce `shipping.errors.*`); si el servidor agrega uno que esta
 * versión no conoce, llega como `unknown` y se muestra un mensaje genérico en vez de romper.
 */
export const SHIPPING_ERROR_CODES = [
  "method_not_found",
  "method_inactive",
  "currency_unsupported",
  "invalid_order_amount",
  "no_origin",
  "location_required",
  "invalid_coordinates",
  "blocked_zone",
  "coverage_not_configured",
  "out_of_coverage",
  "no_rate",
  "date_required",
  "slot_required",
  "slot_not_found",
  "slot_mismatch",
  "slot_full",
  "date_past",
  "date_blocked",
  "date_too_far",
  "date_too_soon",
] as const;
export type ShippingErrorCode = (typeof SHIPPING_ERROR_CODES)[number];

export const SHIPPING_ERROR_FIELDS = [
  "method",
  "location",
  "date",
  "slot",
  "amount",
  "currency",
  "system",
] as const;
export type ShippingErrorField = (typeof SHIPPING_ERROR_FIELDS)[number];

export interface ShippingError {
  code: ShippingErrorCode | "unknown";
  field: ShippingErrorField;
}

export type ShippingMethodKind = "delivery" | "pickup";

export interface ShippingMethodInfo {
  code: string;
  name: string;
  kind: ShippingMethodKind;
  description: string | null;
  etaMinDays: number | null;
  etaMaxDays: number | null;
}

/** Una franja de un día concreto. `date` es AAAA-MM-DD en la zona horaria del negocio (America/La_Paz); `start`/`end` HH:MM. */
export interface QuoteSlot {
  slotId: string;
  date: string;
  start: string;
  end: string;
  capacity: number;
  remaining: number;
  /** `remaining > 0`: las llenas se muestran, pero no se pueden elegir. */
  available: boolean;
}

export interface QuoteRuleInfo {
  id: string;
  name: string;
  kind: "distance" | "flat";
  priority: number;
}

/** Cómo se llegó al costo (auditable). Vacío si no hubo costo; `{ kind: "pickup" }` en el recojo. */
export interface QuoteBreakdown {
  rule: QuoteRuleInfo | null;
  straightKm: number | null;
  routeKm: number | null;
  routeFactor: number | null;
  /** Tramo aplicado (1 = el primero) o null si pasó el último y se cobró por km adicional. */
  tier: number | null;
  extraKm: number | null;
  minApplied: boolean;
  maxApplied: boolean;
  pickup: boolean;
}

export interface QuotePickup {
  name: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  hours: string | null;
}

export interface QuoteSelected {
  date: string;
  slotId: string | null;
  start: string | null;
  end: string | null;
}

export interface QuoteResult {
  ok: boolean;
  /** null SIEMPRE que `ok` es false: nunca hay un costo «0» por omisión. */
  cost: number | null;
  currency: string | null;
  method: ShippingMethodInfo | null;
  /** Distancia de RUTA (recta × factor) en km. */
  distanceKm: number | null;
  breakdown: QuoteBreakdown;
  slots: QuoteSlot[];
  selected: QuoteSelected | null;
  pickup: QuotePickup | null;
  errors: ShippingError[];
}

export interface QuoteParams {
  /** Por defecto `delivery`. */
  methodCode?: string;
  lat?: number | null;
  lng?: number | null;
  /** Ciudad de la dirección (las zonas por ciudad la comparan sin tildes ni mayúsculas). */
  city?: string | null;
  /** Subtotal del pedido: solo importa a las reglas con rango de monto. El servidor lo recalcula al crear el pedido (S10). */
  orderAmount?: number;
  currency?: string;
  /** AAAA-MM-DD. */
  deliveryDate?: string | null;
  slotId?: string | null;
  /** Días de franjas a listar (1–31; por defecto 14). */
  listDays?: number;
}
