import { z } from "zod";
import { LAT_LIMIT, LNG_LIMIT, roundCoordinate } from "./coords";

/**
 * Búsqueda de lugares por texto. La interfaz `Geocoder` es lo ÚNICO que conoce la interfaz de usuario (decisión D-04):
 * cambiar a Google o Mapbox es escribir otra implementación y pasarla al selector, sin tocar pantallas.
 */
export interface GeocodeResult {
  /** Identificador estable dentro de la respuesta (clave de lista). */
  id: string;
  /** Nombre completo del lugar. Es TEXTO plano: nunca se pinta como HTML. */
  label: string;
  lat: number;
  lng: number;
}

export interface GeocodeOptions {
  /** País (ISO 3166-1 alfa-2) para acotar los resultados. */
  country?: string | undefined;
  signal?: AbortSignal | undefined;
}

export interface Geocoder {
  /** Resultados por relevancia (vacío si no hay coincidencias). Lanza `GeocoderError` si falla. */
  search(query: string, options?: GeocodeOptions): Promise<GeocodeResult[]>;
}

export type GeocoderErrorKind =
  /** El servicio pidió frenar (HTTP 429) o nos bloqueó (403). */
  | "rate_limited"
  /** Sin red, error del servidor (5xx) u otro rechazo. */
  | "unavailable"
  | "timeout"
  | "aborted"
  /** Respondió, pero no con la forma esperada. */
  | "invalid_response";

export class GeocoderError extends Error {
  readonly kind: GeocoderErrorKind;
  constructor(kind: GeocoderErrorKind, options?: { cause?: unknown }) {
    // Sin el texto buscado: puede ser una dirección personal.
    super(`Geocodificador: ${kind}`, { cause: options?.cause });
    this.name = "GeocoderError";
    this.kind = kind;
  }
}

/** Política de uso de Nominatim: como máximo 1 petición por segundo (se deja un margen). */
export const NOMINATIM_MIN_INTERVAL_MS = 1100;
export const NOMINATIM_TIMEOUT_MS = 8000;
export const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const MAX_QUERY_LENGTH = 200;
const MAX_LABEL_LENGTH = 300;

const nominatimItem = z.object({
  place_id: z.union([z.number(), z.string()]),
  lat: z.string(),
  lon: z.string(),
  display_name: z.string(),
});
const nominatimResponse = z.array(nominatimItem);

export interface NominatimOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  /** Separación mínima entre el INICIO de dos peticiones. */
  minIntervalMs?: number;
  timeoutMs?: number;
  /** Reloj (para las pruebas). */
  now?: () => number;
  limit?: number;
}

const COUNTRY_CODE = /^[A-Za-z]{2}$/;

/** Espera `ms` o se interrumpe con `signal` (rechaza con `aborted`). */
function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GeocoderError("aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new GeocoderError("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Geocodificador sobre Nominatim (OpenStreetMap). Cumple su política de uso:
 *  - nada de autocompletado: la interfaz solo llama al ENVIAR la búsqueda;
 *  - como máximo una petición por segundo: las llamadas se espacian ≥ `minIntervalMs` (por instancia; el selector usa
 *    una instancia compartida, así que dos selectores en la página también se turnan);
 *  - se cancela con `AbortSignal` y vence a los `timeoutMs`;
 *  - la respuesta se valida con zod (no se confía en la forma del JSON).
 * El navegador envía `Referer` por sí solo (política `strict-origin-when-cross-origin`): Nominatim lo usa para identificar la
 * aplicación, ya que un navegador no puede fijar `User-Agent`.
 */
export function createNominatimGeocoder(options: NominatimOptions = {}): Geocoder {
  const baseUrl = options.baseUrl ?? NOMINATIM_BASE_URL;
  const minInterval = options.minIntervalMs ?? NOMINATIM_MIN_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? NOMINATIM_TIMEOUT_MS;
  const now = options.now ?? (() => Date.now());
  const limit = options.limit ?? 5;
  // Instante a partir del cual puede empezar la siguiente petición.
  let nextFree = -Infinity;

  /** Reserva el siguiente turno. `release` lo devuelve si la petición se cancela antes de salir. */
  function reserve() {
    const current = now();
    const start = Math.max(current, nextFree);
    const previous = nextFree;
    nextFree = start + minInterval;
    const claimed = nextFree;
    return {
      delay: start - current,
      release: () => {
        if (nextFree === claimed) nextFree = previous;
      },
    };
  }

  return {
    async search(query, { country, signal } = {}) {
      const text = query.trim().slice(0, MAX_QUERY_LENGTH);
      if (text === "") return [];
      if (signal?.aborted) throw new GeocoderError("aborted");

      const turn = reserve();
      if (turn.delay > 0) {
        try {
          await wait(turn.delay, signal);
        } catch (error) {
          turn.release();
          throw error;
        }
      }
      if (signal?.aborted) {
        turn.release();
        throw new GeocoderError("aborted");
      }

      const params = new URLSearchParams({
        format: "jsonv2",
        limit: String(limit),
        "accept-language": "es",
      });
      if (country && COUNTRY_CODE.test(country)) params.set("countrycodes", country.toLowerCase());
      params.set("q", text);
      const url = `${baseUrl}/search?${params.toString()}`;

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        let response: Response;
        try {
          response = await (options.fetchFn ?? fetch)(url, {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          });
        } catch (error) {
          if (timedOut) throw new GeocoderError("timeout", { cause: error });
          if (signal?.aborted) throw new GeocoderError("aborted", { cause: error });
          throw new GeocoderError("unavailable", { cause: error });
        }
        if (response.status === 429 || response.status === 403) {
          throw new GeocoderError("rate_limited");
        }
        if (!response.ok) throw new GeocoderError("unavailable");

        let body: unknown;
        try {
          body = await response.json();
        } catch (error) {
          if (timedOut) throw new GeocoderError("timeout", { cause: error });
          if (signal?.aborted) throw new GeocoderError("aborted", { cause: error });
          throw new GeocoderError("invalid_response", { cause: error });
        }
        const parsed = nominatimResponse.safeParse(body);
        if (!parsed.success) throw new GeocoderError("invalid_response");

        const results: GeocodeResult[] = [];
        for (const item of parsed.data) {
          const lat = Number(item.lat);
          const lng = Number(item.lon);
          // Un punto fuera del planeta (o ilegible) se descarta en vez de romper toda la lista.
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          if (Math.abs(lat) > LAT_LIMIT || Math.abs(lng) > LNG_LIMIT) continue;
          results.push({
            id: String(item.place_id),
            label: item.display_name.trim().slice(0, MAX_LABEL_LENGTH),
            lat: roundCoordinate(lat),
            lng: roundCoordinate(lng),
          });
        }
        return results;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

let shared: Geocoder | undefined;

/** Instancia única de Nominatim: todos los selectores de la página comparten el mismo turno de 1 petición/s. */
export function getDefaultGeocoder(): Geocoder {
  shared ??= createNominatimGeocoder();
  return shared;
}
