import {
  categoryPage,
  collectionPage,
  homePage,
  productPage,
  shopPage,
  type SeoPage,
} from "./pages";
import { buildRobots, buildSitemap } from "./sitemap";
import { isSlug, SeoConfigError, type SeoDeps } from "./supabaseRest";

const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
} as const;

/**
 * La versión para bots NO se guarda en el CDN: la URL es la misma que ve una persona y un caché compartido podría
 * servirle a ella el HTML de los bots. El tráfico de bots es bajo; cada respuesta cuesta ≤ 5 lecturas pequeñas.
 */
const NO_CDN = { "Cache-Control": "private, no-store", Vary: "User-Agent" } as const;

function respond(page: SeoPage): Response {
  if (page.status === 301 && page.location) {
    return new Response(null, {
      status: 301,
      headers: { Location: page.location, ...NO_CDN, ...SECURITY },
    });
  }
  return new Response(page.html ?? "", {
    status: page.status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...NO_CDN, ...SECURITY },
  });
}

const plain = (status: number, text: string) =>
  new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_CDN, ...SECURITY },
  });

/** `/api/seo?type=product|category|collection|shop|home&slug=…` (lo invoca la rewrite de Vercel solo para bots). */
export async function handleSeo(request: Request, deps: SeoDeps): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD")
    return plain(405, "Método no permitido");
  const type = url.searchParams.get("type");
  const slug = url.searchParams.get("slug");
  const origin = url.origin;
  // Enlaces con MAYÚSCULAS (`/producto/Chaqueta-Roja`): una sola URL canónica en minúsculas, con redirección permanente.
  // `Map` y no un objeto literal: con `?type=constructor` un objeto devuelve su prototipo («function Object…»).
  const PATH = new Map([
    ["product", "producto"],
    ["category", "categoria"],
    ["collection", "coleccion"],
  ]);
  const prefix = type ? PATH.get(type) : undefined;
  if (prefix && slug && slug !== slug.toLowerCase() && isSlug(slug.toLowerCase())) {
    const base = (deps.env.SITE_URL?.trim() || origin).replace(/\/+$/, "");
    return respond({ status: 301, location: `${base}/${prefix}/${slug.toLowerCase()}` });
  }
  try {
    switch (type) {
      case "product":
        return isSlug(slug)
          ? respond(await productPage(deps, origin, slug))
          : plain(404, "No encontrado");
      case "category":
        return isSlug(slug)
          ? respond(await categoryPage(deps, origin, slug))
          : plain(404, "No encontrado");
      case "collection":
        return isSlug(slug)
          ? respond(await collectionPage(deps, origin, slug))
          : plain(404, "No encontrado");
      case "shop":
        return respond(await shopPage(deps, origin));
      case "home":
        return respond(await homePage(deps, origin));
      default:
        return plain(404, "No encontrado");
    }
  } catch (error) {
    // Sin detalles al exterior: ni mensajes de la base ni claves.
    return plain(error instanceof SeoConfigError ? 503 : 502, "Servicio no disponible");
  }
}

export async function handleSitemap(request: Request, deps: SeoDeps): Promise<Response> {
  try {
    const xml = await buildSitemap(deps, new URL(request.url).origin);
    return new Response(xml, {
      status: 200,
      // El mapa es igual para todos: sí puede cachearse en el CDN.
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        ...SECURITY,
      },
    });
  } catch {
    return plain(502, "Servicio no disponible");
  }
}

export function handleRobots(request: Request, deps: SeoDeps): Response {
  return new Response(buildRobots(deps, new URL(request.url).origin), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      ...SECURITY,
    },
  });
}
