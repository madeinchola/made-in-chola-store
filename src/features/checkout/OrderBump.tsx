import { useQueries } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { getProductBySlug } from "@/features/catalog/catalogService";
import { productImageUrl } from "@/features/catalog/mediaUrl";
import { catalogKeys } from "@/features/catalog/queryKeys";
import { useCart } from "@/features/cart/cart-context";
import { track } from "@/features/storefront/analytics/track";
import { useProductDetail } from "@/features/storefront/product/useProductDetail";
import { t } from "@/i18n";
import { formatMoney, toDecimalString } from "@/lib/money";
import { bumpCandidates, pickBumps, type Bump } from "./bumpLogic";

/**
 * «Suma a tu pedido» (S15): hasta dos productos relacionados con lo que ya lleva, que se añaden con UN clic y sin salir del pago. Solo los
 * que no piden elegir nada (una sola variante con stock) y solo lo que hay: el servidor vuelve a revisar stock y precio al crear el
 * pedido, así que un clic nunca puede vender lo que no hay. Al añadir, el pago recalcula el total. Sin sugerencias no pinta nada.
 */
export function OrderBump({ onAdded }: { onAdded: () => void }) {
  const { lines } = useCart();
  const first = lines[0];
  const base = useProductDetail(first?.slug);
  const inBag = new Set(lines.map((line) => line.product_id));
  const candidates = bumpCandidates(base.data?.related, inBag);
  const details = useQueries({
    queries: candidates.map((product) => ({
      queryKey: catalogKeys.product(product.slug),
      queryFn: () => getProductBySlug(product.slug),
      staleTime: 30_000,
    })),
  });
  const bumps = pickBumps(
    candidates,
    details.map((d) => d.data),
  );
  if (bumps.length === 0) return null;

  return (
    <section aria-labelledby="order-bump-title" className="space-y-3 rounded-lg border p-4">
      <h2 id="order-bump-title" className="font-display text-lg font-semibold">
        {t("checkout.bump.title")}
      </h2>
      <ul className="space-y-3">
        {bumps.map((bump) => (
          <BumpRow key={bump.product.id} bump={bump} onAdded={onAdded} />
        ))}
      </ul>
    </section>
  );
}

function BumpRow({ bump, onAdded }: { bump: Bump; onAdded: () => void }) {
  const { store } = useCart();
  const [adding, setAdding] = useState(false);
  // Candado síncrono: dos clics en el mismo instante no esperan al siguiente pintado para verse.
  const addingRef = useRef(false);
  const { product } = bump;
  const price = formatMoney(product.price);

  const add = async () => {
    if (addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    try {
      await store.addOne(bump.variantId);
      track({
        name: "add_to_cart",
        quantity: 1,
        item: {
          id: product.id,
          name: product.name,
          price: Number(toDecimalString(product.price)),
          currency: product.price.currency,
        },
      });
      onAdded();
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  return (
    <li className="flex items-center gap-3">
      {product.coverPath ? (
        <img
          src={productImageUrl(product.coverPath)}
          alt=""
          width={56}
          height={78}
          loading="lazy"
          decoding="async"
          className="h-[78px] w-14 shrink-0 object-cover"
        />
      ) : (
        <div aria-hidden="true" className="h-[78px] w-14 shrink-0 bg-secondary" />
      )}
      <div className="min-w-0 flex-1">
        <Link
          to={`/producto/${product.slug}`}
          className="block truncate font-medium underline-offset-2 hover:underline"
        >
          {product.name}
        </Link>
        <p className="text-sm tabular-nums text-muted-foreground">{price}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 shrink-0"
        disabled={adding}
        aria-label={t("checkout.bump.addLabel", { name: product.name, price })}
        onClick={() => void add()}
      >
        {adding ? t("checkout.bump.adding") : t("checkout.bump.add")}
      </Button>
    </li>
  );
}
