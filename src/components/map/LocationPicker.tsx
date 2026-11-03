import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import { LocateFixed, MapPinOff, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import {
  EMPTY_PIN,
  formatCoordinate,
  normalizeLatLng,
  parsePin,
  toPinText,
  type LatLng,
  type PinText,
} from "./coords";
import { getDefaultGeocoder, GeocoderError, type GeocodeResult, type Geocoder } from "./geocoder";
// Solo TIPOS: no arrastran Leaflet al chunk principal (la importación real es la dinámica de `loadLeafletMap`).
import type { LeafletMapProps, MapFocus } from "./LeafletMap";
import { MapBoundary } from "./MapBoundary";
import { DEFAULT_CENTER, DEFAULT_ZOOM, PIN_ZOOM } from "./mapConfig";

/** Carga del mapa. Se puede sustituir (pruebas, o un mapa de otro proveedor con las mismas props). */
export type MapLoader = () => Promise<{ default: ComponentType<LeafletMapProps> }>;
const loadLeafletMap: MapLoader = () => import("./LeafletMap");

const MIN_QUERY_LENGTH = 3;
/** Por encima de esta precisión (metros) se avisa de que la ubicación del dispositivo es aproximada. */
export const IMPRECISE_METERS = 500;
const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 60_000,
};

export interface LocationPickerProps {
  /** Latitud y longitud como texto (vacíos = sin pin). Ver `parsePin`. */
  value: PinText;
  onChange: (next: PinText) => void;
  /** Errores de validación de cada campo (los pinta junto al campo). */
  errors?: { lat?: string | undefined; lng?: string | undefined } | undefined;
  /** País (ISO-2) para acotar la búsqueda. */
  country?: string | undefined;
  /** Servicio de búsqueda; por defecto Nominatim compartido (D-04: intercambiable). */
  geocoder?: Geocoder | undefined;
  /** Centro y zoom cuando todavía no hay pin (por defecto La Paz, 12). */
  center?: LatLng | undefined;
  zoom?: number | undefined;
  loadMap?: MapLoader | undefined;
}

type Feedback = { tone: "info" | "error"; text: string };
type SearchState =
  { status: "idle" } | { status: "searching" } | { status: "results"; results: GeocodeResult[] };

const pinKey = (pin: LatLng) => `${pin.lat},${pin.lng}`;

/**
 * Selector de ubicación: mapa (Leaflet + OpenStreetMap, cargado bajo demanda), búsqueda por texto, «usar mi ubicación»
 * y campos de latitud/longitud. El pin siempre es OPCIONAL y los campos numéricos son la alternativa completa al mapa
 * (teclado, lector de pantalla, sin conexión o sin teselas).
 *
 * Es «controlado» con los DOS textos de las coordenadas: así conserva lo que se escribe a medias y deja que el formulario
 * valide con `parsePin`. Los textos de la interfaz viven en `acct.addresses.picker.*`.
 */
export function LocationPicker({
  value,
  onChange,
  errors,
  country,
  geocoder,
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  loadMap = loadLeafletMap,
}: LocationPickerProps) {
  const ids = useId();
  const searchId = `${ids}-search`;
  const searchHintId = `${ids}-search-hint`;
  const locateHelpId = `${ids}-locate-help`;
  const instructionsId = `${ids}-instructions`;
  const coordsHintId = `${ids}-coords-hint`;

  const service = geocoder ?? getDefaultGeocoder();
  const pinState = useMemo(() => parsePin(value), [value]);
  const pin = pinState.kind === "pin" ? { lat: pinState.lat, lng: pinState.lng } : null;
  const hasText = value.lat.trim() !== "" || value.lng.trim() !== "";

  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [locating, setLocating] = useState(false);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [tilesFailing, setTilesFailing] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const nonceRef = useRef(0);
  // Último punto al que el mapa ya está mirando: evita recentrarlo si solo se pasa por un campo sin cambiar nada.
  const syncedRef = useRef(pin ? pinKey(pin) : "");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // `lazy` recuerda el resultado (también un fallo): para reintentar hace falta un componente perezoso NUEVO.
  const [MapView, setMapView] = useState(() => lazy(loadMap));

  /** Coloca el pin; con `recenter` además mueve el mapa hasta él. */
  const commitPin = useCallback(
    (position: LatLng, recenter: boolean, zoomLevel?: number) => {
      const next = normalizeLatLng(position);
      syncedRef.current = pinKey(next);
      onChange(toPinText(next));
      if (recenter) {
        nonceRef.current += 1;
        setFocus({ ...next, zoom: zoomLevel ?? PIN_ZOOM, nonce: nonceRef.current });
      }
      return next;
    },
    [onChange],
  );

  const handleMapPick = useCallback(
    (position: LatLng) => {
      const next = commitPin(position, false);
      setFeedback({
        tone: "info",
        text: t("acct.addresses.picker.pinSet", {
          lat: formatCoordinate(next.lat),
          lng: formatCoordinate(next.lng),
        }),
      });
    },
    [commitPin],
  );

  const runSearch = async () => {
    if (search.status === "searching") return;
    const text = query.trim();
    if (text.length < MIN_QUERY_LENGTH) {
      setFeedback({
        tone: "error",
        text: t("acct.addresses.picker.search.tooShort", { min: MIN_QUERY_LENGTH }),
      });
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSearch({ status: "searching" });
    setFeedback({ tone: "info", text: t("acct.addresses.picker.search.searching") });
    try {
      const results = await service.search(text, { country, signal: controller.signal });
      if (controller.signal.aborted || !mountedRef.current) return;
      if (results.length === 0) {
        setSearch({ status: "idle" });
        setFeedback({ tone: "info", text: t("acct.addresses.picker.search.none") });
      } else {
        setSearch({ status: "results", results });
        setFeedback({
          tone: "info",
          text:
            results.length === 1
              ? t("acct.addresses.picker.search.resultsOne")
              : t("acct.addresses.picker.search.resultsMany", { n: results.length }),
        });
      }
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      setSearch({ status: "idle" });
      const kind = error instanceof GeocoderError ? error.kind : "unavailable";
      const key =
        kind === "rate_limited" ? "rateLimited" : kind === "timeout" ? "timeout" : "unavailable";
      setFeedback({ tone: "error", text: t(`acct.addresses.picker.search.${key}` as const) });
    }
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    // Este selector vive dentro del formulario de la dirección: Intro busca, NO guarda la dirección.
    event.preventDefault();
    void runSearch();
  };

  const pickResult = (result: GeocodeResult) => {
    commitPin({ lat: result.lat, lng: result.lng }, true);
    setSearch({ status: "idle" });
    setFeedback({ tone: "info", text: t("acct.addresses.picker.search.picked") });
    searchInputRef.current?.focus();
  };

  const locate = () => {
    if (locating) return;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setFeedback({ tone: "error", text: t("acct.addresses.picker.locate.unsupported") });
      return;
    }
    setLocating(true);
    setFeedback({ tone: "info", text: t("acct.addresses.picker.locate.locating") });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!mountedRef.current) return;
        setLocating(false);
        const { latitude, longitude, accuracy } = position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          setFeedback({ tone: "error", text: t("acct.addresses.picker.locate.unavailable") });
          return;
        }
        commitPin({ lat: latitude, lng: longitude }, true);
        setFeedback({
          tone: "info",
          text:
            accuracy > IMPRECISE_METERS
              ? t("acct.addresses.picker.locate.imprecise", { meters: Math.round(accuracy) })
              : t("acct.addresses.picker.locate.done"),
        });
      },
      (failure) => {
        if (!mountedRef.current) return;
        setLocating(false);
        // GeolocationPositionError: 1 permiso denegado · 2 posición no disponible · 3 tiempo agotado
        const key = failure.code === 1 ? "denied" : failure.code === 3 ? "timeout" : "unavailable";
        setFeedback({ tone: "error", text: t(`acct.addresses.picker.locate.${key}` as const) });
      },
      GEOLOCATION_OPTIONS,
    );
  };

  const removePin = () => {
    if (!hasText) return;
    syncedRef.current = "";
    onChange(EMPTY_PIN);
    setFeedback({ tone: "info", text: t("acct.addresses.picker.pinRemoved") });
  };

  const onCoordinateBlur = () => {
    const state = parsePin(value);
    if (state.kind !== "pin") return;
    const key = pinKey(state);
    if (key === syncedRef.current) return;
    syncedRef.current = key;
    nonceRef.current += 1;
    setFocus({ lat: state.lat, lng: state.lng, zoom: PIN_ZOOM, nonce: nonceRef.current });
  };

  const searching = search.status === "searching";

  return (
    <section aria-labelledby={`${ids}-title`} className="space-y-4">
      <div className="space-y-1">
        <h3 id={`${ids}-title`} className="eyebrow">
          {t("acct.addresses.picker.title")}
        </h3>
        <p className="text-sm text-muted-foreground">{t("acct.addresses.picker.optional")}</p>
      </div>

      <div role="search" aria-label={t("acct.addresses.picker.search.label")} className="space-y-1">
        <label htmlFor={searchId} className="text-sm font-medium">
          {t("acct.addresses.picker.search.label")}
        </label>
        <div className="flex gap-2">
          <Input
            ref={searchInputRef}
            id={searchId}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            placeholder={t("acct.addresses.picker.search.placeholder")}
            aria-describedby={searchHintId}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (search.status === "results") setSearch({ status: "idle" });
            }}
            onKeyDown={onSearchKeyDown}
          />
          <Button
            type="button"
            variant="outline"
            loading={searching}
            onClick={() => void runSearch()}
          >
            <Search aria-hidden="true" className="h-4 w-4" />
            {searching
              ? t("acct.addresses.picker.search.searching")
              : t("acct.addresses.picker.search.button")}
          </Button>
        </div>
        <p id={searchHintId} className="text-xs text-muted-foreground">
          {t("acct.addresses.picker.search.hint")} {t("acct.addresses.picker.search.privacy")}
        </p>
        {search.status === "results" && (
          <ul
            aria-label={t("acct.addresses.picker.search.resultsLabel")}
            className="divide-y divide-border rounded-md border border-input bg-background"
          >
            {search.results.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  onClick={() => pickResult(result)}
                  className="block w-full break-words px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  {result.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={locating}
            aria-describedby={locateHelpId}
            onClick={locate}
          >
            <LocateFixed aria-hidden="true" className="h-4 w-4" />
            {t("acct.addresses.picker.locate.button")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-disabled={!hasText}
            onClick={removePin}
          >
            <MapPinOff aria-hidden="true" className="h-4 w-4" />
            {t("acct.addresses.picker.removePin")}
          </Button>
        </div>
        <p id={locateHelpId} className="text-xs text-muted-foreground">
          {t("acct.addresses.picker.locate.explain")}
        </p>
      </div>

      <div role="status" className="text-sm">
        {feedback?.tone === "info" && <p>{feedback.text}</p>}
      </div>
      {feedback?.tone === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {feedback.text}
        </p>
      )}

      <div className="space-y-2">
        <div className="group relative isolate h-64 overflow-hidden rounded-md border border-input bg-muted sm:h-72">
          <MapBoundary
            key={attempt}
            fallback={
              <div
                role="alert"
                className="flex h-full flex-col items-start justify-center gap-3 p-4"
              >
                <p className="text-sm">{t("acct.addresses.picker.map.loadFailed")}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMapView(() => lazy(loadMap));
                    setAttempt((n) => n + 1);
                  }}
                >
                  {t("acct.addresses.picker.map.retry")}
                </Button>
              </div>
            }
          >
            <Suspense
              fallback={
                <div
                  role="status"
                  className="grid h-full place-items-center text-sm text-muted-foreground"
                >
                  {t("acct.addresses.picker.map.loading")}
                </div>
              }
            >
              <MapView
                pin={pin}
                center={center}
                zoom={zoom}
                focus={focus}
                label={t("acct.addresses.picker.map.label")}
                describedBy={instructionsId}
                pinLabel={t("acct.addresses.picker.map.pinLabel")}
                onPick={handleMapPick}
                onTilesFailing={setTilesFailing}
              />
            </Suspense>
          </MapBoundary>
          {/* Mira para el teclado: Intro coloca el pin AQUÍ. Solo se ve con el mapa enfocado. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[650] grid place-items-center opacity-0 transition-opacity duration-fast group-focus-within:opacity-100"
          >
            <span className="relative block h-6 w-6">
              <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-foreground" />
              <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-foreground" />
            </span>
          </div>
        </div>
        <p id={instructionsId} className="text-xs text-muted-foreground">
          {t("acct.addresses.picker.map.instructions")}
        </p>
        {tilesFailing && (
          <p role="status" className="text-xs text-warning">
            {t("acct.addresses.picker.map.tilesFailing")}
          </p>
        )}
      </div>

      <fieldset aria-describedby={coordsHintId} className="space-y-2">
        <legend className="text-sm font-medium">{t("acct.addresses.picker.coords.legend")}</legend>
        <p id={coordsHintId} className="text-xs text-muted-foreground">
          {t("acct.addresses.picker.coords.hint")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("acct.addresses.picker.coords.lat")} error={errors?.lat}>
            <Input
              value={value.lat}
              onChange={(event) => onChange({ lat: event.target.value, lng: value.lng })}
              onBlur={onCoordinateBlur}
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              placeholder={t("acct.addresses.picker.coords.latPlaceholder")}
            />
          </Field>
          <Field label={t("acct.addresses.picker.coords.lng")} error={errors?.lng}>
            <Input
              value={value.lng}
              onChange={(event) => onChange({ lat: value.lat, lng: event.target.value })}
              onBlur={onCoordinateBlur}
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              placeholder={t("acct.addresses.picker.coords.lngPlaceholder")}
            />
          </Field>
        </div>
      </fieldset>
    </section>
  );
}
