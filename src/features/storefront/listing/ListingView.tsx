import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SlidersHorizontal } from "lucide-react";
import { storeRoutes } from "@/components/layout/storeRoutes";
import { EmptyState } from "@/components/store/EmptyState";
import { ErrorState } from "@/components/store/ErrorState";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { productImageUrl } from "@/features/catalog/mediaUrl";
import { track } from "@/features/storefront/analytics/track";
import { useListing, useListingFacets, usePrefetchProduct } from "@/features/storefront/hooks";
import { siteUrl } from "@/features/storefront/seo/siteUrl";
import { usePageMeta } from "@/features/storefront/seo/usePageMeta";
import type { ListingScope } from "@/features/storefront/types";
import { t } from "@/i18n";
import { prefersReducedMotion } from "@/lib/motion";
import { toDecimalString } from "@/lib/money";
import { ActiveFilters } from "./ActiveFilters";
import { ExploreLinks } from "./ExploreLinks";
import { FilterPanel } from "./FilterPanel";
import { ProductGrid, ProductGridSkeleton } from "./ProductGrid";
import { withoutFilter, withoutFilters, mergeListingParams } from "./filterDraft";
import { buildListingMeta } from "./listingMeta";
import { totalPagesOf } from "./listingContext";
import {
  PAGE_SIZE,
  SORT_OPTIONS,
  activeFilterCount,
  isFiltered,
  toSearchParams,
  withChange,
} from "./listParams";
import { useListingQuery } from "./useListingQuery";

export interface ListingViewProps {
  scope: ListingScope;
  /** Ruta del listado sin parámetros (`/tienda`, `/categoria/ropa`). */
  path: string;
  /** Identificador estable de la lista para la analítica. */
  listId: string;
  title: string;
  description?: string | null;
  /** Migas intermedias entre «Inicio» y la página actual (p. ej. «Tienda» y las categorías padre). */
  trail: { name: string; path: string }[];
  /** Título y descripción para buscadores y redes (lo que ve quien comparte el enlace). */
  metaTitle: string;
  metaDescription: string;
}

/**
 * Listado de productos: cabecera con migas, título y total; barra con filtros y orden; fichas de filtros activos;
 * rejilla; paginación. El estado (filtros, orden, página) vive en la URL. PROVISIONAL: sin diseño de listado en los
 * PDF; estilo de los PDF (serif, mayúsculas con espaciado, baldosas casi rectas).
 */
export function ListingView({
  scope,
  path,
  listId,
  title,
  description,
  trail,
  metaTitle,
  metaDescription,
}: ListingViewProps) {
  const { params, query, update } = useListingQuery();
  const listing = useListing(scope, query);
  const facets = useListingFacets(scope);
  const prefetch = usePrefetchProduct();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const shownPage = useRef(query.page);

  const data = listing.data;
  const settled = data !== undefined && !listing.isPlaceholderData;
  const total = data?.total ?? 0;
  const totalPages = totalPagesOf(total);
  const filtered = isFiltered(query);

  // Una página pasada del final (URL manipulada o filtros que acortaron la lista) salta a la última real.
  useEffect(() => {
    if (settled && data.items.length === 0 && data.total > 0 && query.page > 1) {
      update({ ...query, page: totalPages }, { replace: true });
    }
  }, [settled, data, query, totalPages, update]);

  // Al cambiar de página: sube al inicio de la lista y el foco va al título (lector de pantalla y teclado).
  useEffect(() => {
    // Solo si la página CAMBIÓ (comparar con la anterior, no con «es la primera vez»: en desarrollo React ejecuta los
    // efectos dos veces al montar y la segunda pasada robaría el foco y haría scroll sin que nadie pagine).
    if (shownPage.current === query.page) return;
    shownPage.current = query.page;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({
      block: "start",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [query.page]);

  // Analítica: una vez por cada resultado que llega (no con los datos «de relleno» de la página anterior).
  useEffect(() => {
    if (!settled || data.items.length === 0) return;
    track({
      name: "view_item_list",
      listId,
      listName: title,
      items: data.items.map((product, index) => ({
        id: product.id,
        name: product.name,
        price: Number(toDecimalString(product.price)),
        currency: product.price.currency,
        position: (query.page - 1) * PAGE_SIZE + index + 1,
      })),
    });
    // Solo cuando cambia el resultado: `query`, `title` y `listId` ya están reflejados en `data`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, settled]);

  const meta = useMemo(
    () =>
      settled || listing.isError
        ? buildListingMeta({
            siteUrl: siteUrl(),
            path,
            title: metaTitle,
            description: metaDescription,
            query,
            total,
            products: data?.items ?? [],
            breadcrumb: [{ name: t("nav.home"), path: "/" }, ...trail, { name: title, path }],
            imageUrl: productImageUrl,
          })
        : null,
    [settled, listing.isError, path, metaTitle, metaDescription, query, total, data, trail, title],
  );
  usePageMeta(meta);

  const filterCount = activeFilterCount(query);
  const hrefFor = (page: number) =>
    `${path}?${mergeListingParams(params, toSearchParams({ ...query, page })).toString()}`.replace(
      /\?$/,
      "",
    );

  return (
    <div className="container space-y-6 py-8 lg:py-12">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={storeRoutes.home}>{t("nav.home")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          {trail.map((crumb) => (
            <Fragment key={crumb.path}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to={crumb.path}>{crumb.name}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
            </Fragment>
          ))}
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <header className="space-y-3">
        <h1
          ref={heading}
          tabIndex={-1}
          className="font-display text-display-lg focus:outline-none focus-visible:ring-0"
        >
          {title}
        </h1>
        {description && (
          <p className="max-w-prose whitespace-pre-line text-muted-foreground">{description}</p>
        )}
      </header>

      <div
        role="group"
        aria-label={t("shop.listing.toolbar.label")}
        className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3"
      >
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button type="button" variant="outline" caps>
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              {filterCount > 0
                ? t("shop.listing.filters.openWithCount", { count: filterCount })
                : t("shop.listing.filters.open")}
            </Button>
          </SheetTrigger>
          <SheetContent side="right" bodyClassName="flex flex-col gap-6 p-6">
            <SheetHeader className="space-y-1.5 pr-8">
              <SheetTitle>{t("shop.listing.filters.title")}</SheetTitle>
              <SheetDescription className="sr-only">
                {t("shop.listing.filters.description")}
              </SheetDescription>
            </SheetHeader>
            <FilterPanel
              query={query}
              facets={{
                data: facets.data,
                isPending: facets.isPending,
                isError: facets.isError,
                refetch: () => void facets.refetch(),
              }}
              onApply={(next) => {
                setFiltersOpen(false);
                update(next);
              }}
            />
          </SheetContent>
        </Sheet>

        <p
          role="status"
          aria-live="polite"
          className="order-last w-full text-sm text-muted-foreground sm:order-none sm:w-auto"
        >
          {data
            ? total === 1
              ? t("shop.listing.count.one")
              : t("shop.listing.count.many", { count: total })
            : ""}
        </p>

        <label className="flex items-center gap-2 text-sm">
          <span className="eyebrow text-muted-foreground">{t("shop.listing.sort.label")}</span>
          <Select
            value={query.sort}
            onChange={(event) => {
              const sort = SORT_OPTIONS.find((option) => option === event.target.value);
              if (sort) update(withChange(query, { sort }));
            }}
            className="w-auto min-w-44"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t(`shop.listing.sort.${option}`)}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <ActiveFilters
        query={query}
        onRemove={(filter) => update(withoutFilter(query, filter))}
        onClearAll={() => update(withoutFilters(query))}
      />

      <div aria-busy={listing.isFetching} className="min-h-[24rem]">
        {listing.isPending ? (
          <ProductGridSkeleton />
        ) : listing.isError && !data ? (
          <ErrorState
            title={t("shop.listing.error.title")}
            description={t("shop.listing.error.body")}
            onRetry={() => void listing.refetch()}
          />
        ) : data && data.items.length === 0 && data.total > 0 ? (
          // Página fuera de rango: el efecto de arriba ya está saltando a la última; mientras tanto, esqueleto.
          <ProductGridSkeleton />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            title={
              filtered ? t("shop.listing.empty.filteredTitle") : t("shop.listing.empty.emptyTitle")
            }
            description={
              filtered ? t("shop.listing.empty.filteredBody") : t("shop.listing.empty.emptyBody")
            }
            action={
              filtered ? (
                <Button
                  type="button"
                  variant="outline"
                  caps
                  onClick={() => update(withoutFilters(query))}
                >
                  {t("shop.listing.empty.clearFilters")}
                </Button>
              ) : undefined
            }
          />
        ) : data ? (
          <div
            className={
              listing.isPlaceholderData ? "opacity-60 transition-opacity duration-fast" : ""
            }
          >
            <p className="sr-only" role="status">
              {listing.isPlaceholderData ? t("shop.listing.grid.updating") : ""}
            </p>
            <ProductGrid products={data.items} onPrefetch={prefetch} />
          </div>
        ) : null}
        {data && data.items.length === 0 && <ExploreLinks />}
      </div>

      <Pagination
        page={query.page}
        totalPages={totalPages}
        getHref={hrefFor}
        onPageChange={(page) => update({ ...query, page })}
        className="pt-4"
      />
    </div>
  );
}
