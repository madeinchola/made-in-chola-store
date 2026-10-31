import { t } from "@/i18n";
import { formatMoney, fromDecimal } from "@/lib/money";
import type { ActiveFilter } from "./filterDraft";
import type { ListingQuery } from "./listParams";

const bs = (amount: number) => formatMoney(fromDecimal(amount, "BOB"));

/** Texto visible de una ficha de filtro. */
export function filterLabel(filter: ActiveFilter, query: ListingQuery): string {
  switch (filter.kind) {
    case "color":
      return filter.value;
    case "size":
      return t("shop.listing.active.size", { label: filter.value });
    case "stock":
      return t("shop.listing.active.inStock");
    case "price": {
      const { minPrice: min, maxPrice: max } = query;
      if (min !== null && max !== null) {
        return t("shop.listing.active.range", { min: bs(min), max: bs(max) });
      }
      return min !== null
        ? t("shop.listing.active.from", { amount: bs(min) })
        : t("shop.listing.active.to", { amount: bs(max ?? 0) });
    }
  }
}
