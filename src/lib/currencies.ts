export interface Currency {
  code: string;
  symbol: string;
  /** Decimales ISO 4217: define cuántas unidades menores hay por unidad (10^decimals). */
  decimals: number;
  name: string;
}

// Fuente única de monedas. Bolivia (BOB) es la moneda base; el resto queda listo para S18.
export const CURRENCIES: readonly Currency[] = [
  { code: "BOB", symbol: "Bs", decimals: 2, name: "Boliviano" },
  { code: "USD", symbol: "$", decimals: 2, name: "Dólar estadounidense" },
  { code: "EUR", symbol: "€", decimals: 2, name: "Euro" },
  { code: "ARS", symbol: "AR$", decimals: 2, name: "Peso argentino" },
  { code: "PEN", symbol: "S/", decimals: 2, name: "Sol peruano" },
  { code: "CLP", symbol: "CLP$", decimals: 0, name: "Peso chileno" },
  { code: "COP", symbol: "COP$", decimals: 2, name: "Peso colombiano" },
  { code: "MXN", symbol: "MX$", decimals: 2, name: "Peso mexicano" },
  { code: "BRL", symbol: "R$", decimals: 2, name: "Real brasileño" },
  { code: "GBP", symbol: "£", decimals: 2, name: "Libra esterlina" },
  { code: "PYG", symbol: "₲", decimals: 0, name: "Guaraní" },
  { code: "UYU", symbol: "$U", decimals: 2, name: "Peso uruguayo" },
];

export const BASE_CURRENCY = "BOB";

const CURRENCY_MAP: ReadonlyMap<string, Currency> = new Map(CURRENCIES.map((c) => [c.code, c]));

export function isSupportedCurrency(code: string): boolean {
  return CURRENCY_MAP.has(code);
}

/** Lanza si la moneda no está soportada: nunca se asume un símbolo o decimales por defecto. */
export function getCurrency(code: string): Currency {
  const currency = CURRENCY_MAP.get(code);
  if (!currency) throw new RangeError(`Moneda no soportada: "${code}"`);
  return currency;
}
