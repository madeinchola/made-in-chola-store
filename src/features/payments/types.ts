/**
 * Lo que la clienta ve de su pago (S11): el contrato de la función SQL `customer_payment_view`. La clienta no lee las tablas de
 * pagos ni de comprobantes: este es todo el contrato, y el servidor decide qué incluye.
 */
export type PaymentStatus =
  "initiated" | "pending" | "paid" | "failed" | "cancelled" | "expired" | "refunded" | "disputed";

export type ProofStatus = "pending" | "approved" | "rejected";

export interface PaymentViewOrder {
  id: string;
  number: string;
  status: string;
  total: number;
  currency: string;
  paymentExpiresAt: string | null;
}

export interface PaymentViewPayment {
  id: string;
  status: PaymentStatus;
  provider: string;
  method: string;
  reference: string;
  amount: number;
  currency: string;
  expiresAt: string | null;
  paidAt: string | null;
  underReview: boolean;
}

export interface PaymentViewMethod {
  code: string;
  name: string;
  description: string | null;
  accountDetails: string | null;
  qrImagePath: string | null;
}

export interface PaymentViewProof {
  status: ProofStatus;
  reason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  mime: string;
}

export interface PaymentView {
  /** La hora del SERVIDOR cuando se armó la respuesta (la cuenta regresiva no se fía del reloj del aparato). */
  serverNow: string;
  order: PaymentViewOrder;
  payment: PaymentViewPayment | null;
  method: PaymentViewMethod | null;
  proof: PaymentViewProof | null;
  canUpload: boolean;
  canRetry: boolean;
}

/** En qué punto va el pago, en palabras de la pantalla (una sola etiqueta por vista). */
export type PaymentStage =
  | "awaiting"
  | "proof_pending"
  | "proof_rejected"
  | "in_review"
  | "paid"
  | "failed"
  | "expired"
  | "cancelled"
  | "late"
  | "late_done"
  | "disputed"
  | "refunded";

export const QR_PROVIDERS: readonly string[] = ["manual_qr", "qr_api"];
