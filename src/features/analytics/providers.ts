import { deleteCookies } from "./cookies";
import { loadScript as defaultLoadScript } from "./scriptLoader";
import type { Ga4Event, MetaEvent } from "./mapping";

/**
 * Los dos proveedores de terceros. NADA de aquí se ejecuta sin que la persona haya aceptado su categoría y sin un ID válido: quien los
 * arranca (`AnalyticsManager`) lo comprueba. `stop()` los apaga —no envían más— y borra sus cookies; el script ya cargado queda en
 * memoria hasta la próxima visita, pero inerte.
 */
export interface Deps {
  loadScript: (src: string) => void;
}
const defaults: Deps = { loadScript: defaultLoadScript };

interface FbqFunction {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: unknown;
  loaded: boolean;
  version: string;
}
type W = {
  fbq?: FbqFunction;
  _fbq?: FbqFunction;
  gtag?: (...args: unknown[]) => void;
  dataLayer?: unknown[];
  [key: `ga-disable-${string}`]: boolean | undefined;
};

export interface MetaProvider {
  send(event: MetaEvent): void;
  pageView(): void;
  stop(): void;
}

export function startMetaPixel(pixelId: string, deps: Deps = defaults): MetaProvider {
  const w = window as unknown as W;
  let stopped = false;
  if (!w.fbq) {
    const fbq = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue.push(args);
    } as FbqFunction;
    fbq.queue = [];
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    w.fbq = fbq;
    w._fbq ??= fbq;
    deps.loadScript("https://connect.facebook.net/en_US/fbevents.js");
    fbq("init", pixelId);
  } else {
    // Ya estaba cargado (aceptó, retiró y volvió a aceptar sin recargar): se reactiva.
    w.fbq("consent", "grant");
  }
  let firstViewSent = false;
  return {
    send({ name, params, eventId }) {
      if (stopped) return;
      if (eventId) w.fbq?.("track", name, params, { eventID: eventId });
      else w.fbq?.("track", name, params);
    },
    pageView() {
      if (stopped) return;
      w.fbq?.("track", "PageView");
      firstViewSent = true;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      void firstViewSent;
      w.fbq?.("consent", "revoke");
      deleteCookies(/^_fb[pc]$/);
    },
  };
}

export interface Ga4Provider {
  send(event: Ga4Event): void;
  pageView(path: string): void;
  stop(): void;
}

export function startGa4(measurementId: string, deps: Deps = defaults): Ga4Provider {
  const w = window as unknown as W;
  let stopped = false;
  w[`ga-disable-${measurementId}`] = false;
  if (!w.gtag) {
    w.dataLayer = w.dataLayer ?? [];
    w.gtag = function (..._args: unknown[]) {
      // `gtag.js` espera ver el objeto `arguments` tal cual, no un arreglo
      // eslint-disable-next-line prefer-rest-params
      (w.dataLayer as unknown[]).push(arguments);
    };
    w.gtag("js", new Date());
    deps.loadScript(`https://www.googletagmanager.com/gtag/js?id=${measurementId}`);
  }
  // Sin vista de página automática (la mandamos nosotros en cada ruta), sin señales de Google ni personalización de anuncios.
  w.gtag("config", measurementId, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  return {
    send({ name, params }) {
      if (stopped) return;
      w.gtag?.("event", name, params);
    },
    pageView(path) {
      if (stopped) return;
      w.gtag?.("event", "page_view", {
        page_path: path,
        page_location: window.location.origin + path,
        page_title: document.title,
      });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      w[`ga-disable-${measurementId}`] = true;
      deleteCookies(/^(_ga|_ga_[A-Z0-9]+|_gid|_gat.*)$/);
    },
  };
}
