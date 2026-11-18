import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbSql, registerAndLogin, rest, rpc, svcRest, testEnv } from "../../test-support/api";
import {
  enableQr,
  makeCustomer,
  makeProduct,
  placeQrOrder,
  restoreQr,
  type Customer,
} from "../../test-support/shop";

/**
 * Matriz de seguridad por HTTP REAL contra la nube (Sprint 16, docs/seguridad.md). Complementa a las pruebas estructurales de
 * pgTAP (05 y 27, que miran el catálogo) con lo que solo se ve de verdad: qué contesta la API a cada rol.
 *
 *   · visitante (sin sesión): ninguna tabla ni vista salvo las públicas; ninguna función salvo las públicas;
 *   · clienta A (con dirección y un pedido) y clienta B (recién llegada, sin nada): cada una ve SOLO lo suyo en las 8 tablas
 *     que lee, y NADA en el resto, aunque la base tenga filas de otras personas;
 *   · B no puede leer, cambiar ni borrar lo de A (direcciones, pedidos, cobros, comprobantes);
 *   · las columnas internas (costo, huella, lista negra, quién cobró) dan «permiso denegado» a quien las pida;
 *   · las funciones de administración dan error a una clienta, con una petición bien formada que sí llegaría a su cuerpo.
 * Las listas salen del catálogo de la propia base (no se escriben a mano), así que una tabla o función nueva entra sola.
 */

const env = testEnv();

/** Relación de public con su primera columna legible por el rol (para pedir `select=<col>`). */
interface Relation {
  name: string;
  kind: string;
  col: string;
}

function relationsReadableBy(role: "anon" | "authenticated"): Relation[] {
  const out = dbSql(`
    select c.relname || '|' || c.relkind::text || '|' || (
      select a.attname from pg_attribute a
       where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
         and has_column_privilege('${role}', c.oid, a.attnum, 'select') order by a.attnum limit 1)
      from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                     and has_column_privilege('${role}', c.oid, a.attnum, 'select'))
     order by c.relname`);
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, kind, col] = line.split("|");
      return { name: name!, kind: kind!, col: col! };
    });
}

function allRelations(): Relation[] {
  const out = dbSql(`
    select c.relname || '|' || c.relkind::text || '|' || (
      select a.attname from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped order by a.attnum limit 1)
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm') order by c.relname`);
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, kind, col] = line.split("|");
      return { name: name!, kind: kind!, col: col! };
    });
}

const TYPE_SAMPLES: Record<string, unknown> = {
  uuid: "00000000-0000-4000-8000-000000000000",
  text: "x",
  "character varying": "x",
  citext: "x",
  integer: 1,
  bigint: 1,
  smallint: 1,
  numeric: 1,
  "double precision": 1,
  real: 1,
  boolean: false,
  jsonb: {},
  json: {},
  date: "2020-01-01",
  "timestamp with time zone": "2020-01-01T00:00:00Z",
  "timestamp without time zone": "2020-01-01T00:00:00",
};

interface Fn {
  name: string;
  args: Record<string, unknown>;
}

/** Funciones de public (con sus argumentos de muestra bien tipados) que cumplen `where`. Los argumentos con valor por omisión también se envían. */
function functionsWhere(where: string): Fn[] {
  const out = dbSql(`
    select p.proname || '|' || coalesce(
      (select string_agg(n || ':' || t, ',' order by i)
         from unnest(coalesce(p.proargnames, '{}'::text[]), string_to_array(oidvectortypes(p.proargtypes), ', ')) with ordinality as x(n, t, i)
        where n is not null and n <> ''), '')
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prorettype <> 'event_trigger'::regtype
       and (${where})
     order by p.proname`);
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, params = ""] = line.split("|");
      const args: Record<string, unknown> = {};
      for (const param of params.split(",").filter(Boolean)) {
        const [argName, type = "text"] = param.split(":");
        const key = argName!;
        if (type.endsWith("[]")) args[key] = [];
        else args[key] = type in TYPE_SAMPLES ? TYPE_SAMPLES[type] : "x";
      }
      return { name: name!, args };
    });
}

const PUBLIC_VIEW = /^public_/;
/** Tablas donde una clienta ve filas (las suyas): y la columna que las ata a ella (o a su pedido). */
const OWN_TABLES: Record<string, string> = {
  addresses: "profile_id",
  notification_preferences: "profile_id",
  order_items: "order_id",
  order_status_history: "order_id",
  orders: "profile_id",
  payments: "order_id",
  profiles: "id",
  tax_profiles: "profile_id",
};

let a: Customer;
let b: Awaited<ReturnType<typeof registerAndLogin>>;
let orderId = "";
let qrBefore: Record<string, unknown> | null = null;
let admin: string | null = null;

beforeAll(async () => {
  qrBefore = await enableQr();
  a = await makeCustomer();
  b = await registerAndLogin({ name: "Clienta B (sin nada)" });
  const product = await makeProduct(120, 5);
  orderId = (await placeQrOrder(a, product.variantId)).orderId;
}, 180_000);

afterAll(async () => {
  await restoreQr(qrBefore);
});

describe("visitante (sin sesión)", () => {
  it("lee las vistas públicas (200) y NINGUNA otra tabla ni vista (401/403)", async () => {
    const readable = new Set(relationsReadableBy("anon").map((r) => r.name));
    const results: string[] = [];
    for (const rel of allRelations()) {
      const res = await rest("GET", `${rel.name}?select=${rel.col}&limit=1`);
      const allowed = readable.has(rel.name);
      const ok = allowed ? res.status === 200 : res.status === 401 || res.status === 403;
      if (!ok)
        results.push(
          `${rel.name}: HTTP ${res.status} (${allowed ? "debía abrirse" : "debía cerrarse"})`,
        );
    }
    expect(results).toEqual([]);
    // y lo que sí se abre son solo las vistas públicas, nunca una tabla
    for (const name of readable)
      expect(name, `${name} es legible por un visitante`).toMatch(PUBLIC_VIEW);
  });

  it("no ejecuta NINGUNA función que no sea pública: 401, 403 o 404, nunca 200 ni un error de la propia función", async () => {
    const publicOnes = new Set(
      functionsWhere("has_function_privilege('anon', p.oid, 'execute')").map((f) => f.name),
    );
    const closed = functionsWhere("not has_function_privilege('anon', p.oid, 'execute')").filter(
      (f) => !publicOnes.has(f.name),
    );
    expect(closed.length).toBeGreaterThan(100);
    const bad: string[] = [];
    for (const f of closed) {
      const res = await rpc(f.name, f.args);
      if (![401, 403, 404].includes(res.status)) bad.push(`${f.name}: HTTP ${res.status}`);
    }
    expect(bad).toEqual([]);
  }, 600_000);
});

describe("clientas: cada una ve solo lo suyo", () => {
  it("B (recién llegada, sin nada) no ve NINGUNA fila de nadie más en ninguna tabla que puede leer", async () => {
    const seen: string[] = [];
    // las vistas públicas (public_*) devuelven el catálogo a cualquiera: no son «filas de nadie más»
    for (const rel of relationsReadableBy("authenticated").filter(
      (r) => !PUBLIC_VIEW.test(r.name),
    )) {
      const own = OWN_TABLES[rel.name];
      const col = own && ["profile_id", "id"].includes(own) ? own : rel.col;
      const res = await rest("GET", `${rel.name}?select=${col}&limit=1000`, b.token);
      if (res.status !== 200) {
        seen.push(`${rel.name}: HTTP ${res.status}`);
        continue;
      }
      const rows = res.body as Record<string, unknown>[];
      if (rel.name === "profiles") {
        if (rows.length !== 1 || rows[0]!.id !== b.id) seen.push(`profiles: ${rows.length} filas`);
      } else if (rel.name === "notification_preferences") {
        if (rows.some((r) => r.profile_id !== b.id))
          seen.push("notification_preferences: filas ajenas");
      } else if (rows.length > 0) {
        seen.push(`${rel.name}: ${rows.length} filas`);
      }
    }
    expect(seen).toEqual([]);
  }, 300_000);

  it("A ve su dirección, su pedido, sus líneas, su cobro y su historial, y SOLO eso", async () => {
    const addresses = await rest("GET", "addresses?select=id,profile_id", a.token);
    expect((addresses.body as { id: string }[]).map((r) => r.id)).toEqual([a.addressId]);
    const orders = await rest("GET", "orders?select=id,profile_id", a.token);
    expect(orders.body).toEqual([{ id: orderId, profile_id: a.id }]);
    for (const table of ["order_items", "payments", "order_status_history"]) {
      const res = await rest("GET", `${table}?select=order_id`, a.token);
      const rows = res.body as { order_id: string }[];
      expect(rows.length, table).toBeGreaterThan(0);
      expect(
        rows.every((r) => r.order_id === orderId),
        `${table}: todas las filas son de su pedido`,
      ).toBe(true);
    }
    const profiles = await rest("GET", "profiles?select=id", a.token);
    expect(profiles.body).toEqual([{ id: a.id }]);
  });

  it("B no puede pedir lo de A por su identificador (direcciones, pedido, líneas, cobro, historial, perfil)", async () => {
    const targets: [string, string][] = [
      ["addresses", `id=eq.${a.addressId}`],
      ["orders", `id=eq.${orderId}`],
      ["order_items", `order_id=eq.${orderId}`],
      ["payments", `order_id=eq.${orderId}`],
      ["order_status_history", `order_id=eq.${orderId}`],
      ["profiles", `id=eq.${a.id}`],
    ];
    for (const [table, filter] of targets) {
      const res = await rest("GET", `${table}?select=id&${filter}`, b.token);
      expect(res.status, table).toBe(200);
      expect(res.body, `${table} de A visto por B`).toEqual([]);
    }
  });

  it("B no puede cambiar ni borrar lo de A: 0 filas afectadas o permiso denegado, y nada cambia", async () => {
    const patchAddress = await rest("PATCH", `addresses?id=eq.${a.addressId}`, b.token, {
      label: "Hackeada",
    });
    expect([200, 204, 401, 403]).toContain(patchAddress.status);
    if (patchAddress.status === 200) expect(patchAddress.body).toEqual([]);
    const patchOrder = await rest("PATCH", `orders?id=eq.${orderId}`, b.token, {
      status: "cancelled",
    });
    expect([401, 403]).toContain(patchOrder.status);
    const delOrder = await rest("DELETE", `orders?id=eq.${orderId}`, b.token);
    expect([401, 403]).toContain(delOrder.status);
    const delAddress = await rest("DELETE", `addresses?id=eq.${a.addressId}`, b.token);
    expect([401, 403]).toContain(delAddress.status);
    const intruder = await rest("POST", "addresses", b.token, {
      profile_id: a.id,
      label: "Intrusa",
      recipient: "B",
      phone_e164: "+59171234567",
      line1: "Calle 1",
      city: "La Paz",
      country: "BO",
    });
    expect(intruder.status, "B no puede crear una dirección a nombre de A").toBeGreaterThanOrEqual(
      400,
    );
    const after = await svcRest("GET", `addresses?id=eq.${a.addressId}&select=label,profile_id`);
    expect(after.body).toEqual([{ label: "Casa", profile_id: a.id }]);
    const order = await svcRest("GET", `orders?id=eq.${orderId}&select=status`);
    expect(order.body).toEqual([{ status: "pending_payment" }]);
  });

  it("nadie se asciende a administrador ni se saca de la lista negra: role, is_active y blacklisted dan permiso denegado", async () => {
    for (const patch of [
      { role: "admin" },
      { is_active: true },
      { blacklisted: false },
      { email: "otro@x.com" },
    ]) {
      const res = await rest("PATCH", `profiles?id=eq.${b.id}`, b.token, patch);
      expect([401, 403], JSON.stringify(patch)).toContain(res.status);
    }
    const role = await svcRest("GET", `profiles?id=eq.${b.id}&select=role`);
    expect(role.body).toEqual([{ role: "customer" }]);
  });
});

describe("columnas internas: permiso denegado para quien las pida", () => {
  const cases: [string, string, string][] = [
    ["profiles", "blacklisted", "si el negocio la marcó en la lista negra"],
    ["orders", "request_hash", "la huella interna de la petición de pago"],
    ["payments", "collected_by", "quién cobró"],
    ["order_items", "cost_unit", "el costo congelado de la prenda"],
    ["order_status_history", "actor_id", "quién hizo cada cambio de estado"],
  ];
  for (const [table, column, why] of cases) {
    it(`${table}.${column} (${why}): una clienta recibe 403, incluso en sus propias filas`, async () => {
      const res = await rest("GET", `${table}?select=${column}&limit=1`, a.token);
      expect([401, 403, 400], `${table}.${column}: HTTP ${res.status}`).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toMatch(
        /"(blacklisted|request_hash|collected_by|cost_unit|actor_id)"\s*:/,
      );
    });
  }

  it("pedir todas las columnas (select=*) de orders, payments y profiles también se rechaza: se piden por nombre", async () => {
    for (const table of ["orders", "payments", "profiles"]) {
      const res = await rest("GET", `${table}?select=*&limit=1`, a.token);
      expect(res.status, table).toBe(403);
    }
  });

  it("las columnas que la clienta sí ve siguen funcionando (la pantalla «Mis pedidos»)", async () => {
    const mine = await rest(
      "GET",
      "orders?select=id,number,status,total,shipping_cost,order_items(id,qty,final_total)",
      a.token,
    );
    expect(mine.status).toBe(200);
    const rows = mine.body as { id: string; order_items: unknown[] }[];
    expect(rows.map((r) => r.id)).toEqual([orderId]);
    expect(rows[0]!.order_items.length).toBeGreaterThan(0);
    const profile = await rest(
      "GET",
      "profiles?select=id,full_name,email,phone_e164,role,is_active",
      a.token,
    );
    expect(profile.status).toBe(200);
    expect(profile.body).toHaveLength(1);
  });

  it("el costo del producto no lo lee ninguna clienta: products da 0 filas y su costo, 403", async () => {
    expect(
      ((await rest("GET", "products?select=id&limit=5", a.token)).body as unknown[]).length,
    ).toBe(0);
    expect(
      (await rest("GET", "public_products?select=cost_base&limit=1", a.token)).status,
    ).toBeGreaterThanOrEqual(400);
  });
});

describe("funciones de administración: una clienta recibe un error", () => {
  it("cada función que solo es del administrador (is_admin() y sin auth.uid()) falla para B y no devuelve datos", async () => {
    const adminOnly = functionsWhere(
      `has_function_privilege('authenticated', p.oid, 'execute') and p.prosecdef
       and p.prosrc ~ 'is_admin\\(\\)' and p.prosrc !~ 'auth\\.uid\\(\\)'`,
    );
    expect(adminOnly.length).toBeGreaterThan(30);
    const outcomes = new Map<number, string[]>();
    for (const f of adminOnly) {
      const res = await rpc(f.name, f.args, b.token);
      const list = outcomes.get(res.status) ?? [];
      list.push(f.name);
      outcomes.set(res.status, list);
    }
    const bad = [...outcomes.entries()].filter(([status]) => status < 400);
    expect(bad, "estas respondieron con éxito a una clienta").toEqual([]);
  }, 600_000);

  it("y ninguna función del navegador que recibe un pedido deja a B ver el de A: contestan error o vacío", async () => {
    const withOrder = functionsWhere(
      `has_function_privilege('authenticated', p.oid, 'execute') and 'p_order_id' = any (p.proargnames)
       and not (p.prosrc ~ 'is_admin\\(\\)' and p.prosrc !~ 'auth\\.uid\\(\\)')`,
    );
    expect(withOrder.length).toBeGreaterThan(0);
    for (const f of withOrder) {
      const res = await rpc(f.name, { ...f.args, p_order_id: orderId }, b.token);
      const leaked = res.status === 200 && JSON.stringify(res.body).includes(orderId);
      expect(leaked, `${f.name}: ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`).toBe(
        false,
      );
    }
  });
});

describe("comprobantes de pago (Storage)", () => {
  const proofPath = () => `${a.id}/${orderId}/${randomUUID()}.png`;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  const upload = (path: string, token: string) =>
    fetch(`${env.url}/storage/v1/object/payment-proofs/${path}`, {
      method: "POST",
      headers: { apikey: env.anon, Authorization: `Bearer ${token}`, "Content-Type": "image/png" },
      body: png as unknown as BodyInit,
    });
  const download = (path: string, token?: string) =>
    fetch(`${env.url}/storage/v1/object/authenticated/payment-proofs/${path}`, {
      headers: { apikey: env.anon, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });

  it("B no puede subir un comprobante a la carpeta de A, ni A uno a la de B; A sí sube el suyo y B no lo lee", async () => {
    const path = proofPath();
    const intruder = await upload(path, b.token);
    expect(intruder.status, "B sube a la carpeta de A").toBeGreaterThanOrEqual(400);

    const own = await upload(path, a.token);
    expect(own.status, await own.clone().text()).toBeLessThan(300);

    expect((await download(path, a.token)).status, "A lee su comprobante").toBe(200);
    const seenByB = await download(path, b.token);
    expect(seenByB.status, "B lee el comprobante de A").toBeGreaterThanOrEqual(400);
    const seenByAnon = await download(path);
    expect(seenByAnon.status, "un visitante lee el comprobante de A").toBeGreaterThanOrEqual(400);
    const publicUrl = await fetch(`${env.url}/storage/v1/object/public/payment-proofs/${path}`);
    expect(publicUrl.status, "el bucket es privado: no hay URL pública").toBeGreaterThanOrEqual(
      400,
    );

    // un administrador sí lo ve (si hay una cuenta de prueba)
    admin ??= await (
      await import("../../test-support/shop")
    )
      .adminSession()
      .then((s) => s?.token ?? "");
    if (admin) expect((await download(path, admin)).status, "el administrador lo lee").toBe(200);
  }, 120_000);

  it("el bucket de comprobantes no acepta tipos peligrosos aunque la ruta sea correcta", async () => {
    const res = await fetch(
      `${env.url}/storage/v1/object/payment-proofs/${a.id}/${orderId}/${randomUUID()}.png`,
      {
        method: "POST",
        headers: {
          apikey: env.anon,
          Authorization: `Bearer ${a.token}`,
          "Content-Type": "image/svg+xml",
        },
        body: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
