/** Escapa texto para meterlo en HTML (contenido y atributos). Toda cadena que viene de la base pasa por aquí. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapa texto para XML (mapa del sitio). */
export function escapeXml(text: string): string {
  return escapeHtml(text);
}

/**
 * Recorta a `max` caracteres (puntos de código: un emoji nunca se parte por la mitad) en un límite de palabra, añade
 * «…» y colapsa saltos de línea y espacios.
 */
export function excerpt(text: string, max = 155): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  const cut = chars.slice(0, max - 1).join("");
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
