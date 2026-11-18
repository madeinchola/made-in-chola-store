import { describe, expect, it } from "vitest";
import { dbSql, testEnv } from "../../../test-support/api";
import { handleFeed, handleSitemap } from "./handlers";
import type { SeoDeps } from "./supabaseRest";

/**
 * Feeds de catálogo y mapa del sitio (Sprint 15) contra la nube con la clave ANÓNIMA, igual que lo hace la función de Vercel: comprueba
 * que las vistas públicas y las columnas que pide el feed EXISTEN (un error de nombre solo se ve contra la base real) y que el XML sale
 * con lo que Google y Meta exigen. Lo que NO se prueba: que Merchant Center o Meta acepten el feed (requiere sus cuentas).
 */
const env = () => {
  const { url, anon } = testEnv();
  return { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SITE_URL: "https://madeinchola.com" };
};
const deps = (): SeoDeps => ({ env: env(), fetch });
const items = (xml: string) => [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]!);
const field = (item: string, name: string) =>
  new RegExp(`<g:${name}>([\\s\\S]*?)</g:${name}>`).exec(item)?.[1];

describe("feeds de catálogo (BD real, clave anónima)", () => {
  for (const target of ["google", "meta"] as const) {
    it(`el feed de ${target} sale con todos los campos obligatorios, ids únicos y solo lo público`, async () => {
      const response = await handleFeed(
        new Request(`https://madeinchola.com/api/feed?target=${target}`),
        deps(),
      );
      expect(response.status).toBe(200);
      const xml = await response.text();
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(xml).toContain("</rss>");
      const list = items(xml);
      expect(
        list.length,
        "el catálogo público tiene variantes (las pruebas dejan productos activos)",
      ).toBeGreaterThan(0);
      const ids = list.map((i) => field(i, "id"));
      expect(new Set(ids).size).toBe(ids.length);
      for (const item of list) {
        for (const required of [
          "id",
          "item_group_id",
          "title",
          "description",
          "link",
          "image_link",
          "availability",
          "price",
          "condition",
          "brand",
        ])
          expect(field(item, required), `falta g:${required}`).toBeTruthy();
        expect(field(item, "price")).toMatch(/^\d+\.\d{2} BOB$/);
        expect(field(item, "availability")).toMatch(/^(in stock|out of stock)$/);
        expect(field(item, "link")).toMatch(/^https:\/\/madeinchola\.com\/producto\/[a-z0-9-]+$/);
        expect(field(item, "image_link")).toMatch(
          /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/product-images\//,
        );
      }
      // nada interno: ni costos ni cantidades exactas
      expect(xml).not.toMatch(/cost|stock_on_hand|cost_base/i);
      // no hay caracteres que invaliden el XML
      expect(xml).not.toMatch(/(?![\t\n\r])\p{Cc}/u);
    }, 60_000);
  }

  it("la cantidad de variantes del feed coincide con las variantes públicas que tienen imagen y precio", async () => {
    const xml = await (
      await handleFeed(new Request("https://madeinchola.com/api/feed?target=google"), deps())
    ).text();
    const inFeed = items(xml).length;
    const expected = Number(
      dbSql(`select count(*) from public.public_product_variants v
               join public.public_products p on p.id = v.product_id
              where p.price_bob > 0
                and (p.cover_path is not null
                     or exists (select 1 from public.public_product_images i where i.product_id = p.id))`),
    );
    expect(inFeed).toBe(expected);
  }, 60_000);

  it("el mapa del sitio sale con la clave anónima y lleva SOLO los textos legales con una versión vigente", async () => {
    const response = await handleSitemap(
      new Request("https://madeinchola.com/sitemap.xml"),
      deps(),
    );
    expect(response.status).toBe(200);
    const xml = await response.text();
    // un documento cuenta cuando tiene una versión publicada que ya rige: eso es lo que dice `public_legal_index`
    const withCurrent = Number(
      dbSql(
        "select count(distinct kind) from public.legal_versions where status = 'published' and effective_at <= now()",
      ),
    );
    expect((xml.match(/<loc>[^<]*\/legal\/[^<]*<\/loc>/g) ?? []).length).toBe(withCurrent);
    expect(xml).toContain("<loc>https://madeinchola.com/tienda</loc>");
  }, 60_000);
});
