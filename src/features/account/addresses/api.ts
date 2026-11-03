import { t } from "@/i18n";
import { AppError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import { fromAddressDbError } from "./errors";
import { ADDRESS_COLUMNS, fromRow, toInsertRow, toUpdatePatch } from "./mapping";
import { ARCHIVED_PAGE_SIZE, type Address, type AddressInput, type DeliveryCountry } from "./types";

/**
 * Capa de datos de la libreta. La seguridad la pone la RLS (cada cliente solo ve y edita lo suyo); además TODA consulta
 * filtra por `profile_id`: un admin sí puede LEER las direcciones de todos (para atender pedidos) y, sin el filtro, vería
 * las ajenas en su propia libreta. Nada se borra: «eliminar» es archivar.
 */

/** Direcciones activas: la predeterminada primero y después las más recientes. */
export async function listActiveAddresses(profileId: string): Promise<Address[]> {
  const { data, error } = await getSupabase()
    .from("addresses")
    .select(ADDRESS_COLUMNS)
    .eq("profile_id", profileId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw fromAddressDbError(error);
  // `sort` es estable: entre las no predeterminadas se conserva el orden «más reciente primero» del servidor.
  return (data ?? []).map(fromRow).sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/** Direcciones archivadas (las últimas `ARCHIVED_PAGE_SIZE`), la más recientemente archivada primero. */
export async function listArchivedAddresses(profileId: string): Promise<Address[]> {
  const { data, error } = await getSupabase()
    .from("addresses")
    .select(ADDRESS_COLUMNS)
    .eq("profile_id", profileId)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false })
    .limit(ARCHIVED_PAGE_SIZE);
  if (error) throw fromAddressDbError(error);
  return (data ?? []).map(fromRow);
}

/** Crea la dirección del cliente. Las reglas de la base (tope de 20, teléfono, coordenadas) llegan como `AppError` en español. */
export async function createAddress(profileId: string, input: AddressInput): Promise<Address> {
  const { data, error } = await getSupabase()
    .from("addresses")
    .insert(toInsertRow(profileId, input))
    .select(ADDRESS_COLUMNS)
    .single();
  if (error) throw fromAddressDbError(error);
  return fromRow(data);
}

const notFound = () => new AppError("not_found", t("acct.addresses.dbErrors.notFound"));

/** Edita una dirección. Si la RLS no deja ver la fila (ajena o inexistente) no se actualiza nada: `not_found`. */
export async function updateAddress(
  profileId: string,
  id: string,
  input: AddressInput,
): Promise<Address> {
  const { data, error } = await getSupabase()
    .from("addresses")
    .update(toUpdatePatch(input))
    .eq("id", id)
    .eq("profile_id", profileId)
    .select(ADDRESS_COLUMNS)
    .maybeSingle();
  if (error) throw fromAddressDbError(error);
  if (!data) throw notFound();
  return fromRow(data);
}

type StateChange = { archived_at: string | null } | { is_default: true };

async function changeState(profileId: string, id: string, change: StateChange): Promise<Address> {
  const { data, error } = await getSupabase()
    .from("addresses")
    .update(change)
    .eq("id", id)
    .eq("profile_id", profileId)
    .select(ADDRESS_COLUMNS)
    .maybeSingle();
  if (error) throw fromAddressDbError(error);
  if (!data) throw notFound();
  return fromRow(data);
}

/**
 * Archiva (`archived_at = ahora`). Si era la predeterminada, un trigger deja como predeterminada a la más reciente de las
 * activas que queden. `now` solo existe para las pruebas.
 */
export const archiveAddress = (profileId: string, id: string, now: Date = new Date()) =>
  changeState(profileId, id, { archived_at: now.toISOString() });

/** Restaura (`archived_at = null`). Cuenta para el tope de 20 activas: si ya hay 20, la base lo rechaza. */
export const restoreAddress = (profileId: string, id: string) =>
  changeState(profileId, id, { archived_at: null });

/** Marca como predeterminada; un trigger desmarca la anterior. */
export const setDefaultAddress = (profileId: string, id: string) =>
  changeState(profileId, id, { is_default: true });

/** Países habilitados para entregas (vista pública `public_countries`). */
export async function listDeliveryCountries(): Promise<DeliveryCountry[]> {
  const { data, error } = await getSupabase()
    .from("public_countries")
    .select("code,name")
    .order("name");
  if (error) throw fromAddressDbError(error);
  const countries: DeliveryCountry[] = [];
  for (const row of data ?? []) {
    // Las columnas de una vista son «anulables» para el tipo generado; un país sin código o sin nombre no sirve.
    if (row.code && row.name) countries.push({ code: row.code, name: row.name });
  }
  return countries;
}
