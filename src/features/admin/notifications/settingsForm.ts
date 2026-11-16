import type { MessageKey } from "@/i18n";
import type { SettingRow } from "../config/types";
import { recipientsProblem } from "./logic";

const L = "admin.notifications.settings" as const;

export const KEYS = [
  "notify_enabled",
  "notify_email_provider",
  "notify_from_name",
  "notify_from_email",
  "notify_reply_to",
  "notify_whatsapp_mode",
  "notify_max_attempts",
  "notify_backoff_seconds",
  "alert_recipients",
] as const;
export type Key = (typeof KEYS)[number];
export type Form = Record<Key, string>;

const EMAIL_RE = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;

const text = (rows: Map<string, SettingRow>, key: Key, fallback = ""): string => {
  const value = rows.get(key)?.value;
  return value === undefined || value === null ? fallback : String(value);
};

export function formOf(rows: SettingRow[]): Form {
  const map = new Map(rows.map((row) => [row.key, row]));
  return {
    notify_enabled: text(map, "notify_enabled", "true"),
    notify_email_provider: text(map, "notify_email_provider", "none"),
    notify_from_name: text(map, "notify_from_name"),
    notify_from_email: text(map, "notify_from_email"),
    notify_reply_to: text(map, "notify_reply_to"),
    notify_whatsapp_mode: text(map, "notify_whatsapp_mode", "manual"),
    notify_max_attempts: text(map, "notify_max_attempts", "8"),
    notify_backoff_seconds: text(map, "notify_backoff_seconds", "60"),
    alert_recipients: text(map, "alert_recipients"),
  };
}

export type FormProblems = Partial<Record<Key, MessageKey>>;

/** Mismas reglas que `store_settings_validate_s13()`: el panel avisa antes de que lo rechace la base. */
export function validateForm(form: Form): FormProblems {
  const problems: FormProblems = {};
  const name = form.notify_from_name.trim();
  if (name.length < 1 || name.length > 80 || /[\r\n<>"]/.test(name))
    problems.notify_from_name = `${L}.problem.name`;
  for (const key of ["notify_from_email", "notify_reply_to"] as const) {
    const value = form[key].trim();
    if (
      value !== "" &&
      (value !== value.toLowerCase() || !EMAIL_RE.test(value) || value.length > 254)
    )
      problems[key] = `${L}.problem.email`;
  }
  const attempts = Number(form.notify_max_attempts);
  if (!/^\d+$/.test(form.notify_max_attempts.trim()) || attempts < 1 || attempts > 20)
    problems.notify_max_attempts = `${L}.problem.attempts`;
  const backoff = Number(form.notify_backoff_seconds);
  if (!/^\d+$/.test(form.notify_backoff_seconds.trim()) || backoff < 5 || backoff > 3600)
    problems.notify_backoff_seconds = `${L}.problem.backoff`;
  const recipients = recipientsProblem(form.alert_recipients);
  if (recipients)
    problems.alert_recipients = `${L}.problem.recipients.${recipients.problem}` as MessageKey;
  return problems;
}
