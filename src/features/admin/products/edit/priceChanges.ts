import { t } from "@/i18n";
import { parseAmount } from "../../lib/amount";
import type { PriceChange } from "../api";
import { amountErrorMessage } from "../productSchema";

export interface PriceRowInfo {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
}

/** Cambios de precio a aplicar y errores por moneda. Función pura (probada): compara lo escrito con lo guardado. */
export function computePriceChanges(
  rows: readonly PriceRowInfo[],
  saved: Readonly<Record<string, string>>,
  edited: Readonly<Record<string, string>>,
  options: { published: boolean },
): { changes: PriceChange[]; errors: Record<string, string> } {
  const changes: PriceChange[] = [];
  const errors: Record<string, string> = {};
  for (const row of rows) {
    const text = (edited[row.code] ?? saved[row.code] ?? "").trim();
    const before = (saved[row.code] ?? "").trim();
    if (text === "") {
      if (before === "") continue;
      if (row.code === "BOB" && options.published) {
        errors[row.code] = t("admin.products.prices.cannotRemoveBase");
        continue;
      }
      changes.push({ currency: row.code, amount: null });
      continue;
    }
    const parsed = parseAmount(text, { decimals: row.decimals });
    if (!parsed.ok) {
      errors[row.code] = amountErrorMessage(parsed.problem, row.decimals);
      continue;
    }
    if (parsed.value !== before) changes.push({ currency: row.code, amount: parsed.value });
  }
  return { changes, errors };
}
