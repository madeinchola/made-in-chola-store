/** La BD guarda todo en UTC; solo se convierte a hora de La Paz para mostrar. */
export const DISPLAY_TIMEZONE = "America/La_Paz";

export function formatDateTime(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Fecha inválida: ${String(value)}`);
  return new Intl.DateTimeFormat("es-BO", {
    timeZone: DISPLAY_TIMEZONE,
    dateStyle: "short",
    timeStyle: "short",
    hourCycle: "h23",
    ...options,
  }).format(date);
}
