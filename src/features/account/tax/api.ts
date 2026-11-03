import type { Database } from "@/lib/database.types";
import { getSupabase } from "@/lib/supabase";
import { fromTaxDbError, taxNotFound } from "./errors";
import { TAX_DOC_TYPES, type TaxDocType } from "./taxId";
import type { TaxProfile, TaxProfileInput } from "./types";

interface Row {
  id: string;
  doc_type: string;
  doc_number: string;
  legal_name: string;
  is_default: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id,doc_type,doc_number,legal_name,is_default,archived_at,created_at,updated_at";

const isDocType = (value: string): value is TaxDocType =>
  (TAX_DOC_TYPES as readonly string[]).includes(value);

const mapRow = (row: Row): TaxProfile => ({
  id: row.id,
  // La base garantiza uno de los cinco tipos (CHECK); un valor inesperado cae en «otro» en vez de romper la pantalla.
  docType: isDocType(row.doc_type) ? row.doc_type : "otro",
  docNumber: row.doc_number,
  legalName: row.legal_name,
  isDefault: row.is_default,
  archived: row.archived_at !== null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * Datos fiscales de `profileId`, activos y archivados, del más reciente al más antiguo. El filtro por dueño es
 * imprescindible: para un admin la RLS deja leer los de TODOS los clientes y sin él se mezclarían en su propia cuenta.
 */
export async function listTaxProfiles(profileId: string): Promise<TaxProfile[]> {
  const { data, error } = await getSupabase()
    .from("tax_profiles")
    .select(COLUMNS)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw fromTaxDbError(error);
  return (data ?? []).map(mapRow);
}

/**
 * Crea un dato fiscal. NO envía `is_default`: la base marca como predeterminado al primero activo (y solo a él).
 * `profile_id` es el de la sesión (la RLS exige que coincida con `auth.uid()`).
 */
export async function createTaxProfile(
  profileId: string,
  input: TaxProfileInput,
): Promise<TaxProfile> {
  const { data, error } = await getSupabase()
    .from("tax_profiles")
    .insert({
      profile_id: profileId,
      doc_type: input.docType,
      doc_number: input.docNumber,
      legal_name: input.legalName,
    })
    .select(COLUMNS)
    .single();
  if (error) throw fromTaxDbError(error);
  return mapRow(data);
}

/** Actualiza una fila y devuelve la fila nueva. 0 filas = no existe o no es suya (la RLS la oculta). */
type Patch = Database["public"]["Tables"]["tax_profiles"]["Update"];

async function updateRow(id: string, patch: Patch): Promise<TaxProfile> {
  const { data, error } = await getSupabase()
    .from("tax_profiles")
    .update(patch)
    .eq("id", id)
    .select(COLUMNS);
  if (error) throw fromTaxDbError(error);
  const row = data?.[0];
  if (!row) throw taxNotFound();
  return mapRow(row);
}

/** Edita tipo, documento y razón social. No toca el estado (predeterminado/archivado): eso va en sus propias acciones. */
export const updateTaxProfile = (id: string, input: TaxProfileInput) =>
  updateRow(id, {
    doc_type: input.docType,
    doc_number: input.docNumber,
    legal_name: input.legalName,
  });

/** Archiva (nada se borra, BR-ACC-07). Si era el predeterminado, la base promueve al más reciente de los que quedan. */
export const archiveTaxProfile = (id: string) =>
  updateRow(id, { archived_at: new Date().toISOString() });

/** Restaura un archivado. La base aplica el tope de 10 activos y el documento no repetido también aquí. */
export const restoreTaxProfile = (id: string) => updateRow(id, { archived_at: null });

/** Marca como predeterminado; la base desmarca al anterior. */
export const setDefaultTaxProfile = (id: string) => updateRow(id, { is_default: true });
