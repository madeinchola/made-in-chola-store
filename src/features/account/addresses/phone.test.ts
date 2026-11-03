import { describe, expect, it } from "vitest";
import { normalizePhone } from "@shared/identity";
import { formatPhoneDisplay, splitPhone } from "./phone";

describe("splitPhone", () => {
  it.each([
    ["+59171234567", "BO", "7123 4567"],
    ["+34612345678", "ES", "6123 4567 8"],
    ["+595981234567", "PY", "9812 3456 7"], // 595 (3 dígitos) gana a cualquier prefijo más corto
    ["+12025550123", "US", "2025 5501 23"], // el «1» de EE. UU., el más corto, va al final
    ["+5491123456789", "AR", "9112 3456 789"],
  ])("%s → país %s, número %s", (e164, country, national) => {
    expect(splitPhone(e164)).toEqual({ country, national });
  });

  it("cada separación vuelve al MISMO E.164 al normalizar (ida y vuelta sin perder dígitos)", () => {
    for (const e164 of [
      "+59171234567",
      "+34612345678",
      "+595981234567",
      "+12025550123",
      "+5491123456789",
    ]) {
      const { country, national } = splitPhone(e164);
      expect(normalizePhone(national, country)).toEqual({ ok: true, e164, country });
    }
  });

  it("un prefijo desconocido deja el número internacional completo (el formulario lo acepta con «+»)", () => {
    expect(splitPhone("+99912345678")).toEqual({ country: "BO", national: "+99912345678" });
  });

  it("si la parte nacional empezara en 0 NO se separa (normalizePhone la leería como prefijo troncal)", () => {
    expect(splitPhone("+5950981234567")).toEqual({ country: "BO", national: "+5950981234567" });
  });

  it("sin dígitos tras el prefijo, tampoco", () => {
    expect(splitPhone("+591")).toEqual({ country: "BO", national: "+591" });
  });

  it("vacío", () => {
    expect(splitPhone("")).toEqual({ country: "BO", national: "" });
  });
});

describe("formatPhoneDisplay", () => {
  it("prefijo + número con la máscara del formulario", () => {
    expect(formatPhoneDisplay("+59171234567")).toBe("+591 7123 4567");
    expect(formatPhoneDisplay("+34612345678")).toBe("+34 6123 4567 8");
    expect(formatPhoneDisplay("+595981234567")).toBe("+595 9812 3456 7");
  });

  it("lo que no reconoce se muestra tal cual", () => {
    expect(formatPhoneDisplay("+99912345678")).toBe("+99912345678");
    expect(formatPhoneDisplay("+591")).toBe("+591");
  });
});
