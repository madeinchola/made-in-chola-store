import {
  validatePassword,
  type PasswordContext,
  type PasswordFailure,
} from "@shared/password-policy";

export type StrengthLevel = "empty" | "weak" | "fair" | "good" | "strong";

export interface StrengthResult {
  level: StrengthLevel;
  /** Segmentos del medidor que se pintan: vacío 0 · débil 1 · aceptable 2 · buena 3 · fuerte 4. */
  segments: 0 | 1 | 2 | 3 | 4;
  /** Reglas de la política (`validatePassword`) que la contraseña incumple. */
  failures: PasswordFailure[];
  /** Puntos de longitud + variedad (0 si no cumple la política). Solo se usa para decidir el nivel. */
  points: number;
  /** Cumple la política pero es predecible (secuencias o repeticiones): se explica con un aviso aparte. */
  predictable: boolean;
}

/** Por debajo de esto (caracteres efectivos) una contraseña que cumple la política se considera débil. */
export const MIN_EFFECTIVE = 6;

/**
 * Cuántos caracteres de la contraseña NO son predecibles. Se descuentan:
 *  · los que continúan una secuencia de pasos iguales de ±1 (`abcdef`, `12345`, `zyxw`): cada carácter desde el tercero de
 *    la secuencia es adivinable;
 *  · los que se pueden obtener repitiendo un bloque (`AbAbAb…`, `Passw0rdPassw0rd…`, `aaaa…`): de una repetición con período
 *    `p` solo cuentan los `p` primeros caracteres y los que no coinciden con el bloque.
 * Se queda con el MENOR de los dos resultados (se toma la peor señal, no se suman: sería descontar dos veces lo mismo).
 */
export function effectiveLength(password: string): number {
  const chars = Array.from(password.toLowerCase());
  const n = chars.length;
  if (n <= 2) return n;
  const codes = chars.map((c) => c.codePointAt(0) ?? 0);

  let sequential = 0;
  for (let i = 2; i < n; i += 1) {
    const step = codes[i]! - codes[i - 1]!;
    if (Math.abs(step) === 1 && step === codes[i - 1]! - codes[i - 2]!) sequential += 1;
  }

  let repeated = 0;
  for (let period = 1; period <= Math.floor(n / 2); period += 1) {
    let matches = 0;
    for (let i = period; i < n; i += 1) if (codes[i] === codes[i - period]) matches += 1;
    // Una repetición «de verdad»: casi todo lo que sigue al primer bloque lo copia (se toleran pocos desajustes).
    if (matches >= (n - period) * 0.8 && matches > 0) repeated = Math.max(repeated, matches);
  }

  return n - Math.max(sequential, repeated);
}

/**
 * Puntuación de fortaleza. Es una heurística SENCILLA pensada para orientar a la persona, no una estimación de
 * entropía: la barrera real es la política compartida (`validatePassword`) y, en el servidor, el control contra
 * filtraciones públicas (HIBP), que desde aquí no se puede saber.
 *
 *  1. Vacía → `empty`.
 *  2. Si incumple CUALQUIER regla de la política (corta, común, repetitiva, secuencial, contiene el email/teléfono,
 *     demasiado larga) → `weak`, pase lo que pase con los puntos.
 *  3. Si la cumple se mide su longitud EFECTIVA (`effectiveLength`: sin contar lo que es una secuencia `abcdef`/`12345`
 *     ni lo que se obtiene repitiendo un bloque `AbAbAb…`). Con menos de 6 caracteres efectivos → `weak` (la política solo
 *     mira la longitud bruta: `Abcdefghijklmnopqrst1` y `Aaaaaaaaaaaaaaaaaaaa1` pasan, pero valen casi nada). Si no,
 *     puntos = longitud efectiva + variedad:
 *       longitud (caracteres): 8–11 → 1 · 12–15 → 2 · 16–19 → 3 · 20 o más → 4
 *       variedad (clases presentes: minúscula, mayúscula, dígito, otro): 1 clase → 0 · 2 clases → 1 · 3 o más → 2
 *  4. Nivel: 1–3 puntos → `fair` · 4–5 → `good` · 6 → `strong` (hace falta 20+ caracteres Y 3+ clases).
 *
 * Ejemplos calculados a mano (todos cumplen la política): `Perro123` → 8 car. (1) + 3 clases (2) = 3 → fair ·
 * `MiGatitoBlanco27` → 16 car. (3) + 3 clases (2) = 5 → good · `Mi-Gatito-Blanco-Rojo-27` → 24 car. (4) + 4 clases (2) =
 * 6 → strong · `correcaballobateria` → 19 car. (3) + 1 clase (0) = 3 → fair.
 */
export function assessPassword(password: string, context: PasswordContext = {}): StrengthResult {
  if (password === "")
    return { level: "empty", segments: 0, failures: [], points: 0, predictable: false };

  const policy = validatePassword(password, context);
  if (!policy.ok) {
    return { level: "weak", segments: 1, failures: policy.failures, points: 0, predictable: false };
  }

  const length = Array.from(password).length;
  // Cumple la política (8 o más caracteres), pero si la mayor parte es una secuencia o una repetición vale muy poco.
  const effective = effectiveLength(password);
  if (effective < MIN_EFFECTIVE) {
    return { level: "weak", segments: 1, failures: [], points: 0, predictable: true };
  }
  const lengthPoints = effective >= 20 ? 4 : effective >= 16 ? 3 : effective >= 12 ? 2 : 1;

  const classes = [
    /\p{Ll}/u.test(password),
    /\p{Lu}/u.test(password),
    /\p{Nd}/u.test(password),
    /[^\p{Ll}\p{Lu}\p{Nd}]/u.test(password), // símbolos, espacios y letras sin mayúscula/minúscula (p. ej. 日本語)
  ].filter(Boolean).length;
  const varietyPoints = classes >= 3 ? 2 : classes === 2 ? 1 : 0;

  const points = lengthPoints + varietyPoints;
  const predictable = effective < length;
  if (points >= 6) return { level: "strong", segments: 4, failures: [], points, predictable };
  if (points >= 4) return { level: "good", segments: 3, failures: [], points, predictable };
  return { level: "fair", segments: 2, failures: [], points, predictable };
}
