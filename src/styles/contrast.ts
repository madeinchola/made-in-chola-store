/** Utilidades de contraste WCAG 2.x para validar los tokens de color (solo se usan en pruebas). */

export type Rgb = [number, number, number];

/** Variables CSS (`--nombre: valor;`) del primer bloque cuyo selector sea exactamente `selector`. */
export function parseTokenBlock(css: string, selector: string): Record<string, string> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(clean);
  if (!match) throw new Error(`No se encontró el bloque ${selector}`);
  const tokens: Record<string, string> = {};
  for (const declaration of match[1]!.split(";")) {
    const index = declaration.indexOf(":");
    if (index < 0) continue;
    const name = declaration.slice(0, index).trim();
    if (name.startsWith("--"))
      tokens[name.slice(2)] = declaration
        .slice(index + 1)
        .trim()
        .replace(/\s+/g, " ");
  }
  return tokens;
}

/** "H S% L%" → RGB 0–255 (sin redondear). */
export function hslToRgb(value: string): Rgb {
  const m = /^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%$/.exec(value.trim());
  if (!m) throw new Error(`Color HSL no válido: "${value}"`);
  const h = Number(m[1]);
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export function tokenRgb(tokens: Record<string, string>, name: string): Rgb {
  const value = tokens[name];
  if (value === undefined) throw new Error(`Falta el token --${name}`);
  return hslToRgb(value);
}

function luminance([r, g, b]: Rgb): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Relación de contraste WCAG entre dos colores (1–21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
