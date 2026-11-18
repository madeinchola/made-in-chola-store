import { describe, expect, it } from "vitest";
import { analyticsConfigFrom } from "./config";

describe("analyticsConfigFrom", () => {
  it("sin ajustes, con ajustes vacíos o sin los dos: nada configurado, nada que preguntar", () => {
    expect(analyticsConfigFrom(undefined)).toEqual({
      metaPixelId: null,
      ga4Id: null,
      hasOptional: false,
    });
    expect(analyticsConfigFrom({ analytics_meta_pixel_id: "", analytics_ga4_id: "" })).toEqual({
      metaPixelId: null,
      ga4Id: null,
      hasOptional: false,
    });
  });

  it("un ID válido de cada uno activa su herramienta", () => {
    expect(
      analyticsConfigFrom({
        analytics_meta_pixel_id: " 1234567890123 ",
        analytics_ga4_id: "G-ABC123DEF4",
      }),
    ).toEqual({
      metaPixelId: "1234567890123",
      ga4Id: "G-ABC123DEF4",
      hasOptional: true,
    });
    expect(analyticsConfigFrom({ analytics_ga4_id: "G-ABC123DEF4" }).hasOptional).toBe(true);
  });

  it.each([
    ["un Pixel con letras", { analytics_meta_pixel_id: "abc12345" }],
    ["un Pixel corto", { analytics_meta_pixel_id: "1234567" }],
    [
      "un Pixel que intenta cerrar el script",
      { analytics_meta_pixel_id: "12345678');alert(1);//" },
    ],
    ["un GA4 de Universal Analytics", { analytics_ga4_id: "UA-12345-1" }],
    ["un GA4 en minúsculas", { analytics_ga4_id: "g-abc123def4" }],
    ["un GA4 con el cuerpo en minúsculas", { analytics_ga4_id: "G-abc123def4" }],
    ["un GA4 con código", { analytics_ga4_id: "G-</script><script>" }],
    ["un valor que no es texto", { analytics_meta_pixel_id: 12345678 }],
  ])("%s NO se acepta: nunca se inyecta en la página", (_label, settings) => {
    expect(analyticsConfigFrom(settings)).toEqual({
      metaPixelId: null,
      ga4Id: null,
      hasOptional: false,
    });
  });
});
