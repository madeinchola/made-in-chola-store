import type { MessageKey } from "@/i18n";

export interface DiscountsTab {
  to: string;
  label: MessageKey;
  end?: boolean;
}

/** Secciones del panel de Descuentos (cada una es una ruta). */
export const DISCOUNTS_TABS: readonly DiscountsTab[] = [
  { to: "/admin/descuentos", label: "admin.discounts.tabs.discounts", end: true },
  { to: "/admin/descuentos/redenciones", label: "admin.discounts.tabs.redemptions" },
  { to: "/admin/descuentos/grupos", label: "admin.discounts.tabs.groups" },
];
