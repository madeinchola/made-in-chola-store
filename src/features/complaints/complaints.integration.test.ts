import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearRateLimits,
  dbExec,
  dbSql,
  fn,
  randomTag,
  registerAndLogin,
  rest,
  rpc,
  svcRest,
  testEnv,
} from "../../../test-support/api";
import { adminSession } from "../../../test-support/shop";

/**
 * Canal de reclamos (Sprint 15) contra la nube, por HTTP real: la función `complaint` desplegada (público, con o sin cuenta; límites,
 * campo trampa, esquema estricto), lo que queda en la base (limpio, con la huella de la red y SIN la IP), la alerta al administrador,
 * y la bandeja con los permisos de cada rol. Lo que NO se prueba aquí: que el correo de la alerta llegue (no hay proveedor de correo
 * configurado: lo cubren las pruebas del worker).
 *
 * Los reclamos de prueba llevan un marcador en el nombre y se BORRAN con SQL directo al terminar (la tabla no admite borrar desde la API).
 */
const tag = randomTag();
const NAME = (label: string) => `Prueba S15 ${tag} ${label}`;
let admin: string | null = null;
let customer: { token: string; id: string } | null = null;
const DETAIL = "La prenda llegó con una costura abierta y no es lo que pedí. Prueba automática.";

beforeAll(async () => {
  await clearRateLimits();
  const session = await adminSession();
  admin = session?.token ?? null;
  const user = await registerAndLogin({ name: "Clienta reclamos" });
  customer = { token: user.token, id: user.id };
}, 120_000);

afterAll(async () => {
  try {
    dbExec(`delete from public.notification_outbox where dedupe_key in (select 'complaint_new:' || id::text from public.complaints where contact_name like 'Prueba S15 ${tag}%');
            delete from public.complaints where contact_name like 'Prueba S15 ${tag}%';`);
  } catch {
    /* si la cola no deja borrar, los avisos quedan inertes */
  }
  await clearRateLimits();
}, 120_000);

const post = (body: unknown, token?: string) => fn("complaint", body, token ? { token } : {});
const valid = (label: string, over: Record<string, unknown> = {}) => ({
  contact_name: NAME(label),
  contact_email: "  Ana.Prueba@Example.COM ",
  kind: "product",
  detail: DETAIL,
  ...over,
});
const row = (number: string) =>
  dbSql(
    `select concat_ws('|', status, kind, coalesce(profile_id::text, '-'), contact_email, coalesce(contact_phone, '-'), coalesce(order_number, '-'),
                      (ip_hash ~ '^[0-9a-f]{64}$')::text)
       from public.complaints where number = '${number}'`,
  );

describe("complaint · registrar (HTTP real)", () => {
  it("un visitante sin cuenta reclama: queda limpio, anónimo y con la huella de la red; recibe su número y su plazo", async () => {
    await clearRateLimits();
    const res = await post(
      valid("anonimo", { contact_phone: "7123 4567", order_number: " mic-000123 " }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(res.body.number).toMatch(/^REC-\d{6,}$/);
    const due = new Date(res.body.due_at as string).getTime();
    expect(due).toBeGreaterThan(Date.now() + 9 * 86_400_000);
    expect(due).toBeLessThan(Date.now() + 11 * 86_400_000);
    expect(row(res.body.number)).toBe(
      "new|product|-|ana.prueba@example.com|+59171234567|MIC-000123|true",
    );
    // la IP no se guarda en ninguna columna
    expect(
      dbSql(
        `select (to_jsonb(c)::text ~ '[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+') from public.complaints c where number = '${res.body.number}'`,
      ),
    ).toBe("f");
  });

  it("la alerta a los administradores se encola UNA vez, sin datos de la persona", async () => {
    await clearRateLimits();
    const res = await post(valid("alerta"));
    expect(res.status).toBe(200);
    const id = dbSql(`select id from public.complaints where number = '${res.body.number}'`);
    expect(
      dbSql(
        `select count(*) from public.notification_outbox where dedupe_key = 'complaint_new:${id}'`,
      ),
    ).toBe("1");
    const payload = dbSql(
      `select payload::text from public.notification_outbox where dedupe_key = 'complaint_new:${id}'`,
    );
    expect(payload).toContain(res.body.number);
    expect(payload).not.toMatch(/ana\.prueba|costura|Prueba S15/i);
    // y a quien reclama no se le escribe automáticamente
    expect(
      dbSql(
        `select count(*) from public.notification_outbox where type like 'complaint%' and recipient = 'ana.prueba@example.com'`,
      ),
    ).toBe("0");
  });

  it("con sesión válida el reclamo queda ligado a SU cuenta; con la clave anónima como «sesión», sigue siendo anónimo", async () => {
    await clearRateLimits();
    const withAccount = await post(valid("cuenta"), customer!.token);
    expect(withAccount.status, JSON.stringify(withAccount.body)).toBe(200);
    expect(row(withAccount.body.number).split("|")[2]).toBe(customer!.id);
    await clearRateLimits();
    const anonKey = await post(valid("clave"), testEnv().anon);
    expect(anonKey.status).toBe(200);
    expect(row(anonKey.body.number).split("|")[2]).toBe("-");
  });

  it("una sesión vencida o rota no tumba el reclamo: se registra como anónimo", async () => {
    await clearRateLimits();
    const broken = customer!.token.slice(0, -4) + "AAAA";
    const res = await post(valid("rota"), broken);
    expect([200, 401]).toContain(res.status);
    if (res.status === 200) expect(row(res.body.number).split("|")[2]).toBe("-");
  });

  it("el campo trampa: un robot recibe un «recibido» sin número y NO se guarda nada", async () => {
    await clearRateLimits();
    const before = dbSql(
      `select count(*) from public.complaints where contact_name like 'Prueba S15 ${tag}%'`,
    );
    const res = await post(valid("robot", { website: "http://spam.example" }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, number: null, due_at: null });
    expect(
      dbSql(`select count(*) from public.complaints where contact_name like 'Prueba S15 ${tag}%'`),
    ).toBe(before);
  });

  it.each([
    ["sin correo ni teléfono", { contact_email: undefined }, "contact_required"],
    ["correo inválido", { contact_email: "mal" }, "invalid_email"],
    ["teléfono inválido", { contact_email: undefined, contact_phone: "abc" }, "invalid_phone"],
    ["pedido inválido", { order_number: "pedido uno" }, "invalid_order_number"],
  ])("%s → 400 %s", async (_label, over, code) => {
    await clearRateLimits();
    const res = await post(valid("invalido", over));
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.code).toBe(code);
  });

  it("el esquema es estricto: detalle corto, tipo inexistente, campos de más (el estado, la cuenta) → 400", async () => {
    await clearRateLimits();
    for (const over of [
      { detail: "corto" },
      { kind: "queja" },
      { status: "closed" },
      { profile_id: customer!.id },
      { due_at: "2030-01-01T00:00:00Z" },
    ]) {
      await clearRateLimits();
      const res = await post(valid("estricto", over));
      expect(res.status, JSON.stringify(over)).toBe(400);
      expect(res.body.error.code).toBe("validation");
    }
  });

  it("un cuerpo de más de 4 kB → 413, un JSON roto → 400 y solo POST (GET → 405)", async () => {
    await clearRateLimits();
    expect((await post(valid("grande", { detail: "x".repeat(5000) }))).status).toBe(413);
    const broken = await fetch(`${testEnv().url}/functions/v1/complaint`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: testEnv().anon },
      body: "{",
    });
    expect(broken.status).toBe(400);
    const get = await fetch(`${testEnv().url}/functions/v1/complaint`, {
      method: "GET",
      headers: { apikey: testEnv().anon },
    });
    expect(get.status).toBe(405);
  });

  it("límite por red: el 6.º reclamo de la hora se rechaza con 429 (y no se guarda)", async () => {
    await clearRateLimits();
    const before = Number(
      dbSql(`select count(*) from public.complaints where contact_name like 'Prueba S15 ${tag}%'`),
    );
    const results: number[] = [];
    for (let i = 0; i < 6; i++) results.push((await post(valid(`flood${i}`))).status);
    expect(results.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(results[5]).toBe(429);
    expect(
      Number(
        dbSql(
          `select count(*) from public.complaints where contact_name like 'Prueba S15 ${tag}%'`,
        ),
      ),
    ).toBe(before + 5);
    await clearRateLimits();
  });
});

describe("complaint · la bandeja y los permisos", () => {
  let number = "";
  let id = "";
  const range = { p_status: null, p_offset: 0, p_limit: 200 };

  beforeAll(async () => {
    await clearRateLimits();
    const res = await post(valid("bandeja"));
    number = res.body.number as string;
    id = dbSql(`select id from public.complaints where number = '${number}'`);
  });

  it("la tabla no se lee ni se escribe por la API, ni la clienta ni el servicio", async () => {
    for (const read of [
      await rest("GET", "complaints?select=*", customer!.token),
      await svcRest("GET", "complaints?select=*"),
    ]) {
      expect(read.status === 200 ? read.body : []).toEqual([]);
    }
    expect(
      (await svcRest("POST", "complaints", { contact_name: "x" })).status,
    ).toBeGreaterThanOrEqual(400);
  });

  it("la bandeja y su resumen son SOLO del administrador; registrar por RPC es solo del servicio", async (ctx) => {
    if (!admin) return ctx.skip("No hay una cuenta de administración de prueba (@prueba.test).");
    for (const [name, args] of [
      ["admin_complaints", range],
      ["admin_complaints_summary", {}],
      ["admin_complaint_update", { p_id: id, p_status: "closed", p_response: null }],
    ] as const) {
      expect((await rpc(name, args)).status, `${name} anónimo`).toBeGreaterThanOrEqual(400);
      expect(
        (await rpc(name, args, customer!.token)).status,
        `${name} clienta`,
      ).toBeGreaterThanOrEqual(400);
    }
    const submit = { p_data: valid("rpc"), p_profile: null, p_ip_hash: null };
    expect((await rpc("submit_complaint", submit)).status).toBeGreaterThanOrEqual(400);
    expect((await rpc("submit_complaint", submit, customer!.token)).status).toBeGreaterThanOrEqual(
      400,
    );
    expect((await rpc("submit_complaint", submit, admin)).status).toBeGreaterThanOrEqual(400);
  });

  it("el administrador ve el reclamo, lo pasa por sus estados y la base exige la respuesta para «respondido»", async (ctx) => {
    if (!admin) return ctx.skip("No hay una cuenta de administración de prueba (@prueba.test).");
    const list = await rpc(
      "admin_complaints",
      { p_status: "open", p_offset: 0, p_limit: 200 },
      admin,
    );
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const mine = (
      list.body as { number: string; status: string; overdue: boolean; has_account: boolean }[]
    ).find((r) => r.number === number);
    expect(mine).toMatchObject({ status: "new", overdue: false, has_account: false });

    const noResponse = await rpc(
      "admin_complaint_update",
      { p_id: id, p_status: "answered", p_response: null },
      admin,
    );
    expect(noResponse.status).toBe(400);
    expect(noResponse.body.message).toBe("response_required");
    const review = await rpc(
      "admin_complaint_update",
      { p_id: id, p_status: "in_review", p_response: null },
      admin,
    );
    expect(review.status).toBeLessThan(300);
    const answered = await rpc(
      "admin_complaint_update",
      { p_id: id, p_status: "answered", p_response: "  Le enviamos otra prenda.  " },
      admin,
    );
    expect(answered.status, JSON.stringify(answered.body)).toBeLessThan(300);
    expect(
      dbSql(
        `select status || '|' || response || '|' || (answered_at is not null)::text || '|' || (handled_by is not null)::text from public.complaints where id = '${id}'`,
      ),
    ).toBe("answered|Le enviamos otra prenda.|true|true");
    const gone = await rpc(
      "admin_complaint_update",
      { p_id: "00000000-0000-4000-8000-000000000000", p_status: "closed", p_response: null },
      admin,
    );
    expect(gone.status).toBeGreaterThanOrEqual(400);
    const summary = await rpc("admin_complaints_summary", {}, admin);
    expect(summary.body).toMatchObject({
      new: expect.any(Number),
      in_review: expect.any(Number),
      overdue: expect.any(Number),
      total: expect.any(Number),
    });
  });

  it("lo que se escribe en la auditoría NO lleva el correo ni el detalle", async () => {
    const diff = dbSql(
      `select diff::text from public.audit_log where table_name = 'complaints' and action = 'INSERT' and record_id = '${id}'`,
    );
    expect(diff).toContain("[redacted]");
    expect(diff).not.toMatch(/ana\.prueba|costura|Prueba S15/i);
  });
});
