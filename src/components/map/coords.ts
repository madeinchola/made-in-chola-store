/**
 * Coordenadas del selector de ubicación. Todo es código PURO (sin React ni Leaflet) para poder validarlo igual en el
 * formulario, en el selector y en las pruebas.
 *
 * El pin se maneja como DOS textos (`PinText`): así se conserva lo que la persona va escribiendo (`-16,`) aunque todavía
 * no sea un número, y la validación decide si hay pin, no hay pin o está a medias.
 */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Latitud y longitud tal como se escriben en los campos (vacíos = sin pin). */
export interface PinText {
  lat: string;
  lng: string;
}

export const EMPTY_PIN: PinText = { lat: "", lng: "" };

export const LAT_LIMIT = 90;
export const LNG_LIMIT = 180;
/** La base guarda `numeric(9,6)`: seis decimales (≈ 11 cm). */
export const COORD_DECIMALS = 6;

export type CoordinateProblem = "missing" | "format" | "range";

export type PinState =
  | { kind: "none" }
  | { kind: "pin"; lat: number; lng: number }
  | { kind: "invalid"; lat?: CoordinateProblem; lng?: CoordinateProblem };

const FACTOR = 10 ** COORD_DECIMALS;

/** Redondea a los 6 decimales que guarda la base (y evita `-0`). */
export function roundCoordinate(value: number): number {
  const rounded = Math.round(value * FACTOR) / FACTOR;
  return rounded === 0 ? 0 : rounded;
}

/** Texto canónico (punto decimal, sin ceros de sobra): `-16.5`, `-68.123457`. */
export function formatCoordinate(value: number): string {
  return String(roundCoordinate(value));
}

/** Acepta `-16.5` y `-16,5` (y el signo menos tipográfico `−`). Rechaza exponentes, miles, grados y cualquier texto. */
const DECIMAL = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/;

export type CoordinateResult =
  { ok: true; value: number } | { ok: false; problem: "format" | "range" };

export function parseCoordinate(text: string, limit: number): CoordinateResult {
  const normalized = text.trim().replace(/−/g, "-");
  if (!DECIMAL.test(normalized)) return { ok: false, problem: "format" };
  const value = roundCoordinate(Number(normalized.replace(",", ".")));
  if (!Number.isFinite(value)) return { ok: false, problem: "format" };
  if (Math.abs(value) > limit) return { ok: false, problem: "range" };
  return { ok: true, value };
}

/** Interpreta el par de textos: sin pin, pin válido o inválido (con el problema de cada campo). */
export function parsePin({ lat, lng }: PinText): PinState {
  const latText = lat.trim();
  const lngText = lng.trim();
  if (latText === "" && lngText === "") return { kind: "none" };
  const latResult = latText === "" ? null : parseCoordinate(latText, LAT_LIMIT);
  const lngResult = lngText === "" ? null : parseCoordinate(lngText, LNG_LIMIT);
  if (latResult?.ok && lngResult?.ok) {
    return { kind: "pin", lat: latResult.value, lng: lngResult.value };
  }
  const invalid: { kind: "invalid"; lat?: CoordinateProblem; lng?: CoordinateProblem } = {
    kind: "invalid",
  };
  if (latResult === null) invalid.lat = "missing";
  else if (!latResult.ok) invalid.lat = latResult.problem;
  if (lngResult === null) invalid.lng = "missing";
  else if (!lngResult.ok) invalid.lng = lngResult.problem;
  return invalid;
}

/** Del pin al texto de los campos (sin pin → vacíos). */
export function toPinText(pin: LatLng | null): PinText {
  return pin ? { lat: formatCoordinate(pin.lat), lng: formatCoordinate(pin.lng) } : EMPTY_PIN;
}

/**
 * Deja un punto del mapa dentro del planeta: Leaflet permite arrastrar más allá de ±180° (copias del mundo) y la base
 * rechaza esas longitudes. La latitud se acota y la longitud se «envuelve».
 */
export function normalizeLatLng({ lat, lng }: LatLng): LatLng {
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
  // +180 y -180 son el mismo meridiano: se conserva +180 si venía positivo.
  const lngValue = wrapped === -180 && lng > 0 ? 180 : wrapped;
  return {
    lat: roundCoordinate(Math.max(-LAT_LIMIT, Math.min(LAT_LIMIT, lat))),
    lng: roundCoordinate(lngValue),
  };
}
