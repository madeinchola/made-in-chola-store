import {
  EMPTY_PIN,
  formatCoordinate,
  parsePin,
  toPinText,
  type CoordinateProblem,
  type PinText,
} from "@/components/map/coords";
import { t } from "@/i18n";
import { btrimSpaces, charLength } from "../config/pgText";
import { parseNumber } from "./tierLogic";
import type { RateRule, ShippingZone, ZoneCreateInput, ZoneKind, ZoneUpdateInput } from "./types";

/** Límites de la base (`shipping_zones`): nombre 1–80, de 1 a 200 ciudades, radio > 0 y ≤ 20000 con 2 decimales. */
export const MAX_ZONE_NAME = 80;
export const MAX_CITIES = 200;
/** La base no limita el largo de cada ciudad; este tope solo evita pegar un texto cualquiera por error. */
export const MAX_CITY_LENGTH = 80;
export const MAX_RADIUS_KM = 20000;
export const RADIUS_DECIMALS = 2;

/**
 * La ciudad como la compara el servidor (`_ship_norm`): sin tildes, en minúsculas y con los espacios normalizados. Dos
 * ciudades con el mismo texto normalizado son la MISMA ciudad.
 */
export function normalizeCity(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** El texto de una ciudad tal como se guarda: el que escribió la persona, con los espacios normalizados. */
const cleanCity = (text: string): string => text.replace(/\s+/g, " ").trim();

export interface AddCitiesResult {
  /** La lista completa tras añadir (las que ya estaban, en su orden, y luego las nuevas). */
  cities: string[];
  added: string[];
  /** Ya estaban en la lista (o repetidas dentro de lo pegado), ignorando tildes y mayúsculas. */
  duplicates: string[];
  tooLong: string[];
  /** No cupieron: la zona admite hasta `MAX_CITIES`. */
  overLimit: string[];
}

/**
 * Añade ciudades a la lista. El texto puede traer varias separadas por comas, punto y coma o saltos de línea. Se ignoran
 * las vacías y las repetidas (sin tildes ni mayúsculas), y no se pasa de 200.
 */
export function addCities(current: readonly string[], input: string): AddCitiesResult {
  const seen = new Set(current.map(normalizeCity));
  const result: AddCitiesResult = {
    cities: [...current],
    added: [],
    duplicates: [],
    tooLong: [],
    overLimit: [],
  };
  for (const piece of input.split(/[,;\n\r]+/)) {
    const city = cleanCity(piece);
    if (city === "") continue;
    const key = normalizeCity(city);
    if (seen.has(key)) {
      result.duplicates.push(city);
    } else if (charLength(city) > MAX_CITY_LENGTH) {
      result.tooLong.push(city);
    } else if (result.cities.length >= MAX_CITIES) {
      result.overLimit.push(city);
    } else {
      seen.add(key);
      result.cities.push(city);
      result.added.push(city);
    }
  }
  return result;
}

/** Quita la ciudad de la posición `index` (sin tocar el resto). */
export const removeCity = (cities: readonly string[], index: number): string[] =>
  cities.filter((_, i) => i !== index);

export type RadiusProblem = "required" | "number" | "not_positive" | "too_big" | "decimals";
export type RadiusResult = { ok: true; value: number } | { ok: false; problem: RadiusProblem };

/** Radio en km como lo escribe una persona («5», «7,5»): mayor que 0, hasta 20000 y con 2 decimales como máximo. */
export function parseRadius(text: string): RadiusResult {
  if (text.trim() === "") return { ok: false, problem: "required" };
  const n = parseNumber(text);
  if (n === null) return { ok: false, problem: "number" };
  if (n <= 0) return { ok: false, problem: "not_positive" };
  if (n > MAX_RADIUS_KM) return { ok: false, problem: "too_big" };
  // La base guarda `numeric(8,2)`: lo que se escribe es lo que se guarda, así que no se redondea en silencio.
  if (Math.round(n * 10 ** RADIUS_DECIMALS) / 10 ** RADIUS_DECIMALS !== n) {
    return { ok: false, problem: "decimals" };
  }
  return { ok: true, value: n };
}

/** Kilómetros con coma decimal (es): 2,5 → «2,5». */
export const formatKm = (km: number): string => String(km).replace(".", ",");

type ZoneSummarySource = Pick<
  ShippingZone,
  "kind" | "cities" | "radiusKm" | "centerLat" | "centerLng"
>;

/** Cobertura en una línea: las ciudades (hasta `maxCities`, con «y N más») o «Radio de 5 km (centro: …)». */
export function zoneSummary(zone: ZoneSummarySource, maxCities = 5): string {
  if (zone.kind === "city") {
    const cities = zone.cities ?? [];
    if (cities.length === 0) return t("admin.shipping.rates.zones.summary.noCities");
    const items = cities.slice(0, maxCities);
    if (cities.length > maxCities) {
      items.push(
        t("admin.shipping.rates.zones.summary.more", { count: cities.length - maxCities }),
      );
    }
    return new Intl.ListFormat("es", { style: "long", type: "conjunction" }).format(items);
  }
  if (zone.radiusKm === null || zone.centerLat === null || zone.centerLng === null) {
    return t("admin.shipping.rates.zones.summary.noRadius");
  }
  return t("admin.shipping.rates.zones.summary.radius", {
    km: formatKm(zone.radiusKm),
    lat: formatCoordinate(zone.centerLat),
    lng: formatCoordinate(zone.centerLng),
  });
}

export type ZoneStatus = "active" | "inactive" | "archived";
export const zoneStatus = (z: Pick<ShippingZone, "archived" | "isActive">): ZoneStatus =>
  z.archived ? "archived" : z.isActive ? "active" : "inactive";

/** ¿Esta zona da servicio ahora? (permitida, activa y no archivada: las únicas que el servidor tiene en cuenta). */
export const zoneGivesService = (z: Pick<ShippingZone, "allowed" | "isActive" | "archived">) =>
  z.allowed && z.isActive && !z.archived;

/** Sin ninguna zona con servicio activa la cotización falla con «cobertura sin configurar». */
export const hasCoverage = (zones: readonly ShippingZone[]): boolean =>
  zones.some(zoneGivesService);

/** Las zonas vigentes primero y las archivadas al final, cada grupo en el orden recibido. */
export const sortZones = (zones: readonly ShippingZone[]): ShippingZone[] => [
  ...zones.filter((z) => !z.archived),
  ...zones.filter((z) => z.archived),
];

export interface ZoneArchiveImpact {
  /** Tarifas activas (no archivadas) limitadas a esta zona: dejarían de aplicarse. */
  rules: number;
  /** Es la única zona con servicio activa: sin ella no hay cobertura. */
  lastCoverage: boolean;
}

export function zoneArchiveImpact(
  zone: ShippingZone,
  zones: readonly ShippingZone[],
  rates: readonly RateRule[],
): ZoneArchiveImpact {
  return {
    rules: rates.filter((r) => r.zoneId === zone.id && r.isActive && !r.archived).length,
    lastCoverage:
      zoneGivesService(zone) && !zones.some((z) => z.id !== zone.id && zoneGivesService(z)),
  };
}

// ── Formulario ─────────────────────────────────────────────────────────────────────────────
export interface ZoneFormValues {
  name: string;
  kind: ZoneKind;
  cities: string[];
  /** Latitud y longitud tal como se escriben (el selector de ubicación trabaja con textos). */
  center: PinText;
  radius: string;
  /** Casilla «Zona sin servicio»: `true` guarda `allowed = false`. */
  noService: boolean;
  isActive: boolean;
}

export function initialZoneValues(zone: ShippingZone | null): ZoneFormValues {
  const radiusKm = zone?.radiusKm ?? null;
  return {
    name: zone?.name ?? "",
    kind: zone?.kind ?? "city",
    cities: zone?.cities ? [...zone.cities] : [],
    center:
      zone && zone.centerLat !== null && zone.centerLng !== null
        ? toPinText({ lat: zone.centerLat, lng: zone.centerLng })
        : EMPTY_PIN,
    radius: radiusKm === null ? "" : String(radiusKm),
    noService: zone ? !zone.allowed : false,
    isActive: zone?.isActive ?? true,
  };
}

export interface ZoneErrors {
  name?: "required" | "too_long";
  cities?: "none" | "too_many";
  /** Ni latitud ni longitud: no hay centro. */
  center?: "required";
  lat?: CoordinateProblem;
  lng?: CoordinateProblem;
  radius?: RadiusProblem;
}
export type ZoneValidation =
  { ok: true; payload: ZoneCreateInput } | { ok: false; errors: ZoneErrors };

/** Valida el formulario y, si todo está bien, arma lo que se envía (la forma exacta de `ZoneCreateInput`). */
export function validateZone(values: ZoneFormValues): ZoneValidation {
  const errors: ZoneErrors = {};
  const name = btrimSpaces(values.name);
  if (name === "") errors.name = "required";
  else if (charLength(name) > MAX_ZONE_NAME) errors.name = "too_long";

  if (values.kind === "city") {
    if (values.cities.length === 0) errors.cities = "none";
    else if (values.cities.length > MAX_CITIES) errors.cities = "too_many";
    if (Object.keys(errors).length > 0) return { ok: false, errors };
    return {
      ok: true,
      payload: {
        name,
        kind: "city",
        cities: values.cities,
        centerLat: null,
        centerLng: null,
        radiusKm: null,
        allowed: !values.noService,
        isActive: values.isActive,
      },
    };
  }

  const pin = parsePin(values.center);
  if (pin.kind === "none") errors.center = "required";
  else if (pin.kind === "invalid") {
    if (pin.lat) errors.lat = pin.lat;
    if (pin.lng) errors.lng = pin.lng;
  }
  const radius = parseRadius(values.radius);
  if (!radius.ok) errors.radius = radius.problem;
  if (pin.kind !== "pin" || !radius.ok || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    payload: {
      name,
      kind: "radius",
      cities: null,
      centerLat: pin.lat,
      centerLng: pin.lng,
      radiusKm: radius.value,
      allowed: !values.noService,
      isActive: values.isActive,
    },
  };
}

/** Al editar no viaja el tipo: no se cambia después de crear la zona. */
export function toZoneUpdateInput(payload: ZoneCreateInput): ZoneUpdateInput {
  const { kind: _kind, ...update } = payload;
  return update;
}
