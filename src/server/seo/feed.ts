import { absoluteUrl } from "../../features/storefront/seo/canonical";
import { escapeXml } from "./escape";
import { productImageUrl, rest, type SeoDeps } from "./supabaseRest";

/**
 * Feeds de catálogo para Google Merchant Center y el catálogo de Meta (Sprint 15): RSS 2.0 con el espacio de nombres `g:` (los dos lo
 * aceptan). Un `<item>` por VARIANTE (color y talla): `g:id` es el identificador de la variante y `g:item_group_id` el del producto, que
 * es el que lleva el Pixel (`content_ids`, tipo «product_group»). Solo lee las vistas PÚBLICAS: nada oculto, archivado ni con costo.
 * Precio en bolivianos (la moneda base); la disponibilidad no revela cantidades («pocas unidades» sigue siendo «en stock»).
 */
export type FeedTarget = "google" | "meta";

const PAGE = 1000;
const MAX_ROWS = 50_000;
const FALLBACK_BRAND = "Made In Chola";

interface Product {
  id: string;
  slug: string;
  name: string;
  price_bob: number;
  description: string | null;
  cover_path: string | null;
}
interface Variant {
  id: string;
  product_id: string;
  color_id: string | null;
  size_id: string | null;
  stock_status: string;
}

async function all<T>(deps: SeoDeps, path: string): Promise<T[]> {
  const sep = path.includes("?") ? "&" : "?";
  const rows: T[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const page = await rest<T>(deps, `${path}${sep}limit=${PAGE}&offset=${offset}`);
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

/** Texto seguro para XML: sin caracteres de control (un XML con ellos se rechaza entero) y con un tope de largo. */
export function feedText(value: string | null | undefined, max: number): string {
  // Los caracteres de control (`\p{Cc}`) pasan a espacio y los espacios seguidos se juntan (también cubre tabuladores y saltos de línea).
  const clean = (value ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return escapeXml(clean.length > max ? `${clean.slice(0, max - 1)}…` : clean);
}

const tag = (name: string, value: string) => `      <${name}>${value}</${name}>`;

export interface FeedItemInput {
  product: Product;
  variant: Variant;
  color: string | null;
  size: string | null;
  imageUrl: string | null;
  category: string | null;
  brand: string;
  site: string;
  target: FeedTarget;
}

/** Un `<item>`, o `null` si le falta algo que Google y Meta exigen (enlace, imagen, precio): mejor omitirlo que romper el feed. */
export function feedItem(input: FeedItemInput): string | null {
  const { product, variant, color, size, imageUrl, category, brand, site, target } = input;
  if (!imageUrl || !Number.isFinite(product.price_bob) || product.price_bob <= 0) return null;
  const title = [product.name, color, size].filter(Boolean).join(" · ");
  const description = product.description?.trim()
    ? product.description
    : `${product.name} de ${brand}, hecho a mano en Bolivia.`;
  const lines = [
    tag("g:id", escapeXml(variant.id)),
    tag("g:item_group_id", escapeXml(product.id)),
    tag("g:title", feedText(title, 150)),
    tag("g:description", feedText(description, 5000)),
    tag("g:link", escapeXml(absoluteUrl(site, `/producto/${encodeURIComponent(product.slug)}`))),
    tag("g:image_link", escapeXml(imageUrl)),
    tag("g:availability", variant.stock_status === "out" ? "out of stock" : "in stock"),
    tag("g:price", `${product.price_bob.toFixed(2)} BOB`),
    tag("g:condition", "new"),
    tag("g:brand", feedText(brand, 70)),
  ];
  if (color) lines.push(tag("g:color", feedText(color, 100)));
  if (size) lines.push(tag("g:size", feedText(size, 100)));
  if (category) lines.push(tag("g:product_type", feedText(category, 750)));
  // Hecho a mano: no hay código de barras. Google exige decirlo; Meta no lo usa.
  if (target === "google") lines.push(tag("g:identifier_exists", "no"));
  return `    <item>\n${lines.join("\n")}\n    </item>`;
}

export async function buildFeed(
  deps: SeoDeps,
  origin: string,
  target: FeedTarget,
): Promise<string> {
  const site = (deps.env.SITE_URL?.trim() || origin).replace(/\/+$/, "");
  const supabaseUrl = deps.env.SUPABASE_URL ?? "";
  const [products, variants, colors, sizes, images, productCategories, categories, brandRows] =
    await Promise.all([
      all<Product>(deps, "public_products?select=id,slug,name,price_bob,cover_path&order=slug.asc"),
      all<Variant>(
        deps,
        "public_product_variants?select=id,product_id,color_id,size_id,stock_status&order=id.asc",
      ),
      all<{ id: string; name: string }>(deps, "public_product_colors?select=id,name&order=id.asc"),
      all<{ id: string; label: string }>(deps, "public_product_sizes?select=id,label&order=id.asc"),
      all<{ product_id: string; color_id: string | null; path: string }>(
        deps,
        "public_product_images?select=product_id,color_id,path&order=sort_order.asc,id.asc",
      ),
      all<{ product_id: string; category_id: string }>(
        deps,
        "public_product_categories?select=product_id,category_id&order=product_id.asc,category_id.asc",
      ),
      all<{ id: string; name: string }>(deps, "public_categories?select=id,name&order=id.asc"),
      rest<{ value: unknown }>(
        deps,
        "public_store_settings?key=eq.business_name&select=value&limit=1",
      ),
    ]);
  const description = await all<{ id: string; description: string | null }>(
    deps,
    "public_product_detail?select=id,description&order=id.asc",
  );
  const brandValue = brandRows[0]?.value;
  const brand =
    typeof brandValue === "string" && brandValue.trim() ? brandValue.trim() : FALLBACK_BRAND;

  const colorName = new Map(colors.map((c) => [c.id, c.name]));
  const sizeLabel = new Map(sizes.map((s) => [s.id, s.label]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const descriptionOf = new Map(description.map((d) => [d.id, d.description]));
  const firstCategory = new Map<string, string>();
  for (const row of productCategories) {
    const name = categoryName.get(row.category_id);
    if (name && !firstCategory.has(row.product_id)) firstCategory.set(row.product_id, name);
  }
  // La imagen de la variante es la de su color; si el color no tiene, la general del producto (sin color) o la portada.
  const imagesOf = new Map<string, { color: string | null; path: string }[]>();
  for (const image of images) {
    const list = imagesOf.get(image.product_id) ?? [];
    list.push({ color: image.color_id, path: image.path });
    imagesOf.set(image.product_id, list);
  }
  const byProduct = new Map(
    products.map((p) => [p.id, { ...p, description: descriptionOf.get(p.id) ?? null }]),
  );

  const items: string[] = [];
  for (const variant of variants) {
    const product = byProduct.get(variant.product_id);
    if (!product) continue;
    const list = imagesOf.get(product.id) ?? [];
    const path =
      list.find((i) => i.color !== null && i.color === variant.color_id)?.path ??
      list.find((i) => i.color === null)?.path ??
      product.cover_path ??
      list[0]?.path ??
      null;
    const item = feedItem({
      product,
      variant,
      color: variant.color_id ? (colorName.get(variant.color_id) ?? null) : null,
      size: variant.size_id ? (sizeLabel.get(variant.size_id) ?? null) : null,
      imageUrl: path ? productImageUrl(supabaseUrl, path) : null,
      category: firstCategory.get(product.id) ?? null,
      brand,
      site,
      target,
    });
    if (item) items.push(item);
    if (items.length >= MAX_ROWS) break;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${feedText(brand, 150)}</title>
    <link>${escapeXml(site)}</link>
    <description>${feedText(`Catálogo de ${brand}`, 500)}</description>
${items.join("\n")}
  </channel>
</rss>
`;
}
