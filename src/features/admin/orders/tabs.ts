import type { MessageKey } from "@/i18n";

export interface OrdersTab {
  to: string;
  label: MessageKey;
  end?: boolean;
}

/** Secciones del panel de Pedidos (cada una es una ruta). El detalle y el pedido manual son pantallas aparte. */
export const ORDERS_TABS: readonly OrdersTab[] = [
  { to: "/admin/pedidos", label: "admin.orders.tabs.list", end: true },
  { to: "/admin/pedidos/atencion", label: "admin.orders.tabs.attention" },
  { to: "/admin/pedidos/incidencias", label: "admin.orders.tabs.incidents" },
  { to: "/admin/pedidos/lista-negra", label: "admin.orders.tabs.blacklist" },
];
