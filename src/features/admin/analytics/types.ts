/** Tipos de las métricas del negocio (S14). Los números llegan de la base ya calculados: aquí no se recalcula nada. */

export type Granularity = "day" | "week" | "month";

/** Indicadores de UNA moneda en UN período. `null` = desconocido (nunca un cero que engañe). */
export interface Kpis {
  orders: number;
  units: number;
  gross: number;
  discounts: number;
  shipping: number;
  refunds: number;
  net: number;
  avg_ticket: number | null;
  product_revenue: number;
  margin_revenue: number | null;
  margin: number | null;
  margin_pct: number | null;
  costed_orders: number;
  cost_coverage_pct: number | null;
  incident_cost: number;
  profit: number | null;
}

export interface SeriesPoint {
  /** Primer día del cubo (día, lunes de la semana o primero del mes), `AAAA-MM-DD`. */
  bucket: string;
  orders: number;
  gross: number;
  net: number;
  margin: number | null;
}

export interface CurrencySummary {
  currency: string;
  current: Kpis;
  /** Vacío si esa moneda no tuvo movimiento en el período anterior. */
  previous: Partial<Kpis>;
  series: SeriesPoint[];
}

export interface ConsolidatedBlock {
  orders: number;
  gross: number;
  net: number;
}

export interface SalesSummary {
  range: { from: string; to: string; days: number; timezone: string };
  previous: { from: string; to: string };
  granularity: Granularity;
  currencies: CurrencySummary[];
  consolidated: { currency: string; current: ConsolidatedBlock; previous: ConsolidatedBlock };
  /** Lo que NO es venta, contado aparte. */
  other: { cancelled: number; refunded_full: number; pending: number };
}

export interface DateRange {
  from: string;
  to: string;
}

export type RangePreset = "today" | "7d" | "30d" | "month" | "last_month" | "custom";

export interface TopProduct {
  productId: string;
  name: string;
  code: string | null;
  archived: boolean;
  units: number;
  revenue: number;
  orders: number;
  currency: string;
}

export type BreakdownDimension =
  "category" | "collection" | "variant" | "payment_method" | "channel";

export interface BreakdownRow {
  key: string;
  label: string | null;
  units: number;
  revenue: number;
  orders: number;
  currency: string;
}

export interface PaymentMixRow {
  currency: string;
  paymentMethod: string;
  orders: number;
  gross: number;
  net: number;
}

export interface Funnel {
  carts: number;
  carts_with_items: number;
  orders: number;
  paid: number;
}

export interface InventorySummary {
  currency: string;
  variants: number;
  units: number;
  value: number;
  variants_without_cost: number;
  ok: number;
  low: number;
  critical: number;
  out: number;
}

export interface SlowMover {
  productId: string;
  name: string;
  code: string | null;
  stockOnHand: number;
  lastSoldAt: string | null;
  daysSinceSale: number | null;
}

export interface CoverageRow {
  variantId: string;
  productId: string;
  productName: string;
  sku: string | null;
  colorName: string | null;
  sizeLabel: string | null;
  stockOnHand: number;
  unitsSold: number;
  dailyRate: number;
  daysOfCover: number;
}
