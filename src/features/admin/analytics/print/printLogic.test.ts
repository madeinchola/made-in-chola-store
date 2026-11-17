import { describe, expect, it } from "vitest";
import {
  MAX_PRINT_ORDERS,
  addressLines,
  amountToCollect,
  labelFontPt,
  needsShippingLabel,
  pageCss,
  parseIds,
  slotText,
  sortForDispatch,
  unitsOf,
} from "./printLogic";
import type { OrderDetail } from "../../orders/types";

const order = (over: Partial<OrderDetail> = {}): OrderDetail =>
  ({
    id: "o1",
    number: "MIC-000001",
    status: "paid",
    channel: "web",
    contactName: "Ana Pérez",
    contactPhone: "+59171234567",
    total: 245,
    currency: "BOB",
    paymentMethod: "whatsapp",
    paymentProvider: "whatsapp",
    createdAt: "",
    updatedAt: "",
    profileId: "p",
    subtotal: 240,
    discountTotal: 0,
    shippingCost: 5,
    shippingDiscount: 0,
    contactEmail: null,
    shippingKind: "delivery",
    shippingName: "A domicilio",
    address: {
      recipient: "Ana Pérez",
      phone: "+59171234567",
      line1: "Av. Arce 123",
      line2: "Edif. Sol, piso 4",
      city: "La Paz",
      department: "La Paz",
      country: "BO",
      reference: "frente a la farmacia",
      lat: null,
      lng: null,
    },
    slot: { date: "2026-11-20", start: "10:00:00", end: "12:00:00" },
    couponCode: null,
    paymentExpiresAt: null,
    paidAt: null,
    cancelledAt: null,
    cancelReason: null,
    cancelledBy: null,
    editCount: 0,
    editedAt: null,
    items: [
      {
        id: "i1",
        lineNo: 1,
        variantId: "v",
        productId: "p",
        name: "Blusa",
        colorName: "Rojo",
        sizeLabel: "M",
        sku: "B-R-M",
        imagePath: null,
        qty: 2,
        unitPrice: 100,
        lineTotal: 200,
        discount: 0,
        finalTotal: 200,
      },
    ],
    ...over,
  }) as OrderDetail;

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("parseIds", () => {
  it("toma solo identificadores válidos, sin repetir, en minúsculas y en el orden de la dirección", () => {
    expect(parseIds(`${A},${B},${A.toUpperCase()},no-es-id, ,"><script>`)).toEqual([A, B]);
  });
  it("sin nada o con puro ruido, vacío", () => {
    expect(parseIds(null)).toEqual([]);
    expect(parseIds("")).toEqual([]);
    expect(parseIds("a,b,c")).toEqual([]);
  });
  it("respeta el tope de pedidos", () => {
    const many = Array.from(
      { length: 100 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    ).join(",");
    expect(parseIds(many)).toHaveLength(MAX_PRINT_ORDERS);
  });
});

describe("pageCss", () => {
  it("A4 y carta con 12 mm de margen; la guía va a lo ancho", () => {
    expect(pageCss("a4", "label")).toBe("@page { size: A4; margin: 12mm; }");
    expect(pageCss("letter", "packing")).toBe("@page { size: letter; margin: 12mm; }");
    expect(pageCss("a4", "dispatch")).toBe("@page { size: A4 landscape; margin: 12mm; }");
    expect(pageCss("letter", "dispatch")).toBe("@page { size: letter landscape; margin: 12mm; }");
  });
  it("la etiqueta es de 10 × 15 cm con poco margen, sea cual sea el documento", () => {
    expect(pageCss("label", "label")).toBe("@page { size: 100mm 150mm; margin: 4mm; }");
    expect(pageCss("label", "dispatch")).toBe("@page { size: 100mm 150mm; margin: 4mm; }");
  });
});

describe("labelFontPt", () => {
  it("una dirección larga se achica en vez de salirse de la hoja", () => {
    expect(labelFontPt(60, "label")).toBe(12);
    expect(labelFontPt(200, "label")).toBe(10);
    expect(labelFontPt(400, "label")).toBe(8);
    expect(labelFontPt(60, "a4")).toBe(16);
    expect(labelFontPt(400, "a4")).toBe(12);
  });
});

describe("dirección, franja y cobro", () => {
  it("la dirección sale en líneas sin vacíos y con la referencia", () => {
    expect(addressLines(order())).toEqual([
      "Av. Arce 123",
      "Edif. Sol, piso 4",
      "La Paz, La Paz",
      "Ref.: frente a la farmacia",
    ]);
    expect(
      addressLines(
        order({
          address: {
            recipient: "x",
            phone: "y",
            line1: "Calle 1",
            line2: null,
            city: "El Alto",
            department: null,
            country: "BO",
            reference: null,
            lat: null,
            lng: null,
          },
        }),
      ),
    ).toEqual(["Calle 1", "El Alto"]);
    expect(addressLines(order({ address: null }))).toEqual([]);
  });
  it("la franja en una frase, con horas sin segundos", () => {
    expect(slotText(order())).toBe("2026-11-20, 10:00–12:00");
    expect(slotText(order({ slot: { date: "2026-11-20", start: null, end: null } }))).toBe(
      "2026-11-20",
    );
    expect(slotText(order({ slot: null }))).toBe("");
  });
  it("solo se cobra al entregar un contra entrega que todavía no se entregó ni se canceló", () => {
    expect(amountToCollect(order({ paymentMethod: "cash_on_delivery", status: "preparing" }))).toBe(
      245,
    );
    expect(
      amountToCollect(order({ paymentMethod: "cash_on_delivery", status: "delivered" })),
    ).toBeNull();
    expect(
      amountToCollect(order({ paymentMethod: "cash_on_delivery", status: "cancelled" })),
    ).toBeNull();
    expect(amountToCollect(order({ paymentMethod: "qr_manual", status: "preparing" }))).toBeNull();
  });
});

describe("orden de la ruta y bultos", () => {
  it("por día y hora de la franja, lo que no tiene franja al final, y por número dentro de la misma franja", () => {
    const sorted = sortForDispatch([
      order({
        id: "a",
        number: "MIC-3",
        slot: { date: "2026-11-21", start: "09:00:00", end: null },
      }),
      order({ id: "b", number: "MIC-2", slot: null }),
      order({
        id: "c",
        number: "MIC-1",
        slot: { date: "2026-11-20", start: "14:00:00", end: null },
      }),
      order({
        id: "d",
        number: "MIC-0",
        slot: { date: "2026-11-20", start: "14:00:00", end: null },
      }),
    ]);
    expect(sorted.map((o) => o.number)).toEqual(["MIC-0", "MIC-1", "MIC-3", "MIC-2"]);
  });
  it("cuenta unidades y distingue el recojo (sin etiqueta de envío)", () => {
    expect(unitsOf(order())).toBe(2);
    expect(needsShippingLabel(order({ shippingKind: "pickup" }))).toBe(false);
    expect(needsShippingLabel(order({ shippingKind: "delivery" }))).toBe(true);
  });
});
