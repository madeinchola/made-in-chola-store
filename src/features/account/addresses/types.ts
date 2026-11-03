/** Una dirección de la libreta del cliente (tabla `addresses`), con nombres de la aplicación. */
export interface Address {
  id: string;
  profileId: string;
  label: string;
  recipient: string;
  /** Teléfono de contacto en E.164 (la base exige uno en toda dirección activa). */
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  department: string | null;
  /** ISO 3166-1 alfa-2. */
  country: string;
  referenceText: string | null;
  /** El pin es todo o nada: ambos null o ambos con valor. */
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
  forShipping: boolean;
  forBilling: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lo que el cliente escribe al crear o editar (ya validado y normalizado por `toAddressInput`). */
export interface AddressInput {
  label: string;
  recipient: string;
  phoneE164: string;
  line1: string;
  line2: string | null;
  city: string;
  department: string | null;
  country: string;
  referenceText: string | null;
  lat: number | null;
  lng: number | null;
  forShipping: boolean;
  forBilling: boolean;
  /** `true` = quiere que sea la predeterminada. `false` nunca desmarca la actual (la base la mantiene sola). */
  isDefault: boolean;
}

/** País habilitado para entregas (vista `public_countries`). */
export interface DeliveryCountry {
  code: string;
  name: string;
}

/** Tope de direcciones ACTIVAS por cliente (lo impone un trigger de la base; la interfaz lo refleja antes de fallar). */
export const MAX_ACTIVE_ADDRESSES = 20;

/** Cuántas archivadas se traen (nada se borra: la lista podría crecer sin límite). */
export const ARCHIVED_PAGE_SIZE = 100;
