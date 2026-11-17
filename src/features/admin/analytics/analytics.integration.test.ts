import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearRateLimits,
  dbPsql,
  randomTag,
  recoverySession,
  registerAndLogin,
  rpc,
  svcRest,
  svcRpc,
  testEnv,
} from "../../../../test-support/api";

/**
 * Métricas, reportes y carga masiva (Sprint 14) contra la nube, por HTTP real (PostgREST + RLS + los permisos de cada función).
 * Lo que una prueba pgTAP de una sola sesión no muestra: que la API la ejecute SOLO un administrador, que las cifras cuadren con
 * una cuenta INDEPENDIENTE hecha desde las tablas con aritmética exacta, y que dos importaciones simultáneas del mismo SKU no
 * dupliquen nada. Usa una cuenta de administración que YA existe (no se crean) y no deja nada sin revertir: lo que importa se archiva.
 */

let admin = "";
let customer: { token: string; id: string } | null = null;
const batches: string[] = [];
const tag = randomTag().toUpperCase();

beforeAll(async () => {
  await clearRateLimits();
  const admins = await svcRest(
    "GET",
    "profiles?role=eq.admin&is_active=eq.true&select=id,email&limit=30",
  );
  const found = (admins.body as { id: string; email: string | null }[]).find((r) =>
    r.email?.endsWith("@prueba.test"),
  );
  if (!found?.email) return;
  admin = (await recoverySession(found.email)).access;
  const user = await registerAndLogin({ name: "Clienta S14" });
  customer = { token: user.token, id: user.id };
}, 120_000);

afterAll(async () => {
  if (!admin) return;
  // Lo que se importó se revierte (archiva): el lote más nuevo primero.
  for (const id of [...batches].reverse())
    await rpc("admin_import_rollback", { p_batch: id }, admin);
}, 120_000);

const guard = (ctx: { skip: (note?: string) => void }) => {
  if (!admin || !customer)
    ctx.skip("No hay una cuenta de administración de prueba (@prueba.test) para entrar.");
};

/** Un lote: abrir, aplicar bloques y cerrar (lo deja anotado para revertirlo al terminar). */
async function runImport(
  kind: string,
  rows: Record<string, unknown>[],
  filename = `it-${tag}.csv`,
) {
  const start = await rpc(
    "admin_import_start",
    { p_kind: kind, p_filename: filename, p_total: rows.length },
    admin,
  );
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const id = start.body as string;
  batches.push(id);
  const results: any[] = [];
  for (let i = 0; i < rows.length; i += 200) {
    const res = await rpc(
      "admin_import_apply_chunk",
      { p_batch: id, p_rows: rows.slice(i, i + 200) },
      admin,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    results.push(...res.body.rows);
  }
  const fin = await rpc("admin_import_finish", { p_batch: id }, admin);
  expect(fin.status, JSON.stringify(fin.body)).toBe(200);
  return { id, results, batch: fin.body as Record<string, any> };
}

const day = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/La_Paz" }).format(d);
};
const cents = (n: number | string | undefined) => Math.round(Number(n ?? 0) * 100);

describe("permisos por la API", () => {
  it("un administrador usa las funciones de métricas; una clienta, el servicio y quien no entró, no", async (ctx) => {
    guard(ctx);
    const args = { p_from: day(-6), p_to: day(0), p_granularity: "day" };
    const ok = await rpc("admin_sales_summary", args, admin);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.range.days).toBe(7);
    const asCustomer = await rpc("admin_sales_summary", args, customer!.token);
    expect(asCustomer.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(asCustomer.body)).toMatch(/42501|administradores|permission/i);
    const asService = await svcRpc("admin_sales_summary", args);
    expect(asService.status).toBeGreaterThanOrEqual(400);
    const anonymous = await rpc("admin_sales_summary", args);
    expect(anonymous.status).toBeGreaterThanOrEqual(400);
  });

  it("los reportes, la importación y los documentos de despacho: lo mismo (solo un administrador)", async (ctx) => {
    guard(ctx);
    const calls: [string, Record<string, unknown>][] = [
      ["admin_report_sales", { p_from: day(-6), p_to: day(0) }],
      ["admin_report_customers", { p_from: day(-6), p_to: day(0) }],
      ["admin_report_inventory", {}],
      ["admin_inventory_summary", {}],
      ["admin_import_batches", {}],
      ["admin_import_validate", { p_kind: "stock", p_rows: [] }],
      ["admin_import_start", { p_kind: "stock", p_filename: "x.csv", p_total: 0 }],
    ];
    for (const [name, args] of calls) {
      const res = await rpc(name, args, customer!.token);
      expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBeGreaterThanOrEqual(400);
      const svc = await svcRpc(name, args);
      expect(svc.status, `${name} (servicio)`).toBeGreaterThanOrEqual(400);
    }
    // y las tablas del lote no se leen directo ni siquiera con la sesión de un administrador
    const direct = await fetch(`${testEnv().url}/rest/v1/import_batches?select=id`, {
      headers: { apikey: testEnv().anon, authorization: `Bearer ${admin}` },
    });
    expect(direct.status).toBeGreaterThanOrEqual(400);
  });

  it("una página de más de 5000 filas o un rango de más de 731 días se rechaza con un error claro, no con un 500", async (ctx) => {
    guard(ctx);
    const big = await rpc(
      "admin_report_sales",
      { p_from: day(-6), p_to: day(0), p_limit: 5001 },
      admin,
    );
    expect(big.status).toBe(400);
    expect(JSON.stringify(big.body)).toMatch(/invalid_parameters/);
    const long = await rpc("admin_sales_summary", { p_from: day(-800), p_to: day(0) }, admin);
    expect(long.status).toBe(400);
    expect(JSON.stringify(long.body)).toMatch(/invalid_range/);
  });
});

describe("las cifras cuadran con una cuenta independiente (criterio 1: al centavo)", () => {
  it("bruto, reembolsos y neto del resumen = suma exacta hecha desde las tablas, por moneda, en el rango más largo", async (ctx) => {
    guard(ctx);
    const from = day(-730);
    const to = day(0);
    const res = await rpc(
      "admin_sales_summary",
      { p_from: from, p_to: to, p_granularity: "month" },
      admin,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // La cuenta independiente: pedidos vendidos (estado y fecha de pago en La Paz) leídos con la clave de servicio, en céntimos enteros.
    const fromTs = new Date(`${from}T00:00:00-04:00`).toISOString();
    const toTs = new Date(`${day(1)}T00:00:00-04:00`).toISOString();
    const orders: {
      id: string;
      currency: string;
      total: string;
      paid_at: string;
      created_at: string;
      status: string;
    }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await svcRest(
        "GET",
        `orders?status=in.(paid,preparing,shipped,delivered,completed)&select=id,currency,total,paid_at,created_at,status&order=id&limit=1000&offset=${offset}`,
      );
      expect(page.status).toBe(200);
      orders.push(...page.body);
      if (page.body.length < 1000) break;
    }
    const inRange = orders.filter((o) => {
      const sold = o.paid_at ?? o.created_at;
      return sold >= fromTs && sold < toTs;
    });
    const refunds: { order_id: string; amount: string; status: string }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await svcRest(
        "GET",
        `refunds?select=order_id,amount,status&order=id&limit=1000&offset=${offset}`,
      );
      expect(page.status).toBe(200);
      refunds.push(...page.body);
      if (page.body.length < 1000) break;
    }
    const ids = new Set(inRange.map((o) => o.id));
    for (const c of res.body.currencies as {
      currency: string;
      current: Record<string, number>;
    }[]) {
      const mine = inRange.filter((o) => o.currency === c.currency);
      const gross = mine.reduce((sum, o) => sum + cents(o.total), 0);
      const refunded = refunds
        .filter((r) => r.status !== "rejected" && ids.has(r.order_id))
        .filter((r) => mine.some((o) => o.id === r.order_id))
        .reduce((sum, r) => sum + cents(r.amount), 0);
      expect(c.current.orders, `${c.currency}: pedidos`).toBe(mine.length);
      expect(cents(c.current.gross), `${c.currency}: bruto`).toBe(gross);
      expect(cents(c.current.refunds), `${c.currency}: reembolsos`).toBe(refunded);
      expect(cents(c.current.net), `${c.currency}: neto`).toBe(gross - refunded);
    }
    expect(inRange.length).toBeGreaterThan(0);
  }, 120_000);

  it("el reporte de ventas suma lo mismo que el resumen (los reportes no se contradicen), con todas sus páginas", async (ctx) => {
    guard(ctx);
    const from = day(-60);
    const to = day(0);
    const summary = await rpc("admin_sales_summary", { p_from: from, p_to: to }, admin);
    const bob = (
      summary.body.currencies as { currency: string; current: Record<string, number> }[]
    ).find((c) => c.currency === "BOB");
    let net = 0;
    let gross = 0;
    let rows = 0;
    let total = -1;
    for (let offset = 0; total < 0 || offset < total; offset += 100) {
      const page = await rpc(
        "admin_report_sales",
        { p_from: from, p_to: to, p_currency: "BOB", p_offset: offset, p_limit: 100 },
        admin,
      );
      expect(page.status, JSON.stringify(page.body)).toBe(200);
      if (page.body.length === 0) break;
      total = Number(page.body[0].total_count);
      rows += page.body.length;
      for (const r of page.body) {
        net += cents(r.net);
        gross += cents(r.gross);
      }
    }
    expect(rows).toBe(bob?.current["orders"] ?? 0);
    expect(gross).toBe(cents(bob?.current["gross"] ?? 0));
    expect(net).toBe(cents(bob?.current["net"] ?? 0));
  }, 120_000);
});

describe("carga masiva con la pila real", () => {
  const codes = (n: number) =>
    Array.from({ length: n }, (_, i) => `IT${tag}-${String(i).padStart(3, "0")}`);

  it("la vista previa NO escribe nada y dice lo mismo que dirá al confirmar", async (ctx) => {
    guard(ctx);
    const rows = codes(3).map((code, i) => ({
      row: i + 2,
      code,
      name: `Producto ${code}`,
      color: "Rojo",
      size: "M",
      sku: `${code}-R-M`,
      price: "10",
      cost: "4",
      stock: "2",
    }));
    const before = await svcRest("GET", `products?code=like.IT${tag}-*&select=id`);
    const preview = await rpc("admin_import_validate", { p_kind: "products", p_rows: rows }, admin);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.counts).toEqual({ create: 3, update: 0, skip: 0, error: 0 });
    const after = await svcRest("GET", `products?code=like.IT${tag}-*&select=id`);
    expect(after.body.length).toBe(before.body.length);
    const { results } = await runImport("products", rows);
    expect(results.map((r: any) => r.action)).toEqual(["create", "create", "create"]);
  }, 120_000);

  it("reimportar el MISMO archivo no crea ni cambia nada (idempotente)", async (ctx) => {
    guard(ctx);
    const rows = codes(3).map((code, i) => ({
      row: i + 2,
      code,
      name: `Producto ${code}`,
      color: "Rojo",
      size: "M",
      sku: `${code}-R-M`,
      price: "10",
      cost: "4",
      stock: "2",
    }));
    const again = await runImport("products", rows);
    expect(again.results.map((r: any) => r.action)).toEqual(["skip", "skip", "skip"]);
    expect(again.batch).toMatchObject({
      created_count: 0,
      updated_count: 0,
      skipped_count: 3,
      error_count: 0,
    });
    const products = await svcRest("GET", `products?code=like.IT${tag}-*&select=id`);
    expect(products.body.length).toBe(3);
  }, 120_000);

  it("un archivo mediano (300 variantes en 2 bloques) se importa sin pasar el límite de 8 s por llamada, y se revierte entero", async (ctx) => {
    guard(ctx);
    const rows = Array.from({ length: 300 }, (_, i) => {
      const code = `IT${tag}-B${String(Math.floor(i / 3)).padStart(3, "0")}`;
      return {
        row: i + 2,
        code,
        name: `Lote ${code}`,
        color: `Color${i % 3}`,
        size: "M",
        sku: `${code}-${i % 3}`,
        price: "25.5",
        cost: "9",
        stock: "3",
      };
    });
    const t0 = Date.now();
    const done = await runImport("products", rows);
    const seconds = (Date.now() - t0) / 1000;
    expect(done.batch.created_count).toBe(300);
    expect(done.batch.error_count).toBe(0);
    expect(seconds).toBeLessThan(60);
    const variants = await svcRest(
      "GET",
      `product_variants?sku=like.IT${tag}-B*&select=id,stock_on_hand&limit=1000`,
    );
    expect(variants.body.length).toBe(300);
    expect((variants.body as { stock_on_hand: number }[]).every((v) => v.stock_on_hand === 3)).toBe(
      true,
    );
    // revertir ese lote: todo archivado y el stock en 0
    const back = await rpc("admin_import_rollback", { p_batch: done.id }, admin);
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.conflicts).toEqual([]);
    expect(back.body.reverted).toBe(back.body.total);
    const after = await svcRest(
      "GET",
      `product_variants?sku=like.IT${tag}-B*&select=stock_on_hand,archived_at&limit=1000`,
    );
    expect(
      (after.body as { stock_on_hand: number; archived_at: string | null }[]).every(
        (v) => v.stock_on_hand === 0 && v.archived_at !== null,
      ),
    ).toBe(true);
  }, 180_000);

  it("el stock se importa como conteo absoluto, deja su movimiento «import» y nunca baja de lo reservado", async (ctx) => {
    guard(ctx);
    const sku = `IT${tag}-000-R-M`;
    const preview = await rpc(
      "admin_import_validate",
      {
        p_kind: "stock",
        p_rows: [
          { row: 2, sku, stock: "7" },
          { row: 3, sku: "NO-EXISTE", stock: "1" },
        ],
      },
      admin,
    );
    expect(preview.body.rows.map((r: any) => [r.action, r.errors[0]?.code ?? null])).toEqual([
      ["update", null],
      ["error", "sku_not_found"],
    ]);
    const done = await runImport("stock", [{ row: 2, sku, stock: "7" }]);
    expect(done.results[0].action).toBe("update");
    const variant = (await svcRest("GET", `product_variants?sku=eq.${sku}&select=id,stock_on_hand`))
      .body[0];
    expect(variant.stock_on_hand).toBe(7);
    const moves = await svcRest(
      "GET",
      `stock_movements?variant_id=eq.${variant.id}&reason=eq.import&select=delta,ref&order=id`,
    );
    expect(
      (moves.body as { delta: number; ref: string }[]).some(
        (m) => m.delta === 5 && m.ref === `import:${done.id}`,
      ),
    ).toBe(true);
  }, 120_000);

  it("DOS importaciones del mismo SKU a la vez no duplican nada (un producto, una variante) y ninguna da 500", async (ctx) => {
    guard(ctx);
    const code = `IT${tag}-RACE`;
    const row = {
      row: 2,
      code,
      name: "Carrera",
      color: "Rojo",
      size: "S",
      sku: `${code}-R-S`,
      price: "10",
      stock: "1",
    };
    const starts = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        rpc(
          "admin_import_start",
          { p_kind: "products", p_filename: `race-${i}.csv`, p_total: 1 },
          admin,
        ),
      ),
    );
    const ids = starts.map((s) => s.body as string);
    batches.push(...ids);
    const results = await Promise.all(
      ids.map((id) => rpc("admin_import_apply_chunk", { p_batch: id, p_rows: [row] }, admin)),
    );
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);
    const actions = results.map((r) => r.body.rows[0].action as string);
    expect(actions.filter((a) => a === "create")).toHaveLength(1);
    for (const r of results) {
      const out = r.body.rows[0];
      if (out.action === "error") expect(["duplicate", "db_error"]).toContain(out.errors[0].code);
      else expect(["create", "skip"]).toContain(out.action);
    }
    expect((await svcRest("GET", `products?code=eq.${code}&select=id`)).body).toHaveLength(1);
    expect(
      (await svcRest("GET", `product_variants?sku=eq.${code}-R-S&select=id,stock_on_hand`)).body,
    ).toEqual([expect.objectContaining({ stock_on_hand: 1 })]);
    for (const id of ids) await rpc("admin_import_finish", { p_batch: id }, admin);
  }, 120_000);

  it("importar un conteo MIENTRAS alguien mueve el stock: el conteo manda (la variante se bloquea antes de leer su stock)", async (ctx) => {
    guard(ctx);
    // Una variante con 10 unidades (carga de stock inicial).
    const code = `IT${tag}-LOCK`;
    const sku = `${code}-R-S`;
    const created = await runImport("products", [
      { row: 2, code, name: "Candado", color: "Rojo", size: "S", sku, price: "10", stock: "10" },
    ]);
    expect(created.results[0].action).toBe("create");
    const variantId = (await svcRest("GET", `product_variants?sku=eq.${sku}&select=id`)).body[0]
      .id as string;
    // Otra sesión toma la variante, espera y le suma 5 (como una venta o un ajuste a mano) antes de soltarla.
    const marker = `lock-${tag}`;
    const other = dbPsql(`begin;
      select id from public.product_variants where id = '${variantId}' for update;
      select pg_sleep(8) /* ${marker} */;
      select public.apply_stock_change('${variantId}', 5, 'adjust', 'it-${tag}-otra-sesion');
      commit;`);
    // Se espera a que esa sesión TENGA el candado (no a un tiempo fijo: conectar por el pooler tarda lo que tarde).
    let holding = false;
    for (let i = 0; i < 40 && !holding; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const probe = await dbPsql(
        `select count(*) from pg_stat_activity where state = 'active' and query like '%${marker}%' and pid <> pg_backend_pid();`,
      );
      holding = /\b1\b/.test(probe.stdout);
    }
    expect(holding, "la otra sesión tomó el candado").toBe(true);
    // Mientras tanto, el conteo del archivo dice que HAY 20. Debe esperar a la otra sesión y calcular su diferencia sobre lo que
    // quedó (15), no sobre lo que vio antes (10): al final el stock es 20, no 25.
    const started = Date.now();
    const done = await runImport("stock", [{ row: 2, sku, stock: "20" }]);
    await other;
    expect(Date.now() - started, "tuvo que esperar a la otra sesión").toBeGreaterThan(2000);
    expect(done.results[0].action).toBe("update");
    const stock = (await svcRest("GET", `product_variants?id=eq.${variantId}&select=stock_on_hand`))
      .body[0].stock_on_hand as number;
    expect(stock).toBe(20);
  }, 120_000);

  it("el historial lista las cargas y el detalle trae el total con cada página", async (ctx) => {
    guard(ctx);
    const list = await rpc("admin_import_batches", { p_limit: 5 }, admin);
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThan(0);
    const detail = await rpc(
      "admin_import_batch_rows",
      { p_batch: batches[0], p_offset: 0, p_limit: 2 },
      admin,
    );
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(Number(detail.body[0].total_count)).toBeGreaterThanOrEqual(detail.body.length);
  });
});
