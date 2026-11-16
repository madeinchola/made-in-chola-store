import { escapeHtml } from "./render.ts";

/**
 * Diseño del correo (S13): HTML responsive con tablas y estilos en línea (lo que sobrevive en Gmail, Outlook y Apple Mail), con
 * versión para modo oscuro. Los colores son PROVISIONALES: la identidad definitiva la entrega la diseñadora (SPRINT_19 §S13);
 * cambiarlos es tocar `BRAND` y nada más.
 */
export const BRAND = {
  background: "#f4efe9",
  card: "#ffffff",
  text: "#2b2420",
  muted: "#7a6f66",
  accent: "#8a4b2a",
  accentText: "#ffffff",
  border: "#e6ddd3",
  darkBackground: "#1d1916",
  darkCard: "#2a2420",
  darkText: "#f1e9e1",
  darkMuted: "#b3a79d",
  darkAccent: "#d9956b",
  darkAccentText: "#1d1916",
} as const;

export interface EmailLayoutInput {
  storeName: string;
  /** Texto que algunos clientes de correo muestran junto al asunto en la bandeja. */
  preheader: string;
  /** Párrafos ya escapados. */
  paragraphsHtml: string[];
  cta: { label: string; url: string } | null;
  /** Línea final: por qué recibe este mensaje. */
  footerNote: string;
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

export function renderEmailHtml(input: EmailLayoutInput): string {
  const store = escapeHtml(input.storeName);
  const paragraphs = input.paragraphsHtml
    .map(
      (html) =>
        `<p style="margin:0 0 16px 0;font-size:16px;line-height:1.55;color:${BRAND.text}" class="text">${html}</p>`,
    )
    .join("\n");
  const button = input.cta
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 8px 0">
<tr><td align="center" bgcolor="${BRAND.accent}" class="btn" style="border-radius:8px;background:${BRAND.accent}">
<a href="${escapeHtml(input.cta.url)}" target="_blank" rel="noopener" class="btn-link" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:16px;font-weight:600;line-height:1.2;color:${BRAND.accentText};text-decoration:none;border-radius:8px">${escapeHtml(input.cta.label)}</a>
</td></tr></table>`
    : "";
  return `<!doctype html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${store}</title>
<style>
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  @media (max-width:620px){.container{width:100%!important}.pad{padding:24px 20px!important}}
  @media (prefers-color-scheme:dark){
    .bg{background:${BRAND.darkBackground}!important}
    .card{background:${BRAND.darkCard}!important;border-color:${BRAND.darkCard}!important}
    .text{color:${BRAND.darkText}!important}
    .muted{color:${BRAND.darkMuted}!important}
    .btn{background:${BRAND.darkAccent}!important}
    .btn-link{color:${BRAND.darkAccentText}!important}
  }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${BRAND.background}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px">${escapeHtml(input.preheader)}&#8203;&zwnj;&#8203;&zwnj;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="bg" style="background:${BRAND.background}">
<tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" class="container" style="width:600px;max-width:600px">
<tr><td style="padding:0 4px 16px 4px;font-family:${FONT};font-size:20px;font-weight:700;letter-spacing:.02em;color:${BRAND.accent}" class="text">${store}</td></tr>
<tr><td class="card pad" style="background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:12px;padding:32px;font-family:${FONT}">
${paragraphs}
${button}
</td></tr>
<tr><td style="padding:18px 8px 0 8px;font-family:${FONT};font-size:13px;line-height:1.5;color:${BRAND.muted}" class="muted">${escapeHtml(input.footerNote)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
