/** Claves de caché de los datos fiscales. Cuelgan de ["account"] (se borran al desactivar la cuenta). */
export const taxKeys = {
  all: ["account", "tax"] as const,
  list: (userId: string) => [...taxKeys.all, "list", userId] as const,
};
