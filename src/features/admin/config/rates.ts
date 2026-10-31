/**
 * Tipos de cambio: validación estricta, tasa vigente, conversión de la vista previa y cuándo pedir confirmación.
 * Todo con aritmética decimal EXACTA (BigInt sobre texto): nunca floats. Reproduce las reglas de la base:
 *  - `exchange_rates.rate` es `numeric(18,8)` y `> 0` (hasta 10 enteros y 8 decimales).
 *  - `current_rate`: de la pareja (origen, destino) con `valid_from <= ahora`, la de `valid_from` más reciente (desempata `id`).
 *  - `price_for`: `round(precio_BOB × tasa, decimales_de_la_moneda)`; `round` de numeric aleja las mitades de cero.
 */
export type RateProblem = "empty" | "format" | "decimals" | "not_positive" | "too_large";
export type RateResult = { ok: true; value: string } | { ok: false; problem: RateProblem };

const RATE_RE = /^(\d+)(?:[.,](\d+))?$/;
export const RATE_MAX_INT_DIGITS = 10;
export const RATE_MAX_DECIMALS = 8;

/** Valida el texto de una tasa y lo normaliza ("0,145" → "0.145", "007.5" → "7.5"). */
export function parseRate(raw: string): RateResult {
  const text = raw.trim();
  if (text === "") return { ok: false, problem: "empty" };
  const m = RATE_RE.exec(text);
  if (!m) return { ok: false, problem: "format" };
  const int = (m[1] ?? "0").replace(/^0+(?=\d)/, "");
  const frac = m[2] ?? "";
  if (frac.length > RATE_MAX_DECIMALS) return { ok: false, problem: "decimals" };
  if (int.length > RATE_MAX_INT_DIGITS) return { ok: false, problem: "too_large" };
  if (/^0*$/.test(int) && /^0*$/.test(frac)) return { ok: false, problem: "not_positive" };
  return { ok: true, value: frac === "" ? int : `${int}.${frac}` };
}

interface Scaled {
  num: bigint;
  scale: number;
}

/** Decimal positivo ("12.50") → entero escalado (1250n, escala 2). */
function scaled(value: string): Scaled {
  const [int = "0", frac = ""] = value.split(".");
  return { num: BigInt(int + frac), scale: frac.length };
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);

/**
 * `round(base × rate, decimals)` como lo hace Postgres con numeric: mitades alejándose de cero. Devuelve un decimal con
 * exactamente `decimals` decimales ("18.20"). Solo valores positivos (precios y tasas lo son).
 */
export function convertAmount(base: string, rate: string, decimals: number): string {
  const a = scaled(base);
  const r = scaled(rate);
  const num = a.num * r.num;
  const scale = a.scale + r.scale;
  let units: bigint; // resultado en la unidad menor (10^-decimals)
  if (scale <= decimals) {
    units = num * pow10(decimals - scale);
  } else {
    const divisor = pow10(scale - decimals);
    units = (num + divisor / 2n) / divisor; // mitad hacia arriba = alejarse de cero (positivos)
  }
  const digits = units.toString().padStart(decimals + 1, "0");
  const intPart = digits.slice(0, digits.length - decimals);
  return decimals === 0 ? intPart : `${intPart}.${digits.slice(digits.length - decimals)}`;
}

export interface RateRow {
  id: number;
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  mode: "fixed" | "variable";
  validFrom: string;
}

/** La tasa vigente para (origen → destino) en `now`; null si todavía no hay ninguna vigente. */
export function currentRate(
  rows: readonly RateRow[],
  from: string,
  to: string,
  now: Date,
): RateRow | null {
  const effective = rows.filter(
    (r) =>
      r.fromCurrency === from &&
      r.toCurrency === to &&
      new Date(r.validFrom).getTime() <= now.getTime(),
  );
  effective.sort((a, b) => {
    const dt = new Date(b.validFrom).getTime() - new Date(a.validFrom).getTime();
    return dt !== 0 ? dt : b.id - a.id;
  });
  return effective[0] ?? null;
}

export type ConfirmReason = "big_change" | "far_date";
export const BIG_CHANGE_PERCENT = 25;
export const FAR_DATE_DAYS = 7;
const DAY_MS = 86_400_000;

/** |nuevo − anterior| / anterior, en puntos porcentuales exactos como fracción comparable. */
function exceedsPercent(previous: string, next: string, percent: number): boolean {
  const p = scaled(previous);
  const n = scaled(next);
  const scale = Math.max(p.scale, n.scale);
  const pv = p.num * pow10(scale - p.scale);
  const nv = n.num * pow10(scale - n.scale);
  const diff = nv > pv ? nv - pv : pv - nv;
  return diff * 100n > BigInt(percent) * pv;
}

/** Variación porcentual con un decimal ("+12.5", "-30.0"), solo para mostrar. */
export function changePercentLabel(previous: string, next: string): string {
  const p = scaled(previous);
  const n = scaled(next);
  const scale = Math.max(p.scale, n.scale);
  const pv = p.num * pow10(scale - p.scale);
  const nv = n.num * pow10(scale - n.scale);
  const negative = nv < pv;
  const diff = negative ? pv - nv : nv - pv;
  const tenths = (diff * 1000n + pv / 2n) / pv; // décimas de punto porcentual, redondeo medio hacia arriba
  const whole = tenths / 10n;
  const decimal = tenths % 10n;
  return `${negative ? "-" : "+"}${whole}.${decimal}`;
}

/**
 * ¿Hay que pedir confirmación antes de guardar? El libro de tasas es INMUTABLE: un error de tipeo no se corrige, solo se
 * supera con otra fila. Se confirma si la tasa nueva difiere MÁS de 25 % de la vigente, o si la fecha de vigencia queda a
 * MÁS de 7 días de ahora (pasado o futuro). Exactamente 25 % o exactamente 7 días no piden confirmación.
 */
export function confirmationReasons(input: {
  previousRate: string | null;
  nextRate: string;
  /** ISO UTC; null = ahora. */
  validFrom: string | null;
  now: Date;
}): ConfirmReason[] {
  const reasons: ConfirmReason[] = [];
  if (
    input.previousRate !== null &&
    exceedsPercent(input.previousRate, input.nextRate, BIG_CHANGE_PERCENT)
  ) {
    reasons.push("big_change");
  }
  if (input.validFrom !== null) {
    const offset = Math.abs(new Date(input.validFrom).getTime() - input.now.getTime());
    if (offset > FAR_DATE_DAYS * DAY_MS) reasons.push("far_date");
  }
  return reasons;
}
