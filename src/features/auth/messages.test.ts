import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./messages";

describe("authErrorMessage", () => {
  it("códigos conocidos → español", () => {
    expect(authErrorMessage({ code: "invalid_credentials" })).toBe(
      "Email, teléfono o contraseña incorrectos.",
    );
    expect(authErrorMessage({ code: "network" })).toMatch(/conexión/);
  });
  it("rate_limited interpola los segundos (60 por defecto)", () => {
    expect(authErrorMessage({ code: "rate_limited", retryAfter: 5 })).toContain("5 segundos");
    expect(authErrorMessage({ code: "rate_limited" })).toContain("60 segundos");
  });
  it("weak_password detalla cada regla", () => {
    expect(authErrorMessage({ code: "weak_password", failures: ["too_short", "common"] })).toBe(
      "Mínimo 8 caracteres. Es una contraseña demasiado común.",
    );
    expect(authErrorMessage({ code: "weak_password" })).toBe(
      "La contraseña no cumple los requisitos.",
    );
  });
  it("códigos desconocidos (o internos) → mensaje genérico, nunca el código crudo", () => {
    for (const code of ["internal", "algo_raro", "", "__proto__"]) {
      expect(authErrorMessage({ code })).toBe("Ocurrió un error inesperado. Inténtalo de nuevo.");
    }
  });
});
