// Política de contraseñas (código PURO, compartido navegador + Edge Functions).
// El control contra filtraciones (HIBP) está en pwned.ts y se aplica en el servidor.

export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt solo considera los primeros 72 BYTES: más allá, contraseñas distintas serían equivalentes. */
export const PASSWORD_MAX_BYTES = 72;

export type PasswordFailure =
  "too_short" | "too_long" | "common" | "repetitive" | "sequential" | "contains_identifier";

// Bases habituales (se compara en minúsculas y sin dígitos/símbolos finales: "Password123!" ⇒ "password").
const COMMON_BASES = new Set([
  "password",
  "passw0rd",
  "contrasena",
  "contraseña",
  "clave",
  "claves",
  "secreto",
  "admin",
  "administrador",
  "qwerty",
  "qwertyui",
  "qwertyuiop",
  "asdfgh",
  "asdfghjk",
  "asdfghjkl",
  "zxcvbn",
  "zxcvbnm",
  "azerty",
  "iloveyou",
  "teamo",
  "tequiero",
  "letmein",
  "welcome",
  "bienvenido",
  "monkey",
  "dragon",
  "football",
  "futbol",
  "baseball",
  "master",
  "login",
  "abc",
  "abcd",
  "abcde",
  "abcdef",
  "abcdefg",
  "abcdefgh",
  "hola",
  "holamundo",
  "bolivia",
  "lapaz",
  "cochabamba",
  "santacruz",
  "chola",
  "cholita",
  "madeinchola",
  "micontrasena",
  "micontraseña",
  "princesa",
  "mariposa",
  "superman",
  "batman",
  "michael",
  "jordan",
  "sunshine",
  "shadow",
  "trustno",
  "changeme",
  "cambiame",
  "usuario",
  "user",
  "test",
  "testing",
  "prueba",
  "default",
  "guest",
  "root",
  "freedom",
  "whatever",
]);

const COMMON_FULL = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "87654321",
  "11111111",
  "00000000",
  "12341234",
  "1q2w3e4r",
  "1qaz2wsx",
  "123123123",
  "123456123456",
]);

function baseOf(password: string): string {
  return password.toLowerCase().replace(/[\d!@#$%^&*._\-+=?¿¡\s]+$/u, "");
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

function isSequential(text: string): boolean {
  const chars = Array.from(text.toLowerCase());
  if (chars.length < 4) return false;
  let step = 0;
  for (let i = 1; i < chars.length; i++) {
    const d = chars[i]!.codePointAt(0)! - chars[i - 1]!.codePointAt(0)!;
    if (Math.abs(d) !== 1 || (step !== 0 && d !== step)) return false;
    step = d;
  }
  return true;
}

export interface PasswordContext {
  email?: string | null;
  phone?: string | null;
}

export type PasswordResult = { ok: true } | { ok: false; failures: PasswordFailure[] };

export function validatePassword(password: string, context: PasswordContext = {}): PasswordResult {
  const failures: PasswordFailure[] = [];
  const length = Array.from(password).length;

  if (length < PASSWORD_MIN_LENGTH) failures.push("too_short");
  if (utf8Length(password) > PASSWORD_MAX_BYTES) failures.push("too_long");

  if (length >= 1) {
    const lower = password.toLowerCase();
    if (COMMON_FULL.has(lower) || COMMON_BASES.has(baseOf(password))) failures.push("common");
    if (new Set(Array.from(password)).size === 1 || password.trim() === "")
      failures.push("repetitive");
    if (isSequential(password)) failures.push("sequential");

    // Se comparan solo letras/dígitos: "marcelo.quispe@x.com" contra "MarceloQuispe-77".
    const alnum = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const local = alnum(context.email?.split("@")[0] ?? "");
    const phoneDigits = (context.phone ?? "").replace(/\D/g, "");
    const national = phoneDigits.length > 8 ? phoneDigits.slice(-8) : phoneDigits;
    const digitsOnly = password.replace(/\D/g, "");
    if (
      (local.length >= 4 && alnum(password).includes(local)) ||
      (national.length >= 6 && digitsOnly.includes(national))
    ) {
      failures.push("contains_identifier");
    }
  }
  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}
