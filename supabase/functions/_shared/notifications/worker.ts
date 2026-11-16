import { composeEmail, composeWhatsapp } from "./compose.ts";
import { type EmailProvider, isReservedAddress, NotifyError } from "./providers.ts";
import { isValidSyntax, type TemplateParts, truncateCodePoints } from "./render.ts";
import type {
  Channel,
  CompleteInfo,
  Outcome,
  OutboxRow,
  RowContext,
  SiteContext,
  TemplateRow,
} from "./types.ts";
import { buildVariables } from "./variables.ts";

/**
 * Núcleo del worker de notificaciones (S13): toma un lote de la cola, arma cada mensaje y lo entrega, y cierra cada intento con el
 * resultado correcto. TODO lo que toca el mundo (base de datos, proveedor, reloj) entra por `WorkerDeps`: así se prueba entero,
 * incluidas las caídas del proveedor, sin red.
 *
 * Reglas que cumple (BR-SHP-04 y criterios del sprint):
 *  - nunca bloquea ni toca el pedido: solo lee la cola y escribe su propio resultado;
 *  - un fallo transitorio vuelve a la cola con retroceso (lo calcula la base); uno permanente no se reintenta;
 *  - sin proveedor de correo configurado los correos esperan en la cola (no se pierden ni gastan intentos);
 *  - a un dominio reservado para pruebas (.test, .example…) jamás se le envía por un proveedor real;
 *  - una plantilla dañada o inexistente se reemplaza por un texto seguro y se alerta; una apagada a propósito no se envía.
 */

export interface WorkerSettings {
  enabled: boolean;
  emailProvider: "none" | "resend" | "fake";
  fromName: string;
  fromEmail: string;
  replyTo: string;
  whatsappMode: "manual" | "official";
}

export interface WorkerLog {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface WorkerDeps {
  site: SiteContext;
  settings(): Promise<WorkerSettings>;
  claim(args: {
    limit: number;
    worker: string;
    ids: number[] | null;
    channels: Channel[];
  }): Promise<OutboxRow[]>;
  complete(id: number, worker: string, outcome: Outcome, info: CompleteInfo): Promise<string>;
  template(key: string, channel: Channel): Promise<TemplateRow | null>;
  context(row: OutboxRow): Promise<RowContext>;
  alertRecipients(): Promise<string[]>;
  raiseTemplateAlert(key: string, channel: Channel, reason: "missing" | "syntax"): Promise<void>;
  /** Adaptador del proveedor elegido en los ajustes; `null` si falta su clave (entonces el correo espera). */
  emailProvider(kind: "resend" | "fake"): EmailProvider | null;
  sleep(ms: number): Promise<void>;
  now(): number;
  log: WorkerLog;
}

export interface WorkerOptions {
  limit: number;
  worker: string;
  ids?: number[] | null;
  /** Pausa entre dos envíos reales (el proveedor limita las peticiones por segundo). */
  spacingMs?: number;
  /** Pasado este tiempo no se empiezan envíos nuevos: lo que quede se difiere a un minuto. */
  deadlineMs?: number;
}

export interface WorkerReport {
  claimed: number;
  sent: number;
  manual: number;
  retried: number;
  failed: number;
  cancelled: number;
  dead: number;
  /** Tomados pero no empezados por falta de tiempo (vuelven a la cola). */
  deferred: number;
  /** Otro worker ya había rescatado el aviso: este resultado se descartó. */
  lost: number;
  note?: string;
}

const EMPTY_REPORT: WorkerReport = {
  claimed: 0,
  sent: 0,
  manual: 0,
  retried: 0,
  failed: 0,
  cancelled: 0,
  dead: 0,
  deferred: 0,
  lost: 0,
};
const BODY_LOG_MAX = 4000;
const RECIPIENT_RE = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;

/** Texto seguro cuando la plantilla falta o está dañada: dice lo mínimo y no inventa nada. */
export function fallbackTemplate(audience: "customer" | "admin", channel: Channel): TemplateParts {
  if (audience === "admin")
    return {
      subject: "Aviso de {{store_name}}: {{notification_type}}",
      body: "Hay un aviso interno que requiere tu atención. Revisa el panel.",
      cta_label: "Abrir en el panel",
    };
  if (channel === "whatsapp")
    return {
      subject: "",
      body: "Hola {{customer_name}}, hay novedades de tu pedido {{order_number}}. Revísalas en tu cuenta: {{order_url}}",
      cta_label: null,
    };
  return {
    subject: "Novedades de tu pedido {{order_number}}",
    body: "Hola {{customer_name}},\n\nhay novedades de tu pedido {{order_number}}. Puedes revisarlas en tu cuenta.",
    cta_label: "Ver mi pedido",
  };
}

function templateIsSound(template: TemplateRow): boolean {
  return [template.subject, template.body, template.cta_label ?? ""].every(isValidSyntax);
}

interface Resolved {
  outcome: Outcome;
  info: CompleteInfo;
}

function failed(code: string): Resolved {
  return { outcome: "failed", info: { error: code } };
}

/** Qué proveedor de correo hay disponible AHORA: sin él, los correos esperan. */
export function effectiveEmailProvider(
  settings: WorkerSettings,
  deps: Pick<WorkerDeps, "emailProvider">,
): EmailProvider | null {
  if (settings.emailProvider === "fake") return deps.emailProvider("fake");
  if (settings.emailProvider === "resend" && settings.fromEmail !== "")
    return deps.emailProvider("resend");
  return null;
}

async function resolveRow(
  row: OutboxRow,
  deps: WorkerDeps,
  settings: WorkerSettings,
  provider: EmailProvider | null,
): Promise<Resolved> {
  const key = row.template ?? row.type;
  const audience = row.recipient === null ? "admin" : "customer";
  const stored = await deps.template(key, row.channel);
  if (stored && !stored.active)
    return { outcome: "cancelled", info: { error: "template_inactive" } };
  let template: TemplateParts;
  if (!stored || !templateIsSound(stored)) {
    template = fallbackTemplate(audience, row.channel);
    try {
      await deps.raiseTemplateAlert(key, row.channel, stored ? "syntax" : "missing");
    } catch (error) {
      deps.log.warn("no se pudo registrar la alerta de plantilla", { key, error: String(error) });
    }
  } else {
    template = stored;
  }
  const context = await deps.context(row).catch(() => {
    throw new NotifyError("transient", "context_error");
  });
  const variables = buildVariables(row, deps.site, context);

  if (row.channel === "whatsapp") {
    const message = composeWhatsapp(template, variables);
    if (message.text === "") return failed("empty_message");
    // Modo «official» (API oficial de WhatsApp) aún no existe: se comporta como manual. El mensaje queda escrito en el registro
    // y el panel arma el enlace wa.me para que una persona lo envíe.
    return { outcome: "manual", info: { body: truncateCodePoints(message.text, BODY_LOG_MAX) } };
  }

  const email = composeEmail(template, variables, deps.site, audience);
  if (email.subject === "" || email.paragraphsHtml.length === 0) return failed("empty_message");
  const recipients = row.recipient !== null ? [row.recipient] : await deps.alertRecipients();
  if (recipients.length === 0) return failed("no_recipients");
  if (!recipients.every((address) => RECIPIENT_RE.test(address)))
    return failed("invalid_recipient");
  const logInfo = { subject: email.subject, body: truncateCodePoints(email.text, BODY_LOG_MAX) };
  // Las direcciones de dominios reservados nunca salen por un proveedor real; el proveedor de pruebas, en cambio, solo las acepta a ellas.
  const deliverable =
    provider?.name === "fake"
      ? recipients
      : recipients.filter((address) => !isReservedAddress(address));
  if (deliverable.length === 0)
    return { outcome: "sent", info: { provider: "sink", messageId: null, ...logInfo } };
  if (!provider) throw new NotifyError("transient", "no_provider");
  const result = await provider.send({
    from: `${settings.fromName} <${settings.fromEmail || "pedidos@chola.test"}>`,
    to: deliverable,
    replyTo: settings.replyTo || undefined,
    subject: email.subject,
    html: email.html,
    text: email.text,
    idempotencyKey: `notif-${row.id}`,
    attempt: row.attempts,
  });
  return { outcome: "sent", info: { provider: provider.name, messageId: result.id, ...logInfo } };
}

export async function runWorker(deps: WorkerDeps, options: WorkerOptions): Promise<WorkerReport> {
  const report: WorkerReport = { ...EMPTY_REPORT };
  const settings = await deps.settings();
  if (!settings.enabled) return { ...report, note: "disabled" };
  const provider = effectiveEmailProvider(settings, deps);
  const channels: Channel[] = provider ? ["email", "whatsapp"] : ["whatsapp"];
  if (!provider) report.note = "email_not_configured";

  const rows = await deps.claim({
    limit: options.limit,
    worker: options.worker,
    ids: options.ids ?? null,
    channels,
  });
  report.claimed = rows.length;
  const startedAt = deps.now();
  const deadline = options.deadlineMs ?? 100_000;
  const spacing = options.spacingMs ?? 0;

  for (const row of rows) {
    let resolved: Resolved;
    if (deps.now() - startedAt > deadline) {
      resolved = { outcome: "retry", info: { error: "deferred", retryAfterSeconds: 30 } };
      report.deferred += 1;
    } else {
      try {
        resolved = await resolveRow(row, deps, settings, provider);
      } catch (error) {
        if (error instanceof NotifyError) {
          resolved =
            error.kind === "transient"
              ? {
                  outcome: "retry",
                  info: { error: error.code, retryAfterSeconds: error.retryAfterSeconds ?? null },
                }
              : failed(error.code);
        } else {
          deps.log.error("error inesperado al enviar", {
            id: row.id,
            type: row.type,
            error: String(error),
          });
          resolved = { outcome: "retry", info: { error: "unexpected" } };
        }
      }
    }
    const final = await deps.complete(row.id, options.worker, resolved.outcome, resolved.info);
    switch (final) {
      case "sent":
        report.sent += 1;
        break;
      case "manual":
        report.manual += 1;
        break;
      case "retry":
        if (resolved.info.error !== "deferred") report.retried += 1;
        break;
      case "dead":
        report.dead += 1;
        break;
      case "failed":
        report.failed += 1;
        break;
      case "cancelled":
        report.cancelled += 1;
        break;
      default:
        report.lost += 1;
    }
    deps.log.info("aviso procesado", {
      id: row.id,
      type: row.type,
      channel: row.channel,
      result: final,
      error: resolved.info.error ?? null,
    });
    if (
      spacing > 0 &&
      resolved.outcome === "sent" &&
      resolved.info.provider !== "sink" &&
      row.channel === "email"
    )
      await deps.sleep(spacing);
  }
  return report;
}
