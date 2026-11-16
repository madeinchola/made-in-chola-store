/**
 * Motor de plantillas de las notificaciones (S13). Funciones PURAS, sin red ni base de datos: lo usan el worker que envía y la vista
 * previa del panel, así que lo que el administrador ve es exactamente lo que recibe la clienta.
 *
 * Principios de seguridad:
 *  - La plantilla es TEXTO PLANO con variables `{{nombre}}`. Se renderiza siempre a texto; el HTML sale de ESCAPAR ese texto entero
 *    (nombre de la clienta, dirección, motivos…). Un `<script>` en un dato jamás llega al correo como etiqueta.
 *  - Los valores de las variables se limpian de saltos de línea y caracteres de control (sin inyección de cabeceras en el asunto).
 *  - Una variable que falta no rompe el envío: se pinta vacía y se informa en `missing`.
 */

/** Variable válida: minúsculas, dígitos y `_`, hasta 41 caracteres (igual que la validación de la base). */
export const VARIABLE_RE = /\{\{\s*([a-z_][a-z0-9_]{0,40})\s*\}\}/g;

export const SUBJECT_MAX = 200;
export const VALUE_MAX = 500;
export const WHATSAPP_MAX = 1000;
const URL_MAX = 2000;

/** ¿Toda llave pertenece a una variable válida? Una llave suelta rompería el mensaje. */
export function isValidSyntax(source: string): boolean {
  return !/\{\{|\}\}/.test(source.replace(VARIABLE_RE, ""));
}

/** Variables que usa una plantilla, sin repetir y en orden de aparición. */
export function variablesOf(source: string): string[] {
  const seen = new Set<string>();
  for (const match of source.matchAll(VARIABLE_RE)) seen.add(match[1] as string);
  return [...seen];
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Un valor de variable es una sola línea: sin saltos ni caracteres de control, recortado. */
export function cleanValue(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // deno-lint-ignore no-control-regex
  const flat = text
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  return truncateCodePoints(flat, VALUE_MAX);
}

/** Recorta por puntos de código (no parte un emoji ni un par sustituto a la mitad). */
export function truncateCodePoints(text: string, max: number, ellipsis = "…"): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return chars.slice(0, Math.max(0, max - ellipsis.length)).join("") + ellipsis;
}

export interface RenderResult {
  output: string;
  /** Variables que la plantilla pide y no se entregaron. */
  missing: string[];
}

/**
 * Sustituye `{{variables}}` por sus valores (ya limpios). Si alguna quedó vacía, repara el hueco que dejó: «Hola , ana» → «Hola, ana»
 * (solo entonces: el texto escrito por la tienda no se toca).
 */
export function renderText(source: string, vars: Record<string, unknown>): RenderResult {
  const missing = new Set<string>();
  let hadEmpty = false;
  const output = source.replace(VARIABLE_RE, (_all, name: string) => {
    if (!Object.hasOwn(vars, name) || vars[name] === undefined || vars[name] === null) {
      missing.add(name);
      hadEmpty = true;
      return "";
    }
    const value = cleanValue(vars[name]);
    if (value === "") hadEmpty = true;
    return value;
  });
  return { output: hadEmpty ? tidyGaps(output) : output, missing: [...missing] };
}

function tidyGaps(text: string): string {
  return text
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/([¡¿])[ \t]+/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n");
}

/** Normaliza saltos de línea y deja a lo sumo una línea en blanco entre párrafos. */
export function normalizeBody(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Solo enlaces http(s) bien formados: un `javascript:` o un enlace roto no se convierte en botón. */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > URL_MAX) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export interface TemplateParts {
  subject: string;
  body: string;
  cta_label: string | null;
}

export interface RenderedEmail {
  subject: string;
  /** Texto plano del cuerpo (con el enlace del botón al final). */
  text: string;
  /** Párrafos ya escapados, listos para el diseño. */
  paragraphsHtml: string[];
  cta: { label: string; url: string } | null;
  missing: string[];
}

export function renderEmailParts(
  template: TemplateParts,
  vars: Record<string, unknown>,
): RenderedEmail {
  const subjectResult = renderText(template.subject, vars);
  const bodyResult = renderText(template.body, vars);
  const ctaResult = template.cta_label
    ? renderText(template.cta_label, vars)
    : { output: "", missing: [] };
  const subject = truncateCodePoints(
    subjectResult.output
      .replace(/[\r\n\u2028\u2029]+/g, " ")
      .replace(/ {2,}/g, " ")
      .trim(),
    SUBJECT_MAX,
  );
  const body = normalizeBody(bodyResult.output);
  const url = safeUrl(vars.cta_url ?? vars.order_url ?? vars.admin_url);
  const label = cleanValue(ctaResult.output);
  const cta = label && url ? { label, url } : null;
  const text = cta ? `${body}\n\n${cta.label}: ${cta.url}` : body;
  return {
    subject,
    text,
    paragraphsHtml:
      body === ""
        ? []
        : body.split(/\n{2,}/).map((paragraph) => escapeHtml(paragraph).replace(/\n/g, "<br>")),
    cta,
    missing: [...new Set([...subjectResult.missing, ...bodyResult.missing, ...ctaResult.missing])],
  };
}

export interface RenderedWhatsapp {
  text: string;
  truncated: boolean;
  missing: string[];
}

/** WhatsApp: solo texto, hasta 1000 caracteres (el tope de las plantillas aprobadas), sin partir un emoji. */
export function renderWhatsappText(
  template: Pick<TemplateParts, "body">,
  vars: Record<string, unknown>,
): RenderedWhatsapp {
  const result = renderText(template.body, vars);
  const body = normalizeBody(result.output);
  const text = truncateCodePoints(body, WHATSAPP_MAX);
  return { text, truncated: text !== body, missing: result.missing };
}

/** Enlace wa.me con el mensaje ya escrito, para que una persona lo envíe a mano (modo manual). Sin teléfono válido devuelve null. */
export function whatsappLink(phoneE164: string | null | undefined, text: string): string | null {
  if (!phoneE164 || !/^\+[1-9][0-9]{7,14}$/.test(phoneE164)) return null;
  return `https://wa.me/${phoneE164.slice(1)}?text=${encodeURIComponent(text)}`;
}
