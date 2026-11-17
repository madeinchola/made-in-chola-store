import { describe, expect, it } from "vitest";
import { normalizeNumber } from "./numbers";

const ok = (raw: string) => {
  const r = normalizeNumber(raw);
  return r.ok ? r.value : `ERROR:${r.code}`;
};

describe("normalizeNumber: lo que escribe una persona → el número de la base", () => {
  it("el formato latino y el inglés dan lo mismo", () => {
    expect(ok("1.234,56")).toBe("1234.56");
    expect(ok("1,234.56")).toBe("1234.56");
    expect(ok("1.234.567,89")).toBe("1234567.89");
    expect(ok("1,234,567.89")).toBe("1234567.89");
  });
  it("sin separador de miles, con coma o con punto decimal", () => {
    expect(ok("1234,56")).toBe("1234.56");
    expect(ok("1234.56")).toBe("1234.56");
    expect(ok("0,5")).toBe("0.5");
    expect(ok("12")).toBe("12");
    expect(ok("12,5")).toBe("12.5");
    expect(ok("89.9")).toBe("89.9");
  });
  it("un separador repetido es de miles", () => {
    expect(ok("1.234.567")).toBe("1234567");
    expect(ok("1,234,567")).toBe("1234567");
  });
  it("un solo separador con EXACTAMENTE 3 dígitos detrás es ambiguo: se pide aclararlo (no se adivina)", () => {
    expect(ok("1.234")).toBe("ERROR:ambiguous");
    expect(ok("12,500")).toBe("ERROR:ambiguous");
    expect(ok("999,999")).toBe("ERROR:ambiguous");
  });
  it("con 0, 1, 2 o 4+ decimales no hay ambigüedad", () => {
    expect(ok("12.5")).toBe("12.5");
    expect(ok("12.50")).toBe("12.50");
    expect(ok("12.5000")).toBe("12.5000");
    expect(ok("0.123")).toBe("0.123");
  });
  it("espacios, «Bs» y «$» alrededor no estorban", () => {
    expect(ok(" 1 234,56 ")).toBe("1234.56");
    expect(ok("Bs 120")).toBe("120");
    expect(ok("Bs. 1.234,50")).toBe("1234.50");
    expect(ok("$ 18.5")).toBe("18.5");
    expect(ok("120 Bs")).toBe("120");
  });
  it("vacío es vacío (la base decide si el campo es obligatorio)", () => {
    expect(ok("")).toBe("");
    expect(ok("   ")).toBe("");
  });
  it("el texto en un campo numérico se rechaza", () => {
    expect(ok("abc")).toBe("ERROR:invalid_format");
    expect(ok("12 pesos")).toBe("ERROR:invalid_format");
    expect(ok("1e5")).toBe("ERROR:invalid_format");
    expect(ok("--5")).toBe("ERROR:invalid_format");
    expect(ok("1.2.3,4")).toBe("ERROR:invalid_format");
    expect(ok("12,")).toBe("ERROR:invalid_format");
    expect(ok(",5")).toBe("ERROR:invalid_format");
  });
  it("un negativo conserva su signo (la base lo rechaza con su motivo)", () => {
    expect(ok("-5")).toBe("-5");
    expect(ok("-1.234,5")).toBe("-1234.5");
  });
  it("grupos de miles mal formados no pasan", () => {
    expect(ok("1.23,456.7")).toBe("ERROR:invalid_format");
    expect(ok("12.34.567")).toBe("ERROR:invalid_format");
  });
});
