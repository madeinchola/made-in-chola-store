import { t } from "@/i18n";
import { formatCoordinate, parsePin, type CoordinateProblem } from "@/components/map/coords";
import { charLength } from "../config/pgText";
import type { LocationInput, ShippingMethod, StoreLocation } from "./types";

/** Límites de `store_locations` (las mismas restricciones `char_length(btrim(...))` de la migración). */
export const MAX_LOCATION_NAME = 80;
export const MAX_LOCATION_ADDRESS = 200;
export const MAX_LOCATION_CITY = 80;
export const MAX_LOCATION_HOURS = 300;

/** El formulario trabaja con textos (las coordenadas se conservan tal como se escriben, aunque estén a medias). */
export interface LocationFormValues {
  name: string;
  addressText: string;
  city: string;
  pickupHours: string;
  lat: string;
  lng: string;
  isActive: boolean;
}

export type LocationErrors = Partial<
  Record<"name" | "addressText" | "city" | "pickupHours" | "lat" | "lng", string>
>;

export type LocationValidation =
  { ok: true; input: LocationInput } | { ok: false; errors: LocationErrors };

export const emptyLocationValues = (): LocationFormValues => ({
  name: "",
  addressText: "",
  city: "",
  pickupHours: "",
  lat: "",
  lng: "",
  isActive: true,
});

export const locationToValues = (location: StoreLocation | null): LocationFormValues =>
  location
    ? {
        name: location.name,
        addressText: location.addressText,
        city: location.city,
        pickupHours: location.pickupHours ?? "",
        lat: formatCoordinate(location.lat),
        lng: formatCoordinate(location.lng),
        isActive: location.isActive,
      }
    : emptyLocationValues();

const LAT_MESSAGE = {
  missing: "admin.shipping.store.locations.errors.latMissing",
  format: "admin.shipping.store.locations.errors.latFormat",
  range: "admin.shipping.store.locations.errors.latRange",
} as const satisfies Record<CoordinateProblem, string>;
const LNG_MESSAGE = {
  missing: "admin.shipping.store.locations.errors.lngMissing",
  format: "admin.shipping.store.locations.errors.lngFormat",
  range: "admin.shipping.store.locations.errors.lngRange",
} as const satisfies Record<CoordinateProblem, string>;

/**
 * Valida el formulario con las restricciones de `store_locations`: nombre 1–80, dirección 1–200, ciudad 1–80, horario
 * opcional de hasta 300 y el pin (latitud y longitud) OBLIGATORIO. Devuelve el `LocationInput` ya recortado, o los errores
 * de cada campo.
 */
export function validateLocation(values: LocationFormValues): LocationValidation {
  const errors: LocationErrors = {};

  const name = values.name.trim();
  if (name === "") errors.name = t("admin.shipping.store.locations.errors.nameRequired");
  else if (charLength(name) > MAX_LOCATION_NAME)
    errors.name = t("admin.shipping.store.locations.errors.nameTooLong", {
      max: MAX_LOCATION_NAME,
    });

  const addressText = values.addressText.trim();
  if (addressText === "")
    errors.addressText = t("admin.shipping.store.locations.errors.addressRequired");
  else if (charLength(addressText) > MAX_LOCATION_ADDRESS)
    errors.addressText = t("admin.shipping.store.locations.errors.addressTooLong", {
      max: MAX_LOCATION_ADDRESS,
    });

  const city = values.city.trim();
  if (city === "") errors.city = t("admin.shipping.store.locations.errors.cityRequired");
  else if (charLength(city) > MAX_LOCATION_CITY)
    errors.city = t("admin.shipping.store.locations.errors.cityTooLong", {
      max: MAX_LOCATION_CITY,
    });

  const hours = values.pickupHours.trim();
  if (charLength(hours) > MAX_LOCATION_HOURS)
    errors.pickupHours = t("admin.shipping.store.locations.errors.hoursTooLong", {
      max: MAX_LOCATION_HOURS,
    });

  const pin = parsePin({ lat: values.lat, lng: values.lng });
  let lat = 0;
  let lng = 0;
  if (pin.kind === "pin") {
    lat = pin.lat;
    lng = pin.lng;
  } else if (pin.kind === "none") {
    errors.lat = t(LAT_MESSAGE.missing);
    errors.lng = t(LNG_MESSAGE.missing);
  } else {
    if (pin.lat) errors.lat = t(LAT_MESSAGE[pin.lat]);
    if (pin.lng) errors.lng = t(LNG_MESSAGE[pin.lng]);
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      name,
      addressText,
      city,
      lat,
      lng,
      pickupHours: hours === "" ? null : hours,
      isActive: values.isActive,
    },
  };
}

export type LocationStatus = "active" | "inactive" | "archived";

/** Archivada gana sobre inactiva. */
export const locationStatus = (l: Pick<StoreLocation, "archived" | "isActive">): LocationStatus =>
  l.archived ? "archived" : l.isActive ? "active" : "inactive";

/**
 * ¿Hay un origen que sirva para cotizar? Es el que usa `quote_shipping`: principal, activo y no archivado. La base garantiza
 * que una principal esté activa y sin archivar, pero aquí no se confía en eso: si no lo cumpliera, no cotizaría.
 */
export const hasUsableOrigin = (locations: readonly StoreLocation[]): boolean =>
  locations.some((l) => l.isPrimary && l.isActive && !l.archived);

/** Solo una ubicación activa, no archivada y que todavía no es el origen puede pasar a serlo (lo exige la base). */
export const canBecomeOrigin = (l: StoreLocation): boolean =>
  l.isActive && !l.archived && !l.isPrimary;

/** ¿Hay alguna ubicación que podría ser el origen? (decide qué dice el aviso de «sin origen»). */
export const hasOriginCandidate = (locations: readonly StoreLocation[]): boolean =>
  locations.some(canBecomeOrigin);

/** El origen actual (si lo hay) tal como lo reconoce la base. */
export const currentOrigin = (locations: readonly StoreLocation[]): StoreLocation | null =>
  locations.find((l) => l.isPrimary) ?? null;

/**
 * Métodos de recojo (sin archivar) que apuntan a esta ubicación: si se archiva o desactiva, dejan de poder cotizarse
 * (`quote_shipping` pide una ubicación activa y sin archivar).
 */
export const pickupMethodsUsing = (
  locationId: string,
  methods: readonly ShippingMethod[],
): ShippingMethod[] =>
  methods.filter((m) => !m.archived && m.kind === "pickup" && m.pickupLocationId === locationId);

/** Las archivadas al final, sin alterar el orden relativo del resto (el orden de la base se respeta). */
export const archivedLast = <T extends { archived: boolean }>(rows: readonly T[]): T[] => [
  ...rows.filter((r) => !r.archived),
  ...rows.filter((r) => r.archived),
];
