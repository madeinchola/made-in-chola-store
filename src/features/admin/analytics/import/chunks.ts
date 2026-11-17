import type { ImportKind, ParsedRow } from "./types";

/**
 * Filas por bloque: la base corta cada llamada a los 8 s. Medido con 10 000 variantes: 200 filas tardan 2,3 s de media y 3,7 s como
 * máximo; con 100 hay el doble de margen para cuando la nube va lenta (más llamadas, el mismo tiempo total).
 */
export const CHUNK_SIZE = 100;
/** Nunca más de lo que acepta la base en un bloque. */
export const CHUNK_MAX = 500;

/**
 * Parte las filas en bloques. En productos, las filas del MISMO producto van juntas (primero las del primer código que aparece, luego
 * las del siguiente…): así la vista previa de cada bloque ve el producto completo y dice lo mismo que dirá al confirmar. Un grupo de
 * más de 500 variantes se parte porque la base no acepta más (la vista previa de la segunda parte lo verá ya «existente»).
 */
export function chunkRows(
  kind: ImportKind,
  rows: readonly ParsedRow[],
  size: number = CHUNK_SIZE,
): ParsedRow[][] {
  const ordered = kind === "products" ? groupByProduct(rows) : [...rows];
  const chunks: ParsedRow[][] = [];
  let current: ParsedRow[] = [];
  const flush = () => {
    if (current.length > 0) chunks.push(current);
    current = [];
  };
  if (kind === "products") {
    for (const group of splitGroups(ordered)) {
      if (current.length > 0 && current.length + group.length > size) flush();
      for (const row of group) {
        if (current.length >= CHUNK_MAX) flush();
        current.push(row);
      }
    }
  } else {
    for (const row of ordered) {
      if (current.length >= size) flush();
      current.push(row);
    }
  }
  flush();
  return chunks;
}

const codeOf = (row: ParsedRow): string => (row.values.code ?? "").toLowerCase();

function groupByProduct(rows: readonly ParsedRow[]): ParsedRow[] {
  const order: string[] = [];
  const groups = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    const code = codeOf(row);
    if (!groups.has(code)) {
      groups.set(code, []);
      order.push(code);
    }
    groups.get(code)!.push(row);
  }
  return order.flatMap((code) => groups.get(code)!);
}

function splitGroups(ordered: readonly ParsedRow[]): ParsedRow[][] {
  const groups: ParsedRow[][] = [];
  for (const row of ordered) {
    const last = groups[groups.length - 1];
    if (last && codeOf(last[0]!) === codeOf(row)) last.push(row);
    else groups.push([row]);
  }
  return groups;
}
