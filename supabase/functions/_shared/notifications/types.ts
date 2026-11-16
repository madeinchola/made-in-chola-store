/** Tipos compartidos de las notificaciones (S13). */

export type Channel = "email" | "whatsapp";

/** Una fila de `notification_outbox` tal como la entrega `claim_notifications`. */
export interface OutboxRow {
  id: number;
  type: string;
  channel: Channel;
  /** `null` = alerta interna: la reciben los administradores. */
  recipient: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  template: string | null;
  order_id: string | null;
  profile_id: string | null;
  dedupe_key: string;
}

export interface TemplateRow {
  key: string;
  channel: Channel;
  locale: string;
  audience: "customer" | "admin";
  subject: string;
  body: string;
  cta_label: string | null;
  active: boolean;
}

/** Lo que el worker consulta de la base para armar el mensaje (no viaja en la cola: sin datos personales en el payload). */
export interface RowContext {
  /** Nombre completo de la clienta (de su perfil); solo se usa el primer nombre. */
  customerName: string | null;
  currency: { symbol: string; decimals: number } | null;
  /** Vencimiento del cobro abierto del pedido (avisos de pago por vencer). */
  paymentExpiresAt: string | null;
}

export interface SiteContext {
  /** Dirección pública de la tienda, sin barra final (para los enlaces del mensaje). */
  siteUrl: string;
  storeName: string;
}

export type Outcome = "sent" | "retry" | "failed" | "manual" | "cancelled";

export interface CompleteInfo {
  provider?: string | null;
  messageId?: string | null;
  /** Código corto del error (nunca datos personales). */
  error?: string | null;
  retryAfterSeconds?: number | null;
  /** Lo que se envió (texto plano), para el registro del panel. */
  subject?: string | null;
  body?: string | null;
}
