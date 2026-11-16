import { describe, expect, it } from "vitest";
import {
  canCancel,
  canMarkSent,
  canResend,
  draftOf,
  errorLabel,
  formatDateTime,
  healthProblems,
  isDirty,
  needsAction,
  parseRecipients,
  recipientsProblem,
  searchTerm,
  statusLabel,
  statusTone,
  typeLabel,
  whatsappLink,
} from "./logic";
import type { NotificationHealth, NotificationStatus, TemplateRow } from "./types";
import { NOTIFICATION_STATUSES, NOTIFICATION_TYPES } from "./types";

const health = (over: Partial<NotificationHealth> = {}): NotificationHealth => ({
  enabled: true,
  emailProvider: "resend",
  fromEmailSet: true,
  whatsappMode: "manual",
  workerConfigured: true,
  due: 0,
  oldestDueMinutes: null,
  lastSentAt: null,
  recipients: 2,
  ...over,
});

const template: TemplateRow = {
  id: 1,
  key: "order_shipped",
  channel: "email",
  locale: "es",
  audience: "customer",
  subject: "Asunto",
  body: "Cuerpo",
  ctaLabel: "Ver",
  active: true,
  isDefault: true,
  updatedAt: "2026-11-16T10:00:00Z",
};

describe("estados y etiquetas", () => {
  it("cada estado tiene un tono y un texto (nunca la clave a la vista)", () => {
    for (const status of NOTIFICATION_STATUSES) {
      expect(statusLabel(status)).not.toMatch(/^admin\./);
      expect(["success", "info", "warning", "danger", "neutral"]).toContain(statusTone(status));
    }
  });

  it("los que piden acción se ven en alerta y los enviados en verde", () => {
    expect(statusTone("sent")).toBe("success");
    expect(statusTone("dead")).toBe("danger");
    expect(statusTone("failed")).toBe("danger");
    expect(statusTone("manual")).toBe("warning");
    expect(statusTone("cancelled")).toBe("neutral");
  });

  it("cada tipo de aviso conocido tiene su texto", () => {
    for (const type of NOTIFICATION_TYPES) expect(typeLabel(type)).not.toMatch(/^admin\./);
    expect(typeLabel("order_shipped")).toBe("Pedido enviado");
  });

  it("un tipo nuevo sin traducir se muestra con su clave (visible, no un hueco)", () => {
    expect(typeLabel("tipo_nuevo")).toBe("tipo_nuevo");
  });

  it("los códigos de error se dicen en palabras; uno desconocido pasa tal cual; vacío no dice nada", () => {
    expect(errorLabel("provider_config")).toMatch(/dominio/);
    expect(errorLabel("superseded")).toMatch(/siguió avanzando/);
    expect(errorLabel("codigo_raro")).toBe("codigo_raro");
    expect(errorLabel(null)).toBe("");
    expect(errorLabel("")).toBe("");
  });
});

describe("qué se puede hacer con un aviso (pista de interfaz)", () => {
  const table: Record<NotificationStatus, [boolean, boolean, boolean]> = {
    // [reenviar, descartar, marcar enviado]
    pending: [false, true, false],
    sending: [false, false, false],
    sent: [true, false, false],
    failed: [true, false, false],
    dead: [true, false, false],
    cancelled: [true, false, false],
    manual: [true, true, true],
  };
  for (const [status, [resend, cancel, mark]] of Object.entries(table) as [
    NotificationStatus,
    [boolean, boolean, boolean],
  ][]) {
    it(`${status}: reenviar=${resend} · descartar=${cancel} · marcar enviado=${mark}`, () => {
      expect(canResend(status)).toBe(resend);
      expect(canCancel(status)).toBe(cancel);
      expect(canMarkSent(status)).toBe(mark);
    });
  }

  it("piden atención: por enviar a mano, perdidos y fallados", () => {
    expect(needsAction({ status: "manual" })).toBe(true);
    expect(needsAction({ status: "dead" })).toBe(true);
    expect(needsAction({ status: "failed" })).toBe(true);
    expect(needsAction({ status: "sent" })).toBe(false);
    expect(needsAction({ status: "pending" })).toBe(false);
  });
});

describe("whatsappLink", () => {
  it("arma el enlace wa.me con el mensaje codificado", () => {
    expect(whatsappLink("+59170000001", "Hola Ana\nñ 🎉")).toBe(
      "https://wa.me/59170000001?text=Hola%20Ana%0A%C3%B1%20%F0%9F%8E%89",
    );
  });

  it("sin un teléfono E.164 válido o sin mensaje, no hay enlace", () => {
    for (const phone of [null, "", "59170000001", "+0123456789", "+5917", "+591 7000 0001"])
      expect(whatsappLink(phone, "x"), String(phone)).toBeNull();
    expect(whatsappLink("+59170000001", null)).toBeNull();
    expect(whatsappLink("+59170000001", "")).toBeNull();
  });
});

describe("searchTerm", () => {
  it("quita lo que rompería un filtro (coma, paréntesis, comodines, comillas) y recorta", () => {
    expect(searchTerm("  a,b(c)d%e*f:g\"h'i\\j  ")).toBe("a b c d e f g h i j");
    expect(searchTerm("")).toBe("");
    expect(searchTerm("x".repeat(100))).toHaveLength(60);
    expect(searchTerm("MIC-000123")).toBe("MIC-000123");
  });
});

describe("destinatarios de las alertas", () => {
  it("parseRecipients: ignora entradas vacías, igual que la base", () => {
    expect(parseRecipients("a@b.co, c@d.co,  ,")).toEqual(["a@b.co", "c@d.co"]);
    expect(parseRecipients("")).toEqual([]);
  });

  it("recipientsProblem: vacío o válido no tiene problema", () => {
    expect(recipientsProblem("")).toBeNull();
    expect(recipientsProblem("a@b.co, c@d.co")).toBeNull();
    expect(recipientsProblem("a@b.co,")).toBeNull();
  });

  it("recipientsProblem: una entrada inválida se señala por su nombre", () => {
    expect(recipientsProblem("a@b.co, mal")).toEqual({ problem: "invalid", entry: "mal" });
    expect(recipientsProblem("a@b")).toEqual({ problem: "invalid", entry: "a@b" });
    expect(recipientsProblem("a b@c.co")).toEqual({ problem: "invalid", entry: "a b@c.co" });
  });

  it("recipientsProblem: 10 correos caben y 11 no", () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => `u${i}@b.co`).join(",");
    expect(recipientsProblem(list(10))).toBeNull();
    expect(recipientsProblem(list(11))).toEqual({ problem: "too_many" });
  });
});

describe("fechas y borradores", () => {
  it("formatDateTime usa la hora de La Paz (UTC−4), incluso al cruzar el día", () => {
    expect(formatDateTime("2026-11-15T18:30:00Z")).toContain("14:30");
    const late = formatDateTime("2026-11-16T03:30:00Z");
    expect(late).toContain("23:30");
    expect(late.startsWith("15 ")).toBe(true);
    expect(formatDateTime(null)).toBe("");
    expect(formatDateTime("no es fecha")).toBe("");
  });

  it("isDirty: igual al guardado no es un cambio; cualquier campo distinto sí", () => {
    expect(isDirty(template, draftOf(template))).toBe(false);
    expect(isDirty(template, { ...draftOf(template), subject: "otro" })).toBe(true);
    expect(isDirty(template, { ...draftOf(template), body: "otro" })).toBe(true);
    expect(isDirty(template, { ...draftOf(template), ctaLabel: "otro" })).toBe(true);
    expect(isDirty(template, { ...draftOf(template), active: false })).toBe(true);
  });

  it("un botón sin etiqueta (null) y un borrador vacío son lo mismo", () => {
    const sinBoton = { ...template, ctaLabel: null };
    expect(draftOf(sinBoton).ctaLabel).toBe("");
    expect(isDirty(sinBoton, draftOf(sinBoton))).toBe(false);
  });
});

describe("healthProblems: por qué no están saliendo los avisos", () => {
  it("todo en orden: ningún problema", () => {
    expect(healthProblems(health())).toEqual([]);
  });

  it("apagado", () => {
    expect(healthProblems(health({ enabled: false }))).toEqual([expect.stringMatching(/apagadas/)]);
  });

  it("sin proveedor: los correos esperan (y no pide un remitente, sería ruido)", () => {
    const problems = healthProblems(health({ emailProvider: "none", fromEmailSet: false }));
    expect(problems).toEqual([expect.stringMatching(/proveedor de correo/)]);
  });

  it("Resend sin remitente", () => {
    expect(healthProblems(health({ fromEmailSet: false }))).toEqual([
      expect.stringMatching(/remitente/),
    ]);
  });

  it("sin el worker configurado", () => {
    expect(healthProblems(health({ workerConfigured: false }))).toEqual([
      expect.stringMatching(/Vault/),
    ]);
  });

  it("avisos vencidos desde hace 5 minutos o más; menos de eso es normal", () => {
    expect(healthProblems(health({ due: 3, oldestDueMinutes: 4 }))).toEqual([]);
    expect(healthProblems(health({ due: 3, oldestDueMinutes: 5 }))).toEqual([
      expect.stringMatching(/3 avisos vencidos.*5 minutos/),
    ]);
    expect(healthProblems(health({ due: 0, oldestDueMinutes: 90 }))).toEqual([]);
  });

  it("varios problemas a la vez salen todos", () => {
    const problems = healthProblems(
      health({ enabled: false, emailProvider: "none", workerConfigured: false }),
    );
    expect(problems).toHaveLength(3);
  });
});
