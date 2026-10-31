/**
 * Rutas de la tienda que usan los layouts. Una sola fuente para que Header, menús y pie no escriban rutas a mano.
 * `PENDING_ROUTES` son las que AÚN no existen en el router (las crea S5–S7; `carrito` ya apunta a una pantalla provisional hasta S7): hay un test que vigila que esta lista
 * sea honesta, para acordarse de quitarlas de aquí cuando se creen.
 */
export const storeRoutes = {
  home: "/",
  login: "/login",
  register: "/registro",
  account: "/cuenta",
  admin: "/admin",
  cart: "/carrito",
  about: "/nosotros",
  contact: "/contacto",
  privacy: "/legal/privacidad",
  refunds: "/legal/reembolsos",
  shipping: "/legal/envios",
  terms: "/legal/terminos",
  /** Página de resultados de búsqueda. null = todavía no existe (el buscador muestra «próximamente»). */
  search: null as string | null,
  category: (slug: string) => `/categoria/${encodeURIComponent(slug)}`,
} as const;

/** Claves de `storeRoutes` cuya ruta aún no existe en el router. */
export const PENDING_ROUTES: readonly (keyof typeof storeRoutes)[] = ["search"];
