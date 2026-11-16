import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import { buildPreview, type PreviewInput } from "./preview.ts";
import type { SiteContext } from "./types.ts";

const SITE: SiteContext = { siteUrl: "https://tienda.test", storeName: "Made In Chola" };
const email = (over: Partial<PreviewInput> = {}): PreviewInput => ({
  channel: "email",
  audience: "customer",
  subject: "Tu pedido {{order_number}}",
  body: "Hola {{customer_name}},\n\ntotal {{order_total}}.",
  cta_label: "Ver mi pedido",
  ...over,
});

Deno.test("preview de correo: con los valores de ejemplo, el HTML completo y el texto", () => {
  const result = buildPreview(email(), SITE);
  assert(result.ok);
  assertEquals(result.errors, []);
  assertEquals(result.subject, "Tu pedido MIC-000123");
  assertStringIncludes(result.text, "Hola Ana,");
  assertStringIncludes(result.text, "total Bs 250,00.");
  assertStringIncludes(result.html ?? "", "<!doctype html>");
  assertStringIncludes(result.html ?? "", "Ver mi pedido");
  assertEquals(result.warnings, []);
});

Deno.test("preview de WhatsApp: solo texto, sin HTML", () => {
  const result = buildPreview(
    {
      channel: "whatsapp",
      audience: "customer",
      subject: "",
      body: "Hola {{customer_name}}, {{order_number}}",
      cta_label: null,
    },
    SITE,
  );
  assert(result.ok);
  assertEquals(result.text, "Hola Ana, MIC-000123");
  assertEquals(result.html, null);
  assertEquals(result.length, 20);
});

Deno.test("la vista previa es EXACTAMENTE lo que arma el worker (mismo diseño y mismo pie)", () => {
  const html = buildPreview(email(), SITE).html ?? "";
  assertStringIncludes(html, "Recibes este mensaje porque tienes un pedido en Made In Chola");
  const admin =
    buildPreview(
      email({
        audience: "admin",
        subject: "Alerta {{order_number}}",
        body: "Revisa {{reason}}",
        cta_label: "Abrir en el panel",
      }),
      SITE,
    ).html ?? "";
  assertStringIncludes(admin, "Alerta interna de Made In Chola");
});

Deno.test("errores que impiden guardar: sintaxis, asunto, cuerpo", () => {
  assertEquals(buildPreview(email({ body: "Hola {{" }), SITE).errors, ["syntax"]);
  assertEquals(buildPreview(email({ subject: "  " }), SITE).errors, ["subject_required"]);
  assertEquals(buildPreview(email({ subject: "a".repeat(201) }), SITE).errors, [
    "subject_too_long",
  ]);
  assertEquals(buildPreview(email({ subject: "a\nb" }), SITE).errors, ["subject_multiline"]);
  assertEquals(buildPreview(email({ body: "   " }), SITE).errors, ["body_required"]);
  assertEquals(buildPreview(email({ body: "a".repeat(4001) }), SITE).errors, ["body_too_long"]);
  assert(buildPreview(email({ body: "a".repeat(4000) }), SITE).ok);
  assertFalse(buildPreview(email({ body: "Hola {{" }), SITE).ok);
});

Deno.test("una variable que no existe (casi seguro un error de tipeo) bloquea y dice cuál", () => {
  const result = buildPreview(
    email({ body: "Hola {{customer_nmae}} y {{order_numbr}} y {{order_number}}" }),
    SITE,
  );
  assertFalse(result.ok);
  assertEquals(result.errors, ["unknown_variable"]);
  assertEquals(result.unknown, ["customer_nmae", "order_numbr"]);
});

Deno.test(
  "una variable de la otra audiencia también se rechaza (la clienta no tiene {{admin_url}})",
  () => {
    assertEquals(buildPreview(email({ body: "ve a {{admin_url}}" }), SITE).unknown, ["admin_url"]);
    assertEquals(
      buildPreview(email({ audience: "admin", body: "hola {{customer_name}}" }), SITE).unknown,
      ["customer_name"],
    );
    assert(
      buildPreview(
        email({ audience: "admin", subject: "x", body: "{{admin_url}} {{order_number}}" }),
        SITE,
      ).ok,
    );
  },
);

Deno.test("las variables del asunto y del botón también se revisan", () => {
  assertEquals(buildPreview(email({ subject: "Hola {{nada}}" }), SITE).unknown, ["nada"]);
  assertEquals(buildPreview(email({ cta_label: "Ir {{otra}}" }), SITE).unknown, ["otra"]);
});

Deno.test("WhatsApp: más de 1000 caracteres bloquea; el recorte se avisa", () => {
  const long = buildPreview(
    {
      channel: "whatsapp",
      audience: "customer",
      subject: "",
      body: "a".repeat(1001),
      cta_label: null,
    },
    SITE,
  );
  assertEquals(long.errors, ["body_too_long"]);
  assertEquals(long.warnings, ["whatsapp_truncated"]);
  const exact = buildPreview(
    {
      channel: "whatsapp",
      audience: "customer",
      subject: "",
      body: "a".repeat(1000),
      cta_label: null,
    },
    SITE,
  );
  assert(exact.ok);
  assertEquals(exact.warnings, []);
});

Deno.test("WhatsApp no pide asunto", () => {
  assert(
    buildPreview(
      { channel: "whatsapp", audience: "customer", subject: "", body: "Hola", cta_label: null },
      SITE,
    ).ok,
  );
});

Deno.test("un botón sin enlace disponible se avisa (no bloquea)", () => {
  const result = buildPreview(
    email({ audience: "admin", subject: "s", body: "b", cta_label: "Ir" }),
    { siteUrl: "javascript:alert(1)", storeName: "X" },
  );
  assert(result.ok);
  assertEquals(result.warnings, ["no_cta_url"]);
});

Deno.test(
  "la vista previa no puede ejecutar nada: el HTML de un texto malicioso sale escapado",
  () => {
    const result = buildPreview(
      email({ body: "<script>alert(1)</script> {{customer_name}}" }),
      SITE,
    );
    assertFalse((result.html ?? "").includes("<script>alert"));
    assertStringIncludes(result.html ?? "", "&lt;script&gt;");
  },
);
