import type { Database, Json } from "@/lib/database.types";
import type {
  BlockedDate,
  DeliverySlot,
  LocationInput,
  MethodCreateInput,
  MethodUpdateInput,
  RateCreateInput,
  RateParams,
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

type Tables = Database["public"]["Tables"];

/** PostgREST devuelve la hora como «10:00:00»: el panel trabaja con «10:00». */
export const hhmm = (time: string): string => time.slice(0, 5);

const isRec = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Lee el JSON de `params` según el tipo de la regla; null si no tiene la forma esperada. */
export function paramsFromJson(kind: string, json: unknown): RateParams | null {
  if (!isRec(json)) return null;
  if (kind === "flat") return isNum(json.cost) ? { kind: "flat", cost: json.cost } : null;
  if (kind !== "distance" || !Array.isArray(json.tiers)) return null;
  const tiers = [];
  for (const t of json.tiers) {
    if (!isRec(t) || !isNum(t.up_to_km) || !isNum(t.cost)) return null;
    tiers.push({ upToKm: t.up_to_km, cost: t.cost });
  }
  const opt = (v: unknown): number | null => (isNum(v) ? v : null);
  return {
    kind: "distance",
    tiers,
    extraPerKm: opt(json.extra_per_km),
    minCost: opt(json.min_cost),
    maxCost: opt(json.max_cost),
  };
}

/** El JSON que guarda la base (sin claves vacías: la base rechaza las desconocidas y exige números). */
export function paramsToJson(p: RateParams): Json {
  if (p.kind === "flat") return { cost: p.cost };
  const out: Record<string, Json> = {
    tiers: p.tiers.map((t) => ({ up_to_km: t.upToKm, cost: t.cost })),
  };
  if (p.extraPerKm !== null) out.extra_per_km = p.extraPerKm;
  if (p.minCost !== null) out.min_cost = p.minCost;
  if (p.maxCost !== null) out.max_cost = p.maxCost;
  return out;
}

export const fromLocationRow = (r: Tables["store_locations"]["Row"]): StoreLocation => ({
  id: r.id,
  name: r.name,
  addressText: r.address_text,
  city: r.city,
  lat: r.lat,
  lng: r.lng,
  pickupHours: r.pickup_hours,
  isPrimary: r.is_primary,
  isActive: r.is_active,
  archived: r.archived_at !== null,
  updatedAt: r.updated_at,
});
export const toLocationRow = (i: LocationInput) => ({
  name: i.name.trim(),
  address_text: i.addressText.trim(),
  city: i.city.trim(),
  lat: i.lat,
  lng: i.lng,
  pickup_hours: i.pickupHours?.trim() || null,
  is_active: i.isActive,
});

export const fromMethodRow = (r: Tables["shipping_methods"]["Row"]): ShippingMethod => ({
  id: r.id,
  code: r.code,
  name: r.name,
  kind: r.kind === "pickup" ? "pickup" : "delivery",
  description: r.description,
  etaMinDays: r.eta_min_days,
  etaMaxDays: r.eta_max_days,
  pickupLocationId: r.pickup_location_id,
  isActive: r.is_active,
  sortOrder: r.sort_order,
  archived: r.archived_at !== null,
  updatedAt: r.updated_at,
});
export const toMethodUpdate = (i: MethodUpdateInput) => ({
  name: i.name.trim(),
  description: i.description?.trim() || null,
  eta_min_days: i.etaMinDays,
  eta_max_days: i.etaMaxDays,
  pickup_location_id: i.pickupLocationId,
  is_active: i.isActive,
  sort_order: i.sortOrder,
});
export const toMethodInsert = (i: MethodCreateInput) => ({
  ...toMethodUpdate(i),
  code: i.code.trim(),
  kind: i.kind,
});

export const fromZoneRow = (r: Tables["shipping_zones"]["Row"]): ShippingZone => ({
  id: r.id,
  name: r.name,
  kind: r.kind === "radius" ? "radius" : "city",
  cities: r.cities,
  centerLat: r.center_lat,
  centerLng: r.center_lng,
  radiusKm: r.radius_km,
  allowed: r.allowed,
  isActive: r.is_active,
  archived: r.archived_at !== null,
  updatedAt: r.updated_at,
});
export const toZoneUpdate = (i: ZoneUpdateInput) => ({
  name: i.name.trim(),
  cities: i.cities,
  center_lat: i.centerLat,
  center_lng: i.centerLng,
  radius_km: i.radiusKm,
  allowed: i.allowed,
  is_active: i.isActive,
});
export const toZoneInsert = (i: ZoneCreateInput) => ({ ...toZoneUpdate(i), kind: i.kind });

export const fromRateRow = (r: Tables["shipping_rate_rules"]["Row"]): RateRule => ({
  id: r.id,
  methodId: r.method_id,
  zoneId: r.zone_id,
  name: r.name,
  kind: r.kind === "flat" ? "flat" : "distance",
  params: paramsFromJson(r.kind, r.params),
  minOrderAmount: r.min_order_amount,
  maxOrderAmount: r.max_order_amount,
  currency: r.currency,
  priority: r.priority,
  isActive: r.is_active,
  validFrom: r.valid_from,
  validUntil: r.valid_until,
  archived: r.archived_at !== null,
  updatedAt: r.updated_at,
});
export const toRateUpdate = (i: RateUpdateInput) => ({
  zone_id: i.zoneId,
  name: i.name.trim(),
  params: paramsToJson(i.params),
  min_order_amount: i.minOrderAmount,
  max_order_amount: i.maxOrderAmount,
  priority: i.priority,
  is_active: i.isActive,
  valid_from: i.validFrom,
  valid_until: i.validUntil,
});
export const toRateInsert = (i: RateCreateInput) => ({
  ...toRateUpdate(i),
  method_id: i.methodId,
  kind: i.params.kind,
  currency: i.currency,
});

export const fromSlotRow = (r: Tables["delivery_slots"]["Row"]): DeliverySlot => ({
  id: r.id,
  methodId: r.method_id,
  weekday: r.weekday,
  startTime: hhmm(r.start_time),
  endTime: hhmm(r.end_time),
  capacity: r.capacity,
  isActive: r.is_active,
  archived: r.archived_at !== null,
  updatedAt: r.updated_at,
});
export const toSlotUpdate = (i: SlotUpdateInput) => ({
  start_time: i.startTime,
  end_time: i.endTime,
  capacity: i.capacity,
  is_active: i.isActive,
});
export const toSlotInsert = (i: SlotCreateInput) => ({
  ...toSlotUpdate(i),
  method_id: i.methodId,
  weekday: i.weekday,
});

export const fromBlockedRow = (r: Tables["blocked_dates"]["Row"]): BlockedDate => ({
  id: r.id,
  blockedOn: r.blocked_on,
  reason: r.reason,
  archived: r.archived_at !== null,
  updatedAt: r.updated_at,
});
