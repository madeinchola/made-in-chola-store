import Papa from "papaparse";
import { IMPORT_KINDS, columnFor, normalizeHeader } from "./kinds";
import { normalizeNumber } from "./numbers";
import type { ImportKind, ParseOutcome, ParsedRow, RowProblem } from "./types";

/** Tope del archivo: más grande que cualquier plantilla razonable y todavía cómodo de leer en el navegador. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 10_000;
/** Las categorías se envían en UN bloque (una hija puede colgar de otra del mismo archivo): hasta lo que cabe en un bloque. */
export const MAX_CATEGORY_ROWS = 500;

const SPREADSHEET = /\.(xlsx|xlsm|xls|ods|numbers)$/i;

/** Un archivo de Excel o de otra hoja de cálculo (un .xlsx es un zip que empieza con «PK»). */
function looksLikeSpreadsheet(name: string, bytes: Uint8Array): boolean {
  return (
    SPREADSHEET.test(name) ||
    (bytes[0] === 0x50 && bytes[1] === 0x4b) ||
    (bytes[0] === 0xd0 && bytes[1] === 0xcf)
  );
}

/** UTF-8 si lo es; si no, Windows-1252 (lo que guardan muchos Excel «CSV» antiguos). Sin la marca BOM. */
export function decodeBytes(bytes: Uint8Array): {
  text: string;
  encoding: "utf-8" | "windows-1252";
} {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text: text.replace(/^\uFEFF/, ""), encoding: "utf-8" };
  } catch {
    return {
      text: new TextDecoder("windows-1252").decode(bytes).replace(/^\uFEFF/, ""),
      encoding: "windows-1252",
    };
  }
}

/**
 * El separador, por el ENCABEZADO: el que más veces aparece fuera de comillas. (La detección de papaparse falla en archivos cortos
 * porque el salto de línea final cuenta como una fila de un solo campo.) En empate gana «;», que es lo que guarda Excel en español.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\n|\r/).find((line) => line.trim() !== "") ?? "";
  const bare = firstLine.replace(/"[^"]*"/g, "");
  let best = ",";
  let bestCount = 0;
  for (const candidate of [";", ",", "\t", "|"]) {
    const count = bare.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** Parecido al slug de la base (sin tildes, en minúsculas, con guiones): sirve para avisar de repetidos antes de enviar. */
function slugish(text: string): string {
  return normalizeHeader(text).replace(/_/g, "-");
}

/** La clave que identifica a una fila dentro del archivo (dos filas con la misma clave se pisarían). */
function identityKey(
  kind: ImportKind,
  values: Record<string, string>,
): { field: string; key: string } | null {
  switch (kind) {
    case "products":
    case "stock":
      return values.sku ? { field: "sku", key: values.sku.toLowerCase() } : null;
    case "prices":
      return values.code
        ? {
            field: "code",
            key: `${values.code.toLowerCase()}|${(values.currency || "").toUpperCase()}`,
          }
        : null;
    case "categories": {
      const slug = values.slug || (values.name ? slugish(values.name) : "");
      return slug ? { field: "slug", key: slug } : null;
    }
  }
}

/**
 * Lee un archivo de importación: lo decodifica (UTF-8 o Windows-1252), detecta el separador, reconoce los encabezados (con o sin
 * tildes, en español o con su nombre técnico) y normaliza los números. NO decide si los datos son buenos: eso es de la base. Lo
 * único que descarta aquí es lo que la base no podría ver por su cuenta: repetidos entre bloques, fórmulas y números ambiguos.
 */
export function parseImportFile(
  kind: ImportKind,
  fileName: string,
  buffer: ArrayBuffer,
): ParseOutcome {
  const bytes = new Uint8Array(buffer);
  if (looksLikeSpreadsheet(fileName, bytes)) return { ok: false, failure: { code: "not_csv" } };
  if (bytes.byteLength > MAX_FILE_BYTES) return { ok: false, failure: { code: "too_big" } };
  if (bytes.byteLength === 0) return { ok: false, failure: { code: "empty" } };

  const { text, encoding } = decodeBytes(bytes);
  const parsed = Papa.parse<string[]>(text, {
    delimiter: detectDelimiter(text),
    skipEmptyLines: false,
  });
  const table = parsed.data.filter((r): r is string[] => Array.isArray(r));
  const headerIndex = table.findIndex((r) => r.some((cell) => cell.trim() !== ""));
  if (headerIndex < 0) return { ok: false, failure: { code: "empty" } };

  const header = table[headerIndex] ?? [];
  const def = IMPORT_KINDS[kind];
  const mapping = header.map((h) => columnFor(kind, h));
  const present = new Set(mapping.filter((c) => c !== null).map((c) => c!.key));
  const missing = def.columns.filter((c) => c.required && !present.has(c.key)).map((c) => c.header);
  if (missing.length > 0)
    return { ok: false, failure: { code: "missing_columns", detail: missing.join(", ") } };
  const ignoredColumns = header.filter((h, i) => mapping[i] === null && h.trim() !== "");

  const rows: ParsedRow[] = [];
  const seen = new Map<string, number>();
  for (let i = headerIndex + 1; i < table.length; i++) {
    const cells = table[i] ?? [];
    if (cells.every((c) => c.trim() === "")) continue;
    const values: Record<string, string> = {};
    const problems: RowProblem[] = [];
    mapping.forEach((column, index) => {
      if (!column) return;
      const raw = (cells[index] ?? "").trim();
      if (raw.startsWith("=")) {
        problems.push({ field: column.key, code: "formula" });
        values[column.key] = "";
        return;
      }
      if (column.numeric && raw !== "") {
        const n = normalizeNumber(raw);
        if (n.ok) values[column.key] = n.value;
        else {
          values[column.key] = raw;
          if (n.code === "ambiguous")
            problems.push({ field: column.key, code: "number_ambiguous" });
        }
        return;
      }
      values[column.key] = raw;
    });
    const identity = identityKey(kind, values);
    if (identity) {
      if (seen.has(identity.key))
        problems.push({ field: identity.field, code: "duplicate_in_file" });
      else seen.set(identity.key, i + 1);
    }
    // número de fila como lo cuenta una hoja de cálculo: el encabezado es la fila `headerIndex + 1`
    rows.push({ row: i + 1, values, problems });
  }
  if (rows.length === 0) return { ok: false, failure: { code: "empty" } };
  if (rows.length > MAX_ROWS || (kind === "categories" && rows.length > MAX_CATEGORY_ROWS)) {
    return {
      ok: false,
      failure: {
        code: "too_many_rows",
        detail: String(kind === "categories" ? MAX_CATEGORY_ROWS : MAX_ROWS),
      },
    };
  }
  return {
    ok: true,
    file: { kind, fileName, rows, ignoredColumns, encoding, delimiter: parsed.meta.delimiter },
  };
}
