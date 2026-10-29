/**
 * Slug de URL a partir de un nombre. Debe producir EXACTAMENTE lo mismo que la función SQL `public.slugify`
 * (la BD es la autoridad: un test de integración compara ambas). Sirve para la vista previa en el panel admin.
 *
 * "Camiseta Ñandú — Edición 2027" → "camiseta-nandu-edicion-2027". Devuelve "" si no queda nada alfanumérico.
 */
// Caracteres que Unicode no descompone en "base + acento" y que `unaccent` de PostgreSQL sí pliega. La lista sale
// de comparar contra la BD carácter por carácter (catalog.integration.test.ts, U+00A0–U+017F: Latin-1 y Latin
// Extendido-A, que cubren español, portugués, francés, italiano, alemán, catalán…). Las claves van en minúscula
// porque el plegado se aplica después de `toLowerCase()`. Latin Extendido-B (U+0180 en adelante: pinyin, croata,
// lenguas africanas…) NO está cubierto: ahí `unaccent` pliega más letras que este cliente; el slug resultante
// sigue siendo válido en ambos lados, solo puede diferir la vista previa.
const EXTRA_FOLDS: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  đ: "d",
  ł: "l",
  ð: "d",
  þ: "th",
  ħ: "h",
  ı: "i",
  ĳ: "ij",
  ĸ: "q",
  ŀ: "l",
  ŋ: "n",
  ŧ: "t",
  ſ: "s",
  ŉ: "'n",
  "©": "(c)",
  "®": "(r)",
  "¼": " 1/4",
  "½": " 1/2",
  "¾": " 3/4",
};
const EXTRA_FOLD_PATTERN = new RegExp(`[${Object.keys(EXTRA_FOLDS).join("")}]`, "g");

export function slugify(text: string): string {
  const folded = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(EXTRA_FOLD_PATTERN, (c) => EXTRA_FOLDS[c] ?? c);
  return folded
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}
