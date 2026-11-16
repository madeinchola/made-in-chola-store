import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import { createFakeProvider, type EmailProvider, NotifyError } from "./providers.ts";
import type {
  Channel,
  CompleteInfo,
  Outcome,
  OutboxRow,
  RowContext,
  TemplateRow,
} from "./types.ts";
import {
  effectiveEmailProvider,
  fallbackTemplate,
  runWorker,
  type WorkerDeps,
  type WorkerSettings,
} from "./worker.ts";

const SETTINGS: WorkerSettings = {
  enabled: true,
  emailProvider: "fake",
  fromName: "Made In Chola",
  fromEmail: "pedidos@chola.test",
  replyTo: "",
  whatsappMode: "manual",
};

const tpl = (over: Partial<TemplateRow> = {}): TemplateRow => ({
  key: "order_shipped",
  channel: "email",
  locale: "es",
  audience: "customer",
  subject: "Tu pedido {{order_number}} va en camino",
  body: "Hola {{customer_name}},\n\ntu pedido {{order_number}} ({{order_total}}) ya salió.",
  cta_label: "Ver mi pedido",
  active: true,
  ...over,
});

const row = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 1,
  type: "order_shipped",
  channel: "email",
  recipient: "ana@prueba.test",
  payload: {
    order_id: "11111111-1111-1111-1111-111111111111",
    number: "MIC-000123",
    status: "shipped",
    total: 250,
    currency: "BOB",
  },
  attempts: 1,
  template: "order_shipped",
  order_id: "11111111-1111-1111-1111-111111111111",
  profile_id: "22222222-2222-2222-2222-222222222222",
  dedupe_key: "order_shipped:1:c",
  ...over,
});

interface Harness {
  deps: WorkerDeps;
  completed: { id: number; outcome: Outcome; info: CompleteInfo }[];
  claimArgs: { limit: number; worker: string; ids: number[] | null; channels: Channel[] }[];
  alerts: { key: string; channel: Channel; reason: string }[];
  sleeps: number[];
  fake: ReturnType<typeof createFakeProvider>;
  clock: { t: number };
}

function harness(
  rows: OutboxRow[],
  over: {
    settings?: Partial<WorkerSettings>;
    templates?: Record<string, TemplateRow | null>;
    context?: () => Promise<RowContext>;
    alertRecipients?: string[];
    provider?: EmailProvider | null;
    completeResult?: (outcome: Outcome) => string;
    alertThrows?: boolean;
  } = {},
): Harness {
  const fake = createFakeProvider();
  const completed: Harness["completed"] = [];
  const claimArgs: Harness["claimArgs"] = [];
  const alerts: Harness["alerts"] = [];
  const sleeps: number[] = [];
  const clock = { t: 0 };
  const templates = over.templates ?? { "order_shipped|email": tpl() };
  const settings = { ...SETTINGS, ...over.settings };
  const deps: WorkerDeps = {
    site: { siteUrl: "https://tienda.test", storeName: "Made In Chola" },
    settings: () => Promise.resolve(settings),
    claim(args) {
      claimArgs.push(args);
      return Promise.resolve(rows.filter((r) => args.channels.includes(r.channel)));
    },
    complete(id, _worker, outcome, info) {
      completed.push({ id, outcome, info });
      return Promise.resolve(over.completeResult ? over.completeResult(outcome) : outcome);
    },
    template: (key, channel) => Promise.resolve(templates[`${key}|${channel}`] ?? null),
    context:
      over.context ??
      (() =>
        Promise.resolve({
          customerName: "Ana María",
          currency: { symbol: "Bs", decimals: 2 },
          paymentExpiresAt: null,
        })),
    alertRecipients: () =>
      Promise.resolve(over.alertRecipients ?? ["admin1@chola.test", "admin2@chola.test"]),
    raiseTemplateAlert(key, channel, reason) {
      if (over.alertThrows) return Promise.reject(new Error("cola caída"));
      alerts.push({ key, channel, reason });
      return Promise.resolve();
    },
    emailProvider: (kind) =>
      over.provider !== undefined ? over.provider : kind === "fake" ? fake : null,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    now: () => clock.t,
    log: { info() {}, warn() {}, error() {} },
  };
  return { deps, completed, claimArgs, alerts, sleeps, fake, clock };
}

const run = (h: Harness, options: Partial<Parameters<typeof runWorker>[1]> = {}) =>
  runWorker(h.deps, { limit: 10, worker: "w1", ...options });

// ── Interruptores y proveedor ──────────────────────────────────────────────────────────────
Deno.test("apagado: no toma nada de la cola", async () => {
  const h = harness([row()], { settings: { enabled: false } });
  const report = await run(h);
  assertEquals(report.note, "disabled");
  assertEquals(h.claimArgs.length, 0);
  assertEquals(h.completed.length, 0);
});

Deno.test(
  "proveedor «none»: solo toma WhatsApp; los correos esperan en la cola sin gastar intentos",
  async () => {
    const h = harness([row(), row({ id: 2, channel: "whatsapp", recipient: "+59170000001" })], {
      settings: { emailProvider: "none" },
      templates: {
        "order_shipped|whatsapp": tpl({
          channel: "whatsapp",
          subject: "",
          cta_label: null,
          body: "Hola {{customer_name}}",
        }),
      },
    });
    const report = await run(h);
    assertEquals(h.claimArgs[0]!.channels, ["whatsapp"]);
    assertEquals(report.note, "email_not_configured");
    assertEquals(
      h.completed.map((c) => c.id),
      [2],
    );
    assertEquals(report.manual, 1);
  },
);

Deno.test(
  "Resend sin remitente configurado se trata como «none» (no se envía con un remitente vacío)",
  () => {
    const deps = {
      emailProvider: () =>
        ({ name: "resend", send: () => Promise.reject(new Error("no debería")) }) as EmailProvider,
    };
    assertEquals(
      effectiveEmailProvider({ ...SETTINGS, emailProvider: "resend", fromEmail: "" }, deps),
      null,
    );
    assertEquals(
      effectiveEmailProvider(
        { ...SETTINGS, emailProvider: "resend", fromEmail: "pedidos@chola.test" },
        deps,
      )?.name,
      "resend",
    );
    assertEquals(effectiveEmailProvider({ ...SETTINGS, emailProvider: "none" }, deps), null);
  },
);

Deno.test("Resend sin su clave (el adaptador no existe): los correos esperan", async () => {
  const h = harness([row()], { settings: { emailProvider: "resend" }, provider: null });
  const report = await run(h);
  assertEquals(h.claimArgs[0]!.channels, ["whatsapp"]);
  assertEquals(report.claimed, 0);
});

// ── Envío de correo ────────────────────────────────────────────────────────────────────────
Deno.test(
  "correo a la clienta: se arma con la plantilla, sale con la clave del aviso y se cierra como enviado",
  async () => {
    const h = harness([row()]);
    const report = await run(h);
    assertEquals(report, {
      claimed: 1,
      sent: 1,
      manual: 0,
      retried: 0,
      failed: 0,
      cancelled: 0,
      dead: 0,
      deferred: 0,
      lost: 0,
    });
    const sent = h.fake.sent[0]!;
    assertEquals(sent.message.to, ["ana@prueba.test"]);
    assertEquals(sent.message.from, "Made In Chola <pedidos@chola.test>");
    assertEquals(sent.message.subject, "Tu pedido MIC-000123 va en camino");
    assertEquals(sent.message.idempotencyKey, "notif-1");
    assertStringIncludes(sent.message.text, "Hola Ana,");
    assertStringIncludes(sent.message.text, "(Bs 250,00)");
    assertStringIncludes(
      sent.message.text,
      "Ver mi pedido: https://tienda.test/cuenta/pedidos/11111111-1111-1111-1111-111111111111",
    );
    assertStringIncludes(sent.message.html, "<!doctype html>");
    assertStringIncludes(
      sent.message.html,
      "Recibes este mensaje porque tienes un pedido en Made In Chola",
    );
    assertEquals(h.completed[0]!.outcome, "sent");
    assertEquals(h.completed[0]!.info.provider, "fake");
    assertEquals(h.completed[0]!.info.messageId, "fake_notif-1");
    assertEquals(h.completed[0]!.info.subject, "Tu pedido MIC-000123 va en camino");
  },
);

Deno.test("el registro guarda el TEXTO enviado, no el HTML", async () => {
  const h = harness([row()]);
  await run(h);
  const body = h.completed[0]!.info.body!;
  assertFalse(body.includes("<"), "texto plano");
  assertStringIncludes(body, "tu pedido MIC-000123");
});

Deno.test(
  "XSS de punta a punta: un nombre malicioso sale escapado en el HTML y no rompe nada",
  async () => {
    const h = harness([row()], {
      context: () =>
        Promise.resolve({
          customerName: `<img src=x onerror=alert(1)> Ana`,
          currency: null,
          paymentExpiresAt: null,
        }),
    });
    await run(h);
    const sent = h.fake.sent[0]!.message;
    assertFalse(sent.html.includes("<img"));
    assertStringIncludes(sent.html, "Hola &lt;img");
  },
);

Deno.test("alerta interna: va a los administradores, todos en UNA llamada", async () => {
  const h = harness(
    [row({ id: 7, type: "order_new", template: "order_new", recipient: null, profile_id: null })],
    {
      templates: {
        "order_new|email": tpl({
          key: "order_new",
          audience: "admin",
          subject: "Nuevo pedido {{order_number}}",
          body: "Entró {{order_number}} por {{order_total}}.",
          cta_label: "Abrir en el panel",
        }),
      },
    },
  );
  await run(h);
  assertEquals(h.fake.sent[0]!.message.to, ["admin1@chola.test", "admin2@chola.test"]);
  assertStringIncludes(h.fake.sent[0]!.message.html, "Alerta interna de Made In Chola");
  assertStringIncludes(
    h.fake.sent[0]!.message.text,
    "Abrir en el panel: https://tienda.test/admin/pedidos/11111111-1111-1111-1111-111111111111",
  );
});

Deno.test(
  "alerta interna sin ningún destinatario: fallo permanente «no_recipients» (no se reintenta en vano)",
  async () => {
    const h = harness([row({ recipient: null, profile_id: null })], { alertRecipients: [] });
    const report = await run(h);
    assertEquals(
      [report.failed, h.completed[0]!.outcome, h.completed[0]!.info.error],
      [1, "failed", "no_recipients"],
    );
  },
);

Deno.test(
  "un destinatario que no es una dirección: fallo permanente «invalid_recipient»",
  async () => {
    for (const recipient of ["no-es-correo", "a b@c.test", "a@b.test,c@d.test", "<x@y.test>"]) {
      const h = harness([row({ recipient })]);
      await run(h);
      assertEquals(
        [h.completed[0]!.outcome, h.completed[0]!.info.error],
        ["failed", "invalid_recipient"],
        recipient,
      );
    }
  },
);

// ── Dominios reservados: jamás por un proveedor real ───────────────────────────────────────
function realProvider() {
  const calls: string[][] = [];
  const provider: EmailProvider = {
    name: "resend",
    send: (m) => (calls.push(m.to), Promise.resolve({ id: "re_1" })),
  };
  return { provider, calls };
}

Deno.test(
  "proveedor real + dirección reservada: NO se envía; queda como «sink» (nada saldrá al mundo)",
  async () => {
    const { provider, calls } = realProvider();
    const h = harness([row({ recipient: "user.abc@prueba.test" })], {
      settings: { emailProvider: "resend" },
      provider,
    });
    const report = await run(h);
    assertEquals(calls.length, 0);
    assertEquals(
      [
        report.sent,
        h.completed[0]!.outcome,
        h.completed[0]!.info.provider,
        h.completed[0]!.info.messageId,
      ],
      [1, "sent", "sink", null],
    );
  },
);

Deno.test(
  "proveedor real + alerta con una dirección real y una de prueba: solo sale a la real",
  async () => {
    const { provider, calls } = realProvider();
    const h = harness([row({ recipient: null, profile_id: null })], {
      settings: { emailProvider: "resend" },
      provider,
      alertRecipients: ["real@gmail.com", "admin@chola.test"],
    });
    await run(h);
    assertEquals(calls, [["real@gmail.com"]]);
    assertEquals(h.completed[0]!.info.provider, "resend");
  },
);

Deno.test(
  "proveedor real: una dirección real sale con el nombre y la clave del proveedor",
  async () => {
    const { provider, calls } = realProvider();
    const h = harness([row({ recipient: "ana@gmail.com" })], {
      settings: { emailProvider: "resend" },
      provider,
    });
    await run(h);
    assertEquals(calls, [["ana@gmail.com"]]);
    assertEquals(
      [h.completed[0]!.info.provider, h.completed[0]!.info.messageId],
      ["resend", "re_1"],
    );
  },
);

Deno.test(
  "proveedor de pruebas + dirección real: falla visible, jamás un «enviado» falso",
  async () => {
    const h = harness([row({ recipient: "ana@gmail.com" })]);
    await run(h);
    assertEquals(
      [h.completed[0]!.outcome, h.completed[0]!.info.error],
      ["failed", "fake_provider_real_address"],
    );
  },
);

// ── Plantillas ─────────────────────────────────────────────────────────────────────────────
Deno.test("plantilla apagada a propósito: no se envía y NO es una alerta", async () => {
  const h = harness([row()], { templates: { "order_shipped|email": tpl({ active: false }) } });
  const report = await run(h);
  assertEquals(
    [report.cancelled, h.completed[0]!.outcome, h.completed[0]!.info.error],
    [1, "cancelled", "template_inactive"],
  );
  assertEquals(h.alerts.length, 0);
  assertEquals(h.fake.sent.length, 0);
});

Deno.test("plantilla inexistente: sale el texto de respaldo y se alerta UNA vez", async () => {
  const h = harness([row()], { templates: {} });
  await run(h);
  assertEquals(h.fake.sent[0]!.message.subject, "Novedades de tu pedido MIC-000123");
  assertEquals(h.alerts, [{ key: "order_shipped", channel: "email", reason: "missing" }]);
});

Deno.test(
  "plantilla con la sintaxis rota: sale el respaldo y se alerta con el motivo «syntax»",
  async () => {
    for (const broken of [
      { body: "Hola {{" },
      { subject: "Pedido {{Num}}" },
      { cta_label: "Ver }}" },
    ]) {
      const h = harness([row()], { templates: { "order_shipped|email": tpl(broken) } });
      await run(h);
      assertEquals(
        h.fake.sent[0]!.message.subject,
        "Novedades de tu pedido MIC-000123",
        JSON.stringify(broken),
      );
      assertEquals(
        h.alerts.map((a) => a.reason),
        ["syntax"],
      );
    }
  },
);

Deno.test("si la alerta de plantilla no se puede encolar, el aviso sale igual", async () => {
  const h = harness([row()], { templates: {}, alertThrows: true });
  const report = await run(h);
  assertEquals(report.sent, 1);
});

Deno.test(
  "el respaldo de una alerta interna y el de WhatsApp existen y no usan variables inexistentes",
  () => {
    assertStringIncludes(fallbackTemplate("admin", "email").subject, "{{store_name}}");
    assertEquals(fallbackTemplate("customer", "whatsapp").subject, "");
    assertEquals(fallbackTemplate("customer", "email").cta_label, "Ver mi pedido");
  },
);

// ── WhatsApp ───────────────────────────────────────────────────────────────────────────────
const waTemplate = tpl({
  channel: "whatsapp",
  subject: "",
  cta_label: null,
  body: "Hola {{customer_name}}, tu pedido {{order_number}} salió. {{order_url}}",
});

Deno.test(
  "WhatsApp en modo manual: se escribe el mensaje y queda «manual» para que una persona lo envíe",
  async () => {
    const h = harness([row({ id: 3, channel: "whatsapp", recipient: "+59170000001" })], {
      templates: { "order_shipped|whatsapp": waTemplate },
    });
    const report = await run(h);
    assertEquals([report.manual, h.completed[0]!.outcome], [1, "manual"]);
    assertEquals(
      h.completed[0]!.info.body,
      "Hola Ana, tu pedido MIC-000123 salió. https://tienda.test/cuenta/pedidos/11111111-1111-1111-1111-111111111111",
    );
    assertEquals(h.fake.sent.length, 0, "WhatsApp no pasa por el proveedor de correo");
  },
);

Deno.test("WhatsApp con la API oficial aún no disponible: se comporta como manual", async () => {
  const h = harness([row({ id: 3, channel: "whatsapp", recipient: "+59170000001" })], {
    settings: { whatsappMode: "official" },
    templates: { "order_shipped|whatsapp": waTemplate },
  });
  await run(h);
  assertEquals(h.completed[0]!.outcome, "manual");
});

Deno.test(
  "WhatsApp: una plantilla que queda vacía es un fallo de contenido, no un mensaje en blanco",
  async () => {
    const h = harness([row({ id: 3, channel: "whatsapp", recipient: "+59170000001" })], {
      templates: {
        "order_shipped|whatsapp":
          waTemplate &&
          tpl({ channel: "whatsapp", subject: "", cta_label: null, body: "{{nada}}" }),
      },
    });
    await run(h);
    assertEquals(
      [h.completed[0]!.outcome, h.completed[0]!.info.error],
      ["failed", "empty_message"],
    );
  },
);

Deno.test("WhatsApp: el mensaje largo se recorta a 1000 caracteres en el registro", async () => {
  const h = harness([row({ id: 3, channel: "whatsapp", recipient: "+59170000001" })], {
    templates: {
      "order_shipped|whatsapp": tpl({
        channel: "whatsapp",
        subject: "",
        cta_label: null,
        body: "x".repeat(2500),
      }),
    },
  });
  await run(h);
  assertEquals(Array.from(h.completed[0]!.info.body!).length, 1000);
});

// ── Errores del proveedor ──────────────────────────────────────────────────────────────────
function failing(error: unknown): EmailProvider {
  return { name: "resend", send: () => Promise.reject(error) };
}

Deno.test("error transitorio: vuelve a la cola con su espera; el pedido ni se entera", async () => {
  const h = harness([row({ recipient: "ana@gmail.com" })], {
    settings: { emailProvider: "resend" },
    provider: failing(new NotifyError("transient", "rate_limited", 45)),
  });
  const report = await run(h);
  assertEquals(
    [
      report.retried,
      h.completed[0]!.outcome,
      h.completed[0]!.info.error,
      h.completed[0]!.info.retryAfterSeconds,
    ],
    [1, "retry", "rate_limited", 45],
  );
});

Deno.test(
  "error transitorio sin espera propia: la espera la decide la base (retroceso exponencial)",
  async () => {
    const h = harness([row({ recipient: "ana@gmail.com" })], {
      settings: { emailProvider: "resend" },
      provider: failing(new NotifyError("transient", "provider_503")),
    });
    await run(h);
    assertEquals(h.completed[0]!.info.retryAfterSeconds, null);
  },
);

Deno.test("error permanente: no se reintenta", async () => {
  const h = harness([row({ recipient: "ana@gmail.com" })], {
    settings: { emailProvider: "resend" },
    provider: failing(new NotifyError("permanent", "invalid_request")),
  });
  const report = await run(h);
  assertEquals(
    [report.failed, h.completed[0]!.outcome, h.completed[0]!.info.error],
    [1, "failed", "invalid_request"],
  );
});

Deno.test(
  "un error inesperado (un bug) se reintenta como «unexpected» y NO tumba el lote",
  async () => {
    const h = harness(
      [row({ id: 1, recipient: "ana@gmail.com" }), row({ id: 2, recipient: "ana@gmail.com" })],
      { settings: { emailProvider: "resend" }, provider: failing(new TypeError("boom")) },
    );
    const report = await run(h);
    assertEquals([report.claimed, report.retried], [2, 2]);
    assertEquals(
      h.completed.map((c) => c.info.error),
      ["unexpected", "unexpected"],
    );
  },
);

Deno.test(
  "si no se pueden consultar los datos del mensaje: reintento «context_error»",
  async () => {
    const h = harness([row()], { context: () => Promise.reject(new Error("base caída")) });
    await run(h);
    assertEquals([h.completed[0]!.outcome, h.completed[0]!.info.error], ["retry", "context_error"]);
  },
);

Deno.test("un fallo no contamina al siguiente aviso del lote", async () => {
  const h = harness([
    row({ id: 1, recipient: "permanent@prueba.test" }),
    row({ id: 2, recipient: "ok@prueba.test" }),
  ]);
  const report = await run(h);
  assertEquals(
    h.completed.map((c) => [c.id, c.outcome]),
    [
      [1, "failed"],
      [2, "sent"],
    ],
  );
  assertEquals([report.failed, report.sent], [1, 1]);
});

// ── Cierre, tiempo y ritmo ─────────────────────────────────────────────────────────────────
Deno.test(
  "el resultado final sale de lo que responde la base (un «dead» se cuenta como dead)",
  async () => {
    const h = harness([row({ recipient: "transient@prueba.test" })], {
      completeResult: () => "dead",
    });
    const report = await run(h);
    assertEquals([report.dead, report.retried], [1, 0]);
  },
);

Deno.test(
  "si otro worker ya rescató el aviso, el resultado se cuenta como «lost» y no se pisa nada",
  async () => {
    const h = harness([row()], { completeResult: () => "lost" });
    const report = await run(h);
    assertEquals([report.lost, report.sent], [1, 0]);
  },
);

Deno.test(
  "sin tiempo: lo que queda se difiere un minuto (no se empieza un envío que no cabe)",
  async () => {
    const h = harness([row({ id: 1 }), row({ id: 2 }), row({ id: 3 })]);
    let calls = 0;
    h.deps.now = () => (calls++ === 0 ? 0 : 1_000_000);
    const report = await run(h, { deadlineMs: 1000 });
    assertEquals([report.deferred, report.retried, report.sent], [3, 0, 0]);
    assertEquals(
      h.completed.map((c) => [c.outcome, c.info.error, c.info.retryAfterSeconds]),
      [
        ["retry", "deferred", 30],
        ["retry", "deferred", 30],
        ["retry", "deferred", 30],
      ],
    );
    assertEquals(h.fake.sent.length, 0);
  },
);

Deno.test(
  "ritmo: pausa entre envíos reales de correo (no tras un «sink», un WhatsApp ni un fallo)",
  async () => {
    const { provider } = realProvider();
    const h = harness(
      [
        row({ id: 1, recipient: "a@gmail.com" }),
        row({ id: 2, recipient: "b@prueba.test" }),
        row({ id: 3, recipient: "c@gmail.com" }),
      ],
      { settings: { emailProvider: "resend" }, provider },
    );
    await run(h, { spacingMs: 550 });
    assertEquals(h.sleeps, [550, 550], "solo tras los dos envíos reales");
  },
);

Deno.test(
  "reenvío tras perder la confirmación: el proveedor no duplica (misma clave de idempotencia)",
  async () => {
    const h = harness([row()]);
    await run(h);
    await run(h); // el worker se cayó antes de cerrar y la base lo volvió a entregar
    assertEquals(h.fake.sent.length, 1);
    assertEquals(h.completed.length, 2);
  },
);

Deno.test("lote vacío: no hace nada y no falla", async () => {
  const h = harness([]);
  const report = await run(h);
  assertEquals(report.claimed, 0);
  assertEquals(h.completed.length, 0);
});

Deno.test("el worker pide a la base exactamente lo que le toca (límite, nombre, ids)", async () => {
  const h = harness([]);
  await run(h, { limit: 7, worker: "cron-1", ids: [4, 5] });
  assertEquals(h.claimArgs[0], {
    limit: 7,
    worker: "cron-1",
    ids: [4, 5],
    channels: ["email", "whatsapp"],
  });
  assert(h.claimArgs.length === 1);
});

Deno.test(
  "el worker manda al proveedor el número de intento del aviso (los reintentos de «transient-N» dependen de él)",
  async () => {
    const h = harness([
      row({ id: 5, recipient: "transient-1@prueba.test", attempts: 1 }),
      row({ id: 6, recipient: "transient-1@prueba.test", attempts: 2 }),
    ]);
    const report = await run(h);
    assertEquals([report.retried, report.sent], [1, 1]);
    assertEquals(
      h.completed.map((c) => [c.id, c.outcome]),
      [
        [5, "retry"],
        [6, "sent"],
      ],
    );
    assertEquals(h.fake.sent[0]!.message.attempt, 2);
  },
);
