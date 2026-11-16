import { t, type MessageKey } from "@/i18n";
import type {
  NotificationHealth,
  NotificationRow,
  NotificationStatus,
  TemplateDraft,
  TemplateRow,
} from "./types";

type Tone = "success" | "info" | "warning" | "danger" | "neutral";

const STATUS_TONE: Record<NotificationStatus, Tone> = {
  pending: "info",
  sending: "info",
  sent: "success",
  failed: "danger",
  dead: "danger",
  cancelled: "neutral",
  manual: "warning",
};
export const statusTone = (status: NotificationStatus): Tone => STATUS_TONE[status];
export const statusLabel = (status: NotificationStatus): string =>
  t(`admin.notifications.status.${status}` as MessageKey);
export const typeLabel = (type: string): string => {
  const key = `admin.notifications.types.${type}` as MessageKey;
  const text = t(key);
  // Un tipo nuevo sin traducir se muestra con su clave (visible, no un hueco silencioso).
  return text === key ? type : text;
};
export const channelLabel = (channel: string): string =>
  t(`admin.notifications.channel.${channel}` as MessageKey);

/** Códigos cortos que deja el worker en `last_error` (sin datos personales), dichos en palabras. */
export function errorLabel(code: string | null): string {
  if (!code) return "";
  const key = `admin.notifications.errors.${code}` as MessageKey;
  const text = t(key);
  return text === key ? code : text;
}

/** ¿Qué puede hacer el administrador con este aviso? (una pista de interfaz: quien decide es la base) */
export const canResend = (status: NotificationStatus): boolean =>
  status === "sent" ||
  status === "failed" ||
  status === "dead" ||
  status === "cancelled" ||
  status === "manual";
export const canCancel = (status: NotificationStatus): boolean =>
  status === "pending" || status === "manual";
export const canMarkSent = (status: NotificationStatus): boolean => status === "manual";

/** Enlace wa.me con el mensaje ya escrito (modo manual): una persona lo abre y envía. Sin un teléfono E.164 válido, nada. */
export function whatsappLink(phone: string | null, text: string | null): string | null {
  if (!phone || !text || !/^\+[1-9][0-9]{7,14}$/.test(phone)) return null;
  return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(text)}`;
}

/** Lo que lleva a la bandeja de «requiere acción»: por enviar a mano, perdidos o fallados. */
export function needsAction(row: Pick<NotificationRow, "status">): boolean {
  return row.status === "manual" || row.status === "dead" || row.status === "failed";
}

/** Limpia lo que se escribe en el buscador antes de usarlo en un filtro de PostgREST (sin coma, paréntesis ni comodines). */
export function searchTerm(raw: string): string {
  return raw
    .replace(/[,()"'\\%*:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("es-BO", {
    timeZone: "America/La_Paz",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")} ${get("month").replace(/\.$/, "")} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

/** ¿Ya se cambió algo respecto de lo guardado? */
export function isDirty(template: TemplateRow, draft: TemplateDraft): boolean {
  return (
    template.subject !== draft.subject ||
    template.body !== draft.body ||
    (template.ctaLabel ?? "") !== draft.ctaLabel ||
    template.active !== draft.active
  );
}

export const draftOf = (template: TemplateRow): TemplateDraft => ({
  subject: template.subject,
  body: template.body,
  ctaLabel: template.ctaLabel ?? "",
  active: template.active,
});

/** Correos de una lista separada por comas: ignora entradas vacías (igual que la base). */
export function parseRecipients(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

const EMAIL_RE = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;
export type RecipientsProblem = "invalid" | "too_many";
/** Mismas reglas que `store_settings_validate_s13()`. Devuelve el problema (con la entrada inválida) o null. */
export function recipientsProblem(
  raw: string,
): { problem: RecipientsProblem; entry?: string } | null {
  const list = parseRecipients(raw);
  const bad = list.find((item) => !EMAIL_RE.test(item) || item.length > 254);
  if (bad !== undefined) return { problem: "invalid", entry: bad };
  if (list.length > 10) return { problem: "too_many" };
  return null;
}

const H = "admin.notifications.health" as const;

/** Por qué NO están saliendo los avisos, dicho en palabras (vacío = todo en orden). */
export function healthProblems(health: NotificationHealth): string[] {
  const problems: string[] = [];
  if (!health.enabled) problems.push(t(`${H}.disabled`));
  if (health.emailProvider === "none") problems.push(t(`${H}.noProvider`));
  else if (!health.fromEmailSet && health.emailProvider === "resend")
    problems.push(t(`${H}.noSender`));
  if (!health.workerConfigured) problems.push(t(`${H}.noWorker`));
  if (health.due > 0 && (health.oldestDueMinutes ?? 0) >= 5)
    problems.push(t(`${H}.stuck`, { count: health.due, minutes: health.oldestDueMinutes ?? 0 }));
  return problems;
}
