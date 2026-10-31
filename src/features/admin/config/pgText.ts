/**
 * Piezas de texto que reproducen EXACTAMENTE cómo PostgreSQL evalúa las restricciones de ajustes y banners. Verificado contra
 * la base local: `[[:space:]]` cuenta como espacio U+0009–U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000–U+200A, U+2028,
 * U+2029, U+202F, U+205F y U+3000 (y NO U+FEFF, al revés que `\s` de JavaScript, que sí lo incluye y no incluye U+0085).
 *
 * OJO con la collation: eso vale para la collation por defecto de la base local (`en_US.UTF-8`), que es la que usan las
 * columnas y las variables de los triggers. Bajo la collation `"C"` Postgres solo reconoce los espacios ASCII, así que si
 * la base de la nube usara `C`, aceptaría espacios Unicode que este cliente rechaza. El cliente es entonces MÁS estricto,
 * nunca más laxo: lo peor que puede pasar es rechazar de más, no dejar pasar algo que la base vaya a rechazar.
 */
export const PG_SPACE =
  "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

/** `char_length()` de Postgres cuenta caracteres (puntos de código), no unidades UTF-16 como `.length`. */
export const charLength = (value: string): number => [...value].length;

/** `btrim(text)` de Postgres recorta solo el espacio normal U+0020 (no tabuladores ni espacios Unicode). */
export const btrimSpaces = (value: string): string => value.replace(/^ +| +$/g, "");

export const HTTPS_URL_RE = new RegExp(`^https://[^${PG_SPACE}]+$`);
export const EMAIL_RE = new RegExp(`^[^@${PG_SPACE}]+@[^@${PG_SPACE}]+\\.[^@${PG_SPACE}]+$`);
export const PHONE_E164_RE = /^\+[1-9][0-9]{7,14}$/;
export const INT_RE = /^[0-9]{1,9}$/;
/** Ruta interna: "/" o "/algo" (no "//x" ni "/\x", que algunos navegadores tratan como otro sitio). */
const INTERNAL_PATH_RE = new RegExp(`^/([^/\\\\${PG_SPACE}][^${PG_SPACE}]*)?$`);

/** Réplica de `public.is_safe_link()`: NULL es seguro; si no, ≤ 2048 caracteres y ruta interna o https. */
export function isSafeLink(url: string | null): boolean {
  if (url === null) return true;
  return charLength(url) <= 2048 && (INTERNAL_PATH_RE.test(url) || HTTPS_URL_RE.test(url));
}
