import { describe, expect, it } from "vitest";
import { COUNTRIES } from "@/lib/countries";
import { DIAL_CODES, normalizePhone } from "@shared/identity";

// El selector de país del diálogo de teléfono ofrece exactamente COUNTRIES. `normalizePhone` LANZA con un país que no
// conoce, y el diálogo no lo captura (no puede ocurrir mientras esto se cumpla).
describe("países del selector de teléfono", () => {
  it.each(COUNTRIES.map((c) => [c.code, c.dial] as const))(
    "%s (%s) tiene prefijo y no hace lanzar a normalizePhone",
    (code, dial) => {
      expect(DIAL_CODES[code]).toBe(dial.replace("+", ""));
      expect(() => normalizePhone("71234567", code)).not.toThrow();
    },
  );

  it("hay 12 países y el primero (por defecto) es Bolivia", () => {
    expect(COUNTRIES).toHaveLength(12);
    expect(COUNTRIES[0]?.code).toBe("BO");
  });
});
