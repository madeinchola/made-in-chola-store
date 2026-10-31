import { useEffect, useRef } from "react";
import type { ProductSummary } from "@/features/catalog/types";
import { track } from "@/features/storefront/analytics/track";
import { toDecimalString } from "@/lib/money";

/** Emite `view_item_list` UNA vez por cada lista distinta de productos que se muestra (no en cada render). */
export function useTrackItemList(
  listId: string,
  listName: string,
  products: readonly ProductSummary[],
) {
  const sent = useRef("");
  const key = `${listId}:${products.map((p) => p.id).join(",")}`;
  useEffect(() => {
    if (products.length === 0 || sent.current === key) return;
    sent.current = key;
    track({
      name: "view_item_list",
      listId,
      listName,
      items: products.map((p, index) => ({
        id: p.id,
        name: p.name,
        price: Number(toDecimalString(p.price)),
        currency: p.price.currency,
        position: index + 1,
      })),
    });
  }, [key, listId, listName, products]);
}
