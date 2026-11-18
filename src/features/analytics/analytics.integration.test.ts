import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearRateLimits,
  dbSql,
  fn,
  randomTag,
  rest,
  rpc,
  svcRest,
  testEnv,
} from "../../../test-support/api";
import { adminSession, makeCustomer, makeProduct, type Customer } from "../../../test-support/shop";

/**
 * Analítica y atribución (Sprint 15) contra la nube, por HTTP real: los ajustes del Pixel y de GA4 con su validación, la función
 * `meta-capi` desplegada (sin token de Meta no hace NADA y no llama a nadie), y `record_order_attribution` / `admin_attribution_summary`
 * con los permisos de cada rol. Lo que NO se prueba aquí: el envío real a Meta (no hay token ni Pixel reales; lo cubren las pruebas
 * unitarias con un `fetch` simulado) ni la carga de los scripts de Google y Meta (lo cubre el E2E con un servidor simulado).
 *
 * Deja en la nube una clienta de prueba inerte, un producto de prueba y un pedido cancelado; los ajustes que toca se restituyen.
 */

let admin: string | null = null;
let skipReason: string | null = null;
let buyer: Customer;
let other: Customer;
let orderNumber = "";
let orderId = "";
const original: Record<string, unknown> = {};
const KEYS = ["analytics_meta_pixel_id", "analytics_ga4_id"];

const key = () => `k-${randomTag()}-${randomTag()}`;

beforeAll(async () => {
  const session = await adminSession();
  if (!session) {
    skipReason = "No hay una cuenta de administración de prueba (@prueba.test) para entrar.";
    return;
  }
  admin = session.token;
  await clearRateLimits();
  for (const k of KEYS) {
    const row = await svcRest("GET", `store_settings?key=eq.${k}&select=value`);
    original[k] = row.body[0]?.value ?? "";
  }
  buyer = await makeCustomer();
  other = await makeCustomer();
  // un pedido real y reciente de la compradora (sin textos legales publicados, el pago no exige aceptar nada)
  const product = await makeProduct(60, 5);
  await fn(
    "cart",
    { action: "set_item", variant_id: product.variantId, qty: 1 },
    { token: buyer.token },
  );
  const preview = await fn(
    "checkout",
    {
      action: "preview",
      shipping_method: "delivery",
      address_id: buyer.addressId,
      payment_method: "whatsapp",
    },
    { token: buyer.token },
  );
  const total = preview.body.checkout.totals.total as number;
  const created = await fn(
    "checkout",
    {
      action: "create",
      shipping_method: "delivery",
      address_id: buyer.addressId,
      payment_method: "whatsapp",
      contact_name: "Clienta analítica",
      contact_phone: "+59171234567",
      expected_total: total,
      idempotency_key: key(),
    },
    { token: buyer.token },
  );
  if (created.body.outcome !== "created") {
    skipReason = `No se pudo crear el pedido de prueba: ${JSON.stringify(created.body)}`;
    return;
  }
  orderNumber = created.body.order.number as string;
  orderId = created.body.order.id as string;
}, 180_000);

afterAll(async () => {
  for (const k of KEYS)
    await svcRest("PATCH", `store_settings?key=eq.${k}`, { value: original[k] ?? "" });
  if (orderId && buyer)
    await fn("checkout", { action: "cancel", order_id: orderId }, { token: buyer.token });
  await clearRateLimits();
}, 120_000);

const guard = (ctx: { skip: (note?: string) => void }) => {
  if (skipReason) ctx.skip(skipReason);
};
const setSetting = (k: string, value: unknown) =>
  rest("PATCH", `store_settings?key=eq.${k}`, admin!, { value });

describe("analítica · ajustes", () => {
  it("nacen vacíos y son PÚBLICOS: cualquiera (también sin sesión) los lee, y nada secreto los acompaña", async (ctx) => {
    guard(ctx);
    const rows = await rest("GET", "public_store_settings?select=key,value");
    const byKey = new Map(
      (rows.body as { key: string; value: unknown }[]).map((r) => [r.key, r.value]),
    );
    expect(byKey.has("analytics_meta_pixel_id")).toBe(true);
    expect(byKey.has("analytics_ga4_id")).toBe(true);
    expect([...byKey.keys()].filter((k) => /token|secret|capi/i.test(k))).toEqual([]);
  });

  it("el administrador pone IDs válidos y la base rechaza los que no lo son", async (ctx) => {
    guard(ctx);
    expect((await setSetting("analytics_meta_pixel_id", "1234567890123")).status).toBeLessThan(300);
    expect((await setSetting("analytics_ga4_id", "G-ABC123DEF4")).status).toBeLessThan(300);
    for (const [k, bad] of [
      ["analytics_meta_pixel_id", "abc"],
      ["analytics_meta_pixel_id", "12345678');alert(1);//"],
      ["analytics_ga4_id", "UA-1-1"],
      ["analytics_ga4_id", "g-abc123def4"],
      ["analytics_ga4_id", 5],
    ] as const) {
      const res = await setSetting(k, bad);
      expect(res.status, `${k}=${JSON.stringify(bad)}`).toBe(400);
    }
    const now = await svcRest("GET", "store_settings?key=eq.analytics_meta_pixel_id&select=value");
    expect(now.body[0].value).toBe("1234567890123"); // el rechazo no cambió nada
  });

  it("una clienta NO puede cambiar los ajustes (RLS)", async (ctx) => {
    guard(ctx);
    const res = await rest("PATCH", "store_settings?key=eq.analytics_ga4_id", buyer.token, {
      value: "G-HACKEADO1",
    });
    expect([200, 204]).toContain(res.status);
    const after = await svcRest("GET", "store_settings?key=eq.analytics_ga4_id&select=value");
    expect(after.body[0].value).toBe("G-ABC123DEF4");
  });
});

describe("analítica · función meta-capi (desplegada)", () => {
  const call = (body: unknown, token?: string) => fn("meta-capi", body, token ? { token } : {});
  const valid = () => ({ order_number: orderNumber, event_id: `purchase.${orderNumber}` });

  it("sin sesión → 401 y la clave anónima no vale como sesión", async (ctx) => {
    guard(ctx);
    expect((await call(valid())).status).toBe(401);
    expect((await call(valid(), testEnv().anon)).status).toBe(401);
  });

  it("el esquema es estricto: campos de más (un valor, un correo), un número de pedido raro o un event_id ajeno → 400", async (ctx) => {
    guard(ctx);
    for (const body of [
      { ...valid(), value: 99999 },
      { ...valid(), email: "a@b.c" },
      { ...valid(), order_number: "mic-1" },
      { ...valid(), order_number: "MIC-000123; drop" },
      { order_number: orderNumber },
      { ...valid(), source_url: "http://inseguro.test/" },
    ]) {
      const res = await call(body, buyer.token);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const wrongId = await call(
      { order_number: orderNumber, event_id: "purchase.MIC-999999" },
      buyer.token,
    );
    expect(wrongId.status).toBe(400);
    expect(wrongId.body.error.code).toBe("invalid_event_id");
  });

  it("con Pixel configurado pero SIN token de Meta en el servidor no envía nada: not_configured, y no filtra nada", async (ctx) => {
    guard(ctx);
    const res = await call(
      {
        ...valid(),
        fbp: "fb.1.1700000000.123456",
        source_url: "https://madeinchola.test/pedido/x",
      },
      buyer.token,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ ok: true, sent: false, reason: "not_configured" });
    expect(JSON.stringify(res.body)).not.toMatch(/token|access/i);
  });

  it("solo POST: GET → 405", async (ctx) => {
    guard(ctx);
    const res = await fetch(`${testEnv().url}/functions/v1/meta-capi`, {
      method: "GET",
      headers: { apikey: testEnv().anon },
    });
    expect(res.status).toBe(405);
  });
});

describe("atribución · record_order_attribution y el resumen por origen", () => {
  it("solo la dueña anota el origen de su pedido; una vez; limpio; sin sesión o de otra persona se rechaza", async (ctx) => {
    guard(ctx);
    const data = {
      utm_source: " Facebook ",
      utm_medium: "CPC",
      utm_campaign: "lanzamiento",
      click_id_kind: "fbclid",
      landing_path: "/producto/blusa",
      referrer_host: "L.Facebook.com",
      fbclid: "IwAR-secreto",
    };
    const anon = await rpc("record_order_attribution", { p_number: orderNumber, p_data: data });
    expect(anon.status).toBeGreaterThanOrEqual(400);
    const foreign = await rpc(
      "record_order_attribution",
      { p_number: orderNumber, p_data: data },
      other.token,
    );
    expect(foreign.status).toBe(400);
    expect(foreign.body.message).toBe("order_not_found");

    const mine = await rpc(
      "record_order_attribution",
      { p_number: orderNumber, p_data: data },
      buyer.token,
    );
    expect(mine.status, JSON.stringify(mine.body)).toBeLessThan(300);
    const row = dbSql(
      `select concat_ws('|', utm_source, utm_medium, utm_campaign, click_id_kind, landing_path, referrer_host)
         from public.order_attribution where order_id = '${orderId}'`,
    );
    expect(row).toBe("facebook|cpc|lanzamiento|fbclid|/producto/blusa|l.facebook.com");
    // lo que no tiene dónde guardarse no se guarda: el identificador del clic NO está en ninguna columna
    expect(
      dbSql(
        `select (to_jsonb(a)::text like '%secreto%') from public.order_attribution a where order_id = '${orderId}'`,
      ),
    ).toBe("f");

    // una segunda vez no pisa lo primero
    const again = await rpc(
      "record_order_attribution",
      { p_number: orderNumber, p_data: { utm_source: "google" } },
      buyer.token,
    );
    expect(again.status).toBeLessThan(300);
    expect(
      dbSql(`select utm_source from public.order_attribution where order_id = '${orderId}'`),
    ).toBe("facebook");
  });

  it("la tabla no se lee ni se escribe por la API (ni la dueña ni el servicio)", async (ctx) => {
    guard(ctx);
    for (const read of [
      await rest("GET", "order_attribution?select=*", buyer.token),
      await svcRest("GET", "order_attribution?select=*"),
    ]) {
      expect(read.status === 200 ? read.body : []).toEqual([]);
    }
    expect(
      (await svcRest("POST", "order_attribution", { order_id: orderId, utm_source: "x" })).status,
    ).toBeGreaterThanOrEqual(400);
  });

  it("el resumen por origen lo ejecuta SOLO un administrador", async (ctx) => {
    guard(ctx);
    const range = { p_from: "2026-01-01", p_to: "2026-12-31" };
    expect((await rpc("admin_attribution_summary", range)).status).toBeGreaterThanOrEqual(400);
    expect(
      (await rpc("admin_attribution_summary", range, buyer.token)).status,
    ).toBeGreaterThanOrEqual(400);
    const ok = await rpc("admin_attribution_summary", range, admin!);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(Array.isArray(ok.body)).toBe(true);
    const bad = await rpc(
      "admin_attribution_summary",
      { p_from: "2026-12-31", p_to: "2026-01-01" },
      admin!,
    );
    expect(bad.status).toBe(400);
  });
});
