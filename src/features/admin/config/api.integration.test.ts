import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import {
  clearRateLimits,
  localEnv,
  randomTag,
  registerAndLogin,
  rest,
  svcRpc,
} from "../../../../test-support/api";

// Los servicios usan getSupabase(): aquí apunta a un cliente REAL contra Supabase local (visitante, cliente o admin).
const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => holder.client }));

import { StaleVersionError } from "../lib/versioned";
import {
  createBanner,
  createExchangeRate,
  getCurrentRates,
  listBanners,
  listCountries,
  listCurrencies,
  listImpactCandidates,
  listRateHistory,
  listSettings,
  saveSettings,
  setBannerActive,
  setBannerArchived,
  setCurrencyEnabled,
  updateBanner,
  type SettingChange,
} from "./api";

function clientWith(token?: string): SupabaseClient<Database> {
  const env = localEnv();
  return createClient<Database>(env.url, env.anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
  });
}

let adminToken = "";
let customerToken = "";
const asAdmin = () => void (holder.client = clientWith(adminToken));
const asCustomer = () => void (holder.client = clientWith(customerToken));
const asAnon = () => void (holder.client = clientWith());

const originalSettings = new Map<string, string | number>();
const createdBanners: string[] = [];

beforeAll(async () => {
  await clearRateLimits();
  const admin = await registerAndLogin({ name: "Admin Config" });
  expect((await svcRpc("promote_admin", { p_email: admin.email })).status).toBe(200);
  adminToken = admin.token;
  customerToken = (await registerAndLogin({ name: "Cliente Config" })).token;
  asAdmin();
  for (const s of await listSettings()) originalSettings.set(s.key, s.value as string | number);
}, 60_000);

/** Estado global compartido con otras pruebas: se devuelve a como estaba, pase lo que pase. */
afterAll(async () => {
  asAdmin();
  const current = new Map((await listSettings()).map((s) => [s.key, s]));
  const restore = async (key: string) => {
    const row = current.get(key);
    const original = originalSettings.get(key);
    if (!row || original === undefined || row.value === original) return;
    await saveSettings([{ key, value: original, updatedAt: row.updatedAt }]);
  };
  // La base valida cada umbral contra el otro: subir el bajo antes que el crítico, y bajar el crítico antes que el bajo.
  await restore("stock_low_threshold");
  await restore("stock_critical_threshold");
  for (const key of originalSettings.keys()) {
    if (key !== "stock_low_threshold" && key !== "stock_critical_threshold") await restore(key);
  }
  for (const id of createdBanners) {
    const banner = (await listBanners()).find((b) => b.id === id);
    if (banner && !banner.archived) await setBannerArchived(banner, true);
  }
  for (const c of await listCurrencies())
    if (c.enabled && c.code !== "BOB") await setCurrencyEnabled(c, false).catch(() => undefined);
}, 60_000);

const setting = async (key: string) => {
  const row = (await listSettings()).find((s) => s.key === key);
  if (!row) throw new Error(`ajuste ${key} no encontrado`);
  return row;
};
const change = (
  row: { key: string; updatedAt: string },
  value: string | number,
): SettingChange => ({
  key: row.key,
  value,
  updatedAt: row.updatedAt,
});

describe("ajustes (BD real)", () => {
  it("lista todos los ajustes, también los no públicos, con su tipo", async () => {
    const all = await listSettings();
    const byKey = new Map(all.map((s) => [s.key, s]));
    for (const key of [
      "business_name",
      "contact_email",
      "whatsapp_orders",
      "social_instagram",
      "stock_low_threshold",
      "stock_critical_threshold",
      "reservation_ttl_minutes",
      "default_out_of_stock_behavior",
      "base_currency",
    ]) {
      expect(byKey.has(key), key).toBe(true);
    }
    expect(byKey.get("stock_low_threshold")).toMatchObject({ valueType: "int", isPublic: false });
    expect(byKey.get("contact_email")).toMatchObject({ valueType: "email", isPublic: true });
    expect(byKey.get("whatsapp_orders")?.valueType).toBe("phone_e164");
  });

  it("guarda un texto con control de versión y devuelve la versión nueva", async () => {
    const before = await setting("business_name");
    const [result] = await saveSettings([change(before, "Made In Chola QA")]);
    expect(result).toMatchObject({ key: "business_name", ok: true });
    const after = await setting("business_name");
    expect(after.value).toBe("Made In Chola QA");
    expect(result?.ok && result.updatedAt).toBe(after.updatedAt);
    expect(after.updatedAt).not.toBe(before.updatedAt);
  });

  it("una versión vieja se rechaza como conflicto (stale) y no pisa el valor", async () => {
    const seen = await setting("pdp_assistance_text");
    await saveSettings([change(seen, "Texto de la persona A")]);
    const [lost] = await saveSettings([change(seen, "Texto de la persona B")]);
    expect(lost).toMatchObject({ ok: false, stale: true });
    expect((await setting("pdp_assistance_text")).value).toBe("Texto de la persona A");
  });

  it("la base valida por tipo: email, https, teléfono E.164 y enteros (cada error llega en español)", async () => {
    const cases: [string, string | number, RegExp][] = [
      ["contact_email", "no-es-email", /correo válido/],
      ["contact_email", "Mayusculas@Test.com", /minúsculas/],
      ["social_instagram", "http://instagram.com/x", /enlace https/],
      ["social_instagram", "javascript:alert(1)", /enlace https/],
      ["whatsapp_orders", "71234567", /E\.164/],
      ["whatsapp_orders", "+0123456789", /E\.164/],
      ["stock_low_threshold", -1, /entero/],
      ["stock_low_threshold", "abc", /entero/],
      ["default_out_of_stock_behavior", "borrar", /sold_out u hide/],
    ];
    for (const [key, value, message] of cases) {
      const row = await setting(key);
      const [r] = await saveSettings([change(row, value)]);
      expect(r?.ok, `${key} = ${String(value)}`).toBe(false);
      expect(r && !r.ok && r.error.message, `${key} = ${String(value)}`).toMatch(message);
      expect((await setting(key)).value).toBe(row.value); // no cambió
    }
  });

  it("valores válidos al límite: teléfono de 8 y de 15 dígitos, https con ruta, entero grande", async () => {
    const phone = await setting("whatsapp_orders");
    for (const ok of ["+59171234", "+591712345678901".slice(0, 16)]) {
      const row = await setting("whatsapp_orders");
      const [r] = await saveSettings([change(row, ok)]);
      expect(r?.ok, ok).toBe(true);
    }
    await saveSettings([change(await setting("whatsapp_orders"), phone.value as string)]);
    const ig = await setting("social_instagram");
    expect(
      (await saveSettings([change(ig, "https://www.instagram.com/madeinchola/?hl=es")]))[0]?.ok,
    ).toBe(true);
    await saveSettings([change(await setting("social_instagram"), ig.value as string)]);
  });

  it("umbrales: el crítico no puede superar al de aviso ni al revés; el ORDEN importa al mover los dos", async () => {
    const low = await setting("stock_low_threshold");
    const critical = await setting("stock_critical_threshold");
    expect(low.value).toBe(5);
    expect(critical.value).toBe(2);
    // crítico por encima del bajo: rechazado
    const [bad] = await saveSettings([change(critical, 9)]);
    expect(bad?.ok).toBe(false);
    expect(bad && !bad.ok && bad.error.message).toMatch(/no puede superar/);
    // bajo por debajo del crítico: rechazado
    const [bad2] = await saveSettings([change(low, 1)]);
    expect(bad2?.ok).toBe(false);
    expect(bad2 && !bad2.ok && bad2.error.message).toMatch(/no puede ser menor/);
    // subir ambos: primero el bajo (10), luego el crítico (9)
    const up = await saveSettings([
      change(low, 10),
      change(await setting("stock_critical_threshold"), 9),
    ]);
    expect(up.map((r) => r.ok)).toEqual([true, true]);
    // en el orden contrario fallaría el primero (crítico 3 con bajo 10 sí cabe; subir crítico a 11 no)
    const wrongOrder = await saveSettings([change(await setting("stock_critical_threshold"), 11)]);
    expect(wrongOrder[0]?.ok).toBe(false);
    // volver a como estaba: bajar primero el crítico, luego el bajo
    const down = await saveSettings([
      change(await setting("stock_critical_threshold"), 2),
      change(await setting("stock_low_threshold"), 5),
    ]);
    expect(down.map((r) => r.ok)).toEqual([true, true]);
  });

  it("un fallo no detiene a los demás: se informa un resultado por clave", async () => {
    const bad = await setting("contact_email");
    const good = await setting("pdp_shipping_return_text");
    const results = await saveSettings([
      change(bad, "nope"),
      change(good, "Política provisional QA"),
    ]);
    expect(results.map((r) => [r.key, r.ok])).toEqual([
      ["contact_email", false],
      ["pdp_shipping_return_text", true],
    ]);
  });

  it("un cliente NO puede cambiar ajustes (la base lo impide) y el valor queda intacto", async () => {
    const row = await setting("business_name");
    asCustomer();
    try {
      const [r] = await saveSettings([change(row, "Hackeado")]);
      expect(r?.ok).toBe(false);
    } finally {
      asAdmin();
    }
    expect((await setting("business_name")).value).not.toBe("Hackeado");
  });

  it("cambiar un ajuste queda en la auditoría con quién lo hizo", async () => {
    const row = await setting("business_name");
    await saveSettings([change(row, `Auditado ${randomTag()}`)]);
    const audit = await rest(
      "GET",
      "audit_log?table_name=eq.store_settings&order=id.desc&limit=1&select=action,record_id,actor_role",
      adminToken,
    );
    expect(audit.body[0]).toMatchObject({
      action: "UPDATE",
      record_id: "business_name",
      actor_role: "authenticated",
    });
  });
});

describe("banner de noticias (BD real)", () => {
  const payload = (over: Partial<Parameters<typeof createBanner>[0]> = {}) => ({
    message: `Envío gratis ${randomTag()}`,
    link_url: null,
    starts_at: null,
    ends_at: null,
    is_active: false,
    ...over,
  });
  const make = async (over: Partial<Parameters<typeof createBanner>[0]> = {}) => {
    const b = await createBanner(payload(over));
    createdBanners.push(b.id);
    return b;
  };
  const fresh = async (id: string) => {
    const b = (await listBanners()).find((x) => x.id === id);
    if (!b) throw new Error("banner no encontrado");
    return b;
  };

  it("crea, lista (también archivados) y actualiza con versión", async () => {
    const b = await make({ link_url: "/coleccion/verano" });
    expect(b).toMatchObject({ isActive: false, archived: false, linkUrl: "/coleccion/verano" });
    await updateBanner(
      b,
      payload({ message: "Mensaje nuevo", link_url: "https://madeinchola.com/x" }),
    );
    expect(await fresh(b.id)).toMatchObject({
      message: "Mensaje nuevo",
      linkUrl: "https://madeinchola.com/x",
    });
    await expect(updateBanner(b, payload({ message: "Con versión vieja" }))).rejects.toBeInstanceOf(
      StaleVersionError,
    );
    expect((await fresh(b.id)).message).toBe("Mensaje nuevo");
  });

  it("la base rechaza mensaje vacío o de más de 200, fin ≤ inicio y enlaces inseguros", async () => {
    await expect(createBanner(payload({ message: "   " }))).rejects.toThrow();
    await expect(createBanner(payload({ message: "x".repeat(201) }))).rejects.toThrow();
    await expect(
      createBanner(payload({ starts_at: "2026-12-10T00:00:00Z", ends_at: "2026-12-01T00:00:00Z" })),
    ).rejects.toThrow();
    for (const link of [
      "javascript:alert(1)",
      "http://inseguro.com",
      "//evil.com",
      "data:text/html,x",
      "https://con espacio.com",
    ]) {
      await expect(createBanner(payload({ link_url: link })), link).rejects.toThrow();
    }
    // el límite exacto (200) sí vale
    expect((await make({ message: "x".repeat(200) })).message).toHaveLength(200);
  });

  it("activar y archivar; el visitante solo ve el banner activo, vigente y no archivado", async () => {
    const tag = randomTag();
    const b = await make({ message: `Visible ${tag}` });
    const seenByAnon = async () => {
      asAnon();
      try {
        const r = await (holder.client as SupabaseClient<Database>)
          .from("public_news_banners")
          .select("message")
          .eq("message", `Visible ${tag}`);
        return r.data?.length ?? -1;
      } finally {
        asAdmin();
      }
    };
    expect(await seenByAnon()).toBe(0); // inactivo
    await setBannerActive(b, true);
    expect(await seenByAnon()).toBe(1);
    await setBannerArchived(await fresh(b.id), true);
    expect(await seenByAnon()).toBe(0); // archivado
    await setBannerArchived(await fresh(b.id), false);
    expect(await seenByAnon()).toBe(1);
    await setBannerActive(await fresh(b.id), false);
  });

  it("un banner con vigencia futura o ya vencida no se muestra al visitante", async () => {
    const tag = randomTag();
    const day = 86_400_000;
    await make({
      message: `Futuro ${tag}`,
      is_active: true,
      starts_at: new Date(Date.now() + 2 * day).toISOString(),
      ends_at: new Date(Date.now() + 3 * day).toISOString(),
    });
    await make({
      message: `Vencido ${tag}`,
      is_active: true,
      starts_at: new Date(Date.now() - 3 * day).toISOString(),
      ends_at: new Date(Date.now() - 2 * day).toISOString(),
    });
    asAnon();
    try {
      const r = await (holder.client as SupabaseClient<Database>)
        .from("public_news_banners")
        .select("message")
        .like("message", `%${tag}`);
      expect(r.data).toEqual([]);
    } finally {
      asAdmin();
    }
  });

  it("un cliente no puede crear banners", async () => {
    asCustomer();
    try {
      await expect(createBanner(payload())).rejects.toThrow();
    } finally {
      asAdmin();
    }
  });
});

describe("monedas (BD real)", () => {
  it("lista las monedas con la base habilitada y los países", async () => {
    const list = await listCurrencies();
    expect(list.find((c) => c.code === "BOB")).toMatchObject({
      enabled: true,
      decimals: 2,
      symbol: "Bs",
    });
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect((await listCountries()).find((c) => c.code === "BO")).toMatchObject({
      currencyCode: "BOB",
    });
  });

  it("activar y desactivar una moneda con versión; la base NO deja desactivar BOB", async () => {
    const mxn = (await listCurrencies()).find((c) => c.code === "EUR");
    if (!mxn) throw new Error("EUR no existe");
    await setCurrencyEnabled(mxn, true);
    expect((await listCurrencies()).find((c) => c.code === "EUR")?.enabled).toBe(true);
    await expect(setCurrencyEnabled(mxn, false)).rejects.toBeInstanceOf(StaleVersionError); // versión vieja
    const fresh = (await listCurrencies()).find((c) => c.code === "EUR");
    if (!fresh) throw new Error("EUR");
    await setCurrencyEnabled(fresh, false);
    const bob = (await listCurrencies()).find((c) => c.code === "BOB");
    if (!bob) throw new Error("BOB");
    await expect(setCurrencyEnabled(bob, false)).rejects.toThrow();
    expect((await listCurrencies()).find((c) => c.code === "BOB")?.enabled).toBe(true);
  });

  it("un cliente no puede activar monedas", async () => {
    const usd = (await listCurrencies()).find((c) => c.code === "USD");
    if (!usd) throw new Error("USD");
    asCustomer();
    try {
      await expect(setCurrencyEnabled(usd, !usd.enabled)).rejects.toThrow();
    } finally {
      asAdmin();
    }
    expect((await listCurrencies()).find((c) => c.code === "USD")?.enabled).toBe(usd.enabled);
  });
});

describe("tipos de cambio: libro inmutable (BD real)", () => {
  const at = (iso: string) => new Date(iso);
  const rate = (
    to: string,
    value: string,
    validFrom: string | null,
    mode: "fixed" | "variable" = "fixed",
  ) => createExchangeRate({ toCurrency: to, rate: value, mode, validFrom });

  it("la tasa vigente es la de valid_from más reciente que ya empezó; ante empate gana el último insertado", async () => {
    const day = (d: string) => `${d}T00:00:00.000Z`;
    await rate("EUR", "17", day("2000-01-01"));
    await rate("EUR", "18", day("2000-03-01"));
    await rate("EUR", "18.5", day("2000-03-01")); // mismo instante: gana el id mayor
    await rate("EUR", "19", day("2000-09-01"));
    const at1 = async (d: string) => (await getCurrentRates(["EUR"], at(d))).EUR?.rate ?? null;
    expect(await at1("1999-12-31T00:00:00Z")).toBeNull(); // todavía no hay tasa
    expect(await at1("2000-02-01T00:00:00Z")).toBe("17");
    expect(await at1("2000-06-01T00:00:00Z")).toBe("18.5");
    expect(await at1("2000-12-01T00:00:00Z")).toBe("19");
  });

  it("una tasa con fecha FUTURA no se aplica todavía", async () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const before =
      (await getCurrentRates(["ARS"], new Date(Date.now() + 60_000))).ARS?.rate ?? null;
    await rate("ARS", "999.5", future);
    expect((await getCurrentRates(["ARS"], new Date(Date.now() + 60_000))).ARS?.rate ?? null).toBe(
      before,
    );
    expect((await getCurrentRates(["ARS"], new Date(Date.now() + 20 * 86_400_000))).ARS?.rate).toBe(
      "999.5",
    );
  });

  it("sin fecha, la base pone 'ahora' y la tasa es la vigente", async () => {
    await rate("USD", "0.5", null, "variable");
    const current = (await getCurrentRates(["USD"], new Date(Date.now() + 60_000))).USD;
    expect(current).toMatchObject({
      rate: "0.5",
      mode: "variable",
      fromCurrency: "BOB",
      toCurrency: "USD",
    });
  });

  it("acepta los extremos válidos y rechaza cero, negativas, texto, la misma moneda y modos inválidos", async () => {
    await expect(rate("ARS", "0.00000001", "2000-01-01T00:00:00.000Z")).resolves.toBeUndefined();
    await expect(
      rate("ARS", "9999999999.99999999", "2000-01-02T00:00:00.000Z"),
    ).resolves.toBeUndefined();
    await expect(rate("ARS", "0", null)).rejects.toThrow();
    await expect(rate("ARS", "-1", null)).rejects.toThrow();
    await expect(rate("ARS", "abc", null)).rejects.toThrow(
      "Algún dato tiene un formato no válido.",
    );
    await expect(rate("BOB", "1", null)).rejects.toThrow(); // BOB → BOB
    await expect(
      createExchangeRate({ toCurrency: "ARS", rate: "1", mode: "otro" as never, validFrom: null }),
    ).rejects.toThrow();
    await expect(rate("XXX", "1", null)).rejects.toThrow(); // moneda inexistente
  });

  it("el libro es INMUTABLE: ni el admin puede editar ni borrar una fila", async () => {
    const page = await listRateHistory(1, 1);
    const id = page.rows[0]?.id;
    expect(id).toBeDefined();
    const patch = await rest("PATCH", `exchange_rates?id=eq.${id}`, adminToken, { rate: 1 });
    expect(patch.status).toBeGreaterThanOrEqual(400);
    const del = await rest("DELETE", `exchange_rates?id=eq.${id}`, adminToken);
    expect(del.status).toBeGreaterThanOrEqual(400);
    expect((await listRateHistory(1, 1)).rows[0]?.id).toBe(id);
  });

  it("el historial viene del más reciente al más antiguo, con total exacto y páginas sin repetir", async () => {
    const p1 = await listRateHistory(1, 3);
    const p2 = await listRateHistory(2, 3);
    expect(p1.total).toBeGreaterThanOrEqual(8);
    expect(p1.rows).toHaveLength(3);
    const ids = [...p1.rows, ...p2.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = [...p1.rows, ...p2.rows].map((r) => [r.validFrom, r.id] as const);
    const sorted = [...keys].sort((a, b) =>
      a[0] === b[0] ? b[1] - a[1] : b[0].localeCompare(a[0]),
    );
    expect(keys).toEqual(sorted);
  });

  it("un cliente no puede agregar tipos de cambio", async () => {
    asCustomer();
    try {
      await expect(rate("EUR", "20", null)).rejects.toThrow();
    } finally {
      asAdmin();
    }
  });
});

describe("vista previa de impacto: candidatos (BD real)", () => {
  it("incluye productos publicados con 'calcular desde bolivianos' y SIN precio propio en esa moneda", async () => {
    const tag = randomTag();
    const make = async (
      suffix: string,
      o: { active: boolean; allow: boolean; own?: boolean; archived?: boolean },
    ) => {
      const p = await rest("POST", "products", adminToken, {
        code: `IMP-${tag}-${suffix}`,
        slug: `imp-${tag}-${suffix}`,
        name: `Aaa impacto ${tag} ${suffix}`,
        allow_converted_prices: o.allow,
      });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
      const id = p.body[0].id as string;
      const c = await rest("POST", "product_colors", adminToken, { product_id: id, name: "Único" });
      await rest("POST", "product_variants", adminToken, {
        product_id: id,
        color_id: c.body[0].id,
      });
      await rest("POST", "product_prices", adminToken, {
        product_id: id,
        currency: "BOB",
        amount: 100,
      });
      if (o.own) {
        const price = await rest("POST", "product_prices", adminToken, {
          product_id: id,
          currency: "EUR",
          amount: 5,
        });
        expect(price.status, `precio propio en EUR: ${JSON.stringify(price.body)}`).toBe(201);
      }
      if (o.active) await rest("PATCH", `products?id=eq.${id}`, adminToken, { status: "active" });
      if (o.archived)
        await rest("PATCH", `products?id=eq.${id}`, adminToken, {
          archived_at: new Date().toISOString(),
        });
      return id;
    };
    const mxn = (await listCurrencies()).find((c) => c.code === "EUR");
    if (!mxn) throw new Error("EUR");
    await setCurrencyEnabled(mxn, true); // sin la moneda activa no se puede dar un precio propio en ella
    const included = await make("a", { active: true, allow: true });
    const own = await make("b", { active: true, allow: true, own: true });
    const draft = await make("c", { active: false, allow: true });
    const noAllow = await make("d", { active: true, allow: false });
    const archived = await make("e", { active: true, allow: true, archived: true });
    const result = await listImpactCandidates("EUR");
    const ids = result.products.map((p) => p.id);
    expect(ids).toContain(included);
    expect(ids).not.toContain(own); // con precio propio, el tipo de cambio no lo cambia
    expect(ids).not.toContain(draft);
    expect(ids).not.toContain(noAllow);
    expect(ids).not.toContain(archived);
    expect(result.products.find((p) => p.id === included)).toMatchObject({
      priceBob: "100",
      code: `IMP-${tag}-a`,
    });
    expect(result.products.length).toBeLessThanOrEqual(10);
    expect(result.total).toBeGreaterThanOrEqual(1);
  });
});
