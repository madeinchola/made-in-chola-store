import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { t } from "@/i18n";

// El index.html REAL es lo que reciben los bots que piden «/» (Vercel sirve el archivo antes que la regla de reescritura
// de la portada): sus textos deben seguir siendo los de la tienda.
const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const meta = (attr: string, key: string) =>
  new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`, "s").exec(html)?.[1];

describe("index.html (vista previa de la portada para quien no ejecuta JavaScript)", () => {
  it("el título y la descripción son los de la portada de la tienda", () => {
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(t("shop.seo.homeTitle"));
    expect(meta("name", "description")).toBe(t("shop.seo.siteDescription"));
  });
  it("lleva Open Graph de la marca y un único título", () => {
    expect(meta("property", "og:title")).toBe(t("shop.seo.homeTitle"));
    expect(meta("property", "og:description")).toBe(t("shop.seo.siteDescription"));
    expect(meta("property", "og:site_name")).toBe(t("app.name"));
    expect(meta("property", "og:type")).toBe("website");
    expect(meta("property", "og:locale")).toBe("es_BO");
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
  });
});
