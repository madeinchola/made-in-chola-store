import { ProductCard } from "@/components/store/ProductCard";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProductSummary } from "@/features/catalog/types";
import { t } from "@/i18n";

/** Rejilla del listado: 2 columnas en móvil, 3 en tableta y 4 en escritorio (como las filas del diseño). */
const gridClass = "grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-3 md:gap-x-4 lg:grid-cols-4";

interface ProductGridProps {
  products: readonly ProductSummary[];
  onPrefetch?: (slug: string) => void;
  /** Las primeras tarjetas cargan su imagen al instante (son lo primero que se ve: LCP). */
  priorityCount?: number;
}

export function ProductGrid({ products, onPrefetch, priorityCount = 4 }: ProductGridProps) {
  return (
    <ul aria-label={t("shop.listing.grid.label")} className={gridClass}>
      {products.map((product, index) => (
        <li key={product.id} className="min-w-0">
          <ProductCard
            product={product}
            headingAs="h2"
            priority={index < priorityCount}
            {...(onPrefetch ? { onPrefetch } : {})}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Esqueleto de la rejilla. Reserva el mismo alto que las tarjetas reales (baldosa 5:7 + 3 líneas de texto) para que al
 * llegar los datos la página no salte.
 */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div aria-hidden="true" className={gridClass}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="space-y-3">
          <Skeleton className="aspect-[5/7] w-full rounded-card" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}
