import { renderEmailHtml } from "./layout.ts";
import {
  renderEmailParts,
  type RenderedEmail,
  renderWhatsappText,
  type RenderedWhatsapp,
  type TemplateParts,
  truncateCodePoints,
} from "./render.ts";
import type { SiteContext } from "./types.ts";

/**
 * UNA sola forma de armar un mensaje, usada por el worker que envía y por la vista previa del panel: lo que el administrador ve es,
 * por construcción, lo que recibe la clienta (mismas funciones, mismo diseño, mismos textos del pie).
 */

export interface ComposedEmail extends RenderedEmail {
  html: string;
}

function snippet(text: string): string {
  return truncateCodePoints(text.replace(/\s+/g, " ").trim(), 110);
}

export function footerNote(audience: "customer" | "admin", storeName: string): string {
  return audience === "customer"
    ? `Recibes este mensaje porque tienes un pedido en ${storeName}. Es un aviso de tu compra y no se puede desactivar.`
    : `Alerta interna de ${storeName}.`;
}

export function composeEmail(
  template: TemplateParts,
  variables: Record<string, unknown>,
  site: SiteContext,
  audience: "customer" | "admin",
): ComposedEmail {
  const parts = renderEmailParts(template, variables);
  const html = renderEmailHtml({
    storeName: site.storeName,
    preheader: snippet(parts.text),
    paragraphsHtml: parts.paragraphsHtml,
    cta: parts.cta,
    footerNote: footerNote(audience, site.storeName),
  });
  return { ...parts, html };
}

export function composeWhatsapp(
  template: Pick<TemplateParts, "body">,
  variables: Record<string, unknown>,
): RenderedWhatsapp {
  return renderWhatsappText(template, variables);
}
