import { productImageUrl } from "@/features/catalog/mediaUrl";
import type { ProductDetail } from "@/features/catalog/types";
import { t } from "@/i18n";
import { toDecimalString } from "@/lib/money";
import { absoluteUrl, canonicalUrl } from "../seo/canonical";
import { breadcrumbJsonLd, productJsonLd } from "../seo/jsonld";
import type { PageMeta } from "../seo/usePageMeta";
import { imagesForColor } from "./productImages";
import { aggregateAvailability, defaultColorId } from "./variantSelection";

export const DESCRIPTION_MAX = 155;

/**
 * Descripción para buscadores: texto plano de una línea, de unas 155 letras como máximo y cortada en una palabra.
 * Cuenta puntos de código (un emoji en el límite no se parte en un sustituto suelto que saldría como «�»).
 */
export function metaDescription(text: string | null | undefined, max = DESCRIPTION_MAX): string {
  const plain = (text ?? "").replace(/\s+/g, " ").trim();
  const chars = Array.from(plain);
  if (chars.length <= max) return plain;
  const cut = chars.slice(0, max - 1).join("");
  const lastSpace = cut.lastIndexOf(" ");
  // Si la palabra cortada es larguísima (sin espacios) se corta en seco.
  const body = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[\s,;:.-]+$/, "")}…`;
}

/** Etiquetas SEO de la ficha: título, descripción, canónico limpio, Open Graph de producto y datos estructurados. */
export function buildProductSeo(input: {
  detail: ProductDetail;
  slug: string;
  siteUrl: string;
  brand: string;
}): PageMeta {
  const { detail, slug, siteUrl, brand } = input;
  const { product } = detail;
  const url = canonicalUrl(siteUrl, `/producto/${slug}`);
  const images = imagesForColor(detail.images, defaultColorId(detail)).map((i) =>
    productImageUrl(i.path),
  );
  return {
    title: product.name,
    description:
      metaDescription(product.description) ||
      t("shop.product.seo.fallbackDescription", { name: product.name }),
    canonical: url,
    type: "product",
    image: images[0] ?? null,
    jsonLd: [
      productJsonLd({
        name: product.name,
        description: metaDescription(product.description, 500) || null,
        url,
        images,
        brand,
        price: { amount: toDecimalString(product.price), currency: product.price.currency },
        availability: aggregateAvailability(detail),
        color: detail.colors.map((c) => c.name),
      }),
      breadcrumbJsonLd([
        { name: t("nav.home"), url: absoluteUrl(siteUrl, "/") },
        { name: t("shop.product.breadcrumb.shop"), url: absoluteUrl(siteUrl, "/tienda") },
        { name: product.name, url },
      ]),
    ],
  };
}
