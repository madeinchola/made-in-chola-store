import { describe, expect, it } from "vitest";
import {
  classifyIdentifier,
  isSyntheticEmail,
  normalizeEmail,
  normalizePhone,
  syntheticEmailFor,
} from "@shared/identity";

const ok = (e164: string, country: string | null = "BO") => ({ ok: true, e164, country });
const fail = (reason: string) => ({ ok: false, reason });

describe("normalizePhone: Bolivia (por defecto)", () => {
  // Mismo número, distintos formatos → exactamente el mismo E.164 (evita cuentas duplicadas).
  it.each([
    "71234567",
    "7123 4567",
    "7123-4567",
    "(7123) 4567",
    "712.34.567",
    "071234567",
    "+591 71234567",
    "+591-7123-4567",
    "+(591) 71234567",
    "591 71234567",
    "59171234567",
    "00591 71234567",
    "0059171234567",
    "  +591 7123 4567  ",
    "+591 071234567",
  ])("«%s» → +59171234567", (input) => {
    expect(normalizePhone(input)).toEqual(ok("+59171234567"));
  });

  it("acepta celulares que empiezan en 6 y en 7", () => {
    expect(normalizePhone("61234567")).toEqual(ok("+59161234567"));
    expect(normalizePhone("79999999")).toEqual(ok("+59179999999"));
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["+", "empty"],
    ["abc", "invalid_chars"],
    ["7123x567", "invalid_chars"],
    ["7123 4567 ext 5", "invalid_chars"],
    ["71+234567", "invalid_chars"],
    ["7123456", "too_short"], // 7 dígitos
    ["+591 7123", "too_short"],
    ["712345678", "too_long"], // 9 dígitos sin 0 inicial
    ["22123456", "invalid_bo_mobile"], // fijo de La Paz
    ["51234567", "invalid_bo_mobile"], // empieza en 5
    ["+591 22123456", "invalid_bo_mobile"],
    ["+591 8123456", "invalid_bo_mobile"],
  ])("rechaza «%s» (%s)", (input, reason) => {
    expect(normalizePhone(input)).toEqual(fail(reason));
  });

  it("no recorta de más: 0 inicial solo se quita si sobra exactamente 1 dígito", () => {
    expect(normalizePhone("0712345678")).toEqual(fail("too_long"));
    expect(normalizePhone("00071234567")).toEqual(fail("invalid_country"));
  });
});

describe("normalizePhone: otros países", () => {
  it("con prefijo internacional se acepta E.164 genérico", () => {
    expect(normalizePhone("+54 9 11 2345-6789")).toEqual(ok("+5491123456789", "AR"));
    expect(normalizePhone("+34 612 345 678")).toEqual(ok("+34612345678", "ES"));
    expect(normalizePhone("+1 (415) 555-2671")).toEqual(ok("+14155552671", "US"));
    expect(normalizePhone("0034 612345678")).toEqual(ok("+34612345678", "ES"));
  });
  it("país por defecto distinto de BO: antepone su prefijo y quita el cero troncal", () => {
    expect(normalizePhone("612 345 678", "ES")).toEqual(ok("+34612345678", "ES"));
    expect(normalizePhone("0612345678", "ES")).toEqual(ok("+34612345678", "ES"));
  });
  it("el prefijo más largo gana: +595 es Paraguay, no un número de +59x", () => {
    expect(normalizePhone("+595 981 123456")).toEqual(ok("+595981123456", "PY"));
  });
  it("país desconocido como default lanza (error de programación, no de usuario)", () => {
    expect(() => normalizePhone("123", "ZZ")).toThrow(RangeError);
  });
  it("E.164 fuera de rango", () => {
    expect(normalizePhone("+1234567")).toEqual(fail("too_short"));
    expect(normalizePhone("+1234567890123456")).toEqual(fail("too_long"));
    expect(normalizePhone("+0123456789")).toEqual(fail("invalid_country"));
  });
});

describe("normalizeEmail", () => {
  it("minúsculas y sin espacios; conserva +alias", () => {
    expect(normalizeEmail("  Ana.Perez+Tienda@Correo.COM ")).toEqual({
      ok: true,
      email: "ana.perez+tienda@correo.com",
    });
  });
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["sinarroba", "invalid"],
    ["a@b", "invalid"],
    ["a@@b.com", "invalid"],
    ["a b@c.com", "invalid"],
    ["a@b..com", "invalid"],
    ["a@.com", "invalid"],
    ["a@b.com.", "invalid"],
    ["a\u0000@b.com", "invalid"],
    [`${"x".repeat(65)}@b.com`, "invalid"],
    [`${"x".repeat(250)}@b.com`, "too_long"],
    ["alguien@phone.madeinchola.invalid", "reserved_domain"],
    ["alguien@algo.INVALID", "reserved_domain"],
  ])("rechaza «%s» (%s)", (input, reason) => {
    expect(normalizeEmail(input)).toEqual({ ok: false, reason });
  });
});

describe("email sintético para solo-teléfono", () => {
  it("se deriva del E.164 y es reconocible", () => {
    const email = syntheticEmailFor("+59171234567");
    expect(email).toBe("59171234567@phone.madeinchola.invalid");
    expect(isSyntheticEmail(email)).toBe(true);
    expect(isSyntheticEmail(email.toUpperCase())).toBe(true);
    expect(isSyntheticEmail("ana@correo.com")).toBe(false);
  });
  it("un usuario NO puede registrar un email sintético ajeno (el dominio está reservado)", () => {
    expect(normalizeEmail(syntheticEmailFor("+59171234567")).ok).toBe(false);
  });
});

describe("classifyIdentifier (campo único)", () => {
  it("con @ es email; si no, teléfono", () => {
    expect(classifyIdentifier(" Ana@Correo.com ")).toEqual({
      kind: "email",
      value: "ana@correo.com",
    });
    expect(classifyIdentifier("7123 4567")).toEqual({ kind: "phone", value: "+59171234567" });
    expect(classifyIdentifier("+54 9 11 2345 6789")).toEqual({
      kind: "phone",
      value: "+5491123456789",
    });
  });
  it("lo inválido se marca como invalid (nunca se adivina)", () => {
    expect(classifyIdentifier("")).toEqual({ kind: "invalid", value: null });
    expect(classifyIdentifier("hola@")).toEqual({ kind: "invalid", value: null });
    expect(classifyIdentifier("12")).toEqual({ kind: "invalid", value: null });
    expect(classifyIdentifier("x@y.invalid")).toEqual({ kind: "invalid", value: null });
  });
});
