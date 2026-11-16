import { fromDbError } from "@/lib/db-errors";
import { getSupabase } from "@/lib/supabase";

export type PreferredChannel = "auto" | "email" | "whatsapp";

/** Cómo quiere recibir sus avisos. Los del pedido NO se pueden apagar: la preferencia solo elige el canal. */
export interface NotificationPreferences {
  channel: PreferredChannel;
  marketingEmail: boolean;
  marketingWhatsapp: boolean;
  /** Cuándo aceptó recibir novedades (lo fija la base; `null` si no aceptó nada). */
  consentAt: string | null;
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  channel: "auto",
  marketingEmail: false,
  marketingWhatsapp: false,
  consentAt: null,
};

export interface StoredPreferences {
  /** ¿Ya hay una fila? (decide entre crearla y actualizarla: la clienta no puede reescribir `profile_id`). */
  exists: boolean;
  preferences: NotificationPreferences;
}

const CHANNELS: readonly PreferredChannel[] = ["auto", "email", "whatsapp"];
const COLUMNS = "preferred_channel, marketing_email, marketing_whatsapp, marketing_consent_at";

interface Row {
  preferred_channel: string;
  marketing_email: boolean;
  marketing_whatsapp: boolean;
  marketing_consent_at: string | null;
}

const fromRow = (row: Row): NotificationPreferences => ({
  channel: CHANNELS.find((channel) => channel === row.preferred_channel) ?? "auto",
  marketingEmail: row.marketing_email,
  marketingWhatsapp: row.marketing_whatsapp,
  consentAt: row.marketing_consent_at,
});

/** Sus preferencias (la RLS solo deja ver la fila propia). Sin fila = los valores de arranque. */
export async function getNotificationPreferences(userId: string): Promise<StoredPreferences> {
  const { data, error } = await getSupabase()
    .from("notification_preferences")
    .select(COLUMNS)
    .eq("profile_id", userId)
    .maybeSingle();
  if (error) throw fromDbError(error);
  return data
    ? { exists: true, preferences: fromRow(data as Row) }
    : { exists: false, preferences: DEFAULT_PREFERENCES };
}

/**
 * Guarda. Crea la fila la primera vez y después solo actualiza las tres columnas permitidas. Si dos pestañas la crean a la vez
 * (23505), la segunda cae a actualizar.
 */
export async function saveNotificationPreferences(
  userId: string,
  next: Pick<NotificationPreferences, "channel" | "marketingEmail" | "marketingWhatsapp">,
  exists: boolean,
): Promise<NotificationPreferences> {
  const columns = {
    preferred_channel: next.channel,
    marketing_email: next.marketingEmail,
    marketing_whatsapp: next.marketingWhatsapp,
  };
  const table = () => getSupabase().from("notification_preferences");
  const update = async () => {
    const { data, error } = await table()
      .update(columns)
      .eq("profile_id", userId)
      .select(COLUMNS)
      .maybeSingle();
    if (error) throw fromDbError(error);
    return data ? fromRow(data as Row) : null;
  };
  if (exists) {
    const saved = await update();
    if (saved) return saved;
  }
  const { data, error } = await table()
    .insert({ profile_id: userId, ...columns })
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      const saved = await update();
      if (saved) return saved;
    }
    throw fromDbError(error);
  }
  return data ? fromRow(data as Row) : { ...DEFAULT_PREFERENCES, ...next };
}
