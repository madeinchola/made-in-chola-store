import { ProductCard } from "@/components/store/ProductCard";
import { usePrefetchProduct } from "@/features/storefront/hooks";
import { useProductDetail } from "@/features/storefront/product/useProductDetail";
import { t } from "@/i18n";
import { useCart } from "./cart-context";

/** Cuántas sugerencias como máximo. */
export const MAX_SUGGESTIONS = 4;

/**
 * «Completa tu look»: los relacionados de la ficha del producto de la PRIMERA línea (la misma consulta y caché que la
 * ficha), sin lo que ya está en la bolsa ni lo agotado, máximo 4, con las tarjetas del listado. Si no hay nada que
 * sugerir (sin líneas, cargando, error o sin relacionados) no se pinta la sección.
 */
export function CartSuggestions() {
  const { lines } = useCart();
  const prefetch = usePrefetchProduct();
  const first = lines[0];
  const detail = useProductDetail(first?.slug);

  const inBag = new Set(lines.map((line) => line.product_id));
  const suggestions = (detail.data?.related ?? [])
    .filter((product) => !inBag.has(product.id) && !product.soldOut)
    .slice(0, MAX_SUGGESTIONS);
  if (suggestions.length === 0) return null;

  return (
    <section aria-labelledby="cart-suggestions-title" className="mt-16 space-y-5">
      <h2 id="cart-suggestions-title" className="font-display text-display-md">
        {t("cart.suggestions.title")}
      </h2>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-4 md:gap-x-4">
        {suggestions.map((product) => (
          <li key={product.id} className="min-w-0">
            <ProductCard product={product} headingAs="h3" onPrefetch={prefetch} />
          </li>
        ))}
      </ul>
    </section>
  );
}
