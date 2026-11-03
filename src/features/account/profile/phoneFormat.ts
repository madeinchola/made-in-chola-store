import { maskPhone } from "@/lib/phoneMask";

/** Celular boliviano en E.164: `+591` y 8 dígitos que empiezan en 6 o 7 (misma regla que `normalizePhone`). */
const BOLIVIA_MOBILE = /^\+591([67]\d{7})$/;

/**
 * Teléfono para MOSTRAR: `+59171234567` → `+591 7123 4567` (el mismo agrupado de 4 en 4 que la máscara del formulario).
 * Solo se da formato a los celulares de Bolivia, el mercado de la tienda; cualquier otro número se muestra tal cual,
 * porque agruparlo «a ciegas» por países que no conocemos lo dejaría ilegible.
 */
export function formatPhoneDisplay(e164: string): string {
  const match = BOLIVIA_MOBILE.exec(e164);
  return match?.[1] ? `+591 ${maskPhone(match[1])}` : e164;
}
