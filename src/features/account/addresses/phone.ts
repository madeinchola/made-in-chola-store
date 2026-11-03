import { maskPhone } from "@/lib/phoneMask";
import { DEFAULT_PHONE_COUNTRY, DIAL_CODES } from "@shared/identity";

// Prefijo más largo primero (595 antes que otro de 2 dígitos; «1» al final).
const DIALS = Object.entries(DIAL_CODES).sort((a, b) => b[1].length - a[1].length);

export interface SplitPhone {
  /** País cuyo prefijo tiene el número (por defecto Bolivia si no se reconoce). */
  country: string;
  /** Parte nacional con la máscara del formulario (`7123 4567`), o el número internacional completo si no se pudo separar. */
  national: string;
}

/**
 * Separa un teléfono E.164 en país + número nacional para el formulario (el prefijo va en el selector). Si el prefijo no
 * es de un país conocido —o la parte nacional empezara en 0, que `normalizePhone` interpretaría como «prefijo troncal» y
 * cambiaría el número al guardar— se deja el número internacional completo (`+…`), que el formulario también acepta.
 */
export function splitPhone(e164: string): SplitPhone {
  const digits = e164.replace(/^\+/, "");
  for (const [country, dial] of DIALS) {
    if (!digits.startsWith(dial)) continue;
    const national = digits.slice(dial.length);
    if (national === "" || national.startsWith("0")) break;
    return { country, national: maskPhone(national) };
  }
  return { country: DEFAULT_PHONE_COUNTRY, national: e164 };
}

/** Para mostrar en la tarjeta: `+591 7123 4567`. */
export function formatPhoneDisplay(e164: string): string {
  const digits = e164.replace(/^\+/, "");
  for (const [, dial] of DIALS) {
    if (!digits.startsWith(dial)) continue;
    const national = digits.slice(dial.length);
    if (national === "") break;
    return `+${dial} ${maskPhone(national)}`;
  }
  return e164;
}
