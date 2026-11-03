import type { Database } from "@/lib/database.types";
import type { Address, AddressInput } from "./types";

export type AddressRow = Database["public"]["Tables"]["addresses"]["Row"];
type AddressInsert = Database["public"]["Tables"]["addresses"]["Insert"];
type AddressUpdate = Database["public"]["Tables"]["addresses"]["Update"];

/** Columnas que se leen (todas las de la fila, sin `*` para que un cambio de esquema no meta datos sin querer). */
export const ADDRESS_COLUMNS =
  "id,profile_id,label,recipient,phone_e164,line1,line2,city,department,country,reference_text,lat,lng,is_default,for_shipping,for_billing,archived_at,created_at,updated_at";

/** `numeric` puede llegar como número o como texto según el cliente: se normaliza a número (o null). */
function toCoordinate(value: number | string | null): number | null {
  if (value === null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function fromRow(row: AddressRow): Address {
  const lat = toCoordinate(row.lat);
  const lng = toCoordinate(row.lng);
  // El pin es todo o nada: si por algún motivo llegara a medias, no se muestra un pin falso.
  const hasPin = lat !== null && lng !== null;
  return {
    id: row.id,
    profileId: row.profile_id,
    label: row.label,
    recipient: row.recipient,
    phone: row.phone_e164,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    department: row.department,
    country: row.country,
    referenceText: row.reference_text,
    lat: hasPin ? lat : null,
    lng: hasPin ? lng : null,
    isDefault: row.is_default,
    forShipping: row.for_shipping,
    forBilling: row.for_billing,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Campos editables comunes a crear y editar (nunca `profile_id` ni `archived_at`). */
function editableColumns(input: AddressInput) {
  return {
    label: input.label,
    recipient: input.recipient,
    phone_e164: input.phoneE164,
    line1: input.line1,
    line2: input.line2,
    city: input.city,
    department: input.department,
    country: input.country,
    reference_text: input.referenceText,
    lat: input.lat,
    lng: input.lng,
    for_shipping: input.forShipping,
    for_billing: input.forBilling,
  };
}

/** Fila a insertar: el dueño lo fija la sesión (la RLS exige `profile_id = auth.uid()`). */
export function toInsertRow(profileId: string, input: AddressInput): AddressInsert {
  return { profile_id: profileId, ...editableColumns(input), is_default: input.isDefault };
}

/**
 * Cambios al editar. `is_default` solo viaja cuando se QUIERE marcar como predeterminada: enviar `false` dejaría al
 * cliente sin predeterminada (la base no lo corrige). Para cambiarla se marca OTRA como predeterminada.
 */
export function toUpdatePatch(input: AddressInput): AddressUpdate {
  return input.isDefault ? { ...editableColumns(input), is_default: true } : editableColumns(input);
}
