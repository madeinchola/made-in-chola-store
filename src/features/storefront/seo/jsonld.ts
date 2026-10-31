/** Datos estructurados (schema.org) del storefront. Funciones puras: las usan la SPA y la función de borde de Vercel. */
export type JsonLd = Record<string, unknown>;

/**
 * Serializa JSON-LD para meterlo dentro de un `<script type="application/ld+json">`. Escapa `<`, `>`, `&` y los
 * separadores de línea Unicode: un nombre de producto con `</script><script>…` NO puede cerrar la etiqueta e inyectar código.
 */
export function serializeJsonLd(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const CONTEXT = "https://schema.org";

export function organizationJsonLd(input: {
  name: string;
  url: string;
  logo?: string | null;
  sameAs?: string[];
  email?: string | null;
  telephone?: string | null;
}): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "Organization",
    name: input.name,
    url: input.url,
    ...(input.logo ? { logo: input.logo } : {}),
    ...(input.sameAs && input.sameAs.length > 0 ? { sameAs: input.sameAs } : {}),
    ...(input.email ? { email: input.email } : {}),
    ...(input.telephone ? { telephone: input.telephone } : {}),
  };
}

export function websiteJsonLd(input: {
  name: string;
  url: string;
  searchUrlTemplate?: string;
}): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "WebSite",
    name: input.name,
    url: input.url,
    ...(input.searchUrlTemplate
      ? {
          potentialAction: {
            "@type": "SearchAction",
            target: { "@type": "EntryPoint", urlTemplate: input.searchUrlTemplate },
            "query-input": "required name=search_term_string",
          },
        }
      : {}),
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export type Availability = "in_stock" | "low" | "out";

const AVAILABILITY: Record<Availability, string> = {
  in_stock: `${CONTEXT}/InStock`,
  low: `${CONTEXT}/LimitedAvailability`,
  out: `${CONTEXT}/OutOfStock`,
};

/** `Product` + `Offer`. El precio va como texto con 2 decimales (schema.org lo pide así) y la moneda en ISO 4217. */
export function productJsonLd(input: {
  name: string;
  description?: string | null;
  url: string;
  images: string[];
  sku?: string | null;
  brand: string;
  price: { amount: string; currency: string };
  availability: Availability;
  color?: string[];
}): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "Product",
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    ...(input.images.length > 0 ? { image: input.images } : {}),
    ...(input.sku ? { sku: input.sku } : {}),
    ...(input.color && input.color.length > 0 ? { color: input.color.join(", ") } : {}),
    brand: { "@type": "Brand", name: input.brand },
    offers: {
      "@type": "Offer",
      url: input.url,
      price: input.price.amount,
      priceCurrency: input.price.currency,
      availability: AVAILABILITY[input.availability],
      itemCondition: `${CONTEXT}/NewCondition`,
    },
  };
}

export function itemListJsonLd(
  items: { name: string; url: string; image?: string | null }[],
): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "ItemList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: item.url,
      name: item.name,
      ...(item.image ? { image: item.image } : {}),
    })),
  };
}
