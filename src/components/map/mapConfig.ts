import type { LatLng } from "./coords";

/** Teselas de OpenStreetMap (decisión S-08: sin costo por consulta). Un único host, sin subdominios `{s}`. */
export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_MAX_ZOOM = 19;
/** La atribución es obligatoria por la licencia de OSM y debe verse siempre (la pinta el propio control de Leaflet). */
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

/** Centro por defecto (La Paz) cuando todavía no hay pin. */
export const DEFAULT_CENTER: LatLng = { lat: -16.5, lng: -68.15 };
export const DEFAULT_ZOOM = 12;
/** Zoom al enfocar un punto concreto (resultado de búsqueda, ubicación del dispositivo, pin existente). */
export const PIN_ZOOM = 16;
