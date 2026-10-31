import { useEffect } from "react";
import { serializeJsonLd, type JsonLd } from "./jsonld";

export interface PageMeta {
  /** Título de la página (se le añade « · Made In Chola» salvo que `bare`). */
  title: string;
  bare?: boolean;
  description?: string;
  /** URL absoluta canónica. */
  canonical?: string;
  robots?: "index,follow" | "noindex,follow" | "noindex,nofollow";
  /** URL absoluta de la imagen para compartir (Open Graph / Twitter). */
  image?: string | null;
  type?: "website" | "product";
  prev?: string | null;
  next?: string | null;
  jsonLd?: JsonLd[];
  siteName?: string;
}

const MARK = "data-seo";

/**
 * Una etiqueta `meta` del HTML original (`index.html`, sin `data-seo`) se reemplaza EN SU SITIO mientras dure la página
 * y se restaura al salir: así nunca hay dos `og:title` o dos `description` en el documento. Si no existe, se crea.
 */
function upsertMeta(
  attr: "name" | "property",
  key: string,
  content: string,
  restores: (() => void)[],
): Element | null {
  const original = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${key}"]:not([${MARK}])`,
  );
  if (original) {
    const previous = original.getAttribute("content");
    original.setAttribute("content", content);
    restores.push(() => {
      if (previous === null) original.removeAttribute("content");
      else original.setAttribute("content", previous);
    });
    return null;
  }
  const element = document.createElement("meta");
  element.setAttribute(attr, key);
  element.setAttribute("content", content);
  element.setAttribute(MARK, "1");
  document.head.appendChild(element);
  return element;
}

function link(rel: string, href: string): HTMLLinkElement {
  const element = document.createElement("link");
  element.rel = rel;
  element.href = href;
  element.setAttribute(MARK, "1");
  document.head.appendChild(element);
  return element;
}

/**
 * Aplica el título y las etiquetas SEO de la página y las retira al salir. Cada página llama a esta función UNA vez;
 * las etiquetas del HTML original (`index.html`) se respetan: solo se tocan las que lleven `data-seo`.
 * Devuelve la función que deshace los cambios (también la usan los tests).
 */
export function applyPageMeta(meta: PageMeta): () => void {
  const previousTitle = document.title;
  const siteName = meta.siteName ?? "Made In Chola";
  const title = meta.bare || meta.title === siteName ? meta.title : `${meta.title} · ${siteName}`;
  document.title = title;

  const added: Element[] = [];
  const restores: (() => void)[] = [];
  const meta$ = (attr: "name" | "property", key: string, content: string) => {
    const element = upsertMeta(attr, key, content, restores);
    if (element) added.push(element);
  };

  if (meta.description) meta$("name", "description", meta.description);
  meta$("name", "robots", meta.robots ?? "index,follow");
  if (meta.canonical) added.push(link("canonical", meta.canonical));
  if (meta.prev) added.push(link("prev", meta.prev));
  if (meta.next) added.push(link("next", meta.next));

  meta$("property", "og:site_name", siteName);
  meta$("property", "og:locale", "es_BO");
  meta$("property", "og:type", meta.type ?? "website");
  meta$("property", "og:title", title);
  if (meta.description) meta$("property", "og:description", meta.description);
  if (meta.canonical) meta$("property", "og:url", meta.canonical);
  if (meta.image) meta$("property", "og:image", meta.image);
  meta$("name", "twitter:card", meta.image ? "summary_large_image" : "summary");
  meta$("name", "twitter:title", title);
  if (meta.description) meta$("name", "twitter:description", meta.description);
  if (meta.image) meta$("name", "twitter:image", meta.image);

  for (const data of meta.jsonLd ?? []) {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute(MARK, "1");
    script.textContent = serializeJsonLd(data);
    document.head.appendChild(script);
    added.push(script);
  }

  return () => {
    for (const element of added) element.remove();
    for (const restore of restores) restore();
    document.title = previousTitle;
  };
}

/** Hook: aplica `meta` mientras la página está montada (se vuelve a aplicar cuando cambia su contenido). */
export function usePageMeta(meta: PageMeta | null): void {
  const key = meta ? JSON.stringify(meta) : "";
  useEffect(() => {
    if (!meta) return undefined;
    return applyPageMeta(meta);
    // `key` representa el contenido de `meta`: el objeto se crea en cada render y no sirve como dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
