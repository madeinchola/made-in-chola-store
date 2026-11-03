/** Claves de caché del perfil. Cuelgan de ["account"]: al desactivar la cuenta se borra toda la rama de una vez. */
export const profileKeys = {
  all: ["account", "profile"] as const,
  preferences: (userId: string) => [...profileKeys.all, "preferences", userId] as const,
  currencies: () => [...profileKeys.all, "currencies"] as const,
};
