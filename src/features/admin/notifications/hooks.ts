import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listForOrder,
  listNotifications,
  listTemplates,
  listThread,
  notificationCounts,
  notificationHealth,
} from "./api";
import { notificationKeys } from "./queryKeys";
import type { NotificationFilters, NotificationRow } from "./types";

// El panel siempre lee fresco: el worker pudo enviar, reintentar o rescatar mientras tanto.
const fresh = { staleTime: 0, gcTime: 0 } as const;

export const useNotifications = (filters: NotificationFilters) =>
  useQuery({
    queryKey: notificationKeys.list(filters),
    queryFn: () => listNotifications(filters),
    placeholderData: keepPreviousData,
    // Mientras se mira el registro, se refresca solo: un aviso pendiente pasa a enviado en menos de un minuto.
    refetchInterval: 30_000,
    ...fresh,
  });

export const useNotificationCounts = () =>
  useQuery({
    queryKey: notificationKeys.counts(),
    queryFn: notificationCounts,
    refetchInterval: 30_000,
    ...fresh,
  });

export const useNotificationHealth = () =>
  useQuery({
    queryKey: notificationKeys.health(),
    queryFn: notificationHealth,
    refetchInterval: 60_000,
    ...fresh,
  });

export const useThread = (row: NotificationRow | null) =>
  useQuery({
    queryKey: notificationKeys.thread(row?.id ?? 0),
    queryFn: () => listThread(row as NotificationRow),
    enabled: row !== null,
    ...fresh,
  });

export const useOrderNotifications = (orderId: string) =>
  useQuery({
    queryKey: notificationKeys.forOrder(orderId),
    queryFn: () => listForOrder(orderId),
    ...fresh,
  });

export const useTemplates = () =>
  useQuery({ queryKey: notificationKeys.templates(), queryFn: listTemplates, ...fresh });

/** Tras cambiar un aviso o una plantilla: vuelve a leer todo el panel de Notificaciones. */
export function useInvalidateNotifications() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: notificationKeys.all });
}
