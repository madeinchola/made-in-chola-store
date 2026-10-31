/**
 * Máscara de teléfono mientras se escribe: dígitos en bloques de 4 separados por un espacio (`7123 4567`).
 * Es solo presentación: `normalizePhone` (compartido con el servidor) acepta el número con o sin espacios, así que el
 * valor enmascarado se envía tal cual.
 *
 * No toca los números en formato internacional (`+591…` o `00…`): ahí la persona decide el formato y solo se quitan
 * los caracteres que nunca pueden formar parte de un teléfono. Máximo 15 dígitos (el límite de E.164).
 */
const MAX_DIGITS = 15;
const INTERNATIONAL = /^\s*(\+|00)/;

export function maskPhone(input: string): string {
  if (INTERNATIONAL.test(input)) {
    return input.replace(/[^\d+\s\-().]/g, "").slice(0, 32);
  }
  const digits = input.replace(/\D/g, "").slice(0, MAX_DIGITS);
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

const digitCount = (text: string) => text.replace(/\D/g, "").length;

/** Posición dentro de `masked` justo después de `digits` dígitos (para no mover el cursor al reformatear). */
export function caretAfterDigits(masked: string, digits: number): number {
  if (digits <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < masked.length; i++) {
    if (/\d/.test(masked[i]!)) seen++;
    if (seen === digits) return i + 1;
  }
  return masked.length;
}

/** Último valor (ya enmascarado) de cada campo: permite saber si una edición de borrado quitó solo un separador. */
const lastValue = new WeakMap<HTMLInputElement, string>();

/**
 * Si el borrado (Supr / Retroceso) quitó SOLO el espacio del formato, la máscara lo repondría y la persona se quedaría
 * atascada (el cursor no avanza y el dígito no se borra nunca). En ese caso se borra además el dígito contiguo.
 * Devuelve el valor corregido y la posición del cursor, o `null` si no hay nada que corregir.
 */
function deleteAcrossSeparator(
  previous: string,
  value: string,
  caret: number,
  inputType: string,
): { value: string; caret: number } | null {
  const onlySeparatorRemoved =
    value.length < previous.length && digitCount(value) === digitCount(previous);
  if (!onlySeparatorRemoved) return null;
  if (inputType === "deleteContentForward") {
    const offset = value.slice(caret).search(/\d/);
    if (offset < 0) return null;
    const at = caret + offset;
    return { value: value.slice(0, at) + value.slice(at + 1), caret };
  }
  if (inputType === "deleteContentBackward") {
    const head = value.slice(0, caret);
    const at = head.search(/\d(?=\D*$)/);
    if (at < 0) return null;
    return { value: value.slice(0, at) + value.slice(at + 1), caret: at };
  }
  return null;
}

/**
 * Aplica la máscara al campo en vivo conservando el cursor (si se edita en medio del número, el cursor sigue ahí en
 * lugar de saltar al final). `inputType` es el del evento `input` (`deleteContentForward`, `deleteContentBackward`…).
 * Devuelve el valor enmascarado.
 */
export function applyPhoneMask(field: HTMLInputElement, inputType = ""): string {
  let value = field.value;
  let caret = field.selectionStart ?? value.length;
  const previous = lastValue.get(field);
  if (previous !== undefined && inputType.startsWith("delete")) {
    const fixed = deleteAcrossSeparator(previous, value, caret, inputType);
    if (fixed) ({ value, caret } = fixed);
  }
  const digitsBeforeCaret = digitCount(value.slice(0, caret));
  const masked = maskPhone(value);
  if (masked !== field.value) {
    field.value = masked;
    const position = INTERNATIONAL.test(masked)
      ? Math.min(caret, masked.length)
      : caretAfterDigits(masked, digitsBeforeCaret);
    field.setSelectionRange(position, position);
  }
  lastValue.set(field, masked);
  return masked;
}
