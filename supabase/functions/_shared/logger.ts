const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
// Teléfonos en formato internacional (con "+"), como los que aparecen en errores de Postgres: Key (phone_e164)=(+591…)
const PHONE = /\+\d[\d\s().-]{7,}\d/g;

export function redact(value: string): string {
  return value.replace(EMAIL, "[email]").replace(JWT, "[jwt]").replace(PHONE, "[phone]");
}

/**
 * Registro JSON con ID de correlación. La redacción se aplica a TODA la línea serializada (mensaje y
 * campos extra), porque un `String(error)` de Postgres puede traer emails o teléfonos dentro.
 */
export function formatLogLine(
  level: string,
  correlationId: string,
  message: string,
  extra?: Record<string, unknown>,
): string {
  return redact(JSON.stringify({ level, correlationId, message, ...extra }));
}

export function createLogger(correlationId: string = crypto.randomUUID()) {
  const log = (level: string, message: string, extra?: Record<string, unknown>) =>
    console.log(formatLogLine(level, correlationId, message, extra));
  return {
    correlationId,
    info: (m: string, e?: Record<string, unknown>) => log("info", m, e),
    warn: (m: string, e?: Record<string, unknown>) => log("warn", m, e),
    error: (m: string, e?: Record<string, unknown>) => log("error", m, e),
  };
}
