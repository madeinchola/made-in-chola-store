import { describe, expect, it } from "vitest";
import { commonFailureMessage, formatWait, passwordFailureMessages } from "./functionErrors";

const failure = (over: Partial<Parameters<typeof commonFailureMessage>[0]>) => ({
  ok: false as const,
  status: 500,
  code: "unknown",
  message: "unknown",
  ...over,
});

describe("formatWait", () => {
  it.each([
    [0, "1 segundo"], // nunca «0 segundos»
    [0.2, "1 segundo"], // se redondea hacia arriba
    [1, "1 segundo"],
    [2, "2 segundos"],
    [45, "45 segundos"],
    [61.2, "62 segundos"],
    [89, "89 segundos"],
    [90, "2 minutos"], // 90 s = 1,5 min → hacia arriba
    [120, "2 minutos"],
    [121, "3 minutos"],
    [900, "15 minutos"],
  ])("%s s → %s", (seconds, expected) => {
    expect(formatWait(seconds)).toBe(expected);
  });
});

describe("commonFailureMessage", () => {
  it("429 con espera", () => {
    expect(
      commonFailureMessage(failure({ status: 429, code: "rate_limited", retryAfter: 120 })),
    ).toBe("Demasiados intentos. Vuelve a intentarlo en 2 minutos.");
    expect(commonFailureMessage(failure({ status: 429, code: "x", retryAfter: 30 }))).toBe(
      "Demasiados intentos. Vuelve a intentarlo en 30 segundos.",
    );
  });

  it("429 sin espera conocida asume 60 segundos", () => {
    expect(commonFailureMessage(failure({ status: 429, code: "rate_limited" }))).toBe(
      "Demasiados intentos. Vuelve a intentarlo en 60 segundos.",
    );
  });

  it("el código rate_limited también cuenta aunque el estado no sea 429", () => {
    expect(
      commonFailureMessage(failure({ status: 400, code: "rate_limited", retryAfter: 5 })),
    ).toBe("Demasiados intentos. Vuelve a intentarlo en 5 segundos.");
  });

  it("red caída, sesión vencida y errores desconocidos", () => {
    expect(commonFailureMessage(failure({ status: 0, code: "network" }))).toBe(
      "No pudimos conectar con el servidor. Revisa tu conexión.",
    );
    expect(commonFailureMessage(failure({ status: 401, code: "unauthorized" }))).toBe(
      "Tu sesión venció. Inicia sesión de nuevo para continuar.",
    );
    expect(commonFailureMessage(failure({ status: 200, code: "unauthorized" }))).toBe(
      "Tu sesión venció. Inicia sesión de nuevo para continuar.",
    );
    expect(commonFailureMessage(failure({ status: 500, code: "boom" }))).toBe(
      "Ocurrió un error inesperado. Inténtalo de nuevo.",
    );
    expect(commonFailureMessage(failure({ status: 400, code: "cualquier_cosa" }))).toBe(
      "Ocurrió un error inesperado. Inténtalo de nuevo.",
    );
  });
});

describe("passwordFailureMessages", () => {
  it("traduce cada regla conocida, en orden", () => {
    expect(passwordFailureMessages(["too_short", "common"])).toEqual([
      "Mínimo 8 caracteres.",
      "Es una contraseña demasiado común.",
    ]);
    expect(
      passwordFailureMessages(["too_long", "repetitive", "sequential", "contains_identifier"]),
    ).toEqual([
      "Demasiado larga (máximo 72 bytes).",
      "No uses el mismo carácter repetido.",
      "No uses secuencias como 12345678 o abcdefgh.",
      "No incluyas tu email o teléfono.",
    ]);
  });

  it("ignora códigos desconocidos y tolera la ausencia de lista", () => {
    expect(passwordFailureMessages(["nueva_regla", "too_short"])).toEqual(["Mínimo 8 caracteres."]);
    expect(passwordFailureMessages(["__proto__", "constructor"])).toEqual([]);
    expect(passwordFailureMessages([])).toEqual([]);
    expect(passwordFailureMessages(undefined)).toEqual([]);
  });
});
