import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/useAuth";
import { AppError } from "@/lib/errors";
import { t } from "@/i18n";
import {
  getNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
} from "./api";

const key = (userId: string) => ["account", "notification-preferences", userId] as const;

export function useNotificationPreferences() {
  const { profile } = useAuth();
  const userId = profile?.id;
  return useQuery({
    queryKey: key(userId ?? ""),
    queryFn: () => getNotificationPreferences(userId as string),
    enabled: Boolean(userId),
  });
}

/** Guarda y deja el resultado en la caché (sin parpadeo del valor viejo). */
export function useSaveNotificationPreferences() {
  const { profile } = useAuth();
  const client = useQueryClient();
  const userId = profile?.id;
  return useMutation({
    mutationFn: async (
      next: Pick<NotificationPreferences, "channel" | "marketingEmail" | "marketingWhatsapp">,
    ) => {
      if (!userId) throw new AppError("unauthorized", t("acct.security.errors.session"));
      const exists = client.getQueryData<{ exists: boolean }>(key(userId))?.exists ?? false;
      return saveNotificationPreferences(userId, next, exists);
    },
    onSuccess: (preferences) => {
      if (userId) client.setQueryData(key(userId), { exists: true, preferences });
    },
  });
}
