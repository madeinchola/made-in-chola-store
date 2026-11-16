import { composeEmail, composeWhatsapp } from "./compose.ts";
import { isValidSyntax, SUBJECT_MAX, variablesOf, WHATSAPP_MAX } from "./render.ts";
import type { Channel, SiteContext } from "./types.ts";
import { sampleVariables, VARIABLE_CATALOG } from "./variables.ts";

/**
 * Vista previa del editor de plantillas (S13): renderiza con valores de ejemplo EXACTAMENTE como lo hará el worker (mismo
 * `composeEmail`/`composeWhatsapp`) y dice qué impide guardar y qué es solo un aviso.
 */

export interface PreviewInput {
  channel: Channel;
  audience: "customer" | "admin";
  subject: string;
  body: string;
  cta_label: string | null;
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
  /** Se puede guardar: ningún error bloqueante. */
  ok: boolean;
  errors: PreviewError[];
  /** Variables que la plantilla usa y no existen para esta audiencia (se pintarían vacías: casi seguro un error de tipeo). */
  unknown: string[];
  warnings: ("whatsapp_truncated" | "no_cta_url")[];
  subject: string;
  text: string;
  /** Documento HTML completo (solo correo), para mostrarlo en un marco aislado. */
  html: string | null;
  length: number;
}

const BODY_MAX = 4000;

export function buildPreview(input: PreviewInput, site: SiteContext): PreviewResult {
  const errors: PreviewError[] = [];
  const warnings: PreviewResult["warnings"] = [];
  const sources = [input.subject, input.body, input.cta_label ?? ""];
  if (!sources.every(isValidSyntax)) errors.push("syntax");
  if (input.channel === "email") {
    if (input.subject.trim() === "") errors.push("subject_required");
    if (Array.from(input.subject).length > SUBJECT_MAX) errors.push("subject_too_long");
    if (/[\r\n]/.test(input.subject)) errors.push("subject_multiline");
  }
  if (input.body.trim() === "") errors.push("body_required");
  if (Array.from(input.body).length > (input.channel === "whatsapp" ? WHATSAPP_MAX : BODY_MAX))
    errors.push("body_too_long");

  const allowed = new Set(
    VARIABLE_CATALOG.filter(
      (info) => info.audience === "both" || info.audience === input.audience,
    ).map((info) => info.name),
  );
  const unknown = sources
    .flatMap(variablesOf)
    .filter((name, index, all) => all.indexOf(name) === index && !allowed.has(name));
  if (unknown.length > 0) errors.push("unknown_variable");

  const variables = sampleVariables(input.audience, site);
  if (input.channel === "whatsapp") {
    const message = composeWhatsapp({ body: input.body }, variables);
    if (message.truncated) warnings.push("whatsapp_truncated");
    return {
      ok: errors.length === 0,
      errors,
      unknown,
      warnings,
      subject: "",
      text: message.text,
      html: null,
      length: Array.from(message.text).length,
    };
  }
  const email = composeEmail(
    { subject: input.subject, body: input.body, cta_label: input.cta_label },
    variables,
    site,
    input.audience,
  );
  if ((input.cta_label ?? "").trim() !== "" && !email.cta) warnings.push("no_cta_url");
  return {
    ok: errors.length === 0,
    errors,
    unknown,
    warnings,
    subject: email.subject,
    text: email.text,
    html: email.html,
    length: Array.from(email.text).length,
  };
}
