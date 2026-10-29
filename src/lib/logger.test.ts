import { describe, expect, it } from "vitest";
import { createLogger, redact, redactString, type LogEntry } from "./logger";

function capture() {
  const entries: LogEntry[] = [];
  return { entries, logger: createLogger((e) => entries.push(e), "corr-1") };
}

describe("logger", () => {
  it("incluye el ID de correlación y el nivel", () => {
    const { entries, logger } = capture();
    logger.warn("hola");
    expect(entries[0]).toMatchObject({ level: "warn", message: "hola", correlationId: "corr-1" });
  });
  it("redacta emails, teléfonos y JWT dentro del mensaje", () => {
    expect(
      redactString("user ana@correo.com tel +591 71234567 tok eyJhbGciOi.eyJyb2xlIjoi.sig-1"),
    ).toBe("user [email] tel [phone] tok [jwt]");
  });
  it("redacta por NOMBRE de clave, a cualquier profundidad", () => {
    const out = redact({
      user: { email: "a@b.co", name: "Ana", password: "x" },
      list: [{ token: "t" }],
    });
    expect(out).toEqual({
      user: { email: "[redacted]", name: "Ana", password: "[redacted]" },
      list: [{ token: "[redacted]" }],
    });
  });
  it("redacta PII embebida en valores de claves no sensibles", () => {
    expect(redact({ note: "escribir a ana@correo.com" })).toEqual({ note: "escribir a [email]" });
  });
  it("serializa Errors sin stack y con el mensaje redactado", () => {
    const out = redact({ error: new Error("falló para ana@correo.com") }) as {
      error: Record<string, string>;
    };
    expect(out.error).toEqual({ name: "Error", message: "falló para [email]" });
  });
  it("no se cuelga con referencias circulares", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => redact(a)).not.toThrow();
  });
  it("un teléfono NO se confunde con un monto corto", () => {
    expect(redactString("total 150.50 Bs")).toBe("total 150.50 Bs");
  });
  it("child() genera una correlación nueva", () => {
    const { entries, logger } = capture();
    logger.child().info("x");
    expect(entries[0]!.correlationId).not.toBe("corr-1");
  });
});
