import type { SettingType } from "./settingsSchema";
import type { RateRow } from "./rates";

export interface SettingRow {
  key: string;
  /** Valor jsonb tal como está en la base (texto o número). */
  value: unknown;
  valueType: SettingType;
  isPublic: boolean;
  description: string | null;
  /** Versión de la fila: se devuelve tal cual al guardar (control de edición concurrente). */
  updatedAt: string;
}

export interface Banner {
  id: string;
  message: string;
  linkUrl: string | null;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CurrencyRow {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  enabled: boolean;
  updatedAt: string;
}

export interface CountryRow {
  code: string;
  name: string;
  currencyCode: string;
  enabled: boolean;
}

export interface RateHistoryRow extends RateRow {
  createdAt: string;
}

export interface RateHistoryPage {
  rows: RateHistoryRow[];
  total: number;
}

export interface ImpactProduct {
  id: string;
  code: string;
  name: string;
  /** Precio general en BOB (texto decimal). */
  priceBob: string;
}

export interface ImpactCandidates {
  /** Hasta 10, por nombre. */
  products: ImpactProduct[];
  /** Cuántos productos se verían afectados (entre los primeros 100 candidatos). */
  total: number;
  /** Había más de 100 candidatos: `total` es un mínimo. */
  truncated: boolean;
}
