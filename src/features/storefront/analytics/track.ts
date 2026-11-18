import { hasConsent, type ConsentCategory } from "@/features/consent/consentStore";

/**
 * Capa de analítica: la tienda llama a `track(...)` y no pasa nada hasta que un proveedor se suscriba, y un proveedor de
 * terceros (Meta, GA4) solo recibe eventos con el consentimiento de su categoría (S15, `consentStore`). Así las pantallas ya emiten sus eventos y conectar Meta/GA4 después es añadir un
 * suscriptor, no tocar pantallas. Los eventos NO llevan datos personales.
 */
export interface TrackedItem {
  id: string;
  name: string;
  price: number;
  currency: string;
  position?: number;
}

export type TrackEvent =
  | { name: "view_item_list"; listId: string; listName: string; items: TrackedItem[] }
  | { name: "view_item"; item: TrackedItem; variant?: { color?: string; size?: string } }
  | { name: "search"; query: string; results: number }
  | {
      name: "add_to_cart";
      item: TrackedItem;
      quantity: number;
      variant?: { color?: string; size?: string };
    }
  | { name: "remove_from_cart"; item: TrackedItem; quantity: number }
  | { name: "view_cart"; items: number; value: number; currency: string }
  // Checkout (S10): sin datos personales. `transactionId` es el número del pedido (MIC-000123), no la persona.
  | { name: "begin_checkout"; items: number; value: number; currency: string }
  | { name: "add_payment_info"; paymentMethod: string; value: number | null; currency: string }
  | {
      name: "purchase";
      transactionId: string;
      value: number;
      currency: string;
      items: number;
      shipping: number;
      discount: number;
    };

export type TrackListener = (event: TrackEvent) => void;

// Cada proveedor declara su categoría: si la persona no la aceptó (o la retiró), el evento NI SIQUIERA se le entrega.
const listeners = new Map<TrackListener, ConsentCategory | null>();

/**
 * Registra un proveedor. Con `category`, solo recibe eventos mientras haya consentimiento de esa categoría (S15); sin ella, recibe
 * todo (solo para suscriptores propios que no envían nada a terceros). Devuelve la función para darlo de baja.
 */
export function subscribeToTracking(
  listener: TrackListener,
  category: ConsentCategory | null = null,
): () => void {
  listeners.set(listener, category);
  return () => {
    listeners.delete(listener);
  };
}

/** Emite un evento a los proveedores con consentimiento; el fallo de uno no afecta a los demás ni a la pantalla. */
export function track(event: TrackEvent): void {
  for (const [listener, category] of [...listeners]) {
    if (category !== null && !hasConsent(category)) continue;
    try {
      listener(event);
    } catch {
      // un proveedor roto jamás debe romper la navegación
    }
  }
}
