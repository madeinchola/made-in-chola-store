/* eslint-disable no-console -- único punto donde se permite escribir en consola */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  correlationId: string;
  time: string;
  context?: Record<string, unknown>;
}

export type LogSink = (entry: LogEntry) => void;

const SENSITIVE_KEYS =
  /pass(word)?|token|secret|authorization|api[-_]?key|cookie|email|phone|telefono|nit/i;

const PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]"],
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]"],
  [/\+?\d[\d\s().-]{6,}\d/g, "[phone]"],
];

export function redactString(value: string): string {
  return PATTERNS.reduce((acc, [re, label]) => acc.replace(re, label), value);
}

export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth > 5) return "[truncated]";
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      SENSITIVE_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1),
    ]),
  );
}

export function newCorrelationId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

const consoleSink: LogSink = (e) => {
  const fn = e.level === "debug" ? console.debug : console[e.level];
  fn(`[${e.correlationId}] ${e.message}`, e.context ?? "");
};

export interface Logger {
  readonly correlationId: string;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(): Logger;
}

/** Logger con ID de correlación y redacción automática de datos personales. */
export function createLogger(
  sink: LogSink = consoleSink,
  correlationId = newCorrelationId(),
): Logger {
  const emit = (level: LogLevel, message: string, context?: Record<string, unknown>) =>
    sink({
      level,
      message: redactString(message),
      correlationId,
      time: new Date().toISOString(),
      context: context ? (redact(context) as Record<string, unknown>) : undefined,
    });
  return {
    correlationId,
    debug: (m, c) => emit("debug", m, c),
    info: (m, c) => emit("info", m, c),
    warn: (m, c) => emit("warn", m, c),
    error: (m, c) => emit("error", m, c),
    child: () => createLogger(sink),
  };
}

export const logger = createLogger();
