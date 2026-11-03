/** Claves de caché de la libreta de direcciones. Siempre llevan el id del cliente: nunca se mezclan cuentas. */
export const addressKeys = {
  all: ["account", "addresses"] as const,
  active: (profileId: string) => [...addressKeys.all, "active", profileId] as const,
  archived: (profileId: string) => [...addressKeys.all, "archived", profileId] as const,
  countries: () => ["account", "delivery-countries"] as const,
};
