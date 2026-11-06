import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import { dbPsql, svcRest, svcRpc, testEnv } from "../../../test-support/api";

/**
 * Envíos (Sprint 8) contra la base de la NUBE por HTTP real: la cotización pasa por el cliente de verdad (`quoteShipping` +
 * `parseQuote`) con un visitante anónimo, y los cupos se pelean con 30 peticiones simultáneas.
 *
 * Los datos son PROPIOS de la prueba (método, regla, zona y franjas con un sufijo aleatorio) y se archivan al terminar:
 * no dependen del seed ni de las tarifas que el dueño cargue después. Solo se lee el origen principal y el factor de ruta,
 * que son del negocio. Los valores esperados se calcularon a mano (ver cada caso); `expectedCost` es la fórmula escrita
 * aparte, no una copia del SQL.
 */

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => holder.client }));

import { quoteShipping } from "./quote";

const methodCode = "it_s8_pruebas";
const METHOD_NAME = "Prueba de integración (S8)";
const ZONE_NAME = "Prueba de integración (S8)";
const RULE_NAME = "Prueba de integración (S8)";
const KM_PER_DEG = (6371.0088 * Math.PI) / 180; // a lo largo de un meridiano: distancia = R·Δφ, exacta en Haversine

let origin = { lat: 0, lng: 0 };
let factor = 130;
let methodId = "";
const toArchive: { table: string; id: string }[] = [];
const owners: string[] = [];

/** Un punto a `km` kilómetros EN LÍNEA RECTA hacia el norte del origen. */
const north = (km: number) => ({
  lat: Number((origin.lat + km / KM_PER_DEG).toFixed(6)),
  lng: origin.lng,
});

/** Tarifa de la regla de prueba, escrita aparte: tramos 0–3 → 15, 3–6 → 20, 6–10 → 30; pasados 10 km, 3 por km; mínimo 15, máximo 60. */
function expectedCost(routeKm: number): number {
  const tiers: [number, number][] = [
    [3, 15],
    [6, 20],
    [10, 30],
  ];
  const hit = tiers.find(([upTo]) => routeKm <= upTo);
  const raw = hit ? hit[1] : 30 + 3 * (routeKm - 10);
  return Math.round(Math.min(60, Math.max(15, raw)) * 100) / 100;
}

/** Hoy en La Paz (AAAA-MM-DD) más `days`, con su día ISO de la semana (1 = lunes … 7 = domingo). */
function laPazDay(days: number): { date: string; weekday: number } {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/La_Paz" }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return { date: d.toISOString().slice(0, 10), weekday: ((d.getUTCDay() + 6) % 7) + 1 };
}

/**
 * Datos de prueba FIJOS (nada se borra en la base: lo que crea una prueba queda archivado). Se reutiliza el mismo método,
 * zona y tarifa en cada corrida —se desarchivan al empezar y se archivan al terminar— para no llenar el panel de basura.
 */
async function ensure(
  table: string,
  filter: string,
  row: Record<string, unknown>,
): Promise<string> {
  const found = await svcRest("GET", `${table}?${filter}&select=id`);
  expect(found.status, JSON.stringify(found.body)).toBe(200);
  const existing = (found.body as { id: string }[])[0];
  if (!existing) return insert(table, row);
  const revived = await svcRest("PATCH", `${table}?id=eq.${existing.id}`, {
    ...row,
    archived_at: null,
  });
  expect(revived.status, JSON.stringify(revived.body)).toBe(200);
  toArchive.push({ table, id: existing.id });
  return existing.id;
}

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const r = await svcRest("POST", table, row);
  expect(r.status, `${table}: ${JSON.stringify(r.body)}`).toBe(201);
  const id = r.body[0].id as string;
  toArchive.push({ table, id });
  return id;
}

beforeAll(async () => {
  const env = testEnv();
  holder.client = createClient<Database>(env.url, env.anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const loc = await svcRest(
    "GET",
    "store_locations?is_primary=eq.true&archived_at=is.null&select=lat,lng",
  );
  if (loc.status !== 200 || loc.body.length !== 1) {
    throw new Error(
      "Falta el origen principal de envíos: cárgalo en /admin/envios o con el bloque de envíos de supabase/seed.sql.",
    );
  }
  origin = { lat: Number(loc.body[0].lat), lng: Number(loc.body[0].lng) };
  const setting = await svcRest(
    "GET",
    "store_settings?key=eq.shipping_route_factor_pct&select=value",
  );
  factor = Number(setting.body[0].value);

  // Cobertura propia y amplia (500 km); el seed trae otras más chicas que no estorban (todas permiten).
  await ensure("shipping_zones", `name=eq.${encodeURIComponent(ZONE_NAME)}`, {
    name: ZONE_NAME,
    kind: "radius",
    center_lat: origin.lat,
    center_lng: origin.lng,
    radius_km: 500,
    allowed: true,
    is_active: true,
  });
  methodId = await ensure("shipping_methods", `code=eq.${methodCode}`, {
    code: methodCode,
    name: METHOD_NAME,
    kind: "delivery",
    is_active: true,
  });
  await ensure(
    "shipping_rate_rules",
    `method_id=eq.${methodId}&name=eq.${encodeURIComponent(RULE_NAME)}`,
    {
      method_id: methodId,
      name: RULE_NAME,
      kind: "distance",
      params: {
        tiers: [
          { up_to_km: 3, cost: 15 },
          { up_to_km: 6, cost: 20 },
          { up_to_km: 10, cost: 30 },
        ],
        extra_per_km: 3,
        min_cost: 15,
        max_cost: 60,
      },
      priority: 100,
      is_active: true,
    },
  );
});

afterAll(async () => {
  for (const owner of owners)
    await svcRpc("release_delivery_slot", { p_owner_type: "manual", p_owner_id: owner });
  for (const { table, id } of toArchive.reverse()) {
    await svcRest("PATCH", `${table}?id=eq.${id}`, { archived_at: new Date().toISOString() });
  }
});

describe("cotización por el cliente real (anon)", () => {
  const quote = (km: number, extra: Record<string, unknown> = {}) =>
    quoteShipping({
      methodCode,
      ...north(km),
      city: "Ciudad de prueba",
      orderAmount: 100,
      ...extra,
    });

  it.each([
    // [km en línea recta, descripción]; la ruta es km × factor / 100
    [1, "dentro del primer tramo"],
    [2.5, "segundo tramo (ruta 3,25 con el factor 130)"],
    [4, "segundo tramo (ruta 5,2)"],
    [7, "tercer tramo (ruta 9,1)"],
    [15, "pasado el último tramo: 30 + 3 por km adicional (ruta 19,5)"],
    [30, "el máximo recorta (ruta 39)"],
  ])("a %s km: %s", async (km) => {
    const result = await quote(km);
    expect(result.ok).toBe(true);
    const route = (km * factor) / 100;
    expect(result.distanceKm).toBeCloseTo(route, 1);
    expect(result.breakdown.straightKm).toBeCloseTo(km, 2);
    expect(result.cost).toBe(expectedCost(route));
    expect(result.currency).toBe("BOB");
  });

  it("con el factor 130 los valores fijos calculados a mano coinciden", async (ctx) => {
    // el dueño cambió el factor: los fijos ya no aplican (arriba se probó con la fórmula) y se marca como OMITIDA, no como pasada
    if (factor !== 130) ctx.skip();
    expect((await quote(1)).cost).toBe(15); // 1,3 km → tramo 1
    expect((await quote(2.5)).cost).toBe(20); // 3,25 km → tramo 2 (borde 3 superado)
    expect((await quote(4)).cost).toBe(20); // 5,2 km → tramo 2
    expect((await quote(7)).cost).toBe(30); // 9,1 km → tramo 3
    expect((await quote(15)).cost).toBe(58.5); // 19,5 km → 30 + 3 × 9,5
    const capped = await quote(30); // 39 km → 30 + 3 × 29 = 117 → máximo 60
    expect(capped.cost).toBe(60);
    expect(capped.breakdown.maxApplied).toBe(true);
  });

  it("fuera de toda cobertura: out_of_coverage, SIN costo (nunca 0 por omisión)", async () => {
    const result = await quote(600);
    expect(result.ok).toBe(false);
    expect(result.cost).toBeNull();
    expect(result.errors.map((e) => e.code)).toContain("out_of_coverage");
  });

  it("un método que no existe y coordenadas inválidas dan errores estables", async () => {
    const missing = await quoteShipping({
      methodCode: "no_existe_xyz",
      ...north(1),
      orderAmount: 100,
    });
    expect(missing.ok).toBe(false);
    expect(missing.errors[0]?.code).toBe("method_not_found");
    const noPoint = await quoteShipping({ methodCode, orderAmount: 100 });
    expect(noPoint.ok).toBe(false);
    expect(noPoint.cost).toBeNull();
  });

  it("un visitante lee la vista pública de métodos, sin coordenadas", async () => {
    const env = testEnv();
    const res = await fetch(
      `${env.url}/rest/v1/public_shipping_methods?select=*&code=eq.${methodCode}`,
      {
        headers: { apikey: env.anon },
      },
    );
    const rows = (await res.json()) as Record<string, unknown>[];
    expect(res.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).some((k) => /lat|lng/.test(k))).toBe(false);
    // y las tablas siguen cerradas para él
    const zones = await fetch(`${env.url}/rest/v1/shipping_zones?select=id`, {
      headers: { apikey: env.anon },
    });
    expect(zones.status).toBe(401);
  });
});

describe("franjas y cupos", () => {
  it("cotizar con fecha muestra el cupo restante y refleja las reservas", async () => {
    const day = laPazDay(3);
    const slotId = await insert("delivery_slots", {
      method_id: methodId,
      weekday: day.weekday,
      start_time: "08:00",
      end_time: "10:00",
      capacity: 5,
    });
    const find = () =>
      quoteShipping({
        methodCode,
        ...north(1),
        orderAmount: 100,
        deliveryDate: day.date,
        slotId,
        listDays: 7,
      });
    const before = await find();
    expect(before.ok).toBe(true);
    expect(before.selected).toMatchObject({ date: day.date, slotId });
    const mine = before.slots.find((s) => s.slotId === slotId && s.date === day.date);
    expect(mine).toMatchObject({ capacity: 5, remaining: 5, available: true });

    for (let i = 0; i < 3; i++) {
      const owner = randomUUID();
      owners.push(owner);
      const r = await svcRpc("reserve_delivery_slot", {
        p_slot_id: slotId,
        p_day: day.date,
        p_owner_type: "manual",
        p_owner_id: owner,
      });
      expect(r.body.status).toBe("reserved");
    }
    const after = await find();
    expect(after.slots.find((s) => s.slotId === slotId && s.date === day.date)).toMatchObject({
      remaining: 2,
      available: true,
    });
  });

  it("30 reservas SIMULTÁNEAS por HTTP de un cupo de 5: exactamente 5 entran y 25 reciben «lleno» (humo; el candado se prueba abajo)", async () => {
    const day = laPazDay(4);
    const slotId = await insert("delivery_slots", {
      method_id: methodId,
      weekday: day.weekday,
      start_time: "11:00",
      end_time: "13:00",
      capacity: 5,
    });
    const ids = Array.from({ length: 30 }, () => randomUUID());
    owners.push(...ids);
    const results = await Promise.all(
      ids.map((owner) =>
        svcRpc("reserve_delivery_slot", {
          p_slot_id: slotId,
          p_day: day.date,
          p_owner_type: "manual",
          p_owner_id: owner,
        }),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const by = (status: string) => results.filter((r) => r.body.status === status).length;
    expect(by("reserved")).toBe(5);
    expect(by("full")).toBe(25);

    // la base coincide con lo que contestaron las funciones
    const rows = await svcRest(
      "GET",
      `delivery_bookings?slot_id=eq.${slotId}&delivery_date=eq.${day.date}&status=eq.active&select=id`,
    );
    expect(rows.body).toHaveLength(5);

    // reservar de nuevo con el mismo dueño es idempotente («already») y no gasta cupo
    const winner = results.findIndex((r) => r.body.status === "reserved");
    const again = await svcRpc("reserve_delivery_slot", {
      p_slot_id: slotId,
      p_day: day.date,
      p_owner_type: "manual",
      p_owner_id: ids[winner],
    });
    expect(again.body.status).toBe("already");

    // liberar uno abre exactamente un lugar
    expect(
      (await svcRpc("release_delivery_slot", { p_owner_type: "manual", p_owner_id: ids[winner] }))
        .body,
    ).toBe(1);
    const next = await svcRpc("reserve_delivery_slot", {
      p_slot_id: slotId,
      p_day: day.date,
      p_owner_type: "manual",
      p_owner_id: ids.find((_, i) => results[i]!.body.status === "full"),
    });
    expect(next.body.status).toBe("reserved");
  });

  it("el candado de la franja es real: con la primera reserva SIN confirmar, la segunda espera y no rebasa el cupo de 1", async () => {
    // 30 peticiones HTTP casi nunca chocan (la ventana de la carrera dura milisegundos): para PROBAR el candado se abre la
    // carrera a propósito. La sesión A reserva y se duerme 8 s SIN confirmar; la B reserva mientras tanto. Con el candado de
    // fila (`for update`) B espera a A, cuenta 1 y recibe «full»; sin él contaría 0 (la fila de A aún no se ve) y entrarían 2.
    // Las dos entradas posibles con candado (A o B primero) dejan siempre UNA reserva y UN «full».
    const day = laPazDay(5);
    const slotId = await insert("delivery_slots", {
      method_id: methodId,
      weekday: day.weekday,
      start_time: "14:00",
      end_time: "16:00",
      capacity: 1,
    });
    const [a, b] = [randomUUID(), randomUUID()];
    owners.push(a, b);
    const reserve = (owner: string) =>
      `select public.reserve_delivery_slot('${slotId}', '${day.date}', 'manual', '${owner}')->>'status'`;
    const first = dbPsql(`${reserve(a)}; select pg_sleep(8)`);
    // No se adivina cuánto tarda en conectar A: se espera a VERLA dormida (ya reservó y sigue sin confirmar). Así la prueba
    // siempre abre la carrera, también con una conexión lenta.
    let asleep = false;
    for (let i = 0; i < 60 && !asleep; i++) {
      const seen = await dbPsql(
        `select count(*) from pg_stat_activity where wait_event = 'PgSleep' and query like '%${slotId}%' and pid <> pg_backend_pid()`,
      );
      asleep = seen.stdout.trim() === "1";
      if (!asleep) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(asleep, "la sesión A no llegó a dormirse: no se puede probar el candado").toBe(true);
    const second = dbPsql(reserve(b));
    const [ra, rb] = await Promise.all([first, second]);
    const statuses = [ra.stdout.split("\n")[0], rb.stdout.split("\n")[0]].sort();
    expect(statuses).toEqual(["full", "reserved"]);
    const rows = await svcRest(
      "GET",
      `delivery_bookings?slot_id=eq.${slotId}&delivery_date=eq.${day.date}&status=eq.active&select=id`,
    );
    expect(rows.body).toHaveLength(1);
  }, 60_000);

  it("un visitante NO puede reservar cupo (solo el servidor): permiso denegado, no «función inexistente»", async () => {
    const env = testEnv();
    const day = laPazDay(3);
    const res = await fetch(`${env.url}/rest/v1/rpc/reserve_delivery_slot`, {
      method: "POST",
      headers: { apikey: env.anon, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_slot_id: randomUUID(),
        p_day: day.date,
        p_owner_type: "manual",
        p_owner_id: randomUUID(),
      }),
    });
    expect(res.status).toBe(401); // 404 sería «no existe»: aquí la función existe y el rol no tiene permiso
  });
});
