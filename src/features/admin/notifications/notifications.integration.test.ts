import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearRateLimits,
  dbPsql,
  fn,
  randomTag,
  recoverySession,
  registerAndLogin,
  rest,
  rpc,
  svcRest,
  svcRpc,
  testEnv,
} from "../../../../test-support/api";

/**
 * Notificaciones (Sprint 13) contra la nube, con la pila REAL: la función `notify-worker` DESPLEGADA, la base (SKIP LOCKED, reintentos,
 * estados), PostgREST con RLS y `notify-admin`. Usa el proveedor de PRUEBAS (`fake`), que solo entrega a direcciones `@prueba.test`:
 * jamás sale un correo de verdad. Usa una cuenta de administración que YA existe (no se crean) y deja los ajustes como estaban.
 * Lo que una prueba pgTAP de una sola sesión no puede mostrar —tres workers a la vez sobre los mismos avisos, un worker que muere— se
 * prueba aquí con llamadas simultáneas reales.
 */

let admin = "";
let adminEmail = "";
let customer: { token: string; id: string; email: string } | null = null;
const original = new Map<string, unknown>();

const uniq = () => `${randomTag()}${randomTag()}`;
const SETTINGS = [
  "notify_email_provider",
  "notify_max_attempts",
  "notify_backoff_seconds",
  "notify_from_email",
] as const;

const setSetting = async (key: string, value: unknown) => {
  const res = await rest("PATCH", `store_settings?key=eq.${key}`, admin, { value });
  expect(res.status, `${key}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
};

// La clave de servicio es del formato nuevo (`sb_secret_…`): la pasarela exige que `apikey` y `Authorization` lleven LA MISMA.
const worker = (body: Record<string, unknown>, token = testEnv().service) =>
  fn("notify-worker", body, {
    token,
    headers: token === testEnv().service ? { apikey: token } : {},
  });
const rowOf = async (id: number) =>
  (await svcRest("GET", `notification_outbox?id=eq.${id}&select=*`)).body[0] as Record<string, any>;

/** Un aviso del pedido (con plantilla de la clienta) a una dirección de pruebas; el local-part controla al proveedor de pruebas. */
async function enqueue(local: string, over: { type?: string; key?: string } = {}): Promise<number> {
  const res = await svcRpc("enqueue_notification", {
    p_type: over.type ?? "payment_failed",
    p_channel: "email",
    p_recipient: `${local}@prueba.test`,
    p_payload: {
      number: `MIC-T${uniq().slice(0, 6)}`,
      total: 100,
      currency: "BOB",
      status: "pending_payment",
    },
    p_dedupe_key: over.key ?? `int-${uniq()}`,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as number;
}
const makeDue = (id: number) =>
  svcRest("PATCH", `notification_outbox?id=eq.${id}`, {
    next_retry_at: new Date(Date.now() - 1000).toISOString(),
  });
const secondsAhead = (iso: string) => (new Date(iso).getTime() - Date.now()) / 1000;

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
  adminEmail = found.email;
  admin = (await recoverySession(found.email)).access;
  const settings = await svcRest(
    "GET",
    `store_settings?key=in.(${SETTINGS.join(",")})&select=key,value`,
  );
  for (const row of settings.body as { key: string; value: unknown }[])
    original.set(row.key, row.value);
  const user = await registerAndLogin({ name: "Clienta S13" });
  customer = { token: user.token, id: user.id, email: user.email! };
  await setSetting("notify_email_provider", "fake");
  await setSetting("notify_max_attempts", 8);
  await setSetting("notify_backoff_seconds", 60);
}, 120_000);

afterAll(async () => {
  if (!admin) return;
  for (const key of SETTINGS) if (original.has(key)) await setSetting(key, original.get(key));
}, 60_000);

const guard = (ctx: { skip: (note?: string) => void }) => {
  if (!admin || !customer)
    ctx.skip("No hay una cuenta de administración de prueba (@prueba.test) para entrar.");
};

describe("el worker desplegado", () => {
  it("solo acepta la clave de servicio: sin credencial, con una falsa o con la sesión de un administrador, 403", async (ctx) => {
    guard(ctx);
    expect((await fn("notify-worker", {})).status).toBe(403);
    expect((await worker({}, "no-es-la-clave")).status).toBe(403);
    expect((await worker({}, admin)).status).toBe(403);
    expect((await worker({}, customer!.token)).status).toBe(403);
    const ok = await worker({ ids: [-1] });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
  });

  it("entrega un aviso con el proveedor de pruebas: queda «sent» con el mensaje armado y el id del proveedor", async (ctx) => {
    guard(ctx);
    const id = await enqueue(`ok-${uniq()}`);
    const res = await worker({ ids: [id] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ claimed: 1, sent: 1, retried: 0, failed: 0 });
    const row = await rowOf(id);
    expect(row.status).toBe("sent");
    expect(row.provider).toBe("fake");
    expect(row.provider_message_id).toBe(`fake_notif-${id}`);
    expect(row.attempts).toBe(1);
    expect(row.sent_at).toBeTruthy();
    expect(row.locked_by).toBeNull();
    expect(row.rendered_subject).toMatch(/No pudimos confirmar el pago de tu pedido MIC-T/);
    expect(row.rendered_body).toMatch(/Bs 100,00|MIC-T/);
    expect(row.rendered_body).not.toMatch(/<|\{\{/);
  });

  it("un error transitorio vuelve a la cola con SU espera exponencial (60 s, luego 120 s) y conserva el código del error", async (ctx) => {
    guard(ctx);
    const id = await enqueue("transient");
    const first = await worker({ ids: [id] });
    expect(first.body).toMatchObject({ claimed: 1, retried: 1, sent: 0 });
    const afterFirst = await rowOf(id);
    expect([afterFirst.status, afterFirst.attempts, afterFirst.last_error]).toEqual([
      "pending",
      1,
      "provider_503",
    ]);
    expect(secondsAhead(afterFirst.next_retry_at)).toBeGreaterThan(40);
    expect(secondsAhead(afterFirst.next_retry_at)).toBeLessThan(70);
    // Aún no toca: el worker no lo toma.
    expect((await worker({ ids: [id] })).body.claimed).toBe(0);
    await makeDue(id);
    expect((await worker({ ids: [id] })).body.retried).toBe(1);
    const afterSecond = await rowOf(id);
    expect([afterSecond.attempts, afterSecond.status]).toEqual([2, "pending"]);
    expect(secondsAhead(afterSecond.next_retry_at)).toBeGreaterThan(100);
    expect(secondsAhead(afterSecond.next_retry_at)).toBeLessThan(130);
  });

  it("un error permanente no se reintenta: «failed» con su código", async (ctx) => {
    guard(ctx);
    const id = await enqueue("permanent");
    expect((await worker({ ids: [id] })).body).toMatchObject({ claimed: 1, failed: 1 });
    const row = await rowOf(id);
    expect([row.status, row.last_error, row.attempts]).toEqual(["failed", "invalid_request", 1]);
    await makeDue(id);
    expect((await worker({ ids: [id] })).body.claimed).toBe(0);
  });

  it("si el proveedor pide esperar (429), se respeta SU espera de 120 s", async (ctx) => {
    guard(ctx);
    const id = await enqueue("ratelimit");
    await worker({ ids: [id] });
    const row = await rowOf(id);
    expect([row.status, row.last_error]).toEqual(["pending", "rate_limited"]);
    expect(secondsAhead(row.next_retry_at)).toBeGreaterThan(100);
    expect(secondsAhead(row.next_retry_at)).toBeLessThan(130);
  });

  it("si el proveedor vuelve antes, el siguiente intento lo entrega UNA vez (2 intentos, un solo envío)", async (ctx) => {
    guard(ctx);
    const id = await enqueue("transient-1");
    expect((await worker({ ids: [id] })).body.retried).toBe(1);
    await makeDue(id);
    expect((await worker({ ids: [id] })).body.sent).toBe(1);
    const row = await rowOf(id);
    expect([row.status, row.attempts, row.provider_message_id]).toEqual([
      "sent",
      2,
      `fake_notif-${id}`,
    ]);
    await makeDue(id);
    expect((await worker({ ids: [id] })).body.claimed, "uno ya enviado no se vuelve a tomar").toBe(
      0,
    );
  });

  it("agotados los intentos pasa a «dead» y se alerta UNA vez a los administradores; el administrador puede reenviarlo", async (ctx) => {
    guard(ctx);
    await setSetting("notify_max_attempts", 2);
    try {
      const id = await enqueue("transient");
      await worker({ ids: [id] });
      await makeDue(id);
      const last = await worker({ ids: [id] });
      expect(last.body).toMatchObject({ claimed: 1, dead: 1 });
      const row = await rowOf(id);
      expect([row.status, row.attempts]).toEqual(["dead", 2]);
      const alerts = await svcRest(
        "GET",
        `notification_outbox?dedupe_key=eq.notification_dead:${id}&select=type,recipient,payload,status`,
      );
      expect(alerts.body).toHaveLength(1);
      expect(alerts.body[0]).toMatchObject({
        type: "notification_dead",
        recipient: null,
        status: "pending",
      });
      expect(alerts.body[0].payload).toMatchObject({
        notification_id: id,
        notification_type: "payment_failed",
        attempts: 2,
      });
      expect(JSON.stringify(alerts.body[0].payload)).not.toMatch(/prueba\.test/);

      // Reenviar: una fila NUEVA (la original no se toca); como el destino sigue fallando, también termina mal, pero es otra fila.
      const resent = await rpc("admin_notification_resend", { p_id: id }, admin);
      expect(resent.status, JSON.stringify(resent.body)).toBe(200);
      expect(resent.body.outcome).toBe("queued");
      const copy = await rowOf(resent.body.id);
      expect([copy.resent_of, copy.status, copy.dedupe_key.endsWith(":r1")]).toEqual([
        id,
        "pending",
        true,
      ]);
      expect((await rowOf(id)).status).toBe("dead");
      expect(
        (await rpc("admin_notification_resend", { p_id: resent.body.id }, admin)).body.outcome,
      ).toBe("in_progress");
    } finally {
      await setSetting("notify_max_attempts", 8);
    }
  });

  it("TRES workers a la vez sobre los MISMOS 12 avisos: cada uno se toma una sola vez (SKIP LOCKED), sin duplicar", async (ctx) => {
    guard(ctx);
    const ids = await Promise.all(
      Array.from({ length: 12 }, (_, i) => enqueue(`ok-${i}-${uniq()}`)),
    );
    const reports = await Promise.all(
      [1, 2, 3].map((n) => worker({ ids, limit: 25, worker: `par-${n}` })),
    );
    for (const report of reports) expect(report.status, JSON.stringify(report.body)).toBe(200);
    const claimed = reports.reduce((sum, r) => sum + r.body.claimed, 0);
    const sent = reports.reduce((sum, r) => sum + r.body.sent, 0);
    expect({ claimed, sent, lost: reports.reduce((sum, r) => sum + r.body.lost, 0) }).toEqual({
      claimed: 12,
      sent: 12,
      lost: 0,
    });
    const rows = (
      await svcRest(
        "GET",
        `notification_outbox?id=in.(${ids.join(",")})&select=id,status,attempts,provider_message_id`,
      )
    ).body as Record<string, any>[];
    expect(rows).toHaveLength(12);
    for (const row of rows)
      expect([row.status, row.attempts, row.provider_message_id]).toEqual([
        "sent",
        1,
        `fake_notif-${row.id}`,
      ]);
  });

  it("un aviso que OTRO worker tiene bloqueado se SALTA, no se espera: el worker sigue con los demás (SKIP LOCKED)", async (ctx) => {
    guard(ctx);
    const [locked, free] = await Promise.all([enqueue(`ok-${uniq()}`), enqueue(`ok-${uniq()}`)]);
    // Otra sesión retiene el candado de «locked» 10 s (como un worker lento a mitad de su lote).
    const holder = dbPsql(
      `begin; select id from public.notification_outbox where id = ${locked} for update; select pg_sleep(10); commit;`,
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const started = Date.now();
    const report = await worker({ ids: [locked, free] });
    const elapsed = (Date.now() - started) / 1000;
    expect(report.status, JSON.stringify(report.body)).toBe(200);
    // Sin SKIP LOCKED el worker se quedaría esperando al candado (≈ 8 s más) y se llevaría los dos.
    expect(elapsed, "no esperó al candado de otro worker").toBeLessThan(6);
    expect(report.body).toMatchObject({ claimed: 1, sent: 1 });
    expect((await rowOf(free)).status).toBe("sent");
    const stillThere = await rowOf(locked);
    expect(
      [stillThere.status, stillThere.attempts],
      "el bloqueado quedó para después, intacto",
    ).toEqual(["pending", 0]);
    await holder;
    expect((await worker({ ids: [locked] })).body.sent, "ya libre, se entrega").toBe(1);
  }, 60_000);

  it("un worker que murió a mitad de un envío: su aviso se rescata a los 5 minutos y se entrega, sin perderse", async (ctx) => {
    guard(ctx);
    const id = await enqueue(`ok-${uniq()}`);
    // Simula al muerto: tomado hace 6 minutos y nunca cerrado.
    const stuck = await svcRest("PATCH", `notification_outbox?id=eq.${id}`, {
      status: "sending",
      attempts: 1,
      locked_by: "muerto",
      locked_at: new Date(Date.now() - 6 * 60_000).toISOString(),
    });
    expect(stuck.status).toBe(200);
    await worker({ ids: [id] });
    const rescued = await rowOf(id);
    expect([rescued.status, rescued.last_error, rescued.attempts]).toEqual([
      "pending",
      "worker_lost",
      1,
    ]);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect((await worker({ ids: [id] })).body.sent).toBe(1);
    const done = await rowOf(id);
    expect([done.status, done.attempts]).toEqual(["sent", 2]);
  });

  it("sin una clave del proveedor real, los correos ESPERAN en la cola (no se pierden ni gastan intentos)", async (ctx) => {
    guard(ctx);
    await setSetting("notify_email_provider", "resend");
    await setSetting("notify_from_email", "pedidos@chola.test");
    try {
      const id = await enqueue(`ok-${uniq()}`);
      const report = await worker({ ids: [id] });
      expect(report.body).toMatchObject({ claimed: 0, note: "email_not_configured" });
      const row = await rowOf(id);
      expect([row.status, row.attempts]).toEqual(["pending", 0]);
    } finally {
      await setSetting("notify_email_provider", "fake");
      await setSetting("notify_from_email", (original.get("notify_from_email") as string) ?? "");
    }
  });

  it("WhatsApp en modo manual: el mensaje queda escrito y el aviso «por enviar a mano»; el administrador lo marca enviado", async (ctx) => {
    guard(ctx);
    const res = await svcRpc("enqueue_notification", {
      p_type: "payment_failed",
      p_channel: "whatsapp",
      p_recipient: "+59170000099",
      p_payload: { number: "MIC-TWA001", total: 100, currency: "BOB" },
      p_dedupe_key: `int-wa-${uniq()}`,
    });
    const id = res.body as number;
    expect((await worker({ ids: [id] })).body.manual).toBe(1);
    const row = await rowOf(id);
    expect([row.status, row.provider]).toEqual(["manual", "whatsapp_manual"]);
    expect(row.rendered_body).toMatch(/MIC-TWA001/);
    expect((await rpc("admin_notification_mark_sent", { p_id: id }, admin)).body.outcome).toBe(
      "sent",
    );
    const sent = await rowOf(id);
    expect([sent.status, sent.sent_by !== null]).toEqual(["sent", true]);
    expect((await rpc("admin_notification_mark_sent", { p_id: id }, admin)).body.outcome).toBe(
      "not_manual",
    );
  });
});

describe("avisos del pedido de punta a punta (la base real)", () => {
  it("cada cambio de estado deja UN aviso a la clienta; «empacado» espera la ventana y «deshacer» lo cancela", async (ctx) => {
    guard(ctx);
    const tag = randomTag();
    const product = await svcRest("POST", "products", {
      code: `S13${tag}`.toUpperCase(),
      slug: `s13-${tag}`,
      name: `Producto S13 ${tag}`,
      cost_base: 10,
    });
    const productId = product.body[0].id as string;
    const color = await svcRest("POST", "product_colors", { product_id: productId, name: "Único" });
    const variant = await svcRest("POST", "product_variants", {
      product_id: productId,
      color_id: color.body[0].id,
    });
    await svcRest("POST", "product_prices", { product_id: productId, currency: "BOB", amount: 50 });
    await svcRpc("apply_stock_change", {
      p_variant_id: variant.body[0].id,
      p_delta: 5,
      p_reason: "import",
      p_note: "S13",
    });
    await svcRest("PATCH", `products?id=eq.${productId}`, { status: "active" });
    const order = await rpc(
      "admin_create_manual_order",
      {
        p_profile_id: customer!.id,
        p_items: [{ variant_id: variant.body[0].id, qty: 1 }],
        p_channel: "whatsapp",
        p_payment_method: "whatsapp",
        p_shipping_method: "delivery",
        p_address: {
          recipient: "Rosa",
          phone_e164: "+59172223333",
          line1: "Av. Arce 100",
          city: "La Paz",
          lat: -16.52,
          lng: -68.15,
        },
        p_idempotency_key: `s13-${uniq()}`,
        p_shipping_cost: 15,
        p_slot_id: null,
        p_delivery_date: null,
        p_discount: 0,
        p_discount_reason: null,
        p_contact_name: null,
        p_contact_email: null,
        p_contact_phone: "+59171234567",
        p_note: null,
        p_mark_paid: false,
        p_dry_run: false,
      },
      admin,
    );
    expect(order.status, JSON.stringify(order.body)).toBe(200);
    const orderId = order.body.order_id as string;
    const step = async (to: string) =>
      (
        await rpc(
          "admin_transition_order",
          { p_order_id: orderId, p_to: to, p_reason: null, p_expected_from: null },
          admin,
        )
      ).body;
    const notices = async (type: string) =>
      (
        await svcRest(
          "GET",
          `notification_outbox?order_id=eq.${orderId}&type=eq.${type}&select=*&order=id.asc`,
        )
      ).body as Record<string, any>[];

    expect((await step("paid")).ok).toBe(true);
    const confirmed = await notices("order_confirmed");
    expect(confirmed).toHaveLength(1);
    expect([confirmed[0]!.recipient, confirmed[0]!.channel, confirmed[0]!.status]).toEqual([
      customer!.email,
      "email",
      "pending",
    ]);
    expect(secondsAhead(confirmed[0]!.next_retry_at), "«confirmado» sale sin esperar").toBeLessThan(
      5,
    );
    const sent = await worker({ ids: [confirmed[0]!.id] });
    expect(sent.body.sent).toBe(1);
    expect((await rowOf(confirmed[0]!.id)).rendered_body).toMatch(/Clienta/);

    expect((await step("preparing")).ok).toBe(true);
    const packed = (await notices("order_packed"))[0]!;
    expect(
      secondsAhead(packed.next_retry_at),
      "«empacado» espera los 5 min del «deshacer»",
    ).toBeGreaterThan(240);
    expect((await worker({ ids: [packed.id] })).body.claimed, "no toca todavía").toBe(0);

    const undone = await rpc(
      "admin_undo_transition",
      { p_order_id: orderId, p_expected_status: null },
      admin,
    );
    expect(undone.body.outcome).toBe("undone");
    const cancelled = await rowOf(packed.id);
    expect([cancelled.status, cancelled.last_error]).toEqual(["cancelled", "reverted"]);

    // Al rehacer el paso, la clienta SÍ recibe su aviso (la clave quedó libre).
    expect((await step("preparing")).ok).toBe(true);
    const again = await notices("order_packed");
    expect(again).toHaveLength(2);
    expect(again[1]!.status).toBe("pending");

    // Pasos rápidos: «empacado» queda superado por «enviado» y no se envía.
    expect((await step("shipped")).ok).toBe(true);
    await makeDue(again[1]!.id);
    const shipped = (await notices("order_shipped"))[0]!;
    await makeDue(shipped.id);
    const run = await worker({ ids: [again[1]!.id, shipped.id] });
    expect(run.body).toMatchObject({ claimed: 1, sent: 1 });
    const superseded = await rowOf(again[1]!.id);
    expect([superseded.status, superseded.last_error]).toEqual(["cancelled", "superseded"]);
    expect((await rowOf(shipped.id)).status).toBe("sent");
  }, 120_000);
});

describe("preferencias, plantillas y vista previa (permisos reales)", () => {
  it("la clienta crea y cambia SUS preferencias; el consentimiento lo fecha la base; nadie más las ve ni las toca", async (ctx) => {
    guard(ctx);
    const other = await registerAndLogin({ name: "Otra Clienta S13" });
    const mine = await rest("POST", "notification_preferences", customer!.token, {
      profile_id: customer!.id,
      preferred_channel: "email",
      marketing_email: true,
    });
    expect(mine.status, JSON.stringify(mine.body)).toBe(201);
    expect(mine.body[0]).toMatchObject({
      preferred_channel: "email",
      marketing_email: true,
      marketing_whatsapp: false,
    });
    expect(mine.body[0].marketing_consent_at).toBeTruthy();

    const off = await rest(
      "PATCH",
      `notification_preferences?profile_id=eq.${customer!.id}`,
      customer!.token,
      { marketing_email: false },
    );
    expect(
      off.body[0].marketing_consent_at,
      "al retirar todo el marketing, el consentimiento se borra",
    ).toBeNull();

    expect(
      (await rest("POST", "notification_preferences", customer!.token, { profile_id: other.id }))
        .status,
      "no crea la de otra",
    ).toBe(403);
    expect(
      (await rest("GET", `notification_preferences?profile_id=eq.${customer!.id}`, other.token))
        .body,
    ).toEqual([]);
    const meddle = await rest(
      "PATCH",
      `notification_preferences?profile_id=eq.${customer!.id}`,
      other.token,
      { preferred_channel: "whatsapp" },
    );
    expect(meddle.body).toEqual([]);
    expect(
      (
        await rest(
          "PATCH",
          `notification_preferences?profile_id=eq.${customer!.id}`,
          customer!.token,
          { profile_id: other.id },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await rest(
          "PATCH",
          `notification_preferences?profile_id=eq.${customer!.id}`,
          customer!.token,
          { marketing_consent_at: "2020-01-01T00:00:00Z" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await rest(
          "PATCH",
          `notification_preferences?profile_id=eq.${customer!.id}`,
          customer!.token,
          { preferred_channel: "sms" },
        )
      ).status,
    ).toBe(400);
    expect((await rest("GET", "notification_preferences")).status, "anon").toBeGreaterThanOrEqual(
      401,
    );
    const adminView = await rest(
      "GET",
      `notification_preferences?profile_id=eq.${customer!.id}`,
      admin,
    );
    expect(adminView.body).toHaveLength(1);
    // La auditoría guarda quién y qué.
    const audit = await svcRest(
      "GET",
      `audit_log?table_name=eq.notification_preferences&record_id=eq.${customer!.id}&select=action,actor_id,diff&order=id.asc`,
    );
    expect((audit.body as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it("la clienta no ve la cola, las plantillas ni los ajustes de notificación; ni escribe en ellas", async (ctx) => {
    guard(ctx);
    for (const path of [
      "notification_outbox?select=id&limit=1",
      "notification_templates?select=id&limit=1",
      "store_settings?select=key&key=like.notify*",
    ])
      expect((await rest("GET", path, customer!.token)).body, path).toEqual([]);
    expect(
      (
        await rest("PATCH", "notification_templates?key=eq.order_created", customer!.token, {
          body: "hackeado",
        })
      ).body,
    ).toEqual([]);
    expect(
      (
        await rest("POST", "notification_outbox", customer!.token, {
          type: "x",
          channel: "email",
          dedupe_key: uniq(),
        })
      ).status,
    ).toBe(403);
    expect(
      (await rpc("claim_notifications", { p_limit: 5, p_worker: "x" }, customer!.token)).status,
    ).toBe(403);
    expect(
      (await rpc("claim_notifications", { p_limit: 5, p_worker: "x" }, admin)).status,
      "ni el administrador toma envíos",
    ).toBe(403);
    expect((await rpc("admin_notification_health", {}, customer!.token)).status).toBe(403);
  });

  it("el administrador edita una plantilla (queda «revisada» y auditada) y la base rechaza una con la sintaxis rota", async (ctx) => {
    guard(ctx);
    const before = (
      await rest(
        "GET",
        "notification_templates?key=eq.order_delivered&channel=eq.whatsapp&select=*",
        admin,
      )
    ).body[0];
    try {
      const bad = await rest("PATCH", `notification_templates?id=eq.${before.id}`, admin, {
        body: "Hola {{",
      });
      expect(bad.status).toBe(400);
      const ok = await rest("PATCH", `notification_templates?id=eq.${before.id}`, admin, {
        body: "Hola {{customer_name}}, entregamos {{order_number}}.",
      });
      expect(ok.status).toBe(200);
      expect(ok.body[0]).toMatchObject({
        is_default: false,
        body: "Hola {{customer_name}}, entregamos {{order_number}}.",
      });
      expect(ok.body[0].updated_by).toBeTruthy();
    } finally {
      await rest("PATCH", `notification_templates?id=eq.${before.id}`, admin, {
        body: before.body,
      });
    }
  });

  it("notify-admin: vista previa con la MISMA función que envía; rechaza lo que no es de un administrador", async (ctx) => {
    guard(ctx);
    const input = {
      action: "preview",
      channel: "email",
      audience: "customer",
      subject: "Tu pedido {{order_number}}",
      body: "Hola {{customer_name}}, total {{order_total}}.",
      cta_label: "Ver",
    };
    expect((await fn("notify-admin", input)).status, "sin sesión").toBe(401);
    expect((await fn("notify-admin", input, { token: customer!.token })).status, "clienta").toBe(
      403,
    );
    const res = await fn("notify-admin", input, { token: admin });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.preview).toMatchObject({
      ok: true,
      errors: [],
      subject: "Tu pedido MIC-000123",
    });
    expect(res.body.preview.text).toContain("Hola Ana, total Bs 250,00.");
    expect(res.body.preview.html).toContain("<!doctype html>");
    expect(res.body.variables.map((v: { name: string }) => v.name)).toEqual(
      expect.arrayContaining(["customer_name", "order_number"]),
    );
    expect(
      res.body.variables.map((v: { name: string }) => v.name),
      "una variable de las alertas no se ofrece a la clienta",
    ).not.toContain("admin_url");

    const typo = await fn(
      "notify-admin",
      { ...input, body: "Hola {{customer_nmae}}" },
      { token: admin },
    );
    expect(typo.body.preview).toMatchObject({
      ok: false,
      errors: ["unknown_variable"],
      unknown: ["customer_nmae"],
    });
    const evil = await fn(
      "notify-admin",
      { ...input, body: "<script>alert(1)</script> {{customer_name}}" },
      { token: admin },
    );
    expect(evil.body.preview.html).not.toContain("<script>alert");
    expect((await fn("notify-admin", { ...input, channel: "sms" }, { token: admin })).status).toBe(
      400,
    );
    expect((await fn("notify-admin", { ...input, action: "otra" }, { token: admin })).status).toBe(
      400,
    );
    expect(
      (await fn("notify-admin", { ...input, body: "x".repeat(13000) }, { token: admin })).status,
    ).toBe(413);
  });

  it("notify-admin: el envío de prueba solo va a tu propio correo (o a un destinatario de alertas) y respeta el proveedor", async (ctx) => {
    guard(ctx);
    const input = {
      action: "send_test",
      channel: "email",
      audience: "customer",
      subject: "Tu pedido {{order_number}}",
      body: "Hola {{customer_name}}.",
      cta_label: "Ver",
    };
    const own = await fn("notify-admin", input, { token: admin });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body).toMatchObject({ ok: true, sent: true, provider: "fake" });
    const stranger = await fn(
      "notify-admin",
      { ...input, to: "alguien@prueba.test" },
      { token: admin },
    );
    expect([stranger.status, stranger.body.error.code]).toEqual([400, "recipient_not_allowed"]);
    expect(
      (await fn("notify-admin", { ...input, body: "Hola {{" }, { token: admin })).body.error.code,
    ).toBe("invalid_template");
    expect(
      (await fn("notify-admin", { ...input, channel: "whatsapp" }, { token: admin })).body.error
        .code,
    ).toBe("channel_not_supported");
    await setSetting("notify_email_provider", "none");
    try {
      const none = await fn("notify-admin", input, { token: admin });
      expect([none.status, none.body.error.code]).toEqual([409, "provider_not_configured"]);
    } finally {
      await setSetting("notify_email_provider", "fake");
    }
    expect(adminEmail.endsWith("@prueba.test")).toBe(true);
  });

  it("la salud del envío dice la verdad: proveedor, remitente y worker sin configurar", async (ctx) => {
    guard(ctx);
    const health = (await rpc("admin_notification_health", {}, admin)).body;
    expect(health).toMatchObject({
      enabled: true,
      email_provider: "fake",
      whatsapp_mode: "manual",
    });
    expect(typeof health.worker_configured).toBe("boolean");
    expect(typeof health.due).toBe("number");
    const counts = (await rpc("admin_notification_counts", {}, admin)).body;
    expect(
      Object.keys(counts).every((status) =>
        ["pending", "sending", "sent", "failed", "dead", "cancelled", "manual"].includes(status),
      ),
    ).toBe(true);
  });
});
