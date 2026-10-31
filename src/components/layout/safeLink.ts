/** Destino ya validado de un enlace que viene de la base de datos (banner, redes…). */
export type SafeLink = { kind: "internal"; to: string } | { kind: "external"; href: string };

// Espacios, tabuladores, saltos de línea y otros caracteres de control, más la barra invertida. Los navegadores QUITAN
// tabulaciones y saltos al interpretar una URL ("/\t/evil.com" pasa a ser "//evil.com") y tratan `\` como `/`, así que se
// rechazan en cualquier posición. (Bucle por código de carácter: una regex con \x00-\x1f incumple `no-control-regex`.)
function hasForbiddenChar(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f || code === 0x5c || /\s/.test(char)) return true;
  }
  return false;
}

/**
 * Valida un enlace escrito por un administrador antes de convertirlo en `href`/`to`.
 * Acepta una ruta interna (empieza por `/`, nunca `//`) o una URL http(s) con dominio y sin credenciales.
 * Todo lo demás (`javascript:`, `data:`, `//otro.sitio`, vacío…) devuelve null: no se pinta como enlace.
 * `httpsOnly` exige https (redes sociales, que la base ya valida así).
 */
export function safeLink(
  value: string | null | undefined,
  opts: { httpsOnly?: boolean } = {},
): SafeLink | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw === "" || hasForbiddenChar(raw)) return null;

  if (raw.startsWith("/")) {
    return raw.startsWith("//") || opts.httpsOnly ? null : { kind: "internal", to: raw };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const allowed = opts.httpsOnly ? ["https:"] : ["https:", "http:"];
  if (!allowed.includes(url.protocol)) return null;
  if (url.hostname === "" || url.username !== "" || url.password !== "") return null;
  return { kind: "external", href: url.href };
}
