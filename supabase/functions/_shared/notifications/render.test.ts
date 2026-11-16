import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  cleanValue,
  escapeHtml,
  isValidSyntax,
  normalizeBody,
  renderEmailParts,
  renderText,
  renderWhatsappText,
  safeUrl,
  truncateCodePoints,
  variablesOf,
  whatsappLink,
} from "./render.ts";

// ── Sintaxis ───────────────────────────────────────────────────────────────────────────────
Deno.test("sintaxis: variables válidas, con o sin espacios", () => {
  assert(isValidSyntax("Hola {{customer_name}}, tu pedido {{ order_number }} ({{a1}})"));
  assert(isValidSyntax("sin variables"));
  assert(isValidSyntax(""));
});

Deno.test("sintaxis: una llave suelta o una variable inválida se rechaza", () => {
  for (const bad of [
    "Hola {{",
    "Hola }}",
    "{{Nombre}}",
    "{{a-b}}",
    "{{ }}",
    "{{1abc}}",
    "{{a b}}",
    "{{x}",
    "{x}}",
    "{{{{x}}",
  ])
    assertFalse(isValidSyntax(bad), `debería rechazar: ${bad}`);
});

Deno.test("variablesOf: en orden de aparición y sin repetir", () => {
  assertEquals(variablesOf("{{b}} y {{a}} y {{ b }} y {{c}}"), ["b", "a", "c"]);
  assertEquals(variablesOf("nada"), []);
});

// ── Sustitución ────────────────────────────────────────────────────────────────────────────
Deno.test("renderText: sustituye y no toca el texto de la tienda", () => {
  const result = renderText("Hola {{ name }}, pedido {{n}}.  Doble espacio queda.", {
    name: "Ana",
    n: "MIC-1",
  });
  assertEquals(result.output, "Hola Ana, pedido MIC-1.  Doble espacio queda.");
  assertEquals(result.missing, []);
});

Deno.test(
  "renderText: una variable que falta se pinta vacía, se informa y se repara el hueco",
  () => {
    const result = renderText("Hola {{customer_name}}, tu pedido {{order_number}}.", {
      order_number: "MIC-1",
    });
    assertEquals(result.output, "Hola, tu pedido MIC-1.");
    assertEquals(result.missing, ["customer_name"]);
  },
);

Deno.test(
  "renderText: una variable presente pero vacía repara el hueco igual, sin marcarla como faltante",
  () => {
    const result = renderText("Hola {{n}}, bien ¡{{x}} ya!", { n: "", x: "ok" });
    assertEquals(result.output, "Hola, bien ¡ok ya!");
    assertEquals(result.missing, []);
  },
);

Deno.test(
  "renderText: nombres heredados de Object no son variables (constructor, __proto__)",
  () => {
    const result = renderText("{{constructor}}|{{__proto__}}", {});
    assertEquals(result.output, "|");
    assertEquals(result.missing.sort(), ["__proto__", "constructor"].sort());
  },
);

Deno.test(
  "renderText: con mayúsculas ({{toString}}) no es una variable: queda tal cual (y la sintaxis lo rechaza)",
  () => {
    assertEquals(renderText("{{toString}}", {}).output, "{{toString}}");
    assertFalse(isValidSyntax("{{toString}}"));
  },
);

Deno.test("renderText: los valores son de UNA línea (sin saltos ni caracteres de control)", () => {
  const result = renderText("[{{v}}]", { v: "a\nb\r\nc\td\u0000e\u2028f" });
  assertEquals(result.output, "[a b c d e f]");
});

Deno.test(
  "renderText: un valor enorme se recorta a 500 puntos de código sin partir un emoji",
  () => {
    const out = renderText("{{v}}", { v: "😀".repeat(600) }).output;
    assertEquals(Array.from(out).length, 500);
    assert(out.endsWith("…"));
    assertEquals(
      Array.from(out)
        .slice(0, 499)
        .every((c) => c === "😀"),
      true,
    );
  },
);

Deno.test("renderText: un número u otro tipo se convierte a texto", () => {
  assertEquals(renderText("{{n}}-{{b}}", { n: 12.5, b: true }).output, "12.5-true");
});

Deno.test("cleanValue / truncateCodePoints", () => {
  assertEquals(cleanValue(null), "");
  assertEquals(cleanValue(undefined), "");
  assertEquals(cleanValue("  a   b  "), "a b");
  assertEquals(truncateCodePoints("abcdef", 4), "abc…");
  assertEquals(truncateCodePoints("abc", 4), "abc");
  assertEquals(truncateCodePoints("ab😀cd", 4), "ab😀…");
});

// ── Seguridad: HTML y cabeceras ────────────────────────────────────────────────────────────
Deno.test("escapeHtml escapa los cinco caracteres peligrosos", () => {
  assertEquals(
    escapeHtml(`<a href="x" onclick='y'>&</a>`),
    "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
  );
});

Deno.test("XSS: un nombre con etiquetas llega al correo como TEXTO, jamás como etiqueta", () => {
  const evil = `<script>alert(1)</script><img src=x onerror=alert(2)>"onmouseover="x`;
  const email = renderEmailParts(
    { subject: "Hola {{n}}", body: "Hola {{n}},\n\nTu pedido va a {{addr}}.", cta_label: null },
    { n: evil, addr: `Calle <b>1</b> & "2"` },
  );
  const html = email.paragraphsHtml.join("");
  assertFalse(
    /<script|<img|<b>|onerror=alert\(2\)>/.test(html),
    `HTML sin etiquetas vivas: ${html}`,
  );
  assert(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert(html.includes("&lt;b&gt;1&lt;/b&gt; &amp; &quot;2&quot;"));
  assert(email.text.includes("<script>"), "el texto plano conserva el dato tal cual (no es HTML)");
});

Deno.test("inyección de cabeceras: el asunto nunca lleva saltos de línea", () => {
  const email = renderEmailParts(
    { subject: "Pedido {{n}}", body: "x", cta_label: null },
    { n: "MIC-1\r\nBcc: victima@correo.com\nSubject: otro" },
  );
  assertFalse(/[\r\n]/.test(email.subject));
  assertEquals(email.subject, "Pedido MIC-1 Bcc: victima@correo.com Subject: otro");
});

Deno.test("el asunto se recorta a 200 caracteres", () => {
  const email = renderEmailParts(
    { subject: "{{v}}", body: "x", cta_label: null },
    { v: "a".repeat(450) },
  );
  // el valor ya viene recortado a 500; el asunto a 200
  assertEquals(Array.from(email.subject).length, 200);
  assert(email.subject.endsWith("…"));
});

Deno.test(
  "un asunto que queda vacío se informa vacío (el worker lo trata como error de contenido)",
  () => {
    assertEquals(
      renderEmailParts({ subject: "{{x}}", body: "hola", cta_label: null }, {}).subject,
      "",
    );
  },
);

// ── Cuerpo y botón ─────────────────────────────────────────────────────────────────────────
Deno.test("el cuerpo se parte en párrafos por línea en blanco y respeta los saltos simples", () => {
  const email = renderEmailParts(
    { subject: "s", body: "Uno\ndos\n\n\n\nTres", cta_label: null },
    {},
  );
  assertEquals(email.paragraphsHtml, ["Uno<br>dos", "Tres"]);
  assertEquals(email.text, "Uno\ndos\n\nTres");
});

Deno.test("normalizeBody: unifica saltos de línea y recorta", () => {
  assertEquals(normalizeBody("\r\n a \r\n\r\n\r\n\r\nb \r\n"), "a\n\nb");
});

Deno.test(
  "botón: aparece con una etiqueta y un enlace https válido, y el texto plano lo repite",
  () => {
    const email = renderEmailParts(
      { subject: "s", body: "Hola", cta_label: "Ver {{what}}" },
      { what: "mi pedido", order_url: "https://tienda.test/cuenta/pedidos/1" },
    );
    assertEquals(email.cta, {
      label: "Ver mi pedido",
      url: "https://tienda.test/cuenta/pedidos/1",
    });
    assertEquals(email.text, "Hola\n\nVer mi pedido: https://tienda.test/cuenta/pedidos/1");
  },
);

Deno.test("botón: usa cta_url si existe, si no order_url y si no admin_url", () => {
  const t = { subject: "s", body: "b", cta_label: "Ir" };
  assertEquals(
    renderEmailParts(t, { cta_url: "https://a.test/", order_url: "https://b.test/" }).cta?.url,
    "https://a.test/",
  );
  assertEquals(
    renderEmailParts(t, { order_url: "https://b.test/", admin_url: "https://c.test/" }).cta?.url,
    "https://b.test/",
  );
  assertEquals(renderEmailParts(t, { admin_url: "https://c.test/" }).cta?.url, "https://c.test/");
});

Deno.test("botón: sin etiqueta o sin enlace seguro no hay botón (ni se rompe el correo)", () => {
  assertEquals(
    renderEmailParts({ subject: "s", body: "b", cta_label: null }, { order_url: "https://a.test/" })
      .cta,
    null,
  );
  assertEquals(renderEmailParts({ subject: "s", body: "b", cta_label: "Ir" }, {}).cta, null);
  for (const unsafe of [
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "ftp://x.test/",
    "/relativo",
    "no es url",
    "",
    "mailto:a@b.co",
  ])
    assertEquals(
      renderEmailParts({ subject: "s", body: "b", cta_label: "Ir" }, { order_url: unsafe }).cta,
      null,
      unsafe,
    );
});

Deno.test("safeUrl: solo http(s), con tope de longitud", () => {
  assertEquals(safeUrl("http://a.test/x?y=1"), "http://a.test/x?y=1");
  assertEquals(safeUrl("https://a.test/" + "x".repeat(2000)), null);
  assertEquals(safeUrl(123), null);
  assertEquals(safeUrl(null), null);
});

// ── WhatsApp ───────────────────────────────────────────────────────────────────────────────
Deno.test("WhatsApp: texto plano con las variables, sin HTML", () => {
  const wa = renderWhatsappText(
    { body: "Hola {{n}}, tu pedido {{p}}.\n\nGracias" },
    { n: "Ana", p: "MIC-1" },
  );
  assertEquals(wa.text, "Hola Ana, tu pedido MIC-1.\n\nGracias");
  assertFalse(wa.truncated);
});

Deno.test("WhatsApp: hasta 1000 caracteres, sin partir un emoji en el corte", () => {
  const body = "a".repeat(998) + "😀😀😀";
  const wa = renderWhatsappText({ body }, {});
  assertEquals(Array.from(wa.text).length, 1000);
  assert(wa.truncated);
  assert(wa.text.endsWith("…"));
  assertFalse(
    /[\ud800-\udbff]$/.test(wa.text.slice(0, -1)),
    "no termina en medio de un par sustituto",
  );
  assertEquals(renderWhatsappText({ body: "a".repeat(1000) }, {}).truncated, false);
});

Deno.test("WhatsApp: emojis y acentos pasan intactos", () => {
  assertEquals(
    renderWhatsappText({ body: "¡Gracias {{n}}! 🎉 Ñandú" }, { n: "María" }).text,
    "¡Gracias María! 🎉 Ñandú",
  );
});

Deno.test("whatsappLink: arma el enlace wa.me con el mensaje codificado", () => {
  assertEquals(
    whatsappLink("+59170000001", "Hola Ana\nñ 🎉"),
    "https://wa.me/59170000001?text=Hola%20Ana%0A%C3%B1%20%F0%9F%8E%89",
  );
});

Deno.test("whatsappLink: sin un teléfono E.164 válido no hay enlace", () => {
  for (const bad of [
    null,
    undefined,
    "",
    "59170000001",
    "+0123456789",
    "+5917",
    "+591 7000 0001",
    "abc",
  ])
    assertEquals(whatsappLink(bad as string | null, "x"), null, String(bad));
});
