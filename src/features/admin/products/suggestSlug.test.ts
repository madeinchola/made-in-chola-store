import { describe, expect, it } from "vitest";
import { SLUG_RE } from "./productSchema";
import { suggestSlug } from "./suggestSlug";

describe("suggestSlug", () => {
  it("minúsculas, sin acentos, ñ → n y guiones en lugar de espacios y signos", () => {
    expect(suggestSlug("Camisa Chola (Edición 2027)")).toBe("camisa-chola-edicion-2027");
    expect(suggestSlug("Ñandú Rojo")).toBe("nandu-rojo");
  });
  it("un nombre sin letras ni números da cadena vacía (el formulario pedirá escribir el slug)", () => {
    expect(suggestSlug("???")).toBe("");
    expect(suggestSlug("")).toBe("");
  });
  it("el recorte a 80 caracteres nunca deja un guion al final", () => {
    // 79 letras + guion + más texto: cortar en 80 dejaría "…a-" sin la limpieza
    const name = `${"a".repeat(79)} bbbb`;
    const slug = suggestSlug(name);
    expect(slug).toBe("a".repeat(79));
    expect(slug.length).toBeLessThanOrEqual(80);
  });
  it("lo sugerido siempre cumple la regla de la base (o es vacío)", () => {
    for (const n of [
      "Hola Mundo",
      "  espacios   raros  ",
      "A-B--C",
      "100% algodón",
      "x".repeat(200),
    ]) {
      const s = suggestSlug(n);
      expect(s === "" || SLUG_RE.test(s)).toBe(true);
      expect(s.length).toBeLessThanOrEqual(80);
    }
  });
});
