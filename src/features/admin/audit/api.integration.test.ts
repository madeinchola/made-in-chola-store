import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
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

import { listAdminActors, listAuditLog } from "./api";
import type { AuditListParams } from "./listParams";

function clientWith(token?: string): SupabaseClient<Database> {
  const env = localEnv();
  return createClient<Database>(env.url, env.anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
  });
}

let adminToken = "";
let adminId = "";
let customerToken = "";
let customerId = "";
const adminName = `Admin Auditoría ${randomTag()}`;
const asAdmin = () => void (holder.client = clientWith(adminToken));
const asCustomer = () => void (holder.client = clientWith(customerToken));

beforeAll(async () => {
  await clearRateLimits();
  const admin = await registerAndLogin({ name: adminName });
  expect((await svcRpc("promote_admin", { p_email: admin.email })).status).toBe(200);
  adminToken = admin.token;
  adminId = admin.id;
  const customer = await registerAndLogin({ name: "Cliente Auditoría" });
  customerToken = customer.token;
  customerId = customer.id;
  asAdmin();
}, 60_000);

const params = (over: Partial<AuditListParams> = {}): AuditListParams => ({
  page: 1,
  pageSize: 50,
  ...over,
});
/** La fecha de HOY en La Paz, como la escribiría el filtro (AAAA-MM-DD). */
const todayLaPaz = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/La_Paz" });

/** El admin crea una categoría y la renombra: deja una fila INSERT y una UPDATE en la auditoría, con su identidad. */
async function touchCategory(tag: string) {
  const created = await rest("POST", "categories", adminToken, {
    name: `Aud ${tag}`,
    slug: `aud-${tag}`,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body[0].id as string;
  const renamed = await rest("PATCH", `categories?id=eq.${id}`, adminToken, {
    name: `Aud ${tag} renombrada`,
  });
  expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
  return id;
}

describe("listAuditLog (BD real)", () => {
  it("un cambio hecho desde el panel aparece con quién, qué y el detalle viejo → nuevo; lo más nuevo primero", async () => {
    const tag = randomTag();
    const id = await touchCategory(tag);
    const page = await listAuditLog(params({ table: "categories" }));
    const mine = page.rows.filter((r) => r.recordId === id);
    expect(mine.map((r) => r.action)).toEqual(["UPDATE", "INSERT"]); // el UPDATE ocurrió después → va primero
    const update = mine[0];
    expect(update).toMatchObject({
      actorId: adminId,
      actorName: adminName,
      tableName: "categories",
      actorRole: "authenticated",
    });
    expect(update?.diff).toEqual({ name: { old: `Aud ${tag}`, new: `Aud ${tag} renombrada` } });
    expect(mine[1]?.diff).toMatchObject({ slug: `aud-${tag}`, name: `Aud ${tag}` });
  });

  it("el orden es por fecha descendente y desempata por id, en TODAS las páginas", async () => {
    for (let i = 0; i < 4; i++) await touchCategory(randomTag());
    const all = await listAuditLog(params({ pageSize: 100 }));
    const keys = all.rows.map((r) => [r.occurredAt, r.id] as const);
    const sorted = [...keys].sort((a, b) => (a[0] === b[0] ? b[1] - a[1] : b[0] < a[0] ? -1 : 1));
    expect(keys).toEqual(sorted);
  });

  it("paginación: total exacto, páginas sin repetir ni omitir, y la suma de páginas es el total", async () => {
    const tag = randomTag();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await touchCategory(`${tag}${i}`));
    const base = await listAuditLog(params({ table: "categories", pageSize: 100 }));
    const total = base.total;
    const seen: number[] = [];
    for (let p = 1; p <= Math.ceil(total / 4); p++) {
      const page = await listAuditLog(params({ table: "categories", pageSize: 4, page: p }));
      expect(page.total).toBe(total);
      seen.push(...page.rows.map((r) => r.id));
    }
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect(seen).toEqual(base.rows.map((r) => r.id)); // mismo orden que sin paginar
    expect(ids.length).toBe(3);
  });

  it("una página más allá del final NO es un error: vacía, con el total real", async () => {
    const page = await listAuditLog(params({ pageSize: 5, page: 99_999 }));
    expect(page.rows).toEqual([]);
    expect(page.total).toBeGreaterThan(0);
  });

  it("filtra por tabla, por acción y por quién", async () => {
    const tag = randomTag();
    const id = await touchCategory(tag);
    const byTable = await listAuditLog(params({ table: "categories" }));
    expect(byTable.rows.every((r) => r.tableName === "categories")).toBe(true);
    const inserts = await listAuditLog(params({ table: "categories", action: "INSERT" }));
    expect(inserts.rows.every((r) => r.action === "INSERT")).toBe(true);
    expect(inserts.rows.some((r) => r.recordId === id)).toBe(true);
    const updates = await listAuditLog(params({ table: "categories", action: "UPDATE" }));
    expect(updates.rows.some((r) => r.recordId === id)).toBe(true);
    expect(updates.rows.every((r) => r.action === "UPDATE")).toBe(true);
    const mine = await listAuditLog(params({ actorId: adminId, pageSize: 100 }));
    expect(mine.total).toBeGreaterThan(0);
    expect(mine.rows.every((r) => r.actorId === adminId)).toBe(true);
    const nobody = await listAuditLog(params({ actorId: "00000000-0000-4000-8000-000000000000" }));
    expect(nobody).toEqual({ rows: [], total: 0 });
  });

  it("filtra por rango de días en hora de La Paz: hoy incluye lo de hoy; un día pasado, nada", async () => {
    const tag = randomTag();
    const id = await touchCategory(tag);
    const today = todayLaPaz();
    const hoy = await listAuditLog(params({ table: "categories", from: today, to: today }));
    expect(hoy.rows.some((r) => r.recordId === id)).toBe(true); // el día "hasta" entra completo
    const soloDesdeHoy = await listAuditLog(params({ table: "categories", from: today }));
    expect(soloDesdeHoy.rows.some((r) => r.recordId === id)).toBe(true);
    const pasado = await listAuditLog(params({ from: "2000-01-01", to: "2000-01-02" }));
    expect(pasado).toEqual({ rows: [], total: 0 });
    const hastaAyer = await listAuditLog(params({ table: "categories", to: "2000-01-01" }));
    expect(hastaAyer.rows.some((r) => r.recordId === id)).toBe(false);
  });

  it("combina filtros (tabla + acción + quién + día) y sigue siendo exacto", async () => {
    const tag = randomTag();
    const id = await touchCategory(tag);
    const page = await listAuditLog(
      params({
        table: "categories",
        action: "UPDATE",
        actorId: adminId,
        from: todayLaPaz(),
        to: todayLaPaz(),
      }),
    );
    expect(page.rows.some((r) => r.recordId === id)).toBe(true);
    expect(
      page.rows.every(
        (r) => r.tableName === "categories" && r.action === "UPDATE" && r.actorId === adminId,
      ),
    ).toBe(true);
  });

  it("los cambios de productos y de ajustes también quedan registrados con su detalle", async () => {
    const tag = randomTag();
    const p = await rest("POST", "products", adminToken, {
      code: `AUD-${tag}`,
      slug: `aud-${tag}`,
      name: `Producto ${tag}`,
    });
    const productId = p.body[0].id as string;
    await rest("PATCH", `products?id=eq.${productId}`, adminToken, { name: `Producto ${tag} v2` });
    const rows = (await listAuditLog(params({ table: "products", pageSize: 100 }))).rows.filter(
      (r) => r.recordId === productId,
    );
    expect(rows.map((r) => r.action)).toEqual(["UPDATE", "INSERT"]);
    expect(rows[0]?.diff).toEqual({ name: { old: `Producto ${tag}`, new: `Producto ${tag} v2` } });
  });

  it("un cliente NO ve el registro de auditoría (RLS): total 0", async () => {
    asCustomer();
    try {
      const page = await listAuditLog(params());
      expect(page).toEqual({ rows: [], total: 0 });
    } finally {
      asAdmin();
    }
  });

  it("el nombre de quien actuó se resuelve; si el actor es el sistema, queda sin nombre", async () => {
    const tag = randomTag();
    await touchCategory(tag);
    const page = await listAuditLog(params({ actorId: adminId, pageSize: 5 }));
    expect(page.rows.every((r) => r.actorName === adminName)).toBe(true);
    const system = (await listAuditLog(params({ pageSize: 100 }))).rows.filter(
      (r) => r.actorId === null,
    );
    expect(system.every((r) => r.actorName === null)).toBe(true);
  });
});

describe("listAdminActors (BD real)", () => {
  it("lista a los administradores (para el filtro 'Quién') y NO a los clientes", async () => {
    const actors = await listAdminActors();
    expect(actors).toContainEqual({ id: adminId, name: adminName });
    expect(actors.map((a) => a.id)).not.toContain(customerId);
  });

  it("vienen ordenados por nombre", async () => {
    const names = (await listAdminActors()).map((a) => a.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, "es"));
    expect(names.map((n) => n.toLowerCase())).toEqual(sorted.map((n) => n.toLowerCase()));
  });
});
