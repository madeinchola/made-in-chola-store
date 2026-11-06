import { fromDbError } from "@/lib/db-errors";
import { getSupabase } from "@/lib/supabase";
import { updateVersioned } from "../lib/versioned";
import {
  fromBlockedRow,
  fromLocationRow,
  fromMethodRow,
  fromRateRow,
  fromSlotRow,
  fromZoneRow,
  toLocationRow,
  toMethodInsert,
  toMethodUpdate,
  toRateInsert,
  toRateUpdate,
  toSlotInsert,
  toSlotUpdate,
  toZoneInsert,
  toZoneUpdate,
} from "./mapping";
import type {
  BlockedDate,
  DeliverySlot,
  LocationInput,
  MethodCreateInput,
  MethodUpdateInput,
  RateCreateInput,
  RateRule,
  RateUpdateInput,
  ShippingMethod,
  ShippingZone,
  SlotCreateInput,
  SlotUpdateInput,
  StoreLocation,
  ZoneCreateInput,
  ZoneUpdateInput,
} from "./types";

/**
 * Capa de datos del panel de Envíos. La seguridad la pone la RLS (solo el admin lee y escribe estas tablas). Nada se borra:
 * «eliminar» es archivar. Cada cambio exige la versión (`updatedAt`) leída, así que dos personas no se pisan en silencio, y
 * devuelve la versión NUEVA.
 */

const archiveNow = (archived: boolean) => ({
  archived_at: archived ? new Date().toISOString() : null,
});

// ── Ubicaciones ────────────────────────────────────────────────────────────────────────────
export async function listLocations(): Promise<StoreLocation[]> {
  const { data, error } = await getSupabase()
    .from("store_locations")
    .select("*")
    .order("created_at")
    .order("id");
  if (error) throw fromDbError(error);
  return (data ?? []).map(fromLocationRow);
}
export async function createLocation(input: LocationInput): Promise<StoreLocation> {
  const { data, error } = await getSupabase()
    .from("store_locations")
    .insert(toLocationRow(input))
    .select("*")
    .single();
  if (error) throw fromDbError(error);
  return fromLocationRow(data);
}
export const updateLocation = (id: string, updatedAt: string, input: LocationInput) =>
  updateVersioned("store_locations", id, updatedAt, toLocationRow(input));
export const setLocationArchived = (id: string, updatedAt: string, archived: boolean) =>
  updateVersioned("store_locations", id, updatedAt, archiveNow(archived));
/** Marca el origen del cálculo: suelta el anterior y marca este en un solo paso (solo admin). */
export async function setPrimaryLocation(id: string): Promise<void> {
  const { error } = await getSupabase().rpc("admin_set_primary_location", { p_id: id });
  if (error) throw fromDbError(error);
}

// ── Métodos ────────────────────────────────────────────────────────────────────────────────
export async function listMethods(): Promise<ShippingMethod[]> {
  const { data, error } = await getSupabase()
    .from("shipping_methods")
    .select("*")
    .order("sort_order")
    .order("created_at");
  if (error) throw fromDbError(error);
  return (data ?? []).map(fromMethodRow);
}
export async function createMethod(input: MethodCreateInput): Promise<ShippingMethod> {
  const { data, error } = await getSupabase()
    .from("shipping_methods")
    .insert(toMethodInsert(input))
    .select("*")
    .single();
  if (error) throw fromDbError(error);
  return fromMethodRow(data);
}
export const updateMethod = (id: string, updatedAt: string, input: MethodUpdateInput) =>
  updateVersioned("shipping_methods", id, updatedAt, toMethodUpdate(input));
export const setMethodArchived = (id: string, updatedAt: string, archived: boolean) =>
  updateVersioned("shipping_methods", id, updatedAt, archiveNow(archived));

// ── Zonas ──────────────────────────────────────────────────────────────────────────────────
export async function listZones(): Promise<ShippingZone[]> {
  const { data, error } = await getSupabase()
    .from("shipping_zones")
    .select("*")
    .order("created_at")
    .order("id");
  if (error) throw fromDbError(error);
  return (data ?? []).map(fromZoneRow);
}
export async function createZone(input: ZoneCreateInput): Promise<ShippingZone> {
  const { data, error } = await getSupabase()
    .from("shipping_zones")
    .insert(toZoneInsert(input))
    .select("*")
    .single();
  if (error) throw fromDbError(error);
  return fromZoneRow(data);
}
export const updateZone = (id: string, updatedAt: string, input: ZoneUpdateInput) =>
  updateVersioned("shipping_zones", id, updatedAt, toZoneUpdate(input));
export const setZoneArchived = (id: string, updatedAt: string, archived: boolean) =>
  updateVersioned("shipping_zones", id, updatedAt, archiveNow(archived));

// ── Tarifas ────────────────────────────────────────────────────────────────────────────────
export async function listRates(): Promise<RateRule[]> {
  const { data, error } = await getSupabase()
    .from("shipping_rate_rules")
    .select("*")
    .order("priority", { ascending: false })
    .order("created_at");
  if (error) throw fromDbError(error);
  return (data ?? []).map(fromRateRow);
}
export async function createRate(input: RateCreateInput): Promise<RateRule> {
  const { data, error } = await getSupabase()
    .from("shipping_rate_rules")
    .insert(toRateInsert(input))
    .select("*")
    .single();
  if (error) throw fromDbError(error);
  return fromRateRow(data);
}
export const updateRate = (id: string, updatedAt: string, input: RateUpdateInput) =>
  updateVersioned("shipping_rate_rules", id, updatedAt, toRateUpdate(input));
export const setRateArchived = (id: string, updatedAt: string, archived: boolean) =>
  updateVersioned("shipping_rate_rules", id, updatedAt, archiveNow(archived));

// ── Franjas y fechas bloqueadas ────────────────────────────────────────────────────────────
export async function listSlots(): Promise<DeliverySlot[]> {
  const { data, error } = await getSupabase()
    .from("delivery_slots")
    .select("*")
    .order("weekday")
    .order("start_time");
  if (error) throw fromDbError(error);
  return (data ?? []).map(fromSlotRow);
}
export async function createSlot(input: SlotCreateInput): Promise<DeliverySlot> {
  const { data, error } = await getSupabase()
    .from("delivery_slots")
    .insert(toSlotInsert(input))
    .select("*")
    .single();
  if (error) throw fromDbError(error);
  return fromSlotRow(data);
}
export const updateSlot = (id: string, updatedAt: string, input: SlotUpdateInput) =>
  updateVersioned("delivery_slots", id, updatedAt, toSlotUpdate(input));
export const setSlotArchived = (id: string, updatedAt: string, archived: boolean) =>
  updateVersioned("delivery_slots", id, updatedAt, archiveNow(archived));

export async function listBlockedDates(): Promise<BlockedDate[]> {
  const { data, error } = await getSupabase()
    .from("blocked_dates")
    .select("*")
    .order("blocked_on", { ascending: false });
  if (error) throw fromDbError(error);
  return (data ?? []).map(fromBlockedRow);
}
export async function createBlockedDate(
  blockedOn: string,
  reason: string | null,
): Promise<BlockedDate> {
  const { data, error } = await getSupabase()
    .from("blocked_dates")
    .insert({ blocked_on: blockedOn, reason: reason?.trim() || null })
    .select("*")
    .single();
  if (error) throw fromDbError(error);
  return fromBlockedRow(data);
}
export const updateBlockedDateReason = (id: string, updatedAt: string, reason: string | null) =>
  updateVersioned("blocked_dates", id, updatedAt, { reason: reason?.trim() || null });
export const setBlockedDateArchived = (id: string, updatedAt: string, archived: boolean) =>
  updateVersioned("blocked_dates", id, updatedAt, archiveNow(archived));
