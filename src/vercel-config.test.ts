import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Valida el vercel.json REAL del repo: es lo que se despliega.
const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
  rewrites: {
    source: string;
    destination: string;
    has?: { type: string; key: string; value: string }[];
  }[];
};

/** El comodín de la SPA: cualquier ruta salvo funciones y archivos con hash (un chunk viejo debe dar 404, no HTML). */
const SPA_SOURCE = "/((?!api/|assets/|fonts/).*)";
/** Así lo evaluaría path-to-regexp con ese `source` (la ruta completa debe coincidir). */
const spaMatches = (path: string) => new RegExp(`^${SPA_SOURCE}$`).test(path);

const globalHeaders = Object.fromEntries(
  config.headers.find((h) => h.source === "/(.*)")!.headers.map((h) => [h.key, h.value]),
);
const csp = Object.fromEntries(
  globalHeaders["Content-Security-Policy"]!.split(";").map((d) => {
    const [name, ...values] = d.trim().split(/\s+/);
    return [name, values];
  }),
) as Record<string, string[]>;

describe("vercel.json", () => {
  it("rewrite SPA: cualquier ruta profunda sirve index.html", () => {
    expect(config.rewrites).toContainEqual({ source: SPA_SOURCE, destination: "/index.html" });
    for (const path of [
      "/",
      "/producto/chaqueta-roja",
      "/tienda",
      "/categoria/ropa",
      "/admin/productos",
    ])
      expect(spaMatches(path), path).toBe(true);
  });
  it("rewrite SPA: NO captura funciones ni archivos con hash (un chunk viejo daba HTML con caché de un año)", () => {
    for (const path of [
      "/assets/App-abc123.js",
      "/assets/x.css",
      "/fonts/jost-400.woff2",
      "/api/seo",
      "/api/desconocida",
    ])
      expect(spaMatches(path), path).toBe(false);
  });
  it("headers de seguridad obligatorios presentes", () => {
    expect(globalHeaders["X-Content-Type-Options"]).toBe("nosniff");
    expect(globalHeaders["Strict-Transport-Security"]).toMatch(/max-age=\d{8,}/);
    expect(globalHeaders["Referrer-Policy"]).toBeTruthy();
    expect(globalHeaders["Permissions-Policy"]).toBeTruthy();
    expect(globalHeaders["X-Frame-Options"]).toBe("DENY");
  });
  it("CSP: sin 'unsafe-eval' ni 'unsafe-inline' en scripts, sin comodín total", () => {
    const script = csp["script-src"]!;
    expect(script).not.toContain("'unsafe-eval'");
    expect(script).not.toContain("'unsafe-inline'");
    for (const [name, values] of Object.entries(csp)) {
      expect(values, name).not.toContain("*");
    }
  });
  it("CSP: frame-ancestors 'none', object-src 'none', base-uri y default-src restrictivos", () => {
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["default-src"]).toEqual(["'self'"]);
  });
  it("CSP: permite lo legítimo (Supabase API y realtime, imágenes de Storage)", () => {
    expect(csp["connect-src"]).toEqual(
      expect.arrayContaining(["https://*.supabase.co", "wss://*.supabase.co"]),
    );
    expect(csp["img-src"]).toContain("https:");
  });
  it("assets con hash se cachean como inmutables", () => {
    const rule = config.headers.find((h) => h.source === "/assets/(.*)");
    expect(rule?.headers[0]?.value).toMatch(/immutable/);
  });

  describe("rutas para bots, mapa del sitio y robots (S5)", () => {
    const botRewrites = config.rewrites.filter((r) => r.has);
    // Anclado a toda la cadena (`^…$`): el peor caso. Si Vercel evalúa el valor como coincidencia COMPLETA, un patrón sin
    // `.*` a los lados no reconocería nunca a «Mozilla/5.0 (compatible; Googlebot/2.1; …)».
    const botPattern = new RegExp(`^(?:${botRewrites[0]!.has![0]!.value})$`);

    it("el patrón de bots lleva comodines a los lados (vale tanto si se evalúa anclado como si no)", () => {
      const value = botRewrites[0]!.has![0]!.value;
      expect(value.startsWith(".*(")).toBe(true);
      expect(value.endsWith(").*")).toBe(true);
    });

    it("el comodín de la SPA es la ÚLTIMA regla (si no, taparía las de bots)", () => {
      expect(config.rewrites.at(-1)).toEqual({ source: SPA_SOURCE, destination: "/index.html" });
    });

    it.each([
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "WhatsApp/2.23.20.0 A",
      "Twitterbot/1.0",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "TelegramBot (like TwitterBot)",
      "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
      "facebookcatalog/1.0",
      "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
      "meta-externalfetcher/1.1",
      "Pinterest/0.2 (+http://www.pinterest.com/bot.html)",
      "FeedFetcher-Google; (+http://www.google.com/feedfetcher.html)",
    ])("reconoce al bot: %s", (userAgent) => {
      expect(botPattern.test(userAgent)).toBe(true);
    });

    it.each([
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0",
      // Navegadores integrados de las apps (personas reales que abren el enlace dentro de la aplicación)
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0",
      "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/460.0.0.0;]",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_33.0.0 TikTok",
    ])("NO trata como bot a una persona con navegador: %s", (userAgent) => {
      expect(botPattern.test(userAgent)).toBe(false);
    });

    it("cada tipo de página se reescribe a /api/seo con su tipo y su slug", () => {
      const byType = Object.fromEntries(botRewrites.map((r) => [r.destination, r.source]));
      expect(byType).toEqual({
        "/api/seo?type=product&slug=:slug": "/producto/:slug",
        "/api/seo?type=category&slug=:slug": "/categoria/:slug",
        "/api/seo?type=collection&slug=:slug": "/coleccion/:slug",
        "/api/seo?type=shop": "/tienda",
        "/api/seo?type=home": "/",
      });
      for (const rewrite of botRewrites) {
        expect(rewrite.has).toEqual([
          { type: "header", key: "user-agent", value: botRewrites[0]!.has![0]!.value },
        ]);
      }
    });

    it("el mapa del sitio y robots.txt se sirven por las funciones (sin condición de agente)", () => {
      expect(config.rewrites).toContainEqual({
        source: "/sitemap.xml",
        destination: "/api/sitemap",
      });
      expect(config.rewrites).toContainEqual({ source: "/robots.txt", destination: "/api/robots" });
    });

    it("las rutas de bots, sitemap y robots van antes del comodín", () => {
      const catchAll = config.rewrites.findIndex((r) => r.source === SPA_SOURCE);
      expect(catchAll).toBeGreaterThan(-1);
      for (const source of [
        "/producto/:slug",
        "/categoria/:slug",
        "/coleccion/:slug",
        "/tienda",
        "/",
        "/sitemap.xml",
        "/robots.txt",
      ]) {
        expect(
          config.rewrites.findIndex((r) => r.source === source),
          source,
        ).toBeLessThan(catchAll);
      }
    });
  });
});
