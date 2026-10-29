// Normalización de identificadores (email / teléfono). Código PURO y sin imports: lo comparten las
// Edge Functions (Deno) y el navegador (Vite), así que ambos aplican exactamente las mismas reglas.

export const SYNTHETIC_EMAIL_DOMAIN = "phone.madeinchola.invalid";
export const DEFAULT_PHONE_COUNTRY = "BO";

/** Prefijos telefónicos soportados (alineado con src/lib/countries.ts). */
export const DIAL_CODES: Readonly<Record<string, string>> = {
  BO: "591",
  AR: "54",
  ES: "34",
  US: "1",
  PE: "51",
  CL: "56",
  CO: "57",
  MX: "52",
  BR: "55",
  PY: "595",
  UY: "598",
  GB: "44",
};

export type PhoneFailure =
  "empty" | "invalid_chars" | "invalid_country" | "too_short" | "too_long" | "invalid_bo_mobile";
export type PhoneResult =
  { ok: true; e164: string; country: string | null } | { ok: false; reason: PhoneFailure };

const PHONE_CHARS = /^\+?[\d\s\-.()]+$/;

// Se prueba el prefijo más largo primero (595 antes que 59x, 1 al final).
const DIALS_BY_LENGTH = Object.entries(DIAL_CODES).sort((a, b) => b[1].length - a[1].length);

function countryOf(digits: string): string | null {
  return DIALS_BY_LENGTH.find(([, dial]) => digits.startsWith(dial))?.[0] ?? null;
}

/** Celulares bolivianos: 8 dígitos que empiezan en 6 o 7. */
const BO_MOBILE = /^[67]\d{7}$/;

function validateInternational(digits: string): PhoneResult {
  // Un E.164 jamás empieza en 0: el código de país no puede ser 0xx.
  if (digits.startsWith("0")) return { ok: false, reason: "invalid_country" };
  if (digits.length < 8) return { ok: false, reason: "too_short" };
  if (digits.length > 15) return { ok: false, reason: "too_long" };
  const country = countryOf(digits);
  if (country === "BO") {
    let national = digits.slice(DIAL_CODES.BO!.length);
    if (national.length === 9 && national.startsWith("0")) national = national.slice(1); // +591 07xxxxxxx
    if (!BO_MOBILE.test(national)) return { ok: false, reason: "invalid_bo_mobile" };
    return { ok: true, e164: `+591${national}`, country };
  }
  return { ok: true, e164: `+${digits}`, country };
}

/**
 * Convierte cualquier formato razonable a E.164. Mismo número en distintos formatos ⇒ mismo resultado
 * (clave para que no existan cuentas duplicadas). Sin prefijo internacional se asume `defaultCountry`.
 */
export function normalizePhone(
  input: string,
  defaultCountry: string = DEFAULT_PHONE_COUNTRY,
): PhoneResult {
  const raw = (input ?? "").trim();
  if (raw === "") return { ok: false, reason: "empty" };
  if (raw === "+") return { ok: false, reason: "empty" };
  if (!PHONE_CHARS.test(raw) || raw.indexOf("+") > 0) return { ok: false, reason: "invalid_chars" };

  const compact = raw.replace(/[\s\-.()]/g, "");
  if (compact === "+" || compact === "") return { ok: false, reason: "empty" };

  if (compact.startsWith("+")) return validateInternational(compact.slice(1));
  if (compact.startsWith("00")) return validateInternational(compact.slice(2));

  const dial = DIAL_CODES[defaultCountry];
  if (!dial) throw new RangeError(`País por defecto no soportado: ${defaultCountry}`);

  // Bolivia: formas nacionales habituales → 7xxxxxxx · 07xxxxxxx · 591 7xxxxxxx (sin "+")
  if (defaultCountry === "BO") {
    if (compact.length === 11 && compact.startsWith("591")) return validateInternational(compact);
    const national = compact.length === 9 && compact.startsWith("0") ? compact.slice(1) : compact;
    if (national.length < 8) return { ok: false, reason: "too_short" };
    if (!BO_MOBILE.test(national))
      return { ok: false, reason: national.length > 8 ? "too_long" : "invalid_bo_mobile" };
    return { ok: true, e164: `+591${national}`, country: "BO" };
  }

  const national = compact.startsWith("0") ? compact.slice(1) : compact; // prefijo troncal
  return validateInternational(`${dial}${national}`);
}

export type EmailFailure = "empty" | "invalid" | "too_long" | "reserved_domain";
export type EmailResult = { ok: true; email: string } | { ok: false; reason: EmailFailure };

/** Minúsculas y sin espacios. `+alias` se conserva (es un buzón distinto a efectos de cuenta). */
export function normalizeEmail(input: string): EmailResult {
  const email = (input ?? "").trim().toLowerCase();
  if (email === "") return { ok: false, reason: "empty" };
  if (email.length > 254) return { ok: false, reason: "too_long" };
  // Sin espacios/control, una sola @, local ≤ 64, dominio con punto y sin puntos consecutivos.
  if (!/^[^@\s\u0000-\u001f]+@[^@\s\u0000-\u001f]+\.[^@\s\u0000-\u001f]+$/.test(email))
    return { ok: false, reason: "invalid" };
  const [local = "", domain = ""] = email.split("@");
  if (local.length > 64 || email.includes("..") || domain.startsWith(".") || domain.endsWith("."))
    return { ok: false, reason: "invalid" };
  // `.invalid` está reservado para correos sintéticos: aceptarlo permitiría "reclamar" el login de un teléfono.
  if (domain.endsWith(".invalid") || domain === "invalid")
    return { ok: false, reason: "reserved_domain" };
  return { ok: true, email };
}

export function syntheticEmailFor(e164: string): string {
  return `${e164.replace(/^\+/, "")}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

export function isSyntheticEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`);
}

export type Identifier =
  | { kind: "email"; value: string }
  | { kind: "phone"; value: string }
  | { kind: "invalid"; value: null };

/** Un campo único "email o teléfono": si contiene @ es email, si no, teléfono. */
export function classifyIdentifier(
  input: string,
  defaultCountry: string = DEFAULT_PHONE_COUNTRY,
): Identifier {
  const text = (input ?? "").trim();
  if (text.includes("@")) {
    const r = normalizeEmail(text);
    return r.ok ? { kind: "email", value: r.email } : { kind: "invalid", value: null };
  }
  const p = normalizePhone(text, defaultCountry);
  return p.ok ? { kind: "phone", value: p.e164 } : { kind: "invalid", value: null };
}
