/** Tipos del panel de Pagos (S11). Los importes llegan como número desde la base; aquí solo se muestran. */
export type PaymentStatus =
  "initiated" | "pending" | "paid" | "failed" | "cancelled" | "expired" | "refunded" | "disputed";

export type ReviewReason =
  "late" | "duplicate" | "amount_mismatch" | "disputed" | "provider_refund";

export interface PendingProof {
  id: string;
  paymentId: string;
  orderId: string;
  filePath: string;
  fileHash: string;
  mime: string;
  sizeBytes: number;
  /** Otro comprobante con el MISMO archivo (reutilizado en otro cobro). */
  duplicateOf: string | null;
  createdAt: string;
  reference: string;
  amount: number;
  currency: string;
  orderNumber: string;
  contactName: string;
  contactPhone: string;
}

export interface OpenReview {
  id: string;
  paymentId: string;
  reason: ReviewReason;
  detail: Record<string, unknown>;
  openedAt: string;
  reference: string;
  amount: number;
  receivedAmount: number | null;
  currency: string;
  paymentStatus: PaymentStatus;
  orderNumber: string;
  orderStatus: string;
  contactName: string;
}

export interface PaymentRow {
  id: string;
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  contactName: string;
  provider: string;
  method: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  reference: string;
  attempt: number;
  createdAt: string;
  expiresAt: string | null;
  paidAt: string | null;
  receivedAmount: number | null;
  externalId: string | null;
}

export interface PaymentEvent {
  id: number;
  provider: string;
  eventId: string | null;
  outcome: string | null;
  error: string | null;
  attempts: number;
  receivedAt: string;
  signatureValid: boolean;
}

export interface ProofHistoryRow {
  id: string;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  mime: string;
  filePath: string;
}

export interface PaymentFilters {
  status: PaymentStatus | "all";
  provider: string | "all";
  page: number;
}

export interface MethodRow {
  id: string;
  country: string;
  code: string;
  provider: string;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  maxAmount: number | null;
  windowMinutes: number | null;
  blockedForBlacklisted: boolean;
  accountDetails: string | null;
  qrImagePath: string | null;
  archivedAt: string | null;
  updatedAt: string;
}

export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "initiated",
  "pending",
  "paid",
  "failed",
  "cancelled",
  "expired",
  "refunded",
  "disputed",
];
export const PAGE_SIZE = 25;
