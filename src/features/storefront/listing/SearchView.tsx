import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ExploreLinks } from "./ExploreLinks";
import { ProductGrid, ProductGridSkeleton } from "./ProductGrid";
import { EmptyState } from "@/components/store/EmptyState";
import { ErrorState } from "@/components/store/ErrorState";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useProductSearch } from "@/features/catalog/hooks";
import { track } from "@/features/storefront/analytics/track";
import { usePrefetchProduct } from "@/features/storefront/hooks";
import { canonicalUrl } from "@/features/storefront/seo/canonical";
import { siteUrl } from "@/features/storefront/seo/siteUrl";
import { usePageMeta } from "@/features/storefront/seo/usePageMeta";
import { t } from "@/i18n";
import { SEARCH_LIMIT, isSearchable, normalizeSearchQuery } from "./searchQuery";

/**
 * Página de resultados `/buscar?q=`. La consulta vive en la URL (se puede compartir y el botón «atrás» funciona); se
 * sanea (espacios, 80 caracteres) y con menos de 2 letras no se consulta. Sin `q`, invita a buscar. No se indexa.
 * PROVISIONAL: sin diseño de búsqueda en los PDF.
 */
export function SearchView() {
  const [params, setParams] = useSearchParams();
  const q = normalizeSearchQuery(params.get("q"));
  const searchable = isSearchable(q);
  const [draft, setDraft] = useState(q);
  const [submitError, setSubmitError] = useState(false);
  const search = useProductSearch(q, SEARCH_LIMIT);
  const prefetch = usePrefetchProduct();

  // Atrás/adelante cambian `q` desde fuera: el campo los sigue.
  useEffect(() => {
    setDraft(q);
    setSubmitError(false);
  }, [q]);

  const items = search.data ?? [];
  useEffect(() => {
    if (searchable && search.data) track({ name: "search", query: q, results: search.data.length });
    // Una vez por cada resultado que llega.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.data]);

  usePageMeta({
    title: searchable ? t("shop.seo.searchTitle", { query: q }) : t("shop.seo.searchEmptyTitle"),
    description: t("shop.seo.siteDescription"),
    canonical: canonicalUrl(siteUrl(), "/buscar"),
    robots: "noindex,follow",
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = normalizeSearchQuery(draft);
    if (!isSearchable(next)) {
      setSubmitError(true);
      return;
    }
    setSubmitError(false);
    setDraft(next);
    if (next === q) return;
    const out = new URLSearchParams(params);
    out.set("q", next);
    setParams(out);
  }

  const tooShort = submitError || (q !== "" && !searchable);

  return (
    <div className="container space-y-8 py-8 lg:py-12">
      <header className="space-y-4">
        <h1 className="font-display text-display-lg">{t("shop.listing.search.title")}</h1>
        <form onSubmit={submit} noValidate className="flex max-w-2xl items-start gap-2">
          <div className="flex-1">
            <Field
              label={t("shop.listing.search.label")}
              error={tooShort ? t("shop.listing.search.tooShort") : undefined}
            >
              <Input
                type="search"
                name="q"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                autoComplete="off"
                maxLength={200}
              />
            </Field>
          </div>
          <Button type="submit" caps size="lg" className="mt-[1.625rem]">
            {t("shop.listing.search.submit")}
          </Button>
        </form>
      </header>

      <div aria-busy={searchable && search.isFetching} className="min-h-[18rem]">
        {!searchable ? (
          <EmptyState
            title={t("shop.listing.search.inviteTitle")}
            description={t("shop.listing.search.inviteBody")}
            action={<ExploreLinks />}
          />
        ) : search.isPending ? (
          <ProductGridSkeleton />
        ) : search.isError ? (
          <ErrorState
            title={t("shop.listing.search.errorTitle")}
            description={t("shop.listing.error.body")}
            onRetry={() => void search.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={t("shop.listing.search.noResultsTitle", { query: q })}
            description={t("shop.listing.search.noResultsBody")}
            action={<ExploreLinks />}
          />
        ) : (
          <div className="space-y-4">
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {items.length === 1
                ? t("shop.listing.search.resultsOne", { query: q })
                : t("shop.listing.search.resultsMany", { count: items.length, query: q })}
            </p>
            <ProductGrid products={items} onPrefetch={prefetch} />
            {items.length >= SEARCH_LIMIT && (
              <p className="text-sm text-muted-foreground">
                {t("shop.listing.search.topResults", { count: SEARCH_LIMIT })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
