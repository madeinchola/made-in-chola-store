import { describe, expect, it } from "vitest";
import { slugify } from "./slug";
import { SLUG_CASES } from "./slug.cases";

describe("slugify", () => {
  it.each(SLUG_CASES)("%j → %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("el resultado siempre cumple el formato que exige la BD (o es vacío)", () => {
    const valid = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const [input] of SLUG_CASES) {
      const s = slugify(input);
      if (s !== "") expect(s).toMatch(valid);
    }
  });

  it("es idempotente: slugify(slugify(x)) = slugify(x)", () => {
    for (const [input] of SLUG_CASES) {
      expect(slugify(slugify(input))).toBe(slugify(input));
    }
  });

  it("pliega letras sin descomposición Unicode (ß, æ, ø, đ, ł, ð, þ) como lo hace la BD", () => {
    expect(slugify("Straße")).toBe("strasse");
    expect(slugify("Ærø")).toBe("aero");
    expect(slugify("Łódź đ")).toBe("lodz-d");
    expect(slugify("Þór Ðorðe")).toBe("thor-dord" + "e"); // þ→th, Ð→d, ð→d (verificado contra unaccent de PostgreSQL)
  });
});
