import type { MessageKey } from "@/i18n";

export interface PaymentsTab {
  to: string;
  label: MessageKey;
  end?: boolean;
}

/** Secciones del panel de Pagos (cada una es una ruta). */
export const PAYMENTS_TABS: readonly PaymentsTab[] = [
  { to: "/admin/pagos", label: "admin.payments.tabs.review", end: true },
  { to: "/admin/pagos/lista", label: "admin.payments.tabs.list" },
  { to: "/admin/pagos/metodos", label: "admin.payments.tabs.methods" },
];
