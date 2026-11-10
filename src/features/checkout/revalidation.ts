import { formatCartMoney } from "@/features/cart/format";
import { t } from "@/i18n";
import type { CheckoutLine, CreateResponse } from "./types";

export type Revalidation = Extract<CreateResponse, { outcome: "changed" | "unavailable" }>;

/** Una frase por cada línea con problema, con lo que el servidor dijo (cuánto queda, a cuánto subió). */
export function lineProblems(
  lines: readonly CheckoutLine[] | undefined,
  currency: string,
): string[] {
  return (lines ?? []).flatMap((line) => {
    if (line.status === "out_of_stock")
      return [t("checkout.revalidate.line.out_of_stock", { name: line.name })];
    if (line.status === "unavailable")
      return [t("checkout.revalidate.line.unavailable", { name: line.name })];
    if (line.status === "low_stock") {
      return [t("checkout.revalidate.line.low_stock", { name: line.name, n: line.available })];
    }
    if (line.price_notice === "expired_raised") {
      return [
        t("checkout.revalidate.line.expired_raised", {
          name: line.name,
          price: formatCartMoney(line.unit_price, currency),
        }),
      ];
    }
    return [];
  });
}
