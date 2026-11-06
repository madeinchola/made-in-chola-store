import type { Address } from "@/features/account/addresses/types";
import { parsePin, type CoordinateProblem, type PinText } from "@/components/map/coords";

/**
 * A dónde se calcula el envío. Es lo que la clienta eligió en ESTA visita (se recuerda en memoria, no se guarda en ningún
 * lado). `addressId` solo está si salió de su libreta; `label` es el nombre de esa dirección.
 */
export interface Destination {
  lat: number;
  lng: number;
  city: string;
  label: string | null;
  addressId: string | null;
}

/** Fecha y franja que la clienta quiere probar (la franja de un día concreto: el mismo `slotId` se repite cada semana). */
export interface ScheduleChoice {
  /** AAAA-MM-DD. */
  date: string;
  slotId: string;
}

export const sameSchedule = (a: ScheduleChoice | null, b: ScheduleChoice | null): boolean =>
  a === b || (a !== null && b !== null && a.date === b.date && a.slotId === b.slotId);

export const sameDestination = (a: Destination | null, b: Destination | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.lat === b.lat &&
    a.lng === b.lng &&
    a.city === b.city &&
    a.label === b.label &&
    a.addressId === b.addressId);

/** Las direcciones de la libreta que sirven para recibir pedidos (una solo de facturación no es un destino). */
export const shippingAddresses = (addresses: readonly Address[]): Address[] =>
  addresses.filter((address) => address.forShipping);

/** ¿Tiene el pin puesto? El pin es todo o nada en la base, pero aquí se comprueban los dos por si acaso. */
export const addressHasPin = (address: Pick<Address, "lat" | "lng">): boolean =>
  address.lat !== null && address.lng !== null;

/** El destino de una dirección guardada, o `null` si no tiene pin (hay que ubicarla en el mapa antes de cotizar). */
export function destinationFromAddress(address: Address): Destination | null {
  if (address.lat === null || address.lng === null) return null;
  return {
    lat: address.lat,
    lng: address.lng,
    city: address.city.trim(),
    label: address.label,
    addressId: address.id,
  };
}

/**
 * Pone al día el destino recordado con la libreta recién leída: si era una dirección guardada y ya no existe (la archivó
 * en otra pestaña), se descarta; si cambió su ubicación o su ciudad, se toma la nueva. Una dirección SIN pin conserva el
 * punto que la clienta marcó en el mapa (no hay otro). Un destino marcado a mano (`addressId` null) no se toca.
 * Devuelve el MISMO objeto cuando no hay nada que cambiar (para no provocar repintados en bucle).
 */
export function reconcileDestination(
  current: Destination | null,
  addresses: readonly Address[],
): Destination | null {
  if (current === null || current.addressId === null) return current;
  const address = addresses.find((a) => a.id === current.addressId && a.forShipping);
  if (!address) return null;
  const fresh = destinationFromAddress(address);
  if (fresh === null) {
    // Sin pin en la libreta: se conserva el marcado a mano, pero con el nombre y la ciudad actuales.
    const next: Destination = { ...current, city: address.city.trim(), label: address.label };
    return sameDestination(current, next) ? current : next;
  }
  return sameDestination(current, fresh) ? current : fresh;
}

/** Lo que escribe la clienta en el formulario del mapa: el pin (dos textos) y la ciudad. */
export interface PinFormValues {
  pin: PinText;
  city: string;
}

export type PinFormCheck =
  | { ok: true; lat: number; lng: number; city: string }
  | {
      ok: false;
      /** `none`: ni latitud ni longitud · `invalid`: hay algo escrito pero está mal o a medias. */
      pin: "none" | "invalid" | null;
      lat: CoordinateProblem | null;
      lng: CoordinateProblem | null;
      city: boolean;
    };

/** Valida el formulario del mapa: hace falta un pin completo y la ciudad (las zonas de entrega pueden ser por ciudad). */
export function checkPinForm({ pin, city }: PinFormValues): PinFormCheck {
  const parsed = parsePin(pin);
  const cityText = city.trim();
  if (parsed.kind === "pin" && cityText !== "") {
    return { ok: true, lat: parsed.lat, lng: parsed.lng, city: cityText };
  }
  return {
    ok: false,
    pin: parsed.kind === "pin" ? null : parsed.kind === "none" ? "none" : "invalid",
    lat: parsed.kind === "invalid" ? (parsed.lat ?? null) : null,
    lng: parsed.kind === "invalid" ? (parsed.lng ?? null) : null,
    city: cityText === "",
  };
}
