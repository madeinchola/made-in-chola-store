import { describe, expect, it } from "vitest";
import { makeRow } from "@/features/checkout/checkout-test-utils";
import { paymentLabel, toDetail, toSummary, toTimeline, variantLabel } from "./ordersMapping";
import { ORDER_STATUSES } from "./types";

describe("toSummary", () => {
  it("convierte el total decimal del servidor a dinero exacto (centavos enteros)", () => {
    const summary = toSummary(makeRow({ total: 255.55 }));
    expect(summary).toMatchObject({
      id: expect.any(String),
      number: "MIC-000123",
      status: "pending_payment",
    });
    expect(summary.total).toEqual({ amount: 25555, currency: "BOB" });
    expect(summary.createdAt).toBe("2026-11-09T15:30:00Z");
  });

  it("un total con céntimos raros no pierde ni inventa centavos (0,1 + 0,2 no son 0,30000000000000004)", () => {
    expect(toSummary(makeRow({ total: 0.3 })).total.amount).toBe(30);
    expect(toSummary(makeRow({ total: 1234.5 })).total.amount).toBe(123450);
  });
});

describe("toDetail", () => {
  it("ordena las líneas por su número, arma la variante y el precio por unidad", () => {
    const detail = toDetail(
      makeRow({
        order_items: [
          {
            id: "b",
            line_no: 2,
            product_name: "Gorro",
            color_name: null,
            size_label: null,
            qty: 1,
            unit_price: 40,
            final_total: 36,
          },
          {
            id: "a",
            line_no: 1,
            product_name: "Camisa",
            color_name: "Celeste",
            size_label: "S",
            qty: 2,
            unit_price: 100,
            final_total: 180,
          },
        ],
      }),
    );
    expect(detail.items.map((i) => i.name)).toEqual(["Camisa", "Gorro"]);
    expect(detail.items[0]).toMatchObject({ variant: "Celeste · S", quantity: 2 });
    expect(detail.items[0]!.unitPrice).toEqual({ amount: 10000, currency: "BOB" });
    expect(detail.items[0]!.total).toEqual({ amount: 18000, currency: "BOB" });
    expect(detail.items[1]!.variant).toBeNull();
  });

  it("el envío que se muestra es el costo menos el descuento de envío (envío gratis = 0)", () => {
    expect(
      toDetail(makeRow({ shipping_cost: 15, shipping_discount: 0 })).shippingCost!.amount,
    ).toBe(1500);
    expect(
      toDetail(makeRow({ shipping_cost: 15, shipping_discount: 15 })).shippingCost!.amount,
    ).toBe(0);
    expect(
      toDetail(makeRow({ shipping_cost: 15.5, shipping_discount: 0.25 })).shippingCost!.amount,
    ).toBe(1525);
  });

  it("describe el envío con método, dirección y la fecha con franja", () => {
    const detail = toDetail(
      makeRow({
        shipping_address: {
          line1: "Calle 1",
          line2: "Depto 2",
          city: "La Paz",
          department: "La Paz",
        },
        delivery_slot: { date: "2026-12-01", start: "10:00", end: "12:00" },
      }),
    );
    expect(detail.shipping).toEqual({
      label: "Entrega a domicilio",
      address: "Calle 1, Depto 2, La Paz, La Paz",
      schedule: "Fecha y franja: mar 1 dic, 10:00 a 12:00",
    });
  });

  it("un recojo no tiene dirección ni franja; sin método no hay envío", () => {
    const pickup = toDetail(
      makeRow({
        shipping_method: { code: "recojo", name: "Recojo", kind: "pickup" },
        shipping_address: null,
        delivery_slot: null,
      }),
    );
    expect(pickup.shipping).toEqual({ label: "Recojo", address: null, schedule: null });
    expect(toDetail(makeRow({ shipping_method: null })).shipping).toBeNull();
  });

  it("una fecha sin franja muestra solo el día", () => {
    const detail = toDetail(
      makeRow({ delivery_slot: { date: "2026-12-01", start: null, end: null } }),
    );
    expect(detail.shipping!.schedule).toBe("mar 1 dic");
  });

  it("desglose: subtotal, descuento y cupón", () => {
    const detail = toDetail(
      makeRow({ subtotal: 240, discount_total: 24, coupon_code: "VERANO20" }),
    );
    expect(detail.subtotal!.amount).toBe(24000);
    expect(detail.discount!.amount).toBe(2400);
    expect(detail.couponCode).toBe("VERANO20");
  });

  it("el seguimiento va del más antiguo al más reciente aunque la base los entregue desordenados", () => {
    const timeline = toTimeline({
      order_status_history: [
        { id: 3, to_status: "shipped", created_at: "c" },
        { id: 1, to_status: "pending_payment", created_at: "a" },
        { id: 2, to_status: "paid", created_at: "b" },
      ],
    });
    expect(timeline.map((e) => e.status)).toEqual(["pending_payment", "paid", "shipped"]);
    expect(toTimeline({})).toEqual([]);
  });

  it("canCancel: solo antes de «preparing» (BR-ORD-02), para cada uno de los 8 estados", () => {
    const expected: Record<string, boolean> = {
      pending_payment: true,
      paid: true,
      preparing: false,
      shipped: false,
      delivered: false,
      completed: false,
      cancelled: false,
      refunded: false,
    };
    expect(Object.keys(expected).sort()).toEqual([...ORDER_STATUSES].sort());
    for (const status of ORDER_STATUSES) {
      expect(toDetail(makeRow({ status })).canCancel, status).toBe(expected[status]);
    }
  });
});

describe("etiquetas", () => {
  it("variantLabel junta color y talla que existan", () => {
    expect(variantLabel("Negro", "M")).toBe("Negro · M");
    expect(variantLabel("Negro", null)).toBe("Negro");
    expect(variantLabel(null, "M")).toBe("M");
    expect(variantLabel(null, null)).toBeNull();
  });

  it("el método de pago conocido se muestra con su nombre; uno desconocido, con su código (no se inventa)", () => {
    expect(paymentLabel("whatsapp")).toBe("Pedido por WhatsApp");
    expect(paymentLabel("cash_on_delivery")).toBe("Efectivo contra entrega");
    expect(paymentLabel("manual_qr")).toBe("manual_qr");
  });
});
