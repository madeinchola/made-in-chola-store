import type { MessageKey } from "@/i18n";
import type { ComplaintRow } from "./types";

const laPaz = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", ...options });

export const formatDate = (iso: string) =>
  laPaz({ day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
export const formatShortDate = (iso: string) =>
  laPaz({ day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));

/** Enlace de WhatsApp a un teléfono E.164: solo dígitos (la API de wa.me no admite «+»). Nulo si no hay teléfono. */
export function whatsappLink(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? `https://wa.me/${digits}` : null;
}

/** `mailto:` con el número del reclamo en el asunto (el correo se codifica: nada de lo que tecleó la clienta rompe el enlace). */
export function mailtoLink(email: string | null, number: string): string | null {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encodeURIComponent(`Tu reclamo ${number}`)}`;
}

export function telLink(phone: string | null): string | null {
  return phone && /^\+[1-9][0-9]{7,14}$/.test(phone) ? `tel:${phone}` : null;
}

export function complaintErrorKey(error: unknown): MessageKey {
  const message = error instanceof Error ? error.message.trim() : "";
  const known = ["response_required", "response_too_long", "invalid_status", "not_found"];
  return `admin.complaints.errors.${known.includes(message) ? message : "unknown"}` as MessageKey;
}

/** ¿Hay algo que guardar? Cambió el estado o la respuesta. */
export function isDirty(row: ComplaintRow, status: string, response: string): boolean {
  return status !== row.status || response.trim() !== (row.response ?? "").trim();
}
