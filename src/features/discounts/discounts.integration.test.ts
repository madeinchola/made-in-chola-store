import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbPsql, svcRest, svcRpc, testEnv } from "../../../test-support/api";

/**
 * Descuentos (Sprint 9) contra la base de la NUBE por HTTP real y con concurrencia real. Los datos son PROPIOS de la prueba
 * (descuentos y cupones con un nombre fijo que se reutiliza en cada corrida; nada se borra: al terminar se archivan y sus
 * usos se devuelven), y los valores esperados salen de cuentas a mano: con un cupón de UN uso, de 50 pedidos simultáneos
 * entra EXACTAMENTE 1.
 */

const NAME = "Prueba de integración (S9)";
const owners: string[] = [];
const archive: { table: string; id: string }[] = [];

async function ensure(
  table: string,
  filter: string,
  row: Record<string, unknown>,
): Promise<string> {
  const found = await svcRest("GET", `${table}?${filter}&select=id`);
  expect(found.status, JSON.stringify(found.body)).toBe(200);
  const existing = (found.body as { id: string }[])[0];
  if (existing) {
    const revived = await svcRest("PATCH", `${table}?id=eq.${existing.id}`, {
      ...row,
      archived_at: null,
    });
    expect(revived.status, JSON.stringify(revived.body)).toBe(200);
    archive.push({ table, id: existing.id });
    return existing.id;
  }
  const created = await svcRest("POST", table, row);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body[0].id as string;
  archive.push({ table, id });
  return id;
}

/** El descuento «de un solo uso» y su cupón. */
async function oneUseCoupon(
  limits: { total?: number; perCustomer?: number },
  code: string,
  name: string,
) {
  const discountId = await ensure("discounts", `name=eq.${encodeURIComponent(name)}`, {
    name,
    kind: "percent",
    params: { percent: 10 },
    requires_coupon: true,
    usage_limit_total: limits.total ?? null,
    usage_limit_per_customer: limits.perCustomer ?? null,
    is_active: true,
  });
  const couponId = await ensure("coupons", `code=eq.${code}`, {
    discount_id: discountId,
    code,
    is_active: true,
  });
  return { discountId, couponId };
}

const reserve = (owner: string, applied: unknown[], profile: string | null = null) =>
  svcRpc("discount_reserve", {
    p_owner_type: "order",
    p_owner_id: owner,
    p_profile_id: profile,
    p_applied: applied,
  });
const applied = (discountId: string, couponId: string) => [
  { discount_id: discountId, coupon_id: couponId, amount: 10 },
];

let profileId = "";

beforeAll(async () => {
  const p = await svcRest("GET", "profiles?role=eq.customer&is_active=eq.true&select=id&limit=1");
  if (p.status !== 200 || p.body.length !== 1) {
    throw new Error("Hace falta al menos una clienta en la base para probar el tope por cliente.");
  }
  profileId = p.body[0].id as string;
});

afterAll(async () => {
  for (const owner of owners)
    await svcRpc("discount_release", { p_owner_type: "order", p_owner_id: owner });
  for (const { table, id } of archive.reverse()) {
    await svcRest("PATCH", `${table}?id=eq.${id}`, { archived_at: new Date().toISOString() });
  }
});

describe("usos atómicos (concurrencia real)", () => {
  it("50 pedidos simultáneos sobre un cupón con UN uso: entra exactamente 1 y 49 reciben «sold_out»", async () => {
    const { discountId, couponId } = await oneUseCoupon(
      { total: 1 },
      "IT-S9-UNICO",
      `${NAME} · un uso`,
    );
    const ids = Array.from({ length: 50 }, () => randomUUID());
    owners.push(...ids);
    const results = await Promise.all(ids.map((id) => reserve(id, applied(discountId, couponId))));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const ok = results.filter((r) => r.body.ok === true).length;
    const soldOut = results.filter((r) => r.body.failed?.[0]?.reason === "sold_out").length;
    expect(ok).toBe(1);
    expect(soldOut).toBe(49);
    const rows = await svcRest(
      "GET",
      `discount_redemptions?discount_id=eq.${discountId}&status=in.(reserved,applied)&select=id`,
    );
    expect(rows.body).toHaveLength(1);
  });

  it("el mismo cliente desde dos dispositivos a la vez, con tope de 1 por cliente: entra uno solo", async () => {
    const { discountId, couponId } = await oneUseCoupon(
      { perCustomer: 1 },
      "IT-S9-CLIENTE",
      `${NAME} · por cliente`,
    );
    const [a, b] = [randomUUID(), randomUUID()];
    owners.push(a, b);
    const [ra, rb] = await Promise.all([
      reserve(a, applied(discountId, couponId), profileId),
      reserve(b, applied(discountId, couponId), profileId),
    ]);
    expect([ra.body.ok, rb.body.ok].sort()).toEqual([false, true]);
    const loser = ra.body.ok ? rb : ra;
    expect(loser.body.failed[0].reason).toBe("already_used");
    const rows = await svcRest(
      "GET",
      `discount_redemptions?discount_id=eq.${discountId}&status=in.(reserved,applied)&select=id`,
    );
    expect(rows.body).toHaveLength(1);
  });

  it("un tope de 5 con 30 intentos simultáneos: entran exactamente 5 y la suma nunca pasa", async () => {
    const { discountId, couponId } = await oneUseCoupon(
      { total: 5 },
      "IT-S9-CINCO",
      `${NAME} · cinco`,
    );
    const ids = Array.from({ length: 30 }, () => randomUUID());
    owners.push(...ids);
    const results = await Promise.all(ids.map((id) => reserve(id, applied(discountId, couponId))));
    expect(results.filter((r) => r.body.ok === true)).toHaveLength(5);
    const rows = await svcRest(
      "GET",
      `discount_redemptions?discount_id=eq.${discountId}&status=in.(reserved,applied)&select=id`,
    );
    expect(rows.body).toHaveLength(5);
  });

  it("devolver un uso libera exactamente un lugar", async () => {
    const { discountId, couponId } = await oneUseCoupon(
      { total: 1 },
      "IT-S9-DEVOLVER",
      `${NAME} · devolver`,
    );
    const [first, second] = [randomUUID(), randomUUID()];
    owners.push(first, second);
    expect((await reserve(first, applied(discountId, couponId))).body.ok).toBe(true);
    expect((await reserve(second, applied(discountId, couponId))).body.failed[0].reason).toBe(
      "sold_out",
    );
    expect(
      (await svcRpc("discount_release", { p_owner_type: "order", p_owner_id: first })).body,
    ).toBe(1);
    expect((await reserve(second, applied(discountId, couponId))).body.ok).toBe(true);
  });

  it("el candado es real: con la 1.ª reserva SIN confirmar, la 2.ª espera y no rebasa el tope de 1", async () => {
    // 50 peticiones HTTP casi nunca chocan en la ventana de milisegundos: para PROBAR el candado se abre la carrera a
    // propósito. La sesión A reserva y se duerme 8 s sin confirmar; la B reserva mientras tanto. Con el candado de fila
    // (`for update`) B espera a A, cuenta 1 y recibe «sold_out»; sin él contaría 0 y entrarían 2.
    const { discountId, couponId } = await oneUseCoupon(
      { total: 1 },
      "IT-S9-CANDADO",
      `${NAME} · candado`,
    );
    const [a, b] = [randomUUID(), randomUUID()];
    owners.push(a, b);
    const call = (owner: string) =>
      `select public.discount_reserve('order', '${owner}', null, '[{"discount_id":"${discountId}","coupon_id":"${couponId}","amount":10}]'::jsonb)->>'ok'`;
    const first = dbPsql(`${call(a)}; select pg_sleep(8)`);
    let asleep = false;
    for (let i = 0; i < 60 && !asleep; i++) {
      const seen = await dbPsql(
        `select count(*) from pg_stat_activity where wait_event = 'PgSleep' and query like '%${a}%' and pid <> pg_backend_pid()`,
      );
      asleep = seen.stdout.trim() === "1";
      if (!asleep) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(asleep, "la sesión A no llegó a dormirse: no se puede probar el candado").toBe(true);
    const second = dbPsql(call(b));
    const [ra, rb] = await Promise.all([first, second]);
    expect([ra.stdout.split("\n")[0], rb.stdout.split("\n")[0]].sort()).toEqual(["false", "true"]);
    const rows = await svcRest(
      "GET",
      `discount_redemptions?discount_id=eq.${discountId}&status=in.(reserved,applied)&select=id`,
    );
    expect(rows.body).toHaveLength(1);
  }, 60_000);
});

describe("lo que un visitante NO puede hacer", () => {
  const env = () => testEnv();
  const get = (path: string) =>
    fetch(`${env().url}/rest/v1/${path}`, { headers: { apikey: env().anon } });
  const post = (fn: string, body: unknown) =>
    fetch(`${env().url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: env().anon, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("no lee descuentos, cupones, redenciones ni grupos (los códigos no se pueden listar)", async () => {
    for (const table of [
      "discounts",
      "coupons",
      "discount_redemptions",
      "customer_groups",
      "customer_group_members",
      "discount_targets",
      "discount_usage",
    ]) {
      expect((await get(`${table}?select=*`)).status, table).toBe(401);
    }
  });

  it("no ejecuta las funciones del servidor: permiso denegado (401), no «no existe»", async () => {
    const uuid = randomUUID();
    expect((await post("apply_discounts", { p_cart_id: uuid })).status).toBe(401);
    expect(
      (await post("cart_set_coupon", { p_profile_id: null, p_token_hash: "x", p_code: "A" }))
        .status,
    ).toBe(401);
    expect(
      (
        await post("discount_reserve", {
          p_owner_type: "order",
          p_owner_id: uuid,
          p_profile_id: null,
          p_applied: [],
        })
      ).status,
    ).toBe(401);
    expect(
      (await post("admin_generate_coupon_codes", { p_discount_id: uuid, p_count: 1 })).status,
    ).toBe(401);
  });
});
