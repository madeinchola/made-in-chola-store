// Pruebas del humo de producción con respuestas inventadas (sin red): cada comprobación pasa con una tienda sana y falla con UN defecto.
import { describe, expect, it } from "vitest";
import {
  checkBundleSecrets,
  checkCors,
  checkFeed,
  checkRobots,
  checkSecurityHeaders,
  checkSitemap,
  formatResults,
  parseArgs,
  runSmoke,
} from "./smoke.mjs";

const SITE = "https://tienda.ejemplo.com";
const API = "https://abcdefgh.supabase.co";

const headersOf = (obj) => new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
const res = (status, body = "", headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: headersOf(headers),
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  json: async () => (typeof body === "string" ? JSON.parse(body) : body),
});

const GOOD_HEADERS = {
  "content-security-policy":
    "default-src 'self'; script-src 'self' https://connect.facebook.net; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=()",
};
const ROBOTS = [
  "User-agent: *",
  "Allow: /",
  "Disallow: /admin",
  "Disallow: /cuenta",
  "Disallow: /login",
  "Disallow: /carrito",
  "Disallow: /checkout",
  "Disallow: /pedido",
  "",
  `Sitemap: ${SITE}/sitemap.xml`,
].join("\n");
const SITEMAP = `<?xml version="1.0"?><urlset><url><loc>${SITE}/</loc></url><url><loc>${SITE}/tienda</loc></url></urlset>`;
const FEED = `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><item><title>a</title></item></channel></rss>`;
const INDEX = `<html><body><div id="root"></div><script type="module" src="/assets/index-abc.js"></script></body></html>`;

/** Una tienda y una API sanas, con la posibilidad de cambiar UNA respuesta. */
function fakeFetch(overrides = {}) {
  const table = {
    [`${SITE}/`]: () => res(200, INDEX, GOOD_HEADERS),
    [`${SITE}/robots.txt`]: () => res(200, ROBOTS),
    [`${SITE}/sitemap.xml`]: () => res(200, SITEMAP),
    [`${SITE}/feeds/google.xml`]: () => res(200, FEED),
    [`${SITE}/feeds/meta.xml`]: () => res(200, FEED),
    [`${SITE}/tienda`]: () => res(200, INDEX),
    [`${SITE}/carrito`]: () => res(200, INDEX, { "x-robots-tag": "noindex, nofollow" }),
    [`${SITE}/checkout`]: () => res(200, INDEX, { "x-robots-tag": "noindex, nofollow" }),
    [`${SITE}/cuenta`]: () => res(200, INDEX, { "x-robots-tag": "noindex, nofollow" }),
    [`${SITE}/admin`]: () => res(200, INDEX, { "x-robots-tag": "noindex, nofollow" }),
    [`${SITE}/login`]: () => res(200, INDEX, { "x-robots-tag": "noindex, nofollow" }),
    [`${SITE}/assets/index-abc.js`]: () =>
      res(200, "console.log('hola')", { "cache-control": "public, max-age=31536000, immutable" }),
    [`${SITE}/assets/index-abc.js.map`]: () => res(404),
    [`${API}/rest/v1/rpc/healthcheck`]: () => res(200, { ok: true }),
    [`${API}/rest/v1/public_products?select=id&limit=1`]: () => res(200, []),
    [`${API}/rest/v1/orders?select=id&limit=1`]: () => res(401),
    [`${API}/rest/v1/profiles?select=id&limit=1`]: () => res(401),
    [`${API}/rest/v1/payments?select=id&limit=1`]: () => res(401),
    [`${API}/rest/v1/products?select=id&limit=1`]: () => res(401),
    [`${API}/rest/v1/addresses?select=id&limit=1`]: () => res(401),
    [`${API}/auth/v1/settings`]: () =>
      res(200, {
        disable_signup: true,
        mailer_autoconfirm: false,
        external: { email: true, google: false },
      }),
    [`${API}/storage/v1/object/public/payment-proofs/prueba/prueba.png`]: () => res(400),
    ...overrides,
  };
  return async (url, init = {}) => {
    if (url === `${API}/functions/v1/cart` && init.method === "OPTIONS") {
      const origin = init.headers.origin;
      const custom = overrides.cors?.(origin);
      return (
        custom ?? res(204, "", { "access-control-allow-origin": origin === SITE ? SITE : SITE })
      );
    }
    const handler = table[url];
    if (!handler) throw new Error(`petición inesperada: ${url}`);
    return handler(init);
  };
}

const run = (overrides) =>
  runSmoke({ site: SITE, supabaseUrl: API, anonKey: "anon", fetchImpl: fakeFetch(overrides) });
const failures = (results) => results.filter((r) => !r.ok).map((r) => r.name);

describe("una tienda sana", () => {
  it("pasa todas las comprobaciones, con tienda y con API", async () => {
    const results = await run();
    expect(failures(results)).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(25);
  });

  it("sin datos de Supabase solo corre la parte web", async () => {
    const results = await runSmoke({ site: SITE, fetchImpl: fakeFetch() });
    expect(failures(results)).toEqual([]);
    expect(results.some((r) => r.name.includes("healthcheck"))).toBe(false);
  });
});

describe("cada defecto lo detecta SOLO la comprobación que le toca", () => {
  const cases = [
    [
      "la portada no es la aplicación",
      { [`${SITE}/`]: () => res(200, "<html>otra cosa</html>", GOOD_HEADERS) },
      "portada",
      "bundle",
    ],
    ["portada caída", { [`${SITE}/`]: () => res(500, "", GOOD_HEADERS) }, "portada", "bundle"],
    [
      "robots.txt cierra todo el sitio",
      { [`${SITE}/robots.txt`]: () => res(200, ROBOTS + "\nDisallow: /") },
      "robots.txt",
    ],
    [
      "el mapa sale vacío",
      { [`${SITE}/sitemap.xml`]: () => res(200, "<urlset></urlset>") },
      "mapa del sitio",
    ],
    [
      "el feed no es RSS de Google",
      { [`${SITE}/feeds/meta.xml`]: () => res(200, "<html></html>") },
      "feed meta",
    ],
    [
      "una ruta privada sin noindex",
      { [`${SITE}/checkout`]: () => res(200, INDEX) },
      "ruta /checkout",
    ],
    [
      "la tienda pública con noindex",
      { [`${SITE}/tienda`]: () => res(200, INDEX, { "x-robots-tag": "noindex" }) },
      "ruta /tienda",
    ],
    ["recargar una ruta da 404", { [`${SITE}/cuenta`]: () => res(404) }, "ruta /cuenta"],
    [
      "los assets sin caché inmutable",
      { [`${SITE}/assets/index-abc.js`]: () => res(200, "x", { "cache-control": "no-cache" }) },
      "caché de /assets",
    ],
    [
      "el mapa de fuentes es público",
      { [`${SITE}/assets/index-abc.js.map`]: () => res(200, "{}") },
      "mapas de fuentes ocultos",
    ],
    [
      "el bundle lleva una clave secreta",
      {
        [`${SITE}/assets/index-abc.js`]: () =>
          res(200, `var k="${"sb_secret_" + "Ab3_".repeat(5)}"`, { "cache-control": "immutable" }),
      },
      "bundle sin claves (index-abc.js)",
    ],
    [
      "la base no responde bien al healthcheck",
      { [`${API}/rest/v1/rpc/healthcheck`]: () => res(200, { ok: false }) },
      "healthcheck de la base",
    ],
    [
      "el catálogo público cerrado",
      { [`${API}/rest/v1/public_products?select=id&limit=1`]: () => res(401) },
      "catálogo público abierto",
    ],
    [
      "orders abierta a visitantes",
      { [`${API}/rest/v1/orders?select=id&limit=1`]: () => res(200, []) },
      "orders cerrada a visitantes",
    ],
    [
      "profiles abierta a visitantes",
      { [`${API}/rest/v1/profiles?select=id&limit=1`]: () => res(200, []) },
      "profiles cerrada a visitantes",
    ],
    [
      "altas directas abiertas en Auth",
      {
        [`${API}/auth/v1/settings`]: () =>
          res(200, { disable_signup: false, external: { email: true } }),
      },
      "configuración pública de Auth",
    ],
    [
      "un proveedor externo activo en Auth",
      {
        [`${API}/auth/v1/settings`]: () =>
          res(200, { disable_signup: true, external: { email: true, github: true } }),
      },
      "configuración pública de Auth",
    ],
    [
      "confirmación automática de correos",
      {
        [`${API}/auth/v1/settings`]: () =>
          res(200, { disable_signup: true, mailer_autoconfirm: true, external: {} }),
      },
      "configuración pública de Auth",
    ],
    [
      "los comprobantes son públicos",
      { [`${API}/storage/v1/object/public/payment-proofs/prueba/prueba.png`]: () => res(200) },
      "comprobantes de pago privados",
    ],
    [
      "CORS abierto a cualquiera",
      { cors: () => res(204, "", { "access-control-allow-origin": "*" }) },
      "CORS de las funciones",
    ],
  ];
  // sin portada válida tampoco se puede revisar el bundle: ese segundo fallo es consecuencia, no ruido
  for (const [label, overrides, ...expected] of cases) {
    it(label, async () => {
      expect(failures(await run(overrides))).toEqual(expected);
    });
  }

  it("una petición que revienta no tumba el informe: queda como fallo con su motivo", async () => {
    const results = await run({
      [`${SITE}/robots.txt`]: () => {
        throw new Error("sin red");
      },
    });
    const robots = results.find((r) => r.name === "robots.txt");
    expect(robots?.ok).toBe(false);
    expect(robots?.detail).toContain("sin red");
  });
});

describe("comprobaciones sueltas", () => {
  it("cabeceras: cada ausencia o debilidad se nombra", () => {
    expect(checkSecurityHeaders(headersOf(GOOD_HEADERS)).ok).toBe(true);
    const weaken = (change) => checkSecurityHeaders(headersOf({ ...GOOD_HEADERS, ...change }));
    expect(weaken({ "content-security-policy": "" }).detail).toContain("Content-Security-Policy");
    expect(
      weaken({
        "content-security-policy": GOOD_HEADERS["content-security-policy"].replace(
          "frame-ancestors 'none'",
          "",
        ),
      }).detail,
    ).toContain("frame-ancestors");
    expect(
      weaken({
        "content-security-policy": GOOD_HEADERS["content-security-policy"].replace(
          "object-src 'none'",
          "",
        ),
      }).detail,
    ).toContain("object-src");
    expect(
      weaken({
        "content-security-policy": GOOD_HEADERS["content-security-policy"] + " 'unsafe-eval'",
      }).detail,
    ).toContain("unsafe-eval");
    expect(
      weaken({
        "content-security-policy": GOOD_HEADERS["content-security-policy"].replace(
          "script-src 'self'",
          "script-src 'self' 'unsafe-inline'",
        ),
      }).detail,
    ).toContain("unsafe-inline");
    expect(
      weaken({
        "content-security-policy": GOOD_HEADERS["content-security-policy"].replace(
          "script-src 'self'",
          "script-src *",
        ),
      }).detail,
    ).toContain("cualquier origen");
    expect(weaken({ "strict-transport-security": "max-age=100" }).detail).toContain("HSTS");
    expect(weaken({ "strict-transport-security": "" }).detail).toContain("HSTS");
    expect(weaken({ "x-content-type-options": "" }).detail).toContain("nosniff");
    expect(weaken({ "x-frame-options": "SAMEORIGIN" }).detail).toContain("X-Frame-Options");
    expect(weaken({ "referrer-policy": "" }).detail).toContain("Referrer-Policy");
    expect(weaken({ "permissions-policy": "geolocation=(self)" }).detail).toContain(
      "Permissions-Policy",
    );
  });

  it("HSTS: un año exacto pasa y un segundo menos no", () => {
    expect(
      checkSecurityHeaders(
        headersOf({ ...GOOD_HEADERS, "strict-transport-security": "max-age=31536000" }),
      ).ok,
    ).toBe(true);
    expect(
      checkSecurityHeaders(
        headersOf({ ...GOOD_HEADERS, "strict-transport-security": "max-age=31535999" }),
      ).ok,
    ).toBe(false);
  });

  it("robots: nombra lo que no cierra y exige el mapa de ESTE dominio", () => {
    expect(checkRobots(ROBOTS, SITE).ok).toBe(true);
    expect(checkRobots(ROBOTS.replace("Disallow: /admin\n", ""), SITE).detail).toContain("/admin");
    expect(checkRobots(ROBOTS.replace(SITE, "https://otra.com"), SITE).detail).toContain("Sitemap");
    expect(checkRobots(ROBOTS.replace("Allow: /", "Disallow: /"), SITE).detail).toContain(
      "TODO el sitio",
    );
    // un Disallow más largo no sustituye al exacto
    expect(
      checkRobots(ROBOTS.replace("Disallow: /cuenta", "Disallow: /cuentas"), SITE).detail,
    ).toContain("/cuenta");
  });

  it("mapa: direcciones de otro dominio y privadas se cuentan", () => {
    expect(checkSitemap(SITEMAP, SITE).detail).toBe("2 direcciones");
    expect(
      checkSitemap(`<urlset><loc>https://otra.com/x</loc><loc>${SITE}/</loc></urlset>`, SITE)
        .detail,
    ).toContain("otro dominio");
    expect(checkSitemap(`<urlset><loc>${SITE}/admin</loc></urlset>`, SITE).detail).toContain(
      "privadas",
    );
    expect(checkSitemap(`<urlset><loc>${SITE}/cuenta/pedidos</loc></urlset>`, SITE).ok).toBe(false);
    expect(checkSitemap("no es xml", SITE).ok).toBe(false);
  });

  it("feed: exige RSS con g: y los <item> cerrados", () => {
    expect(checkFeed(FEED, "google").detail).toBe("1 productos");
    expect(checkFeed(FEED.replace("</item>", ""), "google").detail).toContain("sin cerrar");
    expect(
      checkFeed(FEED.replace('xmlns:g="http://base.google.com/ns/1.0"', ""), "google").ok,
    ).toBe(false);
  });

  it("CORS: al origen propio responde el propio; a uno ajeno, ni «*» ni el ajeno", () => {
    const ok = {
      own: res(204, "", { "access-control-allow-origin": SITE }),
      foreign: res(204, "", { "access-control-allow-origin": SITE }),
    };
    expect(checkCors(ok, SITE).ok).toBe(true);
    expect(checkCors({ ...ok, own: res(204) }, SITE).detail).toContain("nada");
    expect(
      checkCors(
        { ...ok, foreign: res(204, "", { "access-control-allow-origin": "https://evil.example" }) },
        SITE,
      ).ok,
    ).toBe(false);
    expect(
      checkCors({ ...ok, foreign: res(204, "", { "access-control-allow-origin": "*" }) }, SITE).ok,
    ).toBe(false);
  });

  it("bundle: detecta una clave de servicio aunque venga en una línea larga", () => {
    const jwt = (role) =>
      `eyJ${"h".repeat(12)}.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.${"s".repeat(20)}`;
    expect(checkBundleSecrets(`a;b;var x="${jwt("service_role")}";c`, "a.js").ok).toBe(false);
    expect(checkBundleSecrets(`var x="${jwt("anon")}"`, "a.js").ok).toBe(true);
  });
});

describe("argumentos e informe", () => {
  it("toma la tienda, y Supabase de los argumentos o de .env.local", () => {
    expect(parseArgs([SITE + "/", "--supabase", API, "--anon", "k"], "/no/existe")).toEqual({
      site: SITE,
      supabaseUrl: API,
      anonKey: "k",
    });
    expect(parseArgs([SITE], "/no/existe")).toEqual({
      site: SITE,
      supabaseUrl: undefined,
      anonKey: undefined,
    });
    expect(() => parseArgs(["--supabase", API], "/no/existe")).toThrow(/Uso:/); // la dirección de Supabase no es la tienda
    expect(parseArgs(["--supabase", API, "--anon", "k", SITE], "/no/existe").site).toBe(SITE); // las opciones pueden ir antes
  });

  it("el informe cuenta lo que pasa y lo que falla", () => {
    const out = formatResults([
      { name: "a", ok: true, detail: "" },
      { name: "b", ok: false, detail: "mal" },
    ]);
    expect(out).toContain("✔ a");
    expect(out).toContain("✘ b — mal");
    expect(out).toContain("1 de 2 comprobaciones pasan, 1 FALLAN");
  });
});
