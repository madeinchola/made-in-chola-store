import type { StockAdjustReason } from "@/features/catalog/types";

export interface StockVariantInput {
  id: string;
  stockOnHand: number;
}

export interface StockChange {
  variantId: string;
  /** Positivo suma, negativo resta. Nunca 0. */
  delta: number;
  newValue: number;
  /** El stock que se veía al editar (la base lo comprueba al aplicar). */
  expected: number;
}

export type StockEditProblem = "invalid" | "too_large";

/** stock_on_hand es int4: se limita bastante por debajo para evitar desbordes y errores de tipeo. */
export const MAX_STOCK = 999_999_999;

export interface StockEditResult {
  changes: StockChange[];
  /** Variantes cuyo valor escrito no es válido. */
  problems: Record<string, StockEditProblem>;
}

/**
 * Compara lo que el admin escribió con el stock actual y devuelve los ajustes a registrar. Solo cuenta lo que CAMBIÓ:
 * un campo igual al actual (o intacto) no genera movimiento. El valor debe ser un entero de 0 o más escrito con
 * dígitos (sin signo, decimales, notación científica ni vacío).
 */
export function computeStockChanges(
  variants: readonly StockVariantInput[],
  edited: Readonly<Record<string, string>>,
): StockEditResult {
  const changes: StockChange[] = [];
  const problems: Record<string, StockEditProblem> = {};
  for (const v of variants) {
    const raw = edited[v.id];
    if (raw === undefined) continue;
    const text = raw.trim();
    if (!/^\d+$/.test(text)) {
      problems[v.id] = "invalid";
      continue;
    }
    const value = Number(text);
    if (value > MAX_STOCK) {
      problems[v.id] = "too_large";
      continue;
    }
    if (value !== v.stockOnHand)
      changes.push({
        variantId: v.id,
        delta: value - v.stockOnHand,
        newValue: value,
        expected: v.stockOnHand,
      });
  }
  return { changes, problems };
}

/**
 * "Carga inicial" y "Devolución" solo pueden SUMAR (la base lo exige); restar es un "Ajuste". Devuelve los ids que
 * incumplen la regla para el motivo elegido.
 */
export function changesBreakingReason(
  changes: readonly StockChange[],
  reason: StockAdjustReason,
): string[] {
  if (reason === "adjust") return [];
  return changes.filter((c) => c.delta < 0).map((c) => c.variantId);
}
