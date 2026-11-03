/** Rutas de la cuenta del cliente (todas bajo `RequireAuth`). */
export const accountRoutes = {
  profile: "/cuenta",
  addresses: "/cuenta/direcciones",
  tax: "/cuenta/datos-fiscales",
  orders: "/cuenta/pedidos",
  security: "/cuenta/seguridad",
} as const;

/** Detalle de un pedido (la pantalla real llega con S10). */
export const orderDetailRoute = (orderId: string) =>
  `/cuenta/pedidos/${encodeURIComponent(orderId)}`;

export type AccountSection = keyof typeof accountRoutes;
