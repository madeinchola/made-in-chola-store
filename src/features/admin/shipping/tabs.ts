import type { MessageKey } from "@/i18n";

export interface ShippingTab {
  to: string;
  label: MessageKey;
  end?: boolean;
}

/** Secciones del panel de Envíos (cada una es una ruta). */
export const SHIPPING_TABS: readonly ShippingTab[] = [
  { to: "/admin/envios", label: "admin.shipping.tabs.store", end: true },
  { to: "/admin/envios/zonas", label: "admin.shipping.tabs.zones" },
  { to: "/admin/envios/tarifas", label: "admin.shipping.tabs.rates" },
  { to: "/admin/envios/entregas", label: "admin.shipping.tabs.delivery" },
  { to: "/admin/envios/simulador", label: "admin.shipping.tabs.simulator" },
];
