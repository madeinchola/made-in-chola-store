import { absoluteUrl } from "../../features/storefront/seo/canonical";
import { escapeXml } from "./escape";
import { LEGAL_PATHS, type LegalKind } from "../../features/legal/types";
import { rest, rpc, type SeoDeps } from "./supabaseRest";

const PAGE = 1000;
const MAX_URLS = 50_000;

async function allSlugs(deps: SeoDeps, table: string): Promise<string[]> {
  const slugs: string[] = [];
  for (let offset = 0; offset < MAX_URLS; offset += PAGE) {
    const rows = await rest<{ slug: string | null }>(
      deps,
      `${table}?select=slug&order=slug.asc&limit=${PAGE}&offset=${offset}`,
    );
    for (const row of rows) if (row.slug) slugs.push(row.slug);
    if (rows.length < PAGE) break;
  }
  return slugs;
}

/** Las páginas legales que YA tienen una versión vigente (una sin publicar no se indexa: la página dice «todavía no está publicado»). */
async function publishedLegalPaths(deps: SeoDeps): Promise<string[]> {
  try {
    const index = await rpc<{ kind: string; version: number | null }[]>(
      deps,
      "public_legal_index",
      {},
    );
    return (Array.isArray(index) ? index : [])
      .filter((doc) => doc.version !== null && doc.kind in LEGAL_PATHS)
      .map((doc) => LEGAL_PATHS[doc.kind as LegalKind]);
  } catch {
    // Si los textos legales no se pueden leer, el mapa sale igual con lo demás.
    return [];
  }
}

/** `sitemap.xml`: portada, tienda, categorías, colecciones y productos VISIBLES (las vistas públicas ya excluyen lo oculto) y los textos legales publicados. */
export async function buildSitemap(deps: SeoDeps, origin: string): Promise<string> {
  const site = (deps.env.SITE_URL?.trim() || origin).replace(/\/+$/, "");
  const [products, categories, collections, legal] = await Promise.all([
    allSlugs(deps, "public_products"),
    allSlugs(deps, "public_categories"),
    allSlugs(deps, "public_collections"),
    publishedLegalPaths(deps),
  ]);
  const paths = [
    "/",
    "/tienda",
    ...categories.map((s) => `/categoria/${encodeURIComponent(s)}`),
    ...collections.map((s) => `/coleccion/${encodeURIComponent(s)}`),
    ...products.map((s) => `/producto/${encodeURIComponent(s)}`),
    ...legal,
  ].slice(0, MAX_URLS);
  const urls = paths
    .map((p) => `  <url><loc>${escapeXml(absoluteUrl(site, p))}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** `robots.txt`: todo abierto salvo lo privado y las búsquedas internas; indica dónde está el mapa del sitio. */
export function buildRobots(deps: SeoDeps, origin: string): string {
  const site = (deps.env.SITE_URL?.trim() || origin).replace(/\/+$/, "");
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /cuenta",
    "Disallow: /login",
    "Disallow: /registro",
    "Disallow: /recuperar",
    "Disallow: /restablecer",
    "Disallow: /carrito",
    "Disallow: /checkout",
    "Disallow: /pedido",
    "Disallow: /buscar",
    "",
    `Sitemap: ${site}/sitemap.xml`,
    "",
  ].join("\n");
}
