import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useConsent } from "@/features/consent/useConsent";
import { subscribeToTracking } from "@/features/storefront/analytics/track";
import { captureAttribution, clearAttribution } from "./attribution";
import { useAnalyticsConfig } from "./config";
import { toGa4Event, toMetaEvent } from "./mapping";
import { startGa4, startMetaPixel, type Ga4Provider, type MetaProvider } from "./providers";

/**
 * Conecta los eventos de la tienda con Meta y GA4, SOLO si hay un ID válido Y la persona aceptó la categoría: marketing para Meta,
 * analítica para GA4 y para la atribución. Retirar el consentimiento detiene el proveedor, borra sus cookies y la atribución guardada.
 * No pinta nada. Va en el diseño público (no en el panel de administración).
 */
export function AnalyticsManager() {
  const config = useAnalyticsConfig();
  const consent = useConsent();
  const { pathname } = useLocation();
  const meta = useRef<MetaProvider | null>(null);
  const ga4 = useRef<Ga4Provider | null>(null);
  const marketing = consent?.marketing === true;
  const analytics = consent?.analytics === true;

  // Meta Pixel: marketing + ID válido.
  useEffect(() => {
    if (!config.metaPixelId || !marketing) return;
    const provider = startMetaPixel(config.metaPixelId);
    meta.current = provider;
    const off = subscribeToTracking((event) => {
      const mapped = toMetaEvent(event);
      if (mapped) provider.send(mapped);
    }, "marketing");
    provider.pageView();
    return () => {
      off();
      provider.stop();
      meta.current = null;
    };
  }, [config.metaPixelId, marketing]);

  // GA4: analítica + ID válido.
  useEffect(() => {
    if (!config.ga4Id || !analytics) return;
    const provider = startGa4(config.ga4Id);
    ga4.current = provider;
    const off = subscribeToTracking((event) => {
      const mapped = toGa4Event(event);
      if (mapped) provider.send(mapped);
    }, "analytics");
    provider.pageView(window.location.pathname);
    return () => {
      off();
      provider.stop();
      ga4.current = null;
    };
  }, [config.ga4Id, analytics]);

  // Cada cambio de página (la primera ya la mandó el arranque de cada proveedor).
  const firstPath = useRef(pathname);
  useEffect(() => {
    if (pathname === firstPath.current) return;
    firstPath.current = pathname;
    meta.current?.pageView();
    ga4.current?.pageView(pathname);
  }, [pathname]);

  // Atribución: solo con analítica; al retirarla se borra lo guardado.
  useEffect(() => {
    if (analytics) captureAttribution(window.location, document.referrer);
    else clearAttribution();
  }, [analytics, pathname]);

  return null;
}
