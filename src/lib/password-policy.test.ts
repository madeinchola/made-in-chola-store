import { describe, expect, it } from "vitest";
import { PASSWORD_MAX_BYTES, validatePassword } from "@shared/password-policy";

const failures = (pw: string, ctx = {}) => {
  const r = validatePassword(pw, ctx);
  return r.ok ? [] : r.failures;
};

describe("validatePassword", () => {
  it("acepta contraseñas razonables, incluso frases largas y con Unicode", () => {
    for (const pw of [
      "Chola-Cielo-2026!",
      "caballo bateria grapa correcta",
      "Ñandú-Vuela-77",
      "x9#Kp2$vLm",
    ]) {
      expect(validatePassword(pw), pw).toEqual({ ok: true });
    }
  });

  it("longitud mínima 8 (cuenta caracteres, no bytes)", () => {
    expect(failures("Ab1!xyz")).toContain("too_short");
    expect(failures("Ab1!xyz9")).not.toContain("too_short");
    expect(failures("ñandúñ1!")).not.toContain("too_short"); // 8 caracteres, más de 8 bytes
    expect(failures("")).toEqual(["too_short"]);
  });

  it("máximo 72 BYTES (límite de bcrypt), no 72 caracteres", () => {
    expect(failures("a1".repeat(36))).not.toContain("too_long"); // 72 bytes exactos
    expect(failures("a1".repeat(36) + "b")).toContain("too_long"); // 73
    expect(failures("ñ".repeat(37))).toContain("too_long"); // 37 chars = 74 bytes
    expect(failures("ñ".repeat(35) + "k1")).not.toContain("too_long"); // 70 + 2 = 72 bytes
    expect(failures("ñ".repeat(36) + "k")).toContain("too_long"); // 72 + 1 = 73 bytes
  });

  it("detecta contraseñas comunes aunque les pongan números, mayúsculas o símbolos al final", () => {
    for (const pw of [
      "password",
      "Password1",
      "PASSWORD123!",
      "contraseña2024",
      "Qwerty.2020",
      "madeinchola1",
      "12345678",
      "MiContraseña!!",
    ]) {
      expect(failures(pw), pw).toContain("common");
    }
    expect(failures("Contrapeso-Andino9")).not.toContain("common");
  });

  it("detecta repetitivas y secuenciales", () => {
    expect(failures("aaaaaaaa")).toContain("repetitive");
    expect(failures("        ")).toContain("repetitive");
    expect(failures("abcdefgh")).toContain("sequential");
    expect(failures("hgfedcba")).toContain("sequential");
    expect(failures("23456789")).toContain("sequential");
    expect(failures("abcdefgh9X")).not.toContain("sequential"); // solo una parte
    expect(failures("Abc12345Xy")).not.toContain("sequential");
  });

  it("no permite incluir el email (ignorando puntos y guiones) ni el teléfono", () => {
    expect(failures("MarceloQuispe-77", { email: "marcelo.quispe@x.com" })).toContain(
      "contains_identifier",
    );
    expect(failures("zz-marcelo_quispe-zz", { email: "marcelo.quispe@x.com" })).toContain(
      "contains_identifier",
    );
    expect(failures("Cielo-71234567-azul", { phone: "+59171234567" })).toContain(
      "contains_identifier",
    );
    expect(
      failures("Cielo-azul-2026", { email: "marcelo.quispe@x.com", phone: "+59171234567" }),
    ).toEqual([]);
  });

  it("usuarios cortos no disparan falsos positivos (<4 letras / <6 dígitos)", () => {
    expect(failures("Ana-Cielo-2026", { email: "ana@x.com" })).toEqual([]);
    expect(failures("Cielo-azul-123", { phone: "+59112" })).toEqual([]);
  });

  it("acumula todos los fallos, no solo el primero", () => {
    expect(failures("aaa")).toEqual(expect.arrayContaining(["too_short", "repetitive"]));
  });

  it("constante de límite coherente", () => {
    expect(PASSWORD_MAX_BYTES).toBe(72);
  });
});
