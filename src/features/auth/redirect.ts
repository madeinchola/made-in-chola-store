/**
 * Ruta a la que volver tras el login. Solo se aceptan rutas INTERNAS ("/algo"): cualquier otra cosa
 * ("//evil.com", "https://evil.com", "/\\evil.com", "javascript:") cae en el destino por defecto (anti open-redirect).
 */
export function safeRedirectPath(candidate: unknown, fallback = "/"): string {
  if (typeof candidate !== "string") return fallback;
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\"))
    return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return fallback;
  try {
    const url = new URL(candidate, "http://internal.invalid");
    if (url.origin !== "http://internal.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
