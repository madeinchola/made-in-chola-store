import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import { BRAND, renderEmailHtml } from "./layout.ts";
import type { OutboxRow, RowContext, SiteContext } from "./types.ts";
import {
  buildVariables,
  formatAmount,
  formatDateLaPaz,
  firstName,
  sampleVariables,
  VARIABLE_CATALOG,
} from "./variables.ts";

const SITE: SiteContext = { siteUrl: "https://tienda.test", storeName: "Made In Chola" };
const CTX: RowContext = {
  customerName: "Ana María López",
  currency: { symbol: "Bs", decimals: 2 },
  paymentExpiresAt: "2026-11-16T14:00:00Z",
};

const row = (over: Partial<OutboxRow>): OutboxRow => ({
  id: 1,
  type: "order_shipped",
  channel: "email",
  recipient: "ana@correo.test",
  payload: {
    order_id: "11111111-1111-1111-1111-111111111111",
    number: "MIC-000123",
    status: "shipped",
    total: 1234.5,
    currency: "BOB",
  },
  attempts: 1,
  template: null,
  order_id: "11111111-1111-1111-1111-111111111111",
  profile_id: "22222222-2222-2222-2222-222222222222",
  dedupe_key: "k",
  ...over,
});

// ── Diseño del correo ──────────────────────────────────────────────────────────────────────
Deno.test("layout: documento completo, en español, adaptable y con modo oscuro", () => {
  const html = renderEmailHtml({
    storeName: "Made In Chola",
    preheader: "Tu pedido va en camino",
    paragraphsHtml: ["<b>x</b>", "dos"],
    cta: null,
    footerNote: "nota",
  });
  assert(html.startsWith("<!doctype html>"));
  assertStringIncludes(html, '<html lang="es"');
  assertStringIncludes(html, 'name="viewport"');
  assertStringIncludes(html, 'name="color-scheme" content="light dark"');
  assertStringIncludes(html, "prefers-color-scheme:dark");
  assertStringIncludes(html, "max-width:620px");
  assertStringIncludes(html, "Tu pedido va en camino");
  assertStringIncludes(html, BRAND.accent);
  assertEquals((html.match(/<p /g) ?? []).length, 2);
  assertFalse(html.includes("<script"));
  assertFalse(html.includes("<a "), "sin botón no hay enlace");
});

Deno.test(
  "layout: usa tablas con role=presentation (lo que Outlook entiende) y estilos en línea",
  () => {
    const html = renderEmailHtml({
      storeName: "Tienda",
      preheader: "p",
      paragraphsHtml: ["a"],
      cta: { label: "Ver", url: "https://a.test/" },
      footerNote: "f",
    });
    assert((html.match(/role="presentation"/g) ?? []).length >= 3);
    assertStringIncludes(html, 'style="margin:0 0 16px 0');
    assertStringIncludes(html, 'bgcolor="' + BRAND.accent + '"');
  },
);

Deno.test("layout: el nombre de la tienda, el texto previo, el botón y la nota se ESCAPAN", () => {
  const html = renderEmailHtml({
    storeName: `Chola <script>alert(1)</script>`,
    preheader: `pre "x" <i>`,
    paragraphsHtml: ["ok"],
    cta: { label: `Ver <b>"pedido"</b>`, url: `https://a.test/?a=1&b="2"` },
    footerNote: "5 < 6 & 7 > 3",
  });
  assertFalse(html.includes("<script"));
  assertFalse(html.includes("<b>"));
  assertFalse(html.includes("<i>"));
  assertStringIncludes(html, "Chola &lt;script&gt;alert(1)&lt;/script&gt;");
  assertStringIncludes(html, "https://a.test/?a=1&amp;b=&quot;2&quot;");
  assertStringIncludes(html, "5 &lt; 6 &amp; 7 &gt; 3");
  assertStringIncludes(html, 'rel="noopener"');
});

// ── Dinero y fechas ────────────────────────────────────────────────────────────────────────
Deno.test("formatAmount: coma decimal y punto de miles, como la tienda", () => {
  const bs = { symbol: "Bs", decimals: 2 };
  assertEquals(formatAmount(1234.5, bs), "Bs 1.234,50");
  assertEquals(formatAmount(100, bs), "Bs 100,00");
  assertEquals(formatAmount(0.5, bs), "Bs 0,50");
  assertEquals(formatAmount(0, bs), "Bs 0,00");
  assertEquals(formatAmount(-5, bs), "-Bs 5,00");
  assertEquals(formatAmount("250", bs), "Bs 250,00");
  assertEquals(formatAmount(1234567.891, { symbol: "Bs", decimals: 0 }), "Bs 1.234.568");
  assertEquals(formatAmount(1000000, bs), "Bs 1.000.000,00");
});

Deno.test(
  "formatAmount: sin datos de moneda usa el código; con algo que no es un número, vacío",
  () => {
    assertEquals(formatAmount(10, null, "BOB"), "BOB 10,00");
    assertEquals(formatAmount(10, undefined), "10,00");
    for (const bad of [null, undefined, "", "abc", NaN, Infinity])
      assertEquals(formatAmount(bad, { symbol: "Bs", decimals: 2 }), "", String(bad));
  },
);

Deno.test("formatDateLaPaz: hora de La Paz (UTC−4)", () => {
  const text = formatDateLaPaz("2026-11-15T18:30:00Z");
  assertStringIncludes(text, "14:30");
  assertStringIncludes(text, "2026");
  assertStringIncludes(text, "15");
});

Deno.test("formatDateLaPaz: cruza el día: 03:30 UTC del 16 es las 23:30 del 15 en La Paz", () => {
  const text = formatDateLaPaz("2026-11-16T03:30:00Z");
  assertStringIncludes(text, "23:30");
  assert(text.startsWith("15 "), text);
});

Deno.test(
  "formatDateLaPaz: medianoche es 00:xx (no 24:xx) y los valores inválidos dan vacío",
  () => {
    assertStringIncludes(formatDateLaPaz("2026-11-15T04:05:00Z"), "00:05");
    for (const bad of [null, undefined, "", "no es fecha"])
      assertEquals(formatDateLaPaz(bad as string), "", String(bad));
    assertStringIncludes(formatDateLaPaz(new Date("2026-11-15T18:30:00Z")), "14:30");
  },
);

Deno.test("firstName: primer nombre, recortado y sin romper con vacíos", () => {
  assertEquals(firstName("Ana María López"), "Ana");
  assertEquals(firstName("  Luz  "), "Luz");
  assertEquals(firstName(""), "");
  assertEquals(firstName("   "), "");
  assertEquals(firstName(null), "");
  assertEquals(firstName(undefined), "");
  assertEquals(Array.from(firstName("x".repeat(100))).length, 40);
  assertEquals(firstName("😀😀 y"), "😀😀");
});

// ── Variables de cada aviso ────────────────────────────────────────────────────────────────
Deno.test(
  "variables de la clienta: nombre, pedido, total con formato, enlace con sesión y hora de La Paz",
  () => {
    const v = buildVariables(row({}), SITE, CTX);
    assertEquals(v.customer_name, "Ana");
    assertEquals(v.order_number, "MIC-000123");
    assertEquals(v.order_total, "Bs 1.234,50");
    assertEquals(
      v.order_url,
      "https://tienda.test/cuenta/pedidos/11111111-1111-1111-1111-111111111111",
    );
    assertEquals(v.store_name, "Made In Chola");
    assertStringIncludes(v.payment_deadline ?? "", "10:00");
  },
);

Deno.test(
  "variables de la clienta: el reembolso y el motivo salen del contenido; sin pedido el enlace es la tienda",
  () => {
    const v = buildVariables(
      row({
        type: "order_refund_processed",
        order_id: null,
        payload: {
          number: "MIC-9",
          total: 100,
          currency: "BOB",
          amount: 40.25,
          reason: "Foto borrosa",
        },
      }),
      SITE,
      CTX,
    );
    assertEquals(v.refund_amount, "Bs 40,25");
    assertEquals(v.reason, "Foto borrosa");
    assertEquals(v.order_url, "https://tienda.test");
  },
);

Deno.test(
  "variables de la clienta: sin perfil ni vencimiento quedan vacías (el motor repara el saludo)",
  () => {
    const v = buildVariables(row({}), SITE, {
      customerName: null,
      currency: null,
      paymentExpiresAt: null,
    });
    assertEquals(v.customer_name, "");
    assertEquals(v.payment_deadline, "");
    assertEquals(v.order_total, "BOB 1.234,50");
  },
);

Deno.test("variables de una alerta interna: no llevan NINGÚN dato de la clienta", () => {
  const v = buildVariables(
    row({ type: "order_new", recipient: null, profile_id: null }),
    SITE,
    CTX,
  );
  assertFalse("customer_name" in v);
  assertFalse("order_url" in v);
  assertEquals(
    v.admin_url,
    "https://tienda.test/admin/pedidos/11111111-1111-1111-1111-111111111111",
  );
  assertFalse(Object.values(v).some((value) => value.includes("Ana")));
});

Deno.test("alertas internas: cada tipo apunta a su pantalla del panel", () => {
  const url = (type: string, over: Partial<OutboxRow> = {}) =>
    buildVariables(row({ type, recipient: null, profile_id: null, ...over }), SITE, CTX).admin_url;
  assertEquals(
    url("payment_review_needed", { order_id: null, payload: {} }),
    "https://tienda.test/admin/pagos",
  );
  assertEquals(
    url("payment_unknown_reference", { order_id: null, payload: {} }),
    "https://tienda.test/admin/pagos",
  );
  assertEquals(
    url("webhook_signature_invalid", { order_id: null, payload: {} }),
    "https://tienda.test/admin/pagos",
  );
  assertEquals(
    url("stock_alert", { order_id: null, payload: {} }),
    "https://tienda.test/admin/productos",
  );
  assertEquals(
    url("notification_dead", { order_id: null, payload: {} }),
    "https://tienda.test/admin/notificaciones",
  );
  assertEquals(
    url("template_fallback", { order_id: null, payload: {} }),
    "https://tienda.test/admin/notificaciones",
  );
  assertEquals(url("algo_raro", { order_id: null, payload: {} }), "https://tienda.test/admin");
});

Deno.test("alerta de stock: variante, nivel y umbral según el nivel cruzado", () => {
  const payload = {
    product_name: "Chaqueta",
    product_code: "CHA-1",
    color: "Arena",
    size: "M",
    stock: 4,
    light: "low",
    low_threshold: 5,
    critical_threshold: 2,
  };
  const low = buildVariables(
    row({ type: "stock_alert", recipient: null, order_id: null, payload }),
    SITE,
    CTX,
  );
  assertEquals(low.variant, "Arena / M");
  assertEquals(low.light_label, "bajo");
  assertEquals(low.threshold, "5");
  assertEquals(low.stock, "4");
  const crit = buildVariables(
    row({
      type: "stock_alert",
      recipient: null,
      order_id: null,
      payload: { ...payload, light: "critical", stock: 1 },
    }),
    SITE,
    CTX,
  );
  assertEquals(crit.light_label, "crítico");
  assertEquals(crit.threshold, "2");
  const out = buildVariables(
    row({
      type: "stock_alert",
      recipient: null,
      order_id: null,
      payload: { ...payload, light: "out", stock: 0, size: null },
    }),
    SITE,
    CTX,
  );
  assertEquals(out.light_label, "agotado");
  assertEquals(out.variant, "Arena");
});

Deno.test(
  "alerta de revisión de pago: el motivo se escribe en palabras; uno desconocido pasa tal cual",
  () => {
    const reason = (value: string) =>
      buildVariables(
        row({
          type: "payment_review_needed",
          recipient: null,
          order_id: null,
          payload: { reason: value },
        }),
        SITE,
        CTX,
      ).reason;
    assertStringIncludes(reason("late") ?? "", "cancelado");
    assertStringIncludes(reason("duplicate") ?? "", "duplicado");
    assertEquals(reason("otra_cosa"), "otra_cosa");
  },
);

Deno.test("aviso perdido: tipo, canal en palabras y error", () => {
  const v = buildVariables(
    row({
      type: "notification_dead",
      recipient: null,
      order_id: null,
      payload: { notification_type: "order_shipped", channel: "whatsapp", error: "provider_down" },
    }),
    SITE,
    CTX,
  );
  assertEquals(v.notification_type, "order_shipped");
  assertEquals(v.channel, "WhatsApp");
  assertEquals(v.error, "provider_down");
});

Deno.test(
  "el catálogo de variables y los valores de ejemplo coinciden (sin variables huérfanas)",
  () => {
    const customer = sampleVariables("customer", SITE);
    const admin = sampleVariables("admin", SITE);
    for (const info of VARIABLE_CATALOG) {
      if (info.audience === "customer" || info.audience === "both")
        assert(info.name in customer, `falta en el ejemplo de la clienta: ${info.name}`);
      if (info.audience === "admin" || info.audience === "both")
        assert(info.name in admin, `falta en el ejemplo del administrador: ${info.name}`);
    }
    assertEquals(
      new Set(VARIABLE_CATALOG.map((info) => info.name)).size,
      VARIABLE_CATALOG.length,
      "sin nombres repetidos",
    );
    for (const info of VARIABLE_CATALOG)
      assert(/^[a-z_][a-z0-9_]{0,40}$/.test(info.name), info.name);
  },
);

Deno.test(
  "lo que construye buildVariables está en el catálogo (nada que el editor no documente)",
  () => {
    const names = new Set(VARIABLE_CATALOG.map((info) => info.name));
    for (const r of [row({}), row({ recipient: null, profile_id: null })])
      for (const key of Object.keys(buildVariables(r, SITE, CTX)))
        assert(names.has(key), `variable sin documentar: ${key}`);
  },
);
