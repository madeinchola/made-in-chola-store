import type { ReactNode } from "react";

/**
 * Un texto legal es TEXTO con unas pocas marcas (títulos con #, listas con - o 1., **negrita** y [enlaces](https://…)). Se arma como
 * elementos de React, nunca como HTML: no existe forma de colar una etiqueta o un script (y la base ya rechaza el HTML al guardar).
 * Los enlaces solo pueden ser https, http o mailto.
 */
export type Variables = Record<string, string>;

const VARIABLE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Reemplaza `{{razon_social}}`, `{{nit}}`… por los datos del negocio; lo que no existe se queda tal cual (se ve que falta). */
export function fillVariables(text: string, vars: Variables, missing = ""): string {
  return text.replace(VARIABLE, (whole, name: string) => {
    if (!Object.hasOwn(vars, name)) return whole;
    const value = vars[name] ?? "";
    return value.trim() === "" ? missing : value;
  });
}

/** Los nombres de variable que el texto usa (sin repetir, en el orden en que aparecen). */
export function usedVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VARIABLE)].map((m) => m[1]!))];
}

/** Las variables que el texto usa y que el negocio no tiene definidas (para avisar al administrador). */
export function missingVariables(text: string, vars: Variables): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(VARIABLE)) {
    const name = m[1]!;
    if (!Object.hasOwn(vars, name) || (vars[name] ?? "").trim() === "") found.add(name);
  }
  return [...found];
}

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

/** Negrita y enlaces dentro de una línea. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(re)) {
    const index = m.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    if (m[1] !== undefined) {
      out.push(<strong key={`${keyPrefix}-b${n++}`}>{m[1]}</strong>);
    } else if (m[2] !== undefined && m[3] !== undefined) {
      out.push(
        SAFE_LINK.test(m[3]) ? (
          <a
            key={`${keyPrefix}-a${n++}`}
            href={m[3]}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {m[2]}
          </a>
        ) : (
          m[0]
        ),
      );
    }
    last = index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { type: "h"; level: 1 | 2 | 3; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "hr" };

export function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: "p", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: list.ordered ? "ol" : "ul", items: list.items });
    list = null;
  };
  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.+)$/.exec(line);
    if (line === "") {
      flushParagraph();
      flushList();
    } else if (/^-{3,}$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "hr" });
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "h", level: heading[1]!.length as 1 | 2 | 3, text: heading[2]! });
    } else if (bullet || numbered) {
      flushParagraph();
      const ordered = numbered !== null;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** El texto como elementos. Los títulos empiezan en <h2> (el <h1> es el de la página). */
export function renderLegal(body: string, vars: Variables, missing = ""): ReactNode[] {
  return parseBlocks(fillVariables(body, vars, missing)).map((block, i) => {
    const key = `b${i}`;
    switch (block.type) {
      case "h": {
        const Tag = `h${Math.min(block.level + 1, 4)}` as "h2" | "h3" | "h4";
        const size = block.level === 1 ? "text-xl" : block.level === 2 ? "text-lg" : "text-base";
        return (
          <Tag key={key} className={`mt-8 font-display font-semibold first:mt-0 ${size}`}>
            {inline(block.text, key)}
          </Tag>
        );
      }
      case "p":
        return (
          <p key={key} className="mt-3 leading-relaxed">
            {inline(block.text, key)}
          </p>
        );
      case "ul":
        return (
          <ul key={key} className="mt-3 list-disc space-y-1 pl-6">
            {block.items.map((item, j) => (
              <li key={`${key}-${j}`}>{inline(item, `${key}-${j}`)}</li>
            ))}
          </ul>
        );
      case "ol":
        return (
          <ol key={key} className="mt-3 list-decimal space-y-1 pl-6">
            {block.items.map((item, j) => (
              <li key={`${key}-${j}`}>{inline(item, `${key}-${j}`)}</li>
            ))}
          </ol>
        );
      case "hr":
        return <hr key={key} className="my-6 border-border" />;
    }
  });
}
