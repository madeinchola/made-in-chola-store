/**
 * Casos de slugify con resultados esperados calculados a mano. Los comparten el test unitario de `slug.ts`
 * y el test de integración que verifica la PARIDAD con la función SQL `public.slugify`.
 */
export const SLUG_CASES: readonly (readonly [string, string])[] = [
  ["Camiseta Ñandú — Edición 2027", "camiseta-nandu-edicion-2027"],
  ["  Sombrero   Chakra  Naranja  ", "sombrero-chakra-naranja"],
  ["ABC__def--ghi", "abc-def-ghi"],
  ["Bolso 100% lana", "bolso-100-lana"],
  ["¡¡¡", ""],
  ["", ""],
  ["Chaqueta Japandi", "chaqueta-japandi"],
  ["ÁÉÍÓÚ áéíóú ü Ü", "aeiou-aeiou-u-u"],
  ["Niño/Niña", "nino-nina"],
  ["a---b", "a-b"],
  ["-borde-", "borde"],
  ["Ñ", "n"],
  ["2027", "2027"],
];
