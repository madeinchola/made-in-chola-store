/** Tipos del panel de Pedidos (S12). Los importes llegan como número desde la base; aquí solo se muestran. */
export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "preparing",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
  "refunded",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_CHANNELS = ["web", "manual", "whatsapp"] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const PAGE_SIZE = 25;

export interface OrderFilters {
  status: OrderStatus | "all";
  /** Número, nombre o teléfono. */
  search: string;
  /** Código del método de pago (`whatsapp`, `cash_on_delivery`, `qr_manual`…). */
  method: string;
  channel: OrderChannel | "all";
  /** Fechas `YYYY-MM-DD` (hora de La Paz); vacío = sin límite. */
  from: string;
  to: string;
  page: number;
}

export const DEFAULT_FILTERS: OrderFilters = {
  status: "all",
  search: "",
  method: "all",
  channel: "all",
  from: "",
  to: "",
  page: 0,
};

export interface OrderRow {
  id: string;
  number: string;
  status: OrderStatus;
  channel: OrderChannel;
  contactName: string;
  contactPhone: string;
  total: number;
  currency: string;
  paymentMethod: string;
  paymentProvider: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  id: string;
  lineNo: number;
  variantId: string;
  productId: string;
  name: string;
  colorName: string | null;
  sizeLabel: string | null;
  sku: string | null;
  imagePath: string | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  discount: number;
  finalTotal: number;
}

export interface OrderAddress {
  recipient: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  department: string | null;
  country: string;
  reference: string | null;
  lat: number | null;
  lng: number | null;
}

export interface OrderDetail extends OrderRow {
  profileId: string;
  subtotal: number;
  discountTotal: number;
  shippingCost: number;
  shippingDiscount: number;
  contactEmail: string | null;
  shippingKind: "delivery" | "pickup" | null;
  shippingName: string | null;
  address: OrderAddress | null;
  slot: { date: string | null; start: string | null; end: string | null } | null;
  couponCode: string | null;
  paymentExpiresAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelledBy: string | null;
  editCount: number;
  editedAt: string | null;
  items: OrderItem[];
}

export interface HistoryEntry {
  id: number;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorKind: "customer" | "admin" | "system";
  actorName: string | null;
  reason: string | null;
  createdAt: string;
}

export type PaymentStatus =
  "initiated" | "pending" | "paid" | "failed" | "cancelled" | "expired" | "refunded" | "disputed";

export interface OrderPayment {
  id: string;
  provider: string;
  method: string;
  status: PaymentStatus;
  amount: number;
  receivedAmount: number | null;
  currency: string;
  reference: string;
  attempt: number;
  paidAt: string | null;
  collectedAt: string | null;
}

export interface ProofSummary {
  id: string;
  paymentId: string;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  createdAt: string;
  mime: string;
  filePath: string;
}

export type RefundStatus = "requested" | "approved" | "processed" | "rejected";
export type RefundKind = "cancel" | "items" | "amount" | "provider";

export interface RefundRow {
  id: string;
  orderId: string;
  kind: RefundKind;
  amount: number;
  shippingAmount: number;
  deduction: number;
  currency: string;
  reason: string;
  status: RefundStatus;
  method: string;
  destination: string | null;
  externalRef: string | null;
  returnId: string | null;
  createdAt: string;
  processedAt: string | null;
  decisionNote: string | null;
}

export type ReturnStatus = "open" | "closed" | "rejected";
export type RestockChoice = "yes" | "no" | "inspection";
export const RETURN_REASONS = [
  "damaged",
  "wrong_size",
  "not_as_described",
  "changed_mind",
  "other",
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export interface ReturnItem {
  id: string;
  orderItemId: string;
  qty: number;
  reasonCode: ReturnReason;
  restock: RestockChoice;
  restockedAt: string | null;
}
export interface ReturnRow {
  id: string;
  orderId: string;
  status: ReturnStatus;
  reason: string;
  outsideWindow: boolean;
  overrideReason: string | null;
  openedAt: string;
  closedAt: string | null;
  closeNote: string | null;
  items: ReturnItem[];
}

export const INCIDENT_TYPES = ["lost", "damaged", "wrong_address", "absent", "rejected"] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];
export type IncidentStatus = "open" | "investigating" | "resolved";
export const COST_BEARERS = ["store", "customer", "carrier", "none"] as const;
export type CostBearer = (typeof COST_BEARERS)[number];

export interface IncidentRow {
  id: string;
  orderId: string;
  orderNumber: string;
  contactName: string;
  type: IncidentType;
  status: IncidentStatus;
  description: string | null;
  costAssumed: number;
  costBorneBy: CostBearer;
  resolution: string | null;
  openedAt: string;
  resolvedAt: string | null;
}

export interface NoteRow {
  id: number;
  body: string;
  authorName: string | null;
  createdAt: string;
}

export interface EditRow {
  id: number;
  reason: string;
  actorName: string | null;
  createdAt: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  diff: Record<string, unknown>;
}

export interface BlacklistRow {
  id: string;
  kind: "profile" | "phone" | "email";
  profileId: string | null;
  profileName: string | null;
  phone: string | null;
  email: string | null;
  reason: string;
  isActive: boolean;
  sourceOrderId: string | null;
  createdAt: string;
  liftedAt: string | null;
  liftReason: string | null;
}

export interface BlacklistMatch {
  profileId: string;
  fullName: string;
  blacklisted: boolean;
  reasons: ("same_phone" | "same_email" | "same_address")[];
}

export const ATTENTION_KINDS = [
  "stale_pending",
  "proof_pending",
  "review_open",
  "payment_disputed",
  "refund_pending",
  "refund_due",
  "balance_due",
  "cod_uncollected",
  "incident_open",
  "return_open",
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export interface AttentionItem {
  kind: AttentionKind;
  orderId: string;
  number: string;
  status: OrderStatus;
  contactName: string;
  total: number;
  currency: string;
  createdAt: string;
  since: string;
  detail: Record<string, unknown>;
}

/** Respuesta común de las funciones de administración: un `outcome` y, a veces, errores con código. */
export interface RpcResult {
  outcome?: string;
  ok?: boolean;
  errors?: { code: string; [key: string]: unknown }[];
  [key: string]: unknown;
}
