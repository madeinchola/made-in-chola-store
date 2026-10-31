import { getEnv } from "@/lib/env";

const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Dominio oficial del sitio (`VITE_SITE_URL`), sin barra final. Se usa en canónicos, Open Graph y el mapa del sitio.
 *
 * En un build de producción un valor que sigue siendo el predeterminado (localhost) significa «sin configurar»: usarlo
 * haría que los buscadores indexaran `http://localhost:5173`, así que se cae al dominio desde el que se sirve la página.
 */
export function siteUrl(): string {
  let configured: string;
  try {
    configured = getEnv().VITE_SITE_URL.replace(/\/+$/, "");
  } catch {
    return typeof window === "undefined" ? "" : window.location.origin;
  }
  if (import.meta.env.PROD && LOCAL_HOST.test(configured) && typeof window !== "undefined") {
    return window.location.origin;
  }
  return configured;
}
