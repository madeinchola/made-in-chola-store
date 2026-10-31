import { absoluteUrl } from "../../features/storefront/seo/canonical";
import {
  breadcrumbJsonLd,
  itemListJsonLd,
  organizationJsonLd,
  productJsonLd,
  serializeJsonLd,
  websiteJsonLd,
  type Availability,
  type JsonLd,
} from "../../features/storefront/seo/jsonld";
import { escapeHtml, excerpt } from "./escape";
import { productImageUrl, rest, rpc, type SeoDeps } from "./supabaseRest";

const FALLBACK_NAME = "Made In Chola";
const FALLBACK_DESCRIPTION =
  "Made In Chola: ropa, sombreros y accesorios hechos a mano en Bolivia. Envíos a todo el país.";

interface ProductRow {
  id: string;
  slug: string;
  name: string;
  price_bob: number;
  description?: string | null;
  model?: string | null;
  sold_out?: boolean | null;
  cover_path?: string | null;
  cover_alt?: string | null;
}

export interface SeoPage {
  status: number;
  /** Para redirecciones (301). */
  location?: string;
  html?: string;
}

interface Head {
  title: string;
  description: string;
  canonical: string;
  robots?: string;
  image?: string | null;
  type?: "website" | "product";
  jsonLd?: JsonLd[];
  siteName: string;
}

const money = (amount: number) => `Bs ${amount.toFixed(2).replace(".", ",")}`;

/** Documento HTML mínimo para bots: título, descripción, canónico, Open Graph, Twitter y JSON-LD + contenido legible. */
function document(head: Head, body: string): string {
  const title = head.title === head.siteName ? head.title : `${head.title} · ${head.siteName}`;
  const meta = [
    `<meta name="description" content="${escapeHtml(head.description)}">`,
    `<meta name="robots" content="${head.robots ?? "index,follow"}">`,
    `<link rel="canonical" href="${escapeHtml(head.canonical)}">`,
    `<meta property="og:site_name" content="${escapeHtml(head.siteName)}">`,
    `<meta property="og:locale" content="es_BO">`,
    `<meta property="og:type" content="${head.type ?? "website"}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(head.description)}">`,
    `<meta property="og:url" content="${escapeHtml(head.canonical)}">`,
    ...(head.image ? [`<meta property="og:image" content="${escapeHtml(head.image)}">`] : []),
    `<meta name="twitter:card" content="${head.image ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(head.description)}">`,
    ...(head.image ? [`<meta name="twitter:image" content="${escapeHtml(head.image)}">`] : []),
    ...(head.jsonLd ?? []).map(
      (data) => `<script type="application/ld+json">${serializeJsonLd(data)}</script>`,
    ),
  ].join("\n    ");
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    ${meta}
  </head>
  <body>
    ${body}
  </body>
</html>
`;
}

async function siteName(deps: SeoDeps): Promise<string> {
  try {
    const rows = await rest<{ value: unknown }>(
      deps,
      "public_store_settings?key=eq.business_name&select=value&limit=1",
    );
    const value = rows[0]?.value;
    return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : FALLBACK_NAME;
  } catch {
    return FALLBACK_NAME;
  }
}

const base = (deps: SeoDeps, origin: string) =>
  (deps.env.SITE_URL?.trim() || origin).replace(/\/+$/, "");

function notFound(site: string, name: string, path: string): SeoPage {
  return {
    status: 404,
    html: document(
      {
        title: "Página no encontrada",
        description: "La página que buscas no existe o fue movida.",
        canonical: absoluteUrl(site, path),
        robots: "noindex,follow",
        siteName: name,
      },
      `<main><h1>Página no encontrada</h1><p>La página que buscas no existe o fue movida.</p><p><a href="${escapeHtml(absoluteUrl(site, "/tienda"))}">Ver la tienda</a></p></main>`,
    ),
  };
}

/** Ficha de producto para bots: lo que se ve al compartir el enlace (título, descripción, imagen, precio) + `Product`. */
export async function productPage(deps: SeoDeps, origin: string, slug: string): Promise<SeoPage> {
  const site = base(deps, origin);
  const supabaseUrl = deps.env.SUPABASE_URL ?? "";
  const encoded = encodeURIComponent(slug);
  const rows = await rest<ProductRow>(
    deps,
    `public_product_detail?slug=eq.${encoded}&select=id,slug,name,price_bob,description,model,sold_out,cover_path,cover_alt&limit=1`,
  );
  const product = rows[0];
  const name = await siteName(deps);
  if (!product) {
    // Un producto renombrado conserva su enlace viejo (solo si el slug era público al renombrar).
    const redirect = await rest<{ current_slug: string }>(
      deps,
      `public_product_slug_redirects?old_slug=eq.${encoded}&select=current_slug&limit=1`,
    );
    const current = redirect[0]?.current_slug;
    if (current && current !== slug) {
      return {
        status: 301,
        location: absoluteUrl(site, `/producto/${encodeURIComponent(current)}`),
      };
    }
    return notFound(site, name, `/producto/${slug}`);
  }

  const id = encodeURIComponent(product.id);
  const [images, colors, variants] = await Promise.all([
    rest<{ path: string }>(
      deps,
      `public_product_images?product_id=eq.${id}&select=path&order=sort_order.asc&limit=8`,
    ),
    rest<{ name: string }>(
      deps,
      `public_product_colors?product_id=eq.${id}&select=name&order=sort_order.asc`,
    ),
    rest<{ stock_status: string }>(
      deps,
      `public_product_variants?product_id=eq.${id}&select=stock_status`,
    ),
  ]);
  const imageUrls = [
    ...new Set(
      [...images.map((i) => i.path), ...(product.cover_path ? [product.cover_path] : [])].map(
        (path) => productImageUrl(supabaseUrl, path),
      ),
    ),
  ];
  const statuses = variants.map((v) => v.stock_status);
  const availability: Availability = statuses.includes("in_stock")
    ? "in_stock"
    : statuses.includes("low")
      ? "low"
      : "out";
  const url = absoluteUrl(site, `/producto/${product.slug}`);
  const description = excerpt(
    product.description?.trim()
      ? product.description
      : `${product.name} de ${name}, hecho a mano en Bolivia.`,
  );

  const head: Head = {
    title: product.name,
    description,
    canonical: url,
    image: imageUrls[0] ?? null,
    type: "product",
    siteName: name,
    jsonLd: [
      productJsonLd({
        name: product.name,
        description: product.description?.trim() || null,
        url,
        images: imageUrls,
        sku: null,
        brand: name,
        price: { amount: product.price_bob.toFixed(2), currency: "BOB" },
        availability,
        color: colors.map((c) => c.name),
      }),
      breadcrumbJsonLd([
        { name: "Inicio", url: absoluteUrl(site, "/") },
        { name: "Tienda", url: absoluteUrl(site, "/tienda") },
        { name: product.name, url },
      ]),
    ],
  };
  const body = `<main>
      <h1>${escapeHtml(product.name)}</h1>
      ${imageUrls[0] ? `<img src="${escapeHtml(imageUrls[0])}" alt="${escapeHtml(product.cover_alt?.trim() || product.name)}" width="600" height="800">` : ""}
      <p>${escapeHtml(money(product.price_bob))}${availability === "out" ? " · Agotado" : ""}</p>
      ${product.description?.trim() ? `<p>${escapeHtml(product.description.trim())}</p>` : ""}
      ${colors.length > 0 ? `<p>Colores: ${escapeHtml(colors.map((c) => c.name).join(", "))}</p>` : ""}
      <p><a href="${escapeHtml(absoluteUrl(site, "/tienda"))}">Ver más en la tienda</a></p>
    </main>`;
  return { status: 200, html: document(head, body) };
}

interface ListingScope {
  categorySlug?: string;
  collectionSlug?: string;
}

/** Los 24 más nuevos del ámbito, con la MISMA función que usa la tienda (`public_list_products`): una sola lógica. */
async function firstPage(deps: SeoDeps, scope: ListingScope): Promise<ProductRow[]> {
  const result = await rpc<{ total: number; items: ProductRow[] }>(deps, "public_list_products", {
    p_category_slug: scope.categorySlug ?? null,
    p_collection_slug: scope.collectionSlug ?? null,
    p_sort: "newest",
    p_limit: 24,
    p_offset: 0,
  });
  return Array.isArray(result?.items) ? result.items : [];
}

async function listing(
  deps: SeoDeps,
  origin: string,
  input: { title: string; description: string; path: string; heading: string; scope: ListingScope },
): Promise<SeoPage> {
  const site = base(deps, origin);
  const supabaseUrl = deps.env.SUPABASE_URL ?? "";
  const name = await siteName(deps);
  const products = await firstPage(deps, input.scope);
  const url = absoluteUrl(site, input.path);
  const head: Head = {
    title: input.title,
    description: input.description,
    canonical: url,
    siteName: name,
    image: products[0]?.cover_path ? productImageUrl(supabaseUrl, products[0].cover_path) : null,
    jsonLd: [
      breadcrumbJsonLd([
        { name: "Inicio", url: absoluteUrl(site, "/") },
        ...(input.path === "/tienda"
          ? []
          : [{ name: "Tienda", url: absoluteUrl(site, "/tienda") }]),
        { name: input.heading, url },
      ]),
      itemListJsonLd(
        products.map((p) => ({
          name: p.name,
          url: absoluteUrl(site, `/producto/${p.slug}`),
          image: p.cover_path ? productImageUrl(supabaseUrl, p.cover_path) : null,
        })),
      ),
    ],
  };
  const items = products
    .map(
      (p) =>
        `<li><a href="${escapeHtml(absoluteUrl(site, `/producto/${p.slug}`))}">${escapeHtml(p.name)}</a> — ${escapeHtml(money(p.price_bob))}</li>`,
    )
    .join("\n        ");
  return {
    status: 200,
    html: document(
      head,
      `<main>\n      <h1>${escapeHtml(input.heading)}</h1>\n      <ul>\n        ${items}\n      </ul>\n    </main>`,
    ),
  };
}

export const shopPage = (deps: SeoDeps, origin: string) =>
  listing(deps, origin, {
    title: "Tienda",
    description:
      "Toda la colección de Made In Chola: ropa, sombreros, carteras y objetos hechos a mano.",
    path: "/tienda",
    heading: "Tienda",
    scope: {},
  });

export async function categoryPage(deps: SeoDeps, origin: string, slug: string): Promise<SeoPage> {
  const site = base(deps, origin);
  const encoded = encodeURIComponent(slug);
  const found = await rest<{ id: string; name: string; description: string | null }>(
    deps,
    `public_categories?slug=eq.${encoded}&select=id,name,description&limit=1`,
  );
  const category = found[0];
  if (!category) return notFound(site, await siteName(deps), `/categoria/${slug}`);
  return listing(deps, origin, {
    title: category.name,
    description: excerpt(
      category.description?.trim() ||
        `${category.name} de Made In Chola, hechos a mano en Bolivia.`,
    ),
    path: `/categoria/${slug}`,
    heading: category.name,
    // Incluye los productos de sus subcategorías (la función ya resuelve el árbol).
    scope: { categorySlug: slug },
  });
}

export async function collectionPage(
  deps: SeoDeps,
  origin: string,
  slug: string,
): Promise<SeoPage> {
  const site = base(deps, origin);
  const encoded = encodeURIComponent(slug);
  const found = await rest<{ id: string; name: string; description: string | null }>(
    deps,
    `public_collections?slug=eq.${encoded}&select=id,name,description&limit=1`,
  );
  const collection = found[0];
  if (!collection) return notFound(site, await siteName(deps), `/coleccion/${slug}`);
  return listing(deps, origin, {
    title: `Colección ${collection.name}`,
    description: excerpt(
      collection.description?.trim() || `Colección ${collection.name} de Made In Chola.`,
    ),
    path: `/coleccion/${slug}`,
    heading: `Colección ${collection.name}`,
    scope: { collectionSlug: slug },
  });
}

export async function homePage(deps: SeoDeps, origin: string): Promise<SeoPage> {
  const site = base(deps, origin);
  const name = await siteName(deps);
  const socials = await rest<{ key: string; value: unknown }>(
    deps,
    "public_store_settings?key=in.(social_instagram,social_tiktok,social_facebook,social_youtube)&select=key,value",
  ).catch(() => []);
  const sameAs = socials.flatMap((s) =>
    typeof s.value === "string" && /^https:\/\//.test(s.value) ? [s.value] : [],
  );
  const url = absoluteUrl(site, "/");
  return {
    status: 200,
    html: document(
      {
        title: name,
        description: FALLBACK_DESCRIPTION,
        canonical: url,
        siteName: name,
        jsonLd: [
          organizationJsonLd({ name, url, sameAs }),
          websiteJsonLd({
            name,
            url,
            searchUrlTemplate: `${absoluteUrl(site, "/buscar")}?q={search_term_string}`,
          }),
        ],
      },
      `<main><h1>${escapeHtml(name)}</h1><p>${escapeHtml(FALLBACK_DESCRIPTION)}</p><p><a href="${escapeHtml(absoluteUrl(site, "/tienda"))}">Ver la tienda</a></p></main>`,
    ),
  };
}
