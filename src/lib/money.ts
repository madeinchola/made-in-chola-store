import { getCurrency } from "./currencies";

/**
 * Dinero exacto. `amount` es un ENTERO en la unidad menor de la moneda
 * (centavos para BOB/USD/EUR/ARS; unidades enteras para CLP/PYG). Nunca se opera con floats.
 */
export interface Money {
  readonly amount: number;
  readonly currency: string;
}

export type FormatLocale = "es" | "en";

const SEPARATORS: Record<FormatLocale, { group: string; decimal: string }> = {
  es: { group: ".", decimal: "," },
  en: { group: ",", decimal: "." },
};

function assertSafe(amount: number): number {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`Monto fuera de rango seguro o no entero: ${amount}`);
  }
  // Normaliza -0 a 0 para que equals/serialización sean estables.
  return amount === 0 ? 0 : amount;
}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** Divide a/b (b>0) redondeando mitades en contra de cero. */
function divRoundHalfAway(a: bigint, b: bigint): bigint {
  const negative = a < 0n;
  const abs = negative ? -a : a;
  const q = abs / b;
  const r = abs % b;
  const rounded = r * 2n >= b ? q + 1n : q;
  return negative ? -rounded : rounded;
}

function toSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError("Monto fuera de rango seguro");
  }
  return Number(value);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new TypeError(`Monedas distintas: ${a.currency} vs ${b.currency}`);
  }
}

const DECIMAL_RE = /^([+-])?(\d+)(?:\.(\d+))?$/;

function numberToDecimalString(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`Número no finito: ${n}`);
  const s = String(n);
  if (!/e/i.test(s)) return s;
  const fixed = n.toFixed(20);
  if (/e/i.test(fixed)) throw new RangeError(`Número demasiado grande: ${n}`);
  return fixed;
}

/** Parsea un decimal exacto como (numerador, escala): "6.96" → (696n, 2). */
function parseDecimal(value: string): { num: bigint; scale: number } {
  const m = DECIMAL_RE.exec(value.trim());
  if (!m) throw new SyntaxError(`Decimal inválido: "${value}"`);
  const [, sign, int = "0", frac = ""] = m;
  const num = BigInt(int + frac);
  return { num: sign === "-" ? -num : num, scale: frac.length };
}

export function money(amount: number, currency: string): Money {
  getCurrency(currency);
  return { amount: assertSafe(amount), currency };
}

export function zero(currency: string): Money {
  return money(0, currency);
}

/**
 * Crea dinero desde un decimal en unidades mayores ("12.5" → 1250 centavos).
 * Prefiere strings. Si hay más decimales que los de la moneda, redondea mitades en contra de cero.
 */
export function fromDecimal(value: string | number, currency: string): Money {
  const { decimals } = getCurrency(currency);
  const { num, scale } = parseDecimal(
    typeof value === "number" ? numberToDecimalString(value) : value,
  );
  const minor =
    scale <= decimals
      ? num * pow10(decimals - scale)
      : divRoundHalfAway(num, pow10(scale - decimals));
  return money(toSafeNumber(minor), currency);
}

/** "1234.50" — decimal exacto sin separadores de miles, útil para BD/APIs. */
export function toDecimalString(m: Money): string {
  const { decimals } = getCurrency(m.currency);
  const abs = BigInt(Math.abs(m.amount));
  const digits = abs.toString().padStart(decimals + 1, "0");
  const int = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals);
  const sign = m.amount < 0 ? "-" : "";
  return decimals === 0 ? `${sign}${int}` : `${sign}${int}.${frac}`;
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function negate(m: Money): Money {
  return money(-m.amount, m.currency);
}

export function sum(items: readonly Money[], currency: string): Money {
  return items.reduce((acc, item) => add(acc, item), zero(currency));
}

/** Multiplica por una cantidad entera (unidades en el carrito). */
export function multiply(m: Money, quantity: number): Money {
  if (!Number.isInteger(quantity)) throw new RangeError(`Cantidad no entera: ${quantity}`);
  return money(m.amount * quantity, m.currency);
}

/** Multiplica por un decimal exacto (tipo de cambio, porcentaje) redondeando a la unidad menor. */
export function multiplyByRate(m: Money, rate: string): Money {
  const { num, scale } = parseDecimal(rate);
  return money(toSafeNumber(divRoundHalfAway(BigInt(m.amount) * num, pow10(scale))), m.currency);
}

/** Porcentaje: percentage(m, "15") = 15 % de m. */
export function percentage(m: Money, percent: string): Money {
  const { num, scale } = parseDecimal(percent);
  return money(
    toSafeNumber(divRoundHalfAway(BigInt(m.amount) * num, pow10(scale + 2))),
    m.currency,
  );
}

/**
 * Convierte entre monedas con un tipo de cambio decimal exacto (`rate` = unidades de `to` por 1 de origen).
 * Redondea a los decimales de la moneda destino.
 */
export function convert(m: Money, to: string, rate: string): Money {
  const from = getCurrency(m.currency);
  const target = getCurrency(to);
  const { num, scale } = parseDecimal(rate);
  // minor_to = minor_from * rate * 10^(dTo - dFrom)
  const shift = target.decimals - from.decimals;
  let numerator = BigInt(m.amount) * num;
  let denominator = pow10(scale);
  if (shift >= 0) numerator *= pow10(shift);
  else denominator *= pow10(-shift);
  return money(toSafeNumber(divRoundHalfAway(numerator, denominator)), to);
}

/**
 * Reparte `m` en partes proporcionales a `ratios` sin perder ni crear centavos
 * (método del mayor resto). La suma de las partes es siempre exactamente `m`.
 */
export function allocate(m: Money, ratios: readonly number[]): Money[] {
  if (ratios.length === 0) throw new RangeError("allocate requiere al menos una proporción");
  if (ratios.some((r) => !Number.isInteger(r) || r < 0)) {
    throw new RangeError("Las proporciones deben ser enteros no negativos");
  }
  const total = ratios.reduce((a, b) => a + b, 0);
  if (total === 0) throw new RangeError("La suma de proporciones no puede ser 0");
  const sign = m.amount < 0 ? -1 : 1;
  const abs = BigInt(Math.abs(m.amount));
  const totalBig = BigInt(total);
  const shares = ratios.map((r) => (abs * BigInt(r)) / totalBig);
  let remainder = abs - shares.reduce((a, b) => a + b, 0n);
  const order = ratios
    .map((r, i) => ({ i, rem: (abs * BigInt(r)) % totalBig }))
    .sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const { i } of order) {
    if (remainder === 0n) break;
    const current = shares[i] ?? 0n;
    shares[i] = current + 1n;
    remainder -= 1n;
  }
  return shares.map((s) => money(sign * toSafeNumber(s), m.currency));
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.amount === b.amount ? 0 : a.amount < b.amount ? -1 : 1;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

export function isZero(m: Money): boolean {
  return m.amount === 0;
}

/** "Bs 1.234,50" (es) · "Bs 1,234.50" (en). Exacto: no pasa por floats. */
export function formatMoney(m: Money, locale: FormatLocale = "es"): string {
  const { symbol } = getCurrency(m.currency);
  const { group, decimal } = SEPARATORS[locale];
  const [int = "0", frac] = toDecimalString({ ...m, amount: Math.abs(m.amount) }).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const body = frac === undefined ? grouped : `${grouped}${decimal}${frac}`;
  return `${m.amount < 0 ? "-" : ""}${symbol} ${body}`;
}
