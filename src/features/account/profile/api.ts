import { fromDbError } from "@/lib/db-errors";
import { AppError } from "@/lib/errors";
import { callFunction, type FunctionResult } from "@/lib/functions";
import type { Database } from "@/lib/database.types";
import { getSupabase } from "@/lib/supabase";
import { t } from "@/i18n";

/** Nombre y preferencias del perfil (lo que la sesión no trae). `currency` NULL = la de la tienda. */
export interface ProfilePreferences {
  fullName: string;
  locale: string;
  currency: string | null;
}

/** Cambio parcial: `undefined` = no tocar. `currency: null` = volver a la moneda de la tienda. */
export interface ProfilePatch {
  fullName?: string;
  locale?: string;
  currency?: string | null;
}

export interface PublicCurrency {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
}

const COLUMNS = "full_name,preferred_locale,preferred_currency";

interface Row {
  full_name: string;
  preferred_locale: string;
  preferred_currency: string | null;
}

const mapRow = (row: Row): ProfilePreferences => ({
  fullName: row.full_name,
  locale: row.preferred_locale,
  currency: row.preferred_currency,
});

const notFound = () => new AppError("not_found", t("acct.profile.errors.notFound"));

/**
 * Lee SOLO el perfil de `userId`. El filtro por id es imprescindible: para un admin la RLS devuelve TODOS los perfiles
 * (`profiles_select_admin`) y sin él se leería el de otra persona.
 */
export async function getProfilePreferences(userId: string): Promise<ProfilePreferences> {
  const { data, error } = await getSupabase()
    .from("profiles")
    .select(COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw notFound();
  return mapRow(data);
}

/**
 * Actualiza nombre y/o preferencias. Solo se envían las columnas que el cliente puede editar (full_name,
 * preferred_locale, preferred_currency); email, teléfono y rol NO se tocan desde aquí. La base rechaza una moneda
 * deshabilitada (22023) y la RLS filtra a la propia fila: 0 filas actualizadas significa que no existe o no es suya.
 */
export async function updateProfile(
  userId: string,
  patch: ProfilePatch,
): Promise<ProfilePreferences> {
  const columns: Database["public"]["Tables"]["profiles"]["Update"] = {};
  if (patch.fullName !== undefined) columns.full_name = patch.fullName;
  if (patch.locale !== undefined) columns.preferred_locale = patch.locale;
  if (patch.currency !== undefined) columns.preferred_currency = patch.currency;
  if (Object.keys(columns).length === 0) return getProfilePreferences(userId);

  const { data, error } = await getSupabase()
    .from("profiles")
    .update(columns)
    .eq("id", userId)
    .select(COLUMNS);
  if (error) throw fromDbError(error);
  const row = data?.[0];
  if (!row) throw notFound();
  return mapRow(row);
}

/** Monedas HABILITADAS (vista pública), por código. Las filas incompletas se descartan. */
export async function listPublicCurrencies(): Promise<PublicCurrency[]> {
  const { data, error } = await getSupabase()
    .from("public_currencies")
    .select("code,name,symbol,decimals")
    .order("code");
  if (error) throw fromDbError(error);
  const out: PublicCurrency[] = [];
  for (const row of data ?? []) {
    if (!row.code || !row.name || !row.symbol) continue;
    out.push({ code: row.code, name: row.name, symbol: row.symbol, decimals: row.decimals ?? 2 });
  }
  return out;
}

export interface ContactChange {
  /** Contraseña actual: la Edge Function la exige para cualquier cambio de contacto. */
  password: string;
  /** `undefined` = no tocar · `null` = quitar · texto = valor nuevo. */
  email?: string | null;
  phone?: string | null;
  /** País del teléfono escrito en formato nacional (ISO alfa-2). Solo viaja si hay `phone` con texto. */
  phoneCountry?: string;
}

/** Cuerpo de `update-contact`: solo incluye lo que cambia (`undefined` no se envía). */
export function contactBody(input: ContactChange): Record<string, unknown> {
  const body: Record<string, unknown> = { password: input.password };
  if (input.email !== undefined) body.email = input.email;
  if (input.phone !== undefined) {
    body.phone = input.phone;
    if (input.phone !== null && input.phoneCountry !== undefined) {
      body.phone_country = input.phoneCountry;
    }
  }
  return body;
}

export function changeContact(
  input: ContactChange,
  token: string | undefined,
): Promise<FunctionResult<{ ok: true; changed: boolean }>> {
  return callFunction("update-contact", contactBody(input), { token });
}
