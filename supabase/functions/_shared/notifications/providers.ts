/**
 * Proveedores de correo (S13). La interfaz es mínima a propósito: cambiar de proveedor (D-03) es escribir otro adaptador.
 * Todo fallo se clasifica en UNO de dos tipos que el worker entiende:
 *  - transitorio: se reintenta con retroceso (red, tiempo agotado, límite de velocidad, 5xx, configuración que el dueño aún arregla);
 *  - permanente: no se reintenta (dirección o contenido inválidos).
 * El texto del error del proveedor NUNCA se guarda: puede traer la dirección de la clienta. Solo un código corto.
 */

export interface EmailMessage {
  /** «Nombre <correo@dominio>» */
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  /** Una clave por AVISO (no por intento): si la respuesta se pierde y se reintenta, el proveedor no envía dos veces. */
  idempotencyKey: string;
  /** Número del intento (1 = el primero). Los proveedores reales lo ignoran; el de pruebas lo usa para fallar «N veces». */
  attempt?: number;
}

export interface SendResult {
  id: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

export class NotifyError extends Error {
  constructor(
    readonly kind: "transient" | "permanent",
    /** Código corto, sin datos personales: se guarda en el registro. */
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "NotifyError";
  }
}

/** Direcciones de dominios que la norma (RFC 2606/6761) reserva para pruebas: nunca existen en el mundo real. */
export function isReservedAddress(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  return (
    /\.(test|example|invalid|localhost)$/.test(domain) ||
    domain === "localhost" ||
    /(^|\.)example\.(com|net|org)$/.test(domain)
  );
}

function secondsUntilNextUtcMidnight(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.ceil((next - now.getTime()) / 1000));
}

interface ResendErrorBody {
  name?: unknown;
  message?: unknown;
}

/**
 * Resend (https://resend.com/docs/api-reference/emails/send-email). Contrato verificado en su documentación (2026-11-16):
 * POST /emails con `Authorization: Bearer`, cuerpo {from, to[], subject, html, text, reply_to}, cabecera `Idempotency-Key`
 * (1–256 caracteres, vigente 24 h), respuesta 200 {id}. Errores: 400 validation_error · 401/403 clave o dominio · 409
 * concurrent_idempotent_requests / invalid_idempotent_request · 429 rate_limit_exceeded / daily_quota_exceeded /
 * monthly_quota_exceeded · 5xx. NO se pudo verificar contra una cuenta real: falta la clave y el dominio (SPRINT_19).
 */
export function createResendProvider(
  apiKey: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; baseUrl?: string } = {},
): EmailProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const baseUrl = options.baseUrl ?? "https://api.resend.com";
  return {
    name: "resend",
    async send(message) {
      if (message.idempotencyKey.length < 1 || message.idempotencyKey.length > 256)
        throw new NotifyError("permanent", "invalid_idempotency_key");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/emails`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": message.idempotencyKey,
          },
          body: JSON.stringify({
            from: message.from,
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
            ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          }),
          signal: controller.signal,
        });
      } catch (error) {
        throw new NotifyError(
          "transient",
          (error as Error)?.name === "AbortError" ? "timeout" : "network",
        );
      } finally {
        clearTimeout(timer);
      }
      let body: ResendErrorBody & { id?: unknown } = {};
      try {
        body = (await response.json()) ?? {};
      } catch {
        // cuerpo vacío o no JSON: se decide por el código HTTP
      }
      if (response.ok) {
        if (typeof body.id !== "string" || body.id === "")
          throw new NotifyError("transient", "bad_response");
        return { id: body.id };
      }
      const name = typeof body.name === "string" ? body.name : "";
      const status = response.status;
      if (status === 429) {
        if (name === "daily_quota_exceeded" || name === "monthly_quota_exceeded")
          throw new NotifyError("transient", "quota_exceeded", secondsUntilNextUtcMidnight());
        const header = Number(response.headers.get("retry-after"));
        throw new NotifyError(
          "transient",
          "rate_limited",
          Number.isFinite(header) && header > 0 ? Math.ceil(header) : undefined,
        );
      }
      if (status >= 500) throw new NotifyError("transient", `provider_${status}`);
      if (status === 409) {
        if (name === "invalid_idempotent_request")
          throw new NotifyError("permanent", "idempotency_conflict");
        throw new NotifyError("transient", "idempotency_in_progress", 30);
      }
      // Clave inválida o suspendida, dominio sin verificar, cuenta de pruebas: los arregla el dueño. Se reintenta para no perder el
      // aviso mientras tanto (y si pasa el plazo, «dead» + alerta: se puede reenviar desde el panel).
      if (status === 401 || status === 403) throw new NotifyError("transient", "provider_config");
      if (status === 400 || status === 422) throw new NotifyError("permanent", "invalid_request");
      throw new NotifyError("permanent", `provider_${status}`);
    },
  };
}

/** Lo que `createFakeProvider` registró, para las pruebas. */
export interface SentRecord {
  message: EmailMessage;
  id: string;
}

/**
 * Proveedor de PRUEBAS. Se controla por la parte local de la dirección del primer destinatario:
 *   transient@ → siempre transitorio · transient-N@ → falla N veces y luego envía · permanent@ → permanente
 *   timeout@ → tiempo agotado · ratelimit@ → 429 con espera de 120 s · cualquier otra → envía
 * Solo entrega a dominios reservados (.test, .example…): jamás a una dirección real, aunque alguien lo active por error.
 */
export function createFakeProvider(): EmailProvider & {
  sent: SentRecord[];
  attemptsFor(key: string): number;
} {
  const sent: SentRecord[] = [];
  const attempts = new Map<string, number>();
  return {
    name: "fake",
    sent,
    attemptsFor: (key) => attempts.get(key) ?? 0,
    send(message) {
      const first = message.to[0] ?? "";
      if (message.to.some((address) => !isReservedAddress(address)))
        return Promise.reject(new NotifyError("permanent", "fake_provider_real_address"));
      // El intento viene del aviso: cada invocación de la función es un proceso nuevo y no recordaría los anteriores.
      const count = message.attempt ?? (attempts.get(message.idempotencyKey) ?? 0) + 1;
      attempts.set(message.idempotencyKey, count);
      const local = first.slice(0, first.lastIndexOf("@")).toLowerCase();
      const flaky = /^transient-(\d+)$/.exec(local);
      if (local === "permanent")
        return Promise.reject(new NotifyError("permanent", "invalid_request"));
      if (local === "transient")
        return Promise.reject(new NotifyError("transient", "provider_503"));
      if (local === "timeout") return Promise.reject(new NotifyError("transient", "timeout"));
      if (local === "ratelimit")
        return Promise.reject(new NotifyError("transient", "rate_limited", 120));
      if (flaky && count <= Number(flaky[1]))
        return Promise.reject(new NotifyError("transient", "provider_503"));
      const id = `fake_${message.idempotencyKey}`;
      // Misma clave = mismo envío (como un proveedor real): no se registra dos veces.
      if (!sent.some((record) => record.id === id)) sent.push({ message, id });
      return Promise.resolve({ id });
    },
  };
}
