export interface Country {
  /** ISO 3166-1 alpha-2 */
  code: string;
  name: string;
  currency: string;
  /** Prefijo telefónico con "+" */
  dial: string;
  flag: string;
}

export const COUNTRIES: readonly Country[] = [
  { code: "BO", name: "Bolivia", currency: "BOB", dial: "+591", flag: "🇧🇴" },
  { code: "AR", name: "Argentina", currency: "ARS", dial: "+54", flag: "🇦🇷" },
  { code: "ES", name: "España", currency: "EUR", dial: "+34", flag: "🇪🇸" },
  { code: "US", name: "Estados Unidos", currency: "USD", dial: "+1", flag: "🇺🇸" },
  { code: "PE", name: "Perú", currency: "PEN", dial: "+51", flag: "🇵🇪" },
  { code: "CL", name: "Chile", currency: "CLP", dial: "+56", flag: "🇨🇱" },
  { code: "CO", name: "Colombia", currency: "COP", dial: "+57", flag: "🇨🇴" },
  { code: "MX", name: "México", currency: "MXN", dial: "+52", flag: "🇲🇽" },
  { code: "BR", name: "Brasil", currency: "BRL", dial: "+55", flag: "🇧🇷" },
  { code: "PY", name: "Paraguay", currency: "PYG", dial: "+595", flag: "🇵🇾" },
  { code: "UY", name: "Uruguay", currency: "UYU", dial: "+598", flag: "🇺🇾" },
  { code: "GB", name: "Reino Unido", currency: "GBP", dial: "+44", flag: "🇬🇧" },
];

export const DEFAULT_COUNTRY = "BO";

export function getCountry(code: string): Country {
  const country = COUNTRIES.find((c) => c.code === code);
  if (!country) throw new RangeError(`País no soportado: "${code}"`);
  return country;
}
