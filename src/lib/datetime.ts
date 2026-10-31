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

/** Bolivia no usa horario de verano: La Paz es UTC−4 todo el año. */
const LA_PAZ_OFFSET = "-04:00";
const LOCAL_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * Instante (ISO/UTC) → valor de `<input type="datetime-local">` en hora de La Paz ("2026-10-29T22:00").
 * Devuelve "" si no hay fecha o no es válida.
 */
export function toLaPazInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // El locale sueco da "AAAA-MM-DD HH:mm", justo el formato que necesita el input.
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(date)
    .replace(" ", "T");
}

/**
 * Valor de `<input type="datetime-local">` interpretado en hora de La Paz → ISO UTC para guardar.
 * "" → null (sin fecha). Un valor mal formado lanza RangeError (no se adivina).
 */
export function fromLaPazInputValue(local: string): string | null {
  if (local === "") return null;
  if (!LOCAL_INPUT.test(local)) throw new RangeError(`Fecha inválida: ${local}`);
  const date = new Date(`${local}:00${LA_PAZ_OFFSET}`);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Fecha inválida: ${local}`);
  return date.toISOString();
}
