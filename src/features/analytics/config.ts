import { useStoreSettings } from "@/features/catalog/hooks";
import type { StoreSettings } from "@/features/catalog/types";

/** Los mismos formatos que valida la base al guardar (`store_settings_validate_s15`): un ID que no los cumple NUNCA se inyecta en la página. */
export const PIXEL_ID_RE = /^[0-9]{8,20}$/;
export const GA4_ID_RE = /^G-[A-Z0-9]{6,14}$/;

export interface AnalyticsConfig {
  /** `null` = sin Pixel de Meta (el ajuste está vacío o no es un ID válido). */
  metaPixelId: string | null;
  /** `null` = sin GA4. */
  ga4Id: string | null;
  /** ¿Hay alguna herramienta opcional que necesite consentimiento? Si no, no hay aviso de cookies ni nada que preguntar. */
  hasOptional: boolean;
}

const pick = (settings: StoreSettings | undefined, key: string, pattern: RegExp): string | null => {
  const value = settings?.[key];
  return typeof value === "string" && pattern.test(value.trim()) ? value.trim() : null;
};

export function analyticsConfigFrom(settings: StoreSettings | undefined): AnalyticsConfig {
  const metaPixelId = pick(settings, "analytics_meta_pixel_id", PIXEL_ID_RE);
  const ga4Id = pick(settings, "analytics_ga4_id", GA4_ID_RE);
  return { metaPixelId, ga4Id, hasOptional: metaPixelId !== null || ga4Id !== null };
}

/** La configuración de analítica de la tienda; mientras los ajustes no llegan, no hay nada configurado (nada se carga ni se pregunta). */
export function useAnalyticsConfig(): AnalyticsConfig & { ready: boolean } {
  const settings = useStoreSettings();
  return { ...analyticsConfigFrom(settings.data), ready: settings.isSuccess };
}
