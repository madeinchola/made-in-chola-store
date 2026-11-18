import type { TrackEvent, TrackedItem } from "@/features/storefront/analytics/track";

/**
 * De nuestros eventos a los de cada proveedor. Funciones PURAS (sin red ni DOM): lo que se envía se decide aquí y se prueba con
 * cuentas hechas a mano. Los eventos no llevan datos personales; los identificadores de producto son los de nuestro catálogo (el
 * mismo que lleva el feed de Meta como `item_group_id`, por eso el tipo de contenido es «product_group»).
 */
export interface MetaEvent {
  name: string;
  params: Record<string, unknown>;
  /** Para deduplicar el evento del navegador con el del servidor (API de conversiones). */
  eventId?: string;
}

export interface Ga4Event {
  name: string;
  params: Record<string, unknown>;
}

const money = (n: number) => Math.round(n * 100) / 100;

/** El `event_id` de una compra: el mismo en el Pixel (navegador) y en la API de conversiones (servidor), para que Meta cuente UNA. */
export const purchaseEventId = (orderNumber: string) => `purchase.${orderNumber}`;

export function toMetaEvent(event: TrackEvent): MetaEvent | null {
  switch (event.name) {
    case "view_item":
      return {
        name: "ViewContent",
        params: {
          content_ids: [event.item.id],
          content_type: "product_group",
          content_name: event.item.name,
          value: money(event.item.price),
          currency: event.item.currency,
        },
      };
    case "search":
      return { name: "Search", params: { search_string: event.query } };
    case "add_to_cart":
      return {
        name: "AddToCart",
        params: {
          content_ids: [event.item.id],
          content_type: "product_group",
          content_name: event.item.name,
          contents: [{ id: event.item.id, quantity: event.quantity }],
          value: money(event.item.price * event.quantity),
          currency: event.item.currency,
        },
      };
    case "begin_checkout":
      return {
        name: "InitiateCheckout",
        params: { num_items: event.items, value: money(event.value), currency: event.currency },
      };
    case "add_payment_info":
      return {
        name: "AddPaymentInfo",
        params: {
          ...(event.value !== null ? { value: money(event.value) } : {}),
          currency: event.currency,
        },
      };
    case "purchase":
      return {
        name: "Purchase",
        eventId: purchaseEventId(event.transactionId),
        params: { num_items: event.items, value: money(event.value), currency: event.currency },
      };
    // Meta no tiene un evento estándar para estos: no se envían.
    case "view_item_list":
    case "remove_from_cart":
    case "view_cart":
      return null;
  }
}

const ga4Item = (item: TrackedItem, extra: Record<string, unknown> = {}) => ({
  item_id: item.id,
  item_name: item.name,
  price: money(item.price),
  ...(item.position !== undefined ? { index: item.position } : {}),
  ...extra,
});

export function toGa4Event(event: TrackEvent): Ga4Event | null {
  switch (event.name) {
    case "view_item_list":
      return {
        name: "view_item_list",
        params: {
          item_list_id: event.listId,
          item_list_name: event.listName,
          items: event.items.map((item) => ga4Item(item, { item_list_id: event.listId })),
        },
      };
    case "view_item":
      return {
        name: "view_item",
        params: {
          currency: event.item.currency,
          value: money(event.item.price),
          items: [ga4Item(event.item)],
        },
      };
    case "search":
      return { name: "search", params: { search_term: event.query } };
    case "add_to_cart":
      return {
        name: "add_to_cart",
        params: {
          currency: event.item.currency,
          value: money(event.item.price * event.quantity),
          items: [ga4Item(event.item, { quantity: event.quantity })],
        },
      };
    case "remove_from_cart":
      return {
        name: "remove_from_cart",
        params: {
          currency: event.item.currency,
          value: money(event.item.price * event.quantity),
          items: [ga4Item(event.item, { quantity: event.quantity })],
        },
      };
    case "view_cart":
      return { name: "view_cart", params: { currency: event.currency, value: money(event.value) } };
    case "begin_checkout":
      return {
        name: "begin_checkout",
        params: { currency: event.currency, value: money(event.value) },
      };
    case "add_payment_info":
      return {
        name: "add_payment_info",
        params: {
          currency: event.currency,
          ...(event.value !== null ? { value: money(event.value) } : {}),
          payment_type: event.paymentMethod,
        },
      };
    case "purchase":
      return {
        name: "purchase",
        params: {
          transaction_id: event.transactionId,
          currency: event.currency,
          value: money(event.value),
          shipping: money(event.shipping),
        },
      };
  }
}
