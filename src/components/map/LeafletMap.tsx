import { useEffect, useRef } from "react";
import * as LeafletModule from "leaflet";
// El CSS de Leaflet vive en ESTE chunk: quien no abre un mapa no lo descarga.
import "leaflet/dist/leaflet.css";
import markerIconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png?url";
import markerIconUrl from "leaflet/dist/images/marker-icon.png?url";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png?url";
import { prefersReducedMotion } from "@/lib/motion";
import { t } from "@/i18n";
import type { LatLng } from "./coords";
import { TILE_ATTRIBUTION, TILE_MAX_ZOOM, TILE_URL, PIN_ZOOM } from "./mapConfig";

// Leaflet 1.9 es UMD: según el empaquetador (Vite en desarrollo, Rollup en producción, Node en las pruebas) la
// importación `* as` trae las funciones directamente o dentro de `default`. Se admiten las dos formas.
const L: typeof LeafletModule =
  (LeafletModule as unknown as { default?: typeof LeafletModule }).default ?? LeafletModule;

// Corrección conocida de Leaflet con empaquetadores: sus iconos se buscan por una ruta que el empaquetador no conoce
// y salen rotos. Se le dan las URL que Vite resuelve (con hash, desde el propio paquete: nada de CDN externos).
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIconRetinaUrl,
  shadowUrl: markerShadowUrl,
});

/** Pide centrar el mapa (cada petición lleva un `nonce` nuevo: pedir el mismo punto dos veces vuelve a centrar). */
export interface MapFocus extends LatLng {
  zoom?: number;
  nonce: number;
}

export interface LeafletMapProps {
  /** Pin actual (null = sin pin). */
  pin: LatLng | null;
  /** Centro y zoom iniciales cuando no hay pin. */
  center: LatLng;
  zoom: number;
  focus: MapFocus | null;
  /** Nombre accesible del mapa. */
  label: string;
  /** Id del texto con las instrucciones de teclado. */
  describedBy?: string | undefined;
  /** Texto alternativo del pin. */
  pinLabel: string;
  /** El pin se colocó (clic, arrastre o Intro con el mapa enfocado). */
  onPick: (position: LatLng) => void;
  /** Las teselas no cargan (sin conexión, bloqueadas…) o volvieron a cargar. */
  onTilesFailing?: ((failing: boolean) => void) | undefined;
}

/**
 * El mapa en sí (Leaflet + OpenStreetMap). Se carga bajo demanda desde `LocationPicker`: Leaflet no entra en el chunk
 * principal. No sabe de formularios: recibe el pin y avisa con `onPick`.
 */
export default function LeafletMap({
  pin,
  center,
  zoom,
  focus,
  label,
  describedBy,
  pinLabel,
  onPick,
  onTilesFailing,
}: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletModule.Map | null>(null);
  const markerRef = useRef<LeafletModule.Marker | null>(null);
  // Los manejadores de Leaflet se registran UNA vez: leen siempre la última versión de estas funciones.
  const onPickRef = useRef(onPick);
  const onTilesFailingRef = useRef(onTilesFailing);
  const pinLabelRef = useRef(pinLabel);
  useEffect(() => {
    onPickRef.current = onPick;
    onTilesFailingRef.current = onTilesFailing;
    pinLabelRef.current = pinLabel;
  });
  const initialRef = useRef({ pin, center, zoom });

  // Creación y destrucción del mapa.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const initial = initialRef.current;
    const start = initial.pin ?? initial.center;
    const reduceMotion = prefersReducedMotion();
    const map = L.map(container, {
      center: [start.lat, start.lng],
      zoom: initial.pin ? PIN_ZOOM : initial.zoom,
      keyboard: true,
      // Los botones de zoom los pone `L.control.zoom` de abajo: los de fábrica traen «Zoom in»/«Zoom out» en inglés.
      zoomControl: false,
      // La rueda del ratón sigue desplazando la página o el cajón (con el mapa encima sería una trampa de scroll);
      // el zoom se hace con los botones, con +/− o con el gesto de pellizco.
      scrollWheelZoom: false,
      // «Reducir movimiento»: sin zoom animado, sin desvanecimientos ni inercia al arrastrar (las animaciones de Leaflet
      // que mueve JavaScript no las cubre la regla global de CSS).
      zoomAnimation: !reduceMotion,
      fadeAnimation: !reduceMotion,
      markerZoomAnimation: !reduceMotion,
      inertia: !reduceMotion,
    });
    mapRef.current = map;

    // Controles en español (los de fábrica traen sus títulos y etiquetas accesibles en inglés).
    L.control
      .zoom({
        position: "topleft",
        zoomInTitle: t("acct.addresses.picker.map.zoomIn"),
        zoomOutTitle: t("acct.addresses.picker.map.zoomOut"),
      })
      .addTo(map);
    map.attributionControl.setPrefix(
      `<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer" title="${t("acct.addresses.picker.map.creditTitle")}">Leaflet</a>`,
    );

    const tiles = L.tileLayer(TILE_URL, { maxZoom: TILE_MAX_ZOOM, attribution: TILE_ATTRIBUTION });
    let failing = false;
    const report = (next: boolean) => {
      if (failing === next) return;
      failing = next;
      onTilesFailingRef.current?.(next);
    };
    tiles.on("tileerror", () => report(true));
    tiles.on("tileload", () => report(false));
    tiles.addTo(map);

    map.on("click", (event: LeafletModule.LeafletMouseEvent) => {
      onPickRef.current({ lat: event.latlng.lat, lng: event.latlng.lng });
    });

    // Teclado: con el mapa enfocado, Intro coloca el pin en el centro (las flechas mueven el mapa hasta el sitio).
    const root = map.getContainer();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.target !== root) return;
      event.preventDefault();
      const centerNow = map.getCenter();
      onPickRef.current({ lat: centerNow.lat, lng: centerNow.lng });
    };
    root.addEventListener("keydown", onKeyDown);

    // El tamaño cambia al abrir el cajón o al girar el móvil: sin esto las teselas quedan a medias.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      root.removeEventListener("keydown", onKeyDown);
      // Leaflet 1.9.4: una animación de zoom en curso deja un temporizador de 250 ms (`_onZoomTransitionEnd`) que, si el
      // mapa ya se quitó (el cajón se cierra enseguida tras escribir o marcar el punto), lee un panel que `remove()` borró
      // y lanza «Cannot read properties of undefined (reading '_leaflet_pos')», que el visitante vería como «Algo salió
      // mal». `remove()` no baja la bandera `_animatingZoom` (es privada): se baja aquí para que ese temporizador no haga nada.
      map.stop();
      (map as unknown as { _animatingZoom?: boolean })._animatingZoom = false;
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // Accesibilidad del propio mapa (Leaflet lo vuelve enfocable con `tabindex=0`).
  useEffect(() => {
    const root = mapRef.current?.getContainer();
    if (!root) return;
    root.setAttribute("role", "application");
    root.setAttribute("aria-label", label);
    if (describedBy) root.setAttribute("aria-describedby", describedBy);
    else root.removeAttribute("aria-describedby");
  }, [label, describedBy]);

  // Pin: se crea, se mueve o se quita según el valor.
  const pinLat = pin?.lat;
  const pinLng = pin?.lng;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (pinLat === undefined || pinLng === undefined) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const existing = markerRef.current;
    if (existing) {
      const current = existing.getLatLng();
      if (current.lat !== pinLat || current.lng !== pinLng) existing.setLatLng([pinLat, pinLng]);
      return;
    }
    const marker = L.marker([pinLat, pinLng], {
      draggable: true,
      keyboard: true,
      alt: pinLabelRef.current,
      title: pinLabelRef.current,
    });
    marker.on("dragend", () => {
      const position = marker.getLatLng();
      onPickRef.current({ lat: position.lat, lng: position.lng });
    });
    marker.addTo(map);
    markerRef.current = marker;
  }, [pinLat, pinLng]);

  // Centrado a petición (resultado de búsqueda, ubicación del dispositivo…).
  const focusNonce = focus?.nonce;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    map.setView([focus.lat, focus.lng], Math.max(map.getZoom(), focus.zoom ?? PIN_ZOOM), {
      animate: !prefersReducedMotion(),
    });
    // Solo cuando llega una petición nueva: el objeto `focus` cambia de identidad en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  return <div ref={containerRef} className="h-full w-full" />;
}
