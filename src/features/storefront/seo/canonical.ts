/** Parámetros de seguimiento que NUNCA forman parte de la URL canónica (compartir con `?utm_…` o `?fbclid=…`). */
const TRACKING_PARAM =
  /^(utm_.*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ttclid|_hsenc|_hsmi|ref|ref_src)$/i;

/** Quita los parámetros de seguimiento de una cadena de búsqueda. */
export function stripTracking(search: string | URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(typeof search === "string" ? search : search.toString());
  for (const key of [...new Set(params.keys())]) {
    if (TRACKING_PARAM.test(key)) params.delete(key);
  }
  return params;
}

/** Ruta normalizada: empieza por «/», sin barra final (salvo la raíz), sin barras repetidas ni `.`/`..`. */
export function normalizePath(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? "/";
  const segments = clean
    .split("/")
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..");
  return `/${segments.join("/")}`;
}

/** URL absoluta de una ruta del sitio (el `siteUrl` puede traer barra final). */
export function absoluteUrl(siteUrl: string, path: string): string {
  return `${siteUrl.replace(/\/+$/, "")}${normalizePath(path)}`;
}

/**
 * URL canónica de una página: dominio oficial + ruta normalizada + solo los parámetros que se indican
 * (p. ej. `pagina`). Todo lo demás (utm, fbclid, filtros, orden) se descarta.
 */
export function canonicalUrl(
  siteUrl: string,
  path: string,
  keep: Record<string, string | number | null | undefined> = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(keep)) {
    if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  }
  const query = params.toString();
  return `${absoluteUrl(siteUrl, path)}${query ? `?${query}` : ""}`;
}
