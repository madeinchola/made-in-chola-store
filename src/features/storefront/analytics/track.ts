/**
 * Capa de analítica SIN proveedor (hasta tener IDs y consentimiento, S15): la tienda llama a `track(...)` y no pasa
 * nada hasta que alguien se suscriba. Así las pantallas ya emiten sus eventos y conectar Meta/GA4 después es añadir un
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
  | { name: "view_cart"; items: number; value: number; currency: string };

export type TrackListener = (event: TrackEvent) => void;

const listeners = new Set<TrackListener>();

/** Registra un proveedor. Devuelve la función para darlo de baja. */
export function subscribeToTracking(listener: TrackListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Emite un evento a todos los proveedores; el fallo de uno no afecta a los demás ni a la pantalla. */
export function track(event: TrackEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // un proveedor roto jamás debe romper la navegación
    }
  }
}
