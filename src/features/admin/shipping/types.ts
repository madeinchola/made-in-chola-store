/** Modelo del panel de Envíos (S8), en camelCase. Toda fila lleva `updatedAt` (la versión para no pisar ediciones ajenas). */

export interface StoreLocation {
  id: string;
  name: string;
  addressText: string;
  city: string;
  lat: number;
  lng: number;
  /** Texto libre: «Lun–Vie 10:00–18:00». */
  pickupHours: string | null;
  /** El origen del cálculo de distancia: solo UNA y se cambia con `setPrimaryLocation`. */
  isPrimary: boolean;
  isActive: boolean;
  archived: boolean;
  updatedAt: string;
}
export interface LocationInput {
  name: string;
  addressText: string;
  city: string;
  lat: number;
  lng: number;
  pickupHours: string | null;
  isActive: boolean;
}

export type MethodKind = "delivery" | "pickup";
export interface ShippingMethod {
  id: string;
  code: string;
  name: string;
  kind: MethodKind;
  description: string | null;
  etaMinDays: number | null;
  etaMaxDays: number | null;
  /** Solo en el recojo. */
  pickupLocationId: string | null;
  isActive: boolean;
  sortOrder: number;
  archived: boolean;
  updatedAt: string;
}
export interface MethodCreateInput {
  code: string;
  name: string;
  kind: MethodKind;
  description: string | null;
  etaMinDays: number | null;
  etaMaxDays: number | null;
  pickupLocationId: string | null;
  isActive: boolean;
  sortOrder: number;
}
/** El código y el tipo no se cambian después de crear el método. */
export type MethodUpdateInput = Omit<MethodCreateInput, "code" | "kind">;

export type ZoneKind = "city" | "radius";
export interface ShippingZone {
  id: string;
  name: string;
  kind: ZoneKind;
  /** Solo `city`. */
  cities: string[] | null;
  /** Solo `radius`. */
  centerLat: number | null;
  centerLng: number | null;
  radiusKm: number | null;
  /** `false` = zona SIN servicio: bloquea aunque otra zona permitida la cubra. */
  allowed: boolean;
  isActive: boolean;
  archived: boolean;
  updatedAt: string;
}
export interface ZoneCreateInput {
  name: string;
  kind: ZoneKind;
  cities: string[] | null;
  centerLat: number | null;
  centerLng: number | null;
  radiusKm: number | null;
  allowed: boolean;
  isActive: boolean;
}
/** El tipo de zona no se cambia después de crearla. */
export type ZoneUpdateInput = Omit<ZoneCreateInput, "kind">;

export type RateKind = "distance" | "flat";
export interface RateTier {
  /** Hasta cuántos km (INCLUSIVE) cubre este tramo. */
  upToKm: number;
  cost: number;
}
export type RateParams =
  | { kind: "flat"; cost: number }
  | {
      kind: "distance";
      tiers: RateTier[];
      /** Costo por km pasado el último tramo; null o 0 = no cubre más distancia. */
      extraPerKm: number | null;
      minCost: number | null;
      maxCost: number | null;
    };
export interface RateRule {
  id: string;
  methodId: string;
  zoneId: string | null;
  name: string;
  kind: RateKind;
  /** null si el JSON guardado no tiene la forma de su tipo (no debería pasar: la base lo valida). */
  params: RateParams | null;
  minOrderAmount: number | null;
  maxOrderAmount: number | null;
  currency: string;
  priority: number;
  isActive: boolean;
  validFrom: string | null;
  validUntil: string | null;
  archived: boolean;
  updatedAt: string;
}
export interface RateCreateInput {
  methodId: string;
  zoneId: string | null;
  name: string;
  params: RateParams;
  minOrderAmount: number | null;
  maxOrderAmount: number | null;
  currency: string;
  priority: number;
  isActive: boolean;
  validFrom: string | null;
  validUntil: string | null;
}
/** El método, el tipo y la moneda de una regla no se cambian después de crearla. */
export type RateUpdateInput = Omit<RateCreateInput, "methodId" | "currency">;

export interface DeliverySlot {
  id: string;
  methodId: string;
  /** ISO: 1 = lunes … 7 = domingo. */
  weekday: number;
  /** HH:MM */
  startTime: string;
  endTime: string;
  capacity: number;
  isActive: boolean;
  archived: boolean;
  updatedAt: string;
}
export interface SlotCreateInput {
  methodId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  capacity: number;
  isActive: boolean;
}
export type SlotUpdateInput = Omit<SlotCreateInput, "methodId" | "weekday">;

export interface BlockedDate {
  id: string;
  /** AAAA-MM-DD */
  blockedOn: string;
  reason: string | null;
  archived: boolean;
  updatedAt: string;
}
