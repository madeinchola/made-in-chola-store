const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normaliza "#abc", "ABC" o "#A1B2C3" a "#rrggbb" en minúsculas; null si no es un color hexadecimal válido. */
export function normalizeHex(hex: string | null | undefined): string | null {
  const match = HEX_RE.exec(hex?.trim() ?? "");
  if (!match) return null;
  const digits = (match[1] as string).toLowerCase();
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((c) => c + c)
          .join("")
      : digits;
  return `#${full}`;
}
