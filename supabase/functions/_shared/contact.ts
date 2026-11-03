// Planificación PURA de un cambio de contacto (email y teléfono): sin red ni base de datos, para poder probarla a fondo.
// La usa la Edge Function `update-contact` tras verificar la contraseña.
import { normalizeEmail, normalizePhone, syntheticEmailFor } from "./identity.ts";

/** Lo que el cliente pide cambiar. `undefined` = no tocar; `null` o texto vacío = quitar. */
export interface ContactInput {
  email?: string | null;
  phone?: string | null;
  phoneCountry?: string;
}

/** Lo que hay hoy: email y teléfono del perfil, y el email con el que la cuenta existe en Auth (puede ser sintético). */
export interface CurrentContact {
  email: string | null;
  phone: string | null;
  authEmail: string;
}

export type ContactFailure =
  "nothing_to_change" | "invalid_email" | "invalid_phone" | "identifier_required";

export type ContactPlan =
  | { ok: false; reason: ContactFailure }
  | { ok: true; changed: false }
  | {
      ok: true;
      changed: true;
      /** Valores FINALES del perfil. */
      email: string | null;
      phone: string | null;
      /** Email que debe tener la cuenta en Auth: el real o, sin email, el sintético del teléfono. */
      authEmail: string;
      /** ¿Hay que actualizar el email de Auth? (no si ya coincide) */
      authEmailChanged: boolean;
    };

const blank = (value: string | null | undefined) => (value ?? "").trim() === "";

export function planContactChange(current: CurrentContact, input: ContactInput): ContactPlan {
  if (input.email === undefined && input.phone === undefined)
    return { ok: false, reason: "nothing_to_change" };

  let email = current.email;
  if (input.email !== undefined) {
    if (blank(input.email)) email = null;
    else {
      const r = normalizeEmail(input.email as string);
      if (!r.ok) return { ok: false, reason: "invalid_email" };
      email = r.email;
    }
  }

  let phone = current.phone;
  if (input.phone !== undefined) {
    if (blank(input.phone)) phone = null;
    else {
      let r;
      try {
        r = normalizePhone(input.phone as string, input.phoneCountry ?? "BO");
      } catch {
        return { ok: false, reason: "invalid_phone" }; // país por defecto no soportado
      }
      if (!r.ok) return { ok: false, reason: "invalid_phone" };
      phone = r.e164;
    }
  }

  if (email === null && phone === null) return { ok: false, reason: "identifier_required" };
  if (email === current.email && phone === current.phone) return { ok: true, changed: false };

  const authEmail = email ?? syntheticEmailFor(phone as string);
  return {
    ok: true,
    changed: true,
    email,
    phone,
    authEmail,
    // Solo se toca Auth si el email de la cuenta cambia: p. ej. un email real que ya es el de Auth no se reescribe, y un
    // sintético se rehace al cambiar el teléfono o al aparecer un email real.
    authEmailChanged: authEmail !== current.authEmail.trim().toLowerCase(),
  };
}
