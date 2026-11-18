import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearRateLimits,
  dbExec,
  dbSql,
  fn,
  randomTag,
  register,
  rest,
  rpc,
  STRONG_PASSWORD,
  svcRest,
  svcRpc,
  uniqueEmail,
} from "../../../test-support/api";
import { adminSession, makeCustomer, makeProduct, type Customer } from "../../../test-support/shop";

/**
 * Textos legales (Sprint 15) contra la nube, por HTTP real: las funciones `register`, `checkout` y `legal-accept` desplegadas, la
 * API de PostgREST con los permisos de cada función y los permisos de las tablas. Lo que pgTAP no muestra: que el servidor EXIJA las
 * versiones vigentes (409), que lo aceptado quede registrado con la huella de la red (nunca la IP) solo cuando la cuenta o el pedido
 * SE CREARON, y que dos publicaciones simultáneas del mismo borrador den UNA versión.
 *
 * Publicar es irreversible desde la API (las versiones son inmutables a propósito): por eso la prueba SOLO corre si no hay ningún
 * texto legal en la base (nunca sobre textos reales) y al terminar los borra con SQL directo, dejando la base como la encontró.
 * Debe correrse sola (`npm run test:integration -- src/features/legal`): mientras hay textos publicados, cualquier registro o
 * compra de otra prueba exigiría aceptarlos.
 */

let admin: string | null = null;
let skipReason: string | null = null;
const created: { customers: Customer[] } = { customers: [] };

const CLEAN = `
begin;
alter table public.legal_versions disable trigger legal_versions_guard_trg;
delete from public.legal_versions;
alter table public.legal_versions enable trigger legal_versions_guard_trg;
alter table public.legal_acceptances disable trigger legal_acceptances_immutable;
delete from public.legal_acceptances;
alter table public.legal_acceptances enable trigger legal_acceptances_immutable;
commit;`;

const body = (what: string) =>
  `Texto de prueba de integración (${what}), con más de veinte caracteres.`;

/** Guarda y publica una versión nueva de un documento, como administrador. */
async function publish(kind: string, what: string, note: string | null = null) {
  const saved = await rpc(
    "admin_legal_save_draft",
    { p_kind: kind, p_body: body(what), p_note: note },
    admin!,
  );
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const done = await rpc(
    "admin_legal_publish",
    { p_kind: kind, p_effective_at: null, p_note: note },
    admin!,
  );
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return done.body as { version: number };
}

const acceptances = (profileId: string) =>
  dbSql(
    `select kind || ':' || version || ':' || context || ':' || coalesce(order_id::text, '-') || ':' || (ip_hash ~ '^[0-9a-f]{64}$')
       from public.legal_acceptances where profile_id = '${profileId}' order by kind, accepted_at`,
  )
    .split("\n")
    .filter(Boolean);

beforeAll(async () => {
  try {
    const existing = Number(dbSql("select count(*) from public.legal_versions"));
    if (existing > 0) {
      skipReason = `Hay ${existing} versiones de textos legales en la base: no se prueba sobre textos reales.`;
      return;
    }
  } catch (error) {
    skipReason = `Sin acceso SQL a la nube: ${(error as Error).message.split("\n")[0]}`;
    return;
  }
  const session = await adminSession();
  if (!session) {
    skipReason = "No hay una cuenta de administración de prueba (@prueba.test) para entrar.";
    return;
  }
  admin = session.token;
  await clearRateLimits();
  // Las clientas con cuenta y dirección se crean ANTES de publicar nada (después, registrarse exige aceptar los textos).
  for (let i = 0; i < 2; i++) created.customers.push(await makeCustomer());
}, 180_000);

afterAll(async () => {
  if (skipReason?.startsWith("Hay ")) return; // nunca se toca lo que no es de la prueba
  try {
    dbExec(CLEAN);
  } finally {
    await clearRateLimits();
  }
}, 120_000);

const guard = (ctx: { skip: (note?: string) => void }) => {
  if (skipReason) ctx.skip(skipReason);
};

describe("textos legales · sin nada publicado no se exige nada", () => {
  it("la tienda lee que no hay nada que aceptar y registrarse sin versiones funciona", async (ctx) => {
    guard(ctx);
    const required = await rpc("public_legal_required", {});
    expect(required.status).toBe(200);
    expect(required.body).toEqual({});
    const email = uniqueEmail("legal-sin");
    await clearRateLimits();
    const res = await register({ full_name: "Sin textos", email, password: STRONG_PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // y no queda ninguna aceptación registrada
    expect(Number(dbSql(`select count(*) from public.legal_acceptances`))).toBe(0);
  });

  it("un texto sin publicar responde «sin versión» a cualquiera y no filtra el borrador", async (ctx) => {
    guard(ctx);
    const saved = await rpc(
      "admin_legal_save_draft",
      { p_kind: "cookies", p_body: body("borrador secreto"), p_note: null },
      admin!,
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const doc = await rpc("public_legal_document", { p_kind: "cookies" });
    expect(doc.status).toBe(200);
    expect(doc.body.version).toBeNull();
    expect(JSON.stringify(doc.body)).not.toContain("secreto");
    const index = await rpc("public_legal_index", {});
    expect(JSON.stringify(index.body)).not.toContain("secreto");
    await rpc("admin_legal_discard_draft", { p_kind: "cookies" }, admin!);
  });
});

describe("textos legales · permisos de la API", () => {
  it("las funciones de administración las ejecuta SOLO un administrador (anónimo y clienta: rechazo)", async (ctx) => {
    guard(ctx);
    const customer = created.customers[0]!;
    for (const [name, args] of [
      ["admin_legal_overview", {}],
      ["admin_legal_get", { p_kind: "terms", p_version: null }],
      ["admin_legal_save_draft", { p_kind: "terms", p_body: body("x"), p_note: null }],
      ["admin_legal_discard_draft", { p_kind: "terms" }],
      ["admin_legal_publish", { p_kind: "terms", p_effective_at: null, p_note: null }],
      ["admin_legal_acceptance_stats", {}],
    ] as const) {
      const anon = await rpc(name, args);
      expect([401, 403], `${name} anónimo`).toContain(anon.status);
      const asCustomer = await rpc(name, args, customer.token);
      expect(
        asCustomer.status,
        `${name} clienta: ${JSON.stringify(asCustomer.body)}`,
      ).toBeGreaterThanOrEqual(400);
      const asService = await svcRpc(name, args);
      expect(asService.status, `${name} service_role`).toBeGreaterThanOrEqual(400);
    }
    const nothing = await rpc("admin_legal_overview", {}, admin!);
    expect(nothing.status).toBe(200);
  });

  it("registrar una aceptación solo lo hace el servicio, y las tablas no se leen ni se escriben desde la API", async (ctx) => {
    guard(ctx);
    const customer = created.customers[0]!;
    const args = {
      p_profile_id: customer.id,
      p_order_id: null,
      p_context: "register",
      p_versions: { terms: 1 },
      p_ip_hash: "a".repeat(64),
    };
    expect((await rpc("record_legal_acceptance", args)).status).toBeGreaterThanOrEqual(400);
    expect(
      (await rpc("record_legal_acceptance", args, customer.token)).status,
    ).toBeGreaterThanOrEqual(400);
    for (const table of ["legal_versions", "legal_acceptances", "legal_documents"]) {
      const read = await rest("GET", `${table}?select=*`, customer.token);
      expect(read.status === 200 ? read.body : [], `${table} clienta`).toEqual([]);
      const svc = await svcRest("GET", `${table}?select=*`);
      expect(svc.status === 200 ? svc.body : [], `${table} service_role`).toEqual([]);
      const write = await svcRest("POST", table, { kind: "terms" });
      expect(write.status, `${table} escritura`).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("textos legales · publicar y las reglas de publicación", () => {
  it("publicar exige un borrador, una vigencia que no esté en el pasado y, desde la 2.ª versión, decir qué cambió", async (ctx) => {
    guard(ctx);
    const noDraft = await rpc(
      "admin_legal_publish",
      { p_kind: "shipping", p_effective_at: null, p_note: null },
      admin!,
    );
    expect(noDraft.status).toBe(400);
    expect(noDraft.body.message).toBe("no_draft");

    await rpc(
      "admin_legal_save_draft",
      { p_kind: "shipping", p_body: body("envíos v1"), p_note: null },
      admin!,
    );
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const inPast = await rpc(
      "admin_legal_publish",
      { p_kind: "shipping", p_effective_at: past, p_note: null },
      admin!,
    );
    expect(inPast.body.message).toBe("effective_in_past");
    const first = await rpc(
      "admin_legal_publish",
      { p_kind: "shipping", p_effective_at: null, p_note: null },
      admin!,
    );
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.version).toBe(1);

    await rpc(
      "admin_legal_save_draft",
      { p_kind: "shipping", p_body: body("envíos v2"), p_note: null },
      admin!,
    );
    const noNote = await rpc(
      "admin_legal_publish",
      { p_kind: "shipping", p_effective_at: null, p_note: null },
      admin!,
    );
    expect(noNote.body.message).toBe("change_note_required");
    const second = await rpc(
      "admin_legal_publish",
      { p_kind: "shipping", p_effective_at: null, p_note: "Cambió el plazo" },
      admin!,
    );
    expect(second.body.version).toBe(2);

    // y la pública ve la 2 con su nota
    const doc = await rpc("public_legal_document", { p_kind: "shipping" });
    expect(doc.body).toMatchObject({ version: 2, change_note: "Cambió el plazo" });
    expect(doc.body.body).toContain("envíos v2");
  });

  it("un texto con HTML o demasiado corto no se guarda", async (ctx) => {
    guard(ctx);
    for (const [text, message] of [
      ["<script>alert(1)</script> y más texto de relleno aquí", "html_not_allowed"],
      ["corto", "invalid_body"],
    ] as const) {
      const res = await rpc(
        "admin_legal_save_draft",
        { p_kind: "returns", p_body: text, p_note: null },
        admin!,
      );
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(message);
    }
  });

  it("DOS publicaciones simultáneas del mismo borrador dan UNA sola versión (la otra: no_draft)", async (ctx) => {
    guard(ctx);
    await rpc(
      "admin_legal_save_draft",
      { p_kind: "returns", p_body: body("devoluciones v1"), p_note: null },
      admin!,
    );
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        rpc(
          "admin_legal_publish",
          { p_kind: "returns", p_effective_at: null, p_note: null },
          admin!,
        ),
      ),
    );
    const ok = results.filter((r) => r.status === 200);
    expect(ok, JSON.stringify(results.map((r) => r.body))).toHaveLength(1);
    expect(
      results.filter((r) => r.status !== 200).every((r) => r.body.message === "no_draft"),
    ).toBe(true);
    expect(Number(dbSql(`select count(*) from public.legal_versions where kind = 'returns'`))).toBe(
      1,
    );
  });
});

describe("textos legales · registro y checkout exigen las versiones vigentes", () => {
  let terms = 0;
  let privacy = 0;

  beforeAll(async () => {
    if (skipReason) return;
    terms = (await publish("terms", "términos v1")).version;
    privacy = (await publish("privacy", "privacidad v1")).version;
  }, 60_000);

  it("la tienda ve qué exigir: solo términos y privacidad, con su versión", async (ctx) => {
    guard(ctx);
    const required = await rpc("public_legal_required", {});
    expect(required.body).toEqual({ terms, privacy });
  });

  it("registrarse sin aceptar → 409 legal_required (con lo vigente) y NO crea la cuenta", async (ctx) => {
    guard(ctx);
    await clearRateLimits();
    const email = uniqueEmail("legal-falta");
    const res = await register({ full_name: "Sin aceptar", email, password: STRONG_PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "legal_required", required: { terms, privacy } });
    const only = await register({
      full_name: "Solo términos",
      email,
      password: STRONG_PASSWORD,
      legal_terms: terms,
    });
    expect(only.status).toBe(409);
    const accounts = await svcRest(
      "GET",
      `profiles?email=eq.${encodeURIComponent(email)}&select=id`,
    );
    expect(accounts.body).toEqual([]);
  });

  it("una versión vieja o inventada → 409 legal_outdated; tipos raros → 400", async (ctx) => {
    guard(ctx);
    await clearRateLimits();
    const email = uniqueEmail("legal-vieja");
    const old = await register({
      full_name: "Versión vieja",
      email,
      password: STRONG_PASSWORD,
      legal_terms: terms + 1,
      legal_privacy: privacy,
    });
    expect(old.status).toBe(409);
    expect(old.body.error.code).toBe("legal_outdated");
    for (const bad of ["1", 1.5, 0, [1], { v: 1 }]) {
      await clearRateLimits(); // el registro admite pocos intentos por red: cada uno se cuenta aparte
      const res = await register({
        full_name: "Raro",
        email,
        password: STRONG_PASSWORD,
        legal_terms: bad,
        legal_privacy: privacy,
      });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("registrarse aceptando lo vigente crea la cuenta y deja UNA aceptación por texto, con la huella de la red (nunca la IP)", async (ctx) => {
    guard(ctx);
    await clearRateLimits();
    const email = uniqueEmail("legal-ok");
    const res = await register({
      full_name: "Acepta todo",
      email,
      password: STRONG_PASSWORD,
      legal_terms: terms,
      legal_privacy: privacy,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const profile = await svcRest(
      "GET",
      `profiles?email=eq.${encodeURIComponent(email)}&select=id`,
    );
    const id = profile.body[0].id as string;
    expect(acceptances(id)).toEqual([
      `privacy:${privacy}:register:-:true`,
      `terms:${terms}:register:-:true`,
    ]);
    // el hash no contiene ninguna IP y no se repite entre textos de otra persona: es hexadecimal de 64 caracteres
    const hashes = dbSql(
      `select distinct ip_hash from public.legal_acceptances where profile_id = '${id}'`,
    );
    expect(hashes).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes).not.toMatch(/\./);
  });

  it("quien ya tenía cuenta ve lo pendiente al publicarse una versión nueva y la acepta con `legal-accept`", async (ctx) => {
    guard(ctx);
    const customer = created.customers[0]!;
    // la clienta se creó antes de publicar: le falta todo
    const pending = await rpc("my_legal_pending", {}, customer.token);
    expect(pending.body).toEqual({ terms, privacy });
    expect((await rpc("my_legal_pending", {})).status).toBeGreaterThanOrEqual(400); // anónimo: no

    // sin sesión → 401; campo de más → 400; sin versiones → 409; versión vieja → 409; la vigente → 200
    expect((await fn("legal-accept", { legal_terms: terms, legal_privacy: privacy })).status).toBe(
      401,
    );
    expect(
      (await fn("legal-accept", { legal_terms: terms, extra: 1 }, { token: customer.token }))
        .status,
    ).toBe(400);
    const none = await fn("legal-accept", {}, { token: customer.token });
    expect(none.status).toBe(409);
    expect(none.body.error.code).toBe("legal_required");
    const old = await fn(
      "legal-accept",
      { legal_terms: terms + 5, legal_privacy: privacy },
      { token: customer.token },
    );
    expect(old.status).toBe(409);
    expect(old.body.error.code).toBe("legal_outdated");
    expect(acceptances(customer.id)).toEqual([]);

    const ok = await fn(
      "legal-accept",
      { legal_terms: terms, legal_privacy: privacy },
      { token: customer.token },
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(acceptances(customer.id)).toEqual([
      `privacy:${privacy}:reaccept:-:true`,
      `terms:${terms}:reaccept:-:true`,
    ]);
    expect((await rpc("my_legal_pending", {}, customer.token)).body).toEqual({});

    // una versión nueva de los términos (con la nota obligatoria) vuelve a dejarla pendiente SOLO de los términos
    const v2 = await publish("terms", "términos v2", "Cambió algo importante");
    expect((await rpc("my_legal_pending", {}, customer.token)).body).toEqual({ terms: v2.version });
    expect((await rpc("public_legal_required", {})).body).toEqual({ terms: v2.version, privacy });
    terms = v2.version;

    // acepta SOLO la que le faltaba (la privacidad no cambió y no se le vuelve a pedir ni se anota de nuevo)
    const onlyTerms = await fn("legal-accept", { legal_terms: terms }, { token: customer.token });
    expect(onlyTerms.status, JSON.stringify(onlyTerms.body)).toBe(200);
    expect(acceptances(customer.id)).toEqual([
      `privacy:${privacy}:reaccept:-:true`,
      `terms:${terms - 1}:reaccept:-:true`,
      `terms:${terms}:reaccept:-:true`,
    ]);
    expect((await rpc("my_legal_pending", {}, customer.token)).body).toEqual({});
    // lo que no es la versión vigente de un texto que se exige sigue rechazándose, también en una aceptación parcial
    const stale = await fn(
      "legal-accept",
      { legal_privacy: privacy + 4 },
      { token: customer.token },
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("legal_outdated");
  });

  it("el checkout exige lo vigente; solo un pedido CREADO deja su aceptación (una vista previa, un total cambiado o un reintento no)", async (ctx) => {
    guard(ctx);
    const c = created.customers[1]!;
    await clearRateLimits();
    const product = await makeProduct(100, 5);
    expect(
      (
        await fn(
          "cart",
          { action: "set_item", variant_id: product.variantId, qty: 1 },
          { token: c.token },
        )
      ).status,
    ).toBe(200);
    const preview = await fn(
      "checkout",
      {
        action: "preview",
        shipping_method: "delivery",
        address_id: c.addressId,
        payment_method: "whatsapp",
      },
      { token: c.token },
    );
    expect(preview.status, JSON.stringify(preview.body)).toBe(200); // la vista previa no exige aceptar
    const total = preview.body.checkout.totals.total as number;
    const key = `k-${randomTag()}-${randomTag()}`;
    const create = (extra: Record<string, unknown>, expected = total, k = key) =>
      fn(
        "checkout",
        {
          action: "create",
          shipping_method: "delivery",
          address_id: c.addressId,
          payment_method: "whatsapp",
          contact_name: "Clienta de prueba",
          contact_phone: "+59171234567",
          expected_total: expected,
          idempotency_key: k,
          ...extra,
        },
        { token: c.token },
      );

    const missing = await create({});
    expect(missing.status).toBe(409);
    expect(missing.body.error).toMatchObject({
      code: "legal_required",
      required: { terms, privacy },
    });
    const outdated = await create({ legal_terms: terms - 1, legal_privacy: privacy });
    expect(outdated.status).toBe(409);
    expect(outdated.body.error.code).toBe("legal_outdated");
    expect(acceptances(c.id)).toEqual([]);

    // aceptando lo vigente pero con un total que cambió: el pedido NO se crea → no queda ninguna aceptación de pedido
    const changed = await create({ legal_terms: terms, legal_privacy: privacy }, total + 1);
    expect(changed.status).toBe(200);
    expect(changed.body.outcome).toBe("changed");
    expect(acceptances(c.id)).toEqual([]);

    const created1 = await create({ legal_terms: terms, legal_privacy: privacy });
    expect(created1.status, JSON.stringify(created1.body)).toBe(200);
    expect(created1.body.outcome).toBe("created");
    const orderId = created1.body.order.id as string;
    expect(acceptances(c.id)).toEqual([
      `privacy:${privacy}:checkout:${orderId}:true`,
      `terms:${terms}:checkout:${orderId}:true`,
    ]);

    // reintentar con la misma llave devuelve el mismo pedido y NO duplica la aceptación
    const again = await create({ legal_terms: terms, legal_privacy: privacy });
    expect(again.body.outcome).toBe("existing");
    expect(acceptances(c.id)).toHaveLength(2);

    // las estadísticas del panel cuentan esa cuenta y ese pedido
    const stats = await rpc("admin_legal_acceptance_stats", {}, admin!);
    const row = (
      stats.body as { kind: string; version: number; accounts: number; orders: number }[]
    ).find((r) => r.kind === "terms" && r.version === terms);
    expect(row?.orders).toBeGreaterThanOrEqual(1);

    // se deja el pedido cancelado (repone el stock), como las demás pruebas
    const cancel = await fn(
      "checkout",
      { action: "cancel", order_id: orderId },
      { token: c.token },
    );
    expect(cancel.status).toBe(200);
  });
});
