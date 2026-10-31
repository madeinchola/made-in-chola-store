import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EMAIL_RE,
  HTTPS_URL_RE,
  INT_RE,
  PHONE_E164_RE,
  btrimSpaces,
  charLength,
  isSafeLink,
} from "./pgText";

/**
 * Contraste DIFERENCIAL con PostgreSQL: cada fila es [texto, url, email, teléfono, entero, link] donde el 1/0 lo
 * calculó la propia base (consulta de solo lectura con las mismas expresiones de `store_settings_validate()` e
 * `is_safe_link()`, 2026-10-29). Si alguien cambia una regla en SQL o en el cliente sin la otra, esto falla.
 * Cubre espacios Unicode (U+0085, U+00A0, U+2003, U+3000), U+FEFF y U+200B (que Postgres NO cuenta como espacio),
 * `//`, `/\`, acentos, saltos de línea finales y los límites de longitud.
 */
const rows = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "pgText.fixture.json"), "utf8"),
) as [string, number, number, number, number, number][];

const urlRule = (v: string) => HTTPS_URL_RE.test(v) && charLength(v) <= 2048;
const emailRule = (v: string) =>
  charLength(v) <= 254 && v === btrimSpaces(v).toLowerCase() && EMAIL_RE.test(v);

describe("réplicas de las reglas de Postgres (contraste con la base)", () => {
  it("el fixture es sustancioso y tiene positivos y negativos de cada regla", () => {
    expect(rows.length).toBeGreaterThan(500);
    for (const col of [1, 2, 3, 4, 5] as const) {
      const positives = rows.filter((r) => r[col] === 1).length;
      expect(positives, `columna ${col}`).toBeGreaterThan(10);
      expect(rows.length - positives, `columna ${col}`).toBeGreaterThan(10);
    }
  });

  it("url https: coincide con la base en todas las muestras", () => {
    const wrong = rows
      .filter(([v, url]) => (urlRule(v) ? 1 : 0) !== url)
      .map((r) => JSON.stringify(r[0]));
    expect(wrong).toEqual([]);
  });

  it("correo: coincide con la base en todas las muestras", () => {
    const wrong = rows
      .filter(([v, , email]) => (emailRule(v) ? 1 : 0) !== email)
      .map((r) => JSON.stringify(r[0]));
    expect(wrong).toEqual([]);
  });

  it("teléfono E.164: coincide con la base en todas las muestras", () => {
    const wrong = rows
      .filter(([v, , , tel]) => (PHONE_E164_RE.test(v) ? 1 : 0) !== tel)
      .map((r) => JSON.stringify(r[0]));
    expect(wrong).toEqual([]);
  });

  it("entero >= 0 (hasta 9 dígitos): coincide con la base en todas las muestras", () => {
    const wrong = rows
      .filter(([v, , , , int]) => (INT_RE.test(v) ? 1 : 0) !== int)
      .map((r) => JSON.stringify(r[0]));
    expect(wrong).toEqual([]);
  });

  it("is_safe_link: coincide con la base en todas las muestras (incluido '' que NO es seguro)", () => {
    const wrong = rows
      .filter(([v, , , , , link]) => (isSafeLink(v) ? 1 : 0) !== link)
      .map((r) => JSON.stringify(r[0]));
    expect(wrong).toEqual([]);
  });
});

describe("piezas auxiliares", () => {
  it("isSafeLink(null) es seguro (sin enlace)", () => {
    expect(isSafeLink(null)).toBe(true);
  });
  it("charLength cuenta caracteres, no unidades UTF-16", () => {
    expect("😀".length).toBe(2);
    expect(charLength("😀")).toBe(1);
    expect(charLength("ñandú")).toBe(5);
  });
  it("btrimSpaces recorta solo el espacio normal (como btrim de Postgres)", () => {
    expect(btrimSpaces("  a  ")).toBe("a");
    expect(btrimSpaces("\ta\t")).toBe("\ta\t");
    expect(btrimSpaces(" a")).toBe(" a");
  });
});
