import type { ProductSummary } from "@/features/catalog/types";
import { t } from "@/i18n";
import { absoluteUrl, canonicalUrl } from "@/features/storefront/seo/canonical";
import { breadcrumbJsonLd, itemListJsonLd } from "@/features/storefront/seo/jsonld";
import type { PageMeta } from "@/features/storefront/seo/usePageMeta";
import { PAGE_SIZE, listingSeo, type ListingQuery } from "./listParams";
import { totalPagesOf } from "./listingContext";

/** Convierte una ruta con `?pagina=N` (la que devuelve `listingSeo`) en URL absoluta canónica. */
export function pathToCanonical(siteUrl: string, pathWithQuery: string): string {
  const [path = "/", search = ""] = pathWithQuery.split("?");
  return canonicalUrl(siteUrl, path, { pagina: new URLSearchParams(search).get("pagina") });
}

export interface ListingMetaInput {
  siteUrl: string;
  /** Ruta del listado sin parámetros: `/tienda`, `/categoria/ropa`. */
  path: string;
  title: string;
  description: string;
  query: ListingQuery;
  total: number;
  products: readonly ProductSummary[];
  /** Migas desde «Inicio» hasta la página actual (la última no lleva enlace propio en la UI, pero sí en el JSON-LD). */
  breadcrumb: { name: string; path: string }[];
  imageUrl: (path: string) => string;
}

/**
 * Metadatos SEO de un listado: título (con «página N» desde la 2), canónico limpio (sin utm ni filtros), indexación
 * (los filtros y el orden NO se indexan; las páginas sí), `rel=prev/next` y JSON-LD de migas y de lista de productos.
 */
export function buildListingMeta(input: ListingMetaInput): PageMeta {
  const totalPages = totalPagesOf(input.total, PAGE_SIZE);
  const seo = listingSeo(input.path, input.query, totalPages);
  const page = Math.min(input.query.page, totalPages);
  const title = page > 1 ? `${input.title} · ${t("shop.seo.pageOf", { page })}` : input.title;
  const first = input.products[0];
  return {
    title,
    description: input.description,
    canonical: pathToCanonical(input.siteUrl, seo.canonicalPath),
    robots: seo.robots,
    prev: seo.prevPath ? pathToCanonical(input.siteUrl, seo.prevPath) : null,
    next: seo.nextPath ? pathToCanonical(input.siteUrl, seo.nextPath) : null,
    image: first?.coverPath ? input.imageUrl(first.coverPath) : null,
    jsonLd: [
      breadcrumbJsonLd(
        input.breadcrumb.map((item) => ({
          name: item.name,
          url: absoluteUrl(input.siteUrl, item.path),
        })),
      ),
      ...(input.products.length > 0
        ? [
            itemListJsonLd(
              input.products.map((product) => ({
                name: product.name,
                url: absoluteUrl(input.siteUrl, `/producto/${product.slug}`),
                image: product.coverPath ? input.imageUrl(product.coverPath) : null,
              })),
            ),
          ]
        : []),
    ],
  };
}
