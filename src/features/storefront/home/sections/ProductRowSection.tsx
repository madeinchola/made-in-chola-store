import { ProductRow } from "@/components/store/ProductRow";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategoryTree, useCollections } from "@/features/catalog/hooks";
import type { HomeSection } from "@/features/catalog/types";
import { usePrefetchProduct } from "@/features/storefront/hooks";
import { t } from "@/i18n";
import { safeLink } from "@/components/layout/safeLink";
import { cleanText, fallbackViewAllPath, flattenCategories } from "../homeSections";
import { gutterX } from "../homeStyles";
import { useSectionProducts } from "../useHomeProducts";
import { useTrackItemList } from "../useTrackItemList";

/** Fila de productos de la portada («Our Most Popular Items», «Sombreros»). Sin productos no se pinta. */
export function ProductRowSection({ section }: { section: HomeSection }) {
  const { products, isPending, isError } = useSectionProducts(section);
  const tree = useCategoryTree();
  const collections = useCollections();
  const prefetch = usePrefetchProduct();
  const title = cleanText(section.title) ?? t("shop.home.productsFallbackTitle");
  useTrackItemList(section.id, title, products);

  if (isPending) {
    // Reserva el sitio de la fila mientras llega: la página no salta cuando aparecen las tarjetas.
    return (
      <section aria-busy="true" className={`${gutterX} pb-12 pt-16 lg:pb-14 lg:pt-[4.25rem]`}>
        <Skeleton className="h-8 w-56" />
        <div className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {[0, 1, 2, 3].map((n) => (
            <Skeleton key={n} className="aspect-[5/7] w-full" />
          ))}
        </div>
      </section>
    );
  }
  if (isError || products.length === 0) return null;

  const explicit = safeLink(section.ctaUrl);
  const fallback = fallbackViewAllPath(
    section,
    tree.data ? flattenCategories(tree.data) : undefined,
    collections.data,
  );
  const label = cleanText(section.ctaLabel) ?? t("shop.home.viewAll");
  const viewAll = explicit
    ? {
        to: explicit.kind === "internal" ? explicit.to : explicit.href,
        label,
        external: explicit.kind === "external",
      }
    : fallback
      ? { to: fallback, label }
      : undefined;

  return (
    <div className={`${gutterX} pb-12 pt-16 lg:pb-14 lg:pt-[4.25rem]`}>
      <ProductRow
        title={title}
        products={products}
        onPrefetch={prefetch}
        {...(viewAll ? { viewAll } : {})}
      />
    </div>
  );
}
