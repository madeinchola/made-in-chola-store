import { adminKeys } from "../queryKeys";

/** Claves de caché de Ajustes, banners y Monedas. Cuelgan de ["admin", "config"]. */
export const configKeys = {
  all: [...adminKeys.all, "config"] as const,
  settings: () => [...configKeys.all, "settings"] as const,
  banners: () => [...configKeys.all, "banners"] as const,
  currencies: () => [...configKeys.all, "currencies"] as const,
  countries: () => [...configKeys.all, "countries"] as const,
  currentRates: (codes: readonly string[]) =>
    [...configKeys.all, "current-rates", [...codes].sort()] as const,
  rateHistory: (page: number, pageSize: number) =>
    [...configKeys.all, "rate-history", page, pageSize] as const,
  impact: (currency: string) => [...configKeys.all, "impact", currency] as const,
};
