import { describe, expect, it } from "vitest";
import type { TrackEvent } from "@/features/storefront/analytics/track";
import { purchaseEventId, toGa4Event, toMetaEvent } from "./mapping";

const item = { id: "p-1", name: "Blusa", price: 33.33, currency: "BOB", position: 2 };

describe("toMetaEvent", () => {
  it("view_item → ViewContent con el producto como grupo (el feed de Meta lo trae como item_group_id)", () => {
    expect(toMetaEvent({ name: "view_item", item })).toEqual({
      name: "ViewContent",
      params: {
        content_ids: ["p-1"],
        content_type: "product_group",
        content_name: "Blusa",
        value: 33.33,
        currency: "BOB",
      },
    });
  });

  it("add_to_cart: el valor es precio × cantidad SIN ruido de decimales (33,33 × 3 = 99,99 y no 99.99000000000001)", () => {
    const mapped = toMetaEvent({ name: "add_to_cart", item, quantity: 3 });
    expect(mapped?.name).toBe("AddToCart");
    expect(mapped?.params.value).toBe(99.99);
    expect(mapped?.params.contents).toEqual([{ id: "p-1", quantity: 3 }]);
  });

  it("el redondeo evita el ruido de decimales de verdad: 1,1 × 3 es 3,3 y no 3,3000000000000003", () => {
    const cheap = { ...item, price: 1.1 };
    expect(1.1 * 3).not.toBe(3.3); // el ruido existe en JavaScript
    expect(toMetaEvent({ name: "add_to_cart", item: cheap, quantity: 3 })?.params.value).toBe(3.3);
    expect(toGa4Event({ name: "add_to_cart", item: cheap, quantity: 3 })?.params.value).toBe(3.3);
    expect(
      toMetaEvent({ name: "begin_checkout", items: 1, value: 0.1 + 0.2, currency: "BOB" })?.params
        .value,
    ).toBe(0.3);
  });

  it("begin_checkout → InitiateCheckout y add_payment_info → AddPaymentInfo (sin valor si todavía no hay total)", () => {
    expect(toMetaEvent({ name: "begin_checkout", items: 2, value: 215, currency: "BOB" })).toEqual({
      name: "InitiateCheckout",
      params: { num_items: 2, value: 215, currency: "BOB" },
    });
    expect(
      toMetaEvent({
        name: "add_payment_info",
        paymentMethod: "whatsapp",
        value: null,
        currency: "BOB",
      })?.params,
    ).toEqual({
      currency: "BOB",
    });
    expect(
      toMetaEvent({
        name: "add_payment_info",
        paymentMethod: "whatsapp",
        value: 215,
        currency: "BOB",
      })?.params,
    ).toEqual({
      value: 215,
      currency: "BOB",
    });
  });

  it("purchase → Purchase con un event_id derivado del NÚMERO del pedido (el mismo que usa el servidor) y sin datos personales", () => {
    const mapped = toMetaEvent({
      name: "purchase",
      transactionId: "MIC-000123",
      value: 215,
      currency: "BOB",
      items: 2,
      shipping: 15,
      discount: 0,
    });
    expect(mapped).toEqual({
      name: "Purchase",
      eventId: "purchase.MIC-000123",
      params: { num_items: 2, value: 215, currency: "BOB" },
    });
    expect(purchaseEventId("MIC-000123")).toBe("purchase.MIC-000123");
    expect(JSON.stringify(mapped)).not.toMatch(/@|\+591/);
  });

  it("los eventos sin equivalente estándar en Meta no se envían", () => {
    const skipped: TrackEvent[] = [
      { name: "view_item_list", listId: "l", listName: "L", items: [item] },
      { name: "remove_from_cart", item, quantity: 1 },
      { name: "view_cart", items: 1, value: 10, currency: "BOB" },
    ];
    for (const event of skipped) expect(toMetaEvent(event)).toBeNull();
  });

  it("search → Search con el texto buscado", () => {
    expect(toMetaEvent({ name: "search", query: "chaqueta", results: 3 })).toEqual({
      name: "Search",
      params: { search_string: "chaqueta" },
    });
  });
});

describe("toGa4Event", () => {
  it("view_item_list: cada producto lleva su posición y la lista", () => {
    expect(
      toGa4Event({
        name: "view_item_list",
        listId: "tienda",
        listName: "Tienda",
        items: [item, { ...item, id: "p-2", position: 3 }],
      }),
    ).toEqual({
      name: "view_item_list",
      params: {
        item_list_id: "tienda",
        item_list_name: "Tienda",
        items: [
          { item_id: "p-1", item_name: "Blusa", price: 33.33, index: 2, item_list_id: "tienda" },
          { item_id: "p-2", item_name: "Blusa", price: 33.33, index: 3, item_list_id: "tienda" },
        ],
      },
    });
  });

  it("add_to_cart y remove_from_cart llevan cantidad y el valor de la línea (precio × cantidad, redondeado)", () => {
    for (const name of ["add_to_cart", "remove_from_cart"] as const) {
      const mapped = toGa4Event({ name, item, quantity: 3 });
      expect(mapped?.params.value).toBe(99.99);
      expect(mapped?.params.items).toEqual([
        { item_id: "p-1", item_name: "Blusa", price: 33.33, index: 2, quantity: 3 },
      ]);
    }
  });

  it("purchase: transaction_id es el número del pedido, con envío y sin datos personales", () => {
    const mapped = toGa4Event({
      name: "purchase",
      transactionId: "MIC-000123",
      value: 215,
      currency: "BOB",
      items: 2,
      shipping: 15,
      discount: 0,
    });
    expect(mapped).toEqual({
      name: "purchase",
      params: { transaction_id: "MIC-000123", currency: "BOB", value: 215, shipping: 15 },
    });
  });

  it("todos los demás eventos tienen su equivalente", () => {
    expect(toGa4Event({ name: "search", query: "q", results: 0 })).toEqual({
      name: "search",
      params: { search_term: "q" },
    });
    expect(toGa4Event({ name: "view_cart", items: 1, value: 10, currency: "BOB" })?.name).toBe(
      "view_cart",
    );
    expect(toGa4Event({ name: "begin_checkout", items: 1, value: 10, currency: "BOB" })?.name).toBe(
      "begin_checkout",
    );
    expect(
      toGa4Event({
        name: "add_payment_info",
        paymentMethod: "qr_manual",
        value: null,
        currency: "BOB",
      })?.params,
    ).toEqual({
      currency: "BOB",
      payment_type: "qr_manual",
    });
  });
});
