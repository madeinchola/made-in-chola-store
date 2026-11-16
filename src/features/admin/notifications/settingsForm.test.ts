import { describe, expect, it } from "vitest";
import { formOf, validateForm, type Form } from "./settingsForm";

const ok: Form = {
  notify_enabled: "true",
  notify_email_provider: "none",
  notify_from_name: "Made In Chola",
  notify_from_email: "",
  notify_reply_to: "",
  notify_whatsapp_mode: "manual",
  notify_max_attempts: "8",
  notify_backoff_seconds: "60",
  alert_recipients: "",
};
const problems = (over: Partial<Form>) => validateForm({ ...ok, ...over });
const keys = (over: Partial<Form>) => Object.keys(problems(over));

describe("validateForm: las mismas reglas que la base", () => {
  it("el formulario de arranque es válido", () => {
    expect(validateForm(ok)).toEqual({});
  });

  it("nombre del remitente: de 1 a 80 caracteres, sin < > comillas ni saltos de línea", () => {
    expect(keys({ notify_from_name: "" })).toEqual(["notify_from_name"]);
    expect(keys({ notify_from_name: "   " })).toEqual(["notify_from_name"]);
    expect(keys({ notify_from_name: "a" })).toEqual([]);
    expect(keys({ notify_from_name: "a".repeat(80) })).toEqual([]);
    expect(keys({ notify_from_name: "a".repeat(81) })).toEqual(["notify_from_name"]);
    for (const bad of ["Chola <x>", 'Chola "x"', "Chola\nBcc: x@y.co", "a>b"])
      expect(keys({ notify_from_name: bad }), bad).toEqual(["notify_from_name"]);
  });

  it("remitente y correo de respuesta: vacío, o un correo válido en minúsculas", () => {
    for (const key of ["notify_from_email", "notify_reply_to"] as const) {
      expect(keys({ [key]: "" })).toEqual([]);
      expect(keys({ [key]: "pedidos@chola.test" })).toEqual([]);
      for (const bad of [
        "sin-arroba",
        "a@b",
        "Pedidos@Chola.test",
        "a b@c.co",
        "a@b.co,c@d.co",
        "a@b.co\nBcc: x@y.co",
      ])
        expect(keys({ [key]: bad }), `${key}: ${bad}`).toEqual([key]);
      expect(keys({ [key]: `${"a".repeat(250)}@b.co` })).toEqual([key]);
    }
  });

  it("intentos: enteros de 1 a 20", () => {
    for (const value of ["1", "8", "20"])
      expect(keys({ notify_max_attempts: value }), value).toEqual([]);
    for (const value of ["0", "21", "", "1.5", "-1", "abc"])
      expect(keys({ notify_max_attempts: value }), value).toEqual(["notify_max_attempts"]);
    expect(keys({ notify_max_attempts: " 8 " }), "los espacios de los lados se ignoran").toEqual(
      [],
    );
  });

  it("espera inicial: enteros de 5 a 3600 segundos", () => {
    for (const value of ["5", "60", "3600"])
      expect(keys({ notify_backoff_seconds: value }), value).toEqual([]);
    for (const value of ["4", "3601", "", "60.5", "-5", "x"])
      expect(keys({ notify_backoff_seconds: value }), value).toEqual(["notify_backoff_seconds"]);
  });

  it("destinatarios de alertas: válidos, vacíos o con coma de más; una inválida o más de 10 se rechazan", () => {
    expect(keys({ alert_recipients: "" })).toEqual([]);
    expect(keys({ alert_recipients: "a@b.co, c@d.co," })).toEqual([]);
    expect(keys({ alert_recipients: "a@b.co, mal" })).toEqual(["alert_recipients"]);
    const eleven = Array.from({ length: 11 }, (_, i) => `u${i}@b.co`).join(",");
    expect(problems({ alert_recipients: eleven }).alert_recipients).toBe(
      "admin.notifications.settings.problem.recipients.too_many",
    );
    expect(problems({ alert_recipients: "mal" }).alert_recipients).toBe(
      "admin.notifications.settings.problem.recipients.invalid",
    );
  });

  it("varios errores a la vez salen todos", () => {
    expect(
      keys({ notify_from_name: "", notify_max_attempts: "0", alert_recipients: "mal" }).sort(),
    ).toEqual(["alert_recipients", "notify_from_name", "notify_max_attempts"]);
  });
});

describe("formOf: del valor guardado al formulario", () => {
  const row = (key: string, value: unknown) => ({
    key,
    value,
    valueType: "text" as const,
    isPublic: false,
    description: null,
    updatedAt: "2026-11-16T10:00:00Z",
  });

  it("convierte cada valor a texto y usa los valores de arranque si falta alguno", () => {
    const form = formOf([
      row("notify_enabled", false),
      row("notify_max_attempts", 12),
      row("notify_from_name", "Chola"),
    ]);
    expect(form.notify_enabled).toBe("false");
    expect(form.notify_max_attempts).toBe("12");
    expect(form.notify_from_name).toBe("Chola");
    expect(form.notify_email_provider).toBe("none");
    expect(form.notify_backoff_seconds).toBe("60");
    expect(form.notify_whatsapp_mode).toBe("manual");
    expect(form.alert_recipients).toBe("");
  });

  it("sin ajustes cargados, todo arranca apagado y sin enviar", () => {
    expect(formOf([])).toEqual({ ...ok, notify_from_name: "" });
  });
});
