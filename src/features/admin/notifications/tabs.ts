import type { MessageKey } from "@/i18n";

export interface NotificationsTab {
  to: string;
  label: MessageKey;
  end?: boolean;
}

/** Secciones del panel de Notificaciones (cada una es una ruta). */
export const NOTIFICATIONS_TABS: readonly NotificationsTab[] = [
  { to: "/admin/notificaciones", label: "admin.notifications.tabs.log", end: true },
  { to: "/admin/notificaciones/plantillas", label: "admin.notifications.tabs.templates" },
  { to: "/admin/notificaciones/envio", label: "admin.notifications.tabs.settings" },
];
