import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseTokenBlock, tokenRgb } from "./contrast";

// Lee el CSS REAL: si alguien cambia un token, este test recalcula los contrastes con el valor nuevo.
const css = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");
const light = parseTokenBlock(css, ":root");
const inverse = parseTokenBlock(css, ".theme-inverse");

const ratio = (tokens: Record<string, string>, a: string, b: string) =>
  contrastRatio(tokenRgb(tokens, a), tokenRgb(tokens, b));

describe("contraste WCAG (calculado desde tokens.css)", () => {
  describe("método: valores de referencia conocidos", () => {
    it("negro sobre blanco = 21:1", () => {
      expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    });
    it("el color consigo mismo = 1:1", () => {
      expect(contrastRatio([120, 30, 200], [120, 30, 200])).toBeCloseTo(1, 5);
    });
    it("#767676 sobre blanco ≈ 4.54:1 (el gris AA más claro conocido)", () => {
      expect(contrastRatio([0x76, 0x76, 0x76], [255, 255, 255])).toBeCloseTo(4.54, 2);
    });
    it("no depende del orden de los colores", () => {
      expect(contrastRatio([10, 20, 30], [240, 240, 240])).toBe(
        contrastRatio([240, 240, 240], [10, 20, 30]),
      );
    });
  });

  describe("el parser lee los colores muestreados del diseño", () => {
    it("--background = #F5F4F4, --primary = #382F21, --secondary = #E2DEDE (±1 por redondeo HSL)", () => {
      const near = (got: number[], want: number[]) =>
        got.forEach((c, i) => expect(Math.abs(c - want[i]!)).toBeLessThanOrEqual(2));
      near(tokenRgb(light, "background"), [0xf5, 0xf4, 0xf4]);
      near(tokenRgb(light, "primary"), [0x38, 0x2f, 0x21]);
      near(tokenRgb(light, "secondary"), [0xe2, 0xde, 0xde]);
    });
  });

  describe("tema claro: texto (≥ 4.5:1)", () => {
    const pairs: [string, string][] = [
      ["foreground", "background"],
      ["foreground", "card"],
      ["foreground", "muted"],
      ["foreground", "secondary"],
      ["muted-foreground", "background"],
      ["muted-foreground", "card"],
      ["muted-foreground", "muted"],
      ["muted-foreground", "secondary"],
      ["primary-foreground", "primary"],
      ["secondary-foreground", "secondary"],
      ["accent-foreground", "accent"],
      ["destructive-foreground", "destructive"],
      ["destructive", "background"],
      ["destructive", "destructive-soft"],
      ["success", "background"],
      ["success", "success-soft"],
      ["warning", "background"],
      ["warning", "warning-soft"],
      ["info", "background"],
      ["info", "info-soft"],
    ];
    it.each(pairs)("%s sobre %s", (fg, bg) => {
      expect(ratio(light, fg, bg), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe("tema claro: componentes de interfaz y foco (≥ 3:1, criterio 1.4.11)", () => {
    it.each([["input"], ["ring"]])("%s sobre el fondo", (token) => {
      expect(ratio(light, token, "background")).toBeGreaterThanOrEqual(3);
    });
    it("el borde de los campos también se distingue sobre tarjetas", () => {
      expect(ratio(light, "input", "card")).toBeGreaterThanOrEqual(3);
    });
    it("`border` es decorativo: NO se usa para delimitar controles (por eso no se le exige 3:1)", () => {
      expect(ratio(light, "border", "background")).toBeLessThan(3);
      expect(ratio(light, "input", "background")).toBeGreaterThan(
        ratio(light, "border", "background"),
      );
    });
  });

  describe("superficie invertida (pie, barra de anuncios)", () => {
    const merged = { ...light, ...inverse };
    it.each([
      ["foreground", "background"],
      ["muted-foreground", "background"],
      ["muted-foreground", "muted"],
      ["primary-foreground", "primary"],
    ] as [string, string][])("%s sobre %s ≥ 4.5:1", (fg, bg) => {
      expect(ratio(merged, fg, bg)).toBeGreaterThanOrEqual(4.5);
    });
    it("el anillo de foco y el borde de campos se ven sobre el fondo oscuro (≥ 3:1)", () => {
      expect(ratio(merged, "ring", "background")).toBeGreaterThanOrEqual(3);
      expect(ratio(merged, "input", "background")).toBeGreaterThanOrEqual(3);
    });
    it("invierte de verdad: el fondo pasa a ser el marrón y el texto el claro", () => {
      expect(tokenRgb(merged, "background")).toEqual(tokenRgb(light, "primary"));
      expect(tokenRgb(merged, "foreground")).toEqual(tokenRgb(light, "background"));
    });
  });
});

describe("tokens.css: estructura", () => {
  it("define todos los tokens que Tailwind y los componentes leen", () => {
    const required = [
      "font-sans",
      "font-display",
      "background",
      "foreground",
      "primary",
      "primary-foreground",
      "secondary",
      "muted",
      "muted-foreground",
      "accent",
      "border",
      "input",
      "ring",
      "destructive",
      "destructive-soft",
      "success",
      "success-soft",
      "warning",
      "warning-soft",
      "info",
      "info-soft",
      "card",
      "popover",
      "radius-sm",
      "radius-md",
      "radius-lg",
      "radius-card",
      "radius-pill",
      "shadow-sm",
      "shadow-md",
      "shadow-lg",
      "duration-fast",
      "duration-base",
      "duration-slow",
      "ease-standard",
      "gutter",
      "section-y",
      "header-height",
    ];
    for (const name of required) expect(light[name], `--${name}`).toBeTruthy();
  });

  it("todo color es un triple 'H S% L%' válido (Tailwind aplica la opacidad sobre eso)", () => {
    const colorTokens = [
      "background",
      "foreground",
      "card",
      "popover",
      "primary",
      "secondary",
      "muted",
      "accent",
      "border",
      "input",
      "ring",
      "destructive",
      "destructive-soft",
      "success",
      "success-soft",
      "warning",
      "warning-soft",
      "info",
      "info-soft",
    ];
    for (const name of colorTokens) {
      expect(light[name], `--${name}`).toMatch(
        /^\d{1,3}(\.\d+)? \d{1,3}(\.\d+)?% \d{1,3}(\.\d+)?%$/,
      );
    }
  });

  it("la fuente de texto y la de títulos terminan en una genérica del sistema (si falla la carga)", () => {
    expect(light["font-sans"]).toMatch(/sans-serif\s*$/);
    expect(light["font-display"]).toMatch(/serif\s*$/);
  });
});
