import { toLaPazInputValue } from "@/lib/datetime";

/**
 * Exportación a CSV, armada SIEMPRE en el navegador (un `Blob`): los códigos de cupón y los datos de las clientas no pasan
 * por ningún servidor ni por la URL. Sigue la RFC 4180 (coma, comillas dobles duplicadas, CRLF) con BOM UTF-8 para que
 * Excel respete los acentos, y neutraliza la «inyección de fórmulas»: una celda que empieza con `=`, `+`, `-`, `@`, tabulador o
 * retorno de carro la tomaría una hoja de cálculo por una fórmula (y podría ejecutar algo al abrir el archivo), así que se le
 * antepone una comilla simple y pasa a ser texto.
 */

const BOM = "﻿";
const EOL = "\r\n";
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** Antepone `'` a lo que una hoja de cálculo leería como fórmula. */
export const neutralizeFormula = (cell: string): string =>
  FORMULA_START.test(cell) ? `'${cell}` : cell;

/** Una celda lista para el CSV: sin fórmulas y, si hace falta, entre comillas con las comillas internas duplicadas. */
export function csvCell(cell: string): string {
  const safe = neutralizeFormula(cell);
  return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Cada registro termina en CRLF (también el último). Un registro de una sola celda vacía va como `""` para no parecer una línea en blanco. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const lines = rows.map((row) =>
    row.length === 1 && row[0] === "" ? '""' : row.map(csvCell).join(","),
  );
  return BOM + lines.map((line) => line + EOL).join("");
}

/**
 * Nombre de archivo seguro: sin tildes ni símbolos, en minúsculas, con la fecha de HOY en La Paz («codigos-verano-2026-11-06.csv»).
 * El texto de entrada (p. ej. el nombre de un descuento) lo escribe una persona: nunca llega al nombre tal cual.
 */
export function csvFileName(base: string, now: Date = new Date()): string {
  const slug = base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  const day = toLaPazInputValue(now.toISOString()).slice(0, 10);
  return `${slug || "datos"}-${day}.csv`;
}

/** Tiempo que se espera antes de liberar la URL del archivo: algunos navegadores cancelan la descarga si se libera en el mismo instante. */
export const REVOKE_DELAY_MS = 1000;

/** Descarga `csv` como archivo: crea un `Blob`, un enlace temporal que se pulsa y se quita, y libera la URL. */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  }
}
