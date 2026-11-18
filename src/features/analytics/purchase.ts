import { readConsent } from "@/features/consent/consentStore";
import { recordOrderAttribution, sendMetaPurchase } from "./attribution";
import { purchaseEventId } from "./mapping";

/**
 * `purchase` debe contarse UNA sola vez por pedido: reintentar el pago con la misma llave (resultado «existing»), recargar o volver
 * atrás no lo repite. Se recuerda por pestaña (`sessionStorage`; sin él, en memoria): solo guarda números de pedido, nada personal.
 * Además, Meta y GA4 deduplican por `event_id` y `transaction_id`.
 */
const KEY = "mic_purchases_tracked";
const memory = new Set<string>();

/** `true` la PRIMERA vez que se pregunta por ese pedido; `false` si ya se contó. */
export function markPurchaseTracked(orderNumber: string): boolean {
  if (memory.has(orderNumber)) return false;
  memory.add(orderNumber);
  try {
    const list = JSON.parse(window.sessionStorage.getItem(KEY) ?? "[]") as unknown;
    const seen = Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
    if (seen.includes(orderNumber)) return false;
    window.sessionStorage.setItem(KEY, JSON.stringify([...seen, orderNumber].slice(-50)));
  } catch {
    /* sin almacenamiento: vale la memoria de esta pestaña */
  }
  return true;
}

/** Solo para pruebas. */
export function resetPurchasesForTests(): void {
  memory.clear();
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nada */
  }
}

/**
 * Lo que sigue a un pedido recién CREADO, según lo que la persona aceptó: anotar de dónde llegó (analítica) y avisar a Meta desde el
 * servidor con los datos reales del pedido (marketing, y solo si hay Pixel). Mejor esfuerzo: nada de esto puede afectar a la compra.
 */
export function afterOrderCreated(
  orderNumber: string,
  options: { token: string | null; metaPixelId: string | null },
): void {
  const consent = readConsent();
  if (consent?.analytics) void recordOrderAttribution(orderNumber).catch(() => undefined);
  if (consent?.marketing && options.metaPixelId && options.token)
    void sendMetaPurchase(orderNumber, purchaseEventId(orderNumber), options.token).catch(
      () => undefined,
    );
}
