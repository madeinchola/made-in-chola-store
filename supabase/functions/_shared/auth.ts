import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serviceClient } from "./supabase.ts";

// Mensaje ÚNICO para cualquier fallo de credenciales: usuario inexistente, contraseña incorrecta,
// cuenta desactivada o identificador mal formado. Imposible distinguirlos desde fuera.
export const INVALID_CREDENTIALS = {
  status: 401,
  code: "invalid_credentials",
  message: "Credenciales inválidas",
} as const;

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Variable de entorno faltante: ${name}`);
  return value;
}

/** Cliente anónimo SIN estado: sirve para validar una contraseña sin tocar ninguna sesión. */
export function statelessAnonClient() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// Hash bcrypt (coste 10, igual que GoTrue) de una cadena aleatoria descartada. Se compara contra él
// cuando la cuenta NO existe, para que ese camino tarde parecido al de una contraseña incorrecta.
const DECOY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

export async function burnDecoyHash(password: string): Promise<void> {
  const mod = await import("https://esm.sh/bcryptjs@2.4.3");
  // esm.sh entrega bcryptjs como CommonJS: en runtime la API vive en `default`, aunque los tipos digan lo contrario.
  const bcrypt = (mod as { default?: typeof mod }).default ?? mod;
  await bcrypt.compare(password, DECOY_HASH);
}

/** Token (JWT) de la cabecera `Authorization: Bearer …`, o null si falta o no tiene esa forma. */
export function bearerToken(req: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") ?? "");
  return match ? (match[1] ?? null) : null;
}

/**
 * ¿La contraseña es la de esa cuenta? Se usa para CONFIRMAR acciones sensibles (cambiar contacto, cambiar contraseña,
 * desactivar). Comprobarla con `signInWithPassword` crea una sesión REAL en GoTrue (con su refresh token): se cierra en
 * el acto para no dejar una sesión fantasma viva por cada confirmación (cada una quedaba válida y sin dueño).
 */
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  const { data, error } = await statelessAnonClient().auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  try {
    await serviceClient().auth.admin.signOut(data.session.access_token, "local");
  } catch {
    // Mejor esfuerzo: si no se pudo cerrar, la contraseña ya está confirmada y la sesión caduca sola.
  }
  return true;
}

/** Par de tokens de una sesión nueva (lo que el navegador necesita para `setSession`). */
export interface IssuedSession {
  access_token: string;
  refresh_token: string;
}

/**
 * Cambiar o restablecer la contraseña debe dejar SOLO una sesión viva: la de quien acaba de hacerlo. Una sesión robada o
 * abierta en otro equipo no debe seguir valiendo (el cambio de contraseña por sí solo no siempre las revoca: GoTrue
 * cierra todas, incluida la actual, o ninguna, según la versión). Para que el resultado sea el mismo en cualquier
 * versión: (1) se cierran TODAS las sesiones (si GoTrue ya lo hizo, la llamada falla sin consecuencias) y (2) se abre una
 * sesión nueva con la contraseña nueva, que se entrega al navegador para que la persona no quede fuera de su cuenta.
 * Devuelve null si no se pudo abrir (entonces la persona debe iniciar sesión de nuevo).
 */
export async function renewSessionsAfterPasswordChange(
  currentJwt: string | null,
  email: string,
  newPassword: string,
): Promise<IssuedSession | null> {
  if (currentJwt) {
    try {
      await serviceClient().auth.admin.signOut(currentJwt, "global");
    } catch {
      // La sesión pudo cerrarse ya con el cambio de contraseña: no es un error.
    }
  }
  const { data, error } = await statelessAnonClient().auth.signInWithPassword({
    email,
    password: newPassword,
  });
  if (error || !data.session) return null;
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
}

/** Reclamos (payload) de un JWT YA validado por GoTrue; null si no tiene la forma esperada. No verifica la firma. */
export function jwtClaims(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (c) =>
        c.charCodeAt(0),
      ),
    );
    const parsed: unknown = JSON.parse(json);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Vigencia de una sesión de recuperación para poder fijar una contraseña nueva sin la actual. */
export const RECOVERY_MAX_AGE_SECONDS = 15 * 60;

/**
 * ¿Es esta una sesión que nació del ENLACE DE RECUPERACIÓN del correo (reciente)? GoTrue la marca en el reclamo `amr`
 * como método `otp` (o `recovery` en otras versiones) con la hora en que se verificó el enlace. Una sesión iniciada con
 * contraseña (`amr: password`) NO lo es: para cambiar la contraseña desde la cuenta hay que dar la actual
 * (`change-password`); si no, quien robara un token de acceso fijaría una contraseña nueva y se quedaría con la cuenta.
 */
export function isRecentRecoverySession(
  claims: Record<string, unknown> | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  maxAgeSeconds: number = RECOVERY_MAX_AGE_SECONDS,
): boolean {
  const amr = claims?.amr;
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    if (entry === null || typeof entry !== "object") return false;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    if (method !== "otp" && method !== "recovery") return false;
    if (typeof timestamp !== "number") return false; // (NaN da edad NaN: las comparaciones de abajo fallan)
    const age = nowSeconds - timestamp;
    return age >= -60 && age <= maxAgeSeconds; // se toleran 60 s de desfase de relojes hacia el futuro
  });
}
