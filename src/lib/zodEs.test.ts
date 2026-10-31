import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { installZodSpanish, zodErrorMapEs } from "./zodEs";

const first = (result: z.SafeParseReturnType<unknown, unknown>) =>
  result.success ? null : result.error.issues[0]!.message;

describe("mensajes de zod en español", () => {
  beforeAll(() => installZodSpanish());
  afterAll(() => z.setErrorMap(z.defaultErrorMap));

  it("campo ausente → obligatorio (no 'Required')", () => {
    expect(first(z.object({ a: z.string() }).safeParse({}))).toBe("Este campo es obligatorio.");
    expect(first(z.string().safeParse(null))).toBe("Este campo es obligatorio.");
  });
  it("tipo equivocado → valor no válido", () => {
    expect(first(z.string().safeParse(5))).toBe("El valor no es válido.");
    expect(first(z.number().safeParse("x"))).toBe("El valor no es válido.");
  });
  it("string .min(1) se dice 'obligatorio'; .min(n>1) se dice 'mínimo n caracteres'", () => {
    expect(first(z.string().min(1).safeParse(""))).toBe("Este campo es obligatorio.");
    expect(first(z.string().min(8).safeParse("abc"))).toBe("Mínimo 8 caracteres.");
  });
  it("string .max", () => {
    expect(first(z.string().max(3).safeParse("abcd"))).toBe("Máximo 3 caracteres.");
  });
  it("números y listas", () => {
    expect(first(z.number().min(5).safeParse(4))).toBe("Debe ser como mínimo 5.");
    expect(first(z.number().max(5).safeParse(6))).toBe("Debe ser como máximo 5.");
    expect(first(z.array(z.string()).min(2).safeParse(["a"]))).toBe("Elige al menos 2.");
    expect(first(z.array(z.string()).max(1).safeParse(["a", "b"]))).toBe("Elige como máximo 1.");
  });
  it(".int() dice 'entero' y .multipleOf(n) dice 'múltiplo de n' (no se confunden)", () => {
    expect(first(z.number().int().safeParse(1.5))).toBe("Debe ser un número entero.");
    expect(first(z.number().multipleOf(5).safeParse(7))).toBe("Debe ser múltiplo de 5.");
  });
  it(".positive()/.gt() y .negative()/.lt() rechazan el propio límite: 'mayor/menor que', no 'como mínimo/máximo'", () => {
    expect(first(z.number().positive().safeParse(0))).toBe("Debe ser mayor que 0.");
    expect(first(z.number().gt(3).safeParse(3))).toBe("Debe ser mayor que 3.");
    expect(first(z.number().lt(3).safeParse(3))).toBe("Debe ser menor que 3.");
    expect(first(z.number().gte(3).safeParse(2))).toBe("Debe ser como mínimo 3.");
  });
  it(".length(n) dice 'exactamente n' tanto si falta como si sobra", () => {
    expect(first(z.string().length(4).safeParse("abc"))).toBe(
      "Debe tener exactamente 4 caracteres.",
    );
    expect(first(z.string().length(4).safeParse("abcde"))).toBe(
      "Debe tener exactamente 4 caracteres.",
    );
  });
  it("fechas: el límite sale como fecha legible, no como timestamp", () => {
    const limit = new Date("2026-01-15T00:00:00Z");
    expect(first(z.date().min(limit).safeParse(new Date("2025-01-01")))).toBe(
      "La fecha debe ser el 2026-01-15 o posterior.",
    );
    expect(first(z.date().max(limit).safeParse(new Date("2027-01-01")))).toBe(
      "La fecha debe ser el 2026-01-15 o anterior.",
    );
  });
  it("formatos", () => {
    expect(first(z.string().email().safeParse("no"))).toBe("El email no es válido.");
    expect(first(z.string().url().safeParse("no"))).toBe("La dirección web no es válida.");
    expect(first(z.string().uuid().safeParse("no"))).toBe("El identificador no es válido.");
    expect(first(z.string().regex(/^\d+$/).safeParse("a"))).toBe("El formato no es válido.");
  });
  it("enum, fecha", () => {
    expect(first(z.enum(["a", "b"]).safeParse("c"))).toBe("Elige una de estas opciones: a, b.");
    expect(first(z.union([z.literal(1), z.literal(2)]).safeParse(3))).toBe(
      "Elige una opción válida.",
    );
    expect(first(z.date().safeParse(new Date("x")))).toBe("La fecha no es válida.");
  });
  it("un mensaje escrito en el esquema SIEMPRE gana al mapa global", () => {
    expect(first(z.string().min(3, "Muy corto, mínimo 3").safeParse("a"))).toBe(
      "Muy corto, mínimo 3",
    );
    expect(first(z.string({ required_error: "Falta el nombre" }).safeParse(undefined))).toBe(
      "Falta el nombre",
    );
  });
  it("sin el mapa instalado zod habla inglés (el mapa es lo que traduce)", () => {
    z.setErrorMap(z.defaultErrorMap);
    expect(first(z.string().safeParse(undefined))).toBe("Required");
    z.setErrorMap(zodErrorMapEs);
    expect(first(z.string().safeParse(undefined))).toBe("Este campo es obligatorio.");
  });
});
