import { adminKeys } from "../queryKeys";
import type { NotificationFilters, NotificationRow } from "./types";

/** Claves de caché del panel de Notificaciones. Cuelgan de ["admin", "notifications"]. */
export const notificationKeys = {
  all: [...adminKeys.all, "notifications"] as const,
  list: (filters: NotificationFilters) => [...notificationKeys.all, "list", filters] as const,
  counts: () => [...notificationKeys.all, "counts"] as const,
  health: () => [...notificationKeys.all, "health"] as const,
  thread: (id: NotificationRow["id"]) => [...notificationKeys.all, "thread", id] as const,
  forOrder: (orderId: string) => [...notificationKeys.all, "order", orderId] as const,
  templates: () => [...notificationKeys.all, "templates"] as const,
  settings: () => [...notificationKeys.all, "settings"] as const,
};
