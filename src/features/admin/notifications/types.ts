export type NotificationStatus =
  "pending" | "sending" | "sent" | "failed" | "dead" | "cancelled" | "manual";
export type NotificationChannel = "email" | "whatsapp";

export const NOTIFICATION_STATUSES: readonly NotificationStatus[] = [
  "pending",
  "manual",
  "dead",
  "failed",
  "sending",
  "sent",
  "cancelled",
];
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ["email", "whatsapp"];

/** Tipos de aviso que existen hoy (el del registro y las plantillas hablan de estos). */
export const NOTIFICATION_TYPES: readonly string[] = [
  "order_created",
  "order_confirmed",
  "order_packed",
  "order_shipped",
  "order_delivered",
  "order_completed",
  "order_cancelled",
  "order_refunded",
  "order_edited",
  "order_refund_processed",
  "payment_failed",
  "payment_expiring",
  "payment_proof_rejected",
  "order_new",
  "order_cancelled_by_customer",
  "order_pending_reminder",
  "payment_review_needed",
  "payment_unknown_reference",
  "payment_proof_received",
  "stock_alert",
  "notification_dead",
  "template_fallback",
  "webhook_signature_invalid",
];

export interface NotificationRow {
  id: number;
  type: string;
  channel: NotificationChannel;
  /** `null` = alerta interna para los administradores. */
  recipient: string | null;
  status: NotificationStatus;
  attempts: number;
  nextRetryAt: string;
  sentAt: string | null;
  lastError: string | null;
  provider: string | null;
  providerMessageId: string | null;
  orderId: string | null;
  orderNumber: string | null;
  profileId: string | null;
  resentOf: number | null;
  renderedSubject: string | null;
  renderedBody: string | null;
  createdAt: string;
}

export interface NotificationFilters {
  status: NotificationStatus | "all";
  channel: NotificationChannel | "all";
  type: string;
  search: string;
  page: number;
}

export const DEFAULT_FILTERS: NotificationFilters = {
  status: "all",
  channel: "all",
  type: "all",
  search: "",
  page: 0,
};
export const PAGE_SIZE = 25;

export interface NotificationPage {
  rows: NotificationRow[];
  total: number;
}

export type NotificationCounts = Partial<Record<NotificationStatus, number>>;

export interface NotificationHealth {
  enabled: boolean;
  emailProvider: string;
  fromEmailSet: boolean;
  whatsappMode: string;
  workerConfigured: boolean;
  due: number;
  oldestDueMinutes: number | null;
  lastSentAt: string | null;
  recipients: number;
}

export type TemplateAudience = "customer" | "admin";

export interface TemplateRow {
  id: number;
  key: string;
  channel: NotificationChannel;
  locale: string;
  audience: TemplateAudience;
  subject: string;
  body: string;
  ctaLabel: string | null;
  active: boolean;
  isDefault: boolean;
  updatedAt: string;
}

export interface TemplateDraft {
  subject: string;
  body: string;
  ctaLabel: string;
  active: boolean;
}

export type PreviewError =
  | "syntax"
  | "subject_required"
  | "subject_too_long"
  | "subject_multiline"
  | "body_required"
  | "body_too_long"
  | "unknown_variable";

export interface PreviewResult {
  ok: boolean;
  errors: PreviewError[];
  unknown: string[];
  warnings: ("whatsapp_truncated" | "no_cta_url")[];
  subject: string;
  text: string;
  html: string | null;
  length: number;
}

export interface VariableInfo {
  name: string;
  description: string;
  audience: "customer" | "admin" | "both";
}

export interface PreviewResponse {
  preview: PreviewResult;
  variables: VariableInfo[];
}

/** Respuesta de las funciones SQL de acciones sobre un aviso. */
export interface ActionResult {
  outcome: string;
  id?: number;
  status?: string;
}
