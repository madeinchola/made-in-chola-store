import type { TaxDocType } from "./taxId";

/** Tope de datos fiscales ACTIVOS por cliente (lo aplica la base; se usa aquí para avisar antes de intentar). */
export const MAX_ACTIVE_TAX_PROFILES = 10;

/** Mismo tope que la restricción `tax_profiles_legal_name` de la base. */
export const LEGAL_NAME_MAX = 160;

export interface TaxProfile {
  id: string;
  docType: TaxDocType;
  /** Ya normalizado por la base: mayúsculas y sin espacios en los extremos. */
  docNumber: string;
  legalName: string;
  isDefault: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Lo que el formulario entrega ya validado y normalizado (`validateTaxId`). */
export interface TaxProfileInput {
  docType: TaxDocType;
  docNumber: string;
  legalName: string;
}
