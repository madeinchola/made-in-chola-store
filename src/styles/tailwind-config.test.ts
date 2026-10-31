import { describe, expect, it } from "vitest";
import resolveConfig from "tailwindcss/resolveConfig";
import config from "../../tailwind.config";

const theme = resolveConfig(config).theme;

describe("tailwind.config", () => {
  it("las pantallas del contenedor son literales en px: `var()` no vale en media queries (la regla se descartaba y el contenedor medía 1920 px)", () => {
    const screens = (theme.container as { screens: Record<string, string> }).screens;
    expect(Object.keys(screens).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(screens)) {
      expect(value, name).toMatch(/^\d+px$/);
    }
  });
  it("el ancho máximo del contenedor es 1400 px", () => {
    expect((theme.container as { screens: Record<string, string> }).screens["2xl"]).toBe("1400px");
  });
  it("ninguna pantalla (breakpoint) usa variables CSS", () => {
    for (const [name, value] of Object.entries(theme.screens as Record<string, string>)) {
      expect(String(value), name).not.toContain("var(");
    }
  });
});
