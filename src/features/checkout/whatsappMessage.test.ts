import { describe, expect, it } from "vitest";
import {
  buildWhatsAppMessage,
  buildWhatsAppUrl,
  cleanLine,
  WHATSAPP_URL_MAX,
  whatsappDigits,
} from "./whatsappMessage";
import type { OrderSnapshot } from "./types";

type Item = OrderSnapshot["items"][number];

function item(over: Partial<Item> = {}): Item {
  return {
    id: "i1",
    line_no: 1,
    variant_id: "v1",
    product_id: "p1",
    product_name: "Camisa Pliegues",
    color_name: "Celeste",
    size_label: "S",
    color_hex: null,
    sku: null,
    image_path: null,
    qty: 2,
    unit_price: 100,
    line_total: 200,
    discount: 20,
    final_total: 180,
    ...over,
  };
}

function order(over: Partial<OrderSnapshot> = {}): OrderSnapshot {
  return {
    id: "o1",
    number: "MIC-000123",
    status: "pending_payment",
    currency: "BOB",
    country: "BO",
    subtotal: 240,
    discount_total: 24,
    shipping_cost: 15,
    shipping_discount: 0,
    total: 231,
    contact_name: "Ana Pérez",
    contact_email: "ana@example.com",
    contact_phone: "+59171234567",
    shipping_method: { code: "delivery", name: "Entrega a domicilio", kind: "delivery" },
    shipping_address: { line1: "Calle 1", line2: null, city: "La Paz" },
    delivery_slot: { date: "2026-12-01", slot_id: "s1", start: "10:00", end: "12:00" },
    payment_method: "whatsapp",
    payment_provider: "whatsapp",
    coupon_code: null,
    created_at: "2026-11-09T12:00:00Z",
    items: [
      item(),
      item({
        id: "i2",
        line_no: 2,
        product_name: "Gorro",
        color_name: null,
        size_label: null,
        qty: 1,
        final_total: 36,
      }),
    ],
    ...over,
  };
}

describe("buildWhatsAppMessage", () => {
  it("arma el mensaje completo con los importes ya calculados por el servidor", () => {
    // 2 × Camisa (180,00 ya con su descuento) + 1 × Gorro (36,00) · subtotal 240,00 · −24,00 · envío 15,00 · total 231,00
    expect(buildWhatsAppMessage(order())).toBe(
      [
        "Hola, quiero confirmar mi pedido MIC-000123 en Made In Chola.",
        "",
        "Productos:",
        "• 2 × Camisa Pliegues (Celeste · S) — Bs 180,00",
        "• 1 × Gorro — Bs 36,00",
        "",
        "Subtotal: Bs 240,00",
        "Descuento: −Bs 24,00",
        "Envío: Bs 15,00",
        "Total: Bs 231,00",
        "",
        "Entrega a domicilio: Calle 1, La Paz",
        "Fecha y franja: mar 1 dic, 10:00 a 12:00",
        "A nombre de: Ana Pérez",
      ].join("\n"),
    );
  });

  it("no filtra el teléfono, el correo ni datos fiscales (solo lo necesario)", () => {
    const message = buildWhatsAppMessage(
      order({ contact_email: "secreto@example.com", contact_phone: "+59170000000" }),
    );
    expect(message).not.toContain("+591");
    expect(message).not.toContain("secreto");
    expect(message).not.toContain("@");
  });

  it("sin descuento no hay línea de descuento", () => {
    const message = buildWhatsAppMessage(order({ discount_total: 0, total: 255 }));
    expect(message).not.toContain("Descuento");
    expect(message).toContain("Total: Bs 255,00");
  });

  it("con envío gratis (descuento de envío = costo) dice «gratis», no 0,00", () => {
    const message = buildWhatsAppMessage(
      order({ shipping_cost: 15, shipping_discount: 15, total: 216 }),
    );
    expect(message).toContain("Envío: gratis");
    expect(message).not.toContain("Envío: Bs");
  });

  it("el recojo en tienda no lleva envío ni dirección", () => {
    const message = buildWhatsAppMessage(
      order({
        shipping_method: { code: "recojo", name: "Recojo", kind: "pickup" },
        shipping_address: null,
        shipping_cost: 0,
        total: 216,
        delivery_slot: null,
      }),
    );
    expect(message).toContain("Recojo en tienda");
    expect(message).not.toContain("Envío:");
    expect(message).not.toContain("Entrega a domicilio");
    expect(message).not.toContain("Fecha y franja");
  });

  it("sin franja elegida no inventa una", () => {
    expect(buildWhatsAppMessage(order({ delivery_slot: null }))).not.toContain("Fecha y franja");
  });

  it("una fecha sin franja (sin franjas configuradas) muestra solo el día, sin coma colgada", () => {
    const message = buildWhatsAppMessage(
      order({ delivery_slot: { date: "2026-12-01", slot_id: null, start: null, end: null } }),
    );
    expect(message).toContain("Fecha y franja: mar 1 dic");
    expect(message).not.toMatch(/mar 1 dic,\s*$/m);
  });

  it("limpia saltos de línea y caracteres de control del texto de la persona (no rompe el formato)", () => {
    const message = buildWhatsAppMessage(
      order({
        contact_name: "Ana\nPérez\u0000\r\nX",
        items: [item({ product_name: "Camisa\nroja\t\u0007" })],
      }),
    );
    expect(message).toContain("A nombre de: Ana Pérez X");
    expect(message).toContain("• 2 × Camisa roja (Celeste · S)");
    // eslint-disable-next-line no-control-regex
    expect(message.replace(/\n/g, "")).not.toMatch(/[\u0000-\u001F]/);
  });

  it("acorta nombres larguísimos", () => {
    const message = buildWhatsAppMessage(order({ contact_name: "N".repeat(500) }));
    const line = message.split("\n").find((l) => l.startsWith("A nombre de:"))!;
    expect(line.length).toBeLessThanOrEqual("A nombre de: ".length + 80);
    expect(line.endsWith("…")).toBe(true);
  });
});

describe("buildWhatsAppUrl · longitud máxima", () => {
  it("el enlace es wa.me + solo dígitos + el texto codificado, y se decodifica al mensaje exacto", () => {
    const o = order();
    const url = buildWhatsAppUrl("+59167528677", o)!;
    expect(url.startsWith("https://wa.me/59167528677?text=")).toBe(true);
    expect(decodeURIComponent(url.split("?text=")[1]!)).toBe(buildWhatsAppMessage(o));
  });

  it("sin número de la tienda, o con uno que no es un teléfono, no hay enlace (y no se inventa uno)", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "   ",
      "abc",
      "+0123456789",
      "+12",
      "+1234567890123456",
    ]) {
      expect(buildWhatsAppUrl(bad, order()), String(bad)).toBeNull();
    }
  });

  it("un pedido enorme se recorta con «…y N productos más» y SIEMPRE cabe en la URL", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      item({
        id: `i${i}`,
        line_no: i + 1,
        product_name: `Producto con un nombre bastante largo número ${i + 1}`,
        qty: i + 1,
      }),
    );
    const o = order({ items: many });
    const url = buildWhatsAppUrl("+59167528677", o)!;
    expect(url.length).toBeLessThanOrEqual(WHATSAPP_URL_MAX);
    const message = decodeURIComponent(url.split("?text=")[1]!);
    const shown = message.split("\n").filter((l) => l.startsWith("• ")).length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(40);
    expect(message).toContain(`…y ${40 - shown} productos más`);
    // lo que sí o sí viaja aunque se recorten productos
    expect(message).toContain("Total: Bs 231,00");
    expect(message).toContain("MIC-000123");
  });

  it("propiedad: de 1 a 80 líneas y nombres de 5 a 200 caracteres, el enlace nunca pasa del tope", () => {
    for (const count of [1, 2, 5, 12, 30, 80]) {
      for (const nameLength of [5, 40, 200]) {
        const items = Array.from({ length: count }, (_, i) =>
          item({
            id: `i${i}`,
            line_no: i + 1,
            product_name: "ñ".repeat(nameLength),
            color_name: "Celeste con espacio",
            size_label: "XL",
          }),
        );
        const url = buildWhatsAppUrl("+59167528677", order({ items }))!;
        expect(url.length, `${count} líneas de ${nameLength}`).toBeLessThanOrEqual(
          WHATSAPP_URL_MAX,
        );
        expect(url).toContain("MIC-000123");
      }
    }
  });

  it("un pedido de una sola unidad no se recorta", () => {
    const message = buildWhatsAppMessage(order({ items: [item({ qty: 1, final_total: 90 })] }));
    expect(message).not.toContain("productos más");
    expect(message.split("\n").filter((l) => l.startsWith("• "))).toHaveLength(1);
  });

  it("el número de dígitos de la tienda se normaliza (con o sin +, espacios o guiones)", () => {
    expect(whatsappDigits("+591 6752-8677")).toBe("59167528677");
    expect(whatsappDigits("59167528677")).toBe("59167528677");
    expect(whatsappDigits("(591) 67528677")).toBe("59167528677");
  });
});

describe("cleanLine", () => {
  it("colapsa espacios, quita controles y recorta con puntos suspensivos", () => {
    expect(cleanLine("  a \n\n b\t c  ", 50)).toBe("a b c");
    expect(cleanLine("abcdef", 4)).toBe("abc…");
    expect(cleanLine(null, 10)).toBe("");
    expect(cleanLine("\u2028 hola \u2029", 10)).toBe("hola");
  });

  it("B2: corta por puntos de código: un emoji en el borde no queda partido", () => {
    // 78 «a» + 😀 + 10 «b»: el corte (79 caracteres) cae justo sobre el emoji. Por unidades UTF-16 lo partiría.
    const name = `${"a".repeat(78)}😀${"b".repeat(10)}`;
    const cut = cleanLine(name, 80);
    expect(cut).toBe(`${"a".repeat(78)}😀…`);
    expect(() => encodeURIComponent(cut)).not.toThrow();
  });

  it("B2: un sustituto suelto que ya venía en el texto se vuelve un espacio (no rompe encodeURIComponent)", () => {
    const lone = `hola\ud83dmundo`;
    expect(() => encodeURIComponent(lone)).toThrow();
    expect(cleanLine(lone, 50)).toBe("hola mundo");
    expect(() => encodeURIComponent(cleanLine(`${lone}\ude00`, 50))).not.toThrow();
  });

  it("B2: el enlace del pedido se arma aunque el nombre, la variante y la dirección lleven emojis en el borde", () => {
    for (const length of [76, 77, 78, 79, 80, 81]) {
      const emoji = `${"a".repeat(length)}😀😀😀`;
      const o = order({
        contact_name: emoji,
        shipping_address: { line1: `${"c".repeat(length + 60)}😀😀`, line2: null, city: "La Paz" },
        items: [
          item({
            product_name: emoji,
            color_name: `${"x".repeat(length - 40)}😀😀`,
            size_label: "M",
          }),
        ],
      });
      const url = buildWhatsAppUrl("+59167528677", o);
      expect(url, `largo ${length}`).not.toBeNull();
      expect(url!.length).toBeLessThanOrEqual(WHATSAPP_URL_MAX);
    }
  });
});
