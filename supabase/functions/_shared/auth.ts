import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
