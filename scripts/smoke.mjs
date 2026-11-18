#!/usr/bin/env node
// Humo de producción (Sprint 16): comprobaciones de SOLO LECTURA que se corren justo después de cada despliegue y en el ensayo
// del lanzamiento. No crea cuentas, pedidos ni datos: solo GET/HEAD/OPTIONS contra la tienda publicada y contra Supabase.
//   npm run smoke -- https://tienda.ejemplo.com
//   npm run smoke -- https://tienda.ejemplo.com --supabase https://<proyecto>.supabase.co --anon <clave anónima>
// La URL de Supabase y la clave anónima (públicas) salen de .env.local si no se pasan. Sale con 1 si algo falla.
//
// Qué cubre: la portada y sus cabeceras de seguridad, robots/mapa/feeds, lo privado con noindex, el bundle sin claves, los mapas de
// fuentes ocultos, el CORS estricto de las funciones, y que la API cierre lo que debe (tablas) y abra lo público (vistas).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scanLine } from "./scan-secrets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const pass = (name, detail = "") => ({ name, ok: true, detail });
const fail = (name, detail) => ({ name, ok: false, detail });

/** Cabeceras de seguridad que la tienda promete (vercel.json). `headers` es un objeto Headers o un Map en minúsculas. */
export function checkSecurityHeaders(headers) {
  const get = (k) => headers.get(k) ?? "";
  const problems = [];
  const csp = get("content-security-policy");
  if (!csp) problems.push("falta Content-Security-Policy");
  else {
    if (!/frame-ancestors\s+'none'/.test(csp)) problems.push("CSP sin frame-ancestors 'none'");
    if (!/object-src\s+'none'/.test(csp)) problems.push("CSP sin object-src 'none'");
    if (!/default-src\s+'self'/.test(csp)) problems.push("CSP sin default-src 'self'");
    if (/unsafe-eval/.test(csp)) problems.push("CSP permite unsafe-eval");
    const script = /script-src([^;]*)/.exec(csp)?.[1] ?? "";
    if (/unsafe-inline/.test(script))
      problems.push("CSP permite scripts en línea (unsafe-inline en script-src)");
    if (/(^|\s)\*(\s|$)/.test(script)) problems.push("CSP permite scripts de cualquier origen");
  }
  const hsts = /max-age=(\d+)/.exec(get("strict-transport-security"))?.[1];
  if (!hsts || Number(hsts) < 31536000) problems.push("HSTS ausente o de menos de un año");
  if (get("x-content-type-options").toLowerCase() !== "nosniff")
    problems.push("falta X-Content-Type-Options: nosniff");
  if (get("x-frame-options").toUpperCase() !== "DENY") problems.push("falta X-Frame-Options: DENY");
  if (!get("referrer-policy")) problems.push("falta Referrer-Policy");
  if (!/camera=\(\)/.test(get("permissions-policy")))
    problems.push("Permissions-Policy no cierra la cámara");
  return problems.length
    ? fail("cabeceras de seguridad", problems.join("; "))
    : pass("cabeceras de seguridad");
}

/** robots.txt: cierra lo privado y apunta al mapa del sitio. */
export function checkRobots(text, site) {
  const must = ["/admin", "/cuenta", "/carrito", "/checkout", "/pedido", "/login"];
  const missing = must.filter((p) => !new RegExp(`^Disallow:\\s*${p}\\s*$`, "m").test(text));
  const sitemap = new RegExp(
    `^Sitemap:\\s*${site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/sitemap\\.xml\\s*$`,
    "m",
  ).test(text);
  const problems = [
    ...missing.map((p) => `no cierra ${p}`),
    ...(sitemap ? [] : ["el Sitemap no apunta a este dominio"]),
  ];
  if (/^Disallow:\s*\/\s*$/m.test(text)) problems.push("cierra TODO el sitio (Disallow: /)");
  return problems.length ? fail("robots.txt", problems.join("; ")) : pass("robots.txt");
}

/** Mapa del sitio: XML con direcciones de ESTE dominio y ninguna privada. */
export function checkSitemap(xml, site) {
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (!/<urlset/.test(xml) || urls.length === 0)
    return fail("mapa del sitio", "no tiene direcciones");
  const foreign = urls.filter((u) => !u.startsWith(site));
  const priv = urls.filter((u) =>
    /\/(admin|cuenta|carrito|checkout|pedido|login|registro)(\/|$)/.test(u),
  );
  const problems = [
    ...(foreign.length
      ? [`${foreign.length} direcciones de otro dominio (p. ej. ${foreign[0]})`]
      : []),
    ...(priv.length ? [`${priv.length} direcciones privadas (p. ej. ${priv[0]})`] : []),
  ];
  return problems.length
    ? fail("mapa del sitio", problems.join("; "))
    : pass("mapa del sitio", `${urls.length} direcciones`);
}

/** Feed RSS de catálogo: bien formado en lo básico (el catálogo puede estar vacío al principio). */
export function checkFeed(xml, label) {
  if (!/<rss[\s>]/.test(xml) || !/xmlns:g="http:\/\/base\.google\.com\/ns\/1\.0"/.test(xml)) {
    return fail(`feed ${label}`, "no es un RSS con el espacio de nombres g:");
  }
  const items = (xml.match(/<item>/g) ?? []).length;
  const closed = (xml.match(/<\/item>/g) ?? []).length;
  if (items !== closed) return fail(`feed ${label}`, "hay <item> sin cerrar");
  return pass(`feed ${label}`, `${items} productos`);
}

/** CORS de una función de Edge: solo el dominio de la tienda; nunca «*» ni un origen ajeno. */
export function checkCors(responses, site) {
  const own = responses.own.headers.get("access-control-allow-origin");
  const foreign = responses.foreign.headers.get("access-control-allow-origin");
  const problems = [];
  if (own !== site) problems.push(`al origen de la tienda responde «${own ?? "nada"}»`);
  if (foreign === "*" || foreign === "https://evil.example")
    problems.push(`a un origen ajeno responde «${foreign}»`);
  return problems.length
    ? fail("CORS de las funciones", problems.join("; "))
    : pass("CORS de las funciones");
}

/** Un archivo del bundle público no debe contener claves de servicio ni secretos. */
export function checkBundleSecrets(js, name) {
  const hits = js.split("\n").flatMap((line) => scanLine(line).map((h) => h.id));
  return hits.length
    ? fail(`bundle sin claves (${name})`, `contiene: ${[...new Set(hits)].join(", ")}`)
    : pass(`bundle sin claves (${name})`);
}

const text = async (res) => (res.ok ? await res.text() : "");

/**
 * Corre todo contra `site` (y, si se da, contra Supabase). `fetchImpl` se puede cambiar para probar sin red.
 * Devuelve la lista de resultados { name, ok, detail }.
 */
export async function runSmoke({ site, supabaseUrl, anonKey, fetchImpl = fetch }) {
  const base = site.replace(/\/$/, "");
  const results = [];
  const get = (path, init) => fetchImpl(`${base}${path}`, { redirect: "manual", ...init });
  const guard = async (name, fn) => {
    try {
      results.push(await fn());
    } catch (error) {
      results.push(fail(name, `no se pudo comprobar: ${error.message}`));
    }
  };

  let indexHtml = "";
  await guard("portada", async () => {
    const res = await get("/");
    indexHtml = await text(res);
    if (res.status !== 200 || !/<div id="root"/.test(indexHtml))
      return fail("portada", `HTTP ${res.status} o sin la raíz de la aplicación`);
    results.push(checkSecurityHeaders(res.headers));
    return pass("portada", "HTTP 200");
  });

  await guard("robots.txt", async () => checkRobots(await text(await get("/robots.txt")), base));
  await guard("mapa del sitio", async () =>
    checkSitemap(await text(await get("/sitemap.xml")), base),
  );
  for (const target of ["google", "meta"]) {
    await guard(`feed ${target}`, async () =>
      checkFeed(await text(await get(`/feeds/${target}.xml`)), target),
    );
  }

  for (const path of ["/tienda", "/carrito", "/checkout", "/cuenta", "/admin", "/login"]) {
    await guard(`ruta ${path}`, async () => {
      const res = await get(path);
      if (res.status !== 200)
        return fail(
          `ruta ${path}`,
          `HTTP ${res.status} (al recargar una ruta profunda debe servir la aplicación)`,
        );
      const privateRoute = path !== "/tienda";
      const robots = res.headers.get("x-robots-tag") ?? "";
      if (privateRoute && !/noindex/.test(robots))
        return fail(`ruta ${path}`, "es privada y no lleva X-Robots-Tag: noindex");
      if (!privateRoute && /noindex/.test(robots))
        return fail(`ruta ${path}`, "es pública y lleva noindex");
      return pass(`ruta ${path}`, privateRoute ? "200 + noindex" : "200 indexable");
    });
  }

  await guard("bundle", async () => {
    // el script de entrada y los fragmentos que la portada precarga: ninguno puede llevar claves ni tener mapa de fuentes público
    const scripts = [
      ...new Set([...indexHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1])),
    ].slice(0, 12);
    if (scripts.length === 0)
      return fail("bundle", "la portada no enlaza ningún script de /assets");
    for (const [i, script] of scripts.entries()) {
      const res = await get(script);
      const js = await text(res);
      if (i === 0) {
        const cache = res.headers.get("cache-control") ?? "";
        results.push(
          /immutable/.test(cache)
            ? pass("caché de /assets")
            : fail("caché de /assets", `Cache-Control «${cache}» (debe ser immutable)`),
        );
        const map = await get(`${script}.map`);
        results.push(
          map.status === 200
            ? fail("mapas de fuentes ocultos", `${script}.map es público`)
            : pass("mapas de fuentes ocultos"),
        );
      }
      results.push(checkBundleSecrets(js, script.split("/").pop()));
    }
    return pass("bundle", `${scripts.length} archivos revisados`);
  });

  if (supabaseUrl && anonKey) {
    const api = (path, init = {}) =>
      fetchImpl(`${supabaseUrl}${path}`, {
        ...init,
        headers: { apikey: anonKey, "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
    await guard("healthcheck", async () => {
      const res = await api("/rest/v1/rpc/healthcheck", { method: "POST", body: "{}" });
      const body = res.ok ? await res.json() : null;
      return body?.ok === true
        ? pass("healthcheck de la base")
        : fail("healthcheck de la base", `HTTP ${res.status}`);
    });
    await guard("catálogo público", async () => {
      const res = await api("/rest/v1/public_products?select=id&limit=1");
      return res.status === 200
        ? pass("catálogo público abierto")
        : fail("catálogo público abierto", `HTTP ${res.status}`);
    });
    for (const table of ["orders", "profiles", "payments", "products", "addresses"]) {
      await guard(`tabla ${table}`, async () => {
        const res = await api(`/rest/v1/${table}?select=id&limit=1`);
        return res.status === 401 || res.status === 403
          ? pass(`${table} cerrada a visitantes`)
          : fail(`${table} cerrada a visitantes`, `HTTP ${res.status} (debía ser 401 o 403)`);
      });
    }
    await guard("CORS", async () => {
      const preflight = (origin) =>
        fetchImpl(`${supabaseUrl}/functions/v1/cart`, {
          method: "OPTIONS",
          headers: { origin, "access-control-request-method": "POST", apikey: anonKey },
        });
      return checkCors(
        { own: await preflight(base), foreign: await preflight("https://evil.example") },
        base,
      );
    });
    await guard("Auth", async () => {
      const res = await api("/auth/v1/settings");
      const s = res.ok ? await res.json() : null;
      if (!s) return fail("configuración pública de Auth", `HTTP ${res.status}`);
      const problems = [];
      if (s.disable_signup !== true) problems.push("las altas directas en Auth están abiertas");
      if (s.mailer_autoconfirm === true) problems.push("confirma correos sin verificar");
      const on = Object.entries(s.external ?? {})
        .filter(([k, v]) => v === true && !["email"].includes(k))
        .map(([k]) => k);
      if (on.length) problems.push(`proveedores externos activos: ${on.join(", ")}`);
      return problems.length
        ? fail("configuración pública de Auth", problems.join("; "))
        : pass("configuración pública de Auth");
    });
    await guard("comprobantes", async () => {
      const res = await fetchImpl(
        `${supabaseUrl}/storage/v1/object/public/payment-proofs/prueba/prueba.png`,
      );
      return res.status >= 400
        ? pass("comprobantes de pago privados")
        : fail("comprobantes de pago privados", `HTTP ${res.status}`);
    });
  }
  return results;
}

export function formatResults(results) {
  const lines = results.map(
    (r) => `${r.ok ? "✔" : "✘"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`,
  );
  const failed = results.filter((r) => !r.ok).length;
  lines.push(
    `\n${results.length - failed} de ${results.length} comprobaciones pasan${failed ? `, ${failed} FALLAN` : ""}.`,
  );
  return lines.join("\n");
}

/** Lee `--supabase`, `--anon` y la URL de la tienda de los argumentos; completa con .env.local. */
export function parseArgs(argv, envFile = join(ROOT, ".env.local")) {
  // la tienda es el primer argumento con forma de dirección que NO es el valor de una opción (--supabase https://… no es la tienda)
  const site = argv.find(
    (a, i) => /^https?:\/\//.test(a) && !String(argv[i - 1] ?? "").startsWith("--"),
  );
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (!site)
    throw new Error(
      "Uso: npm run smoke -- https://tienda.ejemplo.com [--supabase https://<proyecto>.supabase.co --anon <clave>]",
    );
  let supabaseUrl = flag("--supabase");
  let anonKey = flag("--anon");
  if ((!supabaseUrl || !anonKey) && existsSync(envFile)) {
    for (const raw of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(raw.trim());
      if (!m) continue;
      const value = m[2].replace(/^["']|["']$/g, "");
      if (m[1] === "VITE_SUPABASE_URL") supabaseUrl ??= value;
      if (m[1] === "VITE_SUPABASE_ANON_KEY") anonKey ??= value;
    }
  }
  return { site: site.replace(/\/$/, ""), supabaseUrl, anonKey };
}

async function main() {
  const results = await runSmoke(parseArgs(process.argv.slice(2)));
  console.log(formatResults(results));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
