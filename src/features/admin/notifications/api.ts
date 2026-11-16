import { fromDbError } from "@/lib/db-errors";
import { callFunction } from "@/lib/functions";
import { AppError, type AppErrorCode } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { t } from "@/i18n";
import { updateVersioned } from "../lib/versioned";
import { searchTerm } from "./logic";
import {
  PAGE_SIZE,
  type ActionResult,
  type NotificationChannel,
  type NotificationCounts,
  type NotificationFilters,
  type NotificationHealth,
  type NotificationPage,
  type NotificationRow,
  type NotificationStatus,
  type PreviewResponse,
  type TemplateAudience,
  type TemplateDraft,
  type TemplateRow,
} from "./types";

/**
 * Acceso a datos del panel de Notificaciones. El administrador LEE la cola y las plantillas (RLS); cambiar un aviso (reenviar,
 * marcar enviado, descartar) lo hacen funciones SQL que exigen ser admin por dentro y no dejan escribir directo. Las plantillas se
 * editan con control de versión. La vista previa y el envío de prueba pasan por la función `notify-admin`: el mismo código que
 * arma el mensaje real.
 */
type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const obj = (v: unknown): Row =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Row) : {};

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await (
    getSupabase().rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>
  )(name, args);
  if (error) throw fromDbError(error as { message: string; code?: string });
  return data as T;
}

// ── Registro ────────────────────────────────────────────────────────────────────────────
const LOG_COLUMNS =
  "id, type, channel, recipient, status, attempts, next_retry_at, sent_at, last_error, provider, provider_message_id, order_id, profile_id, resent_of, rendered_subject, rendered_body, created_at, payload";

const mapRow = (r: Row): NotificationRow => ({
  id: num(r.id),
  type: str(r.type),
  channel: str(r.channel) as NotificationChannel,
  recipient: strOrNull(r.recipient),
  status: str(r.status) as NotificationStatus,
  attempts: num(r.attempts),
  nextRetryAt: str(r.next_retry_at),
  sentAt: strOrNull(r.sent_at),
  lastError: strOrNull(r.last_error),
  provider: strOrNull(r.provider),
  providerMessageId: strOrNull(r.provider_message_id),
  orderId: strOrNull(r.order_id),
  orderNumber: strOrNull(obj(r.payload).number),
  profileId: strOrNull(r.profile_id),
  resentOf: numOrNull(r.resent_of),
  renderedSubject: strOrNull(r.rendered_subject),
  renderedBody: strOrNull(r.rendered_body),
  createdAt: str(r.created_at),
});

export async function listNotifications(filters: NotificationFilters): Promise<NotificationPage> {
  let query = getSupabase()
    .from("notification_outbox")
    .select(LOG_COLUMNS, { count: "exact" })
    .order("id", { ascending: false });
  if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.channel !== "all") query = query.eq("channel", filters.channel);
  if (filters.type !== "all") query = query.eq("type", filters.type);
  const term = searchTerm(filters.search);
  if (term !== "") query = query.or(`recipient.ilike.%${term}%,payload->>number.ilike.%${term}%`);
  const from = filters.page * PAGE_SIZE;
  const { data, count, error } = await query.range(from, from + PAGE_SIZE - 1);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []).map((r) => mapRow(r as Row)), total: count ?? 0 };
}

/** El aviso, sus reenvíos y de qué aviso vienen: todo el hilo, del más viejo al más nuevo. */
export async function listThread(row: NotificationRow): Promise<NotificationRow[]> {
  const root = row.resentOf ?? row.id;
  const { data, error } = await getSupabase()
    .from("notification_outbox")
    .select(LOG_COLUMNS)
    .or(`id.eq.${root},resent_of.eq.${root}`)
    .order("id", { ascending: true });
  if (error) throw fromDbError(error);
  return (data ?? []).map((r) => mapRow(r as Row));
}

/** Los avisos de un pedido (para el detalle del pedido y el soporte). */
export async function listForOrder(orderId: string): Promise<NotificationRow[]> {
  const { data, error } = await getSupabase()
    .from("notification_outbox")
    .select(LOG_COLUMNS)
    .eq("order_id", orderId)
    .order("id", { ascending: false })
    .limit(50);
  if (error) throw fromDbError(error);
  return (data ?? []).map((r) => mapRow(r as Row));
}

export async function notificationCounts(): Promise<NotificationCounts> {
  return await rpc<NotificationCounts>("admin_notification_counts");
}

export async function notificationHealth(): Promise<NotificationHealth> {
  const h = obj(await rpc<unknown>("admin_notification_health"));
  return {
    enabled: h.enabled === true,
    emailProvider: str(h.email_provider),
    fromEmailSet: h.from_email_set === true,
    whatsappMode: str(h.whatsapp_mode),
    workerConfigured: h.worker_configured === true,
    due: num(h.due),
    oldestDueMinutes: numOrNull(h.oldest_due_minutes),
    lastSentAt: strOrNull(h.last_sent_at),
    recipients: num(h.recipients),
  };
}

export const resendNotification = (id: number) =>
  rpc<ActionResult>("admin_notification_resend", { p_id: id });
export const markNotificationSent = (id: number) =>
  rpc<ActionResult>("admin_notification_mark_sent", { p_id: id });
export const cancelNotification = (id: number) =>
  rpc<ActionResult>("admin_notification_cancel", { p_id: id });

// ── Plantillas ──────────────────────────────────────────────────────────────────────────
const TEMPLATE_COLUMNS =
  "id, key, channel, locale, audience, subject, body, cta_label, active, is_default, updated_at";

const mapTemplate = (r: Row): TemplateRow => ({
  id: num(r.id),
  key: str(r.key),
  channel: str(r.channel) as NotificationChannel,
  locale: str(r.locale),
  audience: str(r.audience) as TemplateAudience,
  subject: str(r.subject),
  body: str(r.body),
  ctaLabel: strOrNull(r.cta_label),
  active: r.active === true,
  isDefault: r.is_default === true,
  updatedAt: str(r.updated_at),
});

export async function listTemplates(): Promise<TemplateRow[]> {
  const { data, error } = await getSupabase()
    .from("notification_templates")
    .select(TEMPLATE_COLUMNS)
    .eq("locale", "es")
    .order("audience", { ascending: true })
    .order("key", { ascending: true })
    .order("channel", { ascending: true });
  if (error) throw fromDbError(error);
  return (data ?? []).map((r) => mapTemplate(r as Row));
}

/** Guarda con control de versión: si otra persona la editó mientras tanto, no pisa (StaleVersionError). Devuelve el `updated_at` nuevo. */
export async function saveTemplate(template: TemplateRow, draft: TemplateDraft): Promise<string> {
  return await updateVersioned("notification_templates", String(template.id), template.updatedAt, {
    subject: draft.subject,
    body: draft.body,
    cta_label: draft.ctaLabel.trim() === "" ? null : draft.ctaLabel,
    active: draft.active,
  });
}

/** Un fallo de la función `notify-admin`: lleva el código del servidor (p. ej. `provider_not_configured`) para decir el motivo exacto. */
export class FunctionError extends AppError {
  constructor(
    readonly serverCode: string,
    status: number,
    message: string,
  ) {
    const code: AppErrorCode =
      status === 401
        ? "unauthorized"
        : status === 403
          ? "forbidden"
          : status === 404
            ? "not_found"
            : status === 409
              ? "conflict"
              : status === 0
                ? "network"
                : status >= 400 && status < 500
                  ? "validation"
                  : "unknown";
    super(code, message);
    this.name = "FunctionError";
  }
}

async function accessToken(): Promise<string> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AppError("unauthorized", t("admin.notifications.templates.noSession"));
  return token;
}

export interface TemplateInput {
  channel: NotificationChannel;
  audience: TemplateAudience;
  subject: string;
  body: string;
  ctaLabel: string;
}

const payloadOf = (input: TemplateInput) => ({
  channel: input.channel,
  audience: input.audience,
  subject: input.subject,
  body: input.body,
  cta_label: input.ctaLabel.trim() === "" ? null : input.ctaLabel,
});

/** Vista previa con valores de ejemplo, armada por la MISMA función que envía (lo que ves es lo que se recibe). */
export async function previewTemplate(input: TemplateInput): Promise<PreviewResponse> {
  const result = await callFunction<{
    preview: PreviewResponse["preview"];
    variables: PreviewResponse["variables"];
  }>("notify-admin", { action: "preview", ...payloadOf(input) }, { token: await accessToken() });
  if (!result.ok) throw new FunctionError(result.code, result.status, result.message);
  return { preview: result.data.preview, variables: result.data.variables ?? [] };
}

export interface TestSendResult {
  sent: boolean;
  reason?: string;
}

/** Envía la plantilla, de verdad, al correo del propio administrador (con «[PRUEBA]» en el asunto). */
export async function sendTestEmail(input: TemplateInput, to?: string): Promise<TestSendResult> {
  const result = await callFunction<{ sent: boolean; reason?: string }>(
    "notify-admin",
    { action: "send_test", ...payloadOf(input), ...(to ? { to } : {}) },
    { token: await accessToken() },
  );
  if (!result.ok) throw new FunctionError(result.code, result.status, result.message);
  return { sent: result.data.sent, ...(result.data.reason ? { reason: result.data.reason } : {}) };
}
