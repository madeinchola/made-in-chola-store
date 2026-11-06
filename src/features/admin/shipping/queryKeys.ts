import { adminKeys } from "../queryKeys";

/** Claves de caché del panel de Envíos. Cuelgan de ["admin", "shipping"]. */
export const shippingKeys = {
  all: [...adminKeys.all, "shipping"] as const,
  locations: () => [...shippingKeys.all, "locations"] as const,
  methods: () => [...shippingKeys.all, "methods"] as const,
  zones: () => [...shippingKeys.all, "zones"] as const,
  rates: () => [...shippingKeys.all, "rates"] as const,
  slots: () => [...shippingKeys.all, "slots"] as const,
  blockedDates: () => [...shippingKeys.all, "blocked-dates"] as const,
};
